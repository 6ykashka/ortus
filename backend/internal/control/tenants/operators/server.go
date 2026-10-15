package operators

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants/platformhttp"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
)

// AuditEvent is one row of the platform audit log.
type AuditEvent struct {
	ID             int64
	At             time.Time
	ActorKind      string     // operator | owner | system
	ActorID        *uuid.UUID // nil for system rows
	ActorName      string     // display name of the actor's account ("" — none)
	Action         string
	TargetType     string
	TargetID       *uuid.UUID // nil for subscription rows: the contract does not expose the subscription id
	TargetTenantID *uuid.UUID
	TargetName     string
	Reason         string
	Result         string
	Details        map[string]string
}

// AuditPage is a page of the log, newest first; Next is the cursor of the following page ("" — the last one).
type AuditPage struct {
	Items []AuditEvent
	Next  string
}

// AuditQuery is listPlatformAuditEvents: the operator, the tenant filter and the page.
type AuditQuery struct {
	ActorID  uuid.UUID
	TenantID *uuid.UUID
	Cursor   string
	Limit    int
}

// Commands are the operator commands and the log (Service).
type Commands interface {
	Suspend(ctx context.Context, c StatusChange) (tenants.Tenant, error)
	Resume(ctx context.Context, c StatusChange) (tenants.Tenant, error)
	Rename(ctx context.Context, c Rename) (tenants.Tenant, error)
	ExtendTrial(ctx context.Context, c TrialExtension) (subscriptions.Subscription, error)
	AuditEvents(ctx context.Context, q AuditQuery) (AuditPage, error)
}

// Server is the strict server of the tag Platform: the tenant registry of W1.02 (platformhttp.Server: list, card,
// create; its base answers 501 for the operations below) with the operator commands and the log of W1.48. cmd/api
// mounts it under the subscription operations of W1.08 (subshttp.PlatformServer).
type Server struct {
	*platformhttp.Server
	Commands Commands
}

var _ platformapi.StrictServerInterface = (*Server)(nil)

// Problem codes of the commands beyond the platform ones (api/errors.yaml).
const (
	codeValidationFailed  = "validation_failed"
	codeRevisionRequired  = "revision_required"
	codeRevisionMismatch  = "revision_mismatch"
	codeInvalidTransition = "invalid_transition"
)

// Page size of listPlatformAuditEvents (common/parameters.yaml Limit).
const (
	defaultLimit = 50
	maxLimit     = 200
)

const noStore = "private, no-store"

// commandError maps the errors of the commands to Problem codes; anything unexpected is dependency_unavailable
// without its text.
func commandError(err error) error {
	var ve *ValidationError
	switch {
	case errors.As(err, &ve):
		return problem.New(codeValidationFailed, "Неверные поля: "+strings.Join(ve.Fields, ", "))
	case errors.Is(err, ErrRevisionRequired):
		return problem.New(codeRevisionRequired, "")
	case errors.Is(err, ErrRevisionMismatch):
		return problem.New(codeRevisionMismatch, "")
	case errors.Is(err, ErrInvalidTransition):
		return problem.New(codeInvalidTransition, "")
	case errors.Is(err, ErrForbidden):
		return problem.New(problem.CodeForbiddenAction, "")
	case errors.Is(err, ErrNotOperator), errors.Is(err, tenants.ErrUnknownTenant):
		return problem.New(problem.CodeNotFound, "")
	case errors.Is(err, ErrBadCursor):
		return problem.New(problem.CodeMalformedRequest, "cursor")
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

func tenantAPI(tn tenants.Tenant) platformapi.Tenant {
	owners := tn.OwnerAccountIDs
	if owners == nil {
		owners = []uuid.UUID{}
	}
	return platformapi.Tenant{
		Id: tn.ID, Name: tn.Name, Status: platformapi.TenantStatus(tn.State), OwnerUserIds: owners,
		CreatedAt: tn.CreatedAt.UTC(), Revision: tn.Revision,
	}
}

func subscriptionAPI(s subscriptions.Subscription) platformapi.Subscription {
	out := platformapi.Subscription{
		PlanKey: s.PlanKey, Status: platformapi.SubscriptionStatus(s.Status), TrialEndsAt: s.TrialEndsAt,
		PeriodEndsAt: s.PeriodEndsAt, GraceEndsAt: s.GraceEndsAt, CancelAtPeriodEnd: s.CancelAtPeriodEnd,
		Entitlements: make([]platformapi.Entitlement, 0, len(s.Entitlements)), Revision: s.Revision,
	}
	for _, e := range s.Entitlements {
		out.Entitlements = append(out.Entitlements, platformapi.Entitlement{
			Key: e.Key, SourceType: platformapi.EntitlementSourceType(e.SourceType), SourceRef: e.SourceRef, Value: e.Value,
			ValidUntil: e.ValidUntil,
		})
	}
	return out
}

// actor is the account of the operator: the gateway admitted an active one (W0.09).
func actor(ctx context.Context) (uuid.UUID, error) {
	sess, ok := session.FromContext(ctx)
	if !ok {
		return uuid.Nil, problem.New(problem.CodeSessionExpired, "")
	}
	return sess.AccountID, nil
}

// headers are the headers of a command answer.
type headers struct {
	cc, tag, rid string
	replayed     bool
}

func answerHeaders(ctx context.Context, tag string) headers {
	return headers{cc: noStore, tag: tag, rid: requestid.FromContext(ctx)}
}

// statusChange runs suspend or resume with the request.
func (s *Server) statusChange(ctx context.Context, id uuid.UUID, ifMatch string, body *platformapi.TenantStatusChange,
	run func(context.Context, StatusChange) (tenants.Tenant, error),
) (platformapi.Tenant, headers, error) {
	account, err := actor(ctx)
	if err != nil {
		return platformapi.Tenant{}, headers{}, err
	}
	if body == nil {
		return platformapi.Tenant{}, headers{}, problem.New(problem.CodeMalformedRequest, "")
	}
	tn, err := run(ctx, StatusChange{
		TenantID: id, ActorID: account, IfMatch: ifMatch, Reason: body.Reason, RequestID: requestid.FromContext(ctx),
	})
	if err != nil {
		return platformapi.Tenant{}, headers{}, commandError(err)
	}
	return tenantAPI(tn), answerHeaders(ctx, TenantETag(tn.Revision)), nil
}

// SuspendPlatformTenant implements platformapi.StrictServerInterface («Ограничить новые операции», S1-04).
func (s *Server) SuspendPlatformTenant(ctx context.Context, req platformapi.SuspendPlatformTenantRequestObject) (platformapi.SuspendPlatformTenantResponseObject, error) {
	body, h, err := s.statusChange(ctx, req.TenantId, req.Params.IfMatch, req.Body, s.Commands.Suspend)
	if err != nil {
		return nil, err
	}
	return platformapi.SuspendPlatformTenant200JSONResponse{Body: body, Headers: platformapi.SuspendPlatformTenant200ResponseHeaders{
		CacheControl: &h.cc, ETag: &h.tag, IdempotencyReplayed: &h.replayed, XRequestId: &h.rid,
	}}, nil
}

// ResumePlatformTenant implements platformapi.StrictServerInterface («Снять ограничение», S1-04).
func (s *Server) ResumePlatformTenant(ctx context.Context, req platformapi.ResumePlatformTenantRequestObject) (platformapi.ResumePlatformTenantResponseObject, error) {
	body, h, err := s.statusChange(ctx, req.TenantId, req.Params.IfMatch, req.Body, s.Commands.Resume)
	if err != nil {
		return nil, err
	}
	return platformapi.ResumePlatformTenant200JSONResponse{Body: body, Headers: platformapi.ResumePlatformTenant200ResponseHeaders{
		CacheControl: &h.cc, ETag: &h.tag, IdempotencyReplayed: &h.replayed, XRequestId: &h.rid,
	}}, nil
}

// UpdatePlatformTenant implements platformapi.StrictServerInterface: since 0.4.0-stage1 it only renames the tenant;
// suspension and resumption are their own operations, so a status in the body is refused.
func (s *Server) UpdatePlatformTenant(ctx context.Context, req platformapi.UpdatePlatformTenantRequestObject) (platformapi.UpdatePlatformTenantResponseObject, error) {
	account, err := actor(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	switch {
	case req.Body.Status != nil:
		return nil, commandError(&ValidationError{Fields: []string{"status"}})
	case req.Body.Name == nil:
		return nil, commandError(&ValidationError{Fields: []string{"name"}})
	}
	tn, err := s.Commands.Rename(ctx, Rename{
		TenantID: req.TenantId, ActorID: account, IfMatch: req.Params.IfMatch, Name: *req.Body.Name, Reason: req.Body.Reason,
		RequestID: requestid.FromContext(ctx),
	})
	if err != nil {
		return nil, commandError(err)
	}
	h := answerHeaders(ctx, TenantETag(tn.Revision))
	return platformapi.UpdatePlatformTenant200JSONResponse{Body: tenantAPI(tn), Headers: platformapi.UpdatePlatformTenant200ResponseHeaders{
		CacheControl: &h.cc, ETag: &h.tag, IdempotencyReplayed: &h.replayed, XRequestId: &h.rid,
	}}, nil
}

// ExtendPlatformTrial implements platformapi.StrictServerInterface («Продлить пробный период», S1-04, PLAT-05).
func (s *Server) ExtendPlatformTrial(ctx context.Context, req platformapi.ExtendPlatformTrialRequestObject) (platformapi.ExtendPlatformTrialResponseObject, error) {
	account, err := actor(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	sub, err := s.Commands.ExtendTrial(ctx, TrialExtension{
		TenantID: req.TenantId, ActorID: account, IfMatch: req.Params.IfMatch, Days: req.Body.Days, Reason: req.Body.Reason,
		RequestID: requestid.FromContext(ctx),
	})
	if err != nil {
		return nil, commandError(err)
	}
	h := answerHeaders(ctx, SubscriptionETag(sub.Revision))
	return platformapi.ExtendPlatformTrial200JSONResponse{Body: subscriptionAPI(sub), Headers: platformapi.ExtendPlatformTrial200ResponseHeaders{
		CacheControl: &h.cc, ETag: &h.tag, IdempotencyReplayed: &h.replayed, XRequestId: &h.rid,
	}}, nil
}

func eventAPI(e AuditEvent) platformapi.PlatformAuditEvent {
	out := platformapi.PlatformAuditEvent{
		Id: strconv.FormatInt(e.ID, 10), At: e.At.UTC(), Action: e.Action, Result: platformapi.PlatformAuditEventResult(e.Result),
		Actor:  platformapi.PlatformAuditActor{Kind: platformapi.PlatformAuditActorKind(e.ActorKind), AccountId: e.ActorID},
		Target: platformapi.PlatformAuditTarget{Type: platformapi.PlatformAuditTargetType(e.TargetType), Id: e.TargetID, TenantId: e.TargetTenantID},
	}
	if e.ActorName != "" {
		out.Actor.DisplayName = &e.ActorName
	}
	if e.TargetName != "" {
		out.Target.Name = &e.TargetName
	}
	if e.Reason != "" {
		out.Reason = &e.Reason
	}
	if len(e.Details) > 0 {
		out.Details = &e.Details
	}
	return out
}

// ListPlatformAuditEvents implements platformapi.StrictServerInterface («Журнал действий», S1-04, S1-23).
func (s *Server) ListPlatformAuditEvents(ctx context.Context, req platformapi.ListPlatformAuditEventsRequestObject) (platformapi.ListPlatformAuditEventsResponseObject, error) {
	account, err := actor(ctx)
	if err != nil {
		return nil, err
	}
	limit := defaultLimit
	if req.Params.Limit != nil {
		limit = *req.Params.Limit
	}
	if limit < 1 || limit > maxLimit {
		return nil, problem.New(problem.CodeMalformedRequest, "limit: 1…200")
	}
	q := AuditQuery{ActorID: account, TenantID: req.Params.TenantId, Limit: limit}
	if req.Params.Cursor != nil {
		q.Cursor = *req.Params.Cursor
	}
	page, err := s.Commands.AuditEvents(ctx, q)
	if err != nil {
		return nil, commandError(err)
	}
	body := platformapi.PlatformAuditPage{Items: make([]platformapi.PlatformAuditEvent, 0, len(page.Items))}
	for _, e := range page.Items {
		body.Items = append(body.Items, eventAPI(e))
	}
	if page.Next != "" {
		body.NextCursor = &page.Next
	}
	cc, rid := noStore, requestid.FromContext(ctx)
	return platformapi.ListPlatformAuditEvents200JSONResponse{
		Body: body, Headers: platformapi.ListPlatformAuditEvents200ResponseHeaders{CacheControl: &cc, XRequestId: &rid},
	}, nil
}
