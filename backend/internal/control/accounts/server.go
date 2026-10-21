package accounts

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"unicode/utf8"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

// Catalogue is the service of the catalogue and the operators (Service).
type Catalogue interface {
	Users(ctx context.Context, q UserQuery) (UserPage, error)
	User(ctx context.Context, id uuid.UUID) (User, error)
	LockUser(ctx context.Context, c Lock) (User, error)
	UnlockUser(ctx context.Context, c AccountCommand) (User, error)
	ResetMFA(ctx context.Context, c AccountCommand) (User, error)
	Operators(ctx context.Context, me uuid.UUID) (OperatorPage, error)
	Invite(ctx context.Context, c Invite) (Operator, error)
	UpdateOperator(ctx context.Context, c OperatorChange) (Operator, error)
}

// Server is the tag Platform with the catalogue of accounts and the operators; it embeds the composed server of the
// tag and overrides only these operations.
type Server struct {
	platformapi.StrictServerInterface
	Service Catalogue
}

const noStore = "private, no-store"

// Page size and the search bounds of listPlatformUsers.
const (
	defaultLimit = 50
	maxLimit     = 200
	maxQuery     = 100
)

// Problem codes beyond the platform ones (api/errors.yaml).
const (
	codeRevisionRequired = "revision_required"
	codeRevisionMismatch = "revision_mismatch"
)

func headers(ctx context.Context) (cache, rid *string) {
	c, id := noStore, requestid.FromContext(ctx)
	return &c, &id
}

// serviceError maps the errors of the service to Problem codes; a RefusalError keeps its code and detail.
func serviceError(err error) error {
	var refusal *RefusalError
	switch {
	case errors.As(err, &refusal):
		return problem.New(refusal.Code, refusal.Detail)
	case errors.Is(err, ErrNotFound):
		return problem.New(problem.CodeNotFound, "")
	case errors.Is(err, ErrForbidden):
		return problem.New(problem.CodeForbiddenAction, "")
	case errors.Is(err, ErrRevisionRequired):
		return problem.New(codeRevisionRequired, "")
	case errors.Is(err, ErrRevisionMismatch):
		return problem.New(codeRevisionMismatch, "")
	case errors.Is(err, ErrBadCursor):
		return problem.New(problem.CodeMalformedRequest, "cursor")
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

// validation is the Problem body of a refusal with violations (422); ok false for any other error.
func validation(ctx context.Context, err error) (platformapi.Problem, bool) {
	var refusal *RefusalError
	if !errors.As(err, &refusal) || len(refusal.Violations) == 0 {
		return platformapi.Problem{}, false
	}
	p := catalog.Problems[refusal.Code]
	if p.Status != http.StatusUnprocessableEntity {
		return platformapi.Problem{}, false
	}
	detail, vs := refusal.Detail, make([]platformapi.ProblemViolation, 0, len(refusal.Violations))
	for _, v := range refusal.Violations {
		vs = append(vs, platformapi.ProblemViolation{Field: v.Field, Code: v.Code, Message: v.Message})
	}
	return platformapi.Problem{
		Type: problem.TypeBase + refusal.Code, Title: p.Title, Status: int64(p.Status), Code: platformapi.ProblemCode(refusal.Code),
		Detail: &detail, RequestId: requestid.FromContext(ctx), Violations: &vs,
	}, true
}

func actorOf(ctx context.Context) (uuid.UUID, error) {
	sess, ok := session.FromContext(ctx)
	if !ok {
		return uuid.Nil, problem.New(problem.CodeSessionExpired, "")
	}
	return sess.AccountID, nil
}

// filters of listPlatformUsers.
var filters = map[string]bool{FilterMultiTenant: true, FilterNoMFA: true, FilterLocked: true, FilterNeverSignedIn: true}

// userQuery checks the parameters of listPlatformUsers.
func userQuery(actor uuid.UUID, p platformapi.ListPlatformUsersParams) (UserQuery, error) {
	q := UserQuery{Actor: actor, TenantID: p.TenantId, Limit: defaultLimit}
	if p.Limit != nil {
		q.Limit = *p.Limit
	}
	if q.Limit < 1 || q.Limit > maxLimit {
		return UserQuery{}, problem.New(problem.CodeMalformedRequest, "limit: 1…200")
	}
	if p.Q != nil {
		if n := utf8.RuneCountInString(*p.Q); n < 1 || n > maxQuery {
			return UserQuery{}, problem.New(problem.CodeMalformedRequest, "q: 1…100")
		}
		q.Q = *p.Q
	}
	if p.Filter != nil {
		if !filters[string(*p.Filter)] {
			return UserQuery{}, problem.New(problem.CodeMalformedRequest, "filter")
		}
		q.Filter = string(*p.Filter)
	}
	if p.Cursor != nil {
		q.Cursor = *p.Cursor
	}
	return q, nil
}

// userAPI is an account of the catalogue; the card has its memberships.
func userAPI(u User) platformapi.PlatformUser {
	out := platformapi.PlatformUser{
		Id: u.ID, DisplayName: u.DisplayName, Email: openapi_types.Email(u.Email), Status: platformapi.PlatformUserStatus(u.Status),
		LastSeenAt: u.LastSeenAt, TenantCount: int64(u.TenantCount), MfaEnabled: new(u.MFA), LockedAt: u.LockedAt,
	}
	if u.LockReason != "" {
		out.LockReason = new(u.LockReason)
	}
	if u.Memberships != nil {
		ms := make([]platformapi.PlatformUserMembership, 0, len(u.Memberships))
		for _, m := range u.Memberships {
			ms = append(ms, platformapi.PlatformUserMembership{
				TenantId: m.TenantID, TenantName: m.TenantName, TenantStatus: platformapi.PlatformUserMembershipTenantStatus(m.TenantStatus),
				Status: platformapi.PlatformUserMembershipStatus(m.Status), Owner: m.Owner,
			})
		}
		out.Memberships = &ms
	}
	return out
}

// ListPlatformUsers implements platformapi.StrictServerInterface: the catalogue of accounts.
func (s Server) ListPlatformUsers(ctx context.Context, req platformapi.ListPlatformUsersRequestObject) (platformapi.ListPlatformUsersResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}
	q, err := userQuery(actor, req.Params)
	if err != nil {
		return nil, err
	}
	page, err := s.Service.Users(ctx, q)
	if err != nil {
		return nil, serviceError(err)
	}
	c := page.Counts
	body := platformapi.PlatformUserPage{
		Items: make([]platformapi.PlatformUser, 0, len(page.Items)),
		Counts: &platformapi.PlatformUserCounts{
			All: c.All, MultiTenant: c.MultiTenant, NoMfa: c.NoMFA, Locked: c.Locked, NeverSignedIn: c.NeverSignedIn,
		},
	}
	for _, u := range page.Items {
		body.Items = append(body.Items, userAPI(u))
	}
	if page.Next != "" {
		body.NextCursor = &page.Next
	}
	cache, rid := headers(ctx)
	return platformapi.ListPlatformUsers200JSONResponse{Body: body,
		Headers: platformapi.ListPlatformUsers200ResponseHeaders{CacheControl: cache, XRequestId: rid}}, nil
}

// GetPlatformUser implements platformapi.StrictServerInterface: the card of an account.
func (s Server) GetPlatformUser(ctx context.Context, req platformapi.GetPlatformUserRequestObject) (platformapi.GetPlatformUserResponseObject, error) {
	u, err := s.Service.User(ctx, req.AccountId)
	if err != nil {
		return nil, serviceError(err)
	}
	cache, rid := headers(ctx)
	return platformapi.GetPlatformUser200JSONResponse{Body: userAPI(u),
		Headers: platformapi.GetPlatformUser200ResponseHeaders{CacheControl: cache, XRequestId: rid}}, nil
}

// LockPlatformUser implements platformapi.StrictServerInterface: a reason shorter than 5 characters is the 422 of the
// example.
func (s Server) LockPlatformUser(ctx context.Context, req platformapi.LockPlatformUserRequestObject) (platformapi.LockPlatformUserResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	u, err := s.Service.LockUser(ctx, Lock{Actor: actor, Account: req.AccountId, Reason: req.Body.Reason})
	if p, ok := validation(ctx, err); ok {
		return platformapi.LockPlatformUser422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: platformapi.ValidationApplicationProblemPlusJSONResponse{
			Body: p, Headers: platformapi.ValidationResponseHeaders{XRequestId: &p.RequestId}}}, nil
	}
	if err != nil {
		return nil, serviceError(err)
	}
	cache, rid := headers(ctx)
	replayed := false
	return platformapi.LockPlatformUser200JSONResponse{Body: userAPI(u),
		Headers: platformapi.LockPlatformUser200ResponseHeaders{CacheControl: cache, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// answered are the body and the headers of an answer of a command of the catalogue.
type answered struct {
	body       platformapi.PlatformUser
	cache, rid *string
	replayed   bool
}

// command runs a command of the catalogue on account for the operator of the request.
func command(ctx context.Context, account uuid.UUID, run func(context.Context, AccountCommand) (User, error)) (answered, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return answered{}, err
	}
	u, err := run(ctx, AccountCommand{Actor: actor, Account: account})
	if err != nil {
		return answered{}, serviceError(err)
	}
	cache, rid := headers(ctx)
	return answered{body: userAPI(u), cache: cache, rid: rid}, nil
}

// UnlockPlatformUser implements platformapi.StrictServerInterface.
func (s Server) UnlockPlatformUser(ctx context.Context, req platformapi.UnlockPlatformUserRequestObject) (platformapi.UnlockPlatformUserResponseObject, error) {
	a, err := command(ctx, req.AccountId, s.Service.UnlockUser)
	if err != nil {
		return nil, err
	}
	return platformapi.UnlockPlatformUser200JSONResponse{Body: a.body,
		Headers: platformapi.UnlockPlatformUser200ResponseHeaders{CacheControl: a.cache, IdempotencyReplayed: &a.replayed, XRequestId: a.rid}}, nil
}

// ResetPlatformUserMfa implements platformapi.StrictServerInterface.
func (s Server) ResetPlatformUserMfa(ctx context.Context, req platformapi.ResetPlatformUserMfaRequestObject) (platformapi.ResetPlatformUserMfaResponseObject, error) {
	a, err := command(ctx, req.AccountId, s.Service.ResetMFA)
	if err != nil {
		return nil, err
	}
	return platformapi.ResetPlatformUserMfa200JSONResponse{Body: a.body,
		Headers: platformapi.ResetPlatformUserMfa200ResponseHeaders{CacheControl: a.cache, IdempotencyReplayed: &a.replayed, XRequestId: a.rid}}, nil
}

// ETag is the strong entity tag of an operator revision ("rev-N").
func ETag(revision int64) string { return `"rev-` + strconv.FormatInt(revision, 10) + `"` }

// operatorAPI is an operator of the platform.
func operatorAPI(o Operator) platformapi.PlatformOperator {
	out := platformapi.PlatformOperator{
		Id: o.ID, AccountId: o.AccountID, DisplayName: o.DisplayName, Email: openapi_types.Email(o.Email),
		Role: platformapi.PlatformOperatorRole(o.Role), Status: platformapi.PlatformOperatorStatus(o.Status), LastSeenAt: o.LastSeenAt,
		DisabledAt: o.DisabledAt, Me: o.Me, Revision: o.Revision,
	}
	if o.MFA != "" {
		out.Mfa = new(platformapi.PlatformOperatorMfa(o.MFA))
	}
	if o.DisabledReason != "" {
		out.DisabledReason = new(o.DisabledReason)
	}
	return out
}

// ListPlatformOperators implements platformapi.StrictServerInterface: the operators of «Ортус · Платформа».
func (s Server) ListPlatformOperators(ctx context.Context, req platformapi.ListPlatformOperatorsRequestObject) (platformapi.ListPlatformOperatorsResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}
	if req.Params.Cursor != nil { // the team of the platform is one page (PlatformOperatorPage maxItems 200)
		return nil, problem.New(problem.CodeMalformedRequest, "cursor")
	}
	page, err := s.Service.Operators(ctx, actor)
	if err != nil {
		return nil, serviceError(err)
	}
	body := platformapi.PlatformOperatorPage{Items: make([]platformapi.PlatformOperator, 0, len(page.Items)), ActiveOwnerCount: page.ActiveOwnerCount}
	for _, o := range page.Items[:min(len(page.Items), maxLimit)] {
		body.Items = append(body.Items, operatorAPI(o))
	}
	cache, rid := headers(ctx)
	return platformapi.ListPlatformOperators200JSONResponse{Body: body,
		Headers: platformapi.ListPlatformOperators200ResponseHeaders{CacheControl: cache, XRequestId: rid}}, nil
}

// InvitePlatformOperator implements platformapi.StrictServerInterface: the e-mail and the role checks are the 422 of
// the example.
func (s Server) InvitePlatformOperator(ctx context.Context, req platformapi.InvitePlatformOperatorRequestObject) (platformapi.InvitePlatformOperatorResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	o, err := s.Service.Invite(ctx, Invite{Actor: actor, DisplayName: req.Body.DisplayName, Email: string(req.Body.Email), Role: string(req.Body.Role)})
	if p, ok := validation(ctx, err); ok {
		return platformapi.InvitePlatformOperator422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: platformapi.ValidationApplicationProblemPlusJSONResponse{
			Body: p, Headers: platformapi.ValidationResponseHeaders{XRequestId: &p.RequestId}}}, nil
	}
	if err != nil {
		return nil, serviceError(err)
	}
	cache, rid := headers(ctx)
	tag, replayed := ETag(o.Revision), false
	return platformapi.InvitePlatformOperator201JSONResponse{Body: operatorAPI(o),
		Headers: platformapi.InvitePlatformOperator201ResponseHeaders{CacheControl: cache, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// UpdatePlatformOperator implements platformapi.StrictServerInterface: the rules of the owners; a field refusal is
// the 422 of the example.
func (s Server) UpdatePlatformOperator(ctx context.Context, req platformapi.UpdatePlatformOperatorRequestObject) (platformapi.UpdatePlatformOperatorResponseObject, error) {
	actor, err := actorOf(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	c := OperatorChange{Actor: actor, ID: req.OperatorId, IfMatch: req.Params.IfMatch, Active: req.Body.Active, Reason: req.Body.Reason}
	if req.Body.Role != nil {
		c.Role = new(string(*req.Body.Role))
	}
	o, err := s.Service.UpdateOperator(ctx, c)
	if p, ok := validation(ctx, err); ok {
		return platformapi.UpdatePlatformOperator422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: platformapi.ValidationApplicationProblemPlusJSONResponse{
			Body: p, Headers: platformapi.ValidationResponseHeaders{XRequestId: &p.RequestId}}}, nil
	}
	if err != nil {
		return nil, serviceError(err)
	}
	cache, rid := headers(ctx)
	tag, replayed := ETag(o.Revision), false
	return platformapi.UpdatePlatformOperator200JSONResponse{Body: operatorAPI(o),
		Headers: platformapi.UpdatePlatformOperator200ResponseHeaders{CacheControl: cache, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}
