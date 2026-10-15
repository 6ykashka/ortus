package storage

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
)

// Payload hashes of AWS Signature Version 4.
const (
	EmptyPayloadHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855" // SHA-256 of no bytes
	UnsignedPayload  = "UNSIGNED-PAYLOAD"
)

const (
	algorithm  = "AWS4-HMAC-SHA256"
	service    = "s3"
	amzDate    = "20060102T150405Z"
	shortDate  = "20060102"
	terminator = "aws4_request"
)

// unsignedHeaders are never part of the signature of a server call: the transport may change or add them.
var unsignedHeaders = map[string]bool{
	"authorization": true, "user-agent": true, "accept-encoding": true, "content-length": true,
	"connection": true, "expect": true, "x-amzn-trace-id": true,
}

// presignUnsigned are the headers a presigned URL never signs. Content-Length is signed when given: the size of an
// upload ticket (S3 and MinIO compare it with the length of the body).
var presignUnsigned = map[string]bool{
	"authorization": true, "user-agent": true, "accept-encoding": true, "connection": true, "expect": true,
	"x-amzn-trace-id": true,
}

// Signer signs S3 requests with AWS Signature Version 4 (service s3).
type Signer struct {
	AccessKey string
	SecretKey string
	Region    string
}

// Sign adds X-Amz-Date, X-Amz-Content-Sha256 and Authorization to r. The host and every header of r (except
// those the transport owns) are signed.
func (s Signer) Sign(r *http.Request, payloadHash string, at time.Time) {
	at = at.UTC()
	r.Header.Set("X-Amz-Date", at.Format(amzDate))
	r.Header.Set("X-Amz-Content-Sha256", payloadHash)
	host := r.Host
	if host == "" {
		host = r.URL.Host
	}
	names, canonical := canonicalHeaders(host, r.Header, unsignedHeaders)
	creq := strings.Join([]string{
		r.Method, EscapePath(r.URL.Path), canonicalQuery(r.URL.Query()), canonical, names, payloadHash,
	}, "\n")
	r.Header.Set("Authorization", algorithm+" Credential="+s.AccessKey+"/"+s.scope(at)+
		",SignedHeaders="+names+",Signature="+s.signature(at, creq))
}

// Presign returns a copy of u with the query authentication of method, valid for ttl from at. The host and the
// headers of signed are signed: the client must send them with the same values (Content-Type and Content-Length of
// an upload ticket).
func (s Signer) Presign(method string, u *url.URL, signed http.Header, ttl time.Duration, at time.Time) *url.URL {
	at = at.UTC()
	out := *u
	names, canonical := canonicalHeaders(u.Host, signed, presignUnsigned)
	q := u.Query()
	q.Set("X-Amz-Algorithm", algorithm)
	q.Set("X-Amz-Credential", s.AccessKey+"/"+s.scope(at))
	q.Set("X-Amz-Date", at.Format(amzDate))
	q.Set("X-Amz-Expires", strconv.FormatInt(int64(ttl/time.Second), 10))
	q.Set("X-Amz-SignedHeaders", names)
	query := canonicalQuery(q)
	creq := strings.Join([]string{method, EscapePath(u.Path), query, canonical, names, UnsignedPayload}, "\n")
	out.RawQuery = query + "&X-Amz-Signature=" + s.signature(at, creq)
	return &out
}

func (s Signer) scope(at time.Time) string {
	return at.Format(shortDate) + "/" + s.Region + "/" + service + "/" + terminator
}

// signature is the hex HMAC of the string to sign of creq with the signing key of the day of at.
func (s Signer) signature(at time.Time, creq string) string {
	sum := sha256.Sum256([]byte(creq))
	toSign := algorithm + "\n" + at.Format(amzDate) + "\n" + s.scope(at) + "\n" + hex.EncodeToString(sum[:])
	key := hmacSHA256([]byte("AWS4"+s.SecretKey), at.Format(shortDate))
	key = hmacSHA256(key, s.Region)
	key = hmacSHA256(key, service)
	key = hmacSHA256(key, terminator)
	return hex.EncodeToString(hmacSHA256(key, toSign))
}

func hmacSHA256(key []byte, data string) []byte {
	m := hmac.New(sha256.New, key)
	m.Write([]byte(data))
	return m.Sum(nil)
}

// canonicalHeaders returns the signed header names («host;x-amz-date») and the canonical header block; headers in
// skip are left out.
func canonicalHeaders(host string, h http.Header, skip map[string]bool) (names, block string) {
	values := map[string]string{"host": host}
	for k, vs := range h {
		lk := strings.ToLower(k)
		if skip[lk] {
			continue
		}
		trimmed := make([]string, len(vs))
		for i, v := range vs {
			trimmed[i] = strings.Join(strings.Fields(v), " ")
		}
		values[lk] = strings.Join(trimmed, ",")
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	var b strings.Builder
	for _, k := range keys {
		b.WriteString(k)
		b.WriteByte(':')
		b.WriteString(values[k])
		b.WriteByte('\n')
	}
	return strings.Join(keys, ";"), b.String()
}

// canonicalQuery encodes q sorted by key and value, with %20 for a space (never «+»).
func canonicalQuery(q url.Values) string {
	keys := make([]string, 0, len(q))
	for k := range q {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	parts := make([]string, 0, len(keys))
	for _, k := range keys {
		vs := slices.Clone(q[k])
		slices.Sort(vs)
		for _, v := range vs {
			parts = append(parts, uriEncode(k, true)+"="+uriEncode(v, true))
		}
	}
	return strings.Join(parts, "&")
}

// EscapePath is the canonical URI of path: every byte outside the unreserved set is percent-encoded, slashes are
// kept, and an empty path is «/».
func EscapePath(path string) string {
	if path == "" {
		return "/"
	}
	return uriEncode(path, false)
}

// uriEncode percent-encodes s as SigV4 requires (RFC 3986 unreserved characters stay); slash stays unless
// encodeSlash.
func uriEncode(s string, encodeSlash bool) string {
	const hexDigits = "0123456789ABCDEF"
	var b strings.Builder
	for i := range len(s) {
		c := s[i]
		switch {
		case 'A' <= c && c <= 'Z', 'a' <= c && c <= 'z', '0' <= c && c <= '9', c == '-', c == '_', c == '.', c == '~':
			b.WriteByte(c)
		case c == '/' && !encodeSlash:
			b.WriteByte(c)
		default:
			b.WriteByte('%')
			b.WriteByte(hexDigits[c>>4])
			b.WriteByte(hexDigits[c&15])
		}
	}
	return b.String()
}
