// Package idem is the idempotency middleware of every mutating command (W1.01, S1-25, NFR-02, AC-07): the same
// Idempotency-Key with the same request replays the stored response, another request with that key is a conflict,
// and a repeat while the first one runs is refused until it finishes. The key is scoped to tenant + actor +
// operation (api/openapi/components/common/parameters.yaml IdempotencyKey).
//
// A command whose effect is written to the tenant DB stores its outcome in the transaction of the effect
// (CompleteInTx, 10 §3.5): if the process dies after the commit, the repeat replays instead of running again.
package idem

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/platform/httpx"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Headers of the contract.
const (
	HeaderKey      = "Idempotency-Key"
	HeaderReplayed = "Idempotency-Replayed"
)

// Defaults of Guard.
const (
	DefaultTTL   = 7 * 24 * time.Hour // contract: "Retain record at least 7 days"
	DefaultLease = 2 * time.Minute    // an in-progress record older than this is taken over (> API WriteTimeout)
)

// Problem codes of the contract (api/errors.yaml).
const (
	codeKeyReused  = "idempotency_key_reused"
	codeInProgress = "idempotency_in_progress"
	// codePayloadTooLarge: a body over the limit of its operation (Guard.Bodies).
	codePayloadTooLarge = "payload_too_large"
)

// retryAfter is the Retry-After of idempotency_in_progress, in seconds.
const retryAfter = "1"

// Errors of Store.Begin and CompleteInTx.
var (
	ErrInProgress = errors.New("idem: the command with this key is still running")
	ErrKeyReused  = errors.New("idem: the key was used for another request")
	ErrNoRecord   = errors.New("idem: no idempotency record in the context")
	ErrLeaseLost  = errors.New("idem: the record is no longer in progress (lease lost or expired)")
)

// storedHeaders are the response headers replayed with the stored body.
var storedHeaders = []string{"Content-Type", "ETag", "Location"}

// retryableCodes are the conflicts the client repeats with the same key after Retry-After (api/errors.yaml
// retryable: true); their responses are not stored.
var retryableCodes = []string{"reservation_overlap", "resources_unavailable", codeInProgress}

// Namespace scopes a key: tenant (uuid.Nil for identity and platform operations), actor and operationId.
type Namespace struct {
	TenantID  uuid.UUID
	ActorID   uuid.UUID
	Operation string
}

// Record is one key of a namespace with the digest of its request.
type Record struct {
	Namespace
	Key  string
	Hash []byte
}

// Outcome is a stored response.
type Outcome struct {
	Status int
	Header http.Header
	Body   []byte
}

// Store keeps idempotency records.
type Store interface {
	// Begin claims rec until leaseUntil (nil, nil), or returns the stored outcome of a completed identical request,
	// ErrInProgress or ErrKeyReused. A record expired at now is claimed again.
	Begin(ctx context.Context, rec Record, now, leaseUntil time.Time) (*Outcome, error)
	// Complete stores out for a record still in progress; a record completed by the service is left as is.
	Complete(ctx context.Context, rec Record, out Outcome, expires time.Time) error
	// Release drops a record still in progress, so that a repeat executes again.
	Release(ctx context.Context, rec Record) error
}

// Stores picks the store of a tenant (uuid.Nil: identity and platform operations).
type Stores interface {
	For(ctx context.Context, tenantID uuid.UUID) (Store, error)
}

// DB is what PGStore and CompleteInTx need: *pgxpool.Pool, *pgx.Conn and pgx.Tx.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// Guard runs a mutating operation under its Idempotency-Key.
type Guard struct {
	Stores Stores
	TTL    time.Duration    // 0: DefaultTTL
	Lease  time.Duration    // 0: DefaultLease
	Now    func() time.Time // nil: time.Now
	Log    *slog.Logger     // nil: slog.Default
	// Bodies are the body limits of operations larger than httpx.MaxBody (uploadBrandingAsset: a file of 1 MiB in
	// base64); a body over such a limit is 413 payload_too_large.
	Bodies map[string]int
}

func (g *Guard) now() time.Time {
	if g.Now != nil {
		return g.Now()
	}
	return time.Now()
}

func (g *Guard) ttl() time.Duration {
	if g.TTL > 0 {
		return g.TTL
	}
	return DefaultTTL
}

func (g *Guard) lease() time.Duration {
	if g.Lease > 0 {
		return g.Lease
	}
	return DefaultLease
}

func (g *Guard) log() *slog.Logger {
	if g.Log != nil {
		return g.Log
	}
	return slog.Default()
}

// ValidKey reports whether key matches the contract: 16–128 characters of [A-Za-z0-9._:-].
func ValidKey(key string) bool {
	if len(key) < 16 || len(key) > 128 {
		return false
	}
	for i := range len(key) {
		switch c := key[i]; {
		case c >= 'a' && c <= 'z', c >= 'A' && c <= 'Z', c >= '0' && c <= '9', c == '.', c == '_', c == ':', c == '-':
		default:
			return false
		}
	}
	return true
}

// requestHash is the digest of method, path, query and raw body bytes: "Reuse only for an identical request".
func requestHash(r *http.Request, body []byte) []byte {
	h := sha256.New()
	for _, part := range []string{r.Method, r.URL.EscapedPath(), r.URL.RawQuery} {
		_, _ = io.WriteString(h, part) // hash.Hash never fails
		_, _ = h.Write([]byte{0})
	}
	_, _ = h.Write(body)
	return h.Sum(nil)
}

type ctxKey struct{}

// bound is the record a handler runs under, with the expiry its outcome gets.
type bound struct {
	rec     Record
	expires time.Time
}

// FromContext returns the record the handler runs under.
func FromContext(ctx context.Context) (Record, bool) {
	b, ok := ctx.Value(ctxKey{}).(bound)
	return b.rec, ok
}

// Serve runs next under the Idempotency-Key of r in namespace ns. Without the header next runs as is: the
// generated strict server answers 400 where the contract requires the key.
func (g *Guard) Serve(w http.ResponseWriter, r *http.Request, ns Namespace, next http.Handler) {
	key := r.Header.Get(HeaderKey)
	if key == "" {
		next.ServeHTTP(w, r)
		return
	}
	if !ValidKey(key) {
		problem.Write(w, r, problem.New(problem.CodeMalformedRequest, ""))
		return
	}
	body, err := g.body(r, ns.Operation)
	if err != nil {
		problem.Write(w, r, err)
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))
	ctx := r.Context()
	rec := Record{Namespace: ns, Key: key, Hash: requestHash(r, body)}
	st, err := g.Stores.For(ctx, ns.TenantID)
	if err != nil {
		problem.Write(w, r, problem.Wrap(problem.CodeDependencyUnavailable, err))
		return
	}
	now := g.now()
	stored, err := st.Begin(ctx, rec, now, now.Add(g.lease()))
	switch {
	case errors.Is(err, ErrInProgress):
		w.Header().Set("Retry-After", retryAfter)
		problem.Write(w, r, problem.New(codeInProgress, ""))
		return
	case errors.Is(err, ErrKeyReused):
		problem.Write(w, r, problem.New(codeKeyReused, ""))
		return
	case err != nil:
		problem.Write(w, r, problem.Wrap(problem.CodeDependencyUnavailable, err))
		return
	case stored != nil:
		replay(w, *stored)
		return
	}
	g.run(w, r.WithContext(context.WithValue(ctx, ctxKey{}, bound{rec: rec, expires: now.Add(g.ttl())})), st, rec, next)
}

// body reads the body of r within the limit of its operation: over an own limit (Bodies) — payload_too_large, over
// httpx.MaxBody or unreadable — malformed_request.
func (g *Guard) body(r *http.Request, operation string) ([]byte, error) {
	limit, own := g.Bodies[operation]
	if !own {
		limit = httpx.MaxBody
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, int64(limit)+1))
	switch {
	case err == nil && len(body) > limit && own:
		return nil, problem.New(codePayloadTooLarge, "")
	case err != nil || len(body) > limit:
		return nil, problem.Wrap(problem.CodeMalformedRequest, err)
	}
	return body, nil
}

// run executes the claimed command and stores its outcome; a retryable outcome or a panic releases the key.
func (g *Guard) run(w http.ResponseWriter, r *http.Request, st Store, rec Record, next http.Handler) {
	detached := context.WithoutCancel(r.Context())
	stored := false
	defer func() {
		if stored {
			return
		}
		if err := st.Release(detached, rec); err != nil {
			g.log().ErrorContext(detached, "idem: release", slog.String("operation", rec.Operation), slog.String("error", err.Error()))
		}
	}()
	cw := &capture{ResponseWriter: w}
	next.ServeHTTP(cw, r)
	out := cw.outcome()
	if retryable(out) {
		return
	}
	if err := st.Complete(detached, rec, out, g.now().Add(g.ttl())); err != nil {
		g.log().ErrorContext(detached, "idem: complete", slog.String("operation", rec.Operation), slog.String("error", err.Error()))
		return
	}
	stored = true
}

func replay(w http.ResponseWriter, out Outcome) {
	h := w.Header()
	for _, name := range storedHeaders {
		if v := out.Header.Values(name); len(v) > 0 {
			h[http.CanonicalHeaderKey(name)] = slices.Clone(v)
		}
	}
	h.Set(HeaderReplayed, "true")
	w.WriteHeader(out.Status)
	_, _ = w.Write(out.Body) // the client is gone if the write fails
}

// retryable reports whether the client may repeat the command with the same key: server errors, rate limits and
// the retryable conflicts of the registry.
func retryable(out Outcome) bool {
	switch {
	case out.Status >= http.StatusInternalServerError, out.Status == http.StatusTooManyRequests:
		return true
	case out.Status != http.StatusConflict:
		return false
	}
	if mt, _, err := mime.ParseMediaType(out.Header.Get("Content-Type")); err != nil || mt != problem.ContentType {
		return false
	}
	var p struct {
		Code string `json:"code"`
	}
	return json.Unmarshal(out.Body, &p) == nil && slices.Contains(retryableCodes, p.Code)
}

// capture passes the response through and keeps a copy of status, stored headers and body.
type capture struct {
	http.ResponseWriter
	status int
	header http.Header
	body   bytes.Buffer
}

func (c *capture) WriteHeader(status int) {
	if c.status == 0 {
		c.status = status
		c.header = http.Header{}
		for _, name := range storedHeaders {
			if v := c.ResponseWriter.Header().Values(name); len(v) > 0 {
				c.header[http.CanonicalHeaderKey(name)] = slices.Clone(v)
			}
		}
	}
	c.ResponseWriter.WriteHeader(status)
}

func (c *capture) Write(b []byte) (int, error) {
	if c.status == 0 {
		c.WriteHeader(http.StatusOK)
	}
	c.body.Write(b)
	return c.ResponseWriter.Write(b)
}

// Unwrap lets http.ResponseController reach the underlying writer.
func (c *capture) Unwrap() http.ResponseWriter { return c.ResponseWriter }

func (c *capture) outcome() Outcome {
	if c.status == 0 {
		c.WriteHeader(http.StatusOK)
	}
	return Outcome{Status: c.status, Header: c.header, Body: c.body.Bytes()}
}
