package mehttp

import (
	"context"

	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Extras fills the parts of TenantContext owned by W1.08 (Q-W0.09-7): the module availability of the member and
// the state of the tenant for the shell banners. It is optional: without it modules stay empty and tenantState is
// absent, as before W1.08. A failing Extras degrades its part only (logged), never the whole answer.
type Extras interface {
	// TenantState is tenantState of a visible membership; withDB tells whether its tenant DB may be read (an
	// active membership of a tenant with data), otherwise the storage write status is not measured.
	TenantState(ctx context.Context, m tenantctx.Membership, withDB bool) (*contextapi.TenantState, error)
	// Modules is the module availability of an active membership with its capabilities.
	Modules(ctx context.Context, tc tenantctx.TenantContext, tenantState string, caps []contextapi.ScopedCapability) ([]contextapi.ModuleAvailability, error)
}

// tenantState sets t.TenantState from Extras (absent when there is none or it fails).
func (s *Server) tenantState(ctx context.Context, t *contextapi.TenantContext, m tenantctx.Membership, withDB bool) {
	if s.Extras == nil {
		return
	}
	st, err := s.Extras.TenantState(ctx, m, withDB)
	if err != nil {
		s.degraded(ctx, m.TenantID, err)
		return
	}
	t.TenantState = st
}

// modules sets t.Modules from Extras for the capabilities already in t (empty when it fails: fail-closed).
func (s *Server) modules(ctx context.Context, t *contextapi.TenantContext, tc tenantctx.TenantContext, tenantState string) {
	if s.Extras == nil {
		return
	}
	mods, err := s.Extras.Modules(ctx, tc, tenantState, t.Capabilities)
	if err != nil {
		s.degraded(ctx, tc.TenantID, err)
		return
	}
	t.Modules = mods
}
