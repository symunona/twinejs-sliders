package api

// Origin is who made a change.
//
// Two fields rather than one string because the bus needs both: Name is what goes on the
// wire as `by` ("Lighthouse changed — mira"), and ID is how the hub knows not to echo a
// change back to the client that made it. Without the id every writer would be told about
// its own write and pull back what it had just pushed.
type Origin struct {
	ID   string
	Name string
}

// Notifier is the seam the websocket hub plugs into.
//
// The hub is a separate package on purpose (spec 11): the server takes no writes over the
// socket, so notification is strictly one way — HTTP handlers announce what already
// happened on disk, and nothing on the socket can corrupt a story. Handlers call these
// after the write succeeded, never before.
type Notifier interface {
	StoryChanged(id string, rev int, by Origin)
	StoryDeleted(id string, by Origin)
	StoryRevived(id string, rev int, by Origin)
	AssetsChanged(story string, rev int, by Origin)
}

// NopNotifier is the default: the API works with no hub attached, which is what keeps the
// socket an optional layer rather than a dependency.
type NopNotifier struct{}

func (NopNotifier) StoryChanged(string, int, Origin)  {}
func (NopNotifier) StoryDeleted(string, Origin)       {}
func (NopNotifier) StoryRevived(string, int, Origin)  {}
func (NopNotifier) AssetsChanged(string, int, Origin) {}

// PresenceClient is one entry of `/ping`'s `clients` — id and name only. The full
// presence record (story, passage, since) lives on the socket.
type PresenceClient struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

// PresenceSource lets the hub answer "who else is here?" for `/ping`, so the Test button
// in prefs can say "Connected — 3 stories, 46 MB, also here: mira". Nil means no hub, and
// `/ping` then reports events:false with an empty client list.
type PresenceSource interface {
	Events() bool
	Clients() []PresenceClient
}
