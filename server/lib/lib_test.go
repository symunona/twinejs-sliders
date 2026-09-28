package lib

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
	"reflect"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"
)

type fakeNotifier struct {
	mu      sync.Mutex
	changes []Change
	except  []string
}

func (f *fakeNotifier) LibChanged(c Change, except string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.changes = append(f.changes, c)
	f.except = append(f.except, except)
}

type fx struct {
	t     *testing.T
	dir   string
	st    *Store
	srv   *httptest.Server
	notes *fakeNotifier
}

func newFx(t *testing.T) *fx {
	t.Helper()
	f := &fx{t: t, dir: t.TempDir(), notes: &fakeNotifier{}}
	f.open()
	return f
}

func (f *fx) open() {
	st, err := Open(Options{Dir: f.dir})
	if err != nil {
		f.t.Fatalf("open: %v", err)
	}
	mux := http.NewServeMux()
	Register(mux, HandlerOptions{Store: st, Notifier: f.notes, MaxBlobBytes: 1024})
	f.st = st
	f.srv = httptest.NewServer(mux)
	f.t.Cleanup(f.close)
}

func (f *fx) close() {
	if f.srv != nil {
		f.srv.Close()
		f.st.Close()
		f.srv = nil
	}
}

func (f *fx) restart() {
	f.close()
	f.open()
}

type resp struct {
	status int
	header http.Header
	raw    []byte
	body   map[string]any
}

func (f *fx) do(method, path string, body any, hdr ...string) resp {
	f.t.Helper()
	var rd io.Reader
	switch b := body.(type) {
	case nil:
	case []byte:
		rd = bytes.NewReader(b)
	case string:
		rd = strings.NewReader(b)
	default:
		data, _ := json.Marshal(b)
		rd = bytes.NewReader(data)
	}
	req, _ := http.NewRequest(method, f.srv.URL+Prefix+path, rd)
	req.Header.Set("X-Client-Name", "ana")
	req.Header.Set("X-Client-Id", "tab-1")
	for i := 0; i+1 < len(hdr); i += 2 {
		req.Header.Set(hdr[i], hdr[i+1])
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		f.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	r := resp{status: res.StatusCode, header: res.Header, raw: raw}
	_ = json.Unmarshal(raw, &r.body)
	return r
}

func (f *fx) want(r resp, status int, code string) resp {
	f.t.Helper()
	if r.status != status {
		f.t.Fatalf("status %d, want %d: %s", r.status, status, r.raw)
	}
	if code != "" && r.body["error"] != code {
		f.t.Fatalf("error %v, want %q: %s", r.body["error"], code, r.raw)
	}
	return r
}

var idN int

func uuid() string {
	idN++
	return fmt.Sprintf("00000000-0000-4000-8000-%012d", idN)
}

func sha(data string) string {
	s := sha256.Sum256([]byte(data))
	return hex.EncodeToString(s[:])
}

func ifMatch(rev int) []string { return []string{"If-Match", `"` + strconv.Itoa(rev) + `"`} }

var create = []string{"If-None-Match", "*"}

func (f *fx) create(path string, body map[string]any) map[string]any {
	f.t.Helper()
	r := f.want(f.do("PUT", path, body, create...), 200, "")
	return r.body["record"].(map[string]any)
}

func (f *fx) collection(name string) string {
	id := uuid()
	f.create("/collections/"+id, map[string]any{"name": name, "kind": "shared"})
	return id
}

func (f *fx) blob(data string) string {
	s := sha(data)
	f.want(f.do("PUT", "/blobs/"+s, data, "Content-Type", "image/png"), 200, "")
	return s
}

func (f *fx) asset(coll, name string) (string, map[string]any) {
	id := uuid()
	rec := f.create("/assets/"+id, map[string]any{"collection": coll, "name": name, "blob": f.blob("bytes-" + name)})
	return id, rec
}

func rev(rec map[string]any) int { return int(rec["rev"].(float64)) }

// ---------------------------------------------------------------------------

func TestBlobPutGetHasHead(t *testing.T) {
	f := newFx(t)
	s := sha("hello")

	r := f.want(f.do("POST", "/blobs/has", map[string]any{"hashes": []string{s}}), 200, "")
	if !reflect.DeepEqual(r.body["missing"], []any{s}) {
		t.Fatalf("missing = %v", r.body["missing"])
	}

	r = f.want(f.do("PUT", "/blobs/"+s, "hello", "Content-Type", "text/plain"), 200, "")
	if r.body["sha"] != s || r.body["bytes"] != float64(5) || r.body["mime"] != "text/plain" {
		t.Fatalf("put = %s", r.raw)
	}
	r = f.want(f.do("POST", "/blobs/has", map[string]any{"hashes": []string{s}}), 200, "")
	if len(r.body["missing"].([]any)) != 0 {
		t.Fatalf("still missing: %s", r.raw)
	}

	r = f.want(f.do("GET", "/blobs/"+s, nil), 200, "")
	if string(r.raw) != "hello" || r.header.Get("ETag") != `"`+s+`"` ||
		r.header.Get("Cache-Control") != "private, max-age=31536000, immutable" ||
		r.header.Get("Content-Type") != "text/plain" {
		t.Fatalf("get: %q %v", r.raw, r.header)
	}
	r = f.want(f.do("GET", "/blobs/"+s, nil, "Range", "bytes=1-2"), 206, "")
	if string(r.raw) != "el" {
		t.Fatalf("range = %q", r.raw)
	}
	r = f.want(f.do("HEAD", "/blobs/"+s, nil), 200, "")
	if r.header.Get("Content-Length") != "5" {
		t.Fatalf("head: %v", r.header)
	}
	f.want(f.do("GET", "/blobs/"+sha("nope"), nil), 404, "not-found")
}

func TestBlobIdempotent(t *testing.T) {
	f := newFx(t)
	s := sha("x")
	a := f.want(f.do("PUT", "/blobs/"+s, "x", "Content-Type", "image/png"), 200, "")
	b := f.want(f.do("PUT", "/blobs/"+s, "x", "Content-Type", "image/webp"), 200, "")
	if !reflect.DeepEqual(a.body, b.body) {
		t.Fatalf("second put %s != first %s", b.raw, a.raw)
	}
}

func TestBlobHashMismatch422(t *testing.T) {
	f := newFx(t)
	s := sha("expected")
	f.want(f.do("PUT", "/blobs/"+s, "other"), 422, "hash-mismatch")
	if f.st.HasBlob(s) {
		t.Fatal("mismatched blob was stored")
	}
	f.want(f.do("PUT", "/blobs/NOTASHA", "x"), 400, "bad-request")
}

func TestBlobTooLarge413(t *testing.T) {
	f := newFx(t)
	big := strings.Repeat("a", 2000)
	f.want(f.do("PUT", "/blobs/"+sha(big), big), 413, "too-large")
	if f.st.HasBlob(sha(big)) {
		t.Fatal("oversize blob stored")
	}
}

func TestRecordLifecycleAndSocket(t *testing.T) {
	f := newFx(t)
	coll := f.collection("Forest")
	id, rec := f.asset(coll, "tree")
	if rev(rec) != 1 || rec["by"] != "ana" || rec["deleted"] != false || rec["type"] != "asset" || rec["id"] != id {
		t.Fatalf("created = %v", rec)
	}
	if _, err := time.Parse(time.RFC3339, rec["at"].(string)); err != nil {
		t.Fatalf("at: %v", err)
	}

	g := f.want(f.do("GET", "/assets/"+id, nil), 200, "")
	if g.header.Get("ETag") != `"1"` || g.body["name"] != "tree" {
		t.Fatalf("get: %s", g.raw)
	}
	f.want(f.do("GET", "/assets/"+uuid(), nil), 404, "not-found")

	// Client-sent server fields are ignored.
	body := map[string]any{"collection": coll, "name": "oak", "blob": rec["blob"], "rev": 99, "by": "evil", "at": "x"}
	r := f.want(f.do("PUT", "/assets/"+id, body, append(ifMatch(1), "X-Client-Name", "bo")...), 200, "")
	up := r.body["record"].(map[string]any)
	if rev(up) != 2 || up["by"] != "bo" || up["name"] != "oak" {
		t.Fatalf("update = %v", up)
	}
	seq := r.body["seq"].(float64)

	f.notes.mu.Lock()
	last := f.notes.changes[len(f.notes.changes)-1]
	except := f.notes.except[len(f.notes.except)-1]
	f.notes.mu.Unlock()
	if last != (Change{Seq: int64(seq), Type: "asset", ID: id, Rev: 2, By: "bo"}) || except != "tab-1" {
		t.Fatalf("notified %+v except %q, want seq %v", last, except, seq)
	}

	d := f.want(f.do("DELETE", "/assets/"+id, nil, ifMatch(2)...), 200, "")
	dr := d.body["record"].(map[string]any)
	if dr["deleted"] != true || rev(dr) != 3 || dr["name"] != "oak" {
		t.Fatalf("delete = %v", dr)
	}
	g = f.want(f.do("GET", "/assets/"+id, nil), 200, "")
	if g.body["deleted"] != true {
		t.Fatalf("tombstone get = %s", g.raw)
	}

	// Restore.
	body["deleted"] = false
	r = f.want(f.do("PUT", "/assets/"+id, body, ifMatch(3)...), 200, "")
	if r.body["record"].(map[string]any)["deleted"] != false {
		t.Fatalf("restore = %s", r.raw)
	}
}

func TestPreconditions(t *testing.T) {
	f := newFx(t)
	coll := f.collection("A")
	body := map[string]any{"name": "A", "kind": "story"}

	f.want(f.do("PUT", "/collections/"+coll, body), 428, "precondition-required")
	f.want(f.do("DELETE", "/collections/"+coll, nil), 428, "precondition-required")

	r := f.want(f.do("PUT", "/collections/"+coll, body, create...), 412, "stale")
	if cur := r.body["current"].(map[string]any); cur["id"] != coll || rev(cur) != 1 {
		t.Fatalf("current = %v", cur)
	}
	r = f.want(f.do("PUT", "/collections/"+coll, body, ifMatch(7)...), 412, "stale")
	if rev(r.body["current"].(map[string]any)) != 1 {
		t.Fatalf("current = %s", r.raw)
	}
	f.want(f.do("DELETE", "/collections/"+coll, nil, ifMatch(7)...), 412, "stale")
	// If-Match on an unknown id: stale with current null.
	r = f.want(f.do("PUT", "/collections/"+uuid(), body, ifMatch(1)...), 412, "stale")
	if v, ok := r.body["current"]; !ok || v != nil {
		t.Fatalf("current = %s", r.raw)
	}
	f.want(f.do("PUT", "/collections/"+coll, body, "If-Match", "abc"), 400, "bad-record")
}

func TestShapeErrors(t *testing.T) {
	f := newFx(t)
	coll := f.collection("A")
	blob := f.blob("b")
	cases := []struct {
		path string
		body any
	}{
		{"/collections/" + uuid(), map[string]any{"name": "x", "kind": "weird"}},
		{"/collections/" + uuid(), map[string]any{"kind": "shared"}},
		{"/collections/not-a-uuid", map[string]any{"name": "y", "kind": "shared"}},
		{"/collections/" + uuid(), "[1,2]"},
		{"/collections/" + uuid(), map[string]any{"name": "z", "kind": "shared", "type": "asset"}},
		{"/collections/" + uuid(), map[string]any{"name": "z", "kind": "shared", "id": uuid()}},
		{"/assets/" + uuid(), map[string]any{"collection": coll, "name": "n", "blob": "short"}},
		{"/assets/" + uuid(), map[string]any{"collection": coll, "name": "n", "blob": blob, "sidecars": []string{"x"}}},
		{"/characters/" + uuid(), map[string]any{"collection": coll}},
		{"/bindings/" + "story-1", map[string]any{}},
	}
	for _, c := range cases {
		f.want(f.do("PUT", c.path, c.body, create...), 400, "bad-record")
	}
}

func TestNamespace(t *testing.T) {
	f := newFx(t)
	a := f.collection("A")
	b := f.collection("B")
	assetID, _ := f.asset(a, "hero")

	// Character charId clashes with asset name in the same collection.
	r := f.want(f.do("PUT", "/characters/"+uuid(), map[string]any{"collection": a, "charId": "hero"}, create...), 409, "name-taken")
	if h := r.body["holder"].(map[string]any); h["type"] != "asset" || h["id"] != assetID {
		t.Fatalf("holder = %v", h)
	}
	// Asset name clashes with character charId.
	charID := uuid()
	f.create("/characters/"+charID, map[string]any{"collection": a, "charId": "villain", "poses": []any{"idle"}})
	r = f.want(f.do("PUT", "/assets/"+uuid(), map[string]any{"collection": a, "name": "villain", "blob": f.blob("v")}, create...), 409, "name-taken")
	if h := r.body["holder"].(map[string]any); h["type"] != "character" || h["id"] != charID {
		t.Fatalf("holder = %v", h)
	}
	// Same name in another collection is fine.
	f.asset(b, "hero")
	f.create("/characters/"+uuid(), map[string]any{"collection": b, "charId": "villain"})

	// Deleted records free their names.
	f.want(f.do("DELETE", "/assets/"+assetID, nil, ifMatch(1)...), 200, "")
	f.asset(a, "hero")
	// ...and restoring the tombstone now clashes.
	tomb := f.st.Get("asset", assetID)
	var body map[string]any
	data, _ := json.Marshal(tomb)
	_ = json.Unmarshal(data, &body)
	body["deleted"] = false
	f.want(f.do("PUT", "/assets/"+assetID, body, ifMatch(2)...), 409, "name-taken")

	// Renaming onto yourself is not a clash.
	f.want(f.do("PUT", "/characters/"+charID, map[string]any{"collection": a, "charId": "villain", "x": 1}, ifMatch(1)...), 200, "")
}

func TestCollectionNameTaken(t *testing.T) {
	f := newFx(t)
	a := f.collection("Forest")
	r := f.want(f.do("PUT", "/collections/"+uuid(), map[string]any{"name": "Forest", "kind": "story"}, create...), 409, "collection-name-taken")
	if h := r.body["holder"].(map[string]any); h["id"] != a || h["type"] != "collection" {
		t.Fatalf("holder = %v", h)
	}
	f.want(f.do("DELETE", "/collections/"+a, nil, ifMatch(1)...), 200, "")
	f.collection("Forest")
}

func TestCollectionMissingAndBlobMissing(t *testing.T) {
	f := newFx(t)
	f.want(f.do("PUT", "/assets/"+uuid(), map[string]any{"collection": uuid(), "name": "n", "blob": f.blob("q")}, create...), 409, "collection-missing")
	f.want(f.do("PUT", "/characters/"+uuid(), map[string]any{"collection": uuid(), "charId": "n"}, create...), 409, "collection-missing")
	f.want(f.do("PUT", "/bindings/story-1", map[string]any{"own": uuid()}, create...), 409, "collection-missing")

	c := f.collection("C")
	d := f.collection("D")
	f.want(f.do("DELETE", "/collections/"+d, nil, ifMatch(1)...), 200, "")
	f.want(f.do("PUT", "/assets/"+uuid(), map[string]any{"collection": d, "name": "n", "blob": f.blob("q")}, create...), 409, "collection-missing")

	m1, m2 := sha("m1"), sha("m2")
	have := f.blob("have")
	r := f.want(f.do("PUT", "/assets/"+uuid(), map[string]any{
		"collection": c, "name": "n", "blob": m1, "sidecars": map[string]any{"thumb": m2, "alpha": have},
	}, create...), 409, "blob-missing")
	want := []any{m1, m2}
	if m2 < m1 {
		want = []any{m2, m1}
	}
	if !reflect.DeepEqual(r.body["missing"], want) {
		t.Fatalf("missing = %v, want %v", r.body["missing"], want)
	}
}

func TestValidationOrder(t *testing.T) {
	f := newFx(t)
	c := f.collection("C")
	f.asset(c, "dup")
	// Name clash and missing blob together → name-taken (namespace before blobs).
	f.want(f.do("PUT", "/assets/"+uuid(), map[string]any{"collection": c, "name": "dup", "blob": sha("absent")}, create...), 409, "name-taken")
	// Bad shape and missing collection → bad-record.
	f.want(f.do("PUT", "/assets/"+uuid(), map[string]any{"collection": uuid(), "name": ""}, create...), 400, "bad-record")
	// Stale beats bad shape.
	f.want(f.do("PUT", "/collections/"+c, map[string]any{"kind": "nope"}, ifMatch(9)...), 412, "stale")
}

func TestCollectionNotEmpty(t *testing.T) {
	f := newFx(t)
	c := f.collection("C")
	id, _ := f.asset(c, "a")
	r := f.want(f.do("DELETE", "/collections/"+c, nil, ifMatch(1)...), 409, "collection-not-empty")
	if r.body["count"] != float64(1) {
		t.Fatalf("count = %s", r.raw)
	}
	f.want(f.do("DELETE", "/assets/"+id, nil, ifMatch(1)...), 200, "")

	// Bound by a binding (own).
	f.create("/bindings/story-1", map[string]any{"own": c, "collections": []any{c}, "refs": []any{}})
	f.want(f.do("DELETE", "/collections/"+c, nil, ifMatch(1)...), 409, "collection-not-empty")
	// PUT deleted:true is a delete and follows the same rule.
	f.want(f.do("PUT", "/collections/"+c, map[string]any{"name": "C", "kind": "shared", "deleted": true}, ifMatch(1)...), 409, "collection-not-empty")
	// Bound only via `collections`.
	other := f.collection("O")
	f.create("/bindings/story-2", map[string]any{"own": other, "collections": []any{other, c}})
	f.want(f.do("DELETE", "/bindings/story-1", nil, ifMatch(1)...), 200, "")
	f.want(f.do("DELETE", "/collections/"+c, nil, ifMatch(1)...), 409, "collection-not-empty")
	f.want(f.do("DELETE", "/bindings/story-2", nil, ifMatch(1)...), 200, "")
	f.want(f.do("DELETE", "/collections/"+c, nil, ifMatch(1)...), 200, "")
}

func TestConcurrentPutsSameIfMatch(t *testing.T) {
	f := newFx(t)
	c := f.collection("C")
	const n = 20
	var wg sync.WaitGroup
	codes := make([]int, n)
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			r := f.do("PUT", "/collections/"+c, map[string]any{"name": "C", "kind": "shared", "i": i}, ifMatch(1)...)
			codes[i] = r.status
		}(i)
	}
	wg.Wait()
	ok, stale := 0, 0
	for _, s := range codes {
		switch s {
		case 200:
			ok++
		case 412:
			stale++
		}
	}
	if ok != 1 || stale != n-1 {
		t.Fatalf("codes = %v", codes)
	}
}

func TestUnknownFieldsRoundTrip(t *testing.T) {
	f := newFx(t)
	c := f.collection("C")
	id := uuid()
	raw := `{"collection":"` + c + `","name":"n","blob":"` + f.blob("u") + `","recipe":{"z":1,"a":[1.50,2e3,{"deep":null}]},"big":12345678901234567890,"future":"yes"}`
	f.want(f.do("PUT", "/assets/"+id, raw, create...), 200, "")
	for _, restart := range []bool{false, true} {
		if restart {
			f.restart()
		}
		r := f.want(f.do("GET", "/assets/"+id, nil), 200, "")
		for _, want := range []string{`"big":12345678901234567890`, `"future":"yes"`, `"recipe":{"z":1,"a":[1.50,2e3,{"deep":null}]}`} {
			if !bytes.Contains(r.raw, []byte(want)) {
				t.Fatalf("restart=%v: %s missing from %s", restart, want, r.raw)
			}
		}
	}
}

func TestChangesPagination(t *testing.T) {
	f := newFx(t)
	c := f.collection("C") // seq 1
	var ids []string
	for i := 0; i < 5; i++ { // seq 2..6
		id, _ := f.asset(c, "a"+strconv.Itoa(i))
		ids = append(ids, id)
	}
	// Update asset 0 → it moves to seq 7; seq 2 is superseded.
	cur := f.st.Get("asset", ids[0])
	var body map[string]any
	data, _ := json.Marshal(cur)
	_ = json.Unmarshal(data, &body)
	body["tags"] = []any{"x"}
	f.want(f.do("PUT", "/assets/"+ids[0], body, ifMatch(1)...), 200, "")

	var seen []float64
	var recIDs []any
	since := 0.0
	pages := 0
	for {
		r := f.want(f.do("GET", "/changes?since="+strconv.Itoa(int(since))+"&limit=2", nil), 200, "")
		pages++
		items := r.body["items"].([]any)
		for _, it := range items {
			m := it.(map[string]any)
			seen = append(seen, m["seq"].(float64))
			recIDs = append(recIDs, m["record"].(map[string]any)["id"])
		}
		since = r.body["seq"].(float64)
		if !r.body["more"].(bool) {
			break
		}
		if len(items) != 2 {
			t.Fatalf("page with more has %d items", len(items))
		}
	}
	if !reflect.DeepEqual(seen, []float64{1, 3, 4, 5, 6, 7}) || pages != 3 {
		t.Fatalf("seqs %v in %d pages", seen, pages)
	}
	if recIDs[5] != ids[0] {
		t.Fatalf("last item %v, want %s", recIDs[5], ids[0])
	}
	// Caught up: empty items, seq = head.
	r := f.want(f.do("GET", "/changes?since=7", nil), 200, "")
	if len(r.body["items"].([]any)) != 0 || r.body["seq"] != float64(7) || r.body["more"] != false {
		t.Fatalf("caught up = %s", r.raw)
	}
	f.want(f.do("GET", "/changes?limit=abc", nil), 400, "bad-request")
}

func TestSeqSurvivesRestart(t *testing.T) {
	f := newFx(t)
	c := f.collection("C")
	f.asset(c, "a")
	f.restart()
	if f.st.Head() != 2 {
		t.Fatalf("head after restart = %d", f.st.Head())
	}
	_, _ = f.asset(c, "b")
	r := f.want(f.do("GET", "/changes?since=2", nil), 200, "")
	if items := r.body["items"].([]any); len(items) != 1 || items[0].(map[string]any)["seq"] != float64(3) {
		t.Fatalf("after restart: %s", r.raw)
	}
}

func TestTornFeedAndMissingFeedLine(t *testing.T) {
	f := newFx(t)
	c := f.collection("C")
	id, _ := f.asset(c, "a")
	f.close()

	// Simulate a crash: the last feed line (asset rev 1) half-written.
	path := filepath.Join(f.dir, "feed.jsonl")
	data, _ := os.ReadFile(path)
	lines := bytes.SplitAfter(data, []byte("\n"))
	torn := append(append([]byte{}, lines[0]...), lines[1][:5]...)
	if err := os.WriteFile(path, torn, 0o644); err != nil {
		t.Fatal(err)
	}
	f.open()
	// Reconcile re-announces the asset at seq 2.
	r := f.want(f.do("GET", "/changes?since=1", nil), 200, "")
	items := r.body["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["record"].(map[string]any)["id"] != id || items[0].(map[string]any)["seq"] != float64(2) {
		t.Fatalf("after torn feed: %s", r.raw)
	}
}

func TestRevsNewestFirstCapped(t *testing.T) {
	f := newFx(t)
	c := f.collection("C")
	for i := 1; i <= 55; i++ {
		f.want(f.do("PUT", "/collections/"+c, map[string]any{"name": "C", "kind": "shared", "n": i}, ifMatch(i)...), 200, "")
	}
	r := f.want(f.do("GET", "/collections/"+c+"/revs", nil), 200, "")
	revs := r.body["revs"].([]any)
	if len(revs) != 50 {
		t.Fatalf("%d revs", len(revs))
	}
	first, last := revs[0].(map[string]any), revs[49].(map[string]any)
	if first["rev"] != float64(56) || last["rev"] != float64(7) || first["by"] != "ana" || first["at"] == nil {
		t.Fatalf("first %v last %v", first["rev"], last["rev"])
	}
	if first["record"].(map[string]any)["n"] != float64(55) {
		t.Fatalf("record = %v", first["record"])
	}
	files, _ := os.ReadDir(filepath.Join(f.dir, "revs", "collection", c))
	if len(files) != 50 {
		t.Fatalf("%d rev files on disk", len(files))
	}
	f.want(f.do("GET", "/collections/"+uuid()+"/revs", nil), 404, "not-found")
}

func TestSweepKeepsLiveAndRevBlobs(t *testing.T) {
	f := newFx(t)
	c := f.collection("C")
	oldBlob, side, orphan, young := f.blob("old"), f.blob("side"), f.blob("orphan"), f.blob("young")
	id := uuid()
	f.create("/assets/"+id, map[string]any{"collection": c, "name": "a", "blob": oldBlob})
	newBlob := f.blob("new")
	f.want(f.do("PUT", "/assets/"+id, map[string]any{"collection": c, "name": "a", "blob": newBlob, "sidecars": map[string]any{"thumb": side}}, ifMatch(1)...), 200, "")
	_ = young

	// Age everything but `young`.
	past := time.Now().Add(-10 * 24 * time.Hour)
	for _, s := range []string{oldBlob, side, orphan, newBlob} {
		_ = os.Chtimes(f.st.BlobPath(s), past, past)
	}
	tmp := filepath.Join(filepath.Dir(f.st.BlobPath(orphan)), ".tmp-dead")
	_ = os.WriteFile(tmp, []byte("x"), 0o644)
	_ = os.Chtimes(tmp, past, past)

	res, err := f.st.Sweep(time.Now(), 7*24*time.Hour)
	if err != nil {
		t.Fatal(err)
	}
	if res.Blobs != 1 || res.TempFiles != 1 {
		t.Fatalf("sweep = %+v", res)
	}
	for s, want := range map[string]bool{oldBlob: true, side: true, newBlob: true, young: true, orphan: false} {
		if f.st.HasBlob(s) != want {
			t.Fatalf("blob %s present=%v want %v", s[:8], !want, want)
		}
	}
}
