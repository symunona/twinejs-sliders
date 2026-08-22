package store

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
)

// RevisionEntry is one row of revs/index.json and of `GET /stories/{id}/revisions` —
// RevisionEntry in server.types.ts. It describes the body stored at that rev, not the
// write that replaced it.
type RevisionEntry struct {
	Rev      int    `json:"rev"`
	At       string `json:"at"`
	Client   string `json:"client"`
	Bytes    int64  `json:"bytes"`
	Hash     string `json:"hash"`
	Passages int    `json:"passages"`
	// RestoredFrom is set when *this* revision was itself produced by a restore.
	RestoredFrom int `json:"restoredFrom,omitempty"`
}

// Revisions is RevisionsResponse in server.types.ts: the version list, newest first, with
// the current version as its first row, plus `current` so the UI knows which row is now.
type Revisions struct {
	Current   int             `json:"current"`
	Revisions []RevisionEntry `json:"revisions"`
}

// RestoreResult is RestoreResponse in server.types.ts.
type RestoreResult struct {
	ID            string   `json:"id"`
	Rev           int      `json:"rev"`
	RestoredFrom  int      `json:"restoredFrom"`
	MissingAssets []string `json:"missingAssets"`
}

func (s *Store) revIndexPath(id string) string { return filepath.Join(s.revsDir(id), "index.json") }

func (s *Store) revBodyPath(id string, rev int) string {
	return filepath.Join(s.revsDir(id), fmt.Sprintf("%06d.json.gz", rev))
}

func (s *Store) revAssetsPath(id string, rev int) string {
	return filepath.Join(s.revsDir(id), fmt.Sprintf("%06d.assets.gz", rev))
}

// readRevIndex returns the snapshot list oldest first, which is the order it is stored in
// — appending is then a push and pruning is a slice of the head.
func (s *Store) readRevIndex(id string) ([]RevisionEntry, error) {
	var index []RevisionEntry
	err := readJSONFile(s.revIndexPath(id), &index)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	sort.Slice(index, func(i, j int) bool { return index[i].Rev < index[j].Rev })
	return index, nil
}

func gzipBytes(data []byte) ([]byte, error) {
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(data); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func gunzipFile(path string) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	zr, err := gzip.NewReader(f)
	if err != nil {
		return nil, err
	}
	defer zr.Close()
	return io.ReadAll(zr)
}

// snapshotLocked stores the body that is being replaced, and the manifest beside it when
// the manifest has moved since the last snapshot. The manifest copy is what makes an old
// body answerable rather than mysterious: restore can say *which* pictures did not come
// back instead of silently rendering gaps.
func (s *Store) snapshotLocked(m *Meta, prevBody []byte) error {
	id := m.ID
	if err := os.MkdirAll(s.revsDir(id), 0o755); err != nil {
		return err
	}

	gz, err := gzipBytes(prevBody)
	if err != nil {
		return err
	}
	if err := writeFileAtomic(s.revBodyPath(id, m.Rev), gz); err != nil {
		return err
	}

	if manifest, err := os.ReadFile(s.manifestPath(id)); err == nil {
		if h := hashBytes(manifest); h != m.AssetSnapHash {
			gzm, err := gzipBytes(manifest)
			if err != nil {
				return err
			}
			if err := writeFileAtomic(s.revAssetsPath(id, m.Rev), gzm); err != nil {
				return err
			}
			m.AssetSnapHash = h
		}
	}

	index, err := s.readRevIndex(id)
	if err != nil {
		return err
	}
	index = append(index, RevisionEntry{
		Rev:          m.Rev,
		At:           m.UpdatedAt,
		Client:       m.LastClient,
		Bytes:        m.Bytes,
		Hash:         m.Hash,
		Passages:     m.PassageCount,
		RestoredFrom: m.RestoredFrom,
	})

	index, err = s.pruneLocked(id, index)
	if err != nil {
		return err
	}
	return writeJSONAtomic(s.revIndexPath(id), index)
}

// pruneLocked drops everything past the newest REV_KEEP snapshots.
//
// The one subtlety is the manifest: it is only snapshotted when it changed, so the oldest
// surviving body can be relying on an `.assets.gz` that belongs to a rev about to be
// deleted. Rather than lose it, the newest doomed manifest is promoted onto the oldest
// survivor — the same bytes, filed under the rev that now needs them.
func (s *Store) pruneLocked(id string, index []RevisionEntry) ([]RevisionEntry, error) {
	if len(index) <= s.opts.RevKeep {
		return index, nil
	}

	cut := len(index) - s.opts.RevKeep
	doomed, kept := index[:cut], index[cut:]

	var promote string
	for _, e := range doomed {
		if p := s.revAssetsPath(id, e.Rev); fileExists(p) {
			promote = p
		}
	}
	if promote != "" && len(kept) > 0 {
		oldest := s.revAssetsPath(id, kept[0].Rev)
		if !fileExists(oldest) {
			if err := os.Rename(promote, oldest); err != nil {
				return nil, err
			}
			promote = ""
		}
	}

	for _, e := range doomed {
		for _, p := range []string{s.revBodyPath(id, e.Rev), s.revAssetsPath(id, e.Rev)} {
			if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
				return nil, err
			}
		}
	}
	return append([]RevisionEntry(nil), kept...), nil
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// Revisions lists a story's history, newest first.
func (s *Store) Revisions(id string) (Revisions, error) {
	if err := checkID("story", id); err != nil {
		return Revisions{}, err
	}
	m, ok, err := s.readMeta(id)
	if err != nil {
		return Revisions{}, err
	}
	if !ok {
		return Revisions{}, notFound("story")
	}
	index, err := s.readRevIndex(id)
	if err != nil {
		return Revisions{}, err
	}

	// The current version leads the list. It is not a snapshot — it is story.json — but
	// the history dialog shows one list, and a version you cannot see is a version people
	// assume was lost. `Current` tells the UI which row to mark "now".
	out := make([]RevisionEntry, 0, len(index)+1)
	if !m.Deleted {
		out = append(out, RevisionEntry{
			Rev:          m.Rev,
			At:           m.UpdatedAt,
			Client:       m.LastClient,
			Bytes:        m.Bytes,
			Hash:         m.Hash,
			Passages:     m.PassageCount,
			RestoredFrom: m.RestoredFrom,
		})
	}
	for i := len(index) - 1; i >= 0; i-- {
		out = append(out, index[i])
	}
	return Revisions{Current: m.Rev, Revisions: out}, nil
}

// RevisionBody returns the story body stored at a rev. The current rev is served from
// story.json, so the history dialog can preview "now" through the same route as any row.
func (s *Store) RevisionBody(id string, rev int) ([]byte, error) {
	if err := checkID("story", id); err != nil {
		return nil, err
	}
	m, ok, err := s.readMeta(id)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, notFound("story")
	}
	if rev == m.Rev && !m.Deleted {
		body, err := os.ReadFile(s.storyPath(id))
		if errors.Is(err, os.ErrNotExist) {
			return nil, notFound("revision")
		}
		return body, err
	}
	body, err := gunzipFile(s.revBodyPath(id, rev))
	if errors.Is(err, os.ErrNotExist) {
		return nil, notFound("revision")
	}
	return body, err
}

// RevisionManifest returns the manifest as of a rev, with `missing` filled in against
// the bytes the server holds now.
func (s *Store) RevisionManifest(id string, rev int) (Manifest, error) {
	if err := checkID("story", id); err != nil {
		return Manifest{}, err
	}
	_, ok, err := s.readMeta(id)
	if err != nil {
		return Manifest{}, err
	}
	if !ok {
		return Manifest{}, notFound("story")
	}
	man, err := s.manifestAtRev(id, rev)
	if err != nil {
		return Manifest{}, err
	}
	man.Missing = s.missingAssets(id, man)
	return man, nil
}

// Restore copies an old body back over the current one as an ordinary write: the rev
// bumps, what it replaced becomes a snapshot, and every other editor pulls it like any
// other change. Restoring therefore never destroys — the version you restored over is one
// click from coming back.
func (s *Store) Restore(id string, rev int, c Client) (RestoreResult, error) {
	if err := checkID("story", id); err != nil {
		return RestoreResult{}, err
	}

	defer s.lock(id)()

	m, ok, err := s.readMeta(id)
	if err != nil {
		return RestoreResult{}, err
	}
	if !ok {
		return RestoreResult{}, notFound("story")
	}
	if m.Deleted {
		return RestoreResult{}, &DeletedError{ID: id}
	}

	var raw []byte
	if rev == m.Rev {
		raw, err = os.ReadFile(s.storyPath(id))
	} else {
		raw, err = gunzipFile(s.revBodyPath(id, rev))
	}
	if errors.Is(err, os.ErrNotExist) {
		return RestoreResult{}, notFound("revision")
	}
	if err != nil {
		return RestoreResult{}, err
	}

	body, sum, err := normalizeStory(raw)
	if err != nil {
		return RestoreResult{}, err
	}

	// Read the manifest of the restored rev before the write, so `missingAssets` names
	// the art that body expects — blobs the janitor may have swept while it sat in
	// history.
	missing := []string{}
	if man, err := s.manifestAtRev(id, rev); err == nil {
		missing = s.missingAssets(id, man)
	}

	res, err := s.writeStoryLocked(m, body, sum, c, rev)
	if err != nil {
		return RestoreResult{}, err
	}
	return RestoreResult{ID: id, Rev: res.Rev, RestoredFrom: rev, MissingAssets: missing}, nil
}

// manifestAtRev finds the manifest that applies to a rev.
//
// Snapshots are only written when the manifest changed, so the answer for rev 40 may be
// the file filed under rev 37 — the newest one at or below what was asked for. When there
// is none, the manifest has not moved since before the oldest surviving snapshot, and the
// current one is the honest answer.
func (s *Store) manifestAtRev(id string, rev int) (Manifest, error) {
	best := -1
	entries, err := os.ReadDir(s.revsDir(id))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return Manifest{}, err
	}
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".assets.gz") {
			continue
		}
		n, err := strconv.Atoi(strings.TrimSuffix(name, ".assets.gz"))
		if err != nil || n > rev || n <= best {
			continue
		}
		best = n
	}
	if best < 0 {
		return s.readManifest(id)
	}
	raw, err := gunzipFile(s.revAssetsPath(id, best))
	if err != nil {
		return Manifest{}, err
	}
	var man Manifest
	if err := json.Unmarshal(raw, &man); err != nil {
		return Manifest{}, err
	}
	man.normalize()
	return man, nil
}
