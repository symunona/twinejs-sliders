package store

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// SweepResult is what one janitor pass did, for the log line.
type SweepResult struct {
	OrphanBlobs int
	OrphanBytes int64
	Tombstones  int
	TempFiles   int
}

// Sweep is the janitor: it runs at start and daily.
//
// Two jobs, both time-based rather than immediate, because "the manifest does not mention
// this blob" is a normal transient state — a checkout uploads bytes before the manifest
// that names them, and a client that dropped its connection halfway deserves to resume
// rather than re-upload. ORPHAN_TTL is the grace period for that; TOMBSTONE_TTL is how
// long a deleted story's history stays restorable.
func (s *Store) Sweep(now time.Time) (SweepResult, error) {
	var res SweepResult

	entries, err := os.ReadDir(s.storiesDir())
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return res, nil
		}
		return res, err
	}

	for _, e := range entries {
		if !e.IsDir() || !ValidID(e.Name()) {
			continue
		}
		id := e.Name()
		if err := s.sweepStory(id, now, &res); err != nil {
			return res, err
		}
	}
	return res, nil
}

func (s *Store) sweepStory(id string, now time.Time, res *SweepResult) error {
	defer s.lock(id)()

	meta, ok, err := s.readMeta(id)
	if err != nil || !ok {
		return nil
	}

	if meta.Deleted && meta.DeletedAt != "" {
		if at, err := time.Parse("2006-01-02T15:04:05.000Z", meta.DeletedAt); err == nil {
			if now.Sub(at) > s.opts.TombstoneTTL {
				if err := os.RemoveAll(s.storyDir(id)); err != nil {
					return err
				}
				res.Tombstones++
				return nil
			}
		}
	}

	man, err := s.readManifest(id)
	if err != nil {
		return nil
	}
	named := make(map[string]bool, len(man.Assets))
	for _, info := range man.infos() {
		named[info.ID] = true
	}

	blobs, err := os.ReadDir(s.assetsDir(id))
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	for _, b := range blobs {
		name := b.Name()
		fi, err := b.Info()
		if err != nil {
			continue
		}

		// Temp files are debris from a crash mid-write: nothing ever reads them, and a
		// short TTL keeps a live upload from being swept out from under itself.
		if strings.HasPrefix(name, ".tmp-") {
			if now.Sub(fi.ModTime()) > time.Hour {
				if os.Remove(filepath.Join(s.assetsDir(id), name)) == nil {
					res.TempFiles++
				}
			}
			continue
		}

		assetID := name
		for _, ext := range assetExtensions {
			if strings.HasSuffix(name, ext) {
				assetID = strings.TrimSuffix(name, ext)
				break
			}
		}
		if named[assetID] {
			continue
		}
		if now.Sub(fi.ModTime()) <= s.opts.OrphanTTL {
			continue
		}
		if err := os.Remove(filepath.Join(s.assetsDir(id), name)); err == nil {
			res.OrphanBlobs++
			res.OrphanBytes += fi.Size()
		}
	}
	return nil
}

// DiskUsage totals DATA_DIR, for `/ping`. It walks rather than caching: a handful of
// stories, once per probe, is cheaper than keeping a running total honest.
func (s *Store) DiskUsage() (int64, error) {
	var total int64
	err := filepath.WalkDir(s.opts.Dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			if errors.Is(err, os.ErrNotExist) {
				return nil
			}
			return err
		}
		if d.IsDir() {
			return nil
		}
		if fi, err := d.Info(); err == nil {
			total += fi.Size()
		}
		return nil
	})
	return total, err
}
