//nolint:dupl // one handler per operation of the generated strict interface: the same shape over the types of each operation
package repairs

import (
	"context"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

// FinanceServer answers the operations of step 6.6 of the tag Repairs over the service: the documents and the finance of
// an object, the accruals to the crew and their payout, the subcontractors, the link of the cabinet and the public
// route of the client (W6.15). It joins the server of the tag beside Server.
type FinanceServer struct{ S *Service }

// ListRepairDocuments implements rapi.StrictServerInterface.
func (s FinanceServer) ListRepairDocuments(ctx context.Context, req rapi.ListRepairDocumentsRequestObject) (rapi.ListRepairDocumentsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Documents(ctx, tc, req.ProjectId)
	return read(ctx, err, func() rapi.ListRepairDocumentsResponseObject {
		return rapi.ListRepairDocuments200JSONResponse{Body: out, Headers: rapi.ListRepairDocuments200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.ListRepairDocuments422ApplicationProblemPlusJSONResponse{})
}

// GetProjectFinance implements rapi.StrictServerInterface.
func (s FinanceServer) GetProjectFinance(ctx context.Context, req rapi.GetProjectFinanceRequestObject) (rapi.GetProjectFinanceResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.ProjectFinance(ctx, tc, req.ProjectId)
	return read(ctx, err, func() rapi.GetProjectFinanceResponseObject {
		return rapi.GetProjectFinance200JSONResponse{Body: out, Headers: rapi.GetProjectFinance200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.GetProjectFinance422ApplicationProblemPlusJSONResponse{})
}

// ListCrewAccruals implements rapi.StrictServerInterface.
func (s FinanceServer) ListCrewAccruals(ctx context.Context, req rapi.ListCrewAccrualsRequestObject) (rapi.ListCrewAccrualsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CrewAccruals(ctx, tc, req.ProjectId)
	return read(ctx, err, func() rapi.ListCrewAccrualsResponseObject {
		return rapi.ListCrewAccruals200JSONResponse{Body: out, Headers: rapi.ListCrewAccruals200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.ListCrewAccruals422ApplicationProblemPlusJSONResponse{})
}

// AccrueByAct implements rapi.StrictServerInterface.
func (s FinanceServer) AccrueByAct(ctx context.Context, req rapi.AccrueByActRequestObject) (rapi.AccrueByActResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.AccrueByAct(ctx, tc, req.DocumentId)
	return reply(ctx, err, func() rapi.AccrueByActResponseObject {
		return rapi.AccrueByAct201JSONResponse{Body: out, Headers: rapi.AccrueByAct201ResponseHeaders{CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.AccrueByAct422ApplicationProblemPlusJSONResponse{}, rapi.AccrueByAct409ApplicationProblemPlusJSONResponse{})
}

// PayoutAccruals implements rapi.StrictServerInterface.
func (s FinanceServer) PayoutAccruals(ctx context.Context, req rapi.PayoutAccrualsRequestObject) (rapi.PayoutAccrualsResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.PayoutAccruals(ctx, tc, b.AccrualIds)
	return reply(ctx, err, func() rapi.PayoutAccrualsResponseObject {
		return rapi.PayoutAccruals200JSONResponse{Body: out, Headers: rapi.PayoutAccruals200ResponseHeaders{CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.PayoutAccruals422ApplicationProblemPlusJSONResponse{}, rapi.PayoutAccruals409ApplicationProblemPlusJSONResponse{})
}

// ListSubcontractors implements rapi.StrictServerInterface.
func (s FinanceServer) ListSubcontractors(ctx context.Context, req rapi.ListSubcontractorsRequestObject) (rapi.ListSubcontractorsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Subcontractors(ctx, tc, req.ProjectId)
	return read(ctx, err, func() rapi.ListSubcontractorsResponseObject {
		return rapi.ListSubcontractors200JSONResponse{Body: out, Headers: rapi.ListSubcontractors200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.ListSubcontractors422ApplicationProblemPlusJSONResponse{})
}

// SetSubcontractorAccess implements rapi.StrictServerInterface.
func (s FinanceServer) SetSubcontractorAccess(ctx context.Context, req rapi.SetSubcontractorAccessRequestObject) (rapi.SetSubcontractorAccessResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.SetSubcontractorAccess(ctx, tc, req.ProjectId, req.SubcontractorId, b)
	return reply(ctx, err, func() rapi.SetSubcontractorAccessResponseObject {
		return rapi.SetSubcontractorAccess200JSONResponse{Body: out, Headers: rapi.SetSubcontractorAccess200ResponseHeaders{CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.SetSubcontractorAccess422ApplicationProblemPlusJSONResponse{}, rapi.SetSubcontractorAccess409ApplicationProblemPlusJSONResponse{})
}

// GetClientLink implements rapi.StrictServerInterface.
func (s FinanceServer) GetClientLink(ctx context.Context, req rapi.GetClientLinkRequestObject) (rapi.GetClientLinkResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.ClientLink(ctx, tc, req.ProjectId)
	return read(ctx, err, func() rapi.GetClientLinkResponseObject {
		return rapi.GetClientLink200JSONResponse{Body: out, Headers: rapi.GetClientLink200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.GetClientLink422ApplicationProblemPlusJSONResponse{})
}

// IssueClientLink implements rapi.StrictServerInterface.
func (s FinanceServer) IssueClientLink(ctx context.Context, req rapi.IssueClientLinkRequestObject) (rapi.IssueClientLinkResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.IssueClientLink(ctx, tc, req.ProjectId)
	return reply(ctx, err, func() rapi.IssueClientLinkResponseObject {
		return rapi.IssueClientLink201JSONResponse{Body: out, Headers: rapi.IssueClientLink201ResponseHeaders{CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.IssueClientLink422ApplicationProblemPlusJSONResponse{}, rapi.IssueClientLink409ApplicationProblemPlusJSONResponse{})
}

// RevokeClientLink implements rapi.StrictServerInterface.
func (s FinanceServer) RevokeClientLink(ctx context.Context, req rapi.RevokeClientLinkRequestObject) (rapi.RevokeClientLinkResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	err = s.S.RevokeClientLink(ctx, tc, req.ProjectId)
	return reply(ctx, err, func() rapi.RevokeClientLinkResponseObject {
		return rapi.RevokeClientLink204Response{Headers: rapi.RevokeClientLink204ResponseHeaders{CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.RevokeClientLink422ApplicationProblemPlusJSONResponse{}, rapi.RevokeClientLink409ApplicationProblemPlusJSONResponse{})
}

// GetClientCabinet implements rapi.StrictServerInterface. The route is public: no session, the token names the tenant.
func (s FinanceServer) GetClientCabinet(ctx context.Context, req rapi.GetClientCabinetRequestObject) (rapi.GetClientCabinetResponseObject, error) {
	out, err := s.S.Cabinet(ctx, req.ClientToken)
	return read(ctx, err, func() rapi.GetClientCabinetResponseObject {
		return rapi.GetClientCabinet200JSONResponse{Body: out, Headers: rapi.GetClientCabinet200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.GetClientCabinet422ApplicationProblemPlusJSONResponse{})
}

// ApproveEstimateByClient implements rapi.StrictServerInterface.
func (s FinanceServer) ApproveEstimateByClient(ctx context.Context, req rapi.ApproveEstimateByClientRequestObject) (rapi.ApproveEstimateByClientResponseObject, error) {
	out, err := s.S.ApproveByClient(ctx, req.ClientToken, req.Version)
	return reply(ctx, err, func() rapi.ApproveEstimateByClientResponseObject {
		return rapi.ApproveEstimateByClient200JSONResponse{Body: out, Headers: rapi.ApproveEstimateByClient200ResponseHeaders{CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.ApproveEstimateByClient422ApplicationProblemPlusJSONResponse{}, rapi.ApproveEstimateByClient409ApplicationProblemPlusJSONResponse{})
}

// SignDocumentByClient implements rapi.StrictServerInterface.
func (s FinanceServer) SignDocumentByClient(ctx context.Context, req rapi.SignDocumentByClientRequestObject) (rapi.SignDocumentByClientResponseObject, error) {
	if req.Body == nil {
		return nil, malformed("")
	}
	out, err := s.S.SignByClient(ctx, req.ClientToken, req.DocumentId, req.Body.SmsCode)
	return reply(ctx, err, func() rapi.SignDocumentByClientResponseObject {
		return rapi.SignDocumentByClient200JSONResponse{Body: out, Headers: rapi.SignDocumentByClient200ResponseHeaders{CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.SignDocumentByClient422ApplicationProblemPlusJSONResponse{}, rapi.SignDocumentByClient409ApplicationProblemPlusJSONResponse{})
}
