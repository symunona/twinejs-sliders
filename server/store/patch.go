package store

import (
	"encoding/json"
	"os"
)

// StoryPatch is the `patch` field of PATCH /stories/{id} — StoryPatch in
// server.types.ts.
//
// Why a patch route at all: autosave PUTs the whole story every 5 seconds, and the author
// expects 20-100 KB of passage text where today's stories are 1-14 KB. One typed sentence
// then costs 100 KB of upload on whatever the phone has. It also unsticks the tab-close
// save: that one goes out with `keepalive`, which the Fetch spec caps at 64 KB of request
// body, so at 100 KB the last save before a tab closes silently does not happen.
//
// Both fields are optional. A patch that says nothing is legal and is an ordinary write —
// it bumps the rev like any other, which is what a client asking for a fresh ETag wants.
type StoryPatch struct {
	Passages *PassagePatch `json:"passages,omitempty"`
	// Story carries CHANGED TOP-LEVEL SCALARS only: name, script, stylesheet,
	// startPassage, tagColors, zoom… Values are raw so an unknown future field rides
	// through untouched, exactly as normalizeStory treats the rest of the body.
	Story map[string]json.RawMessage `json:"story,omitempty"`
}

// PassagePatch is the per-passage half. Passages are whole objects, never a diff of their
// own: passage TEXT is the thing that grew, and a text diff would need the client and the
// server to agree on a diff algorithm forever. Sending one whole 8 KB passage instead of a
// whole 100 KB story is already the win.
type PassagePatch struct {
	Changed []json.RawMessage `json:"changed,omitempty"`
	Removed []string          `json:"removed,omitempty"`
}

// applyStoryPatch folds a patch into a story body and returns the new whole body.
//
// It stays at the json.RawMessage level for the same reason normalizeStory does: every
// field the server does not know about — scene YAML, sliders keys, whatever the editor
// adds next — has to survive a patch byte for byte, and a typed struct would quietly drop
// it.
func applyStoryPatch(raw []byte, p StoryPatch) ([]byte, error) {
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return nil, badRequest("stored story is not a JSON object: %v", err)
	}
	if fields == nil {
		return nil, badRequest("stored story is null")
	}

	for k, v := range p.Story {
		// `passages` has its own half of the patch. Accepting it here too would mean two
		// answers to "what are the passages now" in one request, resolved by whichever
		// branch happened to run last.
		if k == "passages" {
			return nil, badRequest("patch.story may not carry `passages` — use patch.passages")
		}
		if len(v) == 0 {
			return nil, badRequest("patch.story.%s has no value", k)
		}
		fields[k] = v
	}

	if p.Passages != nil {
		next, err := patchPassages(fields["passages"], *p.Passages)
		if err != nil {
			return nil, err
		}
		fields["passages"] = next
	}

	return json.Marshal(fields)
}

// patchPassages rewrites the passages array.
//
// Order is preserved on purpose: a changed passage is replaced where it stands and a new
// one is appended. The array's order is not meaningful to the player, but it IS what the
// hash compares, and reordering on every autosave would make every patch look like a
// change to every passage in the revision history.
func patchPassages(current json.RawMessage, p PassagePatch) (json.RawMessage, error) {
	var passages []json.RawMessage
	if len(current) > 0 {
		if err := json.Unmarshal(current, &passages); err != nil {
			return nil, badRequest("stored story's `passages` is not an array: %v", err)
		}
	}

	at := make(map[string]int, len(passages))
	for i, raw := range passages {
		if id := passageID(raw); id != "" {
			at[id] = i
		}
	}

	if len(p.Removed) > 0 {
		gone := make(map[string]bool, len(p.Removed))
		for _, id := range p.Removed {
			if id == "" {
				return nil, badRequest("patch.passages.removed holds an empty id")
			}
			gone[id] = true
		}
		// A removal naming a passage that is already absent is NOT an error: two clients
		// deleting the same passage is an ordinary race, and the end state both asked for
		// is the one that happens.
		kept := passages[:0]
		for _, raw := range passages {
			if gone[passageID(raw)] {
				continue
			}
			kept = append(kept, raw)
		}
		passages = kept

		at = make(map[string]int, len(passages))
		for i, raw := range passages {
			if id := passageID(raw); id != "" {
				at[id] = i
			}
		}
	}

	for _, raw := range p.Changed {
		id := passageID(raw)
		if id == "" {
			return nil, badRequest("every patch.passages.changed entry needs a non-empty `id`")
		}
		if i, ok := at[id]; ok {
			passages[i] = raw
			continue
		}
		at[id] = len(passages)
		passages = append(passages, raw)
	}

	if passages == nil {
		passages = []json.RawMessage{}
	}
	return json.Marshal(passages)
}

// passageID pulls just the id out of a passage object. Anything that is not an object with
// a string id answers "", and the caller decides whether that is fatal — a stored passage
// without one is somebody else's old bug, an incoming one without one is a bad request.
func passageID(raw json.RawMessage) string {
	var head struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(raw, &head); err != nil {
		return ""
	}
	return head.ID
}

// PatchStory applies a patch to the stored body and writes the result through the ordinary
// write path.
//
// If-Match is REQUIRED here, unlike PutStory where it is optional. A PUT states the whole
// story, so last-write-wins is a coherent answer; a patch is only meaningful against the
// base it was computed from, and applying one to an unknown base is how a passage the
// other editor just wrote gets silently resurrected. A missing header is refused with the
// same ConflictError a stale one gets, so the client has one branch to handle: re-read,
// re-diff, retry.
func (s *Store) PatchStory(id string, p StoryPatch, c Client, ifMatch *int) (PutResult, error) {
	if err := checkID("story", id); err != nil {
		return PutResult{}, err
	}

	defer s.lock(id)()

	m, exists, err := s.readMeta(id)
	if err != nil {
		return PutResult{}, err
	}
	if !exists {
		return PutResult{}, notFound("story")
	}
	// A tombstone has no body, so there is nothing to patch. There is deliberately no
	// ?revive=1 here either: reviving means stating the whole story, which is a PUT.
	if m.Deleted {
		return PutResult{}, &DeletedError{ID: id}
	}
	if ifMatch == nil || *ifMatch != m.Rev {
		return PutResult{}, &ConflictError{Rev: m.Rev, UpdatedAt: m.UpdatedAt, LastClient: m.LastClient}
	}

	raw, err := os.ReadFile(s.storyPath(id))
	if err != nil {
		return PutResult{}, err
	}

	patched, err := applyStoryPatch(raw, p)
	if err != nil {
		return PutResult{}, err
	}

	// Through normalizeStory and writeStoryLocked like every other write: same `sync`
	// strip, same summary, same rev bump, same revs/ snapshot of the body being replaced,
	// same keep-N prune, same meta.json ordering. A second write path would be a second
	// set of those rules to keep in step.
	body, sum, err := normalizeStory(patched)
	if err != nil {
		return PutResult{}, err
	}
	return s.writeStoryLocked(m, body, sum, c, 0)
}
