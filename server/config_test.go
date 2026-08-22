package main

import (
	"bytes"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

func writeEnv(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), ".env")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestLoadConfigDefaults(t *testing.T) {
	cfg, err := LoadConfig(writeEnv(t, "AUTH_TOKEN=0123456789abcdef\n"))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != "127.0.0.1:8080" || cfg.DataDir != "./data" {
		t.Fatalf("defaults wrong: %+v", cfg)
	}
	if cfg.MaxAssetBytes != 67108864 || cfg.MaxStoryBytes != 33554432 || cfg.RevKeep != 20 {
		t.Fatalf("limit defaults wrong: %+v", cfg)
	}
	if cfg.OrphanTTL != 168*time.Hour || cfg.TombstoneTTL != 2160*time.Hour {
		t.Fatalf("ttl defaults wrong: %+v", cfg)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("Validate: %v", err)
	}
}

func TestParseEnvFileGrammar(t *testing.T) {
	path := writeEnv(t, strings.Join([]string{
		"# a comment",
		"",
		"AUTH_TOKEN=abcdefghijklmnop  # trailing comment",
		`ADDR="127.0.0.1:9999"`,
		"export DATA_DIR=/srv/twine",
		"CORS_ORIGINS=https://a.example, http://127.0.0.1:5173",
		"REV_KEEP=5",
		"ORPHAN_TTL=2h",
		"TOMBSTONE_TTL=48h",
		"MAX_ASSET_BYTES=1024",
		"MAX_STORY_BYTES=2048",
	}, "\n"))

	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AuthToken != "abcdefghijklmnop" {
		t.Fatalf("token = %q", cfg.AuthToken)
	}
	if cfg.Addr != "127.0.0.1:9999" || cfg.DataDir != "/srv/twine" {
		t.Fatalf("addr/data = %q %q", cfg.Addr, cfg.DataDir)
	}
	if len(cfg.CORSOrigins) != 2 || cfg.CORSOrigins[1] != "http://127.0.0.1:5173" {
		t.Fatalf("origins = %v", cfg.CORSOrigins)
	}
	if cfg.RevKeep != 5 || cfg.OrphanTTL != 2*time.Hour || cfg.TombstoneTTL != 48*time.Hour {
		t.Fatalf("parsed values wrong: %+v", cfg)
	}
	if cfg.MaxAssetBytes != 1024 || cfg.MaxStoryBytes != 2048 {
		t.Fatalf("limits = %d %d", cfg.MaxAssetBytes, cfg.MaxStoryBytes)
	}
}

func TestQuotedTokenKeepsItsHash(t *testing.T) {
	path := writeEnv(t, "AUTH_TOKEN=\"abc#defghijklmnop\"\n")
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.AuthToken != "abc#defghijklmnop" {
		t.Fatalf("token = %q — a quoted value must survive intact", cfg.AuthToken)
	}
}

func TestEnvironmentBeatsDotEnv(t *testing.T) {
	path := writeEnv(t, "AUTH_TOKEN=from-the-file-xxxx\nADDR=127.0.0.1:1111\n")
	t.Setenv("ADDR", "127.0.0.1:2222")

	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Addr != "127.0.0.1:2222" {
		t.Fatalf("addr = %q — a systemd Environment= must beat a stale .env", cfg.Addr)
	}
}

func TestMissingEnvFileIsNotAnError(t *testing.T) {
	t.Setenv("AUTH_TOKEN", "0123456789abcdef")
	cfg, err := LoadConfig(filepath.Join(t.TempDir(), "absent"))
	if err != nil {
		t.Fatalf("a missing .env should be fine: %v", err)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatal(err)
	}
}

func TestValidateRefusesWeakTokens(t *testing.T) {
	for _, token := range []string{"", "   ", "short", "fifteencharsxx"} {
		cfg := defaultConfig()
		cfg.AuthToken = token
		if err := cfg.Validate(); err == nil {
			t.Fatalf("token %q was accepted", token)
		}
	}
}

func TestListenAndAnnouncePrintsThePort(t *testing.T) {
	var out bytes.Buffer
	ln, err := listenAndAnnounce("127.0.0.1:0", &out)
	if err != nil {
		t.Fatal(err)
	}
	defer ln.Close()

	line := out.String()
	// The Playwright fixture parses exactly this, so the format is a contract.
	if !regexp.MustCompile(`^listening on 127\.0\.0\.1:\d+\n$`).MatchString(line) {
		t.Fatalf("announced %q", line)
	}
	_, port, err := net.SplitHostPort(ln.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(line, ":"+port+"\n") {
		t.Fatalf("announced %q but bound port %s", line, port)
	}
}
