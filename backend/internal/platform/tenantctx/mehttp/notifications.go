package mehttp

// The notification inbox of the tag Context (W1.10, S1-26; Q-W0.18-2): listMyNotifications,
// getMyNotificationSummary and markMyNotificationsRead. They are identity operations (x-scope identity): the
// gateway checks the session (and CSRF of the mutation), the tenant comes from the query or the body and must be an
// active membership of the identity — otherwise 404 not_found, like a tenant that does not exist (AC-02), and its
// database is not opened. The audience of every notification is checked again by the port (platform/notify/inbox).

import (
	"context"
	"errors"
	"slices"
	"time"

	"github.com/google/uuid"

	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Inbox is the notification inbox of a tenant DB (platform/notify/inbox, W1.10).
type Inbox interface {
	List(ctx context.Context, tc tenantctx.TenantContext, q inbox.Query) (inbox.Page, error)
	Summary(ctx context.Context, tc tenantctx.TenantContext) (inbox.Counter, error)
	MarkRead(ctx context.Context, tc tenantctx.TenantContext, m inbox.Mark) (int64, error)
}

var _ Inbox = (*inbox.Inbox)(nil)

// codeValidationFailed is the Problem code of a body that breaks the schema (api/errors.yaml).
const codeValidationFailed = "validation_failed"

// Page size of listMyNotifications (common/parameters.yaml Limit) and the size of notificationIds.
const (
	maxLimit = 200
	maxIDs   = 200
)

// account returns the account of the session the gateway put into ctx; without an inbox port the operations
// answer 501 like an operation without a handler.
func (s *Server) account(ctx context.Context) (uuid.UUID, error) {
	sess, ok := session.FromContext(ctx)
	if !ok {
		return uuid.Nil, problem.New(problem.CodeSessionExpired, "")
	}
	if s.Inbox == nil {
		return uuid.Nil, problem.New(problem.CodeNotImplemented, "")
	}
	return sess.AccountID, nil
}

// inboxTenant returns the tenant context of account in tenantID: an active membership of a readable tenant.
// Marking notifications read is the person's own state, not data of the tenant, so a tenant in grace or read_only
// accepts it (brief W1.10 §10 item 1); a suspended tenant answers tenant_suspended like the gateway.
func (s *Server) inboxTenant(ctx context.Context, account, tenantID uuid.UUID) (tenantctx.TenantContext, error) {
	return tenantctx.Resolve(ctx, s.Dir, account, tenantID.String(), false)
}

// ListMyNotifications implements contextapi.StrictServerInterface.
func (s *Server) ListMyNotifications(ctx context.Context, req contextapi.ListMyNotificationsRequestObject) (contextapi.ListMyNotificationsResponseObject, error) {
	account, err := s.account(ctx)
	if err != nil {
		return nil, err
	}
	q, err := listQuery(req.Params)
	if err != nil {
		return nil, err
	}
	tc, err := s.inboxTenant(ctx, account, req.Params.TenantId)
	if err != nil {
		return nil, err
	}
	page, err := s.Inbox.List(ctx, tc, q)
	if errors.Is(err, inbox.ErrBadCursor) {
		return nil, problem.New(problem.CodeMalformedRequest, "Неверный курсор страницы.")
	}
	if err != nil {
		return nil, err
	}
	body := contextapi.NotificationPage{Items: make([]contextapi.Notification, 0, len(page.Items)), UnreadCount: page.Unread}
	for _, n := range page.Items {
		body.Items = append(body.Items, notificationDTO(tc.TenantID, n))
	}
	if page.NextCursor != "" {
		body.NextCursor = &page.NextCursor
	}
	cc, rid := noStore, requestid.FromContext(ctx)
	return contextapi.ListMyNotifications200JSONResponse{
		Body: body, Headers: contextapi.ListMyNotifications200ResponseHeaders{CacheControl: &cc, XRequestId: &rid},
	}, nil
}

// listQuery checks the parameters the generated server does not: the range of limit and the enum of filter.
func listQuery(p contextapi.ListMyNotificationsParams) (inbox.Query, error) {
	q := inbox.Query{Limit: inbox.DefaultLimit}
	if p.Limit != nil {
		q.Limit = *p.Limit
	}
	if q.Limit < 1 || q.Limit > maxLimit {
		return q, problem.New(problem.CodeMalformedRequest, "limit: 1…200")
	}
	if p.Filter != nil {
		if !p.Filter.Valid() {
			return q, problem.New(problem.CodeMalformedRequest, "filter: all или unread")
		}
		q.UnreadOnly = *p.Filter == contextapi.Unread
	}
	if p.Cursor != nil {
		q.Cursor = *p.Cursor
	}
	return q, nil
}

func notificationDTO(tenantID uuid.UUID, n inbox.Notification) contextapi.Notification {
	out := contextapi.Notification{
		Id: n.ID, TenantId: tenantID, Kind: n.Kind, Severity: contextapi.NotificationSeverity(n.Severity),
		Title: n.Title, Body: n.Body, Link: n.Link, CreatedAt: n.CreatedAt.UTC(), ReadAt: utc(n.ReadAt),
	}
	if n.Object != nil {
		out.Object = &contextapi.ObjectRef{ModuleKey: n.Object.ModuleKey, EntityType: n.Object.EntityType, EntityId: n.Object.EntityID}
	}
	return out
}

// GetMyNotificationSummary implements contextapi.StrictServerInterface: counters of every active membership of a
// visible tenant (Q-W0.08-4), in the order of the directory, like tenants[] of /me/context. Counters are read
// only where the tenant DB is readable (trial, active, grace, read_only); a suspended tenant and a tenant DB that
// fails give 0 and no latestAt, so one business never breaks the bell of the others.
func (s *Server) GetMyNotificationSummary(ctx context.Context, _ contextapi.GetMyNotificationSummaryRequestObject) (contextapi.GetMyNotificationSummaryResponseObject, error) {
	account, err := s.account(ctx)
	if err != nil {
		return nil, err
	}
	ms, err := s.Dir.Memberships(ctx, account)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	body := contextapi.NotificationSummary{Tenants: []contextapi.NotificationTenantSummary{}}
	for _, m := range ms {
		if m.Status != active || hiddenTenant[m.TenantState] {
			continue
		}
		t := contextapi.NotificationTenantSummary{TenantId: m.TenantID}
		if enriched[m.TenantState] {
			tc := tenantctx.TenantContext{TenantID: m.TenantID, MembershipID: m.ID, AccountID: account, PersonID: m.PersonProfileID, Owner: m.Owner}
			c, err := s.Inbox.Summary(ctx, tc)
			if err != nil {
				s.degraded(ctx, m.TenantID, err)
			} else {
				t.UnreadCount, t.LatestAt = c.Unread, utc(c.LatestAt)
			}
		}
		body.Tenants = append(body.Tenants, t)
		body.TotalUnread += t.UnreadCount
	}
	cc, rid := noStore, requestid.FromContext(ctx)
	return contextapi.GetMyNotificationSummary200JSONResponse{
		Body: body, Headers: contextapi.GetMyNotificationSummary200ResponseHeaders{CacheControl: &cc, XRequestId: &rid},
	}, nil
}

// MarkMyNotificationsRead implements contextapi.StrictServerInterface.
func (s *Server) MarkMyNotificationsRead(ctx context.Context, req contextapi.MarkMyNotificationsReadRequestObject) (contextapi.MarkMyNotificationsReadResponseObject, error) {
	account, err := s.account(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	m, err := readMark(*req.Body)
	if err != nil {
		return nil, err
	}
	tc, err := s.inboxTenant(ctx, account, req.Body.TenantId)
	if err != nil {
		return nil, err
	}
	unread, err := s.Inbox.MarkRead(ctx, tc, m)
	if err != nil {
		return nil, err
	}
	cc, rid, replayed := noStore, requestid.FromContext(ctx), false
	return contextapi.MarkMyNotificationsRead200JSONResponse{
		Body: contextapi.NotificationCounter{TenantId: tc.TenantID, UnreadCount: unread},
		Headers: contextapi.MarkMyNotificationsRead200ResponseHeaders{
			CacheControl: &cc, IdempotencyReplayed: &replayed, XRequestId: &rid,
		},
	}, nil
}

// readMark checks NotificationReadRequest beyond the generated types: exactly one of notificationIds and upTo,
// notificationIds of 1…200 distinct ids (minProperties/maxProperties, minItems, maxItems, uniqueItems → 422).
func readMark(b contextapi.NotificationReadRequest) (inbox.Mark, error) {
	if (b.NotificationIds == nil) == (b.UpTo == nil) {
		return inbox.Mark{}, problem.New(codeValidationFailed, "Укажите ровно одно из полей: notificationIds или upTo.")
	}
	if b.UpTo != nil {
		return inbox.Mark{UpTo: b.UpTo}, nil
	}
	ids := *b.NotificationIds
	sorted := slices.Clone(ids)
	slices.SortFunc(sorted, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	if len(ids) == 0 || len(ids) > maxIDs || len(slices.Compact(sorted)) != len(ids) {
		return inbox.Mark{}, problem.New(codeValidationFailed, "notificationIds: от 1 до 200 разных идентификаторов.")
	}
	return inbox.Mark{IDs: ids}, nil
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}
