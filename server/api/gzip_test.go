package api

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"twine-story-store/store"
)

// bigStory is a story the size the author is heading for: ~20 passages of real prose and
// scene YAML. The point of the gzip tests is the ratio on a body like this, not on the
// 200-byte fixtures the other tests use.
//
// NOTE on reading the request in these tests: Go's Transport adds `Accept-Encoding: gzip`
// by itself and decompresses transparently — but only when the request did NOT set the
// header. Every test here sets it explicitly, so what comes back is what went over the
// wire, headers included.
func bigStory(passages int) []byte {
	const prose = `The lamp on the landing has not worked since the spring, and nobody
has been up to look at it. Mira counts the steps in the dark out of habit rather than
need — eleven to the turn, nine after it — and stops on the ninth because the door at the
top is already open, and it was not open when she left.

[scene]
bg: {id: landing, fx: parallax_left, speed: 20}
autoAdvance: 0
cast:
  mira: {at: -0.3, scale: 0.9, frame: idle}
  door: {at: 0.4, link: Cellar, highlight: gold}
beats:
  - mira: |
      Somebody has been here.
  - mira: {say: "And they did not lock up.", at: 0.1, dur: 0.8, ease: back_out}
  - wait: 0.5
  - door: {link: ~}
`

	list := make([]map[string]any, 0, passages)
	for i := 0; i < passages; i++ {
		list = append(list, map[string]any{
			"id": fmt.Sprintf("p%d", i+1), "name": fmt.Sprintf("Room %d", i+1),
			"text": fmt.Sprintf("%s\n\n[[Room %d]]\n", prose, i+2),
			"left": i * 140, "top": (i % 5) * 140, "width": 100, "height": 100,
			"tags": []string{"draft"}, "selected": false,
		})
	}
	raw, err := json.Marshal(map[string]any{
		"client": "twine-sliders test",
		"story": map[string]any{
			"id": "story-1", "ifid": "IFID-1", "name": "Lighthouse", "sync": true,
			"script": "", "stylesheet": "", "startPassage": "p1", "passages": list,
		},
	})
	if err != nil {
		panic(err)
	}
	return raw
}

func gunzip(t *testing.T, b []byte) []byte {
	t.Helper()
	zr, err := gzip.NewReader(bytes.NewReader(b))
	if err != nil {
		t.Fatalf("response is not gzip: %v", err)
	}
	out, err := io.ReadAll(zr)
	if err != nil {
		t.Fatalf("gunzip: %v", err)
	}
	return out
}

func readBody(t *testing.T, res *http.Response) []byte {
	t.Helper()
	defer res.Body.Close()
	b, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	return b
}

// TestGzipRoundTrip is the whole feature: a real-sized story goes out compressed and comes
// back byte for byte, and the ratio is printed so a regression in the policy is visible in
// the test log rather than only on someone's phone.
func TestGzipRoundTrip(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.MaxStoryBytes = 4 << 20 })
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", bigStory(20)), http.StatusOK)

	plain := readBody(t, h.do("GET", "/api/v1/stories/story-1", nil, "Accept-Encoding", "identity"))

	res := h.do("GET", "/api/v1/stories/story-1", nil, "Accept-Encoding", "gzip")
	expectStatus(t, res, http.StatusOK)
	if got := res.Header.Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q, want gzip", got)
	}
	if !strings.Contains(res.Header.Get("Vary"), "Accept-Encoding") {
		t.Fatalf("Vary = %q", res.Header.Get("Vary"))
	}
	// A length describing the plain body must not survive onto the compressed one.
	if got := res.Header.Get("Content-Length"); got != "" && got != fmt.Sprint(res.ContentLength) {
		t.Fatalf("Content-Length = %q on a gzip body of %d", got, res.ContentLength)
	}
	// The ETag is the rev, so it does not change with the encoding — and must not.
	if got := res.Header.Get("ETag"); got != `"1"` {
		t.Fatalf("ETag = %q", got)
	}

	packed := readBody(t, res)
	if !bytes.Equal(gunzip(t, packed), plain) {
		t.Fatal("gzip round trip changed the body")
	}
	if len(packed) >= len(plain) {
		t.Fatalf("gzip made it bigger: %d -> %d", len(plain), len(packed))
	}
	// The ratio here is OPTIMISTIC: bigStory repeats one paragraph, and gzip eats that.
	// The honest figures are from real bodies on the live store, measured through this
	// same handler and recorded in server/README.md — 2.92x and 4.48x. This log line is
	// here to make a regression in the policy visible, not to quote.
	t.Logf("generated story %d -> %d bytes (%.2fx, %.1f%%) — repetitive, see README for real bodies",
		len(plain), len(packed), float64(len(plain))/float64(len(packed)),
		100*float64(len(packed))/float64(len(plain)))

	// Index and manifest are the other two JSON reads the client makes constantly. Both
	// need enough rows to be worth compressing at all — a library of one story is 270
	// bytes and stays plain, which is the threshold doing its job.
	for i := 2; i <= 6; i++ {
		expectStatus(t, h.do("PUT", fmt.Sprintf("/api/v1/stories/story-%d", i), bigStory(2)), http.StatusOK)
	}
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1/assets",
		manifestPayload("a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8")), http.StatusOK)

	for _, path := range []string{"/api/v1/stories", "/api/v1/stories/story-1/assets"} {
		res := h.do("GET", path, nil, "Accept-Encoding", "gzip")
		expectStatus(t, res, http.StatusOK)
		if res.Header.Get("Content-Encoding") != "gzip" {
			t.Fatalf("%s came back uncompressed", path)
		}
		var v any
		if err := json.Unmarshal(gunzip(t, readBody(t, res)), &v); err != nil {
			t.Fatalf("%s does not parse after gunzip: %v", path, err)
		}
	}
}

func TestGzipOnlyWhenNegotiated(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.MaxStoryBytes = 4 << 20 })
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", bigStory(20)), http.StatusOK)

	for _, tc := range []struct {
		accept string
		want   bool
	}{
		{"gzip", true},
		{"gzip, deflate, br", true},
		{"deflate, gzip;q=0.5", true},
		{"identity", false},
		{"", false},
		{"br", false},
		{"deflate", false},
		// An explicit refusal is a refusal.
		{"gzip;q=0", false},
	} {
		t.Run("accept="+tc.accept, func(t *testing.T) {
			res := h.do("GET", "/api/v1/stories/story-1", nil, "Accept-Encoding", tc.accept)
			expectStatus(t, res, http.StatusOK)
			body := readBody(t, res)

			if got := res.Header.Get("Content-Encoding") == "gzip"; got != tc.want {
				t.Fatalf("Content-Encoding = %q, want gzip: %v", res.Header.Get("Content-Encoding"), tc.want)
			}
			if !tc.want && !bytes.Contains(body, []byte(`"Lighthouse"`)) {
				t.Fatalf("plain body is not plain: %q", body[:min(64, len(body))])
			}
		})
	}
}

// TestGzipSkipsWhatItWouldNotHelp pins the policy: blobs are already compressed, a body
// under the threshold is a rounding error, and a 304 has no body at all.
func TestGzipSkipsWhatItWouldNotHelp(t *testing.T) {
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one")), http.StatusOK)

	// A small story: JSON, but not worth 18 bytes of gzip framing.
	res := h.do("GET", "/api/v1/stories/story-1", nil, "Accept-Encoding", "gzip")
	expectStatus(t, res, http.StatusOK)
	small := readBody(t, res)
	if res.Header.Get("Content-Encoding") != "" {
		t.Fatalf("a %d-byte body was compressed", len(small))
	}
	if !bytes.Contains(small, []byte(`"Lighthouse"`)) {
		t.Fatalf("small body = %s", small)
	}

	// 304: no body, so no encoding, and nothing that could confuse a cache.
	res = h.do("GET", "/api/v1/stories/story-1", nil, "If-None-Match", `"1"`, "Accept-Encoding", "gzip")
	if res.StatusCode != http.StatusNotModified {
		t.Fatalf("status %d, want 304", res.StatusCode)
	}
	if res.Header.Get("Content-Encoding") != "" {
		t.Fatal("304 carries a Content-Encoding")
	}
	if body := readBody(t, res); len(body) != 0 {
		t.Fatalf("304 carried a body: %s", body)
	}

	// An asset blob is webp/mp3/png — already compressed, and ServeContent serves it with
	// a Content-Length and Range support that gzip would throw away.
	blob := bytes.Repeat([]byte("webp-ish bytes, but a blob all the same. "), 64)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1/assets", manifestPayload("a1")), http.StatusOK)
	expectStatus(t,
		h.do("PUT", "/api/v1/stories/story-1/assets/a1", blob, "X-Asset-Hash", sha(blob), "Content-Type", "image/webp"),
		http.StatusOK)

	res = h.do("GET", "/api/v1/stories/story-1/assets/a1", nil, "Accept-Encoding", "gzip")
	expectStatus(t, res, http.StatusOK)
	if res.Header.Get("Content-Encoding") != "" {
		t.Fatal("an asset blob was gzipped")
	}
	if got := readBody(t, res); !bytes.Equal(got, blob) {
		t.Fatalf("blob came back changed (%d bytes)", len(got))
	}
	if res.ContentLength != int64(len(blob)) {
		t.Fatalf("Content-Length = %d, want %d", res.ContentLength, len(blob))
	}

	// HEAD keeps its Content-Length probe, which is the whole point of the route.
	res = h.do("HEAD", "/api/v1/stories/story-1/assets/a1", nil, "Accept-Encoding", "gzip")
	res.Body.Close()
	if res.ContentLength != int64(len(blob)) {
		t.Fatalf("HEAD Content-Length = %d, want %d", res.ContentLength, len(blob))
	}
}

// TestGzipErrorsStayReadable — a 412 is the body the conflict banner parses, and it goes
// through the same wrapper as everything else.
func TestGzipErrorsStayReadable(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.MaxStoryBytes = 4 << 20 })
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", bigStory(4)), http.StatusOK)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", bigStory(4)), http.StatusOK)

	res := h.do("PUT", "/api/v1/stories/story-1", bigStory(4), "If-Match", `"1"`, "Accept-Encoding", "gzip")
	if res.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("status %d, want 412", res.StatusCode)
	}
	raw := readBody(t, res)
	if res.Header.Get("Content-Encoding") == "gzip" {
		raw = gunzip(t, raw)
	}
	var body errorBody
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatalf("412 body does not parse: %v\n%s", err, raw)
	}
	if body.Error.Code != codeConflict || body.Rev == nil || *body.Rev != 2 {
		t.Fatalf("412 body = %+v", body)
	}
}

// TestGzipPatchResponse — the upload half and the download half meet here: a patch of one
// passage answers with a PutStoryResponse, gzip negotiated or not.
func TestGzipPatchResponse(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.MaxStoryBytes = 4 << 20 })
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", bigStory(20)), http.StatusOK)

	body := patchPayload(changed(map[string]any{"id": "p3", "name": "Room 3", "text": "rewritten"}))
	res := h.do("PATCH", "/api/v1/stories/story-1", body, "If-Match", `"1"`, "Accept-Encoding", "gzip")
	expectStatus(t, res, http.StatusOK)

	raw := readBody(t, res)
	if res.Header.Get("Content-Encoding") == "gzip" {
		raw = gunzip(t, raw)
	}
	var put store.PutResult
	if err := json.Unmarshal(raw, &put); err != nil {
		t.Fatalf("patch response does not parse: %v\n%s", err, raw)
	}
	if put.Rev != 2 {
		t.Fatalf("patch response = %+v", put)
	}

	// And the patch body itself is a fraction of the story it edits — the reason the
	// route exists.
	if len(body) >= len(bigStory(20))/4 {
		t.Fatalf("patch is %d bytes against a %d-byte story", len(body), len(bigStory(20)))
	}
	t.Logf("one-passage patch %d bytes vs whole-story PUT %d bytes", len(body), len(bigStory(20)))
}
