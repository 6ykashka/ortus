package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"maps"
	"mime"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// errorBodyLimit bounds how much of an S3 error document is read.
const errorBodyLimit = 64 << 10

// S3 is a Store over an S3-compatible server (MinIO in the stand) with path-style URLs. Server calls go to the
// endpoint; presigned URLs carry the public endpoint (the host the browser reaches).
type S3 struct {
	endpoint *url.URL
	public   *url.URL
	bucket   string
	signer   Signer
	client   *http.Client
	now      func() time.Time
}

var _ Store = (*S3)(nil)

// NewS3 returns the client of cfg; client nil — a client with a 30 s timeout; now nil — time.Now.
func NewS3(cfg Config, client *http.Client, now func() time.Time) (*S3, error) {
	if cfg.PublicEndpoint == "" {
		cfg.PublicEndpoint = cfg.Endpoint
	}
	if cfg.Region == "" {
		cfg.Region = defaultRegion
	}
	if err := cfg.Validate(); err != nil {
		return nil, fmt.Errorf("storage: %w", err)
	}
	endpoint, _ := parseEndpoint(cfg.Endpoint) // checked by Validate
	public, _ := parseEndpoint(cfg.PublicEndpoint)
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	if now == nil {
		now = time.Now
	}
	return &S3{
		endpoint: endpoint, public: public, bucket: cfg.Bucket, client: client, now: now,
		signer: Signer{AccessKey: cfg.AccessKey, SecretKey: cfg.SecretKey, Region: cfg.Region},
	}, nil
}

// objectURL is base/bucket/key; Path holds the unescaped key, RawPath its canonical escaping.
func (s *S3) objectURL(base *url.URL, key string) *url.URL {
	u := *base
	u.Path = base.Path + "/" + s.bucket
	if key != "" {
		u.Path += "/" + key
	}
	u.RawPath = EscapePath(u.Path)
	u.RawQuery = ""
	return &u
}

// EnsureBucket creates the bucket when it does not exist (the stand creates it with minio-init).
func (s *S3) EnsureBucket(ctx context.Context) error {
	resp, err := s.do(ctx, http.MethodHead, "", nil)
	if err != nil {
		return err
	}
	_ = resp.Body.Close()
	switch {
	case resp.StatusCode == http.StatusOK:
		return nil
	case resp.StatusCode != http.StatusNotFound:
		return statusError(http.MethodHead, resp)
	}
	resp, err = s.do(ctx, http.MethodPut, "", nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return statusError(http.MethodPut, resp)
	}
	return nil
}

// PresignPut implements Store: the content type and the size are signed headers, so storage refuses a body of
// another length (MinIO and S3 compare a signed Content-Length with the request).
func (s *S3) PresignPut(key, contentType string, size int64, ttl time.Duration) (string, error) {
	switch {
	case key == "":
		return "", errors.New("storage: empty key")
	case size < 1:
		return "", fmt.Errorf("storage: upload ticket of %d bytes", size)
	}
	u := s.objectURL(s.public, key)
	signed := http.Header{"Content-Type": {contentType}, "Content-Length": {strconv.FormatInt(size, 10)}}
	return s.signer.Presign(http.MethodPut, u, signed, ttl, s.now()).String(), nil
}

// PresignGet implements Store: the response is an attachment named fileName (RFC 6266, UTF-8 filename*).
func (s *S3) PresignGet(key, fileName string, ttl time.Duration) (string, error) {
	if key == "" {
		return "", errors.New("storage: empty key")
	}
	u := s.objectURL(s.public, key)
	q := url.Values{"response-content-disposition": {ContentDisposition(fileName)}}
	u.RawQuery = q.Encode()
	return s.signer.Presign(http.MethodGet, u, nil, ttl, s.now()).String(), nil
}

// ContentDisposition is «attachment» with an ASCII fallback name and the UTF-8 name (RFC 6266, RFC 8187).
func ContentDisposition(fileName string) string {
	if fileName == "" {
		return "attachment"
	}
	if v := mime.FormatMediaType("attachment", map[string]string{"filename": fileName}); v != "" &&
		!strings.Contains(v, "filename*=") {
		return v
	}
	fallback := strings.Map(func(r rune) rune {
		if r < 0x20 || r > 0x7e || r == '"' || r == '\\' {
			return '_'
		}
		return r
	}, fileName)
	return `attachment; filename="` + fallback + `"; filename*=UTF-8''` + uriEncode(fileName, true)
}

// Stat implements Store.
func (s *S3) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	resp, err := s.do(ctx, http.MethodHead, key, nil)
	if err != nil {
		return ObjectInfo{}, err
	}
	_ = resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return ObjectInfo{}, statusError(http.MethodHead, resp)
	}
	return info(key, resp), nil
}

// Open implements Store.
func (s *S3) Open(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error) {
	resp, err := s.do(ctx, http.MethodGet, key, nil)
	if err != nil {
		return nil, ObjectInfo{}, err
	}
	if resp.StatusCode != http.StatusOK {
		defer resp.Body.Close()
		return nil, ObjectInfo{}, statusError(http.MethodGet, resp)
	}
	return resp.Body, info(key, resp), nil
}

// Copy implements Store (server-side CopyObject; metadata and content type are copied).
func (s *S3) Copy(ctx context.Context, src, dst string) error {
	h := http.Header{"X-Amz-Copy-Source": {EscapePath("/" + s.bucket + "/" + src)}}
	resp, err := s.do(ctx, http.MethodPut, dst, h)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return statusError(http.MethodPut, resp)
	}
	// CopyObject may answer 200 with an error document.
	body, _ := io.ReadAll(io.LimitReader(resp.Body, errorBodyLimit))
	if code, ok := errorCode(body); ok {
		if code == "NoSuchKey" {
			return ErrNotFound
		}
		return fmt.Errorf("storage: copy: %s", code)
	}
	return nil
}

// Upload implements Uploader: a signed PUT of data with its SHA-256 as the payload hash (a server-side write, such as the
// file of an export; a browser writes with PresignPut).
func (s *S3) Upload(ctx context.Context, key, contentType string, data []byte) error {
	if key == "" {
		return errors.New("storage: empty key")
	}
	r, err := http.NewRequestWithContext(ctx, http.MethodPut, s.objectURL(s.endpoint, key).String(), bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("storage: PUT: %w", err)
	}
	r.Header.Set("Content-Type", contentType)
	sum := sha256.Sum256(data)
	s.signer.Sign(r, hex.EncodeToString(sum[:]), s.now())
	resp, err := s.client.Do(r)
	if err != nil {
		return fmt.Errorf("storage: PUT: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return statusError(http.MethodPut, resp)
	}
	return nil
}

// Delete implements Store.
func (s *S3) Delete(ctx context.Context, key string) error {
	resp, err := s.do(ctx, http.MethodDelete, key, nil)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusNoContent || resp.StatusCode == http.StatusOK || resp.StatusCode == http.StatusNotFound {
		return nil
	}
	return statusError(http.MethodDelete, resp)
}

// do sends a signed request without a body to the endpoint (key "" — the bucket itself).
func (s *S3) do(ctx context.Context, method, key string, h http.Header) (*http.Response, error) {
	u := s.objectURL(s.endpoint, key)
	r, err := http.NewRequestWithContext(ctx, method, u.String(), http.NoBody)
	if err != nil {
		return nil, fmt.Errorf("storage: %s: %w", method, err)
	}
	maps.Copy(r.Header, h)
	s.signer.Sign(r, EmptyPayloadHash, s.now())
	resp, err := s.client.Do(r)
	if err != nil {
		return nil, fmt.Errorf("storage: %s: %w", method, err)
	}
	return resp, nil
}

func info(key string, resp *http.Response) ObjectInfo {
	size, _ := strconv.ParseInt(resp.Header.Get("Content-Length"), 10, 64)
	return ObjectInfo{
		Key: key, Size: size, ContentType: resp.Header.Get("Content-Type"),
		ETag: strings.Trim(resp.Header.Get("ETag"), `"`),
	}
}

// statusError maps a failed answer: 404 — ErrNotFound, anything else — the S3 error code without the body.
func statusError(method string, resp *http.Response) error {
	if resp.StatusCode == http.StatusNotFound {
		return ErrNotFound
	}
	body, _ := io.ReadAll(io.LimitReader(resp.Body, errorBodyLimit))
	code, _ := errorCode(body)
	if code == "" {
		code = http.StatusText(resp.StatusCode)
	}
	return fmt.Errorf("storage: %s: %d %s", method, resp.StatusCode, code)
}

// errorCode returns the Code of an S3 error document.
func errorCode(body []byte) (string, bool) {
	if !bytes.Contains(body, []byte("<Error")) {
		return "", false
	}
	var doc struct {
		Code string `xml:"Code"`
	}
	if err := xml.Unmarshal(body, &doc); err != nil {
		return "", false
	}
	return doc.Code, doc.Code != ""
}
