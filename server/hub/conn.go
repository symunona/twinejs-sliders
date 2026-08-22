package hub

import (
	"encoding/json"
	"log"
	"net/http"
	"runtime/debug"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// subprotocolBearer is the marker half of the auth handshake. Browsers cannot set headers
// on a websocket handshake — `new WebSocket(url, protocols)` is the only channel there is
// — so the client offers `Sec-WebSocket-Protocol: bearer, <token>` and the server echoes
// back just `bearer`. The token must therefore be a legal header token (no spaces or
// commas), which the generated AUTH_TOKEN is.
const subprotocolBearer = "bearer"

// conn is one websocket client: two goroutines (read, write), one buffered send channel,
// and the presence entry the rest of the hub reads.
type conn struct {
	hub  *Hub
	ws   *websocket.Conn
	send chan []byte

	// quit is closed exactly once by kill(); both pumps watch it, so a connection can be
	// hung up on from any goroutine without racing on ws.Close().
	quit chan struct{}
	once sync.Once

	// mu guards everything below. Presence is read by /ping and by every broadcast, and
	// written by the read pump, so it needs a lock of its own rather than riding on the
	// hub's.
	mu       sync.Mutex
	hello    bool
	id       string
	name     string
	story    *string
	passage  *string
	since    time.Time
	lastSeen time.Time
	remote   string
}

// ServeHTTP upgrades GET /api/v1/events.
//
// Auth happens before the upgrade so a bad token gets an ordinary 401 with a JSON body,
// which is what the Test button in prefs needs to see. Upgrading first and then closing
// with a policy-violation code would hide the reason behind a websocket close frame.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	defer recoverPanic("handshake")

	if !h.authorized(r) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusUnauthorized)
		// Same shape as api.writeError — ServerErrorBody in server.types.ts. Duplicated
		// rather than exported, because five lines is cheaper than a seam.
		_, _ = w.Write([]byte(`{"error":{"code":"unauthorized","message":"missing or invalid bearer token"}}` + "\n"))
		return
	}

	ws, err := h.upgrade.Upgrade(w, r, nil)
	if err != nil {
		// Upgrade has already written a response by the time it fails.
		log.Printf("hub: upgrade from %s: %v", r.RemoteAddr, err)
		return
	}

	now := time.Now()
	c := &conn{
		hub:      h,
		ws:       ws,
		send:     make(chan []byte, h.opts.SendBuffer),
		quit:     make(chan struct{}),
		since:    now,
		lastSeen: now,
		remote:   r.RemoteAddr,
	}
	// Identity normally arrives in hello. These are the fallback for clients that would
	// rather label the connection at handshake time; hello overrides them.
	c.id = firstNonEmpty(r.URL.Query().Get("X-Client-Id"), r.URL.Query().Get("x-client-id"), r.Header.Get("X-Client-Id"))
	c.name = firstNonEmpty(r.URL.Query().Get("X-Client-Name"), r.URL.Query().Get("x-client-name"), r.Header.Get("X-Client-Name"))

	if !h.add(c) {
		// Hub is shutting down.
		_ = ws.Close()
		return
	}

	// add() has already booked these two into the wait group.
	go func() {
		defer h.wg.Done()
		defer recoverPanic("write pump")
		c.writePump()
	}()
	go func() {
		defer h.wg.Done()
		defer recoverPanic("read pump")
		c.readPump()
	}()
}

// authorized accepts the token from either channel: the subprotocol (browsers) or an
// Authorization header (curl, tests, anything not a browser).
func (h *Hub) authorized(r *http.Request) bool {
	if header := strings.TrimSpace(r.Header.Get("Authorization")); header != "" {
		if tokenOK(header, "Bearer "+h.opts.Token) {
			return true
		}
	}

	protocols := websocket.Subprotocols(r)
	sawBearer := false
	for _, p := range protocols {
		if p == subprotocolBearer {
			sawBearer = true
			continue
		}
		// Every non-marker entry is a candidate token. Checking them all rather than
		// only the one after `bearer` keeps this working if a proxy reorders the list.
		if sawBearer && tokenOK(p, h.opts.Token) {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Presence state
// ---------------------------------------------------------------------------

func (c *conn) identity() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.id
}

func (c *conn) describe() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.name == "" {
		return c.remote
	}
	return c.name + " (" + c.remote + ")"
}

// presence returns this connection's entry, and false before hello: until a client has
// said who it is there is nothing meaningful to show anyone.
func (c *conn) presence() (presenceClient, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.hello {
		return presenceClient{}, false
	}
	return presenceClient{
		ID:      c.id,
		Name:    c.name,
		Story:   c.story,
		Passage: c.passage,
		Since:   timestamp(c.since),
	}, true
}

func (c *conn) staleAt(now time.Time, ttl time.Duration) bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return now.Sub(c.lastSeen) > ttl
}

func (c *conn) touch() {
	c.mu.Lock()
	c.lastSeen = time.Now()
	c.mu.Unlock()
}

// ---------------------------------------------------------------------------
// Pumps
// ---------------------------------------------------------------------------

func (c *conn) trySend(data []byte) bool {
	select {
	case c.send <- data:
		return true
	case <-c.quit:
		// Already dying; not a slow client, so do not report it as one.
		return true
	default:
		return false
	}
}

// kill hangs up. Safe from any goroutine and any number of times, and it deliberately
// takes no hub lock so it can be called from inside a fan-out loop.
func (c *conn) kill() {
	c.once.Do(func() {
		close(c.quit)
		_ = c.ws.Close()
	})
}

func (c *conn) readPump() {
	defer func() {
		c.kill()
		c.hub.remove(c)
		// Someone leaving is a presence change like any other: their locks go with them.
		c.hub.broadcastPresence()
	}()

	c.ws.SetReadLimit(maxMessageBytes)
	_ = c.ws.SetReadDeadline(time.Now().Add(pongWait))
	c.ws.SetPongHandler(func(string) error {
		return c.ws.SetReadDeadline(time.Now().Add(pongWait))
	})

	for {
		_, data, err := c.ws.ReadMessage()
		if err != nil {
			// 1006 is in the expected list with 1000 and 1001: a laptop lid or a
			// killed tab drops the TCP connection without a close frame, and that is
			// the ordinary way a client leaves, not something to log about.
			if websocket.IsUnexpectedCloseError(err,
				websocket.CloseNormalClosure, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("hub: read from %s: %v", c.describe(), err)
			}
			return
		}
		_ = c.ws.SetReadDeadline(time.Now().Add(pongWait))

		var msg clientMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			// Ignored rather than fatal: the socket carries no writes, so a malformed
			// frame can only cost the sender its own message.
			log.Printf("hub: bad frame from %s: %v", c.describe(), err)
			continue
		}
		c.handle(msg)
	}
}

func (c *conn) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.kill()
	}()

	for {
		select {
		case <-c.quit:
			return
		case data := <-c.send:
			_ = c.ws.SetWriteDeadline(time.Now().Add(c.hub.opts.WriteWait))
			if err := c.ws.WriteMessage(websocket.TextMessage, data); err != nil {
				return
			}
		case <-ticker.C:
			// A protocol-level ping, not the app-level one: a browser cannot send WS
			// pings from JavaScript but does answer them automatically, so this is what
			// keeps an idle connection alive through proxies.
			_ = c.ws.SetWriteDeadline(time.Now().Add(c.hub.opts.WriteWait))
			if err := c.ws.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

// ---------------------------------------------------------------------------
// The five messages
// ---------------------------------------------------------------------------

func (c *conn) handle(msg clientMessage) {
	// Any message at all proves the peer is alive, not just `ping`. Being generous here
	// only ever delays an expiry for a client that is demonstrably still there.
	c.touch()

	switch msg.T {
	case "hello":
		c.doHello(msg)
	case "focus":
		c.doFocus(msg)
	case "blur":
		c.doBlur(msg)
	case "steal":
		c.doSteal(msg)
	case "ping":
		c.queue(pongMessage{T: "pong"})
	default:
		// Silently ignored, including anything that looks like a write. See the package
		// comment: writes belong to HTTP.
	}
}

func (c *conn) doHello(msg clientMessage) {
	c.mu.Lock()
	if id := strings.TrimSpace(msg.Client); id != "" {
		c.id = id
	}
	if name := strings.TrimSpace(msg.Name); name != "" {
		c.name = name
	}
	if c.id == "" {
		// No id at all still gets a presence entry — the remote address is a poor label
		// but an invisible collaborator is worse.
		c.id = c.remote
	}
	if c.name == "" {
		c.name = "unknown"
	}
	c.hello = true
	c.since = time.Now()
	c.mu.Unlock()

	// The `stories` list says what this client has checked out. Nothing server-side needs
	// it — presence is per passage and the bus broadcasts every story to everyone — so it
	// is accepted and ignored rather than stored as state that could go stale.

	c.queue(welcomeMessage{T: "welcome", Clients: c.hub.presence()})
	c.hub.broadcastPresence()
}

func (c *conn) doFocus(msg clientMessage) {
	c.mu.Lock()
	changed := c.story == nil || *c.story != msg.Story || !samePassage(c.passage, msg.Passage)
	story := msg.Story
	c.story = &story
	c.passage = clone(msg.Passage)
	if changed {
		// `since` means "in this passage since", which is what the lock banner prints.
		c.since = time.Now()
	}
	c.mu.Unlock()

	if changed {
		c.hub.broadcastPresence()
	}
}

func (c *conn) doBlur(msg clientMessage) {
	c.mu.Lock()
	changed := false
	// A blur naming a passage the client has already moved on from is stale — it arrives
	// after the focus that replaced it whenever a passage is closed by opening another —
	// and acting on it would clear a lock that is genuinely held.
	if msg.Passage == nil || samePassage(c.passage, msg.Passage) {
		if c.passage != nil {
			c.passage = nil
			changed = true
		}
	}
	// passage null means "left the story map too".
	if msg.Passage == nil && c.story != nil && *c.story == msg.Story {
		c.story = nil
		changed = true
	}
	c.mu.Unlock()

	if changed {
		c.hub.broadcastPresence()
	}
}

// doSteal announces a takeover and does nothing else.
//
// The hub does not kick the previous holder off, because kicking someone mid-sentence is
// how you lose the sentence. Both editors become writable, both show a banner, and with
// two or three people "we can both see this is happening" is enough. Who actually wins a
// simultaneous save is still rev + If-Match on the HTTP side.
func (c *conn) doSteal(msg clientMessage) {
	if msg.Passage == nil || *msg.Passage == "" || msg.Story == "" {
		return
	}
	c.mu.Lock()
	by := c.name
	c.mu.Unlock()

	// Broadcast to everyone including the stealer: the client's own banner is driven by
	// the same message, so there is one code path instead of two.
	c.hub.broadcast(stolenMessage{T: "stolen", Story: msg.Story, Passage: *msg.Passage, By: by}, "")
}

// queue sends to this connection alone. A full buffer here means the same thing it means
// during a broadcast, and gets the same answer.
func (c *conn) queue(msg any) {
	data, err := encode(msg)
	if err != nil {
		log.Printf("hub: encoding %T: %v", msg, err)
		return
	}
	if !c.trySend(data) {
		log.Printf("hub: dropping slow client %s", c.describe())
		c.kill()
	}
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

// recoverPanic keeps one broken connection from taking the whole server with it. Every
// goroutine this package starts is wrapped in it.
func recoverPanic(what string) {
	if r := recover(); r != nil {
		log.Printf("hub: panic in %s: %v\n%s", what, r, debug.Stack())
	}
}

func samePassage(a, b *string) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func clone(s *string) *string {
	if s == nil {
		return nil
	}
	v := *s
	return &v
}

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if v = strings.TrimSpace(v); v != "" {
			return v
		}
	}
	return ""
}
