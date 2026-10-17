package api

import (
	"bytes"
	"net/http"
	"os"
	"time"
)

// pubPrefix is the unguarded read-only surface: GET /pub/{id} plays the story, GET
// /pub/blobs/{sha} serves the art it points at. No token, any origin. A demo convenience
// for sharing a link — it exposes every story whose id is known, which is the point.
// Blobs are content addressed, so a sha is only known to someone who was handed a page.
const pubPrefix = "/pub/"

func (s *server) getPublicStory(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")

	html, err := s.st.GetPlayer(r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}

	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeContent(w, r, "", time.Time{}, bytes.NewReader(html))
}

// putPlayer takes the playable HTML the editor published. Authenticated: it is a write.
func (s *server) putPlayer(w http.ResponseWriter, r *http.Request) {
	body, err := readLimited(w, r, s.opts.MaxAssetBytes)
	if err != nil {
		fail(w, err)
		return
	}
	if err := s.st.PutPlayer(r.PathValue("id"), body); err != nil {
		fail(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) getPublicBlob(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")

	sha := r.PathValue("sha")
	info, ok := s.opts.Lib.Blob(sha)
	if !ok {
		writeError(w, http.StatusNotFound, codeNotFound, "blob not found")
		return
	}
	f, err := os.Open(s.opts.Lib.BlobPath(sha))
	if err != nil {
		writeError(w, http.StatusNotFound, codeNotFound, "blob not found")
		return
	}
	defer f.Close()

	w.Header().Set("ETag", `"`+sha+`"`)
	w.Header().Set("Content-Type", info.Mime)
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	http.ServeContent(w, r, "", time.Time{}, f)
}
