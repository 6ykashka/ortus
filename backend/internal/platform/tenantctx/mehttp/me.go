// Package mehttp implements the OpenAPI tag Context: GET /api/v1/me/context (getMyContext, x-scope identity).
// The identity and memberships come from the control DB; the home unit, policy version and capabilities of each
// active membership come from the tenant DB through the sentinel-checked pools. A tenant DB that fails gives no
// units and no capabilities (fail-closed) instead of failing the whole answer.
package mehttp

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"strings"

	"github.com/google/uuid"

	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// TenantDB reads what /me/context needs from the tenant DB of a membership.
type TenantDB interface {
	Profile(ctx context.Context, tc tenantctx.TenantContext) (tenantctx.Profile, error)
	Capabilities(ctx context.Context, tc tenantctx.TenantContext) ([]tenantctx.Grant, error)
}

// Server is the strict server of the tag Context.
type Server struct {
	Dir      tenantctx.Directory
	TenantDB TenantDB
	Log      *slog.Logger // optional: degraded tenants are logged here
}

var _ contextapi.StrictServerInterface = (*Server)(nil)

// visible: memberships shown in tenants[] (yaml:75 «only active/recovery memberships»; enum active | suspended).
const active = "active"

var visible = map[string]bool{active: true, "suspended": true}

// hiddenTenant: states in which a tenant does not exist for its members (Resolve answers 404 for them).
var hiddenTenant = map[string]bool{"provisioning": true, "closing": true, "closed": true}

// enriched: tenant states whose database is read for units and capabilities.
var enriched = map[string]bool{"trial": true, active: true, "grace": true, "read_only": true}

const noStore = "private, no-store"

// GetMyContext implements contextapi.StrictServerInterface.
func (s *Server) GetMyContext(ctx context.Context, _ contextapi.GetMyContextRequestObject) (contextapi.GetMyContextResponseObject, error) {
	sess, ok := session.FromContext(ctx)
	if !ok {
		return nil, problem.New(problem.CodeSessionExpired, "")
	}
	acc, err := s.Dir.AccountByID(ctx, sess.AccountID)
	switch {
	case errors.Is(err, tenantctx.ErrNotFound):
		return nil, problem.New(problem.CodeSessionExpired, "")
	case err != nil: // the control DB failed: "no connection", not "sign in again"
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	case acc.Status != active:
		return nil, problem.New(problem.CodeSessionExpired, "")
	}
	op, err := s.Dir.IsPlatformOperator(ctx, acc.ID)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	ms, err := s.Dir.Memberships(ctx, acc.ID)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	tenants := make([]contextapi.TenantContext, 0, len(ms))
	var versions []string
	for _, m := range ms {
		if !visible[m.Status] || hiddenTenant[m.TenantState] {
			continue
		}
		t, version := s.tenant(ctx, acc.ID, m)
		tenants = append(tenants, t)
		if version != "" {
			versions = append(versions, version)
		}
	}
	rid := requestid.FromContext(ctx)
	cc := noStore
	return contextapi.GetMyContext200JSONResponse{
		Body: contextapi.MeContext{
			UserId:            acc.ID,
			DisplayName:       acc.DisplayName,
			PlatformOperator:  op,
			Tenants:           tenants,
			PermissionVersion: permissionVersion(versions),
		},
		Headers: contextapi.GetMyContext200ResponseHeaders{CacheControl: &cc, XRequestId: &rid},
	}, nil
}

// The operations below came with contract 0.3.0-stage1 (W0.08) and belong to their stage 1 owners (notification
// inbox, business switcher). Until then they answer 501 not_implemented, like a tag without implementation.

// ListMyNotifications implements contextapi.StrictServerInterface (not implemented yet).
func (s *Server) ListMyNotifications(context.Context, contextapi.ListMyNotificationsRequestObject) (contextapi.ListMyNotificationsResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// MarkMyNotificationsRead implements contextapi.StrictServerInterface (not implemented yet).
func (s *Server) MarkMyNotificationsRead(context.Context, contextapi.MarkMyNotificationsReadRequestObject) (contextapi.MarkMyNotificationsReadResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// GetMyNotificationSummary implements contextapi.StrictServerInterface (not implemented yet).
func (s *Server) GetMyNotificationSummary(context.Context, contextapi.GetMyNotificationSummaryRequestObject) (contextapi.GetMyNotificationSummaryResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// SelectTenant implements contextapi.StrictServerInterface (not implemented yet).
func (s *Server) SelectTenant(context.Context, contextapi.SelectTenantRequestObject) (contextapi.SelectTenantResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// tenant builds one entry of tenants[] and the policy version of its tenant DB ("" when it was not read).
func (s *Server) tenant(ctx context.Context, account uuid.UUID, m tenantctx.Membership) (contextapi.TenantContext, string) {
	t := contextapi.TenantContext{
		TenantId:         m.TenantID,
		Name:             m.TenantName,
		MembershipId:     m.ID,
		MembershipStatus: contextapi.TenantContextMembershipStatus(m.Status),
		OrgUnitIds:       []uuid.UUID{},
		Modules:          []contextapi.ModuleAvailability{}, // module availability: W1.07
		Capabilities:     []contextapi.ScopedCapability{},
	}
	if m.Status != active || !enriched[m.TenantState] {
		return t, ""
	}
	tc := tenantctx.TenantContext{TenantID: m.TenantID, MembershipID: m.ID, AccountID: account, PersonID: m.PersonProfileID, Owner: m.Owner}
	p, err := s.TenantDB.Profile(ctx, tc)
	if err != nil {
		s.degraded(ctx, m.TenantID, err)
		return t, ""
	}
	grants, err := s.TenantDB.Capabilities(ctx, tc)
	if err != nil {
		s.degraded(ctx, m.TenantID, err)
		return t, ""
	}
	if p.HomeUnitID != nil {
		t.OrgUnitIds = append(t.OrgUnitIds, *p.HomeUnitID)
	}
	t.Capabilities = capabilities(grants)
	return t, fmt.Sprintf("%s=%d", m.TenantID, p.PolicyVersion)
}

func (s *Server) degraded(ctx context.Context, tenant uuid.UUID, err error) {
	if s.Log != nil {
		s.Log.WarnContext(ctx, "me/context: tenant DB unavailable, tenant shown without capabilities",
			slog.String("request_id", requestid.FromContext(ctx)), slog.String("tenant_id", tenant.String()),
			slog.String("error", err.Error()))
	}
}

// scopeKinds maps scopes of access.role_assignments to Scope.kind of the contract (warehouse has no kind yet).
var scopeKinds = map[string]contextapi.ScopeKind{
	"tenant":   contextapi.Tenant,
	"unit":     contextapi.OrgUnit,
	"project":  contextapi.Project,
	"self":     contextapi.Self,
	"resource": contextapi.ResourcePool,
}

func capabilities(grants []tenantctx.Grant) []contextapi.ScopedCapability {
	out := make([]contextapi.ScopedCapability, 0, len(grants))
	for _, g := range grants {
		kind, ok := scopeKinds[g.ScopeKind]
		if !ok {
			continue
		}
		ids := []uuid.UUID{}
		if g.ScopeRef != nil {
			ids = append(ids, *g.ScopeRef)
		}
		out = append(out, contextapi.ScopedCapability{
			Permission: g.Action,
			Scope:      contextapi.Scope{Kind: kind, ResourceIds: ids, IncludeDescendants: kind == contextapi.OrgUnit},
		})
	}
	return out
}

// permissionVersion is an opaque token that changes whenever the policy version of a visible tenant changes.
func permissionVersion(versions []string) string {
	if len(versions) == 0 {
		return "0"
	}
	sum := sha256.Sum256([]byte(strings.Join(versions, ";")))
	return hex.EncodeToString(sum[:8])
}
