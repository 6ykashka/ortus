package platformhttp

import (
	"context"

	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Operator commands and the platform audit log of the second stage 1 contract PR (W1.00, 0.4.0-stage1) belong to
// W1.11: until its step they answer 501 not_implemented. W1.11 replaces this file with its own.

// SuspendPlatformTenant implements platformapi.StrictServerInterface (W1.11).
func (s *Server) SuspendPlatformTenant(context.Context, platformapi.SuspendPlatformTenantRequestObject) (platformapi.SuspendPlatformTenantResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// ResumePlatformTenant implements platformapi.StrictServerInterface (W1.11).
func (s *Server) ResumePlatformTenant(context.Context, platformapi.ResumePlatformTenantRequestObject) (platformapi.ResumePlatformTenantResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// ExtendPlatformTrial implements platformapi.StrictServerInterface (W1.11).
func (s *Server) ExtendPlatformTrial(context.Context, platformapi.ExtendPlatformTrialRequestObject) (platformapi.ExtendPlatformTrialResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// ListPlatformAuditEvents implements platformapi.StrictServerInterface (W1.11).
func (s *Server) ListPlatformAuditEvents(context.Context, platformapi.ListPlatformAuditEventsRequestObject) (platformapi.ListPlatformAuditEventsResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}
