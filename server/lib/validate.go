package lib

import (
	"encoding/json"
	"regexp"
	"sort"
	"strconv"
)

// Error is a contract error: status, `error` code, extra body fields.
type Error struct {
	Status int
	Code   string
	Extra  map[string]any
}

func (e *Error) Error() string { return strconv.Itoa(e.Status) + " " + e.Code }

func badRecord(detail string) error {
	return &Error{Status: 400, Code: "bad-record", Extra: map[string]any{"detail": detail}}
}

var (
	shaPattern  = regexp.MustCompile(`^[0-9a-f]{64}$`)
	uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`)
	// storyIDPattern is store.ValidID's pattern: binding ids are story ids.
	storyIDPattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`)
)

// ValidSha reports a lowercase hex sha256.
func ValidSha(s string) bool { return shaPattern.MatchString(s) }

func validID(typ, id string) bool {
	if typ == "binding" {
		return storyIDPattern.MatchString(id) && id != "." && id != ".."
	}
	return uuidPattern.MatchString(id)
}

// info is the server-validated part of a record, parsed once per write.
type info struct {
	rev        int
	deleted    bool
	name       string // collection name, asset name, character charId
	kind       string // collection kind
	collection string // asset/character collection, binding own
	blobs      []string
	bound      []string // binding: own + collections
	bad        string   // first shape problem, "" if none
}

func parseInfo(typ string, rec Record) info {
	var n info
	_ = json.Unmarshal(rec["rev"], &n.rev)
	_ = json.Unmarshal(rec["deleted"], &n.deleted)

	str := func(field string) string {
		raw, ok := rec[field]
		if !ok {
			if n.bad == "" {
				n.bad = field + " is required"
			}
			return ""
		}
		var v string
		if json.Unmarshal(raw, &v) != nil || v == "" {
			if n.bad == "" {
				n.bad = field + " must be a non-empty string"
			}
		}
		return v
	}

	switch typ {
	case "collection":
		n.name = str("name")
		n.kind = str("kind")
		if n.bad == "" && n.kind != "story" && n.kind != "shared" {
			n.bad = "kind must be story or shared"
		}
	case "asset":
		n.collection = str("collection")
		n.name = str("name")
		blob := str("blob")
		if n.bad == "" && !ValidSha(blob) {
			n.bad = "blob must be a lowercase sha256"
		}
		n.blobs = append(n.blobs, blob)
		if raw, ok := rec["sidecars"]; ok && string(raw) != "null" {
			var side map[string]string
			if json.Unmarshal(raw, &side) != nil {
				if n.bad == "" {
					n.bad = "sidecars must be {kind: sha}"
				}
			}
			for _, sha := range side {
				if n.bad == "" && !ValidSha(sha) {
					n.bad = "sidecar must be a lowercase sha256"
				}
				n.blobs = append(n.blobs, sha)
			}
		}
	case "character":
		n.collection = str("collection")
		n.name = str("charId")
	case "binding":
		n.collection = str("own")
		n.bound = append(n.bound, n.collection)
		if raw, ok := rec["collections"]; ok {
			var ids []string
			if json.Unmarshal(raw, &ids) == nil {
				n.bound = append(n.bound, ids...)
			}
		}
	}
	return n
}

func validateShape(n info) error {
	if n.bad != "" {
		return badRecord(n.bad)
	}
	return nil
}

// checkLive runs the rules for a non-deleted record, in contract order: collection
// exists → namespace → blobs exist.
func (s *Store) checkLive(k recKey, n info) error {
	switch k.typ {
	case "collection":
		for ok, e := range s.recs {
			if ok.typ == "collection" && ok.id != k.id && !e.info.deleted && e.info.name == n.name {
				return &Error{Status: 409, Code: "collection-name-taken",
					Extra: map[string]any{"holder": holder(ok)}}
			}
		}
		return nil
	case "binding":
		return s.checkCollection(n.collection)
	}

	if err := s.checkCollection(n.collection); err != nil {
		return err
	}
	for ok, e := range s.recs {
		if ok == k || e.info.deleted || (ok.typ != "asset" && ok.typ != "character") {
			continue
		}
		if e.info.collection == n.collection && e.info.name == n.name {
			return &Error{Status: 409, Code: "name-taken", Extra: map[string]any{"holder": holder(ok)}}
		}
	}
	if missing := s.missingBlobs(n.blobs); len(missing) > 0 {
		return &Error{Status: 409, Code: "blob-missing", Extra: map[string]any{"missing": missing}}
	}
	return nil
}

func (s *Store) checkCollection(id string) error {
	c := s.recs[recKey{"collection", id}]
	if c == nil || c.info.deleted {
		return &Error{Status: 409, Code: "collection-missing"}
	}
	return nil
}

// checkDeletable: a collection holding live assets/characters, or bound by a live
// binding, cannot be deleted.
func (s *Store) checkDeletable(k recKey) error {
	if k.typ != "collection" {
		return nil
	}
	count := 0
	for ok, e := range s.recs {
		if e.info.deleted {
			continue
		}
		switch ok.typ {
		case "asset", "character":
			if e.info.collection == k.id {
				count++
			}
		case "binding":
			for _, c := range e.info.bound {
				if c == k.id {
					count++
					break
				}
			}
		}
	}
	if count > 0 {
		return &Error{Status: 409, Code: "collection-not-empty", Extra: map[string]any{"count": count}}
	}
	return nil
}

func holder(k recKey) map[string]string { return map[string]string{"type": k.typ, "id": k.id} }

func (s *Store) missingBlobs(shas []string) []string {
	seen := map[string]bool{}
	missing := []string{}
	for _, sha := range shas {
		if seen[sha] {
			continue
		}
		seen[sha] = true
		if !s.HasBlob(sha) {
			missing = append(missing, sha)
		}
	}
	sort.Strings(missing)
	return missing
}
