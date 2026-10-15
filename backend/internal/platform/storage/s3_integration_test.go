//go:build integration

package storage_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
	"github.com/ortus/ortus-crm/backend/internal/platform/storage/miniotest"
)

// cfg is the MinIO of the package (testcontainers, the image of the compose stand).
var cfg storage.Config

func TestMain(m *testing.M) {
	os.Exit(runMain(m))
}

func runMain(m *testing.M) int {
	ctx := context.Background()
	c, stop, err := miniotest.Start(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	cfg = c
	return m.Run()
}

var _ storage.Store = (*storage.S3)(nil)

func newS3(t *testing.T, now func() time.Time) *storage.S3 {
	t.Helper()
	s, err := storage.NewS3(cfg, nil, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.EnsureBucket(t.Context()); err != nil {
		t.Fatal(err)
	}
	return s
}

// put sends body to a presigned PUT URL the way a browser does.
func put(t *testing.T, rawURL, contentType string, body []byte) int {
	t.Helper()
	r, err := http.NewRequestWithContext(t.Context(), http.MethodPut, rawURL, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	r.Header.Set("Content-Type", contentType)
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)
	return resp.StatusCode
}

func get(t *testing.T, rawURL string) (int, http.Header, []byte) {
	t.Helper()
	r, err := http.NewRequestWithContext(t.Context(), http.MethodGet, rawURL, http.NoBody)
	if err != nil {
		t.Fatal(err)
	}
	resp, err := http.DefaultClient.Do(r)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	return resp.StatusCode, resp.Header, b
}

// S1-20: the client puts the file through the presigned URL; the server sees it (Stat, Open), copies it out of
// quarantine and deletes the quarantined object. Keys with spaces and Cyrillic survive the signature.
func TestS3PresignedPutThenStatOpenCopyDelete(t *testing.T) {
	t.Parallel()
	s := newS3(t, nil)
	ctx := t.Context()
	key := "quarantine/tenant a/Фото " + t.Name()
	body := []byte("\xff\xd8\xff\xe0 jpeg body")
	url, err := s.PresignPut(key, "image/jpeg", int64(len(body)), 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if code := put(t, url, "image/jpeg", body); code != http.StatusOK {
		t.Fatalf("PUT: %d", code)
	}
	if got, info := read(t, s, key); got != string(body) || info.Size != int64(len(body)) ||
		info.ContentType != "image/jpeg" || info.Key != key {
		t.Fatalf("Open: %q %+v", got, info)
	}
	dst := "files/tenant a/Фото " + t.Name()
	if err := s.Copy(ctx, key, dst); err != nil {
		t.Fatal(err)
	}
	for range 2 { // a missing key is not an error
		if err := s.Delete(ctx, key); err != nil {
			t.Fatal(err)
		}
	}
	missing(t, s, key)
	if info, err := s.Stat(ctx, dst); err != nil || info.ContentType != "image/jpeg" || info.Size != int64(len(body)) {
		t.Fatalf("copy: %+v %v", info, err)
	}
}

// The content type is part of the ticket (UploadTicket.requiredContentType): another one is refused by storage.
func TestS3PresignedPutRequiresSignedContentType(t *testing.T) {
	t.Parallel()
	s := newS3(t, nil)
	url, err := s.PresignPut("quarantine/t/"+t.Name(), "image/jpeg", 6, 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if code := put(t, url, "text/html", []byte("<html>")); code != http.StatusForbidden {
		t.Fatalf("PUT with another content type: %d, want 403", code)
	}
	if _, err := s.Stat(t.Context(), "quarantine/t/"+t.Name()); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("object stored: %v", err)
	}
}

// The size is part of the ticket (FILE-02, PLAT-07): storage refuses a body longer or shorter than the declared
// sizeBytes, so a ticket for one byte cannot fill the shared bucket; the declared size is accepted. A ticket
// without a size is not issued.
func TestS3PresignedPutLimitsSize(t *testing.T) {
	t.Parallel()
	s := newS3(t, nil)
	key := "quarantine/t/" + t.Name()
	url, err := s.PresignPut(key, "image/jpeg", 5, 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range [][]byte{bytes.Repeat([]byte{'x'}, 64<<10), []byte("123456"), []byte("1234")} {
		if code := put(t, url, "image/jpeg", body); code != http.StatusForbidden {
			t.Fatalf("PUT of %d bytes on a ticket for 5: %d, want 403", len(body), code)
		}
		if _, err := s.Stat(t.Context(), key); !errors.Is(err, storage.ErrNotFound) {
			t.Fatalf("object of %d bytes stored: %v", len(body), err)
		}
	}
	if code := put(t, url, "image/jpeg", []byte("12345")); code != http.StatusOK {
		t.Fatalf("PUT of the declared size: %d", code)
	}
	for _, size := range []int64{0, -1} {
		if _, err := s.PresignPut(key, "image/jpeg", size, time.Minute); err == nil {
			t.Fatalf("ticket of size %d issued", size)
		}
	}
}

// A ticket lives 15 minutes (UploadTicket): after expiry storage refuses it.
func TestS3PresignedPutExpires(t *testing.T) {
	t.Parallel()
	past := func() time.Time { return time.Now().Add(-time.Hour) }
	s, err := storage.NewS3(cfg, nil, past) // the bucket exists (miniotest.Start); server calls would be skewed
	if err != nil {
		t.Fatal(err)
	}
	url, err := s.PresignPut("quarantine/t/"+t.Name(), "image/jpeg", 1, 15*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if code := put(t, url, "image/jpeg", []byte("x")); code != http.StatusForbidden {
		t.Fatalf("PUT with an expired ticket: %d, want 403", code)
	}
}

// S1-21: a short download URL returns the content with the display name of the file.
func TestS3PresignedGet(t *testing.T) {
	t.Parallel()
	s := newS3(t, nil)
	key := "files/t/" + t.Name()
	url, _ := s.PresignPut(key, "application/pdf", int64(len("%PDF-1.7")), time.Minute)
	if code := put(t, url, "application/pdf", []byte("%PDF-1.7")); code != http.StatusOK {
		t.Fatalf("PUT: %d", code)
	}
	dl, err := s.PresignGet(key, "Чек № 5.pdf", time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	code, h, body := get(t, dl)
	if code != http.StatusOK || string(body) != "%PDF-1.7" {
		t.Fatalf("GET: %d %q", code, body)
	}
	cd := h.Get("Content-Disposition")
	if !strings.HasPrefix(cd, "attachment;") || !strings.Contains(cd, "filename*=UTF-8''%D0%A7%D0%B5%D0%BA%20%E2%84%96%205.pdf") {
		t.Fatalf("Content-Disposition %q", cd)
	}
	if strings.Contains(dl, "AKIA") || !strings.Contains(dl, "X-Amz-Expires=60") {
		t.Fatalf("download URL %s", dl)
	}
}

func TestS3MissingObjects(t *testing.T) {
	t.Parallel()
	missing(t, newS3(t, nil), "nope/"+t.Name())
}

// Wrong credentials are an error of the server call, without the secret in the message.
func TestS3WrongCredentials(t *testing.T) {
	t.Parallel()
	bad := cfg
	bad.SecretKey = "wrong-secret-value"
	s, err := storage.NewS3(bad, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = s.Stat(t.Context(), "files/x")
	if err == nil || errors.Is(err, storage.ErrNotFound) || strings.Contains(err.Error(), "wrong-secret-value") {
		t.Fatalf("Stat with a wrong secret: %v", err)
	}
}
