package api

import (
	"crypto/sha256"
	"encoding/hex"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"testing"

	"twine-story-store/lib"
)

func TestPublicStoryPlaysWithoutToken(t *testing.T) {
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one")), http.StatusOK)

	expectError(t, h.raw("GET", "/pub/story-1", nil), http.StatusNotFound, codeNotFound)
	expectError(t, h.raw("PUT", "/api/v1/stories/story-1/player", []byte("<html>x</html>")), http.StatusUnauthorized, codeUnauthorized)
	expectError(t, h.do("PUT", "/api/v1/stories/nope/player", []byte("<html>x</html>")), http.StatusNotFound, codeNotFound)

	page := "<html><body>Lighthouse</body></html>"
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1/player", []byte(page)), http.StatusNoContent)

	res := h.raw("GET", "/pub/story-1", nil, "Origin", "https://elsewhere.example")
	expectStatus(t, res, http.StatusOK)
	if got := res.Header.Get("Content-Type"); !strings.HasPrefix(got, "text/html") {
		t.Fatalf("Content-Type = %q, want text/html", got)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(body) != page {
		t.Fatalf("public page = %q", body)
	}

	expectError(t, h.raw("GET", "/pub/nope", nil), http.StatusNotFound, codeNotFound)
	// The bypass is for reading, not for writing.
	expectStatus(t, h.raw("PUT", "/pub/story-1", []byte(page)), http.StatusMethodNotAllowed)
}

func TestPublicBlobNeedsNoToken(t *testing.T) {
	libStore, err := lib.Open(lib.Options{Dir: filepath.Join(t.TempDir(), "lib")})
	if err != nil {
		t.Fatalf("lib.Open: %v", err)
	}
	h := newHarness(t, func(o *Options) { o.Lib = libStore })

	png := "not really a png"
	sum := sha256.Sum256([]byte(png))
	sha := hex.EncodeToString(sum[:])
	if _, err := libStore.PutBlob(sha, "image/png", strings.NewReader(png)); err != nil {
		t.Fatalf("PutBlob: %v", err)
	}

	res := h.raw("GET", "/pub/blobs/"+sha, nil)
	expectStatus(t, res, http.StatusOK)
	if got := res.Header.Get("Content-Type"); got != "image/png" {
		t.Fatalf("Content-Type = %q", got)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(body) != png {
		t.Fatalf("blob = %q", body)
	}

	expectError(t, h.raw("GET", "/pub/blobs/"+strings.Repeat("0", 64), nil), http.StatusNotFound, codeNotFound)
}
