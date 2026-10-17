package inspections

import (
	"context"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Server overlays the inspection operations of the module on a strict server of the tag Fleet: getInspectionChecklist,
// listInspections, submitInspection, getInspection, listInspectionDefects, getInspectionDefect,
// decideInspectionDefect. The other operations of the tag (reviewInspection among them) go to the base.
type Server struct {
	fleetapi.StrictServerInterface
	S *Service
}

var _ fleetapi.StrictServerInterface = Server{}

// NewServer returns the overlay on base (nil: the other operations of the tag answer 501).
func NewServer(base fleetapi.StrictServerInterface, s *Service) Server {
	if base == nil {
		base = unimplemented{}
	}
	return Server{StrictServerInterface: base, S: s}
}

// noStore is the Cache-Control of every answer of the module.
const noStore = "private, no-store"

// tenant returns the TenantContext put by the gateway; without it the tenant does not exist for the request.
func tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return tenantctx.TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	return tc, nil
}

func headers(ctx context.Context) (cacheControl, reqID *string) {
	cc, rid := noStore, requestid.FromContext(ctx)
	if rid == "" {
		return &cc, nil
	}
	return &cc, &rid
}

// page reads cursor and limit of a list; an explicit limit outside 1…200 is 400.
func page(cursor *string, limit *int) (PageQuery, error) {
	q := PageQuery{}
	if cursor != nil {
		q.Cursor = *cursor
	}
	if limit != nil {
		if *limit < 1 || *limit > maxPageLimit {
			return PageQuery{}, problem.New(problem.CodeMalformedRequest, "Размер страницы — от 1 до 200.")
		}
		q.Limit = *limit
	}
	return q, nil
}

// GetInspectionChecklist implements fleetapi.StrictServerInterface.
func (h Server) GetInspectionChecklist(ctx context.Context, r fleetapi.GetInspectionChecklistRequestObject) (fleetapi.GetInspectionChecklistResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	c, err := h.S.Checklist(ctx, tc, r.Params.VehicleId, string(r.Params.Kind))
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return fleetapi.GetInspectionChecklist200JSONResponse{Body: c,
		Headers: fleetapi.GetInspectionChecklist200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// ListInspections implements fleetapi.StrictServerInterface.
func (h Server) ListInspections(ctx context.Context, r fleetapi.ListInspectionsRequestObject) (fleetapi.ListInspectionsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	q, err := page(r.Params.Cursor, r.Params.Limit)
	if err != nil {
		return nil, err
	}
	p, err := h.S.Inspections(ctx, tc, q)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return fleetapi.ListInspections200JSONResponse{Body: p,
		Headers: fleetapi.ListInspections200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// SubmitInspection implements fleetapi.StrictServerInterface.
func (h Server) SubmitInspection(ctx context.Context, r fleetapi.SubmitInspectionRequestObject) (fleetapi.SubmitInspectionResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := h.S.Submit(ctx, tc, *r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return fleetapi.SubmitInspection201JSONResponse{Body: out, Headers: fleetapi.SubmitInspection201ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// GetInspection implements fleetapi.StrictServerInterface.
func (h Server) GetInspection(ctx context.Context, r fleetapi.GetInspectionRequestObject) (fleetapi.GetInspectionResponseObject, error) {
	out, tag, cc, rid, err := one(ctx, func(tc tenantctx.TenantContext) (fleetapi.Inspection, int64, error) {
		i, err := h.S.Inspection(ctx, tc, r.InspectionId)
		return i, i.Revision, err
	})
	if err != nil {
		return nil, err
	}
	return fleetapi.GetInspection200JSONResponse{Body: out,
		Headers: fleetapi.GetInspection200ResponseHeaders{CacheControl: cc, ETag: &tag, XRequestId: rid}}, nil
}

// ListInspectionDefects implements fleetapi.StrictServerInterface.
func (h Server) ListInspectionDefects(ctx context.Context, r fleetapi.ListInspectionDefectsRequestObject) (fleetapi.ListInspectionDefectsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	p, err := page(r.Params.Cursor, r.Params.Limit)
	if err != nil {
		return nil, err
	}
	q := DefectQuery{PageQuery: p}
	if r.Params.State != nil {
		for _, st := range *r.Params.State {
			q.States = append(q.States, string(st))
		}
	}
	q.VehicleID, q.TripID = idOr(r.Params.VehicleId), idOr(r.Params.TripId)
	out, err := h.S.Defects(ctx, tc, q)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return fleetapi.ListInspectionDefects200JSONResponse{Body: out,
		Headers: fleetapi.ListInspectionDefects200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// GetInspectionDefect implements fleetapi.StrictServerInterface.
func (h Server) GetInspectionDefect(ctx context.Context, r fleetapi.GetInspectionDefectRequestObject) (fleetapi.GetInspectionDefectResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	d, err := h.S.Defect(ctx, tc, r.DefectId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag := etag(d.Revision)
	return fleetapi.GetInspectionDefect200JSONResponse{Body: d,
		Headers: fleetapi.GetInspectionDefect200ResponseHeaders{CacheControl: cc, ETag: &tag, XRequestId: rid}}, nil
}

// DecideInspectionDefect implements fleetapi.StrictServerInterface.
func (h Server) DecideInspectionDefect(ctx context.Context, r fleetapi.DecideInspectionDefectRequestObject) (fleetapi.DecideInspectionDefectResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := h.S.Decide(ctx, tc, r.DefectId, r.Params.IfMatch, *r.Body)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := etag(out.Revision), false
	return fleetapi.DecideInspectionDefect200JSONResponse{Body: out, Headers: fleetapi.DecideInspectionDefect200ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// one reads an object of the tenant of ctx and returns it with its ETag and the headers of the answer.
func one[T any](ctx context.Context, get func(tenantctx.TenantContext) (T, int64, error)) (out T, tag string, cc, rid *string, err error) {
	tc, err := tenant(ctx)
	if err != nil {
		return out, "", nil, nil, err
	}
	out, revision, err := get(tc)
	if err != nil {
		return out, "", nil, nil, err
	}
	cc, rid = headers(ctx)
	return out, etag(revision), cc, rid, nil
}

func idOr(id *uuid.UUID) uuid.UUID {
	if id == nil {
		return uuid.Nil
	}
	return *id
}
