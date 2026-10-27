package docs

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

// putTTL is the life of the presigned address a write uses (it is used at once).
const putTTL = 5 * time.Minute

// PresignedBlobs writes through the presigned PUT of the store: the server holds no credentials of its own besides
// the store's, and the object is checked by the store like any upload (the exact type and the exact size).
type PresignedBlobs struct {
	storage.Store
	Client *http.Client // nil: a client with a one-minute timeout
}

var _ Blobs = PresignedBlobs{}

// Put implements Blobs.
func (p PresignedBlobs) Put(ctx context.Context, key, contentType string, body io.Reader, size int64) error {
	u, err := p.PresignPut(key, contentType, size, putTTL)
	if err != nil {
		return fmt.Errorf("docs: presign put: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, u, body)
	if err != nil {
		return fmt.Errorf("docs: put: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	req.ContentLength = size
	c := p.Client
	if c == nil {
		c = &http.Client{Timeout: time.Minute}
	}
	resp, err := c.Do(req)
	if err != nil {
		return fmt.Errorf("docs: put: %w", err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 1<<16))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("docs: put: status %d", resp.StatusCode)
	}
	return nil
}

// MemBlobs is the store in memory with a write (tests and the stand without object storage).
type MemBlobs struct{ *storage.Mem }

var _ Blobs = MemBlobs{}

// Put implements Blobs.
func (m MemBlobs) Put(_ context.Context, key, contentType string, body io.Reader, size int64) error {
	data, err := io.ReadAll(io.LimitReader(body, size+1))
	if err != nil {
		return fmt.Errorf("docs: put: %w", err)
	}
	if int64(len(data)) != size {
		return fmt.Errorf("docs: put: %d bytes, want %d", len(data), size)
	}
	m.Mem.Put(key, contentType, data)
	return nil
}
