//nolint:dupl // one handler per operation of the generated strict interface: the same shape over the types of each operation
package repairs

import (
	"context"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

// SupplyServer answers the operations of step 6.4 of the tag Repairs over the service: the requests of the foreman, the
// purchases for several objects, the stock on the objects (W6.13). It joins the server of the tag beside Server.
type SupplyServer struct{ S *Service }

// ListSupplyRequests implements rapi.StrictServerInterface.
func (s SupplyServer) ListSupplyRequests(ctx context.Context, req rapi.ListSupplyRequestsRequestObject) (rapi.ListSupplyRequestsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	p := req.Params
	q := SupplyQuery{Project: p.ProjectId, Cursor: p.Cursor, Limit: p.Limit}
	if p.State != nil {
		q.State = new(string(*p.State))
	}
	out, err := s.S.SupplyRequests(ctx, tc, q)
	return read(ctx, err, func() rapi.ListSupplyRequestsResponseObject {
		return rapi.ListSupplyRequests200JSONResponse{Body: out, Headers: rapi.ListSupplyRequests200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.ListSupplyRequests422ApplicationProblemPlusJSONResponse{})
}

// CreateSupplyRequest implements rapi.StrictServerInterface.
func (s SupplyServer) CreateSupplyRequest(ctx context.Context, req rapi.CreateSupplyRequestRequestObject) (rapi.CreateSupplyRequestResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CreateSupplyRequest(ctx, tc, req.ProjectId, b)
	return reply(ctx, err, func() rapi.CreateSupplyRequestResponseObject {
		return rapi.CreateSupplyRequest201JSONResponse{Body: out, Headers: rapi.CreateSupplyRequest201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.CreateSupplyRequest422ApplicationProblemPlusJSONResponse{}, rapi.CreateSupplyRequest409ApplicationProblemPlusJSONResponse{})
}

// ReserveSupplyRequest implements rapi.StrictServerInterface.
func (s SupplyServer) ReserveSupplyRequest(ctx context.Context, req rapi.ReserveSupplyRequestRequestObject) (rapi.ReserveSupplyRequestResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.ReserveSupply(ctx, tc, req.SupplyRequestId, req.Params.IfMatch, b.WarehouseId)
	return reply(ctx, err, func() rapi.ReserveSupplyRequestResponseObject {
		return rapi.ReserveSupplyRequest200JSONResponse{Body: out, Headers: rapi.ReserveSupplyRequest200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.ReserveSupplyRequest422ApplicationProblemPlusJSONResponse{}, rapi.ReserveSupplyRequest409ApplicationProblemPlusJSONResponse{})
}

// IssueSupplyRequest implements rapi.StrictServerInterface.
func (s SupplyServer) IssueSupplyRequest(ctx context.Context, req rapi.IssueSupplyRequestRequestObject) (rapi.IssueSupplyRequestResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.IssueSupply(ctx, tc, req.SupplyRequestId, req.Params.IfMatch)
	return reply(ctx, err, func() rapi.IssueSupplyRequestResponseObject {
		return rapi.IssueSupplyRequest200JSONResponse{Body: out, Headers: rapi.IssueSupplyRequest200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.IssueSupplyRequest422ApplicationProblemPlusJSONResponse{}, rapi.IssueSupplyRequest409ApplicationProblemPlusJSONResponse{})
}

// ConsumeSupplyRequest implements rapi.StrictServerInterface.
func (s SupplyServer) ConsumeSupplyRequest(ctx context.Context, req rapi.ConsumeSupplyRequestRequestObject) (rapi.ConsumeSupplyRequestResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.ConsumeSupply(ctx, tc, req.SupplyRequestId, req.Params.IfMatch)
	return reply(ctx, err, func() rapi.ConsumeSupplyRequestResponseObject {
		return rapi.ConsumeSupplyRequest200JSONResponse{Body: out, Headers: rapi.ConsumeSupplyRequest200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.ConsumeSupplyRequest422ApplicationProblemPlusJSONResponse{}, rapi.ConsumeSupplyRequest409ApplicationProblemPlusJSONResponse{})
}

// CreatePurchase implements rapi.StrictServerInterface.
func (s SupplyServer) CreatePurchase(ctx context.Context, req rapi.CreatePurchaseRequestObject) (rapi.CreatePurchaseResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CreatePurchase(ctx, tc, b)
	return reply(ctx, err, func() rapi.CreatePurchaseResponseObject {
		return rapi.CreatePurchase201JSONResponse{Body: out, Headers: rapi.CreatePurchase201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.CreatePurchase422ApplicationProblemPlusJSONResponse{}, rapi.CreatePurchase409ApplicationProblemPlusJSONResponse{})
}

// ListPurchases implements rapi.StrictServerInterface.
func (s SupplyServer) ListPurchases(ctx context.Context, req rapi.ListPurchasesRequestObject) (rapi.ListPurchasesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Purchases(ctx, tc, req.Params.Cursor, req.Params.Limit)
	return read(ctx, err, func() rapi.ListPurchasesResponseObject {
		return rapi.ListPurchases200JSONResponse{Body: out, Headers: rapi.ListPurchases200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.ListPurchases422ApplicationProblemPlusJSONResponse{})
}

// ReceivePurchase implements rapi.StrictServerInterface.
func (s SupplyServer) ReceivePurchase(ctx context.Context, req rapi.ReceivePurchaseRequestObject) (rapi.ReceivePurchaseResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.ReceivePurchase(ctx, tc, req.PurchaseId, req.Params.IfMatch, b.ReceiptQr)
	return reply(ctx, err, func() rapi.ReceivePurchaseResponseObject {
		return rapi.ReceivePurchase200JSONResponse{Body: out, Headers: rapi.ReceivePurchase200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.ReceivePurchase422ApplicationProblemPlusJSONResponse{}, rapi.ReceivePurchase409ApplicationProblemPlusJSONResponse{})
}

// ListProjectStock implements rapi.StrictServerInterface.
func (s SupplyServer) ListProjectStock(ctx context.Context, _ rapi.ListProjectStockRequestObject) (rapi.ListProjectStockResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.ProjectStock(ctx, tc)
	return read(ctx, err, func() rapi.ListProjectStockResponseObject {
		return rapi.ListProjectStock200JSONResponse{Body: out, Headers: rapi.ListProjectStock200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.ListProjectStock422ApplicationProblemPlusJSONResponse{})
}

// ReturnProjectStock implements rapi.StrictServerInterface.
func (s SupplyServer) ReturnProjectStock(ctx context.Context, req rapi.ReturnProjectStockRequestObject) (rapi.ReturnProjectStockResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.ReturnStock(ctx, tc, req.ProjectId, b)
	return reply(ctx, err, func() rapi.ReturnProjectStockResponseObject {
		return rapi.ReturnProjectStock200JSONResponse{Body: out, Headers: rapi.ReturnProjectStock200ResponseHeaders{CacheControl: cache(),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.ReturnProjectStock422ApplicationProblemPlusJSONResponse{}, rapi.ReturnProjectStock409ApplicationProblemPlusJSONResponse{})
}

// TransferProjectStock implements rapi.StrictServerInterface.
func (s SupplyServer) TransferProjectStock(ctx context.Context, req rapi.TransferProjectStockRequestObject) (rapi.TransferProjectStockResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.TransferStock(ctx, tc, req.ProjectId, b)
	return reply(ctx, err, func() rapi.TransferProjectStockResponseObject {
		return rapi.TransferProjectStock200JSONResponse{Body: out, Headers: rapi.TransferProjectStock200ResponseHeaders{CacheControl: cache(),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.TransferProjectStock422ApplicationProblemPlusJSONResponse{}, rapi.TransferProjectStock409ApplicationProblemPlusJSONResponse{})
}
