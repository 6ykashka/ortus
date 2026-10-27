//nolint:dupl // one handler per operation of the generated strict interface: the same shape over the types of each operation
package repairs

import (
	"context"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// noStore is Cache-Control of every answer (the contract: «private, no-store»).
const noStore = "private, no-store"

// Server answers the operations of steps 6.1–6.2 of the tag Repairs over the service: the objects, the foreman, the
// works and the marks (W6.11). The other operations of the tag are served by the later steps of stage 6 (cmd/api
// answers them 501 until then). A failure (a 422 with violations, a 409 with a reason) is the typed answer of the
// operation; any other error goes to problem.Write.
type Server struct{ S *Service }

// in is the tenant of the request and its body (a missing body is malformed_request).
func in[T any](ctx context.Context, b *T) (tenantctx.TenantContext, T, error) {
	var zero T
	tc, ok := tenantctx.FromContext(ctx)
	switch {
	case !ok:
		return tc, zero, problem.New(codeNotFound, "")
	case b == nil:
		return tc, zero, problem.New(problem.CodeMalformedRequest, "")
	}
	return tc, *b, nil
}

// tenant is the tenant of a request without a body.
func tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, _, err := in(ctx, &struct{}{})
	return tc, err
}

func cache() *string { return new(noStore) }

func rid(ctx context.Context) *string { return new(requestid.FromContext(ctx)) }

func notReplayed() *bool { return new(false) }

func tagOf(revision int64) *string { return new(etag(revision)) }

// body is the Problem of a failure with its reason and violations.
func body(ctx context.Context, f *failure) rapi.Problem {
	p := catalog.Problems[f.code]
	out := rapi.Problem{Type: problem.TypeBase + f.code, Title: p.Title, Status: int64(p.Status), Code: rapi.ProblemCode(f.code),
		Detail: new(f.detail), RequestId: requestid.FromContext(ctx)}
	if f.reason != "" {
		out.Reason = new(f.reason)
	}
	if len(f.violations) > 0 {
		vs := make([]rapi.ProblemViolation, 0, len(f.violations))
		for _, v := range f.violations {
			vs = append(vs, rapi.ProblemViolation{Field: v.field, Code: v.code, Message: v.message})
		}
		out.Violations = &vs
	}
	return out
}

type (
	invalidOf interface {
		~struct {
			rapi.ValidationApplicationProblemPlusJSONResponse
		}
	}
	conflictOf interface {
		~struct {
			rapi.ConflictApplicationProblemPlusJSONResponse
		}
	}
)

// answerOf converts an answer to the response object R of its operation.
func answerOf[R any](v any) R {
	r, ok := v.(R)
	if !ok {
		panic("repairs: an answer of another operation") // the types of the call site are wrong: a programming error
	}
	return r
}

func invalidReply(ctx context.Context, f *failure) rapi.ValidationApplicationProblemPlusJSONResponse {
	return rapi.ValidationApplicationProblemPlusJSONResponse{Body: body(ctx, f), Headers: rapi.ValidationResponseHeaders{XRequestId: rid(ctx)}}
}

func conflictReply(ctx context.Context, f *failure) rapi.ConflictApplicationProblemPlusJSONResponse {
	return rapi.ConflictApplicationProblemPlusJSONResponse{Body: body(ctx, f), Headers: rapi.ConflictResponseHeaders{XRequestId: rid(ctx)}}
}

// reply is the answer of an operation with a 422 and a 409: ok when err is nil, the typed 422 (V) or 409 (C) of a
// failure, err otherwise.
func reply[R any, V invalidOf, C conflictOf](ctx context.Context, err error, ok func() R, _ V, _ C) (R, error) {
	f, failed := asFailure(err)
	switch {
	case failed && f.code == codeValidation:
		return answerOf[R](V{invalidReply(ctx, f)}), nil
	case failed:
		return answerOf[R](C{conflictReply(ctx, f)}), nil
	case err != nil:
		var zero R
		return zero, err
	}
	return ok(), nil
}

// read is the answer of an operation with a 422 only.
func read[R any, V invalidOf](ctx context.Context, err error, ok func() R, _ V) (R, error) {
	if f, failed := asFailure(err); failed {
		if f.code == codeValidation {
			return answerOf[R](V{invalidReply(ctx, f)}), nil
		}
		return *new(R), problem.New(f.code, f.detail)
	}
	if err != nil {
		var zero R
		return zero, err
	}
	return ok(), nil
}

// ListRepairProjects implements rapi.StrictServerInterface.
func (s Server) ListRepairProjects(ctx context.Context, req rapi.ListRepairProjectsRequestObject) (rapi.ListRepairProjectsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	p := req.Params
	q := ListQuery{Q: p.Q, Cursor: p.Cursor, Limit: p.Limit}
	if p.Filter != nil {
		q.Filter = new(string(*p.Filter))
	}
	out, err := s.S.Projects(ctx, tc, q)
	return read(ctx, err, func() rapi.ListRepairProjectsResponseObject {
		return rapi.ListRepairProjects200JSONResponse{Body: out, Headers: rapi.ListRepairProjects200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.ListRepairProjects422ApplicationProblemPlusJSONResponse{})
}

// CreateRepairProject implements rapi.StrictServerInterface.
func (s Server) CreateRepairProject(ctx context.Context, req rapi.CreateRepairProjectRequestObject) (rapi.CreateRepairProjectResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CreateProject(ctx, tc, b)
	return reply(ctx, err, func() rapi.CreateRepairProjectResponseObject {
		return rapi.CreateRepairProject201JSONResponse{Body: out, Headers: rapi.CreateRepairProject201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.CreateRepairProject422ApplicationProblemPlusJSONResponse{}, rapi.CreateRepairProject409ApplicationProblemPlusJSONResponse{})
}

// GetRepairProject implements rapi.StrictServerInterface.
func (s Server) GetRepairProject(ctx context.Context, req rapi.GetRepairProjectRequestObject) (rapi.GetRepairProjectResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Project(ctx, tc, req.ProjectId)
	return read(ctx, err, func() rapi.GetRepairProjectResponseObject {
		return rapi.GetRepairProject200JSONResponse{Body: out, Headers: rapi.GetRepairProject200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), XRequestId: rid(ctx)}}
	}, rapi.GetRepairProject422ApplicationProblemPlusJSONResponse{})
}

// UpdateRepairProject implements rapi.StrictServerInterface.
func (s Server) UpdateRepairProject(ctx context.Context, req rapi.UpdateRepairProjectRequestObject) (rapi.UpdateRepairProjectResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.UpdateProject(ctx, tc, req.ProjectId, req.Params.IfMatch, b)
	return reply(ctx, err, func() rapi.UpdateRepairProjectResponseObject {
		return rapi.UpdateRepairProject200JSONResponse{Body: out, Headers: rapi.UpdateRepairProject200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.UpdateRepairProject422ApplicationProblemPlusJSONResponse{}, rapi.UpdateRepairProject409ApplicationProblemPlusJSONResponse{})
}

// GetRepairProjectOverview implements rapi.StrictServerInterface.
func (s Server) GetRepairProjectOverview(ctx context.Context, req rapi.GetRepairProjectOverviewRequestObject) (rapi.GetRepairProjectOverviewResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Overview(ctx, tc, req.ProjectId)
	return read(ctx, err, func() rapi.GetRepairProjectOverviewResponseObject {
		return rapi.GetRepairProjectOverview200JSONResponse{Body: out, Headers: rapi.GetRepairProjectOverview200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.GetRepairProjectOverview422ApplicationProblemPlusJSONResponse{})
}

// AssignRepairForeman implements rapi.StrictServerInterface.
func (s Server) AssignRepairForeman(ctx context.Context, req rapi.AssignRepairForemanRequestObject) (rapi.AssignRepairForemanResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.AssignForeman(ctx, tc, req.ProjectId, b.ForemanMemberId)
	return reply(ctx, err, func() rapi.AssignRepairForemanResponseObject {
		return rapi.AssignRepairForeman200JSONResponse{Body: out, Headers: rapi.AssignRepairForeman200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.AssignRepairForeman422ApplicationProblemPlusJSONResponse{}, rapi.AssignRepairForeman409ApplicationProblemPlusJSONResponse{})
}

// ActivateRepairProject implements rapi.StrictServerInterface.
func (s Server) ActivateRepairProject(ctx context.Context, req rapi.ActivateRepairProjectRequestObject) (rapi.ActivateRepairProjectResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Activate(ctx, tc, req.ProjectId, req.Params.IfMatch)
	return reply(ctx, err, func() rapi.ActivateRepairProjectResponseObject {
		return rapi.ActivateRepairProject200JSONResponse{Body: out, Headers: rapi.ActivateRepairProject200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.ActivateRepairProject422ApplicationProblemPlusJSONResponse{}, rapi.ActivateRepairProject409ApplicationProblemPlusJSONResponse{})
}

// HandOverRepairProject implements rapi.StrictServerInterface.
func (s Server) HandOverRepairProject(ctx context.Context, req rapi.HandOverRepairProjectRequestObject) (rapi.HandOverRepairProjectResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.HandOver(ctx, tc, req.ProjectId, req.Params.IfMatch, b)
	return reply(ctx, err, func() rapi.HandOverRepairProjectResponseObject {
		return rapi.HandOverRepairProject200JSONResponse{Body: out, Headers: rapi.HandOverRepairProject200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.HandOverRepairProject422ApplicationProblemPlusJSONResponse{}, rapi.HandOverRepairProject409ApplicationProblemPlusJSONResponse{})
}

// ListRepairWorks implements rapi.StrictServerInterface.
func (s Server) ListRepairWorks(ctx context.Context, req rapi.ListRepairWorksRequestObject) (rapi.ListRepairWorksResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Works(ctx, tc, req.ProjectId)
	return read(ctx, err, func() rapi.ListRepairWorksResponseObject {
		return rapi.ListRepairWorks200JSONResponse{Body: out, Headers: rapi.ListRepairWorks200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.ListRepairWorks422ApplicationProblemPlusJSONResponse{})
}

// ListWorkLogs implements rapi.StrictServerInterface.
func (s Server) ListWorkLogs(ctx context.Context, req rapi.ListWorkLogsRequestObject) (rapi.ListWorkLogsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	p := req.Params
	q := LogQuery{Project: p.ProjectId, Cursor: p.Cursor, Limit: p.Limit}
	if p.Status != nil {
		q.Status = new(string(*p.Status))
	}
	out, err := s.S.WorkLogs(ctx, tc, q)
	return read(ctx, err, func() rapi.ListWorkLogsResponseObject {
		return rapi.ListWorkLogs200JSONResponse{Body: out, Headers: rapi.ListWorkLogs200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, rapi.ListWorkLogs422ApplicationProblemPlusJSONResponse{})
}

// SubmitWorkLog implements rapi.StrictServerInterface.
func (s Server) SubmitWorkLog(ctx context.Context, req rapi.SubmitWorkLogRequestObject) (rapi.SubmitWorkLogResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.SubmitWorkLog(ctx, tc, b)
	return reply(ctx, err, func() rapi.SubmitWorkLogResponseObject {
		return rapi.SubmitWorkLog201JSONResponse{Body: out, Headers: rapi.SubmitWorkLog201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.SubmitWorkLog422ApplicationProblemPlusJSONResponse{}, rapi.SubmitWorkLog409ApplicationProblemPlusJSONResponse{})
}

// AcceptWorkLog implements rapi.StrictServerInterface.
func (s Server) AcceptWorkLog(ctx context.Context, req rapi.AcceptWorkLogRequestObject) (rapi.AcceptWorkLogResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.AcceptWorkLog(ctx, tc, req.WorkLogId, req.Params.IfMatch)
	return reply(ctx, err, func() rapi.AcceptWorkLogResponseObject {
		return rapi.AcceptWorkLog200JSONResponse{Body: out, Headers: rapi.AcceptWorkLog200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.AcceptWorkLog422ApplicationProblemPlusJSONResponse{}, rapi.AcceptWorkLog409ApplicationProblemPlusJSONResponse{})
}

// ReturnWorkLog implements rapi.StrictServerInterface.
func (s Server) ReturnWorkLog(ctx context.Context, req rapi.ReturnWorkLogRequestObject) (rapi.ReturnWorkLogResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.ReturnWorkLog(ctx, tc, req.WorkLogId, req.Params.IfMatch, b.Reason)
	return reply(ctx, err, func() rapi.ReturnWorkLogResponseObject {
		return rapi.ReturnWorkLog200JSONResponse{Body: out, Headers: rapi.ReturnWorkLog200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, rapi.ReturnWorkLog422ApplicationProblemPlusJSONResponse{}, rapi.ReturnWorkLog409ApplicationProblemPlusJSONResponse{})
}
