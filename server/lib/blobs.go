package lib

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// BlobInfo is the PUT /blobs/{sha} answer.
type BlobInfo struct {
	Sha   string `json:"sha"`
	Bytes int64  `json:"bytes"`
	Mime  string `json:"mime"`
}

const defaultMime = "application/octet-stream"

func (s *Store) blobsDir() string { return filepath.Join(s.dir, "blobs") }

// BlobPath is DATA_DIR/lib/blobs/<first two>/<sha>. sha must be valid.
func (s *Store) BlobPath(sha string) string {
	return filepath.Join(s.blobsDir(), sha[:2], sha)
}

func (s *Store) mimePath(sha string) string { return s.BlobPath(sha) + ".mime" }

// HasBlob reports whether the blob is stored.
func (s *Store) HasBlob(sha string) bool {
	if !ValidSha(sha) {
		return false
	}
	fi, err := os.Stat(s.BlobPath(sha))
	return err == nil && fi.Mode().IsRegular()
}

// Blob returns stored metadata, ok false when absent.
func (s *Store) Blob(sha string) (BlobInfo, bool) {
	if !ValidSha(sha) {
		return BlobInfo{}, false
	}
	fi, err := os.Stat(s.BlobPath(sha))
	if err != nil || !fi.Mode().IsRegular() {
		return BlobInfo{}, false
	}
	mime := defaultMime
	if b, err := os.ReadFile(s.mimePath(sha)); err == nil && len(b) > 0 {
		mime = strings.TrimSpace(string(b))
	}
	return BlobInfo{Sha: sha, Bytes: fi.Size(), Mime: mime}, true
}

// PutBlob streams r into the blob store, hashing on the way. A blob that already exists
// is answered from disk without reading r. Hash mismatch → 422.
func (s *Store) PutBlob(sha, mime string, r io.Reader) (BlobInfo, error) {
	if info, ok := s.Blob(sha); ok {
		return info, nil
	}
	mime = strings.TrimSpace(mime)
	if mime == "" {
		mime = defaultMime
	}
	dir := filepath.Dir(s.BlobPath(sha))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return BlobInfo{}, err
	}
	f, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return BlobInfo{}, err
	}
	tmp := f.Name()
	defer os.Remove(tmp)

	h := sha256.New()
	n, err := io.Copy(io.MultiWriter(f, h), r)
	if err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		return BlobInfo{}, err
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != sha {
		return BlobInfo{}, &Error{Status: 422, Code: "hash-mismatch", Extra: map[string]any{"got": got}}
	}
	// mime first: a blob visible without its mime would serve as octet-stream forever.
	if err := writeFileAtomic(s.mimePath(sha), []byte(mime)); err != nil {
		return BlobInfo{}, err
	}
	if err := os.Chmod(tmp, 0o644); err != nil {
		return BlobInfo{}, err
	}
	if err := os.Rename(tmp, s.BlobPath(sha)); err != nil {
		return BlobInfo{}, err
	}
	return BlobInfo{Sha: sha, Bytes: n, Mime: mime}, nil
}

// MissingBlobs filters hashes to those not stored (invalid shas count as missing).
func (s *Store) MissingBlobs(hashes []string) []string {
	out := []string{}
	seen := map[string]bool{}
	for _, h := range hashes {
		if seen[h] {
			continue
		}
		seen[h] = true
		if !s.HasBlob(h) {
			out = append(out, h)
		}
	}
	return out
}

// SweepResult is one lib GC pass.
type SweepResult struct {
	Blobs     int
	Bytes     int64
	TempFiles int
}

// Sweep deletes blobs named by no current record and no kept rev, once older than ttl
// (the grace between a blob upload and the record PUT naming it). Temp files older than
// an hour go too. Holds the write lock so no record can start naming a blob mid-sweep.
func (s *Store) Sweep(now time.Time, ttl time.Duration) (SweepResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	var res SweepResult
	live := map[string]bool{}
	for k, e := range s.recs {
		if k.typ != "asset" {
			continue
		}
		for _, b := range e.info.blobs {
			live[b] = true
		}
		dir := s.revDir(k.typ, k.id)
		names, _ := os.ReadDir(dir)
		for _, n := range names {
			if !strings.HasSuffix(n.Name(), ".json") || strings.HasPrefix(n.Name(), ".tmp-") {
				continue
			}
			data, err := os.ReadFile(filepath.Join(dir, n.Name()))
			if err != nil {
				continue
			}
			var rec Record
			if err := json.Unmarshal(data, &rec); err != nil {
				// Unreadable rev: cannot prove its blobs dead, so abort the sweep.
				return res, err
			}
			for _, b := range parseInfo("asset", rec).blobs {
				live[b] = true
			}
		}
	}

	shards, err := os.ReadDir(s.blobsDir())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return res, nil
		}
		return res, err
	}
	for _, shard := range shards {
		if !shard.IsDir() {
			continue
		}
		dir := filepath.Join(s.blobsDir(), shard.Name())
		files, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, f := range files {
			name := f.Name()
			fi, err := f.Info()
			if err != nil {
				continue
			}
			path := filepath.Join(dir, name)
			if strings.HasPrefix(name, ".tmp-") {
				if now.Sub(fi.ModTime()) > time.Hour && os.Remove(path) == nil {
					res.TempFiles++
				}
				continue
			}
			if !ValidSha(name) || live[name] || now.Sub(fi.ModTime()) <= ttl {
				continue
			}
			if os.Remove(path) == nil {
				_ = os.Remove(path + ".mime")
				res.Blobs++
				res.Bytes += fi.Size()
			}
		}
	}
	return res, nil
}
