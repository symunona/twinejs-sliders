// Package api is the HTTP surface of the story backup server (spec 11).
//
// Every route lives under /api/v1 and every one of them needs a bearer token except
// /api/v1/health. Handlers do argument checking, preconditions and status mapping; all
// disk work belongs to package store, and all notification goes through Notifier so the
// websocket hub can be added without touching this file.
package api

import (
	"net/http"

	"twine-story-store/store"
)

// APIVersion is the `apiVersion` field of /health and /ping — API_VERSION in
// server.types.ts.
const APIVersion = 1

// Options is everything the handlers need from the server config.
type Options struct {
	Store         *store.Store
	Token         string
	Origins       []string
	MaxStoryBytes int64
	MaxAssetBytes int64
	KeepRevisions int
	// Version is the server build string reported by /ping.
	Version string
	// Notifier receives every accepted change. Nil means no hub.
	Notifier Notifier
	// Presence answers /ping's `clients`. Nil means no hub.
	Presence PresenceSource
	// Events is the websocket handler for GET /api/v1/events, normally *hub.Hub. Nil
	// means the route does not exist and clients fall back to polling.
	Events http.Handler
}

type server struct {
	opts Options
	st   *store.Store
	hub  Notifier
}

// NewHandler builds the whole API: routes, auth, CORS.
//
// The middleware is wrapped here rather than in main so that a test can exercise the real
// stack — a 401 is part of the contract and deserves a test, not a comment.
func NewHandler(opts Options) http.Handler {
	if opts.Notifier == nil {
		opts.Notifier = NopNotifier{}
	}
	if opts.Version == "" {
		opts.Version = "dev"
	}

	s := &server{opts: opts, st: opts.Store, hub: opts.Notifier}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/v1/health", s.health)
	mux.HandleFunc("GET /api/v1/ping", s.ping)

	if opts.Events != nil {
		// Not wrapped in authMiddleware: a browser cannot put an Authorization header on
		// a websocket handshake, so the hub authenticates the subprotocol itself and
		// answers 401 before upgrading. See eventsPath in auth.go.
		mux.Handle("GET "+eventsPath, opts.Events)
	}

	mux.HandleFunc("GET /api/v1/stories", s.listStories)
	mux.HandleFunc("GET /api/v1/stories/{id}", s.getStory)
	mux.HandleFunc("PUT /api/v1/stories/{id}", s.putStory)
	mux.HandleFunc("DELETE /api/v1/stories/{id}", s.deleteStory)

	mux.HandleFunc("GET /api/v1/stories/{id}/revisions", s.listRevisions)
	mux.HandleFunc("GET /api/v1/stories/{id}/revisions/{rev}", s.getRevision)
	mux.HandleFunc("GET /api/v1/stories/{id}/revisions/{rev}/assets", s.getRevisionAssets)
	mux.HandleFunc("POST /api/v1/stories/{id}/restore", s.restoreStory)

	mux.HandleFunc("GET /api/v1/stories/{id}/assets", s.getManifest)
	mux.HandleFunc("PUT /api/v1/stories/{id}/assets", s.putManifest)
	mux.HandleFunc("POST /api/v1/stories/{id}/assets/diff", s.diffAssets)

	// GET also serves HEAD: net/http matches HEAD against a GET pattern and drops the
	// body itself, which is exactly the Content-Length + ETag probe the client wants.
	mux.HandleFunc("GET /api/v1/stories/{id}/assets/{assetId}", s.getAsset)
	mux.HandleFunc("PUT /api/v1/stories/{id}/assets/{assetId}", s.putAsset)
	mux.HandleFunc("DELETE /api/v1/stories/{id}/assets/{assetId}", s.deleteAsset)

	return corsMiddleware(opts.Origins, authMiddleware(opts.Token, mux))
}
