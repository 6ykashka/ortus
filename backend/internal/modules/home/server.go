package home

import (
	"context"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

// Server implements the tag Home over Service.
type Server struct{ S *Service }

var _ homeapi.StrictServerInterface = Server{}

// noStore is the Cache-Control of the answer (the queue is personal).
const noStore = "private, no-store"

// GetMyDecisionQueue implements homeapi.StrictServerInterface: the account comes from the session the gateway
// admitted (x-scope identity), the tenant from the query.
func (h Server) GetMyDecisionQueue(ctx context.Context, r homeapi.GetMyDecisionQueueRequestObject) (homeapi.GetMyDecisionQueueResponseObject, error) {
	sess, ok := session.FromContext(ctx)
	if !ok {
		return nil, problem.New(problem.CodeSessionExpired, "")
	}
	limit := DefaultLimit
	if r.Params.Limit != nil {
		limit = *r.Params.Limit
	}
	q, err := h.S.Queue(ctx, sess.AccountID, r.Params.TenantId, limit)
	if err != nil {
		return nil, err
	}
	cc := noStore
	headers := homeapi.GetMyDecisionQueue200ResponseHeaders{CacheControl: &cc}
	if rid := requestid.FromContext(ctx); rid != "" {
		headers.XRequestId = &rid
	}
	return homeapi.GetMyDecisionQueue200JSONResponse{Body: q, Headers: headers}, nil
}
