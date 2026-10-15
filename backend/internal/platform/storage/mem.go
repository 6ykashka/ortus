package storage

import (
	"bytes"
	"context"
	"io"
	"net/url"
	"slices"
	"strconv"
	"sync"
	"time"
)

// memHost is the host of the presigned URLs of Mem (never resolvable).
const memHost = "mem.storage.invalid"

// Mem is an in-memory Store for unit tests. Presigned URLs are opaque: Put stands for the client's upload.
type Mem struct {
	Now func() time.Time // nil: time.Now

	mu      sync.Mutex
	objects map[string]memObject
}

type memObject struct {
	contentType string
	data        []byte
}

var _ Store = (*Mem)(nil)

// NewMem returns an empty store.
func NewMem() *Mem { return &Mem{objects: map[string]memObject{}} }

func (m *Mem) now() time.Time {
	if m.Now != nil {
		return m.Now()
	}
	return time.Now()
}

// Put stores an object as if the client had uploaded it through a presigned URL.
func (m *Mem) Put(key, contentType string, data []byte) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.objects[key] = memObject{contentType: contentType, data: slices.Clone(data)}
}

// Keys returns the stored keys, sorted.
func (m *Mem) Keys() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.objects))
	for k := range m.objects {
		out = append(out, k)
	}
	slices.Sort(out)
	return out
}

func (m *Mem) presign(method, key string, q url.Values, ttl time.Duration) string {
	q.Set("method", method)
	q.Set("expires", m.now().Add(ttl).UTC().Format(time.RFC3339))
	u := url.URL{Scheme: "https", Host: memHost, Path: "/" + key, RawQuery: q.Encode()}
	return u.String()
}

// PresignPut implements Store.
func (m *Mem) PresignPut(key, contentType string, size int64, ttl time.Duration) (string, error) {
	q := url.Values{"contentType": {contentType}, "size": {strconv.FormatInt(size, 10)}}
	return m.presign("PUT", key, q, ttl), nil
}

// PresignGet implements Store.
func (m *Mem) PresignGet(key, fileName string, ttl time.Duration) (string, error) {
	return m.presign("GET", key, url.Values{"fileName": {fileName}}, ttl), nil
}

func (m *Mem) get(key string) (memObject, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.objects[key]
	return o, ok
}

// Stat implements Store.
func (m *Mem) Stat(_ context.Context, key string) (ObjectInfo, error) {
	o, ok := m.get(key)
	if !ok {
		return ObjectInfo{}, ErrNotFound
	}
	return ObjectInfo{Key: key, Size: int64(len(o.data)), ContentType: o.contentType}, nil
}

// Open implements Store.
func (m *Mem) Open(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error) {
	info, err := m.Stat(ctx, key)
	if err != nil {
		return nil, ObjectInfo{}, err
	}
	o, _ := m.get(key)
	return io.NopCloser(bytes.NewReader(o.data)), info, nil
}

// Copy implements Store.
func (m *Mem) Copy(_ context.Context, src, dst string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	o, ok := m.objects[src]
	if !ok {
		return ErrNotFound
	}
	m.objects[dst] = memObject{contentType: o.contentType, data: slices.Clone(o.data)}
	return nil
}

// Delete implements Store.
func (m *Mem) Delete(_ context.Context, key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.objects, key)
	return nil
}
