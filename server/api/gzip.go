package api

import (
	"bufio"
	"compress/gzip"
	"errors"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
)

// gzipMinBytes is the body size below which compressing is not worth it: the gzip header
// and trailer are 18 bytes on their own, and a PutStoryResponse is barely more than that.
// Writes are held back until this much has arrived (or the handler finishes) so the
// decision is made on the real size, not on a Content-Length nobody sets.
const gzipMinBytes = 512

// gzipWriters are pooled because every story GET, index and manifest builds one, and a
// gzip.Writer carries a 32 KB window that is pure garbage otherwise.
var gzipWriters = sync.Pool{
	New: func() any { return gzip.NewWriter(nil) },
}

// gzipMiddleware compresses JSON responses when the client negotiated it.
//
// Why a hand-rolled wrapper: the module has exactly one dependency (gorilla/websocket) and
// that is deliberate, and net/http ships no gzip middleware.
//
// It compresses by CONTENT TYPE, decided at WriteHeader, not by route. JSON is the whole
// win — a story body is 3-4x smaller — while asset blobs are webp, mp3 and png, already
// compressed, and gzipping them would cost CPU on both ends, throw away Content-Length and
// break the Range requests http.ServeContent serves them with.
func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Vary regardless of what this particular response does: a shared cache has to
		// know the body depends on the header, and whether it does is decided per body.
		w.Header().Add("Vary", "Accept-Encoding")

		if !acceptsGzip(r) {
			next.ServeHTTP(w, r)
			return
		}

		gw := &gzipWriter{ResponseWriter: w, status: http.StatusOK}
		defer gw.close()
		next.ServeHTTP(gw, r)
	})
}

// acceptsGzip reads Accept-Encoding. `gzip;q=0` is an explicit refusal, and a client that
// bothers to write it means it.
//
// The q value has to be compared as a NUMBER, not by looking for the text "q=0": `q=0.5`
// contains it and means the opposite.
func acceptsGzip(r *http.Request) bool {
	for _, part := range strings.Split(r.Header.Get("Accept-Encoding"), ",") {
		name, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		if !strings.EqualFold(strings.TrimSpace(name), "gzip") {
			continue
		}
		for _, p := range strings.Split(params, ";") {
			k, v, ok := strings.Cut(strings.TrimSpace(p), "=")
			if !ok || !strings.EqualFold(strings.TrimSpace(k), "q") {
				continue
			}
			q, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
			if err == nil && q <= 0 {
				return false
			}
		}
		return true
	}
	return false
}

// gzipWriter buffers the head of a response until it can tell whether compressing it is
// worth anything, then either streams through a gzip.Writer or hands everything straight
// to the wrapped writer.
//
// The states are: nothing decided (head is filling), decided-and-compressing (zw != nil),
// decided-and-passing-through. `decided` is what says the real WriteHeader has been called,
// so nothing may touch the header map after it flips.
type gzipWriter struct {
	http.ResponseWriter

	status  int
	head    []byte
	decided bool
	dirty   bool // WriteHeader or Write was called: there is a response to finish
	zw      *gzip.Writer
}

func (g *gzipWriter) WriteHeader(status int) {
	if g.decided || g.dirty {
		return
	}
	g.status = status
	g.dirty = true

	// A status with no body must not grow a Content-Encoding, and 304 in particular is
	// the common answer on this API.
	if status == http.StatusNoContent || status == http.StatusNotModified || status < 200 {
		g.flush(false)
	}
}

func (g *gzipWriter) Write(b []byte) (int, error) {
	g.dirty = true

	if !g.decided {
		g.head = append(g.head, b...)
		if len(g.head) < gzipMinBytes {
			return len(b), nil
		}
		g.flush(compressible(g.Header()))
		return len(b), nil
	}
	if g.zw != nil {
		return g.zw.Write(b)
	}
	return g.ResponseWriter.Write(b)
}

// flush makes the decision real: it stamps the headers, writes the status line and drains
// whatever was buffered. Called exactly once per response.
func (g *gzipWriter) flush(compress bool) {
	g.decided = true

	if compress {
		g.Header().Set("Content-Encoding", "gzip")
		// Whatever length a handler declared describes the plain body, and it is not the
		// length of what is about to go out.
		g.Header().Del("Content-Length")
		zw := gzipWriters.Get().(*gzip.Writer)
		zw.Reset(g.ResponseWriter)
		g.zw = zw
	}

	g.ResponseWriter.WriteHeader(g.status)
	if len(g.head) > 0 {
		if g.zw != nil {
			_, _ = g.zw.Write(g.head)
		} else {
			_, _ = g.ResponseWriter.Write(g.head)
		}
		g.head = nil
	}
}

// close finishes a response the handler left short of gzipMinBytes, and returns the
// gzip.Writer to the pool. A hijacked connection is neither: the handler owns the socket
// and calling WriteHeader on it would corrupt the stream.
func (g *gzipWriter) close() {
	if !g.dirty {
		return
	}
	if !g.decided {
		// Under the threshold, so never compress: at this size gzip is a rounding error at
		// best and a few bytes bigger at worst.
		g.flush(false)
	}
	if g.zw != nil {
		_ = g.zw.Close()
		gzipWriters.Put(g.zw)
		g.zw = nil
	}
}

// compressible is the whole policy: JSON, and nothing else. Every route that returns a big
// body returns JSON; everything else on this API is an already-compressed blob.
func compressible(h http.Header) bool {
	if h.Get("Content-Encoding") != "" {
		return false
	}
	ct, _, _ := strings.Cut(h.Get("Content-Type"), ";")
	return strings.EqualFold(strings.TrimSpace(ct), "application/json")
}

// Flush keeps a streaming handler streaming. Flushing mid-body forces the decision, since
// there is nothing else that could make the buffered head go out.
func (g *gzipWriter) Flush() {
	if g.dirty && !g.decided {
		g.flush(compressible(g.Header()))
	}
	if g.zw != nil {
		_ = g.zw.Flush()
	}
	if f, ok := g.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// Hijack is what keeps GET /api/v1/events working: the websocket upgrade takes the raw
// connection, and a ResponseWriter that does not forward Hijack turns that route into a
// 500. Nothing has been written at that point, so the buffer is simply dropped.
func (g *gzipWriter) Hijack() (net.Conn, *bufio.ReadWriter, error) {
	hj, ok := g.ResponseWriter.(http.Hijacker)
	if !ok {
		return nil, nil, errors.New("response writer does not support hijacking")
	}
	g.dirty = false
	g.head = nil
	return hj.Hijack()
}
