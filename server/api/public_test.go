package api

import (
	"net/http"
	"testing"
)

func TestPublicStoryNeedsNoToken(t *testing.T) {
	h := newHarness(t, nil)
	expectStatus(t, h.do("PUT", "/api/v1/stories/story-1", storyPayload("Lighthouse", "one")), http.StatusOK)

	res := h.raw("GET", "/pub/story-1", nil, "Origin", "https://elsewhere.example")
	expectStatus(t, res, http.StatusOK)
	if got := res.Header.Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want *", got)
	}

	var body map[string]any
	decode(t, res, &body)
	if body["name"] != "Lighthouse" {
		t.Fatalf("public story said %+v", body)
	}

	expectError(t, h.raw("GET", "/pub/nope", nil), http.StatusNotFound, codeNotFound)
	// The bypass is for reading one story, not for writing or listing.
	expectStatus(t, h.raw("PUT", "/pub/story-1", storyPayload("x", "y")), http.StatusMethodNotAllowed)
}
