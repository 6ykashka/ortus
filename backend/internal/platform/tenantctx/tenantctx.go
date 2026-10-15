// Package tenantctx resolves the tenant of a request and reaches its database (W0.09): the control-DB directory
// (accounts, memberships, tenants, routing), Resolve (membership before tenant state, no fallback to a "main"
// database), lazy tenant DB pools guarded by the sentinel, and the stage-0 permission check over the grants of the
// tenant DB (GrantAuthorizer; the full evaluator permit()/scopeQuery() comes with W1.04).
package tenantctx

import (
	"context"
	"errors"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// ErrNotFound is returned by a Directory for a missing row.
var ErrNotFound = errors.New("tenantctx: not found")

// Account is a global login account (control DB accounts).
type Account struct {
	ID          uuid.UUID
	DisplayName string
	Status      string // active | locked | deleted
}

// Membership links an account to a tenant (control DB memberships + tenants + owner_bindings).
type Membership struct {
	ID              uuid.UUID
	TenantID        uuid.UUID
	PersonProfileID uuid.UUID // people.person_profiles.id in the tenant DB
	TenantName      string
	TenantState     string // tenant_state (PLAT-02)
	Status          string // membership_status: invited | active | suspended | ended
	Owner           bool   // active owner binding
}

// Routing says where the database of a tenant lives (control DB tenant_routing).
type Routing struct {
	TenantID     uuid.UUID
	DatabaseName string
	SecretRef    string // env:<VAR> in the local stand
	Sentinel     uuid.UUID
}

// Directory reads the control DB.
type Directory interface {
	AccountByID(ctx context.Context, id uuid.UUID) (Account, error)
	AccountBySubject(ctx context.Context, issuer, subject string) (Account, error)
	IsPlatformOperator(ctx context.Context, accountID uuid.UUID) (bool, error)
	// Memberships returns every membership of the account, ordered by tenant name, then tenant id.
	Memberships(ctx context.Context, accountID uuid.UUID) ([]Membership, error)
	Membership(ctx context.Context, accountID, tenantID uuid.UUID) (Membership, error)
	Routing(ctx context.Context, tenantID uuid.UUID) (Routing, error)
}

// TenantContext is the immutable tenant scope of a request, built only by the gateway (Resolve).
type TenantContext struct {
	TenantID     uuid.UUID
	MembershipID uuid.UUID
	AccountID    uuid.UUID
	PersonID     uuid.UUID
	Owner        bool
	ReadOnly     bool // tenant in grace or read_only: reads pass, mutations are refused
}

// Tenant states (tenant_state of control 0001).
const (
	stateTrial       = "trial"
	stateActive      = "active"
	stateGrace       = "grace"
	stateReadOnly    = "read_only"
	stateSuspended   = "suspended"
	membershipActive = "active"
)

// Resolve builds the TenantContext of accountID for the tenant id of the URL. Order (10 §3.3, 12 §5 item 2):
// membership first, then the tenant state. A malformed, unknown or foreign tenant, an inactive membership and a
// tenant that is provisioning, closing or closed all give the same not_found.
func Resolve(ctx context.Context, dir Directory, accountID uuid.UUID, rawTenantID string, mutating bool) (TenantContext, error) {
	tenantID, err := uuid.Parse(rawTenantID)
	if err != nil {
		return TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	m, err := dir.Membership(ctx, accountID, tenantID)
	if errors.Is(err, ErrNotFound) {
		return TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	if err != nil {
		return TenantContext{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if m.Status != membershipActive {
		return TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	tc := TenantContext{TenantID: tenantID, MembershipID: m.ID, AccountID: accountID, PersonID: m.PersonProfileID, Owner: m.Owner}
	switch m.TenantState {
	case stateTrial, stateActive:
	case stateGrace, stateReadOnly:
		if mutating {
			return TenantContext{}, problem.New(problem.CodeTenantReadOnly, "")
		}
		tc.ReadOnly = true
	case stateSuspended:
		return TenantContext{}, problem.New(problem.CodeTenantSuspended, "")
	default: // provisioning, closing, closed and anything unknown: fail closed
		return TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	return tc, nil
}

type ctxKey struct{}

// WithTenant returns ctx carrying tc.
func WithTenant(ctx context.Context, tc TenantContext) context.Context {
	return context.WithValue(ctx, ctxKey{}, tc)
}

// FromContext returns the TenantContext put by the gateway; there is no fallback tenant.
func FromContext(ctx context.Context) (TenantContext, bool) {
	tc, ok := ctx.Value(ctxKey{}).(TenantContext)
	return tc, ok
}
