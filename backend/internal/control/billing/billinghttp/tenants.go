package billinghttp

// W4.60 (W4.07 return 1): every Tenant of the operator carries the seats, the members that are not ended, the tier
// and the sign of the organization (MSW tenantView) — the list, the card, the creation, the rename, the suspension
// and the resumption. The overlay answers the composed server and adds the fields to its successful answers.

import (
	"context"

	"github.com/google/uuid"

	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// withFacts adds the fields of W4.07 to ts; a failure of the facts or the signs is dependency_unavailable.
func (s PlatformServer) withFacts(ctx context.Context, ts []platformapi.Tenant) error {
	ids := make([]uuid.UUID, 0, len(ts))
	for _, t := range ts {
		ids = append(ids, t.Id)
	}
	if len(ids) == 0 {
		return nil
	}
	facts, err := s.Store.Facts(ctx, ids)
	if err != nil {
		return storeError(err)
	}
	marks, err := s.marks(ctx, ids)
	if err != nil {
		return err
	}
	for i := range ts {
		if f, ok := facts[ts[i].Id]; ok {
			applyFacts(&ts[i], f)
		}
		if m, ok := marks[ts[i].Id]; ok {
			ts[i].Brand = &m
		}
	}
	return nil
}

// applyFacts sets seats, memberCount and tierCode of t.
func applyFacts(t *platformapi.Tenant, f billing.Facts) {
	t.Seats = &platformapi.SeatUsage{
		Limit: f.Seats.Limit, Used: f.Seats.Used(), Active: f.Seats.Active, Invited: f.Seats.Invited, Available: f.Seats.Available(),
	}
	t.MemberCount, t.TierCode = new(f.MemberCount), new(f.TierCode)
}

// one adds the fields of W4.07 to one tenant.
func (s PlatformServer) one(ctx context.Context, t *platformapi.Tenant) error {
	ts := []platformapi.Tenant{*t}
	if err := s.withFacts(ctx, ts); err != nil {
		return err
	}
	*t = ts[0]
	return nil
}

// ListPlatformTenants implements platformapi.StrictServerInterface.
func (s PlatformServer) ListPlatformTenants(ctx context.Context, req platformapi.ListPlatformTenantsRequestObject) (platformapi.ListPlatformTenantsResponseObject, error) {
	resp, err := s.StrictServerInterface.ListPlatformTenants(ctx, req)
	if ok, isOK := resp.(platformapi.ListPlatformTenants200JSONResponse); isOK && err == nil {
		if err := s.withFacts(ctx, ok.Body.Items); err != nil {
			return nil, err
		}
		return ok, nil
	}
	return resp, err
}

// GetPlatformTenant implements platformapi.StrictServerInterface.
func (s PlatformServer) GetPlatformTenant(ctx context.Context, req platformapi.GetPlatformTenantRequestObject) (platformapi.GetPlatformTenantResponseObject, error) {
	resp, err := s.StrictServerInterface.GetPlatformTenant(ctx, req)
	if ok, isOK := resp.(platformapi.GetPlatformTenant200JSONResponse); isOK && err == nil {
		if err := s.enriched(ctx, &ok.Body); err != nil {
			return nil, err
		}
		return ok, nil
	}
	return resp, err
}

// CreatePlatformTenant implements platformapi.StrictServerInterface.
func (s PlatformServer) CreatePlatformTenant(ctx context.Context, req platformapi.CreatePlatformTenantRequestObject) (platformapi.CreatePlatformTenantResponseObject, error) {
	resp, err := s.StrictServerInterface.CreatePlatformTenant(ctx, req)
	if ok, isOK := resp.(platformapi.CreatePlatformTenant201JSONResponse); isOK && err == nil {
		if err := s.enriched(ctx, &ok.Body); err != nil {
			return nil, err
		}
		return ok, nil
	}
	return resp, err
}

// UpdatePlatformTenant implements platformapi.StrictServerInterface.
func (s PlatformServer) UpdatePlatformTenant(ctx context.Context, req platformapi.UpdatePlatformTenantRequestObject) (platformapi.UpdatePlatformTenantResponseObject, error) {
	resp, err := s.StrictServerInterface.UpdatePlatformTenant(ctx, req)
	if ok, isOK := resp.(platformapi.UpdatePlatformTenant200JSONResponse); isOK && err == nil {
		if err := s.enriched(ctx, &ok.Body); err != nil {
			return nil, err
		}
		return ok, nil
	}
	return resp, err
}

// SuspendPlatformTenant implements platformapi.StrictServerInterface.
func (s PlatformServer) SuspendPlatformTenant(ctx context.Context, req platformapi.SuspendPlatformTenantRequestObject) (platformapi.SuspendPlatformTenantResponseObject, error) {
	resp, err := s.StrictServerInterface.SuspendPlatformTenant(ctx, req)
	if ok, isOK := resp.(platformapi.SuspendPlatformTenant200JSONResponse); isOK && err == nil {
		if err := s.enriched(ctx, &ok.Body); err != nil {
			return nil, err
		}
		return ok, nil
	}
	return resp, err
}

// ResumePlatformTenant implements platformapi.StrictServerInterface.
func (s PlatformServer) ResumePlatformTenant(ctx context.Context, req platformapi.ResumePlatformTenantRequestObject) (platformapi.ResumePlatformTenantResponseObject, error) {
	resp, err := s.StrictServerInterface.ResumePlatformTenant(ctx, req)
	if ok, isOK := resp.(platformapi.ResumePlatformTenant200JSONResponse); isOK && err == nil {
		if err := s.enriched(ctx, &ok.Body); err != nil {
			return nil, err
		}
		return ok, nil
	}
	return resp, err
}

// enriched adds the fields of W4.07 to t; the committed command is not undone when they fail (the answer is the
// error, the change stays).
func (s PlatformServer) enriched(ctx context.Context, t *platformapi.Tenant) error {
	if err := s.one(ctx, t); err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return nil
}
