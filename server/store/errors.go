package store

import "fmt"

// Error codes are the ones spec 11 fixes for the wire, and they match
// `ServerErrorCode` in src/store/persistence/server/server.types.ts. The store speaks
// them so handlers never have to guess a status from a Go error string.
const (
	CodeNotFound     = "not_found"
	CodeConflict     = "conflict"
	CodeDeleted      = "deleted"
	CodeBadRequest   = "bad_request"
	CodeHashMismatch = "hash_mismatch"
	CodeTooLarge     = "too_large"
	CodeInternal     = "internal"
)

// Error is a store failure a handler can map straight onto a status and a wire code.
type Error struct {
	Code    string
	Message string
}

func (e *Error) Error() string { return e.Code + ": " + e.Message }

func notFound(what string) *Error {
	return &Error{Code: CodeNotFound, Message: what + " not found"}
}

func badRequest(format string, args ...any) *Error {
	return &Error{Code: CodeBadRequest, Message: fmt.Sprintf(format, args...)}
}

// ConflictError answers a failed If-Match. It carries the state the caller lost the race
// to, because the client's next move ("keep mine" / "take theirs") needs to name who won
// and when — see the conflict banner in spec 11.
type ConflictError struct {
	Rev        int
	UpdatedAt  string
	LastClient string
}

func (e *ConflictError) Error() string {
	return fmt.Sprintf("conflict: server is at rev %d", e.Rev)
}

// DeletedError is a write aimed at a tombstone without ?revive=1.
type DeletedError struct {
	ID string
}

func (e *DeletedError) Error() string { return "deleted: " + e.ID + " is a tombstone" }

// HashMismatchError is an upload whose bytes do not hash to the promised X-Asset-Hash.
type HashMismatchError struct {
	Want string
	Got  string
}

func (e *HashMismatchError) Error() string {
	return "hash_mismatch: expected " + e.Want + ", received " + e.Got
}
