// Package storage is the private object storage of tenant files (W1.09, S1-20, S1-21; FILE-01…03): an S3 client on
// the standard library (AWS Signature Version 4, path-style requests for MinIO), presigned PUT and GET URLs, and an
// in-memory store for unit tests. Object keys are formed by the server (FILE-01); the client never chooses a bucket
// or a tenant prefix, and keys never appear in API responses or errors.
package storage

import (
	"context"
	"errors"
	"io"
	"time"
)

// ErrNotFound is returned for a missing object.
var ErrNotFound = errors.New("storage: object not found")

// ObjectInfo describes a stored object.
type ObjectInfo struct {
	Key         string
	Size        int64
	ContentType string
	ETag        string
}

// Store is a private bucket of objects.
type Store interface {
	// PresignPut returns a URL that accepts a PUT of key with exactly contentType and a body of exactly size bytes
	// until now+ttl (FILE-02, PLAT-07: the ticket cannot store more than the quota reserved).
	PresignPut(key, contentType string, size int64, ttl time.Duration) (string, error)
	// PresignGet returns a URL that returns key as an attachment named fileName until now+ttl.
	PresignGet(key, fileName string, ttl time.Duration) (string, error)
	// Stat returns the object's metadata or ErrNotFound.
	Stat(ctx context.Context, key string) (ObjectInfo, error)
	// Open returns the object's content (the caller closes it) or ErrNotFound.
	Open(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error)
	// Copy copies src to dst inside the bucket (ErrNotFound when src is missing).
	Copy(ctx context.Context, src, dst string) error
	// Delete removes key; a missing key is not an error.
	Delete(ctx context.Context, key string) error
}
