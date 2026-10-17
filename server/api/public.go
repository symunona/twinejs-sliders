package api

import "net/http"

// pubPrefix is the unguarded read-only route: GET /pub/{id} answers the stored story
// JSON to anyone, no token, any origin. A demo convenience for sharing a link — it
// exposes every story whose id is known, which is the point.
const pubPrefix = "/pub/"

func (s *server) getPublicStory(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")

	body, meta, err := s.st.GetStory(r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}

	w.Header().Set("ETag", etag(meta.Rev))
	w.Header().Set("Cache-Control", "no-cache")
	if matchesIfNoneMatch(r, meta.Rev) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}
