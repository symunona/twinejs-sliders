package api

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"
	"strings"

	"twine-story-store/store"
)

// Wire error codes — ServerErrorCode in src/store/persistence/server/server.types.ts.
const (
	codeUnauthorized = "unauthorized"
	codeNotFound     = "not_found"
	codeConflict     = "conflict"
	codeDeleted      = "deleted"
	codeTooLarge     = "too_large"
	codeBadRequest   = "bad_request"
	codeHashMismatch = "hash_mismatch"
	codeInternal     = "internal"
)

type errorPayload struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// errorBody is ServerErrorBody. The extra fields ride along on a 412 so the conflict
// banner can name who won the race and when, without a second request.
type errorBody struct {
	Error      errorPayload `json:"error"`
	Rev        *int         `json:"rev,omitempty"`
	UpdatedAt  string       `json:"updatedAt,omitempty"`
	LastClient string       `json:"lastClient,omitempty"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, errorBody{Error: errorPayload{Code: code, Message: message}})
}

// fail turns a store error into the response the client contract expects. Keeping the
// mapping in one place is what stops handlers inventing their own status codes.
func fail(w http.ResponseWriter, err error) {
	var conflict *store.ConflictError
	if errors.As(err, &conflict) {
		rev := conflict.Rev
		writeJSON(w, http.StatusPreconditionFailed, errorBody{
			Error:      errorPayload{Code: codeConflict, Message: conflict.Error()},
			Rev:        &rev,
			UpdatedAt:  conflict.UpdatedAt,
			LastClient: conflict.LastClient,
		})
		return
	}

	var deleted *store.DeletedError
	if errors.As(err, &deleted) {
		// 410 for a read: the story existed and is gone, which is exactly what a client
		// holding a copy needs to hear. Writes answer 409 instead — see putStory.
		writeError(w, http.StatusGone, codeDeleted, deleted.Error())
		return
	}

	var hash *store.HashMismatchError
	if errors.As(err, &hash) {
		writeError(w, http.StatusUnprocessableEntity, codeHashMismatch, hash.Error())
		return
	}

	var maxBytes *http.MaxBytesError
	if errors.As(err, &maxBytes) {
		writeError(w, http.StatusRequestEntityTooLarge, codeTooLarge, "request body is too large")
		return
	}

	var serr *store.Error
	if errors.As(err, &serr) {
		status := http.StatusInternalServerError
		switch serr.Code {
		case store.CodeNotFound:
			status = http.StatusNotFound
		case store.CodeBadRequest:
			status = http.StatusBadRequest
		case store.CodeTooLarge:
			status = http.StatusRequestEntityTooLarge
		case store.CodeHashMismatch:
			status = http.StatusUnprocessableEntity
		}
		writeError(w, status, serr.Code, serr.Message)
		return
	}

	writeError(w, http.StatusInternalServerError, codeInternal, err.Error())
}

// clientOf reads the identity labels off a request. Missing name is "unknown" rather than
// blank so revision rows and "who changed this" messages always have something to print.
func clientOf(r *http.Request) store.Client {
	c := store.Client{
		ID:   strings.TrimSpace(r.Header.Get("X-Client-Id")),
		Name: strings.TrimSpace(r.Header.Get("X-Client-Name")),
	}
	if c.Name == "" {
		c.Name = "unknown"
	}
	return c
}

// originOf is the identity the change bus announces a write under. Same labels as
// clientOf, in the shape the Notifier takes.
func originOf(c store.Client) Origin {
	return Origin{ID: c.ID, Name: c.Name}
}

// readLimited reads a request body under a hard cap. The cap is enforced by
// MaxBytesReader rather than by Content-Length so a lying or absent length cannot get
// past it.
func readLimited(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	return io.ReadAll(r.Body)
}

func decodeJSON(w http.ResponseWriter, r *http.Request, limit int64, v any) error {
	body, err := readLimited(w, r, limit)
	if err != nil {
		return err
	}
	if err := json.Unmarshal(body, v); err != nil {
		return &store.Error{Code: store.CodeBadRequest, Message: "body is not valid JSON: " + err.Error()}
	}
	return nil
}

// etag formats a rev as an entity tag. rev is the concurrency token for everything, so
// the tag is simply the number in quotes.
func etag(rev int) string { return `"` + strconv.Itoa(rev) + `"` }

// parseIfMatch reads an If-Match precondition.
//
// No header means last write wins, which is what autosave wants: it is the only writer
// for its own story in the normal case, and a precondition would turn every missed
// response into a stuck queue. `*` means "as long as it exists", so it is not a rev
// check either.
func parseIfMatch(r *http.Request) (*int, error) {
	raw := strings.TrimSpace(r.Header.Get("If-Match"))
	if raw == "" || raw == "*" {
		return nil, nil
	}
	rev, ok := parseETag(raw)
	if !ok {
		return nil, &store.Error{Code: store.CodeBadRequest, Message: "If-Match must be a quoted rev, e.g. \"42\""}
	}
	return &rev, nil
}

// matchesIfNoneMatch reports whether the client already has this rev.
func matchesIfNoneMatch(r *http.Request, rev int) bool {
	raw := strings.TrimSpace(r.Header.Get("If-None-Match"))
	if raw == "" {
		return false
	}
	if raw == "*" {
		return true
	}
	for _, part := range strings.Split(raw, ",") {
		if got, ok := parseETag(strings.TrimSpace(part)); ok && got == rev {
			return true
		}
	}
	return false
}

// parseETag accepts `"42"`, `W/"42"` and a bare `42`. Bare numbers are not legal HTTP,
// but a hand-written curl is the most likely caller to send one and refusing it teaches
// nobody anything.
func parseETag(raw string) (int, bool) {
	raw = strings.TrimPrefix(raw, "W/")
	raw = strings.Trim(raw, `"`)
	n, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return 0, false
	}
	return n, true
}
