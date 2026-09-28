package lib

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

// Prefix is where the library is mounted.
const Prefix = "/api/v1/lib"

const (
	maxRecordBytes = 4 << 20
	maxHasBytes    = 4 << 20
	defaultLimit   = 500
	maxLimit       = 2000
)

// Notifier receives every accepted record write. exceptClientID is the writer's
// X-Client-Id, which the hub skips.
type Notifier interface {
	LibChanged(c Change, exceptClientID string)
}

// HandlerOptions wires the HTTP layer.
type HandlerOptions struct {
	Store        *Store
	Notifier     Notifier // nil = none
	MaxBlobBytes int64    // MAX_ASSET_BYTES
}

type handler struct{ HandlerOptions }

// Register mounts every lib route on mux under Prefix. Auth and CORS come from whatever
// wraps mux.
func Register(mux *http.ServeMux, opts HandlerOptions) {
	if opts.MaxBlobBytes <= 0 {
		opts.MaxBlobBytes = 64 << 20
	}
	h := &handler{opts}
	mux.HandleFunc("POST "+Prefix+"/blobs/has", h.blobsHas)
	mux.HandleFunc("PUT "+Prefix+"/blobs/{sha}", h.putBlob)
	mux.HandleFunc("GET "+Prefix+"/blobs/{sha}", h.getBlob) // + HEAD
	mux.HandleFunc("GET "+Prefix+"/changes", h.changes)
	for path, typ := range Types {
		typ := typ
		mux.HandleFunc("GET "+Prefix+"/"+path+"/{id}", func(w http.ResponseWriter, r *http.Request) { h.getRecord(w, r, typ) })
		mux.HandleFunc("PUT "+Prefix+"/"+path+"/{id}", func(w http.ResponseWriter, r *http.Request) { h.putRecord(w, r, typ) })
		mux.HandleFunc("DELETE "+Prefix+"/"+path+"/{id}", func(w http.ResponseWriter, r *http.Request) { h.deleteRecord(w, r, typ) })
		mux.HandleFunc("GET "+Prefix+"/"+path+"/{id}/revs", func(w http.ResponseWriter, r *http.Request) { h.revs(w, r, typ) })
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, err error) {
	var le *Error
	if errors.As(err, &le) {
		body := map[string]any{"error": le.Code}
		for k, v := range le.Extra {
			body[k] = v
		}
		writeJSON(w, le.Status, body)
		return
	}
	var mb *http.MaxBytesError
	if errors.As(err, &mb) {
		writeJSON(w, http.StatusRequestEntityTooLarge, map[string]any{"error": "too-large"})
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal", "detail": err.Error()})
}

func errCode(status int, code string) error { return &Error{Status: status, Code: code} }

func clientOf(r *http.Request) (id, name string) {
	id = strings.TrimSpace(r.Header.Get("X-Client-Id"))
	name = strings.TrimSpace(r.Header.Get("X-Client-Name"))
	if name == "" {
		name = "unknown"
	}
	return id, name
}

func (h *handler) blobsHas(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxHasBytes)
	var req struct {
		Hashes []string `json:"hashes"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var mb *http.MaxBytesError
		if errors.As(err, &mb) {
			writeErr(w, err)
			return
		}
		writeJSON(w, 400, map[string]any{"error": "bad-request", "detail": "body must be {\"hashes\": [sha]}"})
		return
	}
	writeJSON(w, 200, map[string]any{"missing": h.Store.MissingBlobs(req.Hashes)})
}

func (h *handler) putBlob(w http.ResponseWriter, r *http.Request) {
	sha := r.PathValue("sha")
	if !ValidSha(sha) {
		writeJSON(w, 400, map[string]any{"error": "bad-request", "detail": "sha must be lowercase hex sha256"})
		return
	}
	if r.ContentLength > h.MaxBlobBytes {
		if _, ok := h.Store.Blob(sha); !ok {
			writeErr(w, errCode(413, "too-large"))
			return
		}
	}
	body := http.MaxBytesReader(w, r.Body, h.MaxBlobBytes)
	info, err := h.Store.PutBlob(sha, r.Header.Get("Content-Type"), body)
	if err != nil {
		writeErr(w, err)
		return
	}
	w.Header().Set("ETag", `"`+sha+`"`)
	writeJSON(w, 200, info)
}

func (h *handler) getBlob(w http.ResponseWriter, r *http.Request) {
	sha := r.PathValue("sha")
	info, ok := h.Store.Blob(sha)
	if !ok {
		writeErr(w, errCode(404, "not-found"))
		return
	}
	f, err := os.Open(h.Store.BlobPath(sha))
	if err != nil {
		writeErr(w, errCode(404, "not-found"))
		return
	}
	defer f.Close()
	w.Header().Set("ETag", `"`+sha+`"`)
	w.Header().Set("Content-Type", info.Mime)
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, "", time.Time{}, f)
}

func (h *handler) changes(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	since, limit := int64(0), defaultLimit
	if v := q.Get("since"); v != "" {
		n, err := strconv.ParseInt(v, 10, 64)
		if err != nil || n < 0 {
			writeJSON(w, 400, map[string]any{"error": "bad-request", "detail": "since must be a non-negative integer"})
			return
		}
		since = n
	}
	if v := q.Get("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			writeJSON(w, 400, map[string]any{"error": "bad-request", "detail": "limit must be a positive integer"})
			return
		}
		limit = min(n, maxLimit)
	}
	items, seq, more := h.Store.Changes(since, limit)
	writeJSON(w, 200, map[string]any{"seq": seq, "items": items, "more": more})
}

func (h *handler) getRecord(w http.ResponseWriter, r *http.Request, typ string) {
	rec := h.Store.Get(typ, r.PathValue("id"))
	if rec == nil {
		writeErr(w, errCode(404, "not-found"))
		return
	}
	w.Header().Set("ETag", `"`+string(rec["rev"])+`"`)
	writeJSON(w, 200, rec)
}

// precondition reads If-Match / If-None-Match. If-Match wins when both are sent.
func precondition(r *http.Request) (Precondition, error) {
	var p Precondition
	if raw := strings.TrimSpace(r.Header.Get("If-Match")); raw != "" {
		raw = strings.Trim(strings.TrimPrefix(raw, "W/"), `"`)
		n, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil {
			return p, badRecord(`If-Match must be a quoted rev, e.g. "7"`)
		}
		p.HasRev, p.Rev = true, n
		return p, nil
	}
	if strings.TrimSpace(r.Header.Get("If-None-Match")) == "*" {
		p.Create = true
	}
	return p, nil
}

func (h *handler) putRecord(w http.ResponseWriter, r *http.Request, typ string) {
	pre, err := precondition(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRecordBytes))
	if err != nil {
		writeErr(w, err)
		return
	}
	clientID, by := clientOf(r)
	rec, seq, err := h.Store.Put(typ, r.PathValue("id"), body, pre, by)
	h.done(w, typ, r.PathValue("id"), rec, seq, clientID, by, err)
}

func (h *handler) deleteRecord(w http.ResponseWriter, r *http.Request, typ string) {
	pre, err := precondition(r)
	if err != nil {
		writeErr(w, err)
		return
	}
	clientID, by := clientOf(r)
	rec, seq, err := h.Store.Delete(typ, r.PathValue("id"), pre, by)
	h.done(w, typ, r.PathValue("id"), rec, seq, clientID, by, err)
}

func (h *handler) done(w http.ResponseWriter, typ, id string, rec Record, seq int64, clientID, by string, err error) {
	if err != nil {
		writeErr(w, err)
		return
	}
	rev, _ := strconv.Atoi(string(rec["rev"]))
	if h.Notifier != nil {
		h.Notifier.LibChanged(Change{Seq: seq, Type: typ, ID: id, Rev: rev, By: by}, clientID)
	}
	w.Header().Set("ETag", `"`+strconv.Itoa(rev)+`"`)
	writeJSON(w, 200, map[string]any{"record": rec, "seq": seq})
}

func (h *handler) revs(w http.ResponseWriter, r *http.Request, typ string) {
	revs, ok, err := h.Store.Revs(typ, r.PathValue("id"))
	if err != nil {
		writeErr(w, err)
		return
	}
	if !ok {
		writeErr(w, errCode(404, "not-found"))
		return
	}
	writeJSON(w, 200, map[string]any{"revs": revs})
}
