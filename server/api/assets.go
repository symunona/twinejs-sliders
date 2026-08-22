package api

import (
	"net/http"
	"os"
	"strings"
	"time"

	"twine-story-store/store"
)

func (s *server) getManifest(w http.ResponseWriter, r *http.Request) {
	man, err := s.st.GetManifest(r.PathValue("id"))
	if err != nil {
		fail(w, err)
		return
	}
	w.Header().Set("ETag", etag(man.Rev))
	if matchesIfNoneMatch(r, man.Rev) {
		w.WriteHeader(http.StatusNotModified)
		return
	}
	writeJSON(w, http.StatusOK, man)
}

func (s *server) putManifest(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	body, err := readLimited(w, r, s.opts.MaxStoryBytes)
	if err != nil {
		fail(w, err)
		return
	}
	ifMatch, err := parseIfMatch(r)
	if err != nil {
		fail(w, err)
		return
	}

	client := clientOf(r)
	man, err := s.st.PutManifest(id, body, ifMatch, client)
	if err != nil {
		fail(w, err)
		return
	}

	s.hub.AssetsChanged(id, man.Rev, originOf(client))
	w.Header().Set("ETag", etag(man.Rev))
	writeJSON(w, http.StatusOK, man)
}

func (s *server) diffAssets(w http.ResponseWriter, r *http.Request) {
	var req store.DiffRequest
	if err := decodeJSON(w, r, s.opts.MaxStoryBytes, &req); err != nil {
		fail(w, err)
		return
	}
	res, err := s.st.Diff(r.PathValue("id"), req)
	if err != nil {
		fail(w, err)
		return
	}
	writeJSON(w, http.StatusOK, res)
}

// getAsset serves blob bytes, and serves HEAD for free: net/http drops the body itself,
// so the same handler answers the "do you have this, and is it the version I mean?" probe
// with Content-Length and an ETag of the content hash.
func (s *server) getAsset(w http.ResponseWriter, r *http.Request) {
	file, err := s.st.Asset(r.PathValue("id"), r.PathValue("assetId"))
	if err != nil {
		fail(w, err)
		return
	}

	f, err := os.Open(file.Path)
	if err != nil {
		fail(w, err)
		return
	}
	defer f.Close()

	if file.Hash != "" {
		w.Header().Set("ETag", `"`+file.Hash+`"`)
	}
	if file.Mime != "" {
		w.Header().Set("Content-Type", file.Mime)
	}
	// Blobs are content addressed by the manifest hash, so a long cache is safe: a new
	// version of an image is a new asset id, never new bytes under the old one.
	w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
	http.ServeContent(w, r, file.Path, time.Time{}, f)
}

type putAssetResponse struct {
	ID    string `json:"id"`
	Bytes int64  `json:"bytes"`
	Hash  string `json:"hash"`
}

func (s *server) putAsset(w http.ResponseWriter, r *http.Request) {
	storyID := r.PathValue("id")
	assetID := r.PathValue("assetId")

	hash := strings.ToLower(strings.TrimSpace(r.Header.Get("X-Asset-Hash")))
	if hash == "" {
		writeError(w, http.StatusBadRequest, codeBadRequest, "X-Asset-Hash is required")
		return
	}

	// The limit is enforced on the stream, not on Content-Length: the client cannot be
	// trusted to declare it, and a 64 MB cap that only checks a header is not a cap.
	r.Body = http.MaxBytesReader(w, r.Body, s.opts.MaxAssetBytes)

	n, err := s.st.PutAsset(storyID, assetID, r.Body, hash, r.Header.Get("Content-Type"))
	if err != nil {
		fail(w, err)
		return
	}

	client := clientOf(r)
	rev := 0
	if meta, err := s.st.Meta(storyID); err == nil {
		rev = meta.AssetRev
	}
	s.hub.AssetsChanged(storyID, rev, originOf(client))

	w.Header().Set("ETag", `"`+hash+`"`)
	writeJSON(w, http.StatusOK, putAssetResponse{ID: assetID, Bytes: n, Hash: hash})
}

type deleteAssetResponse struct {
	ID      string `json:"id"`
	Deleted bool   `json:"deleted"`
}

func (s *server) deleteAsset(w http.ResponseWriter, r *http.Request) {
	storyID := r.PathValue("id")
	assetID := r.PathValue("assetId")

	if err := s.st.DeleteAsset(storyID, assetID); err != nil {
		fail(w, err)
		return
	}

	client := clientOf(r)
	rev := 0
	if meta, err := s.st.Meta(storyID); err == nil {
		rev = meta.AssetRev
	}
	s.hub.AssetsChanged(storyID, rev, originOf(client))

	writeJSON(w, http.StatusOK, deleteAssetResponse{ID: assetID, Deleted: true})
}
