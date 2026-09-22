package api

import (
	"net/http"
	"strconv"

	"twine-story-store/store"
)

func (s *server) listRevisions(w http.ResponseWriter, r *http.Request) {
	revs, err := s.st.Revisions(r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, revs)
}

// revParam parses the {rev} path segment.
func revParam(r *http.Request) (int, error) {
	rev, err := strconv.Atoi(r.PathValue("rev"))
	if err != nil || rev < 0 {
		return 0, &store.Error{Code: store.CodeBadRequest, Message: "rev must be a non-negative integer"}
	}
	return rev, nil
}

func (s *server) getRevision(w http.ResponseWriter, r *http.Request) {
	rev, err := revParam(r)
	if err != nil {
		fail(w, err)
		return
	}
	body, err := s.st.RevisionBody(r.PathValue("id"), rev)
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func (s *server) getRevisionAssets(w http.ResponseWriter, r *http.Request) {
	rev, err := revParam(r)
	if err != nil {
		fail(w, err)
		return
	}
	man, err := s.st.RevisionManifest(r.PathValue("id"), rev)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, man)
}

// labelRequest is RevisionMetaRequest in server.types.ts.
//
// Both fields are optional and both are pointers, so "not mentioned" and "set to the zero
// value" stay apart. The rule on the wire:
//
//   - field omitted        → unchanged
//   - field explicitly null → unchanged, same as omitted (encoding/json cannot tell the
//     two apart through a pointer, and inventing a
//     json.RawMessage dance to separate them buys nothing —
//     there is already a spelling for "clear it")
//   - "label": ""          → clears the label
//   - "pinned": false      → unpins
type labelRequest struct {
	Label  *string `json:"label"`
	Pinned *bool   `json:"pinned"`
}

// labelRevision names or pins one revision.
//
// It is not a write of the story: no rev bump, no snapshot, no `story` broadcast, and no
// ETag on the response — the story's rev did not move and handing back a tag would invite
// a client to think it did. What it does broadcast is `revmeta`, which every open History
// dialog re-lists on and everyone else ignores.
func (s *server) labelRevision(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	rev, err := revParam(r)
	if err != nil {
		fail(w, err)
		return
	}

	// 64 KB is the same cap restore uses. A label is 120 characters; the limit is here
	// to bound the read, not to express the rule.
	var req labelRequest
	if err := decodeJSON(w, r, 1<<16, &req); err != nil {
		fail(w, err)
		return
	}
	if req.Label == nil && req.Pinned == nil {
		writeError(w, http.StatusBadRequest, codeBadRequest, "body must carry `label`, `pinned` or both")
		return
	}

	client := clientOf(r)
	res, err := s.st.SetRevisionMeta(id, rev, store.RevisionMeta{Label: req.Label, Pinned: req.Pinned})
	if err != nil {
		// Over PINNED_MAX comes back as a store bad_request, which fail() maps to 400.
		// 409 would read better, but `conflict` is the wire code the client already
		// binds to a lost If-Match race and a 412 banner; reusing it here would put a
		// "someone else saved first" dialog in front of a pin that simply hit its cap.
		fail(w, err)
		return
	}

	s.hub.RevisionMetaChanged(id, rev, originOf(client))
	writeJSON(w, http.StatusOK, res)
}

type restoreRequest struct {
	Rev *int `json:"rev"`
}

// restoreStory copies an old body back as an ordinary write, so every other editor pulls
// it exactly like any other change and the version restored over is itself kept.
func (s *server) restoreStory(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var req restoreRequest
	if err := decodeJSON(w, r, 1<<16, &req); err != nil {
		fail(w, err)
		return
	}
	if req.Rev == nil || *req.Rev < 0 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "body must be {\"rev\": N}")
		return
	}

	client := clientOf(r)
	res, err := s.st.Restore(id, *req.Rev, client)
	if err != nil {
		fail(w, err)
		return
	}

	s.hub.StoryChanged(id, res.Rev, originOf(client))
	w.Header().Set("ETag", etag(res.Rev))
	writeJSON(w, http.StatusOK, res)
}
