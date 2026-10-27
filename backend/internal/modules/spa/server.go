//nolint:dupl // one handler per operation of the generated strict interface: the same shape over the types of each operation
package spa

import (
	"context"
	"errors"
	"fmt"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	api "github.com/ortus/ortus-crm/backend/internal/api/spa"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// noStore is Cache-Control of every answer (the contract: «private, no-store»).
const noStore = "private, no-store"

// Server implements api.StrictServerInterface (the tag Spa) over the service. A RefusalError — a 422 with the field, a
// 409 with the reason or the fields that are taken — is the typed answer of the operation; any other error goes to
// problem.Write.
type Server struct{ S *Service }

var _ api.StrictServerInterface = Server{}

func cache() *string { return new(noStore) }

func rid(ctx context.Context) *string { return new(requestid.FromContext(ctx)) }

func notReplayed() *bool { return new(false) }

func tagOf(revision int64) *string { return new(etag(revision)) }

// body is the Problem of a failure with its reason and fields.
func body(ctx context.Context, f *RefusalError) api.Problem {
	p := catalog.Problems[f.Code]
	out := api.Problem{Type: problem.TypeBase + f.Code, Title: p.Title, Status: int64(p.Status), Code: api.ProblemCode(f.Code),
		Detail: new(f.Detail), RequestId: requestid.FromContext(ctx)}
	if f.Reason != "" {
		out.Reason = new(f.Reason)
	}
	var violations []api.ProblemViolation
	if f.Field != "" {
		violations = append(violations, api.ProblemViolation{Field: f.Field, Code: "invalid", Message: f.Detail})
	}
	for _, field := range f.Fields {
		violations = append(violations, api.ProblemViolation{Field: field, Code: "unavailable", Message: f.Detail})
	}
	if violations != nil {
		out.Violations = &violations
	}
	if f.Code == codeUnavailable {
		out.Retryable = new(true)
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
func answerOf[R any](v any) (R, error) {
	r, ok := v.(R)
	if !ok {
		var zero R
		return zero, fmt.Errorf("spa: an answer of another operation: %T", v) // the types of the call site are wrong: a programming error
	}
	return r, nil
}

// reply is the answer of a command: ok when err is nil, the typed 422 (V) or 409 (C) of a failure, err otherwise.
func reply[R any, V invalidOf, C conflictOf](ctx context.Context, err error, ok R, _ V, _ C) (R, error) {
	f, failed := errors.AsType[*RefusalError](err)
	switch {
	case failed && f.Code == codeValidation:
		return answerOf[R](V{api.ValidationApplicationProblemPlusJSONResponse{Body: body(ctx, f),
			Headers: api.ValidationResponseHeaders{XRequestId: rid(ctx)}}})
	case failed:
		return answerOf[R](C{api.ConflictApplicationProblemPlusJSONResponse{Body: body(ctx, f),
			Headers: api.ConflictResponseHeaders{XRequestId: rid(ctx)}}})
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

// ListSpaServices implements api.StrictServerInterface.
func (s Server) ListSpaServices(ctx context.Context, r api.ListSpaServicesRequestObject) (api.ListSpaServicesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	page, err := s.S.ListServices(ctx, tc, queryOf(r.Params.Cursor, r.Params.Limit))
	if err != nil {
		return nil, err
	}
	return api.ListSpaServices200JSONResponse{Body: page, Headers: api.ListSpaServices200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}, nil
}

// CreateSpaService implements api.StrictServerInterface.
func (s Server) CreateSpaService(ctx context.Context, r api.CreateSpaServiceRequestObject) (api.CreateSpaServiceResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := s.S.CreateService(ctx, tc, *r.Body)
	var ok api.CreateSpaServiceResponseObject = api.CreateSpaService201JSONResponse{Body: out, Headers: api.CreateSpaService201ResponseHeaders{
		CacheControl: cache(), ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, api.CreateSpaService422ApplicationProblemPlusJSONResponse{}, api.CreateSpaService409ApplicationProblemPlusJSONResponse{})
}

// GetSpaService implements api.StrictServerInterface.
func (s Server) GetSpaService(ctx context.Context, r api.GetSpaServiceRequestObject) (api.GetSpaServiceResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.GetService(ctx, tc, r.ServiceId)
	if err != nil {
		return nil, err
	}
	return api.GetSpaService200JSONResponse{Body: out, Headers: api.GetSpaService200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision), XRequestId: rid(ctx)}}, nil
}

// UpdateSpaService implements api.StrictServerInterface.
func (s Server) UpdateSpaService(ctx context.Context, r api.UpdateSpaServiceRequestObject) (api.UpdateSpaServiceResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := s.S.UpdateService(ctx, tc, r.ServiceId, r.Params.IfMatch, *r.Body)
	var ok api.UpdateSpaServiceResponseObject = api.UpdateSpaService200JSONResponse{Body: out, Headers: api.UpdateSpaService200ResponseHeaders{
		CacheControl: cache(), ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, api.UpdateSpaService422ApplicationProblemPlusJSONResponse{}, api.UpdateSpaService409ApplicationProblemPlusJSONResponse{})
}

// ListAppointments implements api.StrictServerInterface.
func (s Server) ListAppointments(ctx context.Context, r api.ListAppointmentsRequestObject) (api.ListAppointmentsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	q := AppointmentQuery{PageQuery: queryOf(r.Params.Cursor, r.Params.Limit), From: r.Params.From, To: r.Params.To, Practitioner: r.Params.PractitionerMemberId}
	if r.Params.Status != nil {
		q.Status = string(*r.Params.Status)
	}
	page, err := s.S.ListAppointments(ctx, tc, q)
	var ok api.ListAppointmentsResponseObject = api.ListAppointments200JSONResponse{Body: page, Headers: api.ListAppointments200ResponseHeaders{
		CacheControl: cache(), XRequestId: rid(ctx)}}
	return replyList(ctx, err, ok)
}

// replyList answers a list that can refuse a filter: a 422 with the field.
func replyList(ctx context.Context, err error, ok api.ListAppointmentsResponseObject) (api.ListAppointmentsResponseObject, error) {
	if f, failed := errors.AsType[*RefusalError](err); failed && f.Code == codeValidation {
		return api.ListAppointments422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: api.ValidationApplicationProblemPlusJSONResponse{
			Body: body(ctx, f), Headers: api.ValidationResponseHeaders{XRequestId: rid(ctx)}}}, nil
	}
	if err != nil {
		return nil, err
	}
	return ok, nil
}

// CreateAppointment implements api.StrictServerInterface.
func (s Server) CreateAppointment(ctx context.Context, r api.CreateAppointmentRequestObject) (api.CreateAppointmentResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := s.S.CreateAppointment(ctx, tc, *r.Body)
	var ok api.CreateAppointmentResponseObject = api.CreateAppointment201JSONResponse{Body: out, Headers: api.CreateAppointment201ResponseHeaders{
		CacheControl: cache(), ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, api.CreateAppointment422ApplicationProblemPlusJSONResponse{}, api.CreateAppointment409ApplicationProblemPlusJSONResponse{})
}

// GetAppointment implements api.StrictServerInterface.
func (s Server) GetAppointment(ctx context.Context, r api.GetAppointmentRequestObject) (api.GetAppointmentResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.GetAppointment(ctx, tc, r.AppointmentId)
	if err != nil {
		return nil, err
	}
	return api.GetAppointment200JSONResponse{Body: out, Headers: api.GetAppointment200ResponseHeaders{CacheControl: cache(), ETag: tagOf(out.Revision), XRequestId: rid(ctx)}}, nil
}

// CancelAppointment implements api.StrictServerInterface.
func (s Server) CancelAppointment(ctx context.Context, r api.CancelAppointmentRequestObject) (api.CancelAppointmentResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := s.S.Cancel(ctx, tc, r.AppointmentId, r.Params.IfMatch, *r.Body)
	var ok api.CancelAppointmentResponseObject = api.CancelAppointment200JSONResponse{Body: out, Headers: api.CancelAppointment200ResponseHeaders{
		CacheControl: cache(), ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, api.CancelAppointment422ApplicationProblemPlusJSONResponse{}, api.CancelAppointment409ApplicationProblemPlusJSONResponse{})
}

// RescheduleAppointment implements api.StrictServerInterface.
func (s Server) RescheduleAppointment(ctx context.Context, r api.RescheduleAppointmentRequestObject) (api.RescheduleAppointmentResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := s.S.Reschedule(ctx, tc, r.AppointmentId, r.Params.IfMatch, *r.Body)
	var ok api.RescheduleAppointmentResponseObject = api.RescheduleAppointment200JSONResponse{Body: out, Headers: api.RescheduleAppointment200ResponseHeaders{
		CacheControl: cache(), ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, api.RescheduleAppointment422ApplicationProblemPlusJSONResponse{}, api.RescheduleAppointment409ApplicationProblemPlusJSONResponse{})
}

// RecordAppointmentPerformance implements api.StrictServerInterface.
func (s Server) RecordAppointmentPerformance(ctx context.Context, r api.RecordAppointmentPerformanceRequestObject) (api.RecordAppointmentPerformanceResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := s.S.RecordPerformance(ctx, tc, r.AppointmentId, r.Params.IfMatch, *r.Body)
	var ok api.RecordAppointmentPerformanceResponseObject = api.RecordAppointmentPerformance200JSONResponse{Body: out, Headers: api.RecordAppointmentPerformance200ResponseHeaders{
		CacheControl: cache(), ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, api.RecordAppointmentPerformance422ApplicationProblemPlusJSONResponse{}, api.RecordAppointmentPerformance409ApplicationProblemPlusJSONResponse{})
}

// CompleteAppointment implements api.StrictServerInterface.
func (s Server) CompleteAppointment(ctx context.Context, r api.CompleteAppointmentRequestObject) (api.CompleteAppointmentResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	out, err := s.S.Complete(ctx, tc, r.AppointmentId, r.Params.IfMatch, *r.Body)
	var ok api.CompleteAppointmentResponseObject = api.CompleteAppointment200JSONResponse{Body: out, Headers: api.CompleteAppointment200ResponseHeaders{
		CacheControl: cache(), ETag: tagOf(out.Appointment.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	return reply(ctx, err, ok, api.CompleteAppointment422ApplicationProblemPlusJSONResponse{}, api.CompleteAppointment409ApplicationProblemPlusJSONResponse{})
}
