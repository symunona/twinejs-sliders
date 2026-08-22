package api

import (
	"crypto/subtle"
	"net/http"
	"strings"
)

// healthPath is the one route that answers without a token. Two probes exist so the Test
// button can tell "server down" from "token rejected" (spec 11), and that only works if
// health is reachable unauthenticated.
const healthPath = "/api/v1/health"

// eventsPath is the websocket. It skips this middleware because `new WebSocket(url)` in a
// browser cannot carry an Authorization header — the token rides the subprotocol instead
// (`bearer, <token>`), which only the upgrade handler can read. It checks the same token
// with the same constant-time compare and answers the same 401; the check moves, it does
// not disappear.
const eventsPath = "/api/v1/events"

// authMiddleware checks `Authorization: Bearer <token>` against AUTH_TOKEN.
//
// One shared token for two or three people is a deliberate choice for an internal tool:
// identity is a label carried in X-Client-Name, not a credential. The comparison is
// constant time anyway — a timing oracle on the one secret that exists would be a silly
// way to lose it.
func authMiddleware(token string, next http.Handler) http.Handler {
	want := []byte("Bearer " + token)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == healthPath || r.URL.Path == eventsPath {
			next.ServeHTTP(w, r)
			return
		}

		got := []byte(strings.TrimSpace(r.Header.Get("Authorization")))
		if len(got) != len(want) || subtle.ConstantTimeCompare(got, want) != 1 {
			writeError(w, http.StatusUnauthorized, codeUnauthorized, "missing or invalid bearer token")
			return
		}
		next.ServeHTTP(w, r)
	})
}
