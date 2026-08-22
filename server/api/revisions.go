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
