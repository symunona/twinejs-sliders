package store

import (
	"errors"
	"os"
	"path/filepath"
)

func (s *Store) playerPath(id string) string { return filepath.Join(s.storyDir(id), "player.html") }

// PutPlayer stores the story's published, playable HTML: what the editor's Copy Public URL
// built. A snapshot, not derived from story.json — the server cannot run the story format.
func (s *Store) PutPlayer(id string, html []byte) error {
	if _, _, err := s.GetStory(id); err != nil {
		return err
	}
	defer s.lock(id)()
	return writeFileAtomic(s.playerPath(id), html)
}

// GetPlayer is the last PutPlayer for a live story.
func (s *Store) GetPlayer(id string) ([]byte, error) {
	if _, _, err := s.GetStory(id); err != nil {
		return nil, err
	}
	body, err := os.ReadFile(s.playerPath(id))
	if errors.Is(err, os.ErrNotExist) {
		return nil, notFound("published player")
	}
	return body, err
}
