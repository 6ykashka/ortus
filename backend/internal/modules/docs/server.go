package docs

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	pdapi "github.com/ortus/ortus-crm/backend/internal/api/publicdocs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// noStore is Cache-Control of every answer (the contract: «private, no-store»).
const noStore = "private, no-store"

// Server implements dapi.StrictServerInterface (the tag Docs) over the service.
type Server struct{ S *Service }

var _ dapi.StrictServerInterface = Server{}

func tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return tenantctx.TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	return tc, nil
}

// meta is the headers of an answer: Cache-Control, X-Request-Id and Idempotency-Replayed (false: a replay is served
// by the idempotency guard).
type meta struct {
	cache, rid *string
	replayed   *bool
}

func metaOf(ctx context.Context) meta {
	c, id, no := noStore, requestid.FromContext(ctx), false
	return meta{&c, &id, &no}
}

// v422 is the 422 of an operation with the violation of a validation of one field.
type v422 = dapi.ValidationApplicationProblemPlusJSONResponse

// fields is the 422 with the violation of a fieldsError (ok false — another error).
func fields(ctx context.Context, err error) (v422, bool) {
	fe, ok := errors.AsType[*fieldsError](err)
	if !ok {
		return v422{}, false
	}
	p := catalog.Problems[codeValidation]
	rid, detail := requestid.FromContext(ctx), fe.detail
	v := []dapi.ProblemViolation{{Field: fe.field, Code: fe.code, Message: fe.detail}}
	return v422{
		Body: dapi.Problem{Type: problem.TypeBase + codeValidation, Title: p.Title, Status: int64(p.Status), Code: codeValidation,
			Detail: &detail, RequestId: rid, Violations: &v},
		Headers: dapi.ValidationResponseHeaders{XRequestId: &rid},
	}, true
}

// answer runs call for the tenant of ctx and makes the answer of its result with ok; a validation of a field is the
// 422 of the operation when bad is given (otherwise the router answers 422 without the violation).
func answer[T, R any](ctx context.Context, call func(tenantctx.TenantContext) (T, error), ok func(T, meta) R, bad func(v422) R) (R, error) {
	var zero R
	tc, err := tenant(ctx)
	if err != nil {
		return zero, err
	}
	out, err := call(tc)
	if v, isField := fields(ctx, err); isField && bad != nil {
		return bad(v), nil
	}
	if err != nil {
		return zero, err
	}
	return ok(out, metaOf(ctx)), nil
}

// body returns the decoded body of a command (nil — 400 malformed_request).
func body[T any](b *T) (T, error) {
	if b == nil {
		var zero T
		return zero, problem.New(problem.CodeMalformedRequest, "")
	}
	return *b, nil
}

// textNotYet is the detail of an operation whose handler belongs to a later work stream.
func textNotYet(owner string) string {
	return "Операция появится в потоке " + owner
}

// sharesRev is the revision of the list a change of access returns (the ETag of the next change).
func sharesRev(r dapi.DocSharesResult) int64 {
	if r.Shares == nil {
		return 0
	}
	return r.Shares.Revision
}

// listQuery is the query of the list of documents.
func listQuery(p dapi.ListDocumentsParams) ListQuery {
	q := ListQuery{Page: Page{Cursor: p.Cursor, Limit: p.Limit}}
	if p.Q != nil {
		q.Q = *p.Q
	}
	if p.FolderId != nil {
		q.Folder = *p.FolderId
	}
	if p.Filter != nil {
		q.Filter = string(*p.Filter)
	}
	return q
}

// modeOf is the requested mode of a session ("" — view).
func modeOf(m *dapi.OpenDocumentSessionParamsMode) string {
	if m == nil {
		return modeView
	}
	return string(*m)
}

// Route reads the route of a document (getDocRoute); a document without a route is 404 «Маршрута нет».
func (s *Service) Route(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (dapi.DocRoute, error) {
	var out dapi.DocRoute
	err := s.runOn(ctx, tc, false, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if rt.onlyVersion > 0 {
			return forbidden(textNeedShare)
		}
		route, err := r.routeDTO(ctx, d)
		if err != nil {
			return err
		}
		if route == nil {
			return notFound("Маршрута нет")
		}
		out = *route
		return nil
	})
	return out, err
}

// PublicServer implements pdapi.StrictServerInterface (the tag PublicDocs): the call of the document server and the
// opening of an external link.
type PublicServer struct{ S *Service }

var _ pdapi.StrictServerInterface = PublicServer{}

// DocServerCallback implements pdapi.StrictServerInterface: the JWT of the server is checked by the gateway
// (AuthorizeCallback), the key names the tenant, the document and the version.
func (p PublicServer) DocServerCallback(ctx context.Context, req pdapi.DocServerCallbackRequestObject) (pdapi.DocServerCallbackResponseObject, error) {
	b, err := body(req.Body)
	if err != nil {
		return nil, err
	}
	in := CallbackBody{Key: b.Key, Status: int(b.Status)}
	if b.Url != nil {
		in.URL = *b.Url
	}
	if b.Users != nil {
		in.Users = *b.Users
	}
	if b.Lastsave != nil {
		in.Lastsave = *b.Lastsave
	}
	if err := p.S.Callback(ctx, in); err != nil {
		if v, ok := fields(ctx, err); ok {
			return pdapi.DocServerCallback422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: convertV422(v)}, nil
		}
		return nil, err
	}
	m := metaOf(ctx)
	return pdapi.DocServerCallback200JSONResponse{Body: pdapi.DocServerCallbackAck{Error: callbackErrorOK},
		Headers: pdapi.DocServerCallback200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid}}, nil
}

// convertV422 copies a 422 of the tag Docs into the schema of the tag PublicDocs (through JSON).
func convertV422(v v422) pdapi.ValidationApplicationProblemPlusJSONResponse {
	var out pdapi.ValidationApplicationProblemPlusJSONResponse
	if b, err := json.Marshal(v.Body); err == nil {
		_ = json.Unmarshal(b, &out.Body)
	}
	out.Headers = pdapi.ValidationResponseHeaders{XRequestId: v.Headers.XRequestId}
	return out
}

// OpenDocLink implements pdapi.StrictServerInterface.
func (p PublicServer) OpenDocLink(ctx context.Context, req pdapi.OpenDocLinkRequestObject) (pdapi.OpenDocLinkResponseObject, error) {
	pin := ""
	if req.Body != nil && req.Body.Pin != nil {
		pin = *req.Body.Pin
	}
	sess, err := p.S.OpenLink(ctx, req.Token, pin)
	if err != nil {
		return nil, err
	}
	var cfg pdapi.DocSessionConfig
	if b, err := json.Marshal(sess.Config); err == nil {
		_ = json.Unmarshal(b, &cfg)
	}
	m := metaOf(ctx)
	return pdapi.OpenDocLink200JSONResponse{
		Body: pdapi.DocPublicSession{Config: cfg, ExpiresAt: instant(sess.ExpiresAt), Kind: pdapi.DocPublicSessionKind(sess.Kind), Title: sess.Title,
			Version: int64(sess.Version), Watermark: sess.Watermark},
		Headers: pdapi.OpenDocLink200ResponseHeaders{CacheControl: m.cache, IdempotencyReplayed: m.replayed, XRequestId: m.rid},
	}, nil
}
