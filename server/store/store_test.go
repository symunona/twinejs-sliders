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
)

func testStore(t *testing.T, tweak func(*Options)) *Store {
	t.Helper()
	opts := Options{
		Dir:          t.TempDir(),
		RevKeep:      20,
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
