package cash

import (
	"context"

	"github.com/google/uuid"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Server is the strict server of the tag Cash over the Service: the parameters are checked here, the rules are the
// Service's.
type Server struct{ S *Service }

var _ cashapi.StrictServerInterface = Server{}

func tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return tenantctx.TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	return tc, nil
}

func headers(ctx context.Context) (cacheControl, reqID *string) {
	cc, rid := "private, no-store", requestid.FromContext(ctx)
	if rid == "" {
		return &cc, nil
	}
	return &cc, &rid
}

func malformed() error { return problem.New(problem.CodeMalformedRequest, "") }

func pageOf(cursor *string, limit *int) PageQuery {
	var q PageQuery
	if cursor != nil {
		q.Cursor = *cursor
	}
	if limit != nil {
		q.Limit = *limit
		if q.Limit == 0 {
			q.Limit = -1 // an explicit zero is out of range, not «default»
		}
	}
	return q
}

func idOf(p *cashapi.Id) uuid.UUID {
	if p == nil {
		return uuid.Nil
	}
	return *p
}

func strOf[T ~string](p *T) string {
	if p == nil {
		return ""
	}
	return string(*p)
}

// ListCashAccounts implements cashapi.StrictServerInterface.
func (h Server) ListCashAccounts(ctx context.Context, r cashapi.ListCashAccountsRequestObject) (cashapi.ListCashAccountsResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.ListAccounts(ctx, tc, AccountsQuery{PageQuery: pageOf(r.Params.Cursor, r.Params.Limit), Kind: strOf(r.Params.Kind),
		OrgUnitID: idOf(r.Params.OrgUnitId)})
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return cashapi.ListCashAccounts200JSONResponse{Body: out, Headers: cashapi.ListCashAccounts200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// CreateCashAccount implements cashapi.StrictServerInterface.
func (h Server) CreateCashAccount(ctx context.Context, r cashapi.CreateCashAccountRequestObject) (cashapi.CreateCashAccountResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.CreateAccount(ctx, tc, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return cashapi.CreateCashAccount201JSONResponse{Body: out, Headers: cashapi.CreateCashAccount201ResponseHeaders{CacheControl: cc, ETag: &tag,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// PreviewCashAccountAccess implements cashapi.StrictServerInterface.
func (h Server) PreviewCashAccountAccess(ctx context.Context, r cashapi.PreviewCashAccountAccessRequestObject) (cashapi.PreviewCashAccountAccessResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.PreviewAccess(ctx, tc, AccessQuery{Kind: strOf(r.Params.Kind), Unit: idOf(r.Params.OrgUnitId), Holder: idOf(r.Params.HolderMemberId)})
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return cashapi.PreviewCashAccountAccess200JSONResponse{Body: out, Headers: cashapi.PreviewCashAccountAccess200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// IssueCashAdvance implements cashapi.StrictServerInterface.
func (h Server) IssueCashAdvance(ctx context.Context, r cashapi.IssueCashAdvanceRequestObject) (cashapi.IssueCashAdvanceResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	tr, req, err := h.S.IssueAdvance(ctx, tc, r.AccountId, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	if req != nil {
		tag := etag(req.Revision)
		return cashapi.IssueCashAdvance202JSONResponse{Body: *req, Headers: cashapi.IssueCashAdvance202ResponseHeaders{CacheControl: cc, ETag: &tag,
			IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
	}
	return cashapi.IssueCashAdvance201JSONResponse{Body: *tr, Headers: cashapi.IssueCashAdvance201ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ReturnCashAdvance implements cashapi.StrictServerInterface.
func (h Server) ReturnCashAdvance(ctx context.Context, r cashapi.ReturnCashAdvanceRequestObject) (cashapi.ReturnCashAdvanceResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.ReturnAdvance(ctx, tc, r.AccountId, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return cashapi.ReturnCashAdvance201JSONResponse{Body: out, Headers: cashapi.ReturnCashAdvance201ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// SubmitAdvanceReceipt implements cashapi.StrictServerInterface.
func (h Server) SubmitAdvanceReceipt(ctx context.Context, r cashapi.SubmitAdvanceReceiptRequestObject) (cashapi.SubmitAdvanceReceiptResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.SubmitReceipt(ctx, tc, r.AccountId, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return cashapi.SubmitAdvanceReceipt201JSONResponse{Body: out, Headers: cashapi.SubmitAdvanceReceipt201ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// OpenCashShift implements cashapi.StrictServerInterface.
func (h Server) OpenCashShift(ctx context.Context, r cashapi.OpenCashShiftRequestObject) (cashapi.OpenCashShiftResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.OpenShift(ctx, tc, r.AccountId, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return cashapi.OpenCashShift201JSONResponse{Body: out, Headers: cashapi.OpenCashShift201ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ListCashApprovalRequests implements cashapi.StrictServerInterface.
func (h Server) ListCashApprovalRequests(ctx context.Context, r cashapi.ListCashApprovalRequestsRequestObject) (cashapi.ListCashApprovalRequestsResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.ListRequests(ctx, tc, RequestsQuery{PageQuery: pageOf(r.Params.Cursor, r.Params.Limit), Status: strOf(r.Params.Status)})
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return cashapi.ListCashApprovalRequests200JSONResponse{Body: out, Headers: cashapi.ListCashApprovalRequests200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// DecideCashApprovalRequest implements cashapi.StrictServerInterface.
func (h Server) DecideCashApprovalRequest(ctx context.Context, r cashapi.DecideCashApprovalRequestRequestObject) (cashapi.DecideCashApprovalRequestResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil || (r.Body.Decision != cashapi.CashApprovalDecisionDecisionApprove && r.Body.Decision != cashapi.CashApprovalDecisionDecisionReject) {
		return nil, malformed()
	}
	out, err := h.S.DecideRequest(ctx, tc, r.ApprovalRequestId, r.Params.IfMatch,
		Decision{Accept: r.Body.Decision == cashapi.CashApprovalDecisionDecisionApprove, Reason: r.Body.Reason})
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return cashapi.DecideCashApprovalRequest200JSONResponse{Body: out, Headers: cashapi.DecideCashApprovalRequest200ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ListCashCategories implements cashapi.StrictServerInterface.
func (h Server) ListCashCategories(ctx context.Context, _ cashapi.ListCashCategoriesRequestObject) (cashapi.ListCashCategoriesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.ListCategories(ctx, tc)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return cashapi.ListCashCategories200JSONResponse{Body: out, Headers: cashapi.ListCashCategories200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// FindCashDuplicates implements cashapi.StrictServerInterface.
func (h Server) FindCashDuplicates(ctx context.Context, r cashapi.FindCashDuplicatesRequestObject) (cashapi.FindCashDuplicatesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	q := DuplicatesQuery{AccountID: idOf(r.Params.AccountId), Method: strOf(r.Params.Method), Type: strOf(r.Params.Type)}
	if r.Params.AmountMinor != nil {
		q.Amount = int64(*r.Params.AmountMinor)
	}
	if r.Params.At != nil {
		q.At = *r.Params.At
	}
	out, err := h.S.FindDuplicates(ctx, tc, q)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return cashapi.FindCashDuplicates200JSONResponse{Body: out, Headers: cashapi.FindCashDuplicates200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// ListCashOperations implements cashapi.StrictServerInterface.
func (h Server) ListCashOperations(ctx context.Context, r cashapi.ListCashOperationsRequestObject) (cashapi.ListCashOperationsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.ListOperations(ctx, tc, OperationsQuery{PageQuery: pageOf(r.Params.Cursor, r.Params.Limit), AccountID: idOf(r.Params.AccountId),
		Type: strOf(r.Params.Type), ShiftID: idOf(r.Params.ShiftId)})
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return cashapi.ListCashOperations200JSONResponse{Body: out, Headers: cashapi.ListCashOperations200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// PostCashOperation implements cashapi.StrictServerInterface.
func (h Server) PostCashOperation(ctx context.Context, r cashapi.PostCashOperationRequestObject) (cashapi.PostCashOperationResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body != nil && r.Body.ReversesOperationId != nil { // «linked reversal»: the reversal has its own rules
		out, err := h.S.ReverseOperation(ctx, tc, *r.Body.ReversesOperationId, r.Body.Basis)
		if err != nil {
			return nil, err
		}
		cc, rid := headers(ctx)
		replayed := false
		return cashapi.PostCashOperation201JSONResponse{Body: out, Headers: cashapi.PostCashOperation201ResponseHeaders{CacheControl: cc,
			IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
	}
	op, req, err := h.S.PostOperation(ctx, tc, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	if req != nil {
		tag := etag(req.Revision)
		return cashapi.PostCashOperation202JSONResponse{Body: *req, Headers: cashapi.PostCashOperation202ResponseHeaders{CacheControl: cc, ETag: &tag,
			IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
	}
	return cashapi.PostCashOperation201JSONResponse{Body: *op, Headers: cashapi.PostCashOperation201ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ReverseCashOperation implements cashapi.StrictServerInterface.
func (h Server) ReverseCashOperation(ctx context.Context, r cashapi.ReverseCashOperationRequestObject) (cashapi.ReverseCashOperationResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, malformed()
	}
	out, err := h.S.ReverseOperation(ctx, tc, r.OperationId, &r.Body.Reason)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return cashapi.ReverseCashOperation201JSONResponse{Body: out, Headers: cashapi.ReverseCashOperation201ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// LinkCashOperationSource implements cashapi.StrictServerInterface.
func (h Server) LinkCashOperationSource(ctx context.Context, r cashapi.LinkCashOperationSourceRequestObject) (cashapi.LinkCashOperationSourceResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, malformed()
	}
	out, err := h.S.LinkSource(ctx, tc, r.OperationId, r.Body.Source)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return cashapi.LinkCashOperationSource201JSONResponse{Body: out, Headers: cashapi.LinkCashOperationSource201ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ListCashProposals implements cashapi.StrictServerInterface.
func (h Server) ListCashProposals(ctx context.Context, r cashapi.ListCashProposalsRequestObject) (cashapi.ListCashProposalsResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.ListProposals(ctx, tc, ProposalsQuery{PageQuery: pageOf(r.Params.Cursor, r.Params.Limit), Status: strOf(r.Params.Status)})
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return cashapi.ListCashProposals200JSONResponse{Body: out, Headers: cashapi.ListCashProposals200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// DismissCashProposal implements cashapi.StrictServerInterface.
func (h Server) DismissCashProposal(ctx context.Context, r cashapi.DismissCashProposalRequestObject) (cashapi.DismissCashProposalResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, malformed()
	}
	out, err := h.S.DismissProposal(ctx, tc, r.ProposalKey, &r.Body.Reason)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return cashapi.DismissCashProposal200JSONResponse{Body: out, Headers: cashapi.DismissCashProposal200ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// PostCashProposal implements cashapi.StrictServerInterface.
func (h Server) PostCashProposal(ctx context.Context, r cashapi.PostCashProposalRequestObject) (cashapi.PostCashProposalResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	res, req, err := h.S.PostProposal(ctx, tc, r.ProposalKey, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	if req != nil {
		tag := etag(req.Revision)
		return cashapi.PostCashProposal202JSONResponse{Body: *req, Headers: cashapi.PostCashProposal202ResponseHeaders{CacheControl: cc, ETag: &tag,
			IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
	}
	return cashapi.PostCashProposal201JSONResponse{Body: *res, Headers: cashapi.PostCashProposal201ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ListAdvanceReceipts implements cashapi.StrictServerInterface.
func (h Server) ListAdvanceReceipts(ctx context.Context, r cashapi.ListAdvanceReceiptsRequestObject) (cashapi.ListAdvanceReceiptsResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.ListReceipts(ctx, tc, ReceiptsQuery{PageQuery: pageOf(r.Params.Cursor, r.Params.Limit), AccountID: idOf(r.Params.AccountId),
		Status: strOf(r.Params.Status)})
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return cashapi.ListAdvanceReceipts200JSONResponse{Body: out, Headers: cashapi.ListAdvanceReceipts200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// DecideAdvanceReceipt implements cashapi.StrictServerInterface.
func (h Server) DecideAdvanceReceipt(ctx context.Context, r cashapi.DecideAdvanceReceiptRequestObject) (cashapi.DecideAdvanceReceiptResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil || (r.Body.Decision != cashapi.AdvanceReceiptDecisionDecisionAccept && r.Body.Decision != cashapi.AdvanceReceiptDecisionDecisionReject) {
		return nil, malformed()
	}
	out, err := h.S.DecideReceipt(ctx, tc, r.ReceiptId, r.Params.IfMatch,
		Decision{Accept: r.Body.Decision == cashapi.AdvanceReceiptDecisionDecisionAccept, Reason: r.Body.Reason})
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return cashapi.DecideAdvanceReceipt200JSONResponse{Body: out, Headers: cashapi.DecideAdvanceReceipt200ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ListCashShifts implements cashapi.StrictServerInterface.
func (h Server) ListCashShifts(ctx context.Context, r cashapi.ListCashShiftsRequestObject) (cashapi.ListCashShiftsResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.ListShifts(ctx, tc, ShiftsQuery{PageQuery: pageOf(r.Params.Cursor, r.Params.Limit), AccountID: idOf(r.Params.AccountId),
		Status: strOf(r.Params.Status)})
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return cashapi.ListCashShifts200JSONResponse{Body: out, Headers: cashapi.ListCashShifts200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// CloseCashShift implements cashapi.StrictServerInterface.
func (h Server) CloseCashShift(ctx context.Context, r cashapi.CloseCashShiftRequestObject) (cashapi.CloseCashShiftResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.CloseShift(ctx, tc, r.ShiftId, r.Params.IfMatch, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return cashapi.CloseCashShift200JSONResponse{Body: out, Headers: cashapi.CloseCashShift200ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ReviewCashShift implements cashapi.StrictServerInterface.
func (h Server) ReviewCashShift(ctx context.Context, r cashapi.ReviewCashShiftRequestObject) (cashapi.ReviewCashShiftResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.ReviewShift(ctx, tc, r.ShiftId, r.Params.IfMatch, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return cashapi.ReviewCashShift200JSONResponse{Body: out, Headers: cashapi.ReviewCashShift200ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ListCashTransfers implements cashapi.StrictServerInterface.
func (h Server) ListCashTransfers(ctx context.Context, r cashapi.ListCashTransfersRequestObject) (cashapi.ListCashTransfersResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.ListTransfers(ctx, tc, TransfersQuery{PageQuery: pageOf(r.Params.Cursor, r.Params.Limit), Status: strOf(r.Params.Status),
		AccountID: idOf(r.Params.AccountId)})
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return cashapi.ListCashTransfers200JSONResponse{Body: out, Headers: cashapi.ListCashTransfers200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// CreateCashTransfer implements cashapi.StrictServerInterface.
func (h Server) CreateCashTransfer(ctx context.Context, r cashapi.CreateCashTransferRequestObject) (cashapi.CreateCashTransferResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.CreateTransfer(ctx, tc, r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return cashapi.CreateCashTransfer201JSONResponse{Body: out, Headers: cashapi.CreateCashTransfer201ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// DecideCashTransfer implements cashapi.StrictServerInterface.
func (h Server) DecideCashTransfer(ctx context.Context, r cashapi.DecideCashTransferRequestObject) (cashapi.DecideCashTransferResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil || (r.Body.Decision != cashapi.CashTransferDecisionDecisionAccept && r.Body.Decision != cashapi.CashTransferDecisionDecisionReject) {
		return nil, malformed()
	}
	out, err := h.S.DecideTransfer(ctx, tc, r.TransferId, r.Params.IfMatch,
		Decision{Accept: r.Body.Decision == cashapi.CashTransferDecisionDecisionAccept, Reason: r.Body.Reason})
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return cashapi.DecideCashTransfer200JSONResponse{Body: out, Headers: cashapi.DecideCashTransfer200ResponseHeaders{CacheControl: cc,
		IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}
