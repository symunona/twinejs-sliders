package api

import (
	"encoding/json"
	"errors"
	"net/http"

	"twine-story-store/store"
)

type storyIndexResponse struct {
	Stories []store.IndexEntry `json:"stories"`
}

func (s *server) listStories(w http.ResponseWriter, r *http.Request) {
	stories, err := s.st.List()
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, storyIndexResponse{Stories: stories})
}

func (s *server) getStory(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	if r.URL.Query().Get("format") == "html" {
		// Publishing needs the story format compiled in, which is the editor's job and
		// not the store's. Answering 501 rather than pretending keeps the route
		// reserved for whoever builds it.
		writeError(w, http.StatusNotImplemented, codeBadRequest, "?format=html is not implemented")
		return
	}

	body, meta, err := s.st.GetStory(id)
	if err != nil {
		fail(w, err)
		return
	}

	w.Header().Set("ETag", etag(meta.Rev))
	if matchesIfNoneMatch(r, meta.Rev) {
		// The common case for an open story: the editor asks on every focus and
		// almost always already has it.
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

// putStoryRequest is PutStoryRequest in server.types.ts. `client` is the editor's build
// string, kept for the log; *who* wrote this comes from X-Client-Name, which every
// request carries and which the socket uses too.
type putStoryRequest struct {
	Story  json.RawMessage `json:"story"`
	Client string          `json:"client"`
}

func (s *server) putStory(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	var req putStoryRequest
	if err := decodeJSON(w, r, s.opts.MaxStoryBytes, &req); err != nil {
		fail(w, err)
		return
	}
	if len(req.Story) == 0 {
		writeError(w, http.StatusBadRequest, codeBadRequest, "body must be {\"story\": {…}}")
		return
	}

	ifMatch, err := parseIfMatch(r)
	if err != nil {
		fail(w, err)
		return
	}

	client := clientOf(r)
	res, err := s.st.PutStory(id, req.Story, client, store.PutOptions{
		IfMatch: ifMatch,
		Revive:  r.URL.Query().Get("revive") == "1",
	})
	if err != nil {
		// A write to a tombstone is 409, not 410: the resource is not simply gone, the
		// client has a choice to make (republish with ?revive=1), and 409 is the code
		// the conflict path in the editor already handles.
		var deleted *store.DeletedError
		if errors.As(err, &deleted) {
			writeError(w, http.StatusConflict, codeDeleted, deleted.Error())
			return
		}
		fail(w, err)
		return
	}

	if res.Revived {
		s.hub.StoryRevived(id, res.Rev, originOf(client))
	} else {
		s.hub.StoryChanged(id, res.Rev, originOf(client))
	}

	w.Header().Set("ETag", etag(res.Rev))
	writeJSON(w, http.StatusOK, res)
}

type deleteResponse struct {
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
	Purged  bool   `json:"purged"`
}

func (s *server) deleteStory(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	purge := r.URL.Query().Get("purge") == "1"

	client := clientOf(r)
	if err := s.st.DeleteStory(id, purge, client); err != nil {
		fail(w, err)
		return
	}

	s.hub.StoryDeleted(id, originOf(client))
	writeJSON(w, http.StatusOK, deleteResponse{ID: id, Deleted: true, Purged: purge})
}
