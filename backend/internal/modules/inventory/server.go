//nolint:dupl // one handler per operation of the generated strict interface: the same shape over the types of each operation
package inventory

import (
	"context"
	"errors"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	api "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// noStore is Cache-Control of every answer (the contract: «private, no-store»).
const noStore = "private, no-store"

// Server implements api.StrictServerInterface (the tag Inventory) over the service. A RefusalError — a 422 with the field
// or a 409 with the reason — is the typed answer of the operation; any other error goes to problem.Write.
type Server struct{ S *Service }

var _ api.StrictServerInterface = Server{}

func cache() *string { return new(noStore) }

func rid(ctx context.Context) *string { return new(requestid.FromContext(ctx)) }

func notReplayed() *bool { return new(false) }

func tagOf(revision int64) *string { return new(etag(revision)) }

// body is the Problem of a failure with its reason and field.
func body(ctx context.Context, f *RefusalError) api.Problem {
	p := catalog.Problems[f.Code]
	out := api.Problem{Type: problem.TypeBase + f.Code, Title: p.Title, Status: int64(p.Status), Code: api.ProblemCode(f.Code),
		Detail: new(f.Detail), RequestId: requestid.FromContext(ctx)}
	if f.Reason != "" {
		out.Reason = new(f.Reason)
	}
	if f.Field != "" {
		out.Violations = &[]api.ProblemViolation{{Field: f.Field, Code: "invalid", Message: f.Detail}}
	}
	return out
}

// invalidOf and conflictOf are the 422 and 409 answers of an operation (the generated types embed the shared ones).
type (
	invalidOf interface {
		~struct {
			api.ValidationApplicationProblemPlusJSONResponse
		}
	}
	conflictOf interface {
		~struct {
			api.ConflictApplicationProblemPlusJSONResponse
		}
	}
)

// answerOf converts an answer to the response object R of its operation.
func answerOf[R any](v any) R {
	r, ok := v.(R)
	if !ok {
		panic("inventory: an answer of another operation") // the types of the call site are wrong: a programming error
	}
	return r
}

// reply is the answer of a command: ok when err is nil, the typed 422 (V) or 409 (C) of a failure, err otherwise.
func reply[R any, V invalidOf, C conflictOf](ctx context.Context, err error, ok R, _ V, _ C) (R, error) {
	f, failed := errors.AsType[*RefusalError](err)
	switch {
	case failed && f.Code == codeValidation:
		return answerOf[R](V{api.ValidationApplicationProblemPlusJSONResponse{Body: body(ctx, f),
			Headers: api.ValidationResponseHeaders{XRequestId: rid(ctx)}}}), nil
	case failed:
		return answerOf[R](C{api.ConflictApplicationProblemPlusJSONResponse{Body: body(ctx, f),
			Headers: api.ConflictResponseHeaders{XRequestId: rid(ctx)}}}), nil
	case err != nil:
		var zero R
		return zero, err
	}
	return ok, nil
}

func queryOf(cursor *string, limit *int) PageQuery {
	q := PageQuery{}
	if cursor != nil {
		q.Cursor = *cursor
	}
	if limit != nil {
		q.Limit = *limit
		if q.Limit == 0 {
			q.Limit = -1 // an explicit zero is out of the page sizes, not «the default»
		}
	}
	return q
}

// ListWarehouses implements api.StrictServerInterface.
func (s Server) ListWarehouses(ctx context.Context, r api.ListWarehousesRequestObject) (api.ListWarehousesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	page, err := s.S.ListWarehouses(ctx, tc, queryOf(r.Params.Cursor, r.Params.Limit))
	if err != nil {
		return nil, err
	}
	return api.ListWarehouses200JSONResponse{Body: page, Headers: api.ListWarehouses200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}, nil
}

// CreateWarehouse implements api.StrictServerInterface.
func (s Server) CreateWarehouse(ctx context.Context, r api.CreateWarehouseRequestObject) (api.CreateWarehouseResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := s.S.CreateWarehouse(ctx, tc, *r.Body)
	var ok api.CreateWarehouseResponseObject = api.CreateWarehouse201JSONResponse{Body: out, Headers: api.CreateWarehouse201ResponseHeaders{
		CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, api.CreateWarehouse422ApplicationProblemPlusJSONResponse{}, api.CreateWarehouse409ApplicationProblemPlusJSONResponse{})
}

// ListInventoryItems implements api.StrictServerInterface.
func (s Server) ListInventoryItems(ctx context.Context, r api.ListInventoryItemsRequestObject) (api.ListInventoryItemsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	page, err := s.S.ListItems(ctx, tc, queryOf(r.Params.Cursor, r.Params.Limit))
	if err != nil {
		return nil, err
	}
	return api.ListInventoryItems200JSONResponse{Body: page, Headers: api.ListInventoryItems200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}, nil
}

// CreateInventoryItem implements api.StrictServerInterface.
func (s Server) CreateInventoryItem(ctx context.Context, r api.CreateInventoryItemRequestObject) (api.CreateInventoryItemResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := s.S.CreateItem(ctx, tc, *r.Body)
	var ok api.CreateInventoryItemResponseObject = api.CreateInventoryItem201JSONResponse{Body: out, Headers: api.CreateInventoryItem201ResponseHeaders{
		CacheControl: cache(), ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, api.CreateInventoryItem422ApplicationProblemPlusJSONResponse{}, api.CreateInventoryItem409ApplicationProblemPlusJSONResponse{})
}

// UpdateInventoryItem implements api.StrictServerInterface.
func (s Server) UpdateInventoryItem(ctx context.Context, r api.UpdateInventoryItemRequestObject) (api.UpdateInventoryItemResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := s.S.UpdateItem(ctx, tc, r.ItemId, r.Params.IfMatch, *r.Body)
	var ok api.UpdateInventoryItemResponseObject = api.UpdateInventoryItem200JSONResponse{Body: out, Headers: api.UpdateInventoryItem200ResponseHeaders{
		CacheControl: cache(), ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, api.UpdateInventoryItem422ApplicationProblemPlusJSONResponse{}, api.UpdateInventoryItem409ApplicationProblemPlusJSONResponse{})
}

// ListInventoryMovements implements api.StrictServerInterface.
func (s Server) ListInventoryMovements(ctx context.Context, r api.ListInventoryMovementsRequestObject) (api.ListInventoryMovementsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	page, err := s.S.ListMovements(ctx, tc, queryOf(r.Params.Cursor, r.Params.Limit))
	if err != nil {
		return nil, err
	}
	return api.ListInventoryMovements200JSONResponse{Body: page, Headers: api.ListInventoryMovements200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}, nil
}

// PostInventoryMovement implements api.StrictServerInterface.
func (s Server) PostInventoryMovement(ctx context.Context, r api.PostInventoryMovementRequestObject) (api.PostInventoryMovementResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := s.S.PostMovement(ctx, tc, *r.Body)
	var ok api.PostInventoryMovementResponseObject = api.PostInventoryMovement201JSONResponse{Body: out, Headers: api.PostInventoryMovement201ResponseHeaders{
		CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, api.PostInventoryMovement422ApplicationProblemPlusJSONResponse{}, api.PostInventoryMovement409ApplicationProblemPlusJSONResponse{})
}

// ListInventoryBalances implements api.StrictServerInterface.
func (s Server) ListInventoryBalances(ctx context.Context, r api.ListInventoryBalancesRequestObject) (api.ListInventoryBalancesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	q := BalanceQuery{PageQuery: queryOf(r.Params.Cursor, r.Params.Limit), WarehouseID: r.Params.WarehouseId, ItemID: r.Params.ItemId, BelowMinimum: r.Params.BelowMinimum}
	page, err := s.S.ListBalances(ctx, tc, q)
	if err != nil {
		return nil, err
	}
	return api.ListInventoryBalances200JSONResponse{Body: page, Headers: api.ListInventoryBalances200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}, nil
}

// ListInventoryReservations implements api.StrictServerInterface.
func (s Server) ListInventoryReservations(ctx context.Context, r api.ListInventoryReservationsRequestObject) (api.ListInventoryReservationsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	q := ReservationQuery{PageQuery: queryOf(r.Params.Cursor, r.Params.Limit), WarehouseID: r.Params.WarehouseId}
	if r.Params.Status != nil {
		q.Status = string(*r.Params.Status)
	}
	page, err := s.S.ListReservations(ctx, tc, q)
	if err != nil {
		return nil, err
	}
	return api.ListInventoryReservations200JSONResponse{Body: page, Headers: api.ListInventoryReservations200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}, nil
}

// CreateInventoryReservation implements api.StrictServerInterface.
func (s Server) CreateInventoryReservation(ctx context.Context, r api.CreateInventoryReservationRequestObject) (api.CreateInventoryReservationResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := s.S.CreateReservation(ctx, tc, *r.Body)
	var ok api.CreateInventoryReservationResponseObject = api.CreateInventoryReservation201JSONResponse{Body: out, Headers: api.CreateInventoryReservation201ResponseHeaders{
		CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, api.CreateInventoryReservation422ApplicationProblemPlusJSONResponse{}, api.CreateInventoryReservation409ApplicationProblemPlusJSONResponse{})
}

// ReleaseInventoryReservation implements api.StrictServerInterface.
func (s Server) ReleaseInventoryReservation(ctx context.Context, r api.ReleaseInventoryReservationRequestObject) (api.ReleaseInventoryReservationResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.ReleaseReservation(ctx, tc, r.ReservationId)
	var ok api.ReleaseInventoryReservationResponseObject = api.ReleaseInventoryReservation200JSONResponse{Body: out, Headers: api.ReleaseInventoryReservation200ResponseHeaders{
		CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, api.ReleaseInventoryReservation422ApplicationProblemPlusJSONResponse{}, api.ReleaseInventoryReservation409ApplicationProblemPlusJSONResponse{})
}
