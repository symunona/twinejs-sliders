package api

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"twine-story-store/store"
)

const testToken = "test-token-0123456789"

type harness struct {
	t      *testing.T
	srv    *httptest.Server
	st     *store.Store
	dir    string
	notify *recordingNotifier
}

// recordingNotifier stands in for the websocket hub, so the tests can assert that every
// accepted write is announced exactly once.
type recordingNotifier struct {
	mu     sync.Mutex
	events []string
}

func (n *recordingNotifier) record(s string) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.events = append(n.events, s)
}

func (n *recordingNotifier) all() []string {
	n.mu.Lock()
	defer n.mu.Unlock()
	return append([]string(nil), n.events...)
}

func (n *recordingNotifier) StoryChanged(id string, rev int, by Origin) {
	n.record(fmt.Sprintf("story %s %d %s", id, rev, by.Name))
}
func (n *recordingNotifier) StoryDeleted(id string, by Origin) {
	n.record(fmt.Sprintf("deleted %s %s", id, by.Name))
}
func (n *recordingNotifier) StoryRevived(id string, rev int, by Origin) {
	n.record(fmt.Sprintf("revived %s %d %s", id, rev, by.Name))
}
func (n *recordingNotifier) AssetsChanged(story string, rev int, by Origin) {
	n.record(fmt.Sprintf("assets %s %d %s", story, rev, by.Name))
}

func newHarness(t *testing.T, tweak func(*Options)) *harness {
	t.Helper()

	dir := t.TempDir()
	st, err := store.New(store.Options{
		Dir:          dir,
		RevKeep:      20,
		OrphanTTL:    168 * time.Hour,
		TombstoneTTL: 2160 * time.Hour,
	})
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}

	notify := &recordingNotifier{}
	opts := Options{
		Store:         st,
		Token:         testToken,
		Origins:       []string{"http://127.0.0.1:5173"},
		MaxStoryBytes: 1 << 20,
		MaxAssetBytes: 1 << 20,
		KeepRevisions: 20,
		Version:       "test",
		Notifier:      notify,
	}
	if tweak != nil {
		tweak(&opts)
	}

	srv := httptest.NewServer(NewHandler(opts))
	t.Cleanup(srv.Close)
	return &harness{t: t, srv: srv, st: st, dir: dir, notify: notify}
}

// do sends an authenticated request. Every request carries the identity headers, exactly
// as the client does.
func (h *harness) do(method, path string, body []byte, headers ...string) *http.Response {
	h.t.Helper()
	return h.raw(method, path, body, append([]string{
		"Authorization", "Bearer " + testToken,
		"X-Client-Id", "client-1",
		"X-Client-Name", "mira",
	}, headers...)...)
}

func (h *harness) raw(method, path string, body []byte, headers ...string) *http.Response {
	h.t.Helper()

	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader(body)
	}
	req, err := http.NewRequest(method, h.srv.URL+path, reader)
	if err != nil {
		h.t.Fatalf("new request: %v", err)
	}
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := h.srv.Client().Do(req)
	if err != nil {
		h.t.Fatalf("%s %s: %v", method, path, err)
	}
	return res
}

func decode(t *testing.T, res *http.Response, v any) {
	t.Helper()
	defer res.Body.Close()
	body, err := io.ReadAll(res.Body)
	if err != nil {
		t.Fatalf("read body: %v", err)
	}
	if len(body) == 0 {
		return
	}
	if err := json.Unmarshal(body, v); err != nil {
		t.Fatalf("decode %s: %v", body, err)
	}
}

func expectStatus(t *testing.T, res *http.Response, want int) {
	t.Helper()
	if res.StatusCode != want {
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		t.Fatalf("status %d, want %d: %s", res.StatusCode, want, body)
	}
}

func expectError(t *testing.T, res *http.Response, status int, code string) {
	t.Helper()
	if res.StatusCode != status {
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		t.Fatalf("status %d, want %d: %s", res.StatusCode, status, body)
	}
	var body errorBody
	decode(t, res, &body)
	if body.Error.Code != code {
		t.Fatalf("error code %q, want %q", body.Error.Code, code)
	}
	if body.Error.Message == "" {
		t.Fatal("error carries no message")
	}
}

func storyPayload(name string, text string) []byte {
	raw, err := json.Marshal(map[string]any{
		"client": "twine-sliders test",
		"story": map[string]any{
			"id": "story-1", "ifid": "IFID-1", "name": name, "sync": true,
			"passages": []map[string]any{{"id": "p1", "name": "Start", "text": text}},
		},
	})
	if err != nil {
		panic(err)
	}
	return raw
}

func sha(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

func manifestPayload(ids ...string) []byte {
	assets := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		assets = append(assets, map[string]any{
			"id": id, "name": id, "kind": "bg", "tags": []string{}, "animated": false,
			"w": 4, "h": 4, "bytes": int64(len(id)), "hash": sha([]byte(id)), "mime": "image/webp",
		})
	}
	raw, err := json.Marshal(map[string]any{"version": 1, "assets": assets, "characters": []any{}})
	if err != nil {
		panic(err)
	}
	return raw
}

// ---------------------------------------------------------------------------
// Probes and auth
// ---------------------------------------------------------------------------

func TestHealthNeedsNoToken(t *testing.T) {
	h := newHarness(t, nil)
	res := h.raw("GET", "/api/v1/health", nil)
	expectStatus(t, res, http.StatusOK)

	var body healthResponse
	decode(t, res, &body)
	if !body.OK || body.Service != ServiceName || body.APIVersion != APIVersion {
		t.Fatalf("health said %+v", body)
	}
}

func TestEveryOtherRouteNeedsTheToken(t *testing.T) {
	h := newHarness(t, nil)

	routes := []struct{ method, path string }{
		{"GET", "/api/v1/ping"},
		{"GET", "/api/v1/stories"},
		{"GET", "/api/v1/stories/story-1"},
		{"PUT", "/api/v1/stories/story-1"},
		{"DELETE", "/api/v1/stories/story-1"},
		{"GET", "/api/v1/stories/story-1/revisions"},
		{"GET", "/api/v1/stories/story-1/revisions/1"},
		{"GET", "/api/v1/stories/story-1/revisions/1/assets"},
		{"POST", "/api/v1/stories/story-1/restore"},
		{"GET", "/api/v1/stories/story-1/assets"},
		{"PUT", "/api/v1/stories/story-1/assets"},
		{"POST", "/api/v1/stories/story-1/assets/diff"},
		{"HEAD", "/api/v1/stories/story-1/assets/a1"},
		{"GET", "/api/v1/stories/story-1/assets/a1"},
		{"PUT", "/api/v1/stories/story-1/assets/a1"},
		{"DELETE", "/api/v1/stories/story-1/assets/a1"},
	}
	for _, r := range routes {
		res := h.raw(r.method, r.path, []byte("{}"))
		if res.StatusCode != http.StatusUnauthorized {
			body, _ := io.ReadAll(res.Body)
			res.Body.Close()
			t.Fatalf("%s %s without a token: %d %s", r.method, r.path, res.StatusCode, body)
		}
		res.Body.Close()
	}

	// A wrong token is refused just like a missing one.
	res := h.raw("GET", "/api/v1/ping", nil, "Authorization", "Bearer not-the-token")
	expectError(t, res, http.StatusUnauthorized, codeUnauthorized)
}

func TestPingReportsLimitsAndNoHubYet(t *testing.T) {
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one")), http.StatusOK)

	res := h.do("GET", "/api/v1/ping", nil)
	expectStatus(t, res, http.StatusOK)

	var body pingResponse
	decode(t, res, &body)
	if body.StoryCount != 1 {
		t.Fatalf("storyCount = %d", body.StoryCount)
	}
	if body.BytesUsed <= 0 {
		t.Fatalf("bytesUsed = %d", body.BytesUsed)
	}
	if body.MaxAssetBytes != 1<<20 || body.MaxStoryBytes != 1<<20 || body.KeepRevisions != 20 {
		t.Fatalf("limits not reported: %+v", body)
	}
	if body.Events {
		t.Fatal("events should be false until the hub exists")
	}
	if body.Clients == nil || len(body.Clients) != 0 {
		t.Fatalf("clients = %v, want []", body.Clients)
	}
}

func TestCORSPreflight(t *testing.T) {
	h := newHarness(t, nil)
	res := h.raw("OPTIONS", "/api/v1/stories/story-1", nil, "Origin", "http://127.0.0.1:5173")
	expectStatus(t, res, http.StatusNoContent)
	res.Body.Close()

	if got := res.Header.Get("Access-Control-Allow-Origin"); got != "http://127.0.0.1:5173" {
		t.Fatalf("allow-origin = %q", got)
	}
	for _, want := range []string{"authorization", "if-match", "x-asset-hash", "x-client-name"} {
		if !strings.Contains(res.Header.Get("Access-Control-Allow-Headers"), want) {
			t.Fatalf("preflight does not allow %s", want)
		}
	}
	if res.Header.Get("Access-Control-Expose-Headers") != "etag" {
		t.Fatal("etag is not exposed, so the client cannot read a rev")
	}

	// An origin that is not configured gets no allow header, and the browser stops it.
	other := h.raw("OPTIONS", "/api/v1/stories/story-1", nil, "Origin", "https://evil.example")
	other.Body.Close()
	if other.Header.Get("Access-Control-Allow-Origin") != "" {
		t.Fatal("unlisted origin was allowed")
	}
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

func TestStoryRoundTrip(t *testing.T) {
	h := newHarness(t, nil)

	res := h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one"))
	expectStatus(t, res, http.StatusOK)
	var put store.PutResult
	decode(t, res, &put)
	if put.Rev != 1 || put.ID != "story-1" || put.UpdatedAt == "" || put.Bytes == 0 {
		t.Fatalf("put response = %+v", put)
	}

	res = h.do("GET", "/api/v1/stories/story-1", nil)
	expectStatus(t, res, http.StatusOK)
	if got := res.Header.Get("ETag"); got != `"1"` {
		t.Fatalf("ETag = %q, want \"1\"", got)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if bytes.Contains(body, []byte(`"sync"`)) {
		t.Fatalf("sync came back on the wire: %s", body)
	}
	if !bytes.Contains(body, []byte(`"Lighthouse"`)) {
		t.Fatalf("wrong body: %s", body)
	}

	res = h.do("GET", "/api/v1/stories", nil)
	expectStatus(t, res, http.StatusOK)
	var index storyIndexResponse
	decode(t, res, &index)
	if len(index.Stories) != 1 {
		t.Fatalf("index = %+v", index)
	}
	e := index.Stories[0]
	if e.Name != "Lighthouse" || e.PassageCount != 1 || e.LastClient != "mira" || e.Deleted {
		t.Fatalf("index entry = %+v", e)
	}

	if got := h.notify.all(); len(got) != 1 || got[0] != "story story-1 1 mira" {
		t.Fatalf("notifications = %v", got)
	}
}

func TestGetStoryHonoursIfNoneMatch(t *testing.T) {
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one")), http.StatusOK)

	res := h.do("GET", "/api/v1/stories/story-1", nil, "If-None-Match", `"1"`)
	if res.StatusCode != http.StatusNotModified {
		t.Fatalf("status %d, want 304", res.StatusCode)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if len(body) != 0 {
		t.Fatalf("304 carried a body: %s", body)
	}

	// A stale tag is a real answer again.
	res = h.do("GET", "/api/v1/stories/story-1", nil, "If-None-Match", `"0"`)
	expectStatus(t, res, http.StatusOK)
	res.Body.Close()
}

func TestPutStoryStaleIfMatchIs412(t *testing.T) {
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one")), http.StatusOK)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "two")), http.StatusOK)

	res := h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "three"), "If-Match", `"1"`)
	if res.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("status %d, want 412", res.StatusCode)
	}
	var body errorBody
	decode(t, res, &body)
	if body.Error.Code != codeConflict {
		t.Fatalf("code = %q", body.Error.Code)
	}
	// The banner needs to be able to say who won and when.
	if body.Rev == nil || *body.Rev != 2 || body.LastClient != "mira" || body.UpdatedAt == "" {
		t.Fatalf("412 body = %+v", body)
	}

	// Nothing was written.
	res = h.do("GET", "/api/v1/stories/story-1", nil)
	expectStatus(t, res, http.StatusOK)
	got, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !bytes.Contains(got, []byte("two")) {
		t.Fatalf("rejected write landed: %s", got)
	}

	// A current If-Match is accepted.
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "three"), "If-Match", `"2"`), http.StatusOK)
}

func TestDeleteTombstonesAndReviveContinuesTheChain(t *testing.T) {
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one")), http.StatusOK)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "two")), http.StatusOK)
	expectStatus(t, h.do("DELETE", "/api/v1/stories/story-1", nil), http.StatusOK)

	// The tombstone is in the index, flagged, so an editor holding the story learns it
	// went away.
	res := h.do("GET", "/api/v1/stories", nil)
	var index storyIndexResponse
	decode(t, res, &index)
	if len(index.Stories) != 1 || !index.Stories[0].Deleted {
		t.Fatalf("index = %+v", index)
	}

	expectError(t, h.do("GET", "/api/v1/stories/story-1", nil), http.StatusGone, codeDeleted)
	expectError(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "three")), http.StatusConflict, codeDeleted)

	res = h.do("PUT", "/api/v1/stories/story-1?revive=1", storyPayload("Lighthouse", "three"))
	expectStatus(t, res, http.StatusOK)
	var put store.PutResult
	decode(t, res, &put)
	if put.Rev != 3 {
		t.Fatalf("revive restarted the chain at rev %d", put.Rev)
	}

	events := h.notify.all()
	if events[len(events)-1] != "revived story-1 3 mira" {
		t.Fatalf("revive was not announced: %v", events)
	}
	if events[2] != "deleted story-1 mira" {
		t.Fatalf("delete was not announced: %v", events)
	}
}

func TestPurgeRemovesTheDirectory(t *testing.T) {
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one")), http.StatusOK)
	expectStatus(t, h.do("DELETE", "/api/v1/stories/story-1?purge=1", nil), http.StatusOK)

	if _, err := os.Stat(filepath.Join(h.dir, "stories", "story-1")); !os.IsNotExist(err) {
		t.Fatalf("purged directory survived: %v", err)
	}
	expectError(t, h.do("GET", "/api/v1/stories/story-1", nil), http.StatusNotFound, codeNotFound)
}

func TestMissingStoryIs404(t *testing.T) {
	h := newHarness(t, nil)
	expectError(t, h.do("GET", "/api/v1/stories/nope", nil), http.StatusNotFound, codeNotFound)
	expectError(t, h.do("GET", "/api/v1/stories/nope/revisions", nil), http.StatusNotFound, codeNotFound)
	expectError(t, h.do("GET", "/api/v1/stories/nope/assets", nil), http.StatusNotFound, codeNotFound)
}

func TestHTMLFormatIsNotImplemented(t *testing.T) {
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one")), http.StatusOK)
	res := h.do("GET", "/api/v1/stories/story-1?format=html", nil)
	if res.StatusCode != http.StatusNotImplemented {
		t.Fatalf("status %d, want 501", res.StatusCode)
	}
	res.Body.Close()
}

func TestOversizedStoryIs413(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.MaxStoryBytes = 512 })

	big := strings.Repeat("x", 4096)
	expectError(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", big)), http.StatusRequestEntityTooLarge, codeTooLarge)

	// And the story was not created by the attempt.
	expectError(t, h.do("GET", "/api/v1/stories/story-1", nil), http.StatusNotFound, codeNotFound)
}

// ---------------------------------------------------------------------------
// Revisions
// ---------------------------------------------------------------------------

func TestRevisionsAndRestore(t *testing.T) {
	h := newHarness(t, nil)
	for _, text := range []string{"one", "two", "three"} {
		expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", text)), http.StatusOK)
	}

	res := h.do("GET", "/api/v1/stories/story-1/revisions", nil)
	expectStatus(t, res, http.StatusOK)
	var revs store.Revisions
	decode(t, res, &revs)
	if revs.Current != 3 {
		t.Fatalf("current = %d", revs.Current)
	}
	if len(revs.Revisions) != 2 {
		t.Fatalf("revisions = %+v", revs.Revisions)
	}
	if revs.Revisions[0].Rev != 2 {
		t.Fatal("revisions are not newest first")
	}
	if revs.Revisions[0].Client != "mira" || revs.Revisions[0].Passages != 1 || revs.Revisions[0].Hash == "" {
		t.Fatalf("revision row = %+v", revs.Revisions[0])
	}

	res = h.do("GET", "/api/v1/stories/story-1/revisions/1", nil)
	expectStatus(t, res, http.StatusOK)
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !bytes.Contains(body, []byte("one")) {
		t.Fatalf("rev 1 body = %s", body)
	}

	res = h.do("GET", "/api/v1/stories/story-1/revisions/1/assets", nil)
	expectStatus(t, res, http.StatusOK)
	var man store.Manifest
	decode(t, res, &man)
	if man.Assets == nil || man.Missing == nil {
		t.Fatalf("revision manifest = %+v", man)
	}

	res = h.do("POST", "/api/v1/stories/story-1/restore", []byte(`{"rev":1}`))
	expectStatus(t, res, http.StatusOK)
	var restored store.RestoreResult
	decode(t, res, &restored)
	if restored.Rev != 4 || restored.RestoredFrom != 1 {
		t.Fatalf("restore = %+v", restored)
	}
	if restored.MissingAssets == nil {
		t.Fatal("missingAssets must be a list, even an empty one")
	}

	res = h.do("GET", "/api/v1/stories/story-1", nil)
	body, _ = io.ReadAll(res.Body)
	res.Body.Close()
	if !bytes.Contains(body, []byte("one")) {
		t.Fatalf("restore did not take: %s", body)
	}

	expectError(t, h.do("POST", "/api/v1/stories/story-1/restore", []byte(`{}`)), http.StatusBadRequest, codeBadRequest)
	expectError(t, h.do("POST", "/api/v1/stories/story-1/restore", []byte(`{"rev":99}`)), http.StatusNotFound, codeNotFound)
	expectError(t, h.do("GET", "/api/v1/stories/story-1/revisions/nope", nil), http.StatusBadRequest, codeBadRequest)
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

func TestAssetLifecycle(t *testing.T) {
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one")), http.StatusOK)

	// Manifest first so the mime is known; the blob follows.
	res := h.do("PUT", "/api/v1/stories/story-1/assets", manifestPayload("a1"))
	expectStatus(t, res, http.StatusOK)
	var man store.Manifest
	decode(t, res, &man)
	if man.Rev != 1 || len(man.Missing) != 1 {
		t.Fatalf("manifest = %+v", man)
	}

	blob := []byte("some webp bytes")
	res = h.do("PUT", "/api/v1/stories/story-1/assets/a1", blob, "X-Asset-Hash", sha(blob), "Content-Type", "image/webp")
	expectStatus(t, res, http.StatusOK)
	var uploaded putAssetResponse
	decode(t, res, &uploaded)
	if uploaded.Bytes != int64(len(blob)) {
		t.Fatalf("upload = %+v", uploaded)
	}

	res = h.do("HEAD", "/api/v1/stories/story-1/assets/a1", nil)
	expectStatus(t, res, http.StatusOK)
	res.Body.Close()
	if res.ContentLength != int64(len(blob)) {
		t.Fatalf("HEAD content-length = %d", res.ContentLength)
	}
	if res.Header.Get("ETag") != `"`+sha([]byte("a1"))+`"` {
		t.Fatalf("HEAD etag = %q", res.Header.Get("ETag"))
	}

	res = h.do("GET", "/api/v1/stories/story-1/assets/a1", nil)
	expectStatus(t, res, http.StatusOK)
	got, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if !bytes.Equal(got, blob) {
		t.Fatalf("GET returned %q", got)
	}

	res = h.do("GET", "/api/v1/stories/story-1/assets", nil)
	expectStatus(t, res, http.StatusOK)
	decode(t, res, &man)
	if len(man.Missing) != 0 {
		t.Fatalf("missing after upload = %v", man.Missing)
	}

	res = h.do("POST", "/api/v1/stories/story-1/assets/diff", []byte(fmt.Sprintf(
		`{"assets":[{"id":"a1","hash":%q,"bytes":1},{"id":"a2","hash":"ff","bytes":1}]}`, sha([]byte("a1")))))
	expectStatus(t, res, http.StatusOK)
	var diff store.DiffResult
	decode(t, res, &diff)
	if len(diff.Present) != 1 || diff.Present[0] != "a1" || len(diff.Missing) != 1 || diff.Missing[0] != "a2" {
		t.Fatalf("diff = %+v", diff)
	}

	expectStatus(t, h.do("DELETE", "/api/v1/stories/story-1/assets/a1", nil), http.StatusOK)
	expectError(t, h.do("GET", "/api/v1/stories/story-1/assets/a1", nil), http.StatusNotFound, codeNotFound)
}

func TestManifestIfNoneMatchAndIfMatch(t *testing.T) {
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one")), http.StatusOK)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1/assets", manifestPayload("a1")), http.StatusOK)

	res := h.do("GET", "/api/v1/stories/story-1/assets", nil, "If-None-Match", `"1"`)
	if res.StatusCode != http.StatusNotModified {
		t.Fatalf("status %d, want 304", res.StatusCode)
	}
	res.Body.Close()

	res = h.do("PUT", "/api/v1/stories/story-1/assets", manifestPayload("a1", "a2"), "If-Match", `"0"`)
	if res.StatusCode != http.StatusPreconditionFailed {
		t.Fatalf("status %d, want 412", res.StatusCode)
	}
	res.Body.Close()

	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1/assets", manifestPayload("a1", "a2"), "If-Match", `"1"`), http.StatusOK)
}

func TestAssetHashMismatchIs422(t *testing.T) {
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one")), http.StatusOK)

	blob := []byte("the real bytes")
	expectError(t,
		h.do("PUT", "/api/v1/stories/story-1/assets/a1", blob, "X-Asset-Hash", sha([]byte("different"))),
		http.StatusUnprocessableEntity, codeHashMismatch)

	// A truncated or wrong upload must not be visible afterwards. HEAD has no body to
	// carry the error code, so this checks the status alone.
	head := h.do("HEAD", "/api/v1/stories/story-1/assets/a1", nil)
	head.Body.Close()
	if head.StatusCode != http.StatusNotFound {
		t.Fatalf("HEAD after a rejected upload: %d, want 404", head.StatusCode)
	}

	// And the header is required at all.
	expectError(t, h.do("PUT", "/api/v1/stories/story-1/assets/a1", blob), http.StatusBadRequest, codeBadRequest)
}

func TestOversizedAssetIs413(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.MaxAssetBytes = 64 })
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one")), http.StatusOK)

	blob := bytes.Repeat([]byte("x"), 4096)
	expectError(t,
		h.do("PUT", "/api/v1/stories/story-1/assets/a1", blob, "X-Asset-Hash", sha(blob)),
		http.StatusRequestEntityTooLarge, codeTooLarge)

	if entries, err := os.ReadDir(filepath.Join(h.dir, "stories", "story-1", "assets")); err == nil && len(entries) != 0 {
		t.Fatalf("oversized upload left files behind: %v", entries)
	}
}

func TestAssetsOfTombstoneAreGone(t *testing.T) {
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one")), http.StatusOK)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1/assets", manifestPayload("a1")), http.StatusOK)
	expectStatus(t, h.do("DELETE", "/api/v1/stories/story-1", nil), http.StatusOK)

	expectError(t, h.do("GET", "/api/v1/stories/story-1/assets", nil), http.StatusGone, codeDeleted)
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

// TestConcurrentPutsGetUniqueRevs is the test that justifies the per-story mutex: 50
// writers, no If-Match, last write wins — but no two of them may be told they are the
// same rev, and the history must still parse afterwards.
func TestConcurrentPutsGetUniqueRevs(t *testing.T) {
	h := newHarness(t, nil)

	const writers = 50
	var wg sync.WaitGroup
	revs := make([]int, writers)
	bodies := make([]string, writers)

	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			text := "take " + strconv.Itoa(i)
			bodies[i] = text
			res := h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", text))
			if res.StatusCode != http.StatusOK {
				body, _ := io.ReadAll(res.Body)
				res.Body.Close()
				t.Errorf("writer %d: status %d %s", i, res.StatusCode, body)
				return
			}
			var put store.PutResult
			defer res.Body.Close()
			if err := json.NewDecoder(res.Body).Decode(&put); err != nil {
				t.Errorf("writer %d: %v", i, err)
				return
			}
			revs[i] = put.Rev
		}(i)
	}
	wg.Wait()
	if t.Failed() {
		t.Fatal("a writer failed")
	}

	seen := map[int]bool{}
	for i, rev := range revs {
		if rev < 1 || rev > writers {
			t.Fatalf("writer %d got rev %d", i, rev)
		}
		if seen[rev] {
			t.Fatalf("rev %d was handed out twice", rev)
		}
		seen[rev] = true
	}

	res := h.do("GET", "/api/v1/stories/story-1", nil)
	expectStatus(t, res, http.StatusOK)
	final, _ := io.ReadAll(res.Body)
	res.Body.Close()

	matched := false
	for _, text := range bodies {
		if bytes.Contains(final, []byte(`"`+text+`"`)) {
			matched = true
			break
		}
	}
	if !matched {
		t.Fatalf("final body is not one of the written ones: %s", final)
	}

	if got := res.Header.Get("ETag"); got != `"`+strconv.Itoa(writers)+`"` {
		t.Fatalf("final ETag = %q, want %q", got, strconv.Itoa(writers))
	}

	index, err := os.ReadFile(filepath.Join(h.dir, "stories", "story-1", "revs", "index.json"))
	if err != nil {
		t.Fatalf("index.json: %v", err)
	}
	var parsed []store.RevisionEntry
	if err := json.Unmarshal(index, &parsed); err != nil {
		t.Fatalf("index.json does not parse: %v\n%s", err, index)
	}
	if len(parsed) != 20 {
		t.Fatalf("index has %d entries, want REV_KEEP=20", len(parsed))
	}
}
