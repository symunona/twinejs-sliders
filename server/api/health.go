package api

import (
	"net/http"
	"time"
)

type healthResponse struct {
	OK         bool   `json:"ok"`
	Service    string `json:"service"`
	APIVersion int    `json:"apiVersion"`
}

// ServiceName is what /health calls itself, so a client can tell this server from
// whatever else answers on that address.
const ServiceName = "twine-sliders-server"

func (s *server) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{OK: true, Service: ServiceName, APIVersion: APIVersion})
}

type pingResponse struct {
	OK            bool             `json:"ok"`
	APIVersion    int              `json:"apiVersion"`
	Version       string           `json:"version"`
	StoryCount    int              `json:"storyCount"`
	BytesUsed     int64            `json:"bytesUsed"`
	MaxAssetBytes int64            `json:"maxAssetBytes"`
	MaxStoryBytes int64            `json:"maxStoryBytes"`
	KeepRevisions int              `json:"keepRevisions"`
	Events        bool             `json:"events"`
	Clients       []PresenceClient `json:"clients"`
	Time          string           `json:"time"`
}

// ping is the authenticated probe. It reports the limits as well as the counts because
// the client complains about an oversized asset before uploading it, not after.
func (s *server) ping(w http.ResponseWriter, r *http.Request) {
	stories, err := s.st.List()
	if err != nil {
		fail(w, err)
		return
	}
	count := 0
	for _, e := range stories {
		if !e.Deleted {
			count++
		}
	}
	used, err := s.st.DiskUsage()
	if err != nil {
		fail(w, err)
		return
	}

	// No hub yet: events:false and an empty list is the honest answer, and it is what
	// makes the socket an optional layer the client already degrades without.
	events := false
	clients := []PresenceClient{}
	if s.opts.Presence != nil {
		events = s.opts.Presence.Events()
		if c := s.opts.Presence.Clients(); c != nil {
			clients = c
		}
	}

	writeJSON(w, http.StatusOK, pingResponse{
		OK:            true,
		APIVersion:    APIVersion,
		Version:       s.opts.Version,
		StoryCount:    count,
		BytesUsed:     used,
		MaxAssetBytes: s.opts.MaxAssetBytes,
		MaxStoryBytes: s.opts.MaxStoryBytes,
		KeepRevisions: s.opts.KeepRevisions,
		Events:        events,
		Clients:       clients,
		Time:          time.Now().UTC().Format("2006-01-02T15:04:05.000Z"),
	})
}
