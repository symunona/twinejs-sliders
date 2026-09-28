// Package lib is the shared asset library (docs/sliders/plans/asset-library-contract.md).
//
// Four record types — collection, asset, character, binding — share one envelope, one
// write path, one rev chain per record and one global change feed. Blobs are content
// addressed by sha256 and live beside the records. Everything is plain files under
// DATA_DIR/lib; the whole record set is also held in memory, because every client syncs
// every record anyway and the validation rules (names unique per collection, collection
// not empty) need to see all of them.
package lib

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// DefaultMaxRevs is how many revs of one record are kept on disk and listed.
const DefaultMaxRevs = 50

// timeFormat is the `at` field: RFC 3339, UTC, seconds.
const timeFormat = "2006-01-02T15:04:05Z"

// Record is one record as stored and served. Top-level values are kept as raw JSON so
// unknown fields travel verbatim; the server only ever overwrites its own fields.
type Record map[string]json.RawMessage

// Types maps URL path segment → record type.
var Types = map[string]string{
	"collections": "collection",
	"assets":      "asset",
	"characters":  "character",
	"bindings":    "binding",
}

// Options configures a Store.
type Options struct {
	// Dir is DATA_DIR/lib.
	Dir string
	// MaxRevs caps kept revs per record. Zero means DefaultMaxRevs.
	MaxRevs int
	// Now is injectable for tests.
	Now func() time.Time
}

// Change is one accepted write, as announced on the socket.
type Change struct {
	Seq  int64  `json:"seq"`
	Type string `json:"type"`
	ID   string `json:"id"`
	Rev  int    `json:"rev"`
	By   string `json:"by"`
}

// Precondition is what the request's If-Match / If-None-Match said.
type Precondition struct {
	Create bool // If-None-Match: *
	HasRev bool // If-Match present
	Rev    int
}

type feedEntry struct {
	Seq  int64  `json:"seq"`
	Type string `json:"type"`
	ID   string `json:"id"`
	Rev  int    `json:"rev"`
}

type recKey struct{ typ, id string }

type entry struct {
	rec  Record
	info info
}

// Store is the library on disk plus its in-memory index.
type Store struct {
	dir     string
	maxRevs int
	now     func() time.Time

	// mu is the one write mutex the contract asks for. Readers share it.
	mu      sync.RWMutex
	recs    map[recKey]*entry
	feed    []feedEntry
	latest  map[recKey]int64 // seq of the newest feed line per record
	seq     int64
	feedOut *os.File
}

// Open loads (or creates) the library under opts.Dir.
func Open(opts Options) (*Store, error) {
	if opts.MaxRevs <= 0 {
		opts.MaxRevs = DefaultMaxRevs
	}
	if opts.Now == nil {
		opts.Now = time.Now
	}
	s := &Store{
		dir:     opts.Dir,
		maxRevs: opts.MaxRevs,
		now:     opts.Now,
		recs:    map[recKey]*entry{},
		latest:  map[recKey]int64{},
	}
	for _, d := range []string{s.blobsDir(), filepath.Join(s.dir, "records"), filepath.Join(s.dir, "revs")} {
		if err := os.MkdirAll(d, 0o755); err != nil {
			return nil, err
		}
	}
	if err := s.loadRecords(); err != nil {
		return nil, err
	}
	if err := s.loadFeed(); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(s.feedPath(), os.O_WRONLY|os.O_APPEND|os.O_CREATE, 0o644)
	if err != nil {
		return nil, err
	}
	s.feedOut = f
	if err := s.reconcile(); err != nil {
		f.Close()
		return nil, err
	}
	return s, nil
}

// Close releases the feed file.
func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.feedOut == nil {
		return nil
	}
	err := s.feedOut.Close()
	s.feedOut = nil
	return err
}

func (s *Store) feedPath() string { return filepath.Join(s.dir, "feed.jsonl") }
func (s *Store) recordPath(typ, id string) string {
	return filepath.Join(s.dir, "records", typ, id+".json")
}
func (s *Store) revDir(typ, id string) string { return filepath.Join(s.dir, "revs", typ, id) }

func (s *Store) loadRecords() error {
	for _, typ := range Types {
		dir := filepath.Join(s.dir, "records", typ)
		names, err := os.ReadDir(dir)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return err
		}
		for _, n := range names {
			name := n.Name()
			if !strings.HasSuffix(name, ".json") || strings.HasPrefix(name, ".tmp-") {
				continue
			}
			data, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				return err
			}
			var rec Record
			if err := json.Unmarshal(data, &rec); err != nil {
				return fmt.Errorf("lib: %s/%s: %w", typ, name, err)
			}
			id := strings.TrimSuffix(name, ".json")
			s.recs[recKey{typ, id}] = &entry{rec: rec, info: parseInfo(typ, rec)}
		}
	}
	return nil
}

// loadFeed reads feed.jsonl. A torn last line (crash mid-append) is cut off so the next
// append starts on a clean line.
func (s *Store) loadFeed() error {
	data, err := os.ReadFile(s.feedPath())
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if n := len(data); n > 0 && data[n-1] != '\n' {
		cut := bytes.LastIndexByte(data, '\n') + 1
		if err := os.Truncate(s.feedPath(), int64(cut)); err != nil {
			return err
		}
		data = data[:cut]
	}
	sc := bufio.NewScanner(bytes.NewReader(data))
	sc.Buffer(make([]byte, 64<<10), 1<<20)
	for sc.Scan() {
		var e feedEntry
		if json.Unmarshal(sc.Bytes(), &e) != nil || e.Seq <= s.seq {
			continue
		}
		s.feed = append(s.feed, e)
		s.seq = e.Seq
		s.latest[recKey{e.Type, e.ID}] = e.Seq
	}
	return sc.Err()
}

// reconcile appends a feed line for any record whose file is newer than its last feed
// line — the crash window between writing a record and appending to the feed.
func (s *Store) reconcile() error {
	lastRev := map[recKey]int{}
	for _, e := range s.feed {
		lastRev[recKey{e.Type, e.ID}] = e.Rev
	}
	var keys []recKey
	for k, e := range s.recs {
		if r, ok := lastRev[k]; !ok || r < e.info.rev {
			keys = append(keys, k)
		}
	}
	sort.Slice(keys, func(i, j int) bool {
		if keys[i].typ != keys[j].typ {
			return keys[i].typ < keys[j].typ
		}
		return keys[i].id < keys[j].id
	})
	for _, k := range keys {
		if _, err := s.appendFeed(k, s.recs[k].info.rev); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) appendFeed(k recKey, rev int) (int64, error) {
	e := feedEntry{Seq: s.seq + 1, Type: k.typ, ID: k.id, Rev: rev}
	line, _ := json.Marshal(e)
	line = append(line, '\n')
	if _, err := s.feedOut.Write(line); err != nil {
		return 0, err
	}
	if err := s.feedOut.Sync(); err != nil {
		return 0, err
	}
	s.seq = e.Seq
	s.feed = append(s.feed, e)
	s.latest[k] = e.Seq
	return e.Seq, nil
}

// Head is the current feed seq.
func (s *Store) Head() int64 {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.seq
}

// Get returns the current record, or nil.
func (s *Store) Get(typ, id string) Record {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if e := s.recs[recKey{typ, id}]; e != nil {
		return e.rec
	}
	return nil
}

// ChangeItem is one /changes item.
type ChangeItem struct {
	Seq    int64  `json:"seq"`
	Record Record `json:"record"`
}

// Changes lists records changed after since, one item per record at its newest seq,
// ascending. more reports whether items remain past the page.
func (s *Store) Changes(since int64, limit int) (items []ChangeItem, head int64, more bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	items = []ChangeItem{}
	i := sort.Search(len(s.feed), func(i int) bool { return s.feed[i].Seq > since })
	for ; i < len(s.feed); i++ {
		fe := s.feed[i]
		k := recKey{fe.Type, fe.ID}
		e := s.recs[k]
		if s.latest[k] != fe.Seq || e == nil {
			continue
		}
		if len(items) == limit {
			more = true
			break
		}
		items = append(items, ChangeItem{Seq: fe.Seq, Record: e.rec})
	}
	head = s.seq
	if len(items) > 0 {
		head = items[len(items)-1].Seq
	}
	return items, head, more
}

// RevItem is one /revs row.
type RevItem struct {
	Rev    int             `json:"rev"`
	By     json.RawMessage `json:"by"`
	At     json.RawMessage `json:"at"`
	Record Record          `json:"record"`
}

// Revs lists kept revs, newest first, at most MaxRevs. ok is false for an unknown record.
func (s *Store) Revs(typ, id string) ([]RevItem, bool, error) {
	if s.Get(typ, id) == nil {
		return nil, false, nil
	}
	dir := s.revDir(typ, id)
	names, err := os.ReadDir(dir)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, true, err
	}
	var revs []int
	for _, n := range names {
		if r, err := strconv.Atoi(strings.TrimSuffix(n.Name(), ".json")); err == nil && strings.HasSuffix(n.Name(), ".json") {
			revs = append(revs, r)
		}
	}
	sort.Sort(sort.Reverse(sort.IntSlice(revs)))
	if len(revs) > s.maxRevs {
		revs = revs[:s.maxRevs]
	}
	out := make([]RevItem, 0, len(revs))
	for _, r := range revs {
		data, err := os.ReadFile(filepath.Join(dir, strconv.Itoa(r)+".json"))
		if err != nil {
			continue // pruned under us
		}
		var rec Record
		if json.Unmarshal(data, &rec) != nil {
			continue
		}
		out = append(out, RevItem{Rev: r, By: rec["by"], At: rec["at"], Record: rec})
	}
	return out, true, nil
}

// Put creates or updates a record. body is the client's JSON object.
func (s *Store) Put(typ, id string, body []byte, pre Precondition, by string) (Record, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	k := recKey{typ, id}
	cur := s.recs[k]
	if err := checkPre(cur, pre); err != nil {
		return nil, 0, err
	}

	rec, err := decodeRecord(typ, id, body)
	if err != nil {
		return nil, 0, err
	}
	deleted := false
	if raw, ok := rec["deleted"]; ok && string(raw) != "null" {
		if err := json.Unmarshal(raw, &deleted); err != nil {
			return nil, 0, badRecord("deleted must be a boolean")
		}
	}
	rec["deleted"] = jsonBool(deleted)
	nfo := parseInfo(typ, rec)
	if err := validateShape(nfo); err != nil {
		return nil, 0, err
	}
	if deleted {
		if err := s.checkDeletable(k); err != nil {
			return nil, 0, err
		}
	} else if err := s.checkLive(k, nfo); err != nil {
		return nil, 0, err
	}
	return s.commit(k, cur, rec, by)
}

// Delete tombstones a record.
func (s *Store) Delete(typ, id string, pre Precondition, by string) (Record, int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	k := recKey{typ, id}
	cur := s.recs[k]
	if cur == nil {
		return nil, 0, &Error{Status: 404, Code: "not-found"}
	}
	if !pre.HasRev {
		return nil, 0, &Error{Status: 428, Code: "precondition-required"}
	}
	if err := checkPre(cur, pre); err != nil {
		return nil, 0, err
	}
	if err := s.checkDeletable(k); err != nil {
		return nil, 0, err
	}
	rec := make(Record, len(cur.rec))
	for f, v := range cur.rec {
		rec[f] = v
	}
	rec["deleted"] = jsonBool(true)
	return s.commit(k, cur, rec, by)
}

func checkPre(cur *entry, pre Precondition) error {
	switch {
	case pre.HasRev:
		if cur == nil || cur.info.rev != pre.Rev {
			return stale(cur)
		}
	case pre.Create:
		if cur != nil {
			return stale(cur)
		}
	default:
		return &Error{Status: 428, Code: "precondition-required"}
	}
	return nil
}

func stale(cur *entry) error {
	var current any
	if cur != nil {
		current = cur.rec
	}
	return &Error{Status: 412, Code: "stale", Extra: map[string]any{"current": current}}
}

// commit is the write path: rev+1, rev file, record file, feed line, memory.
func (s *Store) commit(k recKey, cur *entry, rec Record, by string) (Record, int64, error) {
	rev := 1
	if cur != nil {
		rev = cur.info.rev + 1
	}
	byJSON, _ := json.Marshal(by)
	rec["id"], _ = json.Marshal(k.id)
	rec["type"], _ = json.Marshal(k.typ)
	rec["rev"] = json.RawMessage(strconv.Itoa(rev))
	rec["by"] = byJSON
	rec["at"], _ = json.Marshal(s.now().UTC().Format(timeFormat))

	data, err := json.Marshal(rec)
	if err != nil {
		return nil, 0, err
	}
	revDir := s.revDir(k.typ, k.id)
	if err := writeFileAtomic(filepath.Join(revDir, strconv.Itoa(rev)+".json"), data); err != nil {
		return nil, 0, err
	}
	if old := rev - s.maxRevs; old > 0 {
		_ = os.Remove(filepath.Join(revDir, strconv.Itoa(old)+".json"))
	}
	if err := writeFileAtomic(s.recordPath(k.typ, k.id), data); err != nil {
		return nil, 0, err
	}
	s.recs[k] = &entry{rec: rec, info: parseInfo(k.typ, rec)}
	seq, err := s.appendFeed(k, rev)
	if err != nil {
		// The record is on disk; reconcile on next start puts it in the feed.
		return nil, 0, err
	}
	return rec, seq, nil
}

// writeFileAtomic: temp file in the target directory, fsync, rename.
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
	defer os.Remove(tmp)
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

func jsonBool(b bool) json.RawMessage {
	if b {
		return json.RawMessage("true")
	}
	return json.RawMessage("false")
}

// decodeRecord parses the body and checks id/type against the path.
func decodeRecord(typ, id string, body []byte) (Record, error) {
	if !validID(typ, id) {
		return nil, badRecord("invalid id for " + typ)
	}
	var rec Record
	dec := json.NewDecoder(bytes.NewReader(body))
	if err := dec.Decode(&rec); err != nil || rec == nil {
		return nil, badRecord("body must be a JSON object")
	}
	if _, err := dec.Token(); err != io.EOF {
		return nil, badRecord("trailing data after JSON object")
	}
	for field, want := range map[string]string{"id": id, "type": typ} {
		raw, ok := rec[field]
		if !ok || string(raw) == "null" {
			continue
		}
		var got string
		if json.Unmarshal(raw, &got) != nil || got != want {
			return nil, badRecord(field + " does not match the path")
		}
	}
	return rec, nil
}
