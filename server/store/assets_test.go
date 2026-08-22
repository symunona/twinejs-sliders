package store

import (
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func TestManifestHasItsOwnRev(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))

	man, err := s.PutManifest("story-1", manifestJSON(t, "a1"), nil, testClient)
	if err != nil {
		t.Fatal(err)
	}
	if man.Rev != 1 {
		t.Fatalf("manifest rev = %d, want 1", man.Rev)
	}

	// A story write does not move the manifest rev, and vice versa: text and art are
	// pushed by separate requests and must not invalidate each other's If-Match.
	mustPut(t, s, "story-1", storyBody("Lighthouse", "two"))
	man, err = s.GetManifest("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if man.Rev != 1 {
		t.Fatalf("story write moved the manifest rev to %d", man.Rev)
	}
	meta, err := s.Meta("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if meta.Rev != 2 {
		t.Fatalf("story rev = %d, want 2", meta.Rev)
	}
}

func TestManifestIfMatch(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	if _, err := s.PutManifest("story-1", manifestJSON(t, "a1"), nil, testClient); err != nil {
		t.Fatal(err)
	}

	stale := 0
	_, err := s.PutManifest("story-1", manifestJSON(t, "a1", "a2"), &stale, testClient)
	var conflict *ConflictError
	if !errors.As(err, &conflict) {
		t.Fatalf("stale manifest If-Match: got %v", err)
	}

	current := 1
	if _, err := s.PutManifest("story-1", manifestJSON(t, "a1", "a2"), &current, testClient); err != nil {
		t.Fatalf("matching manifest If-Match rejected: %v", err)
	}
}

func TestManifestReportsMissingBytes(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	if _, err := s.PutAsset("story-1", "a1", bytes.NewReader([]byte("a1")), sha([]byte("a1")), "image/webp"); err != nil {
		t.Fatal(err)
	}
	man, err := s.PutManifest("story-1", manifestJSON(t, "a1", "a2"), nil, testClient)
	if err != nil {
		t.Fatal(err)
	}
	if len(man.Missing) != 1 || man.Missing[0] != "a2" {
		t.Fatalf("missing = %v, want [a2]", man.Missing)
	}
}

func TestAssetUploadVerifiesHash(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))

	_, err := s.PutAsset("story-1", "a1", bytes.NewReader([]byte("real bytes")), sha([]byte("other bytes")), "image/png")
	var mismatch *HashMismatchError
	if !errors.As(err, &mismatch) {
		t.Fatalf("bad hash: got %v, want HashMismatchError", err)
	}
	// Nothing partial may be left where a HEAD could find it and trust it.
	if _, _, ok := s.blobPath("story-1", "a1"); ok {
		t.Fatal("a mis-hashed upload landed at its final path")
	}
	entries, err := os.ReadDir(s.assetsDir("story-1"))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("temp file left behind: %v", entries)
	}
}

func TestAssetExtensionFollowsMime(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	if _, err := s.PutManifest("story-1", manifestJSON(t, "a1"), nil, testClient); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PutAsset("story-1", "a1", bytes.NewReader([]byte("a1")), sha([]byte("a1")), ""); err != nil {
		t.Fatal(err)
	}
	// The manifest says image/webp, so that is the name on disk even though the request
	// carried no Content-Type.
	if _, err := os.Stat(filepath.Join(s.assetsDir("story-1"), "a1.webp")); err != nil {
		t.Fatalf("expected a1.webp: %v", err)
	}

	if _, err := s.PutAsset("story-1", "a2", bytes.NewReader([]byte("a2")), sha([]byte("a2")), "application/octet-stream"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(s.assetsDir("story-1"), "a2.bin")); err != nil {
		t.Fatalf("expected a2.bin: %v", err)
	}
}

func TestDiffSplitsMissingPresentStale(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	if _, err := s.PutManifest("story-1", manifestJSON(t, "a1", "a2"), nil, testClient); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"a1", "a2"} {
		if _, err := s.PutAsset("story-1", id, bytes.NewReader([]byte(id)), sha([]byte(id)), "image/webp"); err != nil {
			t.Fatal(err)
		}
	}

	var req DiffRequest
	body, err := json.Marshal(map[string]any{"assets": []map[string]any{
		{"id": "a1", "hash": sha([]byte("a1")), "bytes": 2},
		{"id": "a2", "hash": "0000", "bytes": 2},
		{"id": "a3", "hash": sha([]byte("a3")), "bytes": 2},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(body, &req); err != nil {
		t.Fatal(err)
	}

	res, err := s.Diff("story-1", req)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Present) != 1 || res.Present[0] != "a1" {
		t.Fatalf("present = %v", res.Present)
	}
	if len(res.Stale) != 1 || res.Stale[0] != "a2" {
		t.Fatalf("stale = %v", res.Stale)
	}
	if len(res.Missing) != 1 || res.Missing[0] != "a3" {
		t.Fatalf("missing = %v", res.Missing)
	}
}

func TestDeleteAssetLeavesManifestAlone(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	if _, err := s.PutManifest("story-1", manifestJSON(t, "a1"), nil, testClient); err != nil {
		t.Fatal(err)
	}
	if _, err := s.PutAsset("story-1", "a1", bytes.NewReader([]byte("a1")), sha([]byte("a1")), "image/webp"); err != nil {
		t.Fatal(err)
	}
	if err := s.DeleteAsset("story-1", "a1"); err != nil {
		t.Fatal(err)
	}

	man, err := s.GetManifest("story-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(man.Assets) != 1 {
		t.Fatalf("manifest lost its entry: %+v", man)
	}
	if len(man.Missing) != 1 || man.Missing[0] != "a1" {
		t.Fatalf("missing = %v, want [a1]", man.Missing)
	}
}

func TestRevisionManifestFollowsTheBody(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))
	if _, err := s.PutManifest("story-1", manifestJSON(t, "a1"), nil, testClient); err != nil {
		t.Fatal(err)
	}
	mustPut(t, s, "story-1", storyBody("Lighthouse", "two")) // snapshots rev 1 + its manifest
	if _, err := s.PutManifest("story-1", manifestJSON(t, "a1", "a2"), nil, testClient); err != nil {
		t.Fatal(err)
	}
	mustPut(t, s, "story-1", storyBody("Lighthouse", "three")) // snapshots rev 2 + its manifest

	at1, err := s.RevisionManifest("story-1", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(at1.Assets) != 1 {
		t.Fatalf("rev 1 manifest has %d assets, want 1", len(at1.Assets))
	}
	at2, err := s.RevisionManifest("story-1", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(at2.Assets) != 2 {
		t.Fatalf("rev 2 manifest has %d assets, want 2", len(at2.Assets))
	}
}

func TestManifestOfStoryWithNoAssetsIsEmptyNotMissing(t *testing.T) {
	s := testStore(t, nil)
	mustPut(t, s, "story-1", storyBody("Lighthouse", "one"))

	man, err := s.GetManifest("story-1")
	if err != nil {
		t.Fatalf("text-only story has no manifest: %v", err)
	}
	if man.Assets == nil || man.Characters == nil || man.Missing == nil {
		t.Fatalf("empty manifest has nil arrays: %+v", man)
	}
	raw, err := json.Marshal(man)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(raw, []byte(`"assets":[]`)) {
		t.Fatalf("empty manifest serialises as %s", raw)
	}
}
