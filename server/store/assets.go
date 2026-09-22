package store

import (
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// ManifestVersion is the `version` field of assets.json.
const ManifestVersion = 1

// Manifest is AssetManifest in server.types.ts. `assets` and `characters` stay raw so
// `AssetMeta` and `Character` are whatever @sliders/scene-types says today — the server
// stores art bookkeeping, it does not have opinions about it.
type Manifest struct {
	Version    int               `json:"version"`
	Assets     []json.RawMessage `json:"assets"`
	Characters []json.RawMessage `json:"characters"`
	Rev        int               `json:"rev"`
	// Missing is computed per response, never stored: it is a fact about the blobs on
	// disk right now, not about the manifest.
	Missing []string `json:"missing"`
}

// storedManifest is the on-disk shape — Manifest without the computed field.
type storedManifest struct {
	Version    int               `json:"version"`
	Assets     []json.RawMessage `json:"assets"`
	Characters []json.RawMessage `json:"characters"`
	Rev        int               `json:"rev"`
}

// normalize keeps every array non-nil so the JSON has `[]` rather than `null`; the client
// iterates these without guarding.
func (m *Manifest) normalize() {
	if m.Version == 0 {
		m.Version = ManifestVersion
	}
	if m.Assets == nil {
		m.Assets = []json.RawMessage{}
	}
	if m.Characters == nil {
		m.Characters = []json.RawMessage{}
	}
	if m.Missing == nil {
		m.Missing = []string{}
	}
}

// assetInfo is the handful of AssetMeta fields the server itself uses.
type assetInfo struct {
	ID    string `json:"id"`
	Hash  string `json:"hash"`
	Mime  string `json:"mime"`
	Bytes int64  `json:"bytes"`
	// Sidecars stays raw for the same reason the manifest keeps whole entries raw: the
	// editor owns the shape. Decoding it here into a map would make an entry written by
	// an older build — `"sidecars": ["source","cutout"]` — fail to unmarshal, and a
	// failed entry is one infos() drops, which tells the janitor the asset's own blob is
	// unnamed. A field the server barely reads must not be able to delete an asset.
	Sidecars json.RawMessage `json:"sidecars"`
}

// sidecarIDs names the blobs this asset owns besides its own: `<id>.<kind>` for every
// key of the `sidecars` object, which is exactly the name a pushed sidecar lands under on
// disk.
//
// Every shape that is not the current object form — absent, null, the old array — names
// nothing and is not an error. This is the one direction the ambiguity may fall: naming
// too few blobs costs a re-upload, naming too many keeps bytes alive a while longer, but
// an error that aborted or emptied the set would sweep files nobody can get back.
func (a assetInfo) sidecarIDs() []string {
	if a.ID == "" || len(a.Sidecars) == 0 {
		return nil
	}
	var kinds map[string]json.RawMessage
	if err := json.Unmarshal(a.Sidecars, &kinds); err != nil {
		return nil
	}
	out := make([]string, 0, len(kinds))
	for kind := range kinds {
		id := a.ID + "." + kind
		// PutAsset refuses anything ValidID refuses, so a kind that does not survive it
		// cannot have a blob on disk to name in the first place.
		if !ValidID(id) {
			continue
		}
		out = append(out, id)
	}
	return out
}

func (m Manifest) infos() []assetInfo {
	out := make([]assetInfo, 0, len(m.Assets))
	for _, raw := range m.Assets {
		var info assetInfo
		if err := json.Unmarshal(raw, &info); err != nil || info.ID == "" {
			continue
		}
		out = append(out, info)
	}
	return out
}

// info finds the manifest entry that describes one stored blob.
//
// A sidecar blob is stored under `<assetID>.<kind>` and is named nowhere at top level, so
// a miss falls through to the base asset's `sidecars` object. Without that, every sidecar
// looks like bytes the manifest cannot vouch for: Diff calls them `stale` and the client
// re-uploads each one on every push, forever, and Asset serves them with no ETag and no
// Content-Type.
func (m Manifest) info(id string) (assetInfo, bool) {
	infos := m.infos()
	for _, info := range infos {
		if info.ID == id {
			return info, true
		}
	}

	// Split on the LAST dot. A kind is a slug and cannot contain one, while ValidID
	// permits dots in an asset id — ids are `a_` plus hex today, but the pattern is the
	// contract, not today's generator.
	dot := strings.LastIndex(id, ".")
	if dot <= 0 || dot == len(id)-1 {
		return assetInfo{}, false
	}
	base, kind := id[:dot], id[dot+1:]
	for _, parent := range infos {
		if parent.ID == base {
			return parent.sidecar(kind)
		}
	}
	return assetInfo{}, false
}

// sidecarMeta is the handful of sidecar fields the server uses. Every one is optional:
// entries written before sidecars carried metadata have none of them.
type sidecarMeta struct {
	Hash  string `json:"hash"`
	Bytes int64  `json:"bytes"`
	Mime  string `json:"mime"`
}

// sidecar looks one kind up in this asset's `sidecars` object and answers as the manifest
// entry for that blob.
//
// A kind with no hash resolves to nothing rather than to an entry with a blank one. Diff
// compares hashes for equality, so a blank would answer `present` to a client that also
// sent a blank — vouching for bytes nobody ever hashed, which is the one thing that branch
// must not do. Such an entry stays exactly as it is today: unknown, therefore `stale`,
// therefore re-uploaded, which is the safe end of the trade.
//
// sidecarIDs still names it, hash or no hash. The janitor asks whether something owns
// these bytes; Diff asks whether the server can vouch for them. Different questions.
func (a assetInfo) sidecar(kind string) (assetInfo, bool) {
	if kind == "" || len(a.Sidecars) == 0 {
		return assetInfo{}, false
	}
	// Per-kind raw, so one junk value does not blind the kinds beside it — and so the old
	// array form is a miss rather than anything worse.
	var kinds map[string]json.RawMessage
	if err := json.Unmarshal(a.Sidecars, &kinds); err != nil {
		return assetInfo{}, false
	}
	raw, ok := kinds[kind]
	if !ok {
		return assetInfo{}, false
	}
	var side sidecarMeta
	if err := json.Unmarshal(raw, &side); err != nil || side.Hash == "" {
		return assetInfo{}, false
	}
	return assetInfo{ID: a.ID + "." + kind, Hash: side.Hash, Mime: side.Mime, Bytes: side.Bytes}, true
}

// assetExtensions is the closed set of names a blob can have on disk. Reads try each in
// turn instead of globbing, so an asset id containing a dot cannot be confused with a
// different asset's extension.
var assetExtensions = []string{".webp", ".png", ".jpg", ".gif", ".bin"}

// extForMime picks the on-disk extension. It exists for humans poking around DATA_DIR —
// nothing in the protocol reads it back, which is why anything unrecognised is .bin
// rather than an error.
func extForMime(mime string) string {
	switch strings.ToLower(strings.TrimSpace(strings.SplitN(mime, ";", 2)[0])) {
	case "image/webp":
		return ".webp"
	case "image/png":
		return ".png"
	case "image/jpeg", "image/jpg":
		return ".jpg"
	case "image/gif":
		return ".gif"
	default:
		return ".bin"
	}
}

// blobPath finds an existing blob for an asset id, whatever extension it landed under.
func (s *Store) blobPath(storyID, assetID string) (string, os.FileInfo, bool) {
	for _, ext := range assetExtensions {
		p := filepath.Join(s.assetsDir(storyID), assetID+ext)
		if fi, err := os.Stat(p); err == nil && fi.Mode().IsRegular() {
			return p, fi, true
		}
	}
	return "", nil, false
}

func (s *Store) missingAssets(storyID string, m Manifest) []string {
	missing := []string{}
	for _, info := range m.infos() {
		if _, _, ok := s.blobPath(storyID, info.ID); !ok {
			missing = append(missing, info.ID)
		}
	}
	return missing
}

// readManifest loads assets.json. A story with no manifest yet reads as an empty one at
// the rev meta remembers, so a checkout of a text-only story is not a 404.
func (s *Store) readManifest(id string) (Manifest, error) {
	var stored storedManifest
	err := readJSONFile(s.manifestPath(id), &stored)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return Manifest{}, err
	}
	m := Manifest{Version: stored.Version, Assets: stored.Assets, Characters: stored.Characters, Rev: stored.Rev}
	if errors.Is(err, os.ErrNotExist) {
		meta, _, merr := s.readMeta(id)
		if merr != nil {
			return Manifest{}, merr
		}
		m.Rev = meta.AssetRev
	}
	m.normalize()
	return m, nil
}

// GetManifest is `GET /stories/{id}/assets`.
func (s *Store) GetManifest(id string) (Manifest, error) {
	if err := checkID("story", id); err != nil {
		return Manifest{}, err
	}
	meta, ok, err := s.readMeta(id)
	if err != nil {
		return Manifest{}, err
	}
	if !ok {
		return Manifest{}, notFound("story")
	}
	if meta.Deleted {
		return Manifest{}, &DeletedError{ID: id}
	}
	m, err := s.readManifest(id)
	if err != nil {
		return Manifest{}, err
	}
	m.Missing = s.missingAssets(id, m)
	return m, nil
}

// PutManifest replaces the manifest.
//
// It has its own rev and its own If-Match, separate from the story's, because text and
// art are pushed by separate requests: a checkout uploads blobs and then the manifest
// while autosave is still pushing passages, and one shared counter would make those two
// streams collide for no reason.
func (s *Store) PutManifest(id string, raw []byte, ifMatch *int, c Client) (Manifest, error) {
	if err := checkID("story", id); err != nil {
		return Manifest{}, err
	}

	var incoming storedManifest
	if err := json.Unmarshal(raw, &incoming); err != nil {
		return Manifest{}, badRequest("manifest is not valid JSON: %v", err)
	}

	defer s.lock(id)()

	meta, ok, err := s.readMeta(id)
	if err != nil {
		return Manifest{}, err
	}
	if !ok {
		return Manifest{}, notFound("story")
	}
	if meta.Deleted {
		return Manifest{}, &DeletedError{ID: id}
	}
	if ifMatch != nil && *ifMatch != meta.AssetRev {
		return Manifest{}, &ConflictError{Rev: meta.AssetRev, UpdatedAt: meta.UpdatedAt, LastClient: meta.LastClient}
	}

	m := Manifest{Version: ManifestVersion, Assets: incoming.Assets, Characters: incoming.Characters, Rev: meta.AssetRev + 1}
	m.normalize()

	if err := writeJSONAtomic(s.manifestPath(id), storedManifest{
		Version: m.Version, Assets: m.Assets, Characters: m.Characters, Rev: m.Rev,
	}); err != nil {
		return Manifest{}, err
	}

	meta.AssetRev = m.Rev
	meta.AssetCount = len(m.Assets)
	meta.AssetBytes = 0
	for _, info := range m.infos() {
		meta.AssetBytes += info.Bytes
	}
	meta.LastClient = c.label()
	if err := writeJSONAtomic(s.metaPath(id), meta); err != nil {
		return Manifest{}, err
	}

	m.Missing = s.missingAssets(id, m)
	return m, nil
}

// DiffRequest is AssetDiffRequest in server.types.ts.
type DiffRequest struct {
	Assets []struct {
		ID    string `json:"id"`
		Hash  string `json:"hash"`
		Bytes int64  `json:"bytes"`
	} `json:"assets"`
}

// DiffResult is AssetDiffResponse in server.types.ts.
type DiffResult struct {
	Missing []string `json:"missing"`
	Present []string `json:"present"`
	Stale   []string `json:"stale"`
}

// Diff is what stops autosave re-uploading a 4 MB background every time a passage moves.
// `stale` means the bytes are there under a different hash, so they have to be replaced;
// `present` means do nothing at all.
func (s *Store) Diff(id string, req DiffRequest) (DiffResult, error) {
	if err := checkID("story", id); err != nil {
		return DiffResult{}, err
	}
	meta, ok, err := s.readMeta(id)
	if err != nil {
		return DiffResult{}, err
	}
	if !ok {
		return DiffResult{}, notFound("story")
	}
	if meta.Deleted {
		return DiffResult{}, &DeletedError{ID: id}
	}
	man, err := s.readManifest(id)
	if err != nil {
		return DiffResult{}, err
	}

	res := DiffResult{Missing: []string{}, Present: []string{}, Stale: []string{}}
	for _, want := range req.Assets {
		if want.ID == "" || !ValidID(want.ID) {
			continue
		}
		if _, _, ok := s.blobPath(id, want.ID); !ok {
			res.Missing = append(res.Missing, want.ID)
			continue
		}
		// The server never rehashes stored blobs — the manifest is the record of what
		// the bytes are. An asset present on disk but unknown to the manifest is
		// therefore stale by definition: nobody can vouch for it.
		if info, known := man.info(want.ID); known && info.Hash == want.Hash {
			res.Present = append(res.Present, want.ID)
		} else {
			res.Stale = append(res.Stale, want.ID)
		}
	}
	return res, nil
}

// AssetFile describes one stored blob.
type AssetFile struct {
	Path  string
	Bytes int64
	// Hash comes from the manifest, not from rehashing on every GET.
	Hash string
	Mime string
}

// Asset locates a stored blob for reading.
func (s *Store) Asset(storyID, assetID string) (AssetFile, error) {
	if err := checkID("story", storyID); err != nil {
		return AssetFile{}, err
	}
	if err := checkID("asset", assetID); err != nil {
		return AssetFile{}, err
	}
	meta, ok, err := s.readMeta(storyID)
	if err != nil {
		return AssetFile{}, err
	}
	if !ok {
		return AssetFile{}, notFound("story")
	}
	if meta.Deleted {
		return AssetFile{}, &DeletedError{ID: storyID}
	}
	path, fi, found := s.blobPath(storyID, assetID)
	if !found {
		return AssetFile{}, notFound("asset")
	}
	out := AssetFile{Path: path, Bytes: fi.Size()}
	if man, err := s.readManifest(storyID); err == nil {
		if info, ok := man.info(assetID); ok {
			out.Hash = info.Hash
			out.Mime = info.Mime
		}
	}
	return out, nil
}

// PutAsset stores blob bytes and verifies them against the hash the client promised.
//
// wantHash is X-Asset-Hash: sha256 hex, the same value packages/asset-store already put
// in AssetMeta.hash — never a second hash invented here. contentType is only a hint for
// the filename when the manifest does not know the asset yet, which is the normal case:
// blobs are uploaded *before* the manifest that names them, so a manifest never points at
// bytes that are not there.
func (s *Store) PutAsset(storyID, assetID string, r io.Reader, wantHash, contentType string) (int64, error) {
	if err := checkID("story", storyID); err != nil {
		return 0, err
	}
	if err := checkID("asset", assetID); err != nil {
		return 0, err
	}
	if wantHash == "" {
		return 0, badRequest("X-Asset-Hash is required")
	}

	defer s.lock(storyID)()

	meta, ok, err := s.readMeta(storyID)
	if err != nil {
		return 0, err
	}
	if !ok {
		return 0, notFound("story")
	}
	if meta.Deleted {
		return 0, &DeletedError{ID: storyID}
	}

	mime := contentType
	if man, err := s.readManifest(storyID); err == nil {
		if info, ok := man.info(assetID); ok && info.Mime != "" {
			mime = info.Mime
		}
	}

	dir := s.assetsDir(storyID)
	tmp, n, got, err := stageFile(dir, r)
	if err != nil {
		return n, err
	}
	if !strings.EqualFold(got, wantHash) {
		os.Remove(tmp)
		return n, &HashMismatchError{Want: wantHash, Got: got}
	}

	dest := filepath.Join(dir, assetID+extForMime(mime))
	if err := commitFile(tmp, dest); err != nil {
		return n, err
	}
	// A re-upload under a new mime would otherwise leave the old file shadowing the new
	// one, since reads try extensions in a fixed order.
	for _, ext := range assetExtensions {
		if p := filepath.Join(dir, assetID+ext); p != dest {
			_ = os.Remove(p)
		}
	}
	return n, nil
}

// DeleteAsset removes blob bytes. The manifest is untouched: the client that deleted the
// asset owns that edit, and the entry showing up in `missing` until it pushes is the
// honest description of the server's state.
func (s *Store) DeleteAsset(storyID, assetID string) error {
	if err := checkID("story", storyID); err != nil {
		return err
	}
	if err := checkID("asset", assetID); err != nil {
		return err
	}

	defer s.lock(storyID)()

	if _, ok, err := s.readMeta(storyID); err != nil {
		return err
	} else if !ok {
		return notFound("story")
	}
	path, _, found := s.blobPath(storyID, assetID)
	if !found {
		return notFound("asset")
	}
	return os.Remove(path)
}
