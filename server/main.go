// Command twine-story-store is the backup and shared-library server for the sliders fork
// of Twine (docs/sliders/11-server-storage.md).
//
// It stores stories, their asset manifests and asset bytes on disk, keeps the last N
// revisions of every story, and answers a small JSON API over HTTP. It binds loopback by
// default and expects a TLS terminator (Caddy) in front of it in production.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"twine-story-store/api"
	"twine-story-store/hub"
	"twine-story-store/store"
)

// version is the build string reported by /ping.
const version = "0.1.0-sliders"

func main() {
	if err := run(); err != nil {
		// Configuration failures are the common case here and the operator is reading
		// stderr, so this is one clear line, not a stack.
		fmt.Fprintln(os.Stderr, "twine-story-store: "+err.Error())
		os.Exit(1)
	}
}

func run() error {
	var (
		addrFlag = flag.String("addr", "", "listen address, overrides ADDR (use :0 for any free port)")
		dataFlag = flag.String("data", "", "data directory, overrides DATA_DIR")
		envFlag  = flag.String("env", ".env", "path to the .env file; missing is not an error")
	)
	flag.Parse()

	cfg, err := LoadConfig(*envFlag)
	if err != nil {
		return err
	}
	if *addrFlag != "" {
		cfg.Addr = *addrFlag
	}
	if *dataFlag != "" {
		cfg.DataDir = *dataFlag
	}
	if err := cfg.Validate(); err != nil {
		return err
	}

	st, err := store.New(store.Options{
		Dir:          cfg.DataDir,
		RevKeep:      cfg.RevKeep,
		OrphanTTL:    cfg.OrphanTTL,
		TombstoneTTL: cfg.TombstoneTTL,
	})
	if err != nil {
		return err
	}

	// The hub is the websocket layer: change bus, presence and soft locks, all in
	// memory. It is constructed before the handler because the handler needs it three
	// times over — as the notifier every write announces itself through, as the presence
	// source /ping reports, and as the handler for GET /api/v1/events.
	events := hub.New(hub.Options{Token: cfg.AuthToken, Origins: cfg.CORSOrigins})

	handler := api.NewHandler(api.Options{
		Store:         st,
		Token:         cfg.AuthToken,
		Origins:       cfg.CORSOrigins,
		MaxStoryBytes: cfg.MaxStoryBytes,
		MaxAssetBytes: cfg.MaxAssetBytes,
		KeepRevisions: cfg.RevKeep,
		Version:       version,
		Notifier:      events,
		Presence:      events,
		Events:        events,
	})

	ln, err := listenAndAnnounce(cfg.Addr, os.Stdout)
	if err != nil {
		return err
	}

	log.SetOutput(os.Stderr)
	log.SetFlags(log.LstdFlags | log.LUTC)
	log.Printf("twine-story-store %s data=%s revKeep=%d maxStory=%dB maxAsset=%dB origins=%v",
		version, cfg.DataDir, cfg.RevKeep, cfg.MaxStoryBytes, cfg.MaxAssetBytes, cfg.CORSOrigins)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go janitor(ctx, st)

	srv := &http.Server{
		Handler: handler,
		// No read or write deadline: a 64 MB asset over a slow link is a legitimate
		// request. The header timeout is what actually protects against a stuck peer,
		// and the idle timeout reaps abandoned keep-alives.
		ReadHeaderTimeout: 15 * time.Second,
		IdleTimeout:       120 * time.Second,
		ErrorLog:          log.Default(),
	}

	serveErr := make(chan error, 1)
	go func() {
		err := srv.Serve(ln)
		if errors.Is(err, http.ErrServerClosed) {
			err = nil
		}
		serveErr <- err
	}()

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
	}

	log.Print("shutting down")
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	// The hub goes first: Shutdown waits for open connections, and a websocket is open
	// until someone closes it, so shutting the hub down after the server would mean
	// waiting out the full timeout on every connected browser.
	if err := events.Close(); err != nil {
		log.Printf("hub: %v", err)
	}
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	return <-serveErr
}

// listenAndAnnounce binds the address and prints where it landed.
//
// Binding before serving is what makes `--addr 127.0.0.1:0` usable: the Playwright
// fixture (spec 11, testing layer 3) spawns this binary per spec file and reads the port
// off the first line of stdout. That line must therefore be the *first* thing on stdout
// and must never move — which is why every log in this process goes to stderr instead.
func listenAndAnnounce(addr string, out io.Writer) (net.Listener, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, err
	}
	if _, err := fmt.Fprintf(out, "listening on %s\n", ln.Addr().String()); err != nil {
		ln.Close()
		return nil, err
	}
	if f, ok := out.(*os.File); ok {
		// A pipe to the test harness is not line buffered by the OS, but syncing costs
		// nothing and removes any doubt about the reader seeing the line immediately.
		_ = f.Sync()
	}
	return ln, nil
}

// janitor sweeps orphaned asset blobs and expired tombstones, once at start and then
// daily. At start because a crash mid-upload is exactly when debris appears, and daily
// because the TTLs are measured in days — a tighter loop would only spend I/O proving
// nothing changed.
func janitor(ctx context.Context, st *store.Store) {
	sweep := func() {
		res, err := st.Sweep(time.Now())
		if err != nil {
			log.Printf("janitor: %v", err)
			return
		}
		if res.OrphanBlobs > 0 || res.Tombstones > 0 || res.TempFiles > 0 {
			log.Printf("janitor: removed %d orphan blobs (%d bytes), %d expired tombstones, %d temp files",
				res.OrphanBlobs, res.OrphanBytes, res.Tombstones, res.TempFiles)
		}
	}

	sweep()

	ticker := time.NewTicker(24 * time.Hour)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			sweep()
		}
	}
}
