// Package hub is the websocket layer of the story backup server (spec 11): a change bus,
// an in-memory presence map, and the soft locks that fall out of presence.
//
// # The hub accepts no writes
//
// It handles exactly five client messages — hello, focus, blur, steal, ping — and ignores
// everything else. Story and asset writes stay on HTTP, and they stay there on purpose:
// authentication, body-size limits, temp-file-plus-rename atomic writes, If-Match
// preconditions and the rev/snapshot chain all live on the HTTP side already. A socket
// that could write would have to reimplement every one of those, and the day the two
// implementations disagreed is the day a story gets corrupted. So the socket carries
// notifications and ephemeral state only, and nothing arriving on it can touch the disk.
//
// # What it does carry
//
//   - Change bus: HTTP handlers call the api.Notifier methods after a write has landed,
//     and the hub fans the news out to every client except the one that made it — that
//     client already knows, and an echo would make it pull its own write back.
//   - Presence: {id, name, story, passage, since} per connection, in memory, never on
//     disk, empty after a restart, which is the correct state for "who is here now".
//   - Soft locks: a lock is nothing more than someone else's presence entry naming a
//     passage. There is no lock table and no enforcement; steal just tells everyone.
package hub

import (
	"crypto/subtle"
	"log"
	"net/http"
	"sort"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"twine-story-store/api"
)

// EventsPath is where the socket lives. Exported so routes.go and the client agree
// without a second string literal.
const EventsPath = "/api/v1/events"

const (
	// defaultPresenceTTL drops a presence entry whose connection has gone quiet. The
	// client pings every 20 s (spec 11), so a minute of silence means a closed laptop or
	// a dead tab — and a closed laptop must release its locks, or a passage stays
	// "locked by mira" until someone restarts the server.
	defaultPresenceTTL = 60 * time.Second
	// defaultSweepInterval is how often that expiry is checked. Coarse on purpose: a few
	// seconds late releasing an advisory lock costs nothing.
	defaultSweepInterval = 5 * time.Second
	// defaultWriteWait bounds a single write. A peer that has stopped reading blocks the
	// write pump, not the hub, but it still has to be given up on eventually.
	defaultWriteWait = 10 * time.Second
	// defaultSendBuffer is how many broadcasts a connection may fall behind before it is
	// dropped. Broadcasts are tiny and rare; needing 32 of them queued means the peer is
	// not reading at all.
	defaultSendBuffer = 32
	// pongWait must comfortably exceed both pingPeriod and the client's own 20 s app
	// ping, otherwise a healthy connection gets killed for being idle.
	pongWait   = 70 * time.Second
	pingPeriod = 30 * time.Second
	// maxMessageBytes caps an inbound frame. Nothing in the ClientMessage union is big;
	// the only variable-length part is a hello with a list of story ids.
	maxMessageBytes = 32 << 10
)

// Options configures a Hub. Everything has a usable default except Token.
type Options struct {
	// Token is AUTH_TOKEN. Same secret as the HTTP middleware, compared the same way.
	Token string
	// Origins is CORS_ORIGINS. Browsers do not preflight a websocket handshake, so the
	// Origin check happens here instead. Empty means "any origin", which is safe enough
	// only because the token is still required.
	Origins []string
	// PresenceTTL and SweepInterval are injectable so a test can expire a client in
	// milliseconds instead of sleeping for a minute.
	PresenceTTL   time.Duration
	SweepInterval time.Duration
	// WriteWait and SendBuffer are injectable for the same reason: the slow-client test
	// needs a buffer it can actually fill.
	WriteWait  time.Duration
	SendBuffer int
}

// Hub owns the set of live connections.
//
// The set is guarded by a plain RWMutex rather than being owned by a single goroutine,
// because /ping asks for the client list synchronously from an HTTP handler and a
// request/reply channel dance for that would be more machinery than the thing it guards.
type Hub struct {
	opts Options

	mu      sync.RWMutex
	conns   map[*conn]struct{}
	closed  bool
	upgrade websocket.Upgrader

	done chan struct{}
	wg   sync.WaitGroup
}

// New starts a Hub. Close it to stop the sweeper and hang up on every client.
func New(opts Options) *Hub {
	if opts.PresenceTTL <= 0 {
		opts.PresenceTTL = defaultPresenceTTL
	}
	if opts.SweepInterval <= 0 {
		opts.SweepInterval = defaultSweepInterval
	}
	if opts.WriteWait <= 0 {
		opts.WriteWait = defaultWriteWait
	}
	if opts.SendBuffer <= 0 {
		opts.SendBuffer = defaultSendBuffer
	}

	h := &Hub{
		opts:  opts,
		conns: map[*conn]struct{}{},
		done:  make(chan struct{}),
	}
	h.upgrade = websocket.Upgrader{
		HandshakeTimeout: 10 * time.Second,
		ReadBufferSize:   1024,
		WriteBufferSize:  4096,
		// The editor is served from a different origin than the API, so gorilla's
		// same-host default would reject every real browser.
		CheckOrigin: h.checkOrigin,
		// Offering exactly "bearer" makes gorilla echo it and never the token: the
		// client sends `bearer, <token>` and only the first half comes back.
		Subprotocols: []string{subprotocolBearer},
	}

	h.wg.Add(1)
	go func() {
		defer h.wg.Done()
		h.sweep()
	}()

	return h
}

// Close hangs up on every client and waits for their goroutines. Called from the SIGTERM
// path next to http.Server.Shutdown, so an operator restart does not leave browsers
// waiting on a socket that will never answer.
func (h *Hub) Close() error {
	h.mu.Lock()
	if h.closed {
		h.mu.Unlock()
		return nil
	}
	h.closed = true
	victims := make([]*conn, 0, len(h.conns))
	for c := range h.conns {
		victims = append(victims, c)
	}
	h.mu.Unlock()

	close(h.done)
	for _, c := range victims {
		c.kill()
	}
	h.wg.Wait()
	return nil
}

// ---------------------------------------------------------------------------
// api.PresenceSource
// ---------------------------------------------------------------------------

// Events reports that this server has a bus at all, which is what tells the editor it can
// stop polling GET /stories every 30 s.
func (h *Hub) Events() bool { return true }

// Clients is /ping's `clients`: id and name only. The full presence record goes over the
// socket, where it can be kept current.
func (h *Hub) Clients() []api.PresenceClient {
	present := h.presence()
	out := make([]api.PresenceClient, 0, len(present))
	for _, p := range present {
		out = append(out, api.PresenceClient{ID: p.ID, Name: p.Name})
	}
	return out
}

// ---------------------------------------------------------------------------
// api.Notifier — the change bus
// ---------------------------------------------------------------------------

// StoryChanged announces an accepted write. `by.ID` is skipped: the client that made the
// change already has the new body, and telling it about its own write would make it
// re-fetch what it just sent.
func (h *Hub) StoryChanged(id string, rev int, by api.Origin) {
	h.broadcast(storyMessage{T: "story", ID: id, Rev: rev, By: by.Name}, by.ID)
}

func (h *Hub) StoryDeleted(id string, by api.Origin) {
	h.broadcast(deletedMessage{T: "deleted", ID: id, By: by.Name}, by.ID)
}

func (h *Hub) StoryRevived(id string, rev int, by api.Origin) {
	h.broadcast(storyMessage{T: "revived", ID: id, Rev: rev, By: by.Name}, by.ID)
}

func (h *Hub) AssetsChanged(story string, rev int, by api.Origin) {
	h.broadcast(assetsMessage{T: "assets", Story: story, Rev: rev, By: by.Name}, by.ID)
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

// add registers a connection and books its two pumps into the wait group.
//
// The wg.Add happens here, under the same lock Close takes, rather than in the caller:
// otherwise a connection accepted a moment before shutdown could call Add after Close had
// already reached Wait, which is the one way to make a WaitGroup panic.
func (h *Hub) add(c *conn) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return false
	}
	h.conns[c] = struct{}{}
	h.wg.Add(2)
	return true
}

func (h *Hub) remove(c *conn) {
	h.mu.Lock()
	delete(h.conns, c)
	h.mu.Unlock()
}

func (h *Hub) snapshot() []*conn {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]*conn, 0, len(h.conns))
	for c := range h.conns {
		out = append(out, c)
	}
	return out
}

// broadcast fans a message out to everyone but exceptID.
//
// The message is encoded once, and each connection is handed the bytes through its own
// buffered channel: the hub never writes to a socket itself, so one wedged peer cannot
// stall the fan-out. A peer whose buffer is full is not waited for — it is closed, on the
// grounds that a client 32 broadcasts behind has stopped being a client.
func (h *Hub) broadcast(msg any, exceptID string) {
	data, err := encode(msg)
	if err != nil {
		log.Printf("hub: encoding %T: %v", msg, err)
		return
	}

	// Killing is deliberately done outside the loop: kill() does not take the hub lock,
	// but the connection's own goroutine will call remove() as it unwinds, and that
	// wants the write lock this loop is holding as a reader.
	var slow []*conn
	for _, c := range h.snapshot() {
		if exceptID != "" && c.identity() == exceptID {
			continue
		}
		if !c.trySend(data) {
			slow = append(slow, c)
		}
	}
	for _, c := range slow {
		log.Printf("hub: dropping slow client %s", c.describe())
		c.kill()
	}
}

// presence is the current presence list, oldest arrival first so that every client draws
// the same order and a repeated broadcast is byte-identical when nothing changed.
func (h *Hub) presence() []presenceClient {
	conns := h.snapshot()
	out := make([]presenceClient, 0, len(conns))
	for _, c := range conns {
		if p, ok := c.presence(); ok {
			out = append(out, p)
		}
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Since != out[j].Since {
			return out[i].Since < out[j].Since
		}
		return out[i].ID < out[j].ID
	})
	return out
}

// broadcastPresence tells everyone who is here. Sent on every change rather than
// diffed: the payload is three or four entries and a diff protocol for that would be
// more code than the feature.
func (h *Hub) broadcastPresence() {
	h.broadcast(presenceMessage{T: "presence", Clients: h.presence()}, "")
}

// sweep drops connections that have gone quiet. See defaultPresenceTTL: this is the path
// that releases a closed laptop's locks.
func (h *Hub) sweep() {
	ticker := time.NewTicker(h.opts.SweepInterval)
	defer ticker.Stop()

	for {
		select {
		case <-h.done:
			return
		case now := <-ticker.C:
			var expired []*conn
			for _, c := range h.snapshot() {
				if c.staleAt(now, h.opts.PresenceTTL) {
					expired = append(expired, c)
				}
			}
			if len(expired) == 0 {
				continue
			}
			for _, c := range expired {
				log.Printf("hub: expiring silent client %s", c.describe())
				// The whole connection goes, not just its presence entry: a peer that
				// has not spoken in a minute is gone, and leaving its socket open would
				// only queue broadcasts nobody will read.
				c.kill()
			}
			// The connections' own goroutines broadcast presence as they unwind, but
			// they may not have run yet; one extra presence message is harmless and the
			// list is idempotent.
			h.broadcastPresence()
		}
	}
}

// tokenOK is the same constant-time comparison the HTTP middleware uses. A timing oracle
// on the single secret this server has would be a silly way to lose it, and the socket is
// not a special case just because the token arrived in a subprotocol.
func tokenOK(got, want string) bool {
	if len(got) != len(want) || want == "" {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func (h *Hub) checkOrigin(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		// Not a browser: curl, the test suite, a script. There is no origin to check and
		// the token has already been verified by the time this runs.
		return true
	}
	if len(h.opts.Origins) == 0 {
		return true
	}
	for _, o := range h.opts.Origins {
		if o == "*" || o == origin {
			return true
		}
	}
	return false
}
