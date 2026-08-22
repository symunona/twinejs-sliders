// Package store is the filesystem half of the story backup server (spec 11).
//
// Everything lives under DATA_DIR in one directory per story:
//
//	stories/<id>/story.json           current body, verbatim minus `sync`
//	stories/<id>/assets.json          current manifest
//	stories/<id>/meta.json            rev, times, tombstone flag, cached counts
//	stories/<id>/revs/index.json      snapshot list, oldest first
//	stories/<id>/revs/000042.json.gz  body at rev 42
//	stories/<id>/revs/000042.assets.gz manifest as of rev 42, when it changed
//	stories/<id>/assets/<id><ext>     raw bytes
//
// Two rules hold the whole thing up: every file lands by temp-file + rename, so a crash
// or a dropped connection can only ever leave the previous good version behind; and every
// mutation of one story runs under that story's mutex, so "read meta, write body, bump
// rev" is atomic against a second request for the same story.
package store

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sync"
	"time"
)

// Options is the slice of the server config the store cares about.
type Options struct {
	// Dir is DATA_DIR: the parent of `stories/`.
	Dir string
	// RevKeep is how many snapshots survive per story.
	RevKeep int
	// OrphanTTL is how long an asset blob may sit unnamed by the manifest.
	OrphanTTL time.Duration
	// TombstoneTTL is how long a deleted story's history survives.
	TombstoneTTL time.Duration
}

// Client is the identity label on a request. It is not a credential (spec 11: "anyone
// with the token can claim any name; nobody is trying to").
type Client struct {
	ID   string
	Name string
}

// Name falls back to "unknown" so revision rows and lastClient are never blank.
func (c Client) label() string {
	if c.Name == "" {
		return "unknown"
	}
	return c.Name
}

// Store owns DATA_DIR. Safe for concurrent use.
type Store struct {
	opts Options

	// locks serialises writes per story id. Entries are never removed: a handful of
	// stories means a handful of mutexes, and reclaiming them would need refcounting
	// that buys nothing here.
	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

// New prepares DATA_DIR. It creates the tree if it is missing so a fresh deploy — and
// every t.TempDir() in the tests — works with no setup step.
func New(opts Options) (*Store, error) {
	if opts.RevKeep < 1 {
		opts.RevKeep = 1
	}
	s := &Store{opts: opts, locks: make(map[string]*sync.Mutex)}
	if err := os.MkdirAll(s.storiesDir(), 0o755); err != nil {
		return nil, err
	}
	return s, nil
}

// Options returns the configuration this store was built with.
func (s *Store) Options() Options { return s.opts }

func (s *Store) storiesDir() string { return filepath.Join(s.opts.Dir, "stories") }

func (s *Store) storyDir(id string) string { return filepath.Join(s.storiesDir(), id) }

func (s *Store) storyPath(id string) string { return filepath.Join(s.storyDir(id), "story.json") }

func (s *Store) manifestPath(id string) string { return filepath.Join(s.storyDir(id), "assets.json") }

func (s *Store) metaPath(id string) string { return filepath.Join(s.storyDir(id), "meta.json") }

func (s *Store) revsDir(id string) string { return filepath.Join(s.storyDir(id), "revs") }

func (s *Store) assetsDir(id string) string { return filepath.Join(s.storyDir(id), "assets") }

// lock takes the per-story mutex and hands back its release. Callers use
// `defer s.lock(id)()`.
func (s *Store) lock(id string) func() {
	s.mu.Lock()
	m, ok := s.locks[id]
	if !ok {
		m = &sync.Mutex{}
		s.locks[id] = m
	}
	s.mu.Unlock()

	m.Lock()
	return m.Unlock
}

// idPattern keeps ids to something that is safe as a single path element: no separators,
// no dots-only names, nothing that could climb out of DATA_DIR. Story ids are uuids and
// asset ids come from packages/asset-store, so this rejects nothing legitimate.
var idPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)

// ValidID reports whether an id is usable as a directory or file name.
func ValidID(id string) bool {
	if !idPattern.MatchString(id) {
		return false
	}
	// ".." cannot match the pattern (it starts with a dot), but a name that is all dots
	// after the first character still deserves a no.
	return id != "." && id != ".."
}

func checkID(kind, id string) error {
	if !ValidID(id) {
		return badRequest("invalid %s id", kind)
	}
	return nil
}

// nowISO matches JavaScript's Date#toISOString, so timestamps round-trip through the
// editor without a format negotiation.
func nowISO() string {
	return time.Now().UTC().Format("2006-01-02T15:04:05.000Z")
}

func hashBytes(b []byte) string {
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:])
}

// writeFileAtomic writes to a temp file in the destination's own directory and renames
// over the target. Same directory matters: rename is only atomic within a filesystem.
func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	f, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmp := f.Name()
	defer os.Remove(tmp) // no-op once the rename succeeded

	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tmp, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// stageFile streams a body into a temp file beside its eventual home and reports what it
// wrote. Staging is split from committing because an upload has to be *verified* before
// it can be visible: a truncated or mis-hashed asset that reached its final path would
// then pass HEAD and be trusted forever.
func stageFile(dir string, r io.Reader) (string, int64, string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", 0, "", err
	}
	f, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return "", 0, "", err
	}
	tmp := f.Name()

	sum := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, sum), r)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return "", n, "", err
	}
	return tmp, n, hex.EncodeToString(sum.Sum(nil)), nil
}

// commitFile makes a staged file the real one.
func commitFile(tmp, dest string) error {
	if err := os.Chmod(tmp, 0o644); err != nil {
		os.Remove(tmp)
		return err
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o755); err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dest)
}

func writeJSONAtomic(path string, v any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return writeFileAtomic(path, data)
}

func readJSONFile(path string, v any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, v)
}
