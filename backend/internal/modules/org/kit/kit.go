// Package kit holds what the modules of W1.05 (org, people, importer) share: the ETag and If-Match of revisions,
// opaque keyset cursors and page limits, the tenant context of a request, the transaction of a command with its
// audit row and its idempotent outcome (idem.CompleteInTx), and the Problem codes of the tag Access.
//
// Reads of tenant rows go through scopeddb (the scope predicate of the evaluator). A command authorizes its object
// with authz.Evaluator.Permit first and then writes in one pgx transaction (Tx), together with the audit row and
// the stored outcome: scopeddb has no statement without {{scope}}, which inserts and the audit need.
package kit

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/idem"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Problem codes of the tag Access beyond the platform ones (api/errors.yaml).
const (
	CodeValidationFailed    = "validation_failed"
	CodeInvalidTransition   = "invalid_transition"
	CodeRevisionRequired    = "revision_required" // 428: If-Match is missing
	CodeRevisionMismatch    = "revision_mismatch" // 412: If-Match is not the current revision
	CodeSeparationOfDuties  = "separation_of_duties_conflict"
	CodePayloadTooLarge     = "payload_too_large"
	CodeIdempotencyProgress = "idempotency_in_progress"
)

// NoStore is the Cache-Control of every response of the tag (contract: private, no-store).
const NoStore = "private, no-store"

// Page sizes (common/parameters.yaml Limit).
const (
	DefaultLimit = 50
	MaxLimit     = 200
)

// Pools reaches the database of a tenant (tenantctx.Pools: sentinel-checked, never a fallback database).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// Authorizer is what the modules need of the evaluator of W1.04 (*authz.Evaluator): decisions on an object and
// the scope predicate of reads (scopeddb.Scoper).
type Authorizer interface {
	Permit(ctx context.Context, tc tenantctx.TenantContext, action string, r authz.Resource) error
	ScopeQuery(ctx context.Context, tc tenantctx.TenantContext, action string, c authz.Columns, argStart int) (authz.Predicate, error)
}

var _ Authorizer = (*authz.Evaluator)(nil)

// Invalid is 422 validation_failed with a user-facing detail.
func Invalid(detail string) *problem.Error { return problem.New(CodeValidationFailed, detail) }

// Conflict is 409 invalid_transition with a user-facing detail.
func Conflict(detail string) *problem.Error { return problem.New(CodeInvalidTransition, detail) }

// ETag is the strong ETag of a revision.
func ETag(revision int64) string { return `"` + strconv.FormatInt(revision, 10) + `"` }

// CheckRevision compares If-Match with the current revision: missing — 428 revision_required; anything else than
// the strong ETag of current ("*", a weak tag, a list, a stale revision) — 412 revision_mismatch.
func CheckRevision(ifMatch string, current int64) error {
	v := strings.TrimSpace(ifMatch)
	switch {
	case v == "":
		return problem.New(CodeRevisionRequired, "")
	case v != ETag(current):
		return problem.New(CodeRevisionMismatch, "Данные изменились. Обновите страницу и повторите.")
	}
	return nil
}

// EncodeCursor returns the opaque cursor of a keyset position.
func EncodeCursor(keys ...string) string {
	b, _ := json.Marshal(keys) // a slice of strings always marshals
	return base64.RawURLEncoding.EncodeToString(b)
}

// DecodeCursor returns the n keys of a cursor; anything else is 400 malformed_request.
func DecodeCursor(s string, n int) ([]string, error) {
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		return nil, problem.Wrap(problem.CodeMalformedRequest, err)
	}
	var keys []string
	if err := json.Unmarshal(b, &keys); err != nil {
		return nil, problem.Wrap(problem.CodeMalformedRequest, err)
	}
	if len(keys) != n {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	return keys, nil
}

// PageLimit is the page size of a list: DefaultLimit when absent, 1…MaxLimit otherwise.
func PageLimit(p *int) (int, error) {
	if p == nil {
		return DefaultLimit, nil
	}
	if *p < 1 || *p > MaxLimit {
		return 0, problem.New(problem.CodeMalformedRequest, "limit: 1…"+strconv.Itoa(MaxLimit))
	}
	return *p, nil
}

// Tenant returns the tenant context the gateway put in ctx; without one the request has no tenant (404).
func Tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return tenantctx.TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	return tc, nil
}

// RequestID is the request id of ctx; a job outside an HTTP request gets a generated one (audit needs it).
func RequestID(ctx context.Context) string {
	if id := requestid.FromContext(ctx); id != "" {
		return id
	}
	return "job-" + uuid.NewString()
}

// Audit writes e in tx with the actor of the request and its request id.
func Audit(ctx context.Context, tx pgx.Tx, e audit.Event) error {
	base := audit.ForRequest(ctx)
	if e.ActorKind == "" {
		e.ActorKind, e.ActorID = base.ActorKind, base.ActorID
	}
	if e.Result == "" {
		e.Result = audit.OK
	}
	if e.RequestID == "" {
		e.RequestID = RequestID(ctx)
	}
	if err := audit.Record(ctx, tx, e); err != nil {
		return fmt.Errorf("audit %s: %w", e.Action, err)
	}
	return nil
}

// Tx runs fn in one transaction of the tenant DB; an error or a panic of fn rolls it back.
func Tx(ctx context.Context, pools Pools, tenantID uuid.UUID, fn func(pgx.Tx) error) error {
	pool, err := pools.For(ctx, tenantID)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }() // after Commit — a no-op
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return nil
}

// Complete stores the outcome of the command in tx when it runs under an Idempotency-Key (Q-W1.01-6): the body
// is encoded like the generated strict server does (json.Encoder, '\n' at the end). Outside the guard there is no
// record and nothing to store; a lost lease rolls the command back (409 idempotency_in_progress, retryable).
func Complete(ctx context.Context, tx pgx.Tx, status int, etag string, body any) error {
	if _, ok := idem.FromContext(ctx); !ok {
		return nil
	}
	var buf bytes.Buffer
	if err := json.NewEncoder(&buf).Encode(body); err != nil {
		return fmt.Errorf("outcome: %w", err)
	}
	h := http.Header{"Content-Type": {"application/json"}}
	if etag != "" {
		h.Set("ETag", etag)
	}
	err := idem.CompleteInTx(ctx, tx, status, h, buf.Bytes())
	switch {
	case errors.Is(err, idem.ErrLeaseLost):
		return problem.Wrap(CodeIdempotencyProgress, err)
	case err != nil:
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return nil
}

// BumpPolicy raises access.policy_state.policy_version: the scopes of the tenant changed (a unit moved, a work
// function started or ended); clients refresh /me/context (W1.07 sends context.changed by this version).
func BumpPolicy(ctx context.Context, tx pgx.Tx) error {
	if _, err := tx.Exec(ctx, `update access.policy_state set policy_version = policy_version + 1`); err != nil {
		return fmt.Errorf("policy version: %w", err)
	}
	return nil
}
