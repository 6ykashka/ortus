// Code below: W4.07 (contract 0.8.0-stage4, step 4.6) — operations without an owner yet answer 501
// not_implemented until W4.60 implements them.

package platformhttp

import (
	"context"

	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// ListPlatformSubscriptionRequests implements platformapi.StrictServerInterface: 501 until W4.60.
func (s *Server) ListPlatformSubscriptionRequests(context.Context, platformapi.ListPlatformSubscriptionRequestsRequestObject) (platformapi.ListPlatformSubscriptionRequestsResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// DecidePlatformSubscriptionRequest implements platformapi.StrictServerInterface: 501 until W4.60.
func (s *Server) DecidePlatformSubscriptionRequest(context.Context, platformapi.DecidePlatformSubscriptionRequestRequestObject) (platformapi.DecidePlatformSubscriptionRequestResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// ListPriceBookVersions implements platformapi.StrictServerInterface: 501 until W4.60.
func (s *Server) ListPriceBookVersions(context.Context, platformapi.ListPriceBookVersionsRequestObject) (platformapi.ListPriceBookVersionsResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// PublishPriceBookVersion implements platformapi.StrictServerInterface: 501 until W4.60.
func (s *Server) PublishPriceBookVersion(context.Context, platformapi.PublishPriceBookVersionRequestObject) (platformapi.PublishPriceBookVersionResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// CancelPriceBookVersion implements platformapi.StrictServerInterface: 501 until W4.60.
func (s *Server) CancelPriceBookVersion(context.Context, platformapi.CancelPriceBookVersionRequestObject) (platformapi.CancelPriceBookVersionResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// GetPlatformUsage implements platformapi.StrictServerInterface: 501 until W4.60.
func (s *Server) GetPlatformUsage(context.Context, platformapi.GetPlatformUsageRequestObject) (platformapi.GetPlatformUsageResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// GetPlatformUser implements platformapi.StrictServerInterface: 501 until W4.60.
func (s *Server) GetPlatformUser(context.Context, platformapi.GetPlatformUserRequestObject) (platformapi.GetPlatformUserResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// LockPlatformUser implements platformapi.StrictServerInterface: 501 until W4.60.
func (s *Server) LockPlatformUser(context.Context, platformapi.LockPlatformUserRequestObject) (platformapi.LockPlatformUserResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// UnlockPlatformUser implements platformapi.StrictServerInterface: 501 until W4.60.
func (s *Server) UnlockPlatformUser(context.Context, platformapi.UnlockPlatformUserRequestObject) (platformapi.UnlockPlatformUserResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// ResetPlatformUserMfa implements platformapi.StrictServerInterface: 501 until W4.60.
func (s *Server) ResetPlatformUserMfa(context.Context, platformapi.ResetPlatformUserMfaRequestObject) (platformapi.ResetPlatformUserMfaResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// ListPlatformOperators implements platformapi.StrictServerInterface: 501 until W4.60.
func (s *Server) ListPlatformOperators(context.Context, platformapi.ListPlatformOperatorsRequestObject) (platformapi.ListPlatformOperatorsResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// InvitePlatformOperator implements platformapi.StrictServerInterface: 501 until W4.60.
func (s *Server) InvitePlatformOperator(context.Context, platformapi.InvitePlatformOperatorRequestObject) (platformapi.InvitePlatformOperatorResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}

// UpdatePlatformOperator implements platformapi.StrictServerInterface: 501 until W4.60.
func (s *Server) UpdatePlatformOperator(context.Context, platformapi.UpdatePlatformOperatorRequestObject) (platformapi.UpdatePlatformOperatorResponseObject, error) {
	return nil, problem.New(problem.CodeNotImplemented, "")
}
