package store

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func testStore(t *testing.T, tweak func(*Options)) *Store {
	t.Helper()
	opts := Options{
		Dir:          t.TempDir(),
		RevKeep:      20,
		PinnedMax:    50,
		OrphanTTL:    168 * time.Hour,
		TombstoneTTL: 2160 * time.Hour,
	}
	if tweak != nil {
		tweak(&opts)
	}
	s, err := New(opts)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return s
}

// storyBody is the shape the editor actually pushes, trimmed to what the server reads.
func storyBody(name string, passages ...string) []byte {
	list := make([]map[string]any, 0, len(passages))
	for i, text := range passages {
		list = append(list, map[string]any{"id": fmt.Sprintf("p%d", i), "name": fmt.Sprintf("Passage %d", i), "text": text})
	}
	raw, err := json.Marshal(map[string]any{
		"id":       "story-1",
		"ifid":     "IFID-1",
		"name":     name,
		"passages": list,
		"sync":     true,
	})
	if err != nil {
		panic(err)
	}
	return raw
}

var testClient = Client{ID: "c1", Name: "mira"}

func mustPut(t *testing.T, s *Store, id string, body []byte) PutResult {
	t.Helper()
	res, err := s.PutStory(id, body, testClient, PutOptions{})
	if err != nil {
		t.Fatalf("PutStory: %v", err)
	}
	return res
}

func TestPutStoryStripsSyncAndCountsPassages(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "a", "b", "c"))

	body, meta, err := s.GetStory("story-1")
	if err != nil {
		t.Fatalf("GetStory: %v", err)
	}
	if bytes.Contains(body, []byte(`"sync"`)) {
		t.Fatalf("sync survived the write: %s", body)
	}
	if meta.Name != "Lighthouse" || meta.IFID != "IFID-1" {
		t.Fatalf("meta did not pick up name/ifid: %+v", meta)
	}
	if meta.PassageCount != 3 {
		t.Fatalf("passageCount = %d, want 3", meta.PassageCount)
	}
	if meta.LastClient != "mira" {
		t.Fatalf("lastClient = %q", meta.LastClient)
	}
}

func TestUnknownClientNameIsLabelled(t *testing.T) {
	s := testStore(t, nil)
	if _, err := s.PutStory("story-1", storyBody("A"), Client{ID: "x"}, PutOptions{}); err != nil {
		t.Fatal(err)
	}
	meta, err := s.Meta("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if meta.LastClient != "unknown" {
		t.Fatalf("lastClient = %q, want unknown", meta.LastClient)
	}
}

func TestRevIsMonotonic(t *testing.T) {
	s := testStore(t, nil)
	for i := 1; i <= 5; i++ {
		res := mustPut(t, s, "story-1", storyBody("Lighthouse", fmt.Sprintf("take %d", i)))
		if res.Rev != i {
			t.Fatalf("write %d got rev %d", i, res.Rev)
		}
	}
}

func TestIfMatchAcceptsAndRejects(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))

	rev := 1
	if _, err := s.PutStory("story-1", storyBody("Lighthouse", "two"), testClient, PutOptions{IfMatch: &rev}); err != nil {
		t.Fatalf("matching If-Match rejected: %v", err)
	}

	stale := 1
	_, err := s.PutStory("story-1", storyBody("Lighthouse", "three"), Client{Name: "bob"}, PutOptions{IfMatch: &stale})
	var conflict *ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("stale If-Match: got %v, want ConflictError", err)
	}
	if conflict.Rev != 2 || conflict.LastClient != "mira" {
		t.Fatalf("conflict body wrong: %+v", conflict)
	}

	// Nothing written: the body and the rev are still the ones from the accepted write.
	body, meta, err := s.GetStory("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if meta.Rev != 2 {
		t.Fatalf("rev moved on a rejected write: %d", meta.Rev)
	}
	if !bytes.Contains(body, []byte("two")) {
		t.Fatalf("rejected write landed: %s", body)
	}
}

func TestTombstoneReviveKeepsRevChain(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	mustPut(t, s, "story-1", storyBody("Lighthouse", "two"))

	if err := s.DeleteStory("story-1", false, Client{Name: "bob"}); err != nil {
		t.Fatalf("DeleteStory: %v", err)
	}

	meta, err := s.Meta("story-1")
	if err != nil {
		t.Fatalf("tombstone meta gone: %v", err)
	}
	if !meta.Deleted || meta.DeletedAt == "" {
		t.Fatalf("not a tombstone: %+v", meta)
	}
	if _, err := os.Stat(s.storyPath("story-1")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("body survived the tombstone")
	}
	if _, err := os.Stat(s.revsDir("story-1")); err != nil {
		t.Fatalf("history did not survive the tombstone: %v", err)
	}

	// A plain write to a tombstone is refused: the client has a decision to make.
	_, err = s.PutStory("story-1", storyBody("Lighthouse", "three"), testClient, PutOptions{})
	var deleted *DeletedError
	if !errors.As(err, &deleted) {
		t.Fatalf("write to tombstone: got %v, want DeletedError", err)
	}

	res, err := s.PutStory("story-1", storyBody("Lighthouse", "three"), testClient, PutOptions{Revive: true})
	if err != nil {
		t.Fatalf("revive: %v", err)
	}
	if res.Rev != 3 {
		t.Fatalf("revive restarted the chain: rev %d, want 3", res.Rev)
	}
	if !res.Revived {
		t.Fatal("revive was not reported as one")
	}

	meta, err = s.Meta("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if meta.Deleted || meta.DeletedAt != "" {
		t.Fatalf("tombstone not cleared: %+v", meta)
	}

	revs, err := s.Revisions("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(revs.Revisions) == 0 {
		t.Fatal("history from before the delete is gone")
	}
}

func TestPurgeRemovesEverything(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	mustPut(t, s, "story-1", storyBody("Lighthouse", "two"))

	if err := s.DeleteStory("story-1", true, testClient); err != nil {
		t.Fatalf("purge: %v", err)
	}
	if _, err := os.Stat(s.storyDir("story-1")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("directory survived the purge: %v", err)
	}
	if _, err := s.Meta("story-1"); err == nil {
		t.Fatal("purged story still has meta")
	}

	list, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 0 {
		t.Fatalf("purged story still in the index: %+v", list)
	}
}

func TestListIncludesTombstonesFlagged(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	mustPut(t, s, "story-2", storyBody("Harbour", "one"))
	if err := s.DeleteStory("story-2", false, testClient); err != nil {
		t.Fatal(err)
	}

	list, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 {
		t.Fatalf("index has %d entries, want 2", len(list))
	}
	seen := map[string]bool{}
	for _, e := range list {
		seen[e.ID] = e.Deleted
	}
	if seen["story-1"] || !seen["story-2"] {
		t.Fatalf("deleted flags wrong: %+v", seen)
	}
}

// listEntry pulls one story's row out of the index.
func listEntry(t *testing.T, s *Store, id string) IndexEntry {
	t.Helper()
	list, err := s.List()
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range list {
		if e.ID == id {
			return e
		}
	}
	t.Fatalf("%s is not in the index: %+v", id, list)
	return IndexEntry{}
}

func TestListCarriesAssetRev(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	if _, err := s.PutManifest("story-1", manifestJSON(t, "a1", "a2"), nil, testClient); err != nil {
		t.Fatal(err)
	}

	meta, err := s.Meta("story-1")
	if err != nil {
		t.Fatal(err)
	}
	e := listEntry(t, s, "story-1")
	if e.AssetRev != meta.AssetRev {
		t.Fatalf("index assetRev = %d, story's own = %d", e.AssetRev, meta.AssetRev)
	}
	if e.AssetCount != 2 || e.AssetBytes != 8 {
		t.Fatalf("count/bytes = %d/%d, want 2/8", e.AssetCount, e.AssetBytes)
	}

	// The story's own rev is a separate counter and must not leak into this one.
	mustPut(t, s, "story-1", storyBody("Lighthouse", "two"))
	if e := listEntry(t, s, "story-1"); e.AssetRev != meta.AssetRev {
		t.Fatalf("a story write moved the index assetRev to %d", e.AssetRev)
	}
}

// TestListAssetRevMovesOnMetadataOnlyWrite is the bug: a client that watches
// assetCount:assetBytes sleeps through every manifest write that only changes metadata —
// a cutout sidecar, an anchor, an edit's settings — and keeps showing the old art.
func TestListAssetRevMovesOnMetadataOnlyWrite(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	if _, err := s.PutManifest("story-1", manifestSidecarJSON(t, "a1", ""), nil, testClient); err != nil {
		t.Fatal(err)
	}
	before := listEntry(t, s, "story-1")

	if _, err := s.PutManifest("story-1", manifestSidecarJSON(t, "a1", `{"cutout":{"hash":"c0ffee"}}`), nil, testClient); err != nil {
		t.Fatal(err)
	}
	after := listEntry(t, s, "story-1")

	if after.AssetCount != before.AssetCount || after.AssetBytes != before.AssetBytes {
		t.Fatalf("not a metadata-only write: %d/%d then %d/%d",
			before.AssetCount, before.AssetBytes, after.AssetCount, after.AssetBytes)
	}
	if after.AssetRev <= before.AssetRev {
		t.Fatalf("index assetRev %d did not move past %d", after.AssetRev, before.AssetRev)
	}
}

func TestListAssetRevStableWithoutManifest(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))

	// A story published before it had art has no assets.json at all. Whatever the row
	// reports has to be the same on the next poll, or the client reads every poll as
	// "the art moved" and re-pulls a story that has none.
	first := listEntry(t, s, "story-1")
	second := listEntry(t, s, "story-1")
	if first.AssetRev != second.AssetRev {
		t.Fatalf("assetRev drifted with no manifest: %d then %d", first.AssetRev, second.AssetRev)
	}
	if first.AssetCount != 0 || first.AssetBytes != 0 {
		t.Fatalf("count/bytes = %d/%d, want 0/0", first.AssetCount, first.AssetBytes)
	}

	mustPut(t, s, "story-1", storyBody("Lighthouse", "two"))
	if third := listEntry(t, s, "story-1"); third.AssetRev != first.AssetRev {
		t.Fatalf("a story write moved assetRev to %d, want %d", third.AssetRev, first.AssetRev)
	}
}

func TestRevKeepPrunesOldestFirst(t *testing.T) {
	const keep = 5
	s := testStore(t, func(o *Options) { o.RevKeep = keep })

	// keep + 5 distinct bodies: each write after the first snapshots the one before it,
	// so this makes keep+4 snapshots and prunes back to keep.
	for i := 1; i <= keep+5; i++ {
		mustPut(t, s, "story-1", storyBody("Lighthouse", fmt.Sprintf("take %d", i)))
	}

	index, err := s.readRevIndex("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(index) != keep {
		t.Fatalf("index has %d snapshots, want %d", len(index), keep)
	}
	// Snapshots run 1..(writes-1); the newest keep of those survive.
	wantOldest := (keep + 5 - 1) - keep + 1
	if index[0].Rev != wantOldest {
		t.Fatalf("oldest surviving rev is %d, want %d", index[0].Rev, wantOldest)
	}
	if index[len(index)-1].Rev != keep+4 {
		t.Fatalf("newest surviving rev is %d, want %d", index[len(index)-1].Rev, keep+4)
	}

	files, err := filepath.Glob(filepath.Join(s.revsDir("story-1"), "*.json.gz"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != keep {
		t.Fatalf("%d snapshot files on disk, want %d", len(files), keep)
	}
	for _, e := range index {
		body, err := s.RevisionBody("story-1", e.Rev)
		if err != nil {
			t.Fatalf("rev %d unreadable: %v", e.Rev, err)
		}
		if !bytes.Contains(body, []byte(fmt.Sprintf("take %d", e.Rev))) {
			t.Fatalf("rev %d holds the wrong body: %s", e.Rev, body)
		}
	}
}

func TestUnchangedBodyStoresNoSnapshot(t *testing.T) {
	s := testStore(t, nil)
	body := storyBody("Lighthouse", "one")

	mustPut(t, s, "story-1", body)
	mustPut(t, s, "story-1", body)
	mustPut(t, s, "story-1", body)

	index, err := s.readRevIndex("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(index) != 0 {
		t.Fatalf("identical bodies made %d snapshots, want 0", len(index))
	}

	// The rev still moves: it is the write counter, and the client is owed a fresh ETag
	// for the write it just made.
	meta, err := s.Meta("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if meta.Rev != 3 {
		t.Fatalf("rev = %d, want 3", meta.Rev)
	}

	mustPut(t, s, "story-1", storyBody("Lighthouse", "two"))
	index, err = s.readRevIndex("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(index) != 1 || index[0].Rev != 3 {
		t.Fatalf("a changed body should snapshot rev 3, got %+v", index)
	}
}

func TestSyncStrippedFromReturnedBody(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	mustPut(t, s, "story-1", storyBody("Lighthouse", "two"))

	body, err := s.RevisionBody("story-1", 1)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(body), `"sync"`) {
		t.Fatalf("sync survived into a snapshot: %s", body)
	}
}

func sha(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// manifestJSON builds an assets.json payload naming the given asset ids.
func manifestJSON(t *testing.T, ids ...string) []byte {
	t.Helper()
	assets := make([]map[string]any, 0, len(ids))
	for _, id := range ids {
		assets = append(assets, map[string]any{
			"id": id, "name": id, "kind": "bg", "tags": []string{}, "animated": false,
			"w": 10, "h": 10, "bytes": 4, "hash": sha([]byte(id)), "mime": "image/webp",
		})
	}
	raw, err := json.Marshal(map[string]any{"assets": assets, "characters": []any{}})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// manifestSidecarJSON builds an assets.json naming one asset whose `sidecars` field is
// verbatim whatever is handed in — "" leaves the key off entirely. The editor owns that
// shape and has already changed it once, so the server is tested against the shapes it
// will actually meet rather than the one it would like.
func manifestSidecarJSON(t *testing.T, id, sidecars string) []byte {
	t.Helper()
	asset := map[string]any{
		"id": id, "name": id, "kind": "bg", "tags": []string{}, "animated": false,
		"w": 10, "h": 10, "bytes": 4, "hash": sha([]byte(id)), "mime": "image/webp",
	}
	if sidecars != "" {
		asset["sidecars"] = json.RawMessage(sidecars)
	}
	raw, err := json.Marshal(map[string]any{"assets": []any{asset}, "characters": []any{}})
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

// putBlobAged uploads a blob and backdates it so the next sweep sees it as expired.
func putBlobAged(t *testing.T, s *Store, storyID, assetID, mime string, age time.Duration) {
	t.Helper()
	if _, err := s.PutAsset(storyID, assetID, bytes.NewReader([]byte(assetID)), sha([]byte(assetID)), mime); err != nil {
		t.Fatalf("PutAsset %s: %v", assetID, err)
	}
	path, _, ok := s.blobPath(storyID, assetID)
	if !ok {
		t.Fatalf("PutAsset %s left no blob", assetID)
	}
	past := time.Now().Add(-age)
	if err := os.Chtimes(path, past, past); err != nil {
		t.Fatal(err)
	}
}

func TestRestoreSnapshotsWhatItReplacedAndReportsMissingAssets(t *testing.T) {
	s := testStore(t, nil)

	mustPut(t, s, "story-1", storyBody("Lighthouse", "first"))
	if _, err := s.PutManifest("story-1", manifestJSON(t, "a1"), nil, testClient); err != nil {
		t.Fatalf("PutManifest: %v", err)
	}
	if _, err := s.PutAsset("story-1", "a1", bytes.NewReader([]byte("a1")), sha([]byte("a1")), "image/webp"); err != nil {
		t.Fatalf("PutAsset: %v", err)
	}

	// rev 2 snapshots the rev-1 body and, since the manifest has moved, the manifest
	// beside it.
	mustPut(t, s, "story-1", storyBody("Lighthouse", "second"))

	if err := s.DeleteAsset("story-1", "a1"); err != nil {
		t.Fatalf("DeleteAsset: %v", err)
	}

	res, err := s.Restore("story-1", 1, Client{Name: "bob"})
	if err != nil {
		t.Fatalf("Restore: %v", err)
	}
	if res.Rev != 3 || res.RestoredFrom != 1 {
		t.Fatalf("restore result wrong: %+v", res)
	}
	if len(res.MissingAssets) != 1 || res.MissingAssets[0] != "a1" {
		t.Fatalf("missingAssets = %v, want [a1]", res.MissingAssets)
	}

	body, _, err := s.GetStory("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(body, []byte("first")) {
		t.Fatalf("restore did not bring the old body back: %s", body)
	}

	// The version restored over is itself history now — restoring never destroys.
	replaced, err := s.RevisionBody("story-1", 2)
	if err != nil {
		t.Fatalf("rev 2 was not snapshotted: %v", err)
	}
	if !bytes.Contains(replaced, []byte("second")) {
		t.Fatalf("rev 2 snapshot holds the wrong body: %s", replaced)
	}

	// The restore itself is recorded once it in turn becomes history.
	mustPut(t, s, "story-1", storyBody("Lighthouse", "third"))
	revs, err := s.Revisions("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if revs.Current != 4 {
		t.Fatalf("current = %d, want 4", revs.Current)
	}
	// Row 0 is the current version; the restore is the snapshot behind it.
	if revs.Revisions[1].Rev != 3 || revs.Revisions[1].RestoredFrom != 1 {
		t.Fatalf("restore not recorded in history: %+v", revs.Revisions[1])
	}
	if revs.Revisions[1].Client != "bob" {
		t.Fatalf("history credits %q, want bob", revs.Revisions[1].Client)
	}
}

func TestRestoreMissingRevisionIsNotFound(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))

	_, err := s.Restore("story-1", 99, testClient)
	var serr *Error
	if !errors.As(err, &serr) || serr.Code != CodeNotFound {
		t.Fatalf("restore of a missing rev: got %v", err)
	}
}

func TestOrphanSweepRespectsTTL(t *testing.T) {
	s := testStore(t, func(o *Options) { o.OrphanTTL = time.Hour })
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))

	// a1 is named by the manifest; the other two are not.
	if _, err := s.PutManifest("story-1", manifestJSON(t, "a1"), nil, testClient); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a1", "old", "fresh"} {
		if _, err := s.PutAsset("story-1", id, bytes.NewReader([]byte(id)), sha([]byte(id)), "image/webp"); err != nil {
			t.Fatalf("PutAsset %s: %v", id, err)
		}
	}

	// Age one orphan past the TTL and leave the other inside it.
	old := filepath.Join(s.assetsDir("story-1"), "old.webp")
	past := time.Now().Add(-2 * time.Hour)
	if err := os.Chtimes(old, past, past); err != nil {
		t.Fatal(err)
	}

	res, err := s.Sweep(time.Now())
	if err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if res.OrphanBlobs != 1 {
		t.Fatalf("swept %d blobs, want 1", res.OrphanBlobs)
	}
	if _, _, ok := s.blobPath("story-1", "old"); ok {
		t.Fatal("expired orphan survived")
	}
	if _, _, ok := s.blobPath("story-1", "fresh"); !ok {
		t.Fatal("orphan inside its TTL was swept — a checkout uploading blobs before the manifest would lose them")
	}
	if _, _, ok := s.blobPath("story-1", "a1"); !ok {
		t.Fatal("blob named by the manifest was swept")
	}
}

func TestSweepKeepsSidecarsTheManifestNames(t *testing.T) {
	s := testStore(t, func(o *Options) { o.OrphanTTL = time.Hour })
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))

	sidecars := `{"cutout":{"hash":"ff","bytes":12,"mime":"image/png","sync":true}}`
	if _, err := s.PutManifest("story-1", manifestSidecarJSON(t, "a1", sidecars), nil, testClient); err != nil {
		t.Fatal(err)
	}

	putBlobAged(t, s, "story-1", "a1", "image/webp", 2*time.Hour)
	putBlobAged(t, s, "story-1", "a1.cutout", "image/png", 2*time.Hour)
	// Same name shape, no manifest entry anywhere: still an orphan, still swept.
	putBlobAged(t, s, "story-1", "a9999.cutout", "image/png", 2*time.Hour)

	res, err := s.Sweep(time.Now())
	if err != nil {
		t.Fatalf("Sweep: %v", err)
	}
	if res.OrphanBlobs != 1 {
		t.Fatalf("swept %d blobs, want 1", res.OrphanBlobs)
	}
	if _, _, ok := s.blobPath("story-1", "a1.cutout"); !ok {
		t.Fatal("a sidecar the manifest names was swept — pushed art disappearing one OrphanTTL after upload")
	}
	if _, _, ok := s.blobPath("story-1", "a1"); !ok {
		t.Fatal("blob named by the manifest was swept")
	}
	if _, _, ok := s.blobPath("story-1", "a9999.cutout"); ok {
		t.Fatal("a sidecar of an asset no manifest names survived — nothing would ever collect it")
	}
}

func TestSweepSurvivesEverySidecarShape(t *testing.T) {
	// The editor writes this field; the server only reads it. Anything unreadable has to
	// mean "names no sidecars", never "names nothing" — the second answer deletes the
	// asset's own bytes.
	shapes := []struct {
		name     string
		sidecars string
	}{
		{"absent", ""},
		{"null", `null`},
		{"old array form", `["source","cutout"]`},
		{"empty object", `{}`},
		{"not an object at all", `"cutout"`},
	}
	for _, tc := range shapes {
		t.Run(tc.name, func(t *testing.T) {
			s := testStore(t, func(o *Options) { o.OrphanTTL = time.Hour })
			mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
			if _, err := s.PutManifest("story-1", manifestSidecarJSON(t, "a1", tc.sidecars), nil, testClient); err != nil {
				t.Fatal(err)
			}
			putBlobAged(t, s, "story-1", "a1", "image/webp", 2*time.Hour)

			if _, err := s.Sweep(time.Now()); err != nil {
				t.Fatalf("Sweep: %v", err)
			}
			if _, _, ok := s.blobPath("story-1", "a1"); !ok {
				t.Fatalf("sidecars %s took the asset's own blob with it", tc.sidecars)
			}
		})
	}
}

func TestValidIDTakesSidecarKeys(t *testing.T) {
	// `.` is the sidecar separator precisely because ids already allow it; `#` and the
	// rest stay out, and this pattern is the path-traversal guard, so it does not move.
	ok := []string{"a_8f21", "a_8f21.cutout", "a_8f21.src", "a-1.cutout.v2"}
	for _, id := range ok {
		if !ValidID(id) {
			t.Errorf("ValidID(%q) = false, want true", id)
		}
	}
	bad := []string{"a_8f21#cutout", "a_8f21/cutout", "../a_8f21", "a_8f21/../x", ".hidden", "", ".", ".."}
	for _, id := range bad {
		if ValidID(id) {
			t.Errorf("ValidID(%q) = true, want false", id)
		}
	}
}

func TestSweepExpiresTombstones(t *testing.T) {
	s := testStore(t, func(o *Options) { o.TombstoneTTL = time.Hour })
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	mustPut(t, s, "story-2", storyBody("Harbour", "one"))
	if err := s.DeleteStory("story-1", false, testClient); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteStory("story-2", false, testClient); err != nil {
		t.Fatal(err)
	}

	// story-1 was deleted two hours ago as far as its meta is concerned.
	meta, err := s.Meta("story-1")
	if err != nil {
		t.Fatal(err)
	}
	meta.DeletedAt = time.Now().Add(-2 * time.Hour).UTC().Format("2006-01-02T15:04:05.000Z")
	if err := writeJSONAtomic(s.metaPath("story-1"), meta); err != nil {
		t.Fatal(err)
	}

	res, err := s.Sweep(time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if res.Tombstones != 1 {
		t.Fatalf("swept %d tombstones, want 1", res.Tombstones)
	}
	if _, err := os.Stat(s.storyDir("story-1")); !errors.Is(err, os.ErrNotExist) {
		t.Fatal("expired tombstone survived")
	}
	if _, err := s.Meta("story-2"); err != nil {
		t.Fatalf("fresh tombstone was swept: %v", err)
	}
}

func TestInvalidIDsRefused(t *testing.T) {
	s := testStore(t, nil)
	for _, id := range []string{"", "..", "../escape", "a/b", "."} {
		if _, err := s.PutStory(id, storyBody("x"), testClient, PutOptions{}); err == nil {
			t.Fatalf("id %q was accepted", id)
		}
	}
}

// ---------------------------------------------------------------------------
// Labels, pins and summaries
// ---------------------------------------------------------------------------

func mustLabel(t *testing.T, s *Store, id string, rev int, want RevisionMeta) RevisionMetaResult {
	t.Helper()
	res, err := s.SetRevisionMeta(id, rev, want)
	if err != nil {
		t.Fatalf("SetRevisionMeta(%d): %v", rev, err)
	}
	return res
}

func revIn(t *testing.T, s *Store, id string, rev int) (RevisionEntry, bool) {
	t.Helper()
	index, err := s.readRevIndex(id)
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range index {
		if e.Rev == rev {
			return e, true
		}
	}
	return RevisionEntry{}, false
}

func TestPinnedSnapshotSurvivesPruneAndUnpinnedDoesNot(t *testing.T) {
	const keep = 3
	s := testStore(t, func(o *Options) { o.RevKeep = keep })

	// Five writes make snapshots of revs 1..4; pin the oldest of them.
	for i := 1; i <= 5; i++ {
		mustPut(t, s, "story-1", storyBody("Lighthouse", fmt.Sprintf("take %d", i)))
	}
	// Rev 1 has already been pruned by now (keep is 3); rev 2 is the oldest survivor.
	mustLabel(t, s, "story-1", 2, RevisionMeta{Pinned: boolp(true), Label: strp("before the tavern")})

	// Six more writes: snapshots now run 2..10 and the unpinned ones prune back to keep.
	for i := 6; i <= 11; i++ {
		mustPut(t, s, "story-1", storyBody("Lighthouse", fmt.Sprintf("take %d", i)))
	}

	index, err := s.readRevIndex("story-1")
	if err != nil {
		t.Fatal(err)
	}
	var got []int
	for _, e := range index {
		got = append(got, e.Rev)
	}
	want := []int{2, 8, 9, 10}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("surviving revs %v, want %v", got, want)
	}
	if !index[0].Pinned || index[0].Label != "before the tavern" {
		t.Fatalf("pinned row lost its metadata: %+v", index[0])
	}

	// The pinned body is still on disk and still readable.
	body, err := s.RevisionBody("story-1", 2)
	if err != nil {
		t.Fatalf("pinned rev 2 unreadable: %v", err)
	}
	if !bytes.Contains(body, []byte("take 2")) {
		t.Fatalf("pinned rev 2 holds the wrong body: %s", body)
	}

	files, err := filepath.Glob(filepath.Join(s.revsDir("story-1"), "*.json.gz"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) != len(want) {
		t.Fatalf("%d snapshot files on disk, want %d", len(files), len(want))
	}

	// Unpinning puts it back under the policy: the next write prunes it away.
	mustLabel(t, s, "story-1", 2, RevisionMeta{Pinned: boolp(false)})
	mustPut(t, s, "story-1", storyBody("Lighthouse", "take 12"))
	if _, ok := revIn(t, s, "story-1", 2); ok {
		t.Fatal("rev 2 survived a prune after being unpinned")
	}
}

func TestPinCapIsRefusedAtPinnedMax(t *testing.T) {
	s := testStore(t, func(o *Options) { o.PinnedMax = 3 })
	for i := 1; i <= 6; i++ {
		mustPut(t, s, "story-1", storyBody("Lighthouse", fmt.Sprintf("take %d", i)))
	}

	for _, rev := range []int{1, 2, 3} {
		res := mustLabel(t, s, "story-1", rev, RevisionMeta{Pinned: boolp(true)})
		if res.Max != 3 {
			t.Fatalf("pinnedMax = %d, want 3", res.Max)
		}
		if res.Pins != rev {
			t.Fatalf("after pinning rev %d, pins = %d", rev, res.Pins)
		}
	}

	_, err := s.SetRevisionMeta("story-1", 4, RevisionMeta{Pinned: boolp(true)})
	var serr *Error
	if !errors.As(err, &serr) || serr.Code != CodeBadRequest {
		t.Fatalf("a 4th pin gave %v, want a bad_request", err)
	}
	if !strings.Contains(serr.Message, "PINNED_MAX") {
		t.Fatalf("the refusal does not name the limit: %q", serr.Message)
	}
	if e, _ := revIn(t, s, "story-1", 4); e.Pinned {
		t.Fatal("the refused pin was written anyway")
	}

	// Re-pinning something already pinned is not a new pin, so it is never refused.
	mustLabel(t, s, "story-1", 3, RevisionMeta{Pinned: boolp(true), Label: strp("still pinned")})

	// Unpinning makes room again.
	mustLabel(t, s, "story-1", 1, RevisionMeta{Pinned: boolp(false)})
	mustLabel(t, s, "story-1", 4, RevisionMeta{Pinned: boolp(true)})
}

func TestPinnedCurrentRevCountsTowardsTheCap(t *testing.T) {
	s := testStore(t, func(o *Options) { o.PinnedMax = 2 })
	for i := 1; i <= 4; i++ {
		mustPut(t, s, "story-1", storyBody("Lighthouse", fmt.Sprintf("take %d", i)))
	}

	// rev 4 is story.json, not an index row — it still pins, and still counts.
	res := mustLabel(t, s, "story-1", 4, RevisionMeta{Pinned: boolp(true)})
	if res.Pins != 1 {
		t.Fatalf("pins = %d, want 1", res.Pins)
	}
	mustLabel(t, s, "story-1", 1, RevisionMeta{Pinned: boolp(true)})
	if _, err := s.SetRevisionMeta("story-1", 2, RevisionMeta{Pinned: boolp(true)}); err == nil {
		t.Fatal("the current rev's pin did not count towards PINNED_MAX")
	}
}

func TestLabellingTheCurrentRevMovesOntoItsSnapshot(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))

	mustLabel(t, s, "story-1", 1, RevisionMeta{Label: strp("checkpoint"), Pinned: boolp(true)})

	// It shows up straight away on the current row of the history list.
	revs, err := s.Revisions("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if revs.Revisions[0].Rev != 1 || revs.Revisions[0].Label != "checkpoint" || !revs.Revisions[0].Pinned {
		t.Fatalf("current row = %+v", revs.Revisions[0])
	}

	mustPut(t, s, "story-1", storyBody("Lighthouse", "two"))

	e, ok := revIn(t, s, "story-1", 1)
	if !ok || e.Label != "checkpoint" || !e.Pinned {
		t.Fatalf("label did not move onto the snapshot: %+v", e)
	}
	// The new version starts clean.
	meta, err := s.Meta("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if meta.RevLabel != "" || meta.RevPinned {
		t.Fatalf("the new rev inherited the old label: %+v", meta)
	}
}

func TestLabellingDoesNotBumpRevOrSnapshot(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	mustPut(t, s, "story-1", storyBody("Lighthouse", "two"))

	before, err := s.Meta("story-1")
	if err != nil {
		t.Fatal(err)
	}
	mustLabel(t, s, "story-1", 1, RevisionMeta{Label: strp("keep me"), Pinned: boolp(true)})
	mustLabel(t, s, "story-1", 2, RevisionMeta{Label: strp("and me")})

	after, err := s.Meta("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if after.Rev != before.Rev {
		t.Fatalf("rev moved %d -> %d", before.Rev, after.Rev)
	}
	if after.UpdatedAt != before.UpdatedAt || after.Hash != before.Hash {
		t.Fatalf("labelling touched the story: %+v", after)
	}
	index, err := s.readRevIndex("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(index) != 1 {
		t.Fatalf("labelling made a snapshot: %+v", index)
	}
}

func TestLabelIsClampedAndStripped(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	mustPut(t, s, "story-1", storyBody("Lighthouse", "two"))

	res := mustLabel(t, s, "story-1", 1, RevisionMeta{Label: strp("  tavern\nnight\ttwo\x00three  ")})
	if res.Label != "tavernnighttwothree" {
		t.Fatalf("label = %q", res.Label)
	}

	long := strings.Repeat("é", 200)
	res = mustLabel(t, s, "story-1", 1, RevisionMeta{Label: &long})
	if n := len([]rune(res.Label)); n != maxLabelRunes {
		t.Fatalf("label is %d runes, want %d", n, maxLabelRunes)
	}
	e, _ := revIn(t, s, "story-1", 1)
	if e.Label != res.Label {
		t.Fatalf("stored label %q != returned %q", e.Label, res.Label)
	}

	// An empty string is how a label is cleared; nil leaves it alone.
	res = mustLabel(t, s, "story-1", 1, RevisionMeta{Label: strp("")})
	if res.Label != "" {
		t.Fatalf("empty label did not clear: %q", res.Label)
	}
	mustLabel(t, s, "story-1", 1, RevisionMeta{Label: strp("named")})
	res = mustLabel(t, s, "story-1", 1, RevisionMeta{Pinned: boolp(true)})
	if res.Label != "named" {
		t.Fatalf("an omitted label changed it to %q", res.Label)
	}
}

func TestSummaryIsClampedAndStoredOnTheRevItCreated(t *testing.T) {
	s := testStore(t, nil)

	if _, err := s.PutStory("story-1", storyBody("Lighthouse", "one"), testClient,
		PutOptions{Summary: "Tavern Night +2 more"}); err != nil {
		t.Fatal(err)
	}
	meta, err := s.Meta("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if meta.RevSummary != "Tavern Night +2 more" {
		t.Fatalf("summary = %q", meta.RevSummary)
	}

	// A rune straddling the byte cut: the result must stay valid UTF-8 and under the cap.
	long := "a" + strings.Repeat("é", 150)
	if _, err := s.PutStory("story-1", storyBody("Lighthouse", "two"), testClient,
		PutOptions{Summary: long + "\n\x01"}); err != nil {
		t.Fatal(err)
	}
	meta, err = s.Meta("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(meta.RevSummary) > maxSummaryBytes {
		t.Fatalf("summary is %d bytes, want <= %d", len(meta.RevSummary), maxSummaryBytes)
	}
	if !utf8.ValidString(meta.RevSummary) {
		t.Fatalf("summary is not valid UTF-8: %q", meta.RevSummary)
	}
	if strings.ContainsAny(meta.RevSummary, "\n\x01") {
		t.Fatalf("control characters survived: %q", meta.RevSummary)
	}

	// Rev 1's summary went with rev 1 when rev 2 replaced it.
	e, ok := revIn(t, s, "story-1", 1)
	if !ok || e.Summary != "Tavern Night +2 more" {
		t.Fatalf("rev 1 entry = %+v", e)
	}
}

func TestOldRevIndexWithoutTheNewFieldsStillLoads(t *testing.T) {
	s := testStore(t, nil)
	for i := 1; i <= 3; i++ {
		mustPut(t, s, "story-1", storyBody("Lighthouse", fmt.Sprintf("take %d", i)))
	}

	// An index exactly as a pre-labels server wrote it: no label, no pinned, no summary.
	old := `[{"rev":1,"at":"2026-09-01T10:00:00.000Z","client":"mira","bytes":12,"hash":"h1","passages":1},` +
		`{"rev":2,"at":"2026-09-01T10:01:00.000Z","client":"mira","bytes":12,"hash":"h2","passages":1}]`
	if err := os.WriteFile(s.revIndexPath("story-1"), []byte(old), 0o644); err != nil {
		t.Fatal(err)
	}

	index, err := s.readRevIndex("story-1")
	if err != nil {
		t.Fatalf("an old index failed to load: %v", err)
	}
	if len(index) != 2 {
		t.Fatalf("index = %+v", index)
	}
	for _, e := range index {
		if e.Label != "" || e.Pinned || e.Summary != "" {
			t.Fatalf("an old row came back with metadata: %+v", e)
		}
	}
	if _, err := s.Revisions("story-1"); err != nil {
		t.Fatalf("Revisions over an old index: %v", err)
	}
	// And it is writable: pinning one rewrites the file in the new shape.
	mustLabel(t, s, "story-1", 2, RevisionMeta{Pinned: boolp(true), Label: strp("old row")})
	e, ok := revIn(t, s, "story-1", 2)
	if !ok || !e.Pinned || e.Label != "old row" {
		t.Fatalf("row 2 = %+v", e)
	}
}

func TestLabellingAnUnknownRevIsNotFound(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))

	if _, err := s.SetRevisionMeta("story-1", 99, RevisionMeta{Label: strp("nope")}); err == nil {
		t.Fatal("labelling a rev that does not exist was accepted")
	}
	if _, err := s.SetRevisionMeta("story-404", 1, RevisionMeta{Label: strp("nope")}); err == nil {
		t.Fatal("labelling a story that does not exist was accepted")
	}
}

// A pinned rev older than the doomed ones must not lose the manifest that answers for it:
// prune renames a doomed .assets.gz onto the oldest survivor that needs it.
func TestPrunePromotesManifestsPastAPin(t *testing.T) {
	const keep = 2
	s := testStore(t, func(o *Options) { o.RevKeep = keep })

	mustPut(t, s, "story-1", storyBody("Lighthouse", "take 1"))
	if _, err := s.PutManifest("story-1", manifestJSON(t, "a"), nil, testClient); err != nil {
		t.Fatal(err)
	}
	for i := 2; i <= 6; i++ {
		mustPut(t, s, "story-1", storyBody("Lighthouse", fmt.Sprintf("take %d", i)))
		if i == 2 {
			mustLabel(t, s, "story-1", 2, RevisionMeta{Pinned: boolp(true)})
		}
	}

	index, err := s.readRevIndex("story-1")
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range index {
		man, err := s.RevisionManifest("story-1", e.Rev)
		if err != nil {
			t.Fatalf("rev %d manifest: %v", e.Rev, err)
		}
		if len(man.Assets) != 1 || !bytes.Contains(man.Assets[0], []byte(`"id":"a"`)) {
			t.Fatalf("rev %d lost its manifest: %+v", e.Rev, man)
		}
	}
}

func strp(v string) *string { return &v }
func boolp(v bool) *bool    { return &v }
