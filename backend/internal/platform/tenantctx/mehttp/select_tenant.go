package mehttp

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// LastTenants keeps the business an account selected last (S1-07, Q-W0.08-1: control 0004 of W1.00,
// accounts.last_tenant_id and last_tenant_at).
type LastTenants interface {
	// LastTenant returns the stored selection or nil.
	LastTenant(ctx context.Context, account uuid.UUID) (*uuid.UUID, error)
	SetLastTenant(ctx context.Context, account, tenant uuid.UUID) error
}

// selectable: a membership the switcher may select — active, in a business that exists for its people.
func selectable(m tenantctx.Membership) bool {
	return m.Status == active && !hiddenTenant[m.TenantState]
}

// SelectTenant implements contextapi.StrictServerInterface (W1.03, S1-07): it stores lastTenantId for an active
// membership of the identity and returns the refreshed context. Any other tenantId — foreign, unknown, invited,
// ended or hidden — is the same 404. The URL stays authoritative for tenant requests; the selection only decides
// which business opens after sign-in.
func (s *Server) SelectTenant(ctx context.Context, req contextapi.SelectTenantRequestObject) (contextapi.SelectTenantResponseObject, error) {
	sess, ok := session.FromContext(ctx)
	if !ok {
		return nil, problem.New(problem.CodeSessionExpired, "")
	}
	if s.LastTenants == nil {
		return nil, problem.New(problem.CodeNotImplemented, "")
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	m, err := s.Dir.Membership(ctx, sess.AccountID, req.Body.TenantId)
	switch {
	case errors.Is(err, tenantctx.ErrNotFound), err == nil && !selectable(m):
		return nil, problem.New(problem.CodeNotFound, "")
	case err != nil:
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if err := s.LastTenants.SetLastTenant(ctx, sess.AccountID, m.TenantID); err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	mc, err := s.meContext(ctx, sess.AccountID)
	if err != nil {
		return nil, err
	}
	rid, cc := requestid.FromContext(ctx), noStore
	return contextapi.SelectTenant200JSONResponse{
		Body:    mc,
		Headers: contextapi.SelectTenant200ResponseHeaders{CacheControl: &cc, XRequestId: &rid},
	}, nil
}

// lastTenant is lastTenantId of the context: the stored selection while it is still selectable, else nil.
func (s *Server) lastTenant(ctx context.Context, account uuid.UUID, ms []tenantctx.Membership) (*uuid.UUID, error) {
	if s.LastTenants == nil {
		return nil, nil
	}
	last, err := s.LastTenants.LastTenant(ctx, account)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if last == nil {
		return nil, nil
	}
	for _, m := range ms {
		if m.TenantID == *last && selectable(m) {
			return last, nil
		}
	}
	return nil, nil
}

// DB is a control DB pool or transaction.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// PGLastTenants keeps the selection in control DB accounts.last_tenant_id.
type PGLastTenants struct{ db DB }

// NewPGLastTenants returns the store over the control DB (role ortus_api).
func NewPGLastTenants(db DB) PGLastTenants { return PGLastTenants{db: db} }

// LastTenant implements LastTenants.
func (p PGLastTenants) LastTenant(ctx context.Context, account uuid.UUID) (*uuid.UUID, error) {
	var last *uuid.UUID
	err := p.db.QueryRow(ctx, `select last_tenant_id from accounts where id = $1`, account).Scan(&last)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("accounts: %w", err)
	}
	return last, nil
}

// SetLastTenant implements LastTenants.
func (p PGLastTenants) SetLastTenant(ctx context.Context, account, tenant uuid.UUID) error {
	if _, err := p.db.Exec(ctx, `update accounts set last_tenant_id = $2, last_tenant_at = now() where id = $1`, account, tenant); err != nil {
		return fmt.Errorf("accounts: %w", err)
	}
	return nil
}
