//nolint:dupl // one handler per operation of the generated strict interface: the same shape over the types of each operation
package forms

import (
	"context"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// noStore is Cache-Control of every answer (the contract: «private, no-store»).
const noStore = "private, no-store"

// Server implements fapi.StrictServerInterface over the service. A failure (a 422 with violations, a 409 with a
// reason) is the typed answer of the operation; any other error goes to problem.Write.
type Server struct{ S *Service }

var _ fapi.StrictServerInterface = Server{}

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
func body(ctx context.Context, f *failure) fapi.Problem {
	p := catalog.Problems[f.code]
	out := fapi.Problem{Type: problem.TypeBase + f.code, Title: p.Title, Status: int64(p.Status), Code: fapi.ProblemCode(f.code),
		Detail: new(f.detail), RequestId: requestid.FromContext(ctx)}
	if f.reason != "" {
		out.Reason = new(f.reason)
	}
	if len(f.violations) > 0 {
		vs := make([]fapi.ProblemViolation, 0, len(f.violations))
		for _, v := range f.violations {
			vs = append(vs, fapi.ProblemViolation{Field: v.field, Code: v.code, Message: v.message})
		}
		out.Violations = &vs
	}
	return out
}

type (
	invalidOf interface {
		~struct {
			fapi.ValidationApplicationProblemPlusJSONResponse
		}
	}
	conflictOf interface {
		~struct {
			fapi.ConflictApplicationProblemPlusJSONResponse
		}
	}
)

// answerOf converts an answer to the response object R of its operation.
func answerOf[R any](v any) R {
	r, ok := v.(R)
	if !ok {
		panic("forms: an answer of another operation") // the types of the call site are wrong: a programming error
	}
	return r
}

func invalidReply(ctx context.Context, f *failure) fapi.ValidationApplicationProblemPlusJSONResponse {
	return fapi.ValidationApplicationProblemPlusJSONResponse{Body: body(ctx, f), Headers: fapi.ValidationResponseHeaders{XRequestId: rid(ctx)}}
}

func conflictReply(ctx context.Context, f *failure) fapi.ConflictApplicationProblemPlusJSONResponse {
	return fapi.ConflictApplicationProblemPlusJSONResponse{Body: body(ctx, f), Headers: fapi.ConflictResponseHeaders{XRequestId: rid(ctx)}}
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

// ListForms implements fapi.StrictServerInterface.
func (s Server) ListForms(ctx context.Context, req fapi.ListFormsRequestObject) (fapi.ListFormsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	p := req.Params
	q := ListQuery{Q: p.Q, OwnerMe: p.Owner != nil && *p.Owner == fapi.Me, Group: p.GroupId, Cursor: p.Cursor, Limit: p.Limit}
	if p.Status != nil {
		q.Status = new(string(*p.Status))
	}
	out, err := s.S.Forms(ctx, tc, q)
	return read(ctx, err, func() fapi.ListFormsResponseObject {
		return fapi.ListForms200JSONResponse{Body: out, Headers: fapi.ListForms200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, fapi.ListForms422ApplicationProblemPlusJSONResponse{})
}

// CreateForm implements fapi.StrictServerInterface.
func (s Server) CreateForm(ctx context.Context, req fapi.CreateFormRequestObject) (fapi.CreateFormResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CreateForm(ctx, tc, b)
	return reply(ctx, err, func() fapi.CreateFormResponseObject {
		return fapi.CreateForm201JSONResponse{Body: out, Headers: fapi.CreateForm201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, fapi.CreateForm422ApplicationProblemPlusJSONResponse{}, fapi.CreateForm409ApplicationProblemPlusJSONResponse{})
}

// GetForm implements fapi.StrictServerInterface.
func (s Server) GetForm(ctx context.Context, req fapi.GetFormRequestObject) (fapi.GetFormResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Form(ctx, tc, req.FormId)
	return read(ctx, err, func() fapi.GetFormResponseObject {
		return fapi.GetForm200JSONResponse{Body: out, Headers: fapi.GetForm200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), XRequestId: rid(ctx)}}
	}, fapi.GetForm422ApplicationProblemPlusJSONResponse{})
}

// UpdateForm implements fapi.StrictServerInterface.
func (s Server) UpdateForm(ctx context.Context, req fapi.UpdateFormRequestObject) (fapi.UpdateFormResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.UpdateForm(ctx, tc, req.FormId, req.Params.IfMatch, b, NullsFrom(ctx))
	return reply(ctx, err, func() fapi.UpdateFormResponseObject {
		return fapi.UpdateForm200JSONResponse{Body: out, Headers: fapi.UpdateForm200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, fapi.UpdateForm422ApplicationProblemPlusJSONResponse{}, fapi.UpdateForm409ApplicationProblemPlusJSONResponse{})
}

// GetFormDraft implements fapi.StrictServerInterface.
func (s Server) GetFormDraft(ctx context.Context, req fapi.GetFormDraftRequestObject) (fapi.GetFormDraftResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Draft(ctx, tc, req.FormId)
	return read(ctx, err, func() fapi.GetFormDraftResponseObject {
		return fapi.GetFormDraft200JSONResponse{Body: out, Headers: fapi.GetFormDraft200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), XRequestId: rid(ctx)}}
	}, fapi.GetFormDraft422ApplicationProblemPlusJSONResponse{})
}

// SaveFormDraft implements fapi.StrictServerInterface.
func (s Server) SaveFormDraft(ctx context.Context, req fapi.SaveFormDraftRequestObject) (fapi.SaveFormDraftResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.SaveDraft(ctx, tc, req.FormId, req.Params.IfMatch, b)
	return reply(ctx, err, func() fapi.SaveFormDraftResponseObject {
		return fapi.SaveFormDraft200JSONResponse{Body: out, Headers: fapi.SaveFormDraft200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, fapi.SaveFormDraft422ApplicationProblemPlusJSONResponse{}, fapi.SaveFormDraft409ApplicationProblemPlusJSONResponse{})
}

// DiscardFormDraft implements fapi.StrictServerInterface.
func (s Server) DiscardFormDraft(ctx context.Context, req fapi.DiscardFormDraftRequestObject) (fapi.DiscardFormDraftResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.DiscardDraft(ctx, tc, req.FormId, req.Params.IfMatch)
	return reply(ctx, err, func() fapi.DiscardFormDraftResponseObject {
		return fapi.DiscardFormDraft200JSONResponse{Body: out, Headers: fapi.DiscardFormDraft200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, fapi.DiscardFormDraft422ApplicationProblemPlusJSONResponse{}, fapi.DiscardFormDraft409ApplicationProblemPlusJSONResponse{})
}

// PublishForm implements fapi.StrictServerInterface.
func (s Server) PublishForm(ctx context.Context, req fapi.PublishFormRequestObject) (fapi.PublishFormResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Publish(ctx, tc, req.FormId, req.Params.IfMatch, b)
	return reply(ctx, err, func() fapi.PublishFormResponseObject {
		return fapi.PublishForm200JSONResponse{Body: out, Headers: fapi.PublishForm200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, fapi.PublishForm422ApplicationProblemPlusJSONResponse{}, fapi.PublishForm409ApplicationProblemPlusJSONResponse{})
}

// ListFormVersions implements fapi.StrictServerInterface.
func (s Server) ListFormVersions(ctx context.Context, req fapi.ListFormVersionsRequestObject) (fapi.ListFormVersionsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Versions(ctx, tc, req.FormId, req.Params.Cursor, req.Params.Limit)
	return read(ctx, err, func() fapi.ListFormVersionsResponseObject {
		return fapi.ListFormVersions200JSONResponse{Body: out, Headers: fapi.ListFormVersions200ResponseHeaders{CacheControl: cache(),
			XRequestId: rid(ctx)}}
	}, fapi.ListFormVersions422ApplicationProblemPlusJSONResponse{})
}

// CreateFormVersion implements fapi.StrictServerInterface (deprecated: 409 form_draft_flow).
func (s Server) CreateFormVersion(ctx context.Context, req fapi.CreateFormVersionRequestObject) (fapi.CreateFormVersionResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	err = s.S.DraftFlow(ctx, tc, req.FormId)
	return reply(ctx, err, func() fapi.CreateFormVersionResponseObject { return nil },
		fapi.CreateFormVersion422ApplicationProblemPlusJSONResponse{}, fapi.CreateFormVersion409ApplicationProblemPlusJSONResponse{})
}

// PublishFormVersion implements fapi.StrictServerInterface (deprecated: 409 form_draft_flow).
func (s Server) PublishFormVersion(ctx context.Context, req fapi.PublishFormVersionRequestObject) (fapi.PublishFormVersionResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	err = s.S.DraftFlow(ctx, tc, req.FormId)
	return reply(ctx, err, func() fapi.PublishFormVersionResponseObject { return nil },
		fapi.PublishFormVersion422ApplicationProblemPlusJSONResponse{}, fapi.PublishFormVersion409ApplicationProblemPlusJSONResponse{})
}

// ListFormRules implements fapi.StrictServerInterface.
func (s Server) ListFormRules(ctx context.Context, req fapi.ListFormRulesRequestObject) (fapi.ListFormRulesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Rules(ctx, tc, req.FormId)
	return read(ctx, err, func() fapi.ListFormRulesResponseObject {
		return fapi.ListFormRules200JSONResponse{Body: out, Headers: fapi.ListFormRules200ResponseHeaders{CacheControl: cache(), XRequestId: rid(ctx)}}
	}, fapi.ListFormRules422ApplicationProblemPlusJSONResponse{})
}

// CreateFormRule implements fapi.StrictServerInterface.
func (s Server) CreateFormRule(ctx context.Context, req fapi.CreateFormRuleRequestObject) (fapi.CreateFormRuleResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CreateRule(ctx, tc, req.FormId, b)
	return reply(ctx, err, func() fapi.CreateFormRuleResponseObject {
		return fapi.CreateFormRule201JSONResponse{Body: out, Headers: fapi.CreateFormRule201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, fapi.CreateFormRule422ApplicationProblemPlusJSONResponse{}, fapi.CreateFormRule409ApplicationProblemPlusJSONResponse{})
}

// UpdateFormRule implements fapi.StrictServerInterface.
func (s Server) UpdateFormRule(ctx context.Context, req fapi.UpdateFormRuleRequestObject) (fapi.UpdateFormRuleResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.UpdateRule(ctx, tc, req.FormId, req.RuleId, req.Params.IfMatch, b)
	return reply(ctx, err, func() fapi.UpdateFormRuleResponseObject {
		return fapi.UpdateFormRule200JSONResponse{Body: out, Headers: fapi.UpdateFormRule200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, fapi.UpdateFormRule422ApplicationProblemPlusJSONResponse{}, fapi.UpdateFormRule409ApplicationProblemPlusJSONResponse{})
}

// DeleteFormRule implements fapi.StrictServerInterface.
func (s Server) DeleteFormRule(ctx context.Context, req fapi.DeleteFormRuleRequestObject) (fapi.DeleteFormRuleResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	err = s.S.DeleteRule(ctx, tc, req.FormId, req.RuleId, req.Params.IfMatch)
	return reply(ctx, err, func() fapi.DeleteFormRuleResponseObject {
		return fapi.DeleteFormRule204Response{Headers: fapi.DeleteFormRule204ResponseHeaders{CacheControl: cache(),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, fapi.DeleteFormRule422ApplicationProblemPlusJSONResponse{}, fapi.DeleteFormRule409ApplicationProblemPlusJSONResponse{})
}

// BackfillFormRule implements fapi.StrictServerInterface.
func (s Server) BackfillFormRule(ctx context.Context, req fapi.BackfillFormRuleRequestObject) (fapi.BackfillFormRuleResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Backfill(ctx, tc, req.FormId, req.RuleId)
	return reply(ctx, err, func() fapi.BackfillFormRuleResponseObject {
		return fapi.BackfillFormRule200JSONResponse{Body: out, Headers: fapi.BackfillFormRule200ResponseHeaders{CacheControl: cache(),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, fapi.BackfillFormRule422ApplicationProblemPlusJSONResponse{}, fapi.BackfillFormRule409ApplicationProblemPlusJSONResponse{})
}

// ListFormResponses implements fapi.StrictServerInterface.
func (s Server) ListFormResponses(ctx context.Context, req fapi.ListFormResponsesRequestObject) (fapi.ListFormResponsesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Responses(ctx, tc, req.FormId, req.Params.Cursor, req.Params.Limit)
	return read(ctx, err, func() fapi.ListFormResponsesResponseObject {
		return fapi.ListFormResponses200JSONResponse{Body: out, Headers: fapi.ListFormResponses200ResponseHeaders{CacheControl: cache(),
			XRequestId: rid(ctx)}}
	}, fapi.ListFormResponses422ApplicationProblemPlusJSONResponse{})
}

// SubmitFormResponse implements fapi.StrictServerInterface.
func (s Server) SubmitFormResponse(ctx context.Context, req fapi.SubmitFormResponseRequestObject) (fapi.SubmitFormResponseResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Submit(ctx, tc, req.FormId, b)
	return reply(ctx, err, func() fapi.SubmitFormResponseResponseObject {
		return fapi.SubmitFormResponse201JSONResponse{Body: out, Headers: fapi.SubmitFormResponse201ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, fapi.SubmitFormResponse422ApplicationProblemPlusJSONResponse{}, fapi.SubmitFormResponse409ApplicationProblemPlusJSONResponse{})
}

// GetFormResponse implements fapi.StrictServerInterface.
func (s Server) GetFormResponse(ctx context.Context, req fapi.GetFormResponseRequestObject) (fapi.GetFormResponseResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Response(ctx, tc, req.FormId, req.ResponseId)
	return read(ctx, err, func() fapi.GetFormResponseResponseObject {
		return fapi.GetFormResponse200JSONResponse{Body: out, Headers: fapi.GetFormResponse200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), XRequestId: rid(ctx)}}
	}, fapi.GetFormResponse422ApplicationProblemPlusJSONResponse{})
}

// ReviewFormResponse implements fapi.StrictServerInterface.
func (s Server) ReviewFormResponse(ctx context.Context, req fapi.ReviewFormResponseRequestObject) (fapi.ReviewFormResponseResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Review(ctx, tc, req.FormId, req.ResponseId, req.Params.IfMatch, b, NullsFrom(ctx))
	return reply(ctx, err, func() fapi.ReviewFormResponseResponseObject {
		return fapi.ReviewFormResponse200JSONResponse{Body: out, Headers: fapi.ReviewFormResponse200ResponseHeaders{CacheControl: cache(),
			ETag: tagOf(out.Revision), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, fapi.ReviewFormResponse422ApplicationProblemPlusJSONResponse{}, fapi.ReviewFormResponse409ApplicationProblemPlusJSONResponse{})
}

// RetryFormResponseAction implements fapi.StrictServerInterface.
func (s Server) RetryFormResponseAction(ctx context.Context, req fapi.RetryFormResponseActionRequestObject) (fapi.RetryFormResponseActionResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Retry(ctx, tc, req.FormId, req.ResponseId, req.RuleId)
	return reply(ctx, err, func() fapi.RetryFormResponseActionResponseObject {
		return fapi.RetryFormResponseAction200JSONResponse{Body: out, Headers: fapi.RetryFormResponseAction200ResponseHeaders{
			CacheControl: cache(), IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, fapi.RetryFormResponseAction422ApplicationProblemPlusJSONResponse{}, fapi.RetryFormResponseAction409ApplicationProblemPlusJSONResponse{})
}

// GetFormResponseSummary implements fapi.StrictServerInterface.
func (s Server) GetFormResponseSummary(ctx context.Context, req fapi.GetFormResponseSummaryRequestObject) (fapi.GetFormResponseSummaryResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Summary(ctx, tc, req.FormId)
	return read(ctx, err, func() fapi.GetFormResponseSummaryResponseObject {
		return fapi.GetFormResponseSummary200JSONResponse{Body: out, Headers: fapi.GetFormResponseSummary200ResponseHeaders{
			CacheControl: cache(), XRequestId: rid(ctx)}}
	}, fapi.GetFormResponseSummary422ApplicationProblemPlusJSONResponse{})
}

// ExportFormResponses implements fapi.StrictServerInterface.
func (s Server) ExportFormResponses(ctx context.Context, req fapi.ExportFormResponsesRequestObject) (fapi.ExportFormResponsesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Export(ctx, tc, req.FormId)
	return reply(ctx, err, func() fapi.ExportFormResponsesResponseObject {
		return fapi.ExportFormResponses200JSONResponse{Body: out, Headers: fapi.ExportFormResponses200ResponseHeaders{
			CacheControl: cache(), XRequestId: rid(ctx)}}
	}, fapi.ExportFormResponses422ApplicationProblemPlusJSONResponse{}, fapi.ExportFormResponses409ApplicationProblemPlusJSONResponse{})
}

// ListFormFieldOptions implements fapi.StrictServerInterface.
func (s Server) ListFormFieldOptions(ctx context.Context, req fapi.ListFormFieldOptionsRequestObject) (fapi.ListFormFieldOptionsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Options(ctx, tc, req.FormId, req.FieldKey, req.Params.Q)
	return read(ctx, err, func() fapi.ListFormFieldOptionsResponseObject {
		return fapi.ListFormFieldOptions200JSONResponse{Body: out, Headers: fapi.ListFormFieldOptions200ResponseHeaders{
			CacheControl: cache(), XRequestId: rid(ctx)}}
	}, fapi.ListFormFieldOptions422ApplicationProblemPlusJSONResponse{})
}

// ListFormTemplates implements fapi.StrictServerInterface.
func (s Server) ListFormTemplates(ctx context.Context, _ fapi.ListFormTemplatesRequestObject) (fapi.ListFormTemplatesResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Templates(ctx, tc)
	return read(ctx, err, func() fapi.ListFormTemplatesResponseObject {
		return fapi.ListFormTemplates200JSONResponse{Body: out, Headers: fapi.ListFormTemplates200ResponseHeaders{CacheControl: cache(),
			XRequestId: rid(ctx)}}
	}, fapi.ListFormTemplates422ApplicationProblemPlusJSONResponse{})
}

// ListFormGroups implements fapi.StrictServerInterface.
func (s Server) ListFormGroups(ctx context.Context, _ fapi.ListFormGroupsRequestObject) (fapi.ListFormGroupsResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := s.S.Groups(ctx, tc)
	return read(ctx, err, func() fapi.ListFormGroupsResponseObject {
		return fapi.ListFormGroups200JSONResponse{Body: out, Headers: fapi.ListFormGroups200ResponseHeaders{CacheControl: cache(),
			XRequestId: rid(ctx)}}
	}, fapi.ListFormGroups422ApplicationProblemPlusJSONResponse{})
}

// CreateFormGroup implements fapi.StrictServerInterface.
func (s Server) CreateFormGroup(ctx context.Context, req fapi.CreateFormGroupRequestObject) (fapi.CreateFormGroupResponseObject, error) {
	tc, b, err := in(ctx, req.Body)
	if err != nil {
		return nil, err
	}
	out, err := s.S.CreateGroup(ctx, tc, b)
	return reply(ctx, err, func() fapi.CreateFormGroupResponseObject {
		return fapi.CreateFormGroup201JSONResponse{Body: out, Headers: fapi.CreateFormGroup201ResponseHeaders{CacheControl: cache(),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, fapi.CreateFormGroup422ApplicationProblemPlusJSONResponse{}, fapi.CreateFormGroup409ApplicationProblemPlusJSONResponse{})
}

// DeleteFormGroup implements fapi.StrictServerInterface.
func (s Server) DeleteFormGroup(ctx context.Context, req fapi.DeleteFormGroupRequestObject) (fapi.DeleteFormGroupResponseObject, error) {
	tc, err := tenant(ctx)
	if err != nil {
		return nil, err
	}
	err = s.S.DeleteGroup(ctx, tc, req.GroupId)
	return reply(ctx, err, func() fapi.DeleteFormGroupResponseObject {
		return fapi.DeleteFormGroup204Response{Headers: fapi.DeleteFormGroup204ResponseHeaders{CacheControl: cache(),
			IdempotencyReplayed: notReplayed(), XRequestId: rid(ctx)}}
	}, fapi.DeleteFormGroup422ApplicationProblemPlusJSONResponse{}, fapi.DeleteFormGroup409ApplicationProblemPlusJSONResponse{})
}
