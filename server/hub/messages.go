package hub

import (
	"encoding/json"
	"time"
)

// The wire format is the ClientMessage / ServerMessage / PresenceClient unions in
// src/store/persistence/server/server.types.ts. That file is the contract; these structs
// exist to satisfy it field for field, including the `t` discriminator values, and any
// change belongs in both places in the same commit.

// clientMessage is the whole ClientMessage union flattened into one struct.
//
// One struct rather than a discriminated decode because the union has six distinct fields
// in total: decoding once and reading what `t` says is present is less code and cannot
// get the two steps out of step. Unknown values of `t` are ignored — the hub takes no
// writes, so an unrecognised message is never something it needs to refuse loudly.
type clientMessage struct {
	T string `json:"t"`
	// hello
	Client  string   `json:"client"`
	Name    string   `json:"name"`
	Stories []string `json:"stories"`
	// focus, blur, steal
	Story string `json:"story"`
	// Passage is nullable: null means "in the story map, not in a passage".
	Passage *string `json:"passage"`
}

// presenceClient is PresenceClient. story and passage are pointers so they marshal as
// null rather than "" — the client distinguishes "not in a story" from a story id.
type presenceClient struct {
	ID      string  `json:"id"`
	Name    string  `json:"name"`
	Story   *string `json:"story"`
	Passage *string `json:"passage"`
	Since   string  `json:"since"`
}

type welcomeMessage struct {
	T       string           `json:"t"`
	Clients []presenceClient `json:"clients"`
}

type presenceMessage struct {
	T       string           `json:"t"`
	Clients []presenceClient `json:"clients"`
}

// storyMessage serves both `story` and `revived`, which carry the same three fields.
type storyMessage struct {
	T   string `json:"t"`
	ID  string `json:"id"`
	Rev int    `json:"rev"`
	By  string `json:"by"`
}

type deletedMessage struct {
	T  string `json:"t"`
	ID string `json:"id"`
	By string `json:"by"`
}

type assetsMessage struct {
	T     string `json:"t"`
	Story string `json:"story"`
	Rev   int    `json:"rev"`
	By    string `json:"by"`
}

type stolenMessage struct {
	T       string `json:"t"`
	Story   string `json:"story"`
	Passage string `json:"passage"`
	By      string `json:"by"`
}

type pongMessage struct {
	T string `json:"t"`
}

func encode(v any) ([]byte, error) { return json.Marshal(v) }

// timestamp is the format the rest of the API prints times in (see api/health.go), so a
// client parses one shape everywhere.
func timestamp(t time.Time) string {
	return t.UTC().Format("2006-01-02T15:04:05.000Z")
}
