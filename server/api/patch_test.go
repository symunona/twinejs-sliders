package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"twine-story-store/store"
)

// multiPassageStory is the base every PATCH test starts from: passages with ids, so a
// patch has something to replace, remove and sit beside.
func multiPassageStory(texts ...string) []byte {
	passages := make([]map[string]any, 0, len(texts))
	for i, text := range texts {
		passages = append(passages, map[string]any{
			"id": fmt.Sprintf("p%d", i+1), "name": fmt.Sprintf("Room %d", i+1),
			"text": text, "left": i * 100, "top": 0, "tags": []string{}, "width": 100,
		})
	}
	raw, err := json.Marshal(map[string]any{
		"client": "twine-sliders test",
		"story": map[string]any{
			"id": "story-1", "ifid": "IFID-1", "name": "Lighthouse", "sync": true,
			"script": "", "stylesheet": "", "startPassage": "p1",
			"passages": passages,
		},
	})
	if err != nil {
		panic(err)
	}
	return raw
}

func patchPayload(patch map[string]any) []byte {
	raw, err := json.Marshal(map[string]any{"client": "twine-sliders test", "patch": patch})
	if err != nil {
		panic(err)
	}
	return raw
}

func changed(entries ...map[string]any) map[string]any {
	return map[string]any{"passages": map[string]any{"changed": entries}}
}

// storyBody reads the current story back as a map, so a test can assert on passages
// without caring what order json.Marshal put the keys in.
func (h *harness) storyBody() map[string]any {
	h.t.Helper()
	res := h.do("GET", "/api/v1/stories/story-1", nil)
	expectStatus(h.t, res, http.StatusOK)
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()

	var out map[string]any
	if err := json.Unmarshal(body, &out); err != nil {
		h.t.Fatalf("story body does not parse: %v\n%s", err, body)
	}
	return out
}

// passageTexts flattens a body into id -> text, plus the stored order.
func passageTexts(t *testing.T, body map[string]any) (map[string]string, []string) {
	t.Helper()
	raw, ok := body["passages"].([]any)
	if !ok {
		t.Fatalf("passages = %#v", body["passages"])
	}
	texts := map[string]string{}
	order := make([]string, 0, len(raw))
	for _, p := range raw {
		m, ok := p.(map[string]any)
		if !ok {
			t.Fatalf("passage = %#v", p)
		}
		id, _ := m["id"].(string)
		text, _ := m["text"].(string)
		texts[id] = text
		order = append(order, id)
	}
	return texts, order
}

func TestPatchStory(t *testing.T) {
	cases := []struct {
		label string
		patch map[string]any
		texts map[string]string
		order []string
		name  string
	}{
		{
			label: "replaces a passage in place",
			patch: changed(map[string]any{"id": "p2", "name": "Room 2", "text": "rewritten"}),
			texts: map[string]string{"p1": "one", "p2": "rewritten", "p3": "three"},
			order: []string{"p1", "p2", "p3"},
			name:  "Lighthouse",
		},
		{
			label: "inserts a passage it has never seen",
			patch: changed(map[string]any{"id": "p9", "name": "Cellar", "text": "new room"}),
			texts: map[string]string{"p1": "one", "p2": "two", "p3": "three", "p9": "new room"},
			order: []string{"p1", "p2", "p3", "p9"},
			name:  "Lighthouse",
		},
		{
			label: "removes a passage",
			patch: map[string]any{"passages": map[string]any{"removed": []string{"p2"}}},
			texts: map[string]string{"p1": "one", "p3": "three"},
			order: []string{"p1", "p3"},
			name:  "Lighthouse",
		},
		{
			label: "removes and changes in one request",
			patch: map[string]any{"passages": map[string]any{
				"removed": []string{"p1"},
				"changed": []map[string]any{
					{"id": "p3", "name": "Room 3", "text": "edited"},
					{"id": "p4", "name": "Room 4", "text": "added"},
				},
			}},
			texts: map[string]string{"p2": "two", "p3": "edited", "p4": "added"},
			order: []string{"p2", "p3", "p4"},
			name:  "Lighthouse",
		},
		{
			label: "removing a passage that is already gone is not an error",
			patch: map[string]any{"passages": map[string]any{"removed": []string{"p1", "nobody"}}},
			texts: map[string]string{"p2": "two", "p3": "three"},
			order: []string{"p2", "p3"},
			name:  "Lighthouse",
		},
		{
			label: "changes a top-level scalar and leaves the passages alone",
			patch: map[string]any{"story": map[string]any{"name": "Cellar Door"}},
			texts: map[string]string{"p1": "one", "p2": "two", "p3": "three"},
			order: []string{"p1", "p2", "p3"},
			name:  "Cellar Door",
		},
		{
			label: "an empty patch is still a write",
			patch: map[string]any{},
			texts: map[string]string{"p1": "one", "p2": "two", "p3": "three"},
			order: []string{"p1", "p2", "p3"},
			name:  "Lighthouse",
		},
	}

	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			h := newHarness(t, nil)
			expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", multiPassageStory("one", "two", "three")), http.StatusOK)

			res := h.do("PATCH", "/api/v1/stories/story-1", patchPayload(tc.patch), "If-Match", `"1"`)
			expectStatus(t, res, http.StatusOK)

			var put store.PutResult
			decode(t, res, &put)
			if put.Rev != 2 || put.ID != "story-1" || put.UpdatedAt == "" || put.Bytes == 0 {
				t.Fatalf("patch response = %+v", put)
			}
			if got := res.Header.Get("ETag"); got != `"2"` {
				t.Fatalf("ETag = %q, want \"2\"", got)
			}

			body := h.storyBody()
			texts, order := passageTexts(t, body)

			if len(texts) != len(tc.texts) {
				t.Fatalf("%d passages, want %d: %v", len(texts), len(tc.texts), texts)
			}
			for id, want := range tc.texts {
				if texts[id] != want {
					t.Fatalf("passage %s = %q, want %q", id, texts[id], want)
				}
			}
			if strings.Join(order, ",") != strings.Join(tc.order, ",") {
				t.Fatalf("order = %v, want %v", order, tc.order)
			}
			if body["name"] != tc.name {
				t.Fatalf("name = %v, want %q", body["name"], tc.name)
			}
			// Fields the patch never names survive: the server folds into the stored
			// body, it does not rebuild the story from the fields it happens to know.
			if body["ifid"] != "IFID-1" || body["startPassage"] != "p1" {
				t.Fatalf("patch lost a field it was not given: %+v", body)
			}
			if _, ok := body["sync"]; ok {
				t.Fatal("sync came back on the wire after a patch")
			}

			// The index summary is recomputed exactly as a PUT recomputes it.
			res = h.do("GET", "/api/v1/stories", nil)
			var index storyIndexResponse
			decode(t, res, &index)
			if len(index.Stories) != 1 {
				t.Fatalf("index = %+v", index)
			}
			if e := index.Stories[0]; e.PassageCount != len(tc.texts) || e.Name != tc.name || e.Rev != 2 {
				t.Fatalf("index entry = %+v", e)
			}

			// And the write was announced once, like any other.
			if got := h.notify.all(); len(got) != 2 || got[1] != "story story-1 2 mira" {
				t.Fatalf("notifications = %v", got)
			}
		})
	}
}

// TestPatchNeedsIfMatch is the rule that separates PATCH from PUT: a patch against an
// unknown base is meaningless, so a missing header is refused exactly like a stale one.
func TestPatchNeedsIfMatch(t *testing.T) {
	patch := patchPayload(changed(map[string]any{"id": "p1", "name": "Room 1", "text": "sneaked in"}))

	for _, tc := range []struct {
		label  string
		header []string
	}{
		{"no If-Match at all", nil},
		{"If-Match: * is not a base rev", []string{"If-Match", "*"}},
		{"stale If-Match", []string{"If-Match", `"1"`}},
	} {
		t.Run(tc.label, func(t *testing.T) {
			h := newHarness(t, nil)
			expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", multiPassageStory("one", "two")), http.StatusOK)
			expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", multiPassageStory("one", "two")), http.StatusOK)

			res := h.do("PATCH", "/api/v1/stories/story-1", patch, tc.header...)
			if res.StatusCode != http.StatusPreconditionFailed {
				body, _ := io.ReadAll(res.Body)
				res.Body.Close()
				t.Fatalf("status %d, want 412: %s", res.StatusCode, body)
			}

			var body errorBody
			decode(t, res, &body)
			if body.Error.Code != codeConflict {
				t.Fatalf("code = %q", body.Error.Code)
			}
			// Same 412 shape PUT answers with, so the conflict banner needs no second branch.
			if body.Rev == nil || *body.Rev != 2 || body.LastClient != "mira" || body.UpdatedAt == "" {
				t.Fatalf("412 body = %+v", body)
			}

			texts, _ := passageTexts(t, h.storyBody())
			if texts["p1"] != "one" {
				t.Fatalf("refused patch landed: %v", texts)
			}
			if got := h.notify.all(); len(got) != 2 {
				t.Fatalf("a refused patch was announced: %v", got)
			}
		})
	}

	// A current tag is accepted, so the refusals above are about the precondition and not
	// about the route.
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", multiPassageStory("one", "two")), http.StatusOK)
	expectStatus(t, h.do("PATCH", "/api/v1/stories/story-1", patch, "If-Match", `"1"`), http.StatusOK)
}

func TestPatchRefusals(t *testing.T) {
	cases := []struct {
		label  string
		body   []byte
		status int
		code   string
	}{
		{
			label:  "a changed passage with no id",
			body:   patchPayload(changed(map[string]any{"name": "Nameless", "text": "x"})),
			status: http.StatusBadRequest, code: codeBadRequest,
		},
		{
			label:  "a changed passage with an empty id",
			body:   patchPayload(changed(map[string]any{"id": "", "text": "x"})),
			status: http.StatusBadRequest, code: codeBadRequest,
		},
		{
			label:  "an empty id in removed",
			body:   patchPayload(map[string]any{"passages": map[string]any{"removed": []string{""}}}),
			status: http.StatusBadRequest, code: codeBadRequest,
		},
		{
			// Two answers to "what are the passages now" in one request.
			label:  "passages smuggled through patch.story",
			body:   patchPayload(map[string]any{"story": map[string]any{"passages": []any{}}}),
			status: http.StatusBadRequest, code: codeBadRequest,
		},
		{
			label:  "a body that is not JSON",
			body:   []byte("{nope"),
			status: http.StatusBadRequest, code: codeBadRequest,
		},
	}

	for _, tc := range cases {
		t.Run(tc.label, func(t *testing.T) {
			h := newHarness(t, nil)
			expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", multiPassageStory("one", "two")), http.StatusOK)

			expectError(t, h.do("PATCH", "/api/v1/stories/story-1", tc.body, "If-Match", `"1"`), tc.status, tc.code)

			// A refused patch writes nothing — not even a rev bump.
			res := h.do("GET", "/api/v1/stories/story-1", nil)
			expectStatus(t, res, http.StatusOK)
			res.Body.Close()
			if got := res.Header.Get("ETag"); got != `"1"` {
				t.Fatalf("ETag = %q after a refused patch, want \"1\"", got)
			}
		})
	}
}

func TestPatchOnMissingStoryAndTombstone(t *testing.T) {
	patch := patchPayload(changed(map[string]any{"id": "p1", "name": "Room 1", "text": "edited"}))

	h := newHarness(t, nil)
	expectError(t, h.do("PATCH", "/api/v1/stories/nope", patch, "If-Match", `"1"`), http.StatusNotFound, codeNotFound)

	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", multiPassageStory("one", "two")), http.StatusOK)
	expectStatus(t, h.do("DELETE", "/api/v1/stories/story-1", nil), http.StatusOK)

	// Same refusal PUT gives: 409, not 410 — the client has a choice to make. There is no
	// ?revive=1 for a patch, because reviving means stating the whole story.
	expectError(t, h.do("PATCH", "/api/v1/stories/story-1", patch, "If-Match", `"1"`), http.StatusConflict, codeDeleted)
	expectError(t, h.do("PATCH", "/api/v1/stories/story-1?revive=1", patch, "If-Match", `"1"`), http.StatusConflict, codeDeleted)
}

func TestOversizedPatchIs413(t *testing.T) {
	h := newHarness(t, func(o *Options) { o.MaxStoryBytes = 2048 })
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", multiPassageStory("one", "two")), http.StatusOK)

	big := patchPayload(changed(map[string]any{"id": "p1", "name": "Room 1", "text": strings.Repeat("x", 8192)}))
	expectError(t, h.do("PATCH", "/api/v1/stories/story-1", big, "If-Match", `"1"`),
		http.StatusRequestEntityTooLarge, codeTooLarge)
}

// TestRevisionChainSurvivesPutAndPatch is the point of routing PATCH through
// writeStoryLocked: a patch has to leave the same snapshot a PUT does, or the history has
// holes exactly where the ordinary autosaves were.
func TestRevisionChainSurvivesPutAndPatch(t *testing.T) {
	h := newHarness(t, nil)

	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", multiPassageStory("v1", "two")), http.StatusOK)

	// PUT, PATCH, PATCH, PUT, PATCH — each a distinct body, so each one snapshots.
	steps := []struct {
		patch bool
		text  string
	}{{false, "v2"}, {true, "v3"}, {true, "v4"}, {false, "v5"}, {true, "v6"}}

	for i, step := range steps {
		rev := i + 1
		if step.patch {
			body := patchPayload(changed(map[string]any{"id": "p1", "name": "Room 1", "text": step.text}))
			expectStatus(t, h.do("PATCH", "/api/v1/stories/story-1", body, "If-Match", etag(rev)), http.StatusOK)
		} else {
			expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", multiPassageStory(step.text, "two"), "If-Match", etag(rev)), http.StatusOK)
		}
	}

	res := h.do("GET", "/api/v1/stories/story-1/revisions", nil)
	expectStatus(t, res, http.StatusOK)
	var revs store.Revisions
	decode(t, res, &revs)

	if revs.Current != 6 {
		t.Fatalf("current = %d, want 6", revs.Current)
	}
	// Six rows: the current body plus a snapshot of every rev it replaced. No gaps — a
	// PATCH that skipped the snapshot would show up here as a missing number.
	if len(revs.Revisions) != 6 {
		t.Fatalf("revisions = %+v", revs.Revisions)
	}
	for i, r := range revs.Revisions {
		if wantRev := 6 - i; r.Rev != wantRev {
			t.Fatalf("row %d is rev %d, want %d (chain has a hole)", i, r.Rev, wantRev)
		}
		if r.Client != "mira" || r.Passages != 2 || r.Hash == "" || r.Bytes == 0 {
			t.Fatalf("revision row %+v", r)
		}
	}

	// Every snapshot body is readable and holds the text written at that rev, whichever
	// method wrote it.
	for rev, want := range map[int]string{1: "v1", 2: "v2", 3: "v3", 4: "v4", 5: "v5", 6: "v6"} {
		res := h.do("GET", fmt.Sprintf("/api/v1/stories/story-1/revisions/%d", rev), nil)
		expectStatus(t, res, http.StatusOK)
		body, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if !bytes.Contains(body, []byte(`"`+want+`"`)) {
			t.Fatalf("rev %d does not hold %q: %s", rev, want, body)
		}
	}

	// Restore reaches back across a rev a PATCH wrote, and lands as an ordinary write.
	res = h.do("POST", "/api/v1/stories/story-1/restore", []byte(`{"rev":3}`))
	expectStatus(t, res, http.StatusOK)
	var restored store.RestoreResult
	decode(t, res, &restored)
	if restored.Rev != 7 || restored.RestoredFrom != 3 {
		t.Fatalf("restore = %+v", restored)
	}
	texts, _ := passageTexts(t, h.storyBody())
	if texts["p1"] != "v3" {
		t.Fatalf("restore of a patched rev did not take: %v", texts)
	}

	// And a patch on top of the restored body works, against the restore's own rev.
	body := patchPayload(changed(map[string]any{"id": "p1", "name": "Room 1", "text": "v8"}))
	expectStatus(t, h.do("PATCH", "/api/v1/stories/story-1", body, "If-Match", `"7"`), http.StatusOK)
	texts, _ = passageTexts(t, h.storyBody())
	if texts["p1"] != "v8" {
		t.Fatalf("patch after restore did not take: %v", texts)
	}
}

// TestPatchPruneKeepsREVKEEP walks past the keep-N boundary with patches only: the prune
// runs inside the same snapshot path, so it has to behave the same from here.
func TestPatchPruneKeepsREVKEEP(t *testing.T) {
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", multiPassageStory("v0", "two")), http.StatusOK)

	for rev := 1; rev <= 25; rev++ {
		body := patchPayload(changed(map[string]any{"id": "p1", "name": "Room 1", "text": fmt.Sprintf("v%d", rev)}))
		expectStatus(t, h.do("PATCH", "/api/v1/stories/story-1", body, "If-Match", etag(rev)), http.StatusOK)
	}

	index, err := os.ReadFile(filepath.Join(h.dir, "stories", "story-1", "revs", "index.json"))
	if err != nil {
		t.Fatalf("index.json: %v", err)
	}
	var parsed []store.RevisionEntry
	if err := json.Unmarshal(index, &parsed); err != nil {
		t.Fatalf("index.json does not parse: %v\n%s", err, index)
	}
	if len(parsed) != 20 {
		t.Fatalf("index has %d entries, want REV_KEEP=20", len(parsed))
	}
	// 25 patches over rev 1 leave revs 2..26, snapshotting the body each replaced: revs
	// 1..25. The newest 20 of those survive. Rev 26 is story.json, not a snapshot.
	if parsed[0].Rev != 6 || parsed[len(parsed)-1].Rev != 25 {
		t.Fatalf("kept revs %d..%d, want 6..25", parsed[0].Rev, parsed[len(parsed)-1].Rev)
	}

	// And the history route agrees: 20 snapshots plus the current body.
	res := h.do("GET", "/api/v1/stories/story-1/revisions", nil)
	expectStatus(t, res, http.StatusOK)
	var revs store.Revisions
	decode(t, res, &revs)
	if revs.Current != 26 || len(revs.Revisions) != 21 || revs.Revisions[0].Rev != 26 {
		t.Fatalf("revisions after prune: current %d, %d rows", revs.Current, len(revs.Revisions))
	}
}

func TestPatchPreflightAllowsTheMethod(t *testing.T) {
	h := newHarness(t, nil)
	res := h.raw("OPTIONS", "/api/v1/stories/story-1", nil, "Origin", "http://127.0.0.1:5173")
	expectStatus(t, res, http.StatusNoContent)
	res.Body.Close()
	if !strings.Contains(res.Header.Get("Access-Control-Allow-Methods"), "PATCH") {
		t.Fatalf("preflight does not allow PATCH: %q", res.Header.Get("Access-Control-Allow-Methods"))
	}
}

func TestPatchNeedsTheToken(t *testing.T) {
	h := newHarness(t, nil)
	res := h.raw("PATCH", "/api/v1/stories/story-1", []byte("{}"))
	res.Body.Close()
	if res.StatusCode != http.StatusUnauthorized {
		t.Fatalf("PATCH without a token: %d", res.StatusCode)
	}
}
