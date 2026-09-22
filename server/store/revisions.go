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
	"unicode"
	"unicode/utf8"
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

	// Label is what a human typed about this version. Free text, <=120 runes.
	Label string `json:"label,omitempty"`
	// Pinned takes this version out of the prune: REV_KEEP counts unpinned snapshots
	// only, so a pinned one lives until somebody unpins it. PINNED_MAX caps how many a
	// story may hold, which is what stops a script filling the disk.
	Pinned bool `json:"pinned,omitempty"`
	// Summary is the CLIENT's one-line description of the write that produced this
	// version ("Tavern Night +2 more"). It arrives on the PUT/PATCH that made the rev,
	// because only the client has both sides of the diff and the author's intent. It is
	// never trusted for anything but display: clamped to 200 bytes, control characters
	// stripped, and not validated further.
	//
	// All three are `omitempty`: an index written before this feature loads with the
	// zero value, and an index written after it is byte-identical to the old shape when
	// nobody labelled anything.
	Summary string `json:"summary,omitempty"`
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
	// Label, pin and summary live on meta.json while their rev is the current one —
	// there is no index row for the current version, because the current version is
	// story.json. Snapshotting is where they move onto the row that from now on owns
	// them. writeStoryLocked clears them off the meta afterwards.
	index = append(index, RevisionEntry{
		Rev:          m.Rev,
		At:           m.UpdatedAt,
		Client:       m.LastClient,
		Bytes:        m.Bytes,
		Hash:         m.Hash,
		Passages:     m.PassageCount,
		RestoredFrom: m.RestoredFrom,
		Label:        m.RevLabel,
		Pinned:       m.RevPinned,
		Summary:      m.RevSummary,
	})

	index, err = s.pruneLocked(id, index)
	if err != nil {
		return err
	}
	return writeJSONAtomic(s.revIndexPath(id), index)
}

// pruneLocked drops the oldest snapshots once there are more than REV_KEEP of them.
//
// REV_KEEP counts UNPINNED snapshots only, and only unpinned ones are ever deleted. A pin
// is the author saying "this one matters", and a policy knob about disk usage is not
// allowed to overrule that. PINNED_MAX is what bounds the disk instead — see
// SetRevisionMeta.
//
// The one subtlety is the manifest: it is only snapshotted when it changed, so a
// surviving body can be relying on an `.assets.gz` that belongs to a rev about to be
// deleted. Rather than lose it, the doomed file is renamed onto the oldest survivor that
// needs it — the same bytes, filed under the rev that now has to answer for them. Later
// survivors then find it there, because manifestAtRev takes the newest file at or below
// the rev it was asked about.
func (s *Store) pruneLocked(id string, index []RevisionEntry) ([]RevisionEntry, error) {
	unpinned := 0
	for _, e := range index {
		if !e.Pinned {
			unpinned++
		}
	}
	if unpinned <= s.opts.RevKeep {
		return index, nil
	}

	cut := unpinned - s.opts.RevKeep
	doomed := make(map[int]bool, cut)
	kept := make([]RevisionEntry, 0, len(index)-cut)
	for _, e := range index {
		if !e.Pinned && cut > 0 {
			doomed[e.Rev] = true
			cut--
			continue
		}
		kept = append(kept, e)
	}

	// Rescue the manifests before anything is unlinked: which file answers for a
	// survivor has to be read off the disk as it stands now.
	manifests, err := s.manifestRevs(id)
	if err != nil {
		return nil, err
	}
	for _, e := range kept {
		src := newestAtOrBelow(manifests, e.Rev)
		if src < 0 || !doomed[src] {
			continue
		}
		if err := os.Rename(s.revAssetsPath(id, src), s.revAssetsPath(id, e.Rev)); err != nil {
			return nil, err
		}
		delete(doomed, src)
		// The bytes now answer under e.Rev, so the list has to say so: a later survivor
		// asks the same question and must not be pointed at a path that is gone.
		next := manifests[:0]
		for _, n := range manifests {
			if n != src {
				next = append(next, n)
			}
		}
		manifests = append(next, e.Rev)
		sort.Ints(manifests)
	}

	for rev := range doomed {
		for _, p := range []string{s.revBodyPath(id, rev), s.revAssetsPath(id, rev)} {
			if err := os.Remove(p); err != nil && !errors.Is(err, os.ErrNotExist) {
				return nil, err
			}
		}
	}
	return kept, nil
}

// manifestRevs lists, ascending, the revs that have an `.assets.gz` on disk.
func (s *Store) manifestRevs(id string) ([]int, error) {
	entries, err := os.ReadDir(s.revsDir(id))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil
		}
		return nil, err
	}
	var out []int
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".assets.gz") {
			continue
		}
		if n, err := strconv.Atoi(strings.TrimSuffix(name, ".assets.gz")); err == nil {
			out = append(out, n)
		}
	}
	sort.Ints(out)
	return out, nil
}

// newestAtOrBelow is the rule manifestAtRev reads by, so the prune can ask the same
// question the reader will. -1 means nothing covers that rev.
func newestAtOrBelow(sorted []int, rev int) int {
	best := -1
	for _, n := range sorted {
		if n > rev {
			break
		}
		best = n
	}
	return best
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
			Label:        m.RevLabel,
			Pinned:       m.RevPinned,
			Summary:      m.RevSummary,
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

	// A restore carries no client summary: `restoredFrom` on the row already says what
	// the write was, and saying it twice in two vocabularies helps nobody.
	res, err := s.writeStoryLocked(m, body, sum, c, rev, "")
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

// ---------------------------------------------------------------------------
// Labels and pins
// ---------------------------------------------------------------------------

// RevisionMeta is the change a label request asks for. Both fields are pointers because
// "leave it alone" and "set it to the zero value" are different requests: nil is
// unchanged, a pointer to "" clears the label, a pointer to false unpins.
type RevisionMeta struct {
	Label  *string
	Pinned *bool
}

// RevisionMetaResult is RevisionMetaResponse in server.types.ts — the row as it now
// stands, so the dialog can replace it without re-listing, plus how many pins the story
// holds so the UI can warn before it hits PINNED_MAX.
type RevisionMetaResult struct {
	ID      string `json:"id"`
	Rev     int    `json:"rev"`
	Label   string `json:"label"`
	Pinned  bool   `json:"pinned"`
	Summary string `json:"summary"`
	Pins    int    `json:"pins"`
	Max     int    `json:"pinnedMax"`
}

// SetRevisionMeta writes a label and/or a pin onto one revision.
//
// It is NOT a write of the story: no rev bump, no snapshot, no `story` broadcast. Naming
// a version you already have does not make it a different version, and a rev bump would
// send every other editor off to re-pull a body that did not move.
//
// It still takes the story lock, because the file it rewrites — revs/index.json — is the
// same file an autosave's snapshot rewrites, and the two racing would lose one of them.
func (s *Store) SetRevisionMeta(id string, rev int, want RevisionMeta) (RevisionMetaResult, error) {
	if err := checkID("story", id); err != nil {
		return RevisionMetaResult{}, err
	}

	defer s.lock(id)()

	m, ok, err := s.readMeta(id)
	if err != nil {
		return RevisionMetaResult{}, err
	}
	if !ok {
		return RevisionMetaResult{}, notFound("story")
	}

	index, err := s.readRevIndex(id)
	if err != nil {
		return RevisionMetaResult{}, err
	}

	// The current version lives on meta.json, not in the index — it is story.json, which
	// has no row of its own. Labelling it has to work anyway: it is the top row of the
	// History dialog and the one a voice-mode checkpoint means. snapshotLocked moves
	// these onto the index row when the version is eventually replaced.
	current := rev == m.Rev && !m.Deleted
	at := -1
	if !current {
		for i := range index {
			if index[i].Rev == rev {
				at = i
				break
			}
		}
		if at < 0 {
			return RevisionMetaResult{}, notFound("revision")
		}
	}

	was := RevisionEntry{Label: m.RevLabel, Pinned: m.RevPinned, Summary: m.RevSummary}
	if !current {
		was = index[at]
	}

	label, pinned := was.Label, was.Pinned
	if want.Label != nil {
		label = clampLabel(*want.Label)
	}
	if want.Pinned != nil {
		pinned = *want.Pinned
	}

	pins := 0
	if m.RevPinned && !m.Deleted {
		pins++
	}
	for _, e := range index {
		if e.Pinned {
			pins++
		}
	}
	if pinned && !was.Pinned && pins >= s.opts.PinnedMax {
		return RevisionMetaResult{}, badRequest(
			"story already has %d pinned revisions (PINNED_MAX); unpin one before pinning another", pins)
	}
	if pinned != was.Pinned {
		if pinned {
			pins++
		} else {
			pins--
		}
	}

	if current {
		m.RevLabel, m.RevPinned = label, pinned
		if err := writeJSONAtomic(s.metaPath(id), m); err != nil {
			return RevisionMetaResult{}, err
		}
	} else {
		index[at].Label, index[at].Pinned = label, pinned
		if err := writeJSONAtomic(s.revIndexPath(id), index); err != nil {
			return RevisionMetaResult{}, err
		}
	}

	return RevisionMetaResult{
		ID: id, Rev: rev, Label: label, Pinned: pinned, Summary: was.Summary,
		Pins: pins, Max: s.opts.PinnedMax,
	}, nil
}

// maxLabelRunes and maxSummaryBytes are the two clamps. The label is measured in runes
// because a human typed it into a box with a character counter; the summary is measured
// in bytes because nobody typed it — it is machine text the server only has to store, and
// a byte bound is the one that actually bounds the file.
const (
	maxLabelRunes   = 120
	maxSummaryBytes = 200
)

// clampLabel and clampSummary are the whole of the validation. Neither string means
// anything to the server: they are display text, written by whoever holds the token, and
// the only real requirements are that they cannot blow up the index file and cannot smear
// a terminal or a log line. So: strip control characters (newlines and tabs included —
// both of these are one line by construction), trim, and cut to length.
func clampLabel(v string) string {
	v = stripControl(v)
	runes := []rune(v)
	if len(runes) > maxLabelRunes {
		v = string(runes[:maxLabelRunes])
	}
	return strings.TrimSpace(v)
}

func clampSummary(v string) string {
	v = stripControl(v)
	if len(v) > maxSummaryBytes {
		// Cut on a rune boundary: a half-encoded rune would make the index file invalid
		// UTF-8 and every reader's problem.
		cut := maxSummaryBytes
		for cut > 0 && !utf8.RuneStart(v[cut]) {
			cut--
		}
		v = v[:cut]
	}
	return strings.TrimSpace(v)
}

func stripControl(v string) string {
	return strings.Map(func(r rune) rune {
		if r == utf8.RuneError || unicode.IsControl(r) {
			return -1
		}
		return r
	}, v)
}
