package main

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the whole of the server's configuration. Everything has a default except the
// token, which is the one thing that cannot have one.
type Config struct {
	Addr          string
	DataDir       string
	AuthToken     string
	CORSOrigins   []string
	MaxAssetBytes int64
	MaxStoryBytes int64
	RevKeep       int
	OrphanTTL     time.Duration
	TombstoneTTL  time.Duration
}

// MinTokenLength is the shortest AUTH_TOKEN the server will start with. One shared token
// guards every story on the box; a short one is not a configuration choice, it is a
// mistake, so this is a refusal rather than a warning.
const MinTokenLength = 16

func defaultConfig() Config {
	return Config{
		Addr:          "127.0.0.1:8080",
		DataDir:       "./data",
		MaxAssetBytes: 67108864, // 64 MB
		MaxStoryBytes: 33554432, // 32 MB
		RevKeep:       20,
		OrphanTTL:     168 * time.Hour,  // 7 days
		TombstoneTTL:  2160 * time.Hour, // 90 days
	}
}

// parseEnvFile reads a .env file.
//
// Hand-rolled rather than a dependency: the file holds five keys, and the whole grammar
// is KEY=VALUE, `#` comments, optional quotes and an optional `export` prefix. A library
// for that would be more code to audit than the parser.
func parseEnvFile(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	out := map[string]string{}
	scanner := bufio.NewScanner(f)
	for line := 1; scanner.Scan(); line++ {
		text := strings.TrimSpace(scanner.Text())
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		text = strings.TrimPrefix(text, "export ")

		key, value, ok := strings.Cut(text, "=")
		if !ok {
			return nil, fmt.Errorf("%s:%d: expected KEY=VALUE", path, line)
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)

		if len(value) >= 2 && (value[0] == '"' || value[0] == '\'') && value[len(value)-1] == value[0] {
			value = value[1 : len(value)-1]
		} else if i := strings.Index(value, " #"); i >= 0 {
			// Trailing comment, but only on an unquoted value — a `#` inside quotes is
			// part of a token and stripping it would silently break auth.
			value = strings.TrimSpace(value[:i])
		}
		out[key] = value
	}
	return out, scanner.Err()
}

// LoadConfig builds a Config from defaults, then the .env file, then the real environment.
//
// The real environment wins on purpose: a systemd unit's `Environment=` should not be
// silently overruled by a stale .env sitting in the working directory.
func LoadConfig(envPath string) (Config, error) {
	cfg := defaultConfig()

	fromFile := map[string]string{}
	if envPath != "" {
		parsed, err := parseEnvFile(envPath)
		if err != nil && !errors.Is(err, os.ErrNotExist) {
			return cfg, err
		}
		if parsed != nil {
			fromFile = parsed
		}
	}

	get := func(key string) string {
		if v, ok := os.LookupEnv(key); ok && v != "" {
			return v
		}
		return fromFile[key]
	}

	if v := get("ADDR"); v != "" {
		cfg.Addr = v
	}
	if v := get("DATA_DIR"); v != "" {
		cfg.DataDir = v
	}
	cfg.AuthToken = get("AUTH_TOKEN")

	if v := get("CORS_ORIGINS"); v != "" {
		for _, origin := range strings.Split(v, ",") {
			if origin = strings.TrimSpace(origin); origin != "" {
				cfg.CORSOrigins = append(cfg.CORSOrigins, origin)
			}
		}
	}

	var err error
	if cfg.MaxAssetBytes, err = envInt64(get, "MAX_ASSET_BYTES", cfg.MaxAssetBytes); err != nil {
		return cfg, err
	}
	if cfg.MaxStoryBytes, err = envInt64(get, "MAX_STORY_BYTES", cfg.MaxStoryBytes); err != nil {
		return cfg, err
	}
	if cfg.RevKeep, err = envInt(get, "REV_KEEP", cfg.RevKeep); err != nil {
		return cfg, err
	}
	if cfg.OrphanTTL, err = envDuration(get, "ORPHAN_TTL", cfg.OrphanTTL); err != nil {
		return cfg, err
	}
	if cfg.TombstoneTTL, err = envDuration(get, "TOMBSTONE_TTL", cfg.TombstoneTTL); err != nil {
		return cfg, err
	}
	return cfg, nil
}

// Validate refuses to start on a configuration that cannot be safe.
func (c Config) Validate() error {
	if strings.TrimSpace(c.AuthToken) == "" {
		return errors.New("AUTH_TOKEN is not set: put it in .env or the environment (see .env.example)")
	}
	if len(c.AuthToken) < MinTokenLength {
		return fmt.Errorf("AUTH_TOKEN is %d characters; at least %d are required", len(c.AuthToken), MinTokenLength)
	}
	if c.RevKeep < 1 {
		return fmt.Errorf("REV_KEEP must be at least 1, got %d", c.RevKeep)
	}
	if c.MaxStoryBytes < 1 || c.MaxAssetBytes < 1 {
		return errors.New("MAX_STORY_BYTES and MAX_ASSET_BYTES must be positive")
	}
	return nil
}

func envInt64(get func(string) string, key string, fallback int64) (int64, error) {
	raw := get(key)
	if raw == "" {
		return fallback, nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return fallback, fmt.Errorf("%s must be a whole number of bytes: %v", key, err)
	}
	return n, nil
}

func envInt(get func(string) string, key string, fallback int) (int, error) {
	n, err := envInt64(get, key, int64(fallback))
	return int(n), err
}

func envDuration(get func(string) string, key string, fallback time.Duration) (time.Duration, error) {
	raw := get(key)
	if raw == "" {
		return fallback, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil {
		return fallback, fmt.Errorf("%s must be a Go duration such as 168h: %v", key, err)
	}
	return d, nil
}
