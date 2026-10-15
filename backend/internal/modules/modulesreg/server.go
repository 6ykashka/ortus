package modulesreg

import (
	"context"

	modulesapi "github.com/ortus/ortus-crm/backend/internal/api/modules"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Server is the strict server of the OpenAPI tag Modules. The gateway has admitted the request: the tenant
// context is in ctx, x-permissions and x-scope (tenant-owner of setModuleInstallation) are checked.
type Server struct{ S *Service }

var _ modulesapi.StrictServerInterface = (*Server)(nil)

const noStore = "private, no-store"

// tenant is the TenantContext the gateway put in ctx; without it the tenant does not exist for the caller.
func tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return tenantctx.TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	return tc, nil
}

func headers(ctx context.Context) (cacheControl, requestID *string) {
	cc, rid := noStore, requestid.FromContext(ctx)
	return &cc, &rid
}

// ListModuleCatalog implements modulesapi.StrictServerInterface.
func (s *Server) ListModuleCatalog(ctx context.Context, _ modulesapi.ListModuleCatalogRequestObject) (modulesapi.ListModuleCatalogResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	items, err := s.S.Catalog(ctx, tc.TenantID)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return modulesapi.ListModuleCatalog200JSONResponse{
		Body:    modulesapi.ModuleCatalog{Items: items},
		Headers: modulesapi.ListModuleCatalog200ResponseHeaders{CacheControl: cc, XRequestId: rid},
	}, nil
}

// GetModuleInstallation implements modulesapi.StrictServerInterface.
func (s *Server) GetModuleInstallation(ctx context.Context, req modulesapi.GetModuleInstallationRequestObject) (modulesapi.GetModuleInstallationResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	m, err := s.S.Get(ctx, tc.TenantID, req.ModuleKey)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag := ETag(m.Revision)
	return modulesapi.GetModuleInstallation200JSONResponse{
		Body:    m,
		Headers: modulesapi.GetModuleInstallation200ResponseHeaders{CacheControl: cc, ETag: &tag, XRequestId: rid},
	}, nil
}

// SetModuleInstallation implements modulesapi.StrictServerInterface.
func (s *Server) SetModuleInstallation(ctx context.Context, req modulesapi.SetModuleInstallationRequestObject) (modulesapi.SetModuleInstallationResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	u := Update{Enabled: req.Body.Enabled}
	if req.Body.Reason != nil {
		u.Reason = *req.Body.Reason
	}
	if req.Body.RetainedAccess != nil {
		u.Retained = string(*req.Body.RetainedAccess)
	}
	m, err := s.S.Set(ctx, tc, req.ModuleKey, u, req.Params.IfMatch)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := ETag(m.Revision), false
	return modulesapi.SetModuleInstallation200JSONResponse{
		Body: m,
		Headers: modulesapi.SetModuleInstallation200ResponseHeaders{
			CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid,
		},
	}, nil
}

// PreviewModuleDeactivation implements modulesapi.StrictServerInterface.
func (s *Server) PreviewModuleDeactivation(ctx context.Context, req modulesapi.PreviewModuleDeactivationRequestObject) (modulesapi.PreviewModuleDeactivationResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	p, err := s.S.Preview(ctx, tc.TenantID, req.ModuleKey)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return modulesapi.PreviewModuleDeactivation200JSONResponse{
		Body: p, Headers: modulesapi.PreviewModuleDeactivation200ResponseHeaders{CacheControl: cc, XRequestId: rid},
	}, nil
}

// GetModuleSettings implements modulesapi.StrictServerInterface.
func (s *Server) GetModuleSettings(ctx context.Context, req modulesapi.GetModuleSettingsRequestObject) (modulesapi.GetModuleSettingsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	st, err := s.S.Settings(ctx, tc.TenantID, req.ModuleKey)
	if err != nil {
		return nil, err
	}
	var body modulesapi.ModuleSettings
	if err := body.UnmarshalJSON(st.Body); err != nil {
		return nil, dependency(err)
	}
	cc, rid := headers(ctx)
	tag := ETag(st.Revision)
	return modulesapi.GetModuleSettings200JSONResponse{
		Body: body, Headers: modulesapi.GetModuleSettings200ResponseHeaders{CacheControl: cc, ETag: &tag, XRequestId: rid},
	}, nil
}

// UpdateModuleSettings implements modulesapi.StrictServerInterface.
func (s *Server) UpdateModuleSettings(ctx context.Context, req modulesapi.UpdateModuleSettingsRequestObject) (modulesapi.UpdateModuleSettingsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	raw, err := req.Body.MarshalJSON()
	if err != nil {
		return nil, problem.Wrap(problem.CodeMalformedRequest, err)
	}
	st, err := s.S.UpdateSettings(ctx, tc, req.ModuleKey, raw, req.Params.IfMatch)
	if err != nil {
		return nil, err
	}
	var body modulesapi.ModuleSettings
	if err := body.UnmarshalJSON(st.Body); err != nil {
		return nil, dependency(err)
	}
	cc, rid := headers(ctx)
	tag, replayed := ETag(st.Revision), false
	return modulesapi.UpdateModuleSettings200JSONResponse{
		Body: body,
		Headers: modulesapi.UpdateModuleSettings200ResponseHeaders{
			CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid,
		},
	}, nil
}
