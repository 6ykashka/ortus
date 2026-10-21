package main

import (
	"bytes"
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/platform/storage"
)

// Objects of the seed (W4.11 возврат 1): the files the seed attaches (the T-65 invoice) are real objects of the object
// storage of the stand, so a download from the task card works and the quota counts bytes that exist.

// objectStore puts the bytes of a file of the seed into the object storage of the stand.
type objectStore interface {
	Put(ctx context.Context, key, contentType string, data []byte) error
}

// newObjects is the object storage of the environment of the seed (S3_* as cmd/api reads them); nil when S3_ENDPOINT
// is not set — the seed then writes no attachments. An incomplete configuration is a configuration error.
func newObjects(_ context.Context, getenv func(string) string) (objectStore, error) {
	cfg, ok, err := storage.ConfigFromEnv(getenv)
	switch {
	case err != nil:
		return nil, configErr("object storage: %v", err)
	case !ok:
		return nil, nil
	}
	s3, err := storage.NewS3(cfg, nil, nil)
	if err != nil {
		return nil, configErr("object storage: %v", err)
	}
	return &s3Objects{s3: s3, client: &http.Client{Timeout: putTimeout}}, nil
}

// putTimeout bounds one upload of the seed.
const putTimeout = 30 * time.Second

// s3Objects puts objects into the S3 of the stand the way a browser uploads them (a presigned PUT); the first put
// creates the bucket when minio-init has not run (stand.mjs all).
type s3Objects struct {
	s3     *storage.S3
	client *http.Client
	bucket sync.Once
	err    error
}

// Put implements objectStore.
func (o *s3Objects) Put(ctx context.Context, key, contentType string, data []byte) error {
	o.bucket.Do(func() { o.err = o.s3.EnsureBucket(ctx) })
	if o.err != nil {
		return fmt.Errorf("object storage (S3_ENDPOINT is set — start minio or unset it): %w", o.err)
	}
	url, err := o.s3.PresignPut(key, contentType, int64(len(data)), putTimeout)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, url, bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("object storage: %w", err)
	}
	req.Header.Set("Content-Type", contentType)
	resp, err := o.client.Do(req)
	if err != nil {
		return fmt.Errorf("object storage: put: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("object storage: put: %s", resp.Status)
	}
	return nil
}

// seedPDF is a one-page PDF of exactly size bytes with title (ASCII) on the page: a comment pads it before the table
// of cross references, whose offsets stay true.
func seedPDF(title string, size int) []byte {
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	content := "BT /F1 18 Tf 72 760 Td (" + title + ") Tj ET"
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
		"<< /Length " + strconv.Itoa(len(content)) + " >>\nstream\n" + content + "\nendstream",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	}
	offsets := make([]int, len(objects))
	for i, obj := range objects {
		offsets[i] = b.Len()
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, obj)
	}
	table := func(at int) string {
		var x strings.Builder
		fmt.Fprintf(&x, "xref\n0 %d\n0000000000 65535 f \n", len(objects)+1)
		for _, off := range offsets {
			fmt.Fprintf(&x, "%010d 00000 n \n", off)
		}
		fmt.Fprintf(&x, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, at)
		return x.String()
	}
	// The table names its own offset, whose digits change its length: the offset at with d digits ends the file at size.
	at := b.Len()
	for d := 1; d <= len(strconv.Itoa(size)); d++ {
		if x := size - len(table(0)) - (d - 1); x >= b.Len() && len(strconv.Itoa(x)) == d {
			at = x
			break
		}
	}
	b.WriteString(padding(at - b.Len()))
	b.WriteString(table(b.Len()))
	return b.Bytes()
}

// padding is n bytes of PDF comment lines.
func padding(n int) string {
	var x strings.Builder
	for n > 0 {
		line := min(n, 80)
		if line == 1 {
			x.WriteString("\n")
		} else {
			x.WriteString("%" + strings.Repeat(" ", line-2) + "\n")
		}
		n -= line
	}
	return x.String()
}
