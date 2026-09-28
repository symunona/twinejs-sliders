package hub

import (
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"twine-story-store/api"
	"twine-story-store/lib"
	"twine-story-store/store"
)

// TestLibWriteFansOutWithSeqButNeverEchoes: the real stack with the library mounted.
// The writer's own connection gets nothing; everyone else gets {t:lib, seq, …}.
func TestLibWriteFansOutWithSeqButNeverEchoes(t *testing.T) {
	st, err := store.New(store.Options{Dir: t.TempDir(), RevKeep: 5, OrphanTTL: time.Hour, TombstoneTTL: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	ls, err := lib.Open(lib.Options{Dir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	defer ls.Close()
	h := New(Options{Token: testToken})
	srv := httptest.NewServer(api.NewHandler(api.Options{
		Store: st, Token: testToken, MaxStoryBytes: 1 << 20, MaxAssetBytes: 1 << 20,
		Notifier: h, Presence: h, Events: h, Lib: ls, LibNotifier: h,
	}))
	t.Cleanup(func() { _ = h.Close(); srv.Close() })
	f := &fixture{t: t, hub: h, srv: srv}

	writer := f.client(t, "c-writer", "mira")
	listener := f.client(t, "c-listener", "juno")

	put := func(id, name, clientID, clientName string, hdr ...string) {
		t.Helper()
		req, _ := http.NewRequest("PUT", srv.URL+"/api/v1/lib/collections/"+id,
			strings.NewReader(`{"name":"`+name+`","kind":"shared"}`))
		req.Header.Set("Authorization", "Bearer "+testToken)
		req.Header.Set("X-Client-Id", clientID)
		req.Header.Set("X-Client-Name", clientName)
		for i := 0; i+1 < len(hdr); i += 2 {
			req.Header.Set(hdr[i], hdr[i+1])
		}
		res, err := srv.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatalf("put: %d", res.StatusCode)
		}
	}

	id := "00000000-0000-4000-8000-000000000001"
	put(id, "Forest", "c-writer", "mira", "If-None-Match", "*")
	got := waitFor(t, listener, "lib")
	want := map[string]any{"t": "lib", "seq": float64(1), "type": "collection", "id": id, "rev": float64(1), "by": "mira"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("listener got %v, want %v", got, want)
	}

	// Writer's first lib message must be someone else's write (seq 2), not its own echo.
	put(id, "Forest II", "c-other", "juno", "If-Match", `"1"`)
	got = waitFor(t, writer, "lib")
	if got["seq"] != float64(2) || got["by"] != "juno" || got["rev"] != float64(2) {
		t.Fatalf("writer got %v (seq 1 means its own write echoed)", got)
	}

	// Mounted behind auth like every other route.
	res, err := http.Get(srv.URL + "/api/v1/lib/changes")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 401 {
		t.Fatalf("unauthenticated /changes = %d", res.StatusCode)
	}
}
