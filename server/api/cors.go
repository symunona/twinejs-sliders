package api

import (
	"net/http"
	"strings"
)

// allowedHeaders is every header the client actually sends. Preflight fails closed, so a
// header missing from this list breaks a route silently — it is listed in spec 11 for
// that reason and kept in sync with client.ts.
const allowedHeaders = "authorization, content-type, if-match, if-none-match, x-asset-hash, x-client-id, x-client-name"

const allowedMethods = "GET, HEAD, POST, PUT, DELETE, OPTIONS"

// corsMiddleware answers preflights and stamps the actual responses.
//
// Done in Go rather than in Caddy: it is one place, it varies per route, and the reverse
// proxy in front of this is not guaranteed to be Caddy forever. There is no
// Allow-Credentials because there are no cookies — the bearer token is an explicit header.
func corsMiddleware(origins []string, next http.Handler) http.Handler {
	allowAny := false
	allowed := make(map[string]bool, len(origins))
	for _, o := range origins {
		o = strings.TrimSpace(o)
		if o == "*" {
			allowAny = true
		} else if o != "" {
			allowed[o] = true
		}
	}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" && (allowAny || allowed[origin]) {
			// Echo the origin rather than "*": it keeps the response valid if
			// credentials are ever added, and it tells a misconfigured editor exactly
			// which origin was accepted.
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Expose-Headers", "etag")
		}

		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Headers", allowedHeaders)
			w.Header().Set("Access-Control-Allow-Methods", allowedMethods)
			w.Header().Set("Access-Control-Max-Age", "86400")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}
