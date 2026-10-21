package main

import (
	"bytes"
	"errors"
	"net/http"
	"strconv"
	"testing"
)

// The invoice of T-65 is a real one-page PDF of exactly the size of the prototype (184 320 bytes, «180 КБ»): its
// cross-reference table is where startxref says, the browser and the files module see application/pdf.
func TestSeedPDF(t *testing.T) {
	t.Parallel()
	for _, size := range []int{4096, 184320} {
		b := seedPDF("Invoice No 418 of 07.10", size)
		if len(b) != size || !bytes.HasPrefix(b, []byte("%PDF-1.4\n")) || !bytes.HasSuffix(b, []byte("\n%%EOF\n")) {
			t.Fatalf("size %d: %d bytes, head %q", size, len(b), b[:min(len(b), 16)])
		}
		i := bytes.LastIndex(b, []byte("startxref\n"))
		if i < 0 {
			t.Fatalf("size %d: no startxref", size)
		}
		at, err := strconv.Atoi(string(bytes.TrimSpace(b[i+len("startxref\n") : len(b)-len("%%EOF\n")])))
		if err != nil || !bytes.HasPrefix(b[at:], []byte("xref\n0 6\n")) {
			t.Fatalf("size %d: startxref %d (%v) does not point at the table", size, at, err)
		}
		if !bytes.Contains(b, []byte("(Invoice No 418 of 07.10) Tj")) || http.DetectContentType(b) != "application/pdf" {
			t.Fatalf("size %d: no title on the page or not a PDF (%s)", size, http.DetectContentType(b))
		}
	}
}

// The storage of the seed is the S3_* of the stand: without S3_ENDPOINT there is none (the seed attaches nothing);
// an incomplete configuration is an error of the environment (exit 4), never a silent skip.
func TestNewObjects(t *testing.T) {
	t.Parallel()
	env := func(m map[string]string) func(string) string { return func(k string) string { return m[k] } }
	objs, err := newObjects(t.Context(), env(nil))
	if objs != nil || err != nil {
		t.Fatalf("without S3_ENDPOINT: %v %v", objs, err)
	}
	_, err = newObjects(t.Context(), env(map[string]string{"S3_ENDPOINT": "http://localhost:9000"}))
	if ce := (*configError)(nil); !errors.As(err, &ce) {
		t.Fatalf("S3_ENDPOINT without a bucket and keys: %v, want a configuration error", err)
	}
	objs, err = newObjects(t.Context(), env(map[string]string{"S3_ENDPOINT": "http://localhost:9000", "S3_BUCKET": "ortus-files",
		"S3_ACCESS_KEY": "ortus", "S3_SECRET_KEY": "change-me-local"}))
	if objs == nil || err != nil {
		t.Fatalf("configured: %v %v", objs, err)
	}
}
