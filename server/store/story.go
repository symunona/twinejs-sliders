package store

import (
	"encoding/json"
	"errors"
	"os"
	"sort"
)

// Meta is meta.json: everything about a story that is not the story. The counts are
// cached here so `GET /stories` can draw every card without opening a single body.
type Meta struct {
	ID           string `json:"id"`
	IFID         string `json:"ifid"`
	Name         string `json:"name"`
	Rev          int    `json:"rev"`
	UpdatedAt    string `json:"updatedAt"`
	LastClient   string `json:"lastClient"`
	Deleted      bool   `json:"deleted"`
	DeletedAt    string `json:"deletedAt,omitempty"`
	PassageCount int    `json:"passageCount"`
	Bytes        int64  `json:"bytes"`
	Hash         string `json:"hash"`
	RestoredFrom int    `json:"restoredFrom,omitempty"`

	// The manifest carries its own rev, and its own If-Match, because assets and text
	// are written by separate requests: a checkout uploads blobs, then the manifest,
	// while autosave is still pushing passage text.
	AssetRev   int   `json:"assetRev"`
	AssetCount int   `json:"assetCount"`
	AssetBytes int64 `json:"assetBytes"`

	// AssetSnapHash is the manifest hash as of the newest revs/*.assets.gz. It answers
	// "did the manifest change since the last snapshot?" without reading the snapshot.
	AssetSnapHash string `json:"assetSnapHash,omitempty"`
}

// IndexEntry is one row of `GET /stories` — StoryIndexEntry in server.types.ts.
type IndexEntry struct {
	ID           string `json:"id"`
	IFID         string `json:"ifid"`
	Name         string `json:"name"`
	Rev          int    `json:"rev"`
	UpdatedAt    string `json:"updatedAt"`
	LastClient   string `json:"lastClient"`
	PassageCount int    `json:"passageCount"`
	Bytes        int64  `json:"bytes"`
	AssetCount   int    `json:"assetCount"`
	AssetBytes   int64  `json:"assetBytes"`
	Deleted      bool   `json:"deleted"`
}

// PutResult is PutStoryResponse in server.types.ts.
type PutResult struct {
	ID        string `json:"id"`
	Rev       int    `json:"rev"`
	UpdatedAt string `json:"updatedAt"`
	Bytes     int64  `json:"bytes"`
	// Revived says this write cleared a tombstone, so the handler can announce it as a
	// revival rather than an ordinary change. Not on the wire — the JSON is exactly
	// PutStoryResponse.
	Revived bool `json:"-"`
}

type storySummary struct {
	name     string
	ifid     string
	passages int
}

// normalizeStory strips `sync` and pulls out the few fields the index needs.
//
// `sync` is a per-editor decision (spec 11): whether *my* copy pushes itself is nobody
// else's business, so it never reaches the disk and never comes back on a pull.
//
// Re-marshalling a map sorts keys, which is a small liberty with "verbatim" — but the
// values stay as raw JSON, so passage text, scene YAML and every unknown future field
// survive byte for byte, and a stable key order is what makes "did this body change?" a
// hash comparison instead of a diff.
func normalizeStory(raw []byte) ([]byte, storySummary, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, storySummary{}, badRequest("story is not a JSON object: %v", err)
	}
	if fields == nil {
		return nil, storySummary{}, badRequest("story is null")
	}
	delete(fields, "sync")

	var sum storySummary
	_ = json.Unmarshal(fields["name"], &sum.name)
	_ = json.Unmarshal(fields["ifid"], &sum.ifid)
	if p, ok := fields["passages"]; ok {
		var passages []json.RawMessage
		if err := json.Unmarshal(p, &passages); err == nil {
			sum.passages = len(passages)
		}
	}

	body, err := json.Marshal(fields)
	if err != nil {
		return nil, storySummary{}, err
	}
	return body, sum, nil
}

// readMeta returns the story's meta.json. A missing directory is not an error here: the
// zero Meta (rev 0) is exactly what a first PUT needs.
func (s *Store) readMeta(id string) (Meta, bool, error) {
	var m Meta
	err := readJSONFile(s.metaPath(id), &m)
	if errors.Is(err, os.ErrNotExist) {
		return Meta{ID: id}, false, nil
	}
	if err != nil {
		return Meta{}, false, err
	}
	m.ID = id
	return m, true, nil
}

// Meta returns a story's metadata. Tombstones are returned, flagged: a client that holds
// the story has to be able to learn it was deleted.
func (s *Store) Meta(id string) (Meta, error) {
	if err := checkID("story", id); err != nil {
		return Meta{}, err
	}
	m, ok, err := s.readMeta(id)
	if err != nil {
		return Meta{}, err
	}
	if !ok {
		return Meta{}, notFound("story")
	}
	return m, nil
}

// List is `GET /stories`. Tombstones are included and flagged (spec 11): a client that
// has the story needs to learn it went away; one that never had it filters them out.
func (s *Store) List() ([]IndexEntry, error) {
	entries, err := os.ReadDir(s.storiesDir())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []IndexEntry{}, nil
		}
		return nil, err
	}

	out := make([]IndexEntry, 0, len(entries))
	for _, e := range entries {
		if !e.IsDir() || !ValidID(e.Name()) {
			continue
		}
		m, ok, err := s.readMeta(e.Name())
		if err != nil || !ok {
			// A directory without readable meta is not a story yet (or is mid-repair).
			// Skipping it keeps one bad story from breaking everyone's library.
			continue
		}
		out = append(out, IndexEntry{
			ID:           m.ID,
			IFID:         m.IFID,
			Name:         m.Name,
			Rev:          m.Rev,
			UpdatedAt:    m.UpdatedAt,
			LastClient:   m.LastClient,
			PassageCount: m.PassageCount,
			Bytes:        m.Bytes,
			AssetCount:   m.AssetCount,
			AssetBytes:   m.AssetBytes,
			Deleted:      m.Deleted,
		})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].UpdatedAt != out[j].UpdatedAt {
			return out[i].UpdatedAt > out[j].UpdatedAt
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

// GetStory returns the current body and its meta.
func (s *Store) GetStory(id string) ([]byte, Meta, error) {
	if err := checkID("story", id); err != nil {
		return nil, Meta{}, err
	}
	m, ok, err := s.readMeta(id)
	if err != nil {
		return nil, Meta{}, err
	}
	if !ok {
		return nil, Meta{}, notFound("story")
	}
	if m.Deleted {
		return nil, m, &DeletedError{ID: id}
	}
	body, err := os.ReadFile(s.storyPath(id))
	if errors.Is(err, os.ErrNotExist) {
		return nil, m, notFound("story body")
	}
	if err != nil {
		return nil, m, err
	}
	return body, m, nil
}

// PutOptions are the query-string knobs on a story write.
type PutOptions struct {
	// IfMatch is the rev the client believes it is updating. nil = last write wins.
	IfMatch *int
	// Revive clears a tombstone instead of refusing the write.
	Revive bool
}

// PutStory writes a story body. See writeStoryLocked for the ordering.
func (s *Store) PutStory(id string, raw []byte, c Client, opts PutOptions) (PutResult, error) {
	if err := checkID("story", id); err != nil {
		return PutResult{}, err
	}
	body, sum, err := normalizeStory(raw)
	if err != nil {
		return PutResult{}, err
	}

	defer s.lock(id)()

	m, exists, err := s.readMeta(id)
	if err != nil {
		return PutResult{}, err
	}
	if exists && m.Deleted && !opts.Revive {
		return PutResult{}, &DeletedError{ID: id}
	}
	if opts.IfMatch != nil && *opts.IfMatch != m.Rev {
		return PutResult{}, &ConflictError{Rev: m.Rev, UpdatedAt: m.UpdatedAt, LastClient: m.LastClient}
	}

	revived := exists && m.Deleted
	res, err := s.writeStoryLocked(m, body, sum, c, 0)
	res.Revived = revived
	return res, err
}

// writeStoryLocked is the one path that changes a story body, shared by PUT and restore.
//
// Order is deliberate (spec 11):
//
//  1. new body → temp → rename over story.json. A crash before this leaves the old body.
//  2. gzip the *previous* body into revs/, so the version being replaced is recoverable
//     before anything else can overwrite it.
//  3. rewrite revs/index.json, prune past REV_KEEP.
//  4. meta.json last: it is what makes the new rev visible, so it lands only once the
//     body and its history are both on disk.
//
// The caller holds the story lock and has already checked If-Match and the tombstone.
func (s *Store) writeStoryLocked(m Meta, body []byte, sum storySummary, c Client, restoredFrom int) (PutResult, error) {
	id := m.ID
	newHash := hashBytes(body)

	// Read the outgoing body before it is overwritten — step 2 needs it, and after the
	// rename it is gone.
	var prevBody []byte
	if !m.Deleted && m.Rev > 0 {
		if b, err := os.ReadFile(s.storyPath(id)); err == nil {
			prevBody = b
		}
	}

	if err := writeFileAtomic(s.storyPath(id), body); err != nil {
		return PutResult{}, err
	}

	// An autosave that changed nothing costs nothing: same hash, no snapshot. The rev
	// still moves, because rev is the write counter and the client is entitled to a
	// fresh ETag for the write it just made.
	if prevBody != nil && m.Hash != newHash {
		if err := s.snapshotLocked(&m, prevBody); err != nil {
			return PutResult{}, err
		}
	}

	m.Rev++
	m.Hash = newHash
	m.Bytes = int64(len(body))
	m.Name = sum.name
	m.IFID = sum.ifid
	m.PassageCount = sum.passages
	m.UpdatedAt = nowISO()
	m.LastClient = c.label()
	m.Deleted = false
	m.DeletedAt = ""
	m.RestoredFrom = restoredFrom

	if err := writeJSONAtomic(s.metaPath(id), m); err != nil {
		return PutResult{}, err
	}
	return PutResult{ID: id, Rev: m.Rev, UpdatedAt: m.UpdatedAt, Bytes: m.Bytes}, nil
}

// DeleteStory tombstones a story: the body, the manifest and the asset bytes go, meta.json
// and revs/ stay. That is what lets a Republish (`PUT ?revive=1`) come back with its
// history intact — and it is why the rev is *not* bumped here. A tombstone has no body,
// so there is nothing to snapshot and nothing for a client to have missed; leaving the rev
// alone means the editor that still holds rev 42 can republish with `If-Match: "42"` and
// be right.
//
// purge erases the directory instead, history and all.
func (s *Store) DeleteStory(id string, purge bool, c Client) error {
	if err := checkID("story", id); err != nil {
		return err
	}

	defer s.lock(id)()

	m, exists, err := s.readMeta(id)
	if err != nil {
		return err
	}
	if !exists {
		return notFound("story")
	}

	if purge {
		return os.RemoveAll(s.storyDir(id))
	}

	for _, p := range []string{s.storyPath(id), s.manifestPath(id)} {
		if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	if err := os.RemoveAll(s.assetsDir(id)); err != nil {
		return err
	}

	m.Deleted = true
	m.DeletedAt = nowISO()
	m.UpdatedAt = m.DeletedAt
	m.LastClient = c.label()
	m.AssetCount = 0
	m.AssetBytes = 0
	return writeJSONAtomic(s.metaPath(id), m)
}
