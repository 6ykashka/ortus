package storage_test

import (
	"errors"
	"io"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

var _ storage.Store = (*storage.Mem)(nil)

func TestMemUpload(t *testing.T) {
	t.Parallel()
	m := storage.NewMem()
	if err := m.Upload(t.Context(), "files/export/a", "text/csv", []byte("seq,text\n")); err != nil {
		t.Fatal(err)
	}
	if got, info := read(t, m, "files/export/a"); got != "seq,text\n" || info.ContentType != "text/csv" {
		t.Fatalf("Open: %q %+v", got, info)
	}
}

// missing fails unless Stat, Open and Copy of key all report ErrNotFound.
func missing(t *testing.T, s storage.Store, key string) {
	t.Helper()
	if _, err := s.Stat(t.Context(), key); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("Stat %s: %v, want ErrNotFound", key, err)
	}
	if _, _, err := s.Open(t.Context(), key); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("Open %s: %v, want ErrNotFound", key, err)
	}
	if err := s.Copy(t.Context(), key, key+".copy"); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("Copy %s: %v, want ErrNotFound", key, err)
	}
}

// read returns the content of key.
func read(t *testing.T, s storage.Store, key string) (string, storage.ObjectInfo) {
	t.Helper()
	rc, info, err := s.Open(t.Context(), key)
	if err != nil {
		t.Fatalf("Open %s: %v", key, err)
	}
	defer rc.Close()
	b, err := io.ReadAll(rc)
	if err != nil {
		t.Fatal(err)
	}
	return string(b), info
}

func TestMemObjects(t *testing.T) {
	t.Parallel()
	m := storage.NewMem()
	ctx := t.Context()
	missing(t, m, "quarantine/t/f")
	m.Put("quarantine/t/f", "image/jpeg", []byte("jpeg bytes"))
	info, err := m.Stat(ctx, "quarantine/t/f")
	if err != nil || info.Size != 10 || info.ContentType != "image/jpeg" || info.Key != "quarantine/t/f" {
		t.Fatalf("Stat: %+v %v", info, err)
	}
	if err := m.Copy(ctx, "quarantine/t/f", "files/t/f"); err != nil {
		t.Fatal(err)
	}
	for range 2 { // idempotent, like S3
		if err := m.Delete(ctx, "quarantine/t/f"); err != nil {
			t.Fatal(err)
		}
	}
	missing(t, m, "quarantine/t/f")
	if body, info := read(t, m, "files/t/f"); body != "jpeg bytes" || info.ContentType != "image/jpeg" {
		t.Fatalf("copied object %q %+v", body, info)
	}
	if got := m.Keys(); len(got) != 1 || got[0] != "files/t/f" {
		t.Fatalf("keys %v", got)
	}
}

// Presigned URLs of Mem are opaque but carry the key and the expiry, enough to tell them apart in tests.
func TestMemPresign(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	m := storage.NewMem()
	m.Now = func() time.Time { return now }
	put, err := m.PresignPut("quarantine/t/f", "image/jpeg", 511, 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(put)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasSuffix(u.Path, "/quarantine/t/f") || u.Query().Get("expires") != "2026-10-01T07:45:00Z" ||
		u.Query().Get("method") != "PUT" || u.Query().Get("contentType") != "image/jpeg" || u.Query().Get("size") != "511" {
		t.Fatalf("presigned PUT %s", put)
	}
	get, err := m.PresignGet("files/t/f", "Фото.jpg", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if u, _ := url.Parse(get); u.Query().Get("method") != "GET" || u.Query().Get("expires") != "2026-10-01T07:31:00Z" {
		t.Fatalf("presigned GET %s", get)
	}
}
