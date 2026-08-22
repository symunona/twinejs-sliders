package hub

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"twine-story-store/api"
	"twine-story-store/store"
)

const testToken = "test-token-0123456789"

// readWait bounds every blocking read in these tests. Generous, because it is only ever
// hit on failure.
const readWait = 3 * time.Second

type fixture struct {
	t   *testing.T
	hub *Hub
	srv *httptest.Server
}

// newFixture stands up the real stack: a real store, the real API handler, and the hub
// wired in exactly as main.go wires it. The tests then talk to it over a real websocket,
// because the handshake — subprotocol auth included — is half of what is being tested.
func newFixture(t *testing.T, tweak func(*Options)) *fixture {
	t.Helper()

	st, err := store.New(store.Options{
		Dir:          t.TempDir(),
		RevKeep:      5,
		OrphanTTL:    time.Hour,
		TombstoneTTL: time.Hour,
	})
	if err != nil {
		t.Fatalf("store: %v", err)
	}

	opts := Options{Token: testToken}
	if tweak != nil {
		tweak(&opts)
	}
	h := New(opts)

	srv := httptest.NewServer(api.NewHandler(api.Options{
		Store:         st,
		Token:         testToken,
		Origins:       []string{"https://twine-ig.tmpx.space"},
		MaxStoryBytes: 1 << 20,
		MaxAssetBytes: 1 << 20,
		KeepRevisions: 5,
		Notifier:      h,
		Presence:      h,
		Events:        h,
	}))

	t.Cleanup(func() {
		// Hub first: httptest waits on connections it still knows about, and a socket
		// nobody hangs up on is open forever.
		_ = h.Close()
		srv.Close()
	})

	return &fixture{t: t, hub: h, srv: srv}
}

func (f *fixture) wsURL() string {
	return "ws" + strings.TrimPrefix(f.srv.URL, "http") + EventsPath
}

// dial opens a socket the way a browser does: the token rides the subprotocol.
func (f *fixture) dial(t *testing.T, token string) (*websocket.Conn, *http.Response, error) {
	t.Helper()
	d := websocket.Dialer{
		HandshakeTimeout: readWait,
		Subprotocols:     []string{subprotocolBearer, token},
	}
	return d.Dial(f.wsURL(), nil)
}

// client dials, says hello and eats the welcome, which is what every real client does
// before anything interesting happens.
func (f *fixture) client(t *testing.T, id, name string) *websocket.Conn {
	t.Helper()
	c, _, err := f.dial(t, testToken)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	t.Cleanup(func() { _ = c.Close() })

	send(t, c, map[string]any{"t": "hello", "client": id, "name": name, "stories": []string{}})
	waitFor(t, c, "welcome")
	return c
}

// put writes a story over HTTP as clientID, which is the only way a story is ever
// written — see the package comment.
func (f *fixture) put(t *testing.T, storyID, name, clientID, clientName string) {
	t.Helper()

	body, err := json.Marshal(map[string]any{
		"client": "twine-sliders test",
		"story": map[string]any{
			"id": storyID, "ifid": "IFID-1", "name": name,
			"passages": []map[string]any{{"id": "p1", "name": "Start", "text": "hello"}},
		},
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	req, err := http.NewRequest("PUT", f.srv.URL+"/api/v1/stories/"+storyID, bytes.NewReader(body))
	if err != nil {
		t.Fatalf("request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+testToken)
	req.Header.Set("X-Client-Id", clientID)
	req.Header.Set("X-Client-Name", clientName)

	res, err := f.srv.Client().Do(req)
	if err != nil {
		t.Fatalf("put: %v", err)
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		dump, _ := io.ReadAll(res.Body)
		t.Fatalf("put: %d %s", res.StatusCode, dump)
	}
}

func send(t *testing.T, c *websocket.Conn, msg any) {
	t.Helper()
	if err := c.WriteJSON(msg); err != nil {
		t.Fatalf("write %v: %v", msg, err)
	}
}

func read(t *testing.T, c *websocket.Conn) map[string]any {
	t.Helper()
	_ = c.SetReadDeadline(time.Now().Add(readWait))
	_, data, err := c.ReadMessage()
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	var msg map[string]any
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("read %s: %v", data, err)
	}
	return msg
}

// waitFor skips messages of other kinds: presence traffic arrives whenever anyone joins,
// so a test looking for a `story` cannot assume it is next.
func waitFor(t *testing.T, c *websocket.Conn, want string) map[string]any {
	t.Helper()
	deadline := time.Now().Add(readWait)
	for time.Now().Before(deadline) {
		msg := read(t, c)
		if msg["t"] == want {
			return msg
		}
	}
	t.Fatalf("no %q message within %s", want, readWait)
	return nil
}

// waitPresence reads presence messages until one satisfies pred. Presence is a snapshot,
// not a diff, so a test asserts on the state it wants rather than on a sequence.
func waitPresence(t *testing.T, c *websocket.Conn, what string, pred func([]any) bool) []any {
	t.Helper()
	deadline := time.Now().Add(readWait)
	for time.Now().Before(deadline) {
		msg := read(t, c)
		if msg["t"] != "presence" {
			continue
		}
		clients, _ := msg["clients"].([]any)
		if pred(clients) {
			return clients
		}
	}
	t.Fatalf("no presence message where %s within %s", what, readWait)
	return nil
}

func entry(clients []any, id string) map[string]any {
	for _, raw := range clients {
		if c, ok := raw.(map[string]any); ok && c["id"] == id {
			return c
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Handshake
// ---------------------------------------------------------------------------

func TestHandshakeAcceptsTheTokenInTheSubprotocol(t *testing.T) {
	f := newFixture(t, nil)

	c, res, err := f.dial(t, testToken)
	if err != nil {
		t.Fatalf("dial: %v", err)
	}
	defer c.Close()

	if got := c.Subprotocol(); got != subprotocolBearer {
		t.Fatalf("negotiated subprotocol = %q, want %q", got, subprotocolBearer)
	}
	// The token must not come back, only the marker: the echoed header is visible to
	// anything that can see the response.
	if got := res.Header.Get("Sec-WebSocket-Protocol"); got != subprotocolBearer {
		t.Fatalf("echoed protocol = %q, want %q", got, subprotocolBearer)
	}
}

func TestHandshakeAcceptsTheAuthorizationHeader(t *testing.T) {
	f := newFixture(t, nil)

	d := websocket.Dialer{HandshakeTimeout: readWait}
	c, _, err := d.Dial(f.wsURL(), http.Header{"Authorization": {"Bearer " + testToken}})
	if err != nil {
		t.Fatalf("dial with header: %v", err)
	}
	defer c.Close()
}

func TestHandshakeWithoutAValidTokenIs401(t *testing.T) {
	f := newFixture(t, nil)

	for _, tc := range []struct {
		name   string
		dialer websocket.Dialer
	}{
		{"no subprotocol at all", websocket.Dialer{HandshakeTimeout: readWait}},
		{"wrong token", websocket.Dialer{HandshakeTimeout: readWait, Subprotocols: []string{subprotocolBearer, "not-the-token"}}},
		{"token without the marker", websocket.Dialer{HandshakeTimeout: readWait, Subprotocols: []string{testToken}}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			c, res, err := tc.dialer.Dial(f.wsURL(), nil)
			if err == nil {
				c.Close()
				t.Fatal("handshake succeeded without a token")
			}
			if res == nil || res.StatusCode != http.StatusUnauthorized {
				t.Fatalf("status = %v (err %v), want 401", res, err)
			}
			body, _ := io.ReadAll(res.Body)
			res.Body.Close()
			if !strings.Contains(string(body), `"unauthorized"`) {
				t.Fatalf("body = %s, want an unauthorized error", body)
			}
		})
	}
}

func TestPingReportsTheHubAndItsClients(t *testing.T) {
	f := newFixture(t, nil)
	f.client(t, "c-1", "mira")

	req, _ := http.NewRequest("GET", f.srv.URL+"/api/v1/ping", nil)
	req.Header.Set("Authorization", "Bearer "+testToken)
	res, err := f.srv.Client().Do(req)
	if err != nil {
		t.Fatalf("ping: %v", err)
	}
	defer res.Body.Close()

	var body struct {
		Events  bool `json:"events"`
		Clients []struct {
			ID   string `json:"id"`
			Name string `json:"name"`
		} `json:"clients"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !body.Events {
		t.Fatal("events = false with a hub attached")
	}
	if len(body.Clients) != 1 || body.Clients[0].ID != "c-1" || body.Clients[0].Name != "mira" {
		t.Fatalf("clients = %+v", body.Clients)
	}
}

// ---------------------------------------------------------------------------
// Change bus
// ---------------------------------------------------------------------------

func TestStoryWriteFansOutButNeverEchoes(t *testing.T) {
	f := newFixture(t, nil)

	writer := f.client(t, "c-writer", "mira")
	listener := f.client(t, "c-listener", "juno")

	f.put(t, "story-1", "Lighthouse", "c-writer", "mira")

	got := waitFor(t, listener, "story")
	want := map[string]any{"t": "story", "id": "story-1", "rev": float64(1), "by": "mira"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("listener got %v, want %v", got, want)
	}

	// The echo check without a sleep: a second write by somebody else is the writer's
	// *first* story message if — and only if — its own write was not echoed back.
	f.put(t, "story-1", "Lighthouse II", "c-someone-else", "juno")

	got = waitFor(t, writer, "story")
	want = map[string]any{"t": "story", "id": "story-1", "rev": float64(2), "by": "juno"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("writer got %v, want %v (rev 1 here means its own write was echoed)", got, want)
	}
}

func TestDeleteRevivedAndAssetsUseTheDocumentedShapes(t *testing.T) {
	f := newFixture(t, nil)
	listener := f.client(t, "c-listener", "juno")

	f.hub.StoryDeleted("story-1", api.Origin{ID: "c-writer", Name: "mira"})
	if got, want := waitFor(t, listener, "deleted"), (map[string]any{
		"t": "deleted", "id": "story-1", "by": "mira",
	}); !reflect.DeepEqual(got, want) {
		t.Fatalf("deleted = %v, want %v", got, want)
	}

	f.hub.StoryRevived("story-1", 44, api.Origin{ID: "c-writer", Name: "mira"})
	if got, want := waitFor(t, listener, "revived"), (map[string]any{
		"t": "revived", "id": "story-1", "rev": float64(44), "by": "mira",
	}); !reflect.DeepEqual(got, want) {
		t.Fatalf("revived = %v, want %v", got, want)
	}

	f.hub.AssetsChanged("story-1", 8, api.Origin{ID: "c-writer", Name: "mira"})
	if got, want := waitFor(t, listener, "assets"), (map[string]any{
		"t": "assets", "story": "story-1", "rev": float64(8), "by": "mira",
	}); !reflect.DeepEqual(got, want) {
		t.Fatalf("assets = %v, want %v", got, want)
	}
}

// ---------------------------------------------------------------------------
// Presence and locks
// ---------------------------------------------------------------------------

func TestPresenceFollowsFocusAndBlur(t *testing.T) {
	f := newFixture(t, nil)

	watcher := f.client(t, "c-watcher", "juno")
	editor := f.client(t, "c-editor", "mira")

	waitPresence(t, watcher, "both clients are listed", func(cs []any) bool {
		return len(cs) == 2
	})

	send(t, editor, map[string]any{"t": "focus", "story": "story-1", "passage": "Start"})
	clients := waitPresence(t, watcher, "the editor holds Start", func(cs []any) bool {
		e := entry(cs, "c-editor")
		return e != nil && e["passage"] == "Start"
	})

	// The entry is PresenceClient field for field: a missing or extra key here would
	// break the lock banner rather than the socket, which is worse.
	e := entry(clients, "c-editor")
	if e["name"] != "mira" || e["story"] != "story-1" {
		t.Fatalf("entry = %v", e)
	}
	since, ok := e["since"].(string)
	if !ok || since == "" {
		t.Fatalf("since = %v", e["since"])
	}
	if len(e) != 5 {
		t.Fatalf("entry has keys %v, want exactly id/name/story/passage/since", e)
	}

	// A watcher sitting in the story map has a story but no passage, which is what makes
	// "someone else is in this passage" a different statement from "someone else is in
	// this story".
	send(t, watcher, map[string]any{"t": "focus", "story": "story-1", "passage": nil})
	clients = waitPresence(t, watcher, "the watcher is in the map", func(cs []any) bool {
		w := entry(cs, "c-watcher")
		return w != nil && w["story"] == "story-1"
	})
	if w := entry(clients, "c-watcher"); w["passage"] != nil {
		t.Fatalf("watcher passage = %v, want null", w["passage"])
	}

	// Blur releases the lock.
	send(t, editor, map[string]any{"t": "blur", "story": "story-1", "passage": "Start"})
	waitPresence(t, watcher, "the editor released Start", func(cs []any) bool {
		e := entry(cs, "c-editor")
		return e != nil && e["passage"] == nil && e["story"] == "story-1"
	})
}

func TestStaleBlurDoesNotReleaseANewerLock(t *testing.T) {
	f := newFixture(t, nil)

	watcher := f.client(t, "c-watcher", "juno")
	editor := f.client(t, "c-editor", "mira")

	send(t, editor, map[string]any{"t": "focus", "story": "story-1", "passage": "Start"})
	send(t, editor, map[string]any{"t": "focus", "story": "story-1", "passage": "Cliff"})
	// Arrives after the passage it names was already left. Acting on it would clear a
	// lock the client genuinely holds.
	send(t, editor, map[string]any{"t": "blur", "story": "story-1", "passage": "Start"})
	send(t, editor, map[string]any{"t": "focus", "story": "story-1", "passage": "Shore"})

	waitPresence(t, watcher, "the editor ends up holding Shore", func(cs []any) bool {
		e := entry(cs, "c-editor")
		return e != nil && e["passage"] == "Shore"
	})
}

func TestSilentClientIsDroppedAfterTheExpiryWindow(t *testing.T) {
	f := newFixture(t, func(o *Options) {
		// Injectable so this test costs 300 ms instead of a minute.
		o.PresenceTTL = 200 * time.Millisecond
		o.SweepInterval = 20 * time.Millisecond
	})

	watcher := f.client(t, "c-watcher", "juno")
	quitter := f.client(t, "c-quitter", "mira")
	send(t, quitter, map[string]any{"t": "focus", "story": "story-1", "passage": "Start"})

	waitPresence(t, watcher, "the quitter holds Start", func(cs []any) bool {
		e := entry(cs, "c-quitter")
		return e != nil && e["passage"] == "Start"
	})

	// The watcher keeps talking; the quitter is a closed laptop.
	done := make(chan struct{})
	defer close(done)
	go func() {
		ticker := time.NewTicker(40 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				if err := watcher.WriteJSON(map[string]any{"t": "ping"}); err != nil {
					return
				}
			}
		}
	}()

	waitPresence(t, watcher, "the quitter's lock is released", func(cs []any) bool {
		return entry(cs, "c-quitter") == nil && entry(cs, "c-watcher") != nil
	})
}

func TestPingIsAnsweredWithPong(t *testing.T) {
	f := newFixture(t, nil)
	c := f.client(t, "c-1", "mira")

	send(t, c, map[string]any{"t": "ping"})
	if got, want := waitFor(t, c, "pong"), (map[string]any{"t": "pong"}); !reflect.DeepEqual(got, want) {
		t.Fatalf("pong = %v, want %v", got, want)
	}
}

func TestStealReachesEveryone(t *testing.T) {
	f := newFixture(t, nil)

	holder := f.client(t, "c-holder", "mira")
	thief := f.client(t, "c-thief", "juno")

	send(t, holder, map[string]any{"t": "focus", "story": "story-1", "passage": "Start"})
	send(t, thief, map[string]any{"t": "steal", "story": "story-1", "passage": "Start"})

	want := map[string]any{"t": "stolen", "story": "story-1", "passage": "Start", "by": "juno"}
	if got := waitFor(t, holder, "stolen"); !reflect.DeepEqual(got, want) {
		t.Fatalf("holder got %v, want %v", got, want)
	}
	// The stealer hears it too, so both banners come from one code path.
	if got := waitFor(t, thief, "stolen"); !reflect.DeepEqual(got, want) {
		t.Fatalf("thief got %v, want %v", got, want)
	}

	// Nobody is kicked: losing the sentence someone is in the middle of typing is worse
	// than two people editing one passage for a minute.
	send(t, holder, map[string]any{"t": "ping"})
	waitFor(t, holder, "pong")
}

// ---------------------------------------------------------------------------
// The hub takes no writes
// ---------------------------------------------------------------------------

func TestWriteShapedMessagesAreIgnored(t *testing.T) {
	f := newFixture(t, nil)

	c := f.client(t, "c-1", "mira")
	watcher := f.client(t, "c-watcher", "juno")

	// Everything a hopeful client might try. None of it is part of ClientMessage, so
	// none of it does anything — and crucially none of it reaches the store.
	send(t, c, map[string]any{"t": "put", "story": map[string]any{"id": "story-1"}})
	send(t, c, map[string]any{"t": "delete", "id": "story-1"})
	send(t, c, map[string]any{"t": "story", "id": "story-1", "rev": 99})
	if err := c.WriteMessage(websocket.TextMessage, []byte("not json at all")); err != nil {
		t.Fatalf("write: %v", err)
	}

	// The connection survives all of it and still answers.
	send(t, c, map[string]any{"t": "ping"})
	waitFor(t, c, "pong")

	// And nothing was fanned out: the watcher's next message is the one we cause here.
	f.hub.StoryChanged("story-2", 1, api.Origin{ID: "c-elsewhere", Name: "someone"})
	got := waitFor(t, watcher, "story")
	if got["id"] != "story-2" {
		t.Fatalf("watcher saw %v — a socket message reached the bus", got)
	}
}

// ---------------------------------------------------------------------------
// Robustness
// ---------------------------------------------------------------------------

func TestSlowClientIsDroppedRatherThanBlockingTheHub(t *testing.T) {
	f := newFixture(t, func(o *Options) {
		// A small buffer so the test fills it in a handful of messages. WriteWait stays
		// at its default 10 s on purpose: it guarantees the connection dies because the
		// buffer filled, not because a write timed out.
		o.SendBuffer = 4
	})

	// The fast client reads continuously, which is what makes it fast.
	fast := f.client(t, "c-fast", "juno")
	got := make(chan map[string]any, 64)
	go func() {
		for {
			_ = fast.SetReadDeadline(time.Now().Add(30 * time.Second))
			_, data, err := fast.ReadMessage()
			if err != nil {
				close(got)
				return
			}
			var msg map[string]any
			if err := json.Unmarshal(data, &msg); err == nil {
				select {
				case got <- msg:
				default:
				}
			}
		}
	}()

	slow := f.client(t, "c-slow", "mira")
	_ = slow // dialled, said hello, and from here on never reads a byte.

	// Addressed as if the fast client had made the change, so the burst goes to the slow
	// client alone and the fast one is left to prove the hub never blocked.
	big := strings.Repeat("x", 256<<10)
	start := time.Now()
	for i := 0; i < 40; i++ {
		f.hub.StoryChanged(fmt.Sprintf("%s-%d", big, i), i, api.Origin{ID: "c-fast", Name: "juno"})
	}
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("broadcasting to a stalled client took %s — the hub blocked on it", elapsed)
	}

	// The slow connection is gone, and with it its presence entry and its locks.
	deadline := time.Now().Add(readWait)
	for {
		clients := f.hub.Clients()
		if len(clients) == 1 && clients[0].ID == "c-fast" {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("slow client still connected: %+v", clients)
		}
		time.Sleep(10 * time.Millisecond)
	}

	// The fast client still works, which is the whole point of dropping the other one.
	f.hub.StoryChanged("story-after", 7, api.Origin{ID: "c-elsewhere", Name: "someone"})
	deadline = time.Now().Add(readWait)
	for {
		select {
		case msg, ok := <-got:
			if !ok {
				t.Fatal("fast client was closed too")
			}
			if msg["t"] == "story" && msg["id"] == "story-after" {
				return
			}
		case <-time.After(time.Until(deadline)):
			t.Fatal("fast client never got the message after the slow one was dropped")
		}
	}
}

func TestCloseHangsUpOnEveryone(t *testing.T) {
	f := newFixture(t, nil)
	c := f.client(t, "c-1", "mira")

	if err := f.hub.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	// Close twice is a no-op, because shutdown paths get called twice.
	if err := f.hub.Close(); err != nil {
		t.Fatalf("close again: %v", err)
	}

	// Read to the end rather than once: a message broadcast just before the hangup is
	// still in flight, and delivering it is not the socket staying open.
	_ = c.SetReadDeadline(time.Now().Add(readWait))
	for {
		if _, _, err := c.ReadMessage(); err != nil {
			break
		}
	}
}
