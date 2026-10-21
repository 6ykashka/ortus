package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// Возврат 1 W4.60: сбой транспорта при PUT файла оформления не выносит в журнал подписанный URL (X-Amz-Signature) —
// ошибка называет ключ, но не адрес.
func TestBrandBlobsPutHidesPresignedURL(t *testing.T) {
	t.Parallel()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		hj, ok := w.(http.Hijacker)
		if !ok {
			return
		}
		if conn, _, err := hj.Hijack(); err == nil {
			_ = conn.Close() // the connection drops: a transport error (*url.Error) of client.Do
		}
	}))
	t.Cleanup(srv.Close)
	env := map[string]string{ //nolint:gosec // G101: values of the test, not credentials
		"S3_ENDPOINT": srv.URL, "S3_BUCKET": "ortus-files", "S3_ACCESS_KEY": "ortus", "S3_SECRET_KEY": "secret-key-of-the-test",
	}
	blobs, err := newBrandBlobs(func(k string) string { return env[k] })
	if err != nil || blobs == nil {
		t.Fatalf("blobs: %v %v", blobs, err)
	}
	err = blobs.Put(t.Context(), "branding/abc.png", "image/png", []byte("\x89PNG"))
	if err == nil {
		t.Fatal("Put: want the transport error")
	}
	text := err.Error()
	for _, leak := range []string{"X-Amz-Signature", "X-Amz-Credential", "?", srv.URL} {
		if strings.Contains(text, leak) {
			t.Errorf("error leaks %q: %s", leak, text)
		}
	}
	if !strings.Contains(text, "branding/abc.png") {
		t.Errorf("error does not name the key: %s", text)
	}
}
