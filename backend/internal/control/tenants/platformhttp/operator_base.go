package platformhttp

import (
	"context"

	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// The operator commands and the platform audit log of the contract 0.4.0-stage1 (W1.00) are implemented by
// operators.Server (backend/internal/control/tenants/operators, W1.48), which embeds this Server and overrides the
// methods below; cmd/api mounts it. Server alone stays a complete strict server of the tag (its own tests, a
// process without the operator service): these operations answer 501 not_implemented there.

// SuspendPlatformTenant implements platformapi.StrictServerInterface (operators.Server overrides it).
func (s *Server) SuspendPlatformTenant(context.Context, platformapi.SuspendPlatformTenantRequestObject) (platformapi.SuspendPlatformTenantResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// ResumePlatformTenant implements platformapi.StrictServerInterface (operators.Server overrides it).
func (s *Server) ResumePlatformTenant(context.Context, platformapi.ResumePlatformTenantRequestObject) (platformapi.ResumePlatformTenantResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// ExtendPlatformTrial implements platformapi.StrictServerInterface (operators.Server overrides it).
func (s *Server) ExtendPlatformTrial(context.Context, platformapi.ExtendPlatformTrialRequestObject) (platformapi.ExtendPlatformTrialResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// ListPlatformAuditEvents implements platformapi.StrictServerInterface (operators.Server overrides it).
func (s *Server) ListPlatformAuditEvents(context.Context, platformapi.ListPlatformAuditEventsRequestObject) (platformapi.ListPlatformAuditEventsResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}
