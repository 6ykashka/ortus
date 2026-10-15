package mehttp

import (
	"context"
	"errors"
	"fmt"
	"reflect"
	"testing"
	"time"

	"github.com/google/uuid"

	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// inboxDir is a directory with memberships of one account (Membership answers like the control DB).
type inboxDir struct {
	fakeDir
	account uuid.UUID
	ms      []tenantctx.Membership
}

func (d *inboxDir) Memberships(_ context.Context, id uuid.UUID) ([]tenantctx.Membership, error) {
	if id != d.account {
		return nil, nil
	}
	return d.ms, nil
}

func (d *inboxDir) Membership(_ context.Context, account, tenant uuid.UUID) (tenantctx.Membership, error) {
	for _, m := range d.ms {
		if account == d.account && m.TenantID == tenant {
			return m, nil
		}
	}
	return tenantctx.Membership{}, tenantctx.ErrNotFound
}

// fakeInbox answers per tenant and records what the handlers asked.
type fakeInbox struct {
	page     inbox.Page
	pageErr  error
	counters map[uuid.UUID]inbox.Counter
	down     map[uuid.UUID]bool
	unread   int64
	queries  []inbox.Query
	marks    []inbox.Mark
	tcs      []tenantctx.TenantContext
}

func (f *fakeInbox) List(_ context.Context, tc tenantctx.TenantContext, q inbox.Query) (inbox.Page, error) {
	f.tcs, f.queries = append(f.tcs, tc), append(f.queries, q)
	return f.page, f.pageErr
}

func (f *fakeInbox) Summary(_ context.Context, tc tenantctx.TenantContext) (inbox.Counter, error) {
	f.tcs = append(f.tcs, tc)
	if f.down[tc.TenantID] {
		return inbox.Counter{}, problem.Wrap(problem.CodeDependencyUnavailable, errors.New("tenant DB down"))
	}
	return f.counters[tc.TenantID], nil
}

func (f *fakeInbox) MarkRead(_ context.Context, tc tenantctx.TenantContext, m inbox.Mark) (int64, error) {
	f.tcs, f.marks = append(f.tcs, tc), append(f.marks, m)
	return f.unread, nil
}

var (
	readOnly  = uuid.New()
	suspended = uuid.New()
	closed    = uuid.New()
	invited   = uuid.New()
)

// inboxServer: Зимина — участница «Альты» (trial, владелец), «Лотоса» (active), организации в read_only,
// приостановленной организации; приглашена в одну и состоит в закрытой.
func inboxServer() (*Server, *fakeInbox, *inboxDir) {
	dir := &inboxDir{account: zimina, ms: []tenantctx.Membership{
		m(lotos, "SPA «Лотос»", "active", "active", false),
		m(alta, "Альта Групп", "trial", "active", true),
		m(readOnly, "Только чтение", "read_only", "active", false),
		m(suspended, "Карго Сити", "suspended", "active", false),
		m(invited, "Ремстрой Плюс", "active", "invited", false),
		m(closed, "Закрыта", "closed", "active", false),
	}}
	in := &fakeInbox{counters: map[uuid.UUID]inbox.Counter{}, down: map[uuid.UUID]bool{}}
	return &Server{Dir: dir, Inbox: in}, in, dir
}

func signedIn(t *testing.T) context.Context {
	t.Helper()
	return session.WithSession(t.Context(), session.Session{ID: "sid", AccountID: zimina})
}

func membershipOf(d *inboxDir, tenant uuid.UUID) tenantctx.Membership {
	for _, x := range d.ms {
		if x.TenantID == tenant {
			return x
		}
	}
	return tenantctx.Membership{}
}

// Без сессии (шлюз её не положил) — session_expired у всех трёх операций.
func TestNotificationsWithoutSession(t *testing.T) {
	t.Parallel()
	s, in, _ := inboxServer()
	ctx := t.Context()
	_, e1 := s.ListMyNotifications(ctx, contextapi.ListMyNotificationsRequestObject{Params: contextapi.ListMyNotificationsParams{TenantId: alta}})
	_, e2 := s.GetMyNotificationSummary(ctx, contextapi.GetMyNotificationSummaryRequestObject{})
	_, e3 := s.MarkMyNotificationsRead(ctx, contextapi.MarkMyNotificationsReadRequestObject{Body: &contextapi.NotificationReadRequest{TenantId: alta}})
	for i, err := range []error{e1, e2, e3} {
		if !problem.Is(err, problem.CodeSessionExpired) {
			t.Errorf("operation %d: %v", i, err)
		}
	}
	if len(in.tcs) != 0 {
		t.Fatal("the inbox was read without a session")
	}
}

func list(t *testing.T, s *Server, p contextapi.ListMyNotificationsParams) (contextapi.ListMyNotifications200JSONResponse, error) {
	t.Helper()
	resp, err := s.ListMyNotifications(signedIn(t), contextapi.ListMyNotificationsRequestObject{Params: p})
	if err != nil {
		return contextapi.ListMyNotifications200JSONResponse{}, err
	}
	ok, isOK := resp.(contextapi.ListMyNotifications200JSONResponse)
	if !isOK {
		t.Fatalf("response %T", resp)
	}
	return ok, nil
}

// Лента одной организации: контекст — активное членство субъекта, ответ по контракту NotificationPage.
func TestListMyNotifications(t *testing.T) {
	t.Parallel()
	s, in, dir := inboxServer()
	created := time.Date(2026, 10, 1, 7, 20, 0, 0, time.UTC)
	body, link, read := "Проверьте рейс", "/fleet/trips/R-102", created.Add(time.Minute)
	entity, first, second := uuid.New(), uuid.New(), uuid.New()
	in.page = inbox.Page{Unread: 3, NextCursor: "next", Items: []inbox.Notification{
		{ID: first, Kind: "fleet.trip.submitted", Severity: "warning", Title: "Рейс R-102 сдан", Body: &body, Link: &link,
			Object: &inbox.Object{ModuleKey: "fleet", EntityType: "trip", EntityID: entity}, CreatedAt: created, ReadAt: &read},
		{ID: second, Kind: "members.invitation.accepted", Severity: "info", Title: "Приглашение принято", CreatedAt: created},
	}}
	unread, cur, limit := contextapi.Unread, "abc", 20
	resp, err := list(t, s, contextapi.ListMyNotificationsParams{TenantId: alta, Filter: &unread, Cursor: &cur, Limit: &limit})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Headers.CacheControl == nil || *resp.Headers.CacheControl != noStore {
		t.Fatalf("Cache-Control = %v", resp.Headers.CacheControl)
	}
	ms := membershipOf(dir, alta)
	wantTC := tenantctx.TenantContext{TenantID: alta, MembershipID: ms.ID, AccountID: zimina, PersonID: ms.PersonProfileID, Owner: true}
	if in.tcs[0] != wantTC || in.queries[0] != (inbox.Query{UnreadOnly: true, Cursor: "abc", Limit: 20}) {
		t.Fatalf("tenant context %+v, query %+v", in.tcs[0], in.queries[0])
	}
	next := "next"
	want := contextapi.NotificationPage{UnreadCount: 3, NextCursor: &next, Items: []contextapi.Notification{
		{Id: first, TenantId: alta, Kind: "fleet.trip.submitted", Severity: "warning", Title: "Рейс R-102 сдан", Body: &body,
			Link: &link, Object: &contextapi.ObjectRef{ModuleKey: "fleet", EntityType: "trip", EntityId: entity},
			CreatedAt: created, ReadAt: &read},
		{Id: second, TenantId: alta, Kind: "members.invitation.accepted", Severity: "info", Title: "Приглашение принято", CreatedAt: created},
	}}
	if !reflect.DeepEqual(resp.Body, want) {
		t.Fatalf("page = %+v\nwant %+v", resp.Body, want)
	}
}

// Без фильтра и лимита — все уведомления по 50; последняя страница — nextCursor: null, items: [] не nil.
func TestListMyNotificationsDefaults(t *testing.T) {
	t.Parallel()
	s, in, _ := inboxServer()
	resp, err := list(t, s, contextapi.ListMyNotificationsParams{TenantId: readOnly})
	if err != nil {
		t.Fatalf("read_only tenant: %v", err)
	}
	if q := in.queries[0]; q != (inbox.Query{Limit: inbox.DefaultLimit}) {
		t.Fatalf("query = %+v", q)
	}
	if resp.Body.Items == nil || resp.Body.NextCursor != nil {
		t.Fatalf("page = %+v", resp.Body)
	}
}

// AC-02: tenantId — только активное членство субъекта; иначе 404, как несуществующая организация, и лента не
// читается; приостановленная организация — 403 tenant_suspended (как шлюз).
func TestListMyNotificationsForeignTenant(t *testing.T) {
	t.Parallel()
	s, in, _ := inboxServer()
	for tenant, code := range map[uuid.UUID]string{
		cargo:      problem.CodeNotFound,
		uuid.New(): problem.CodeNotFound,
		invited:    problem.CodeNotFound,
		closed:     problem.CodeNotFound,
		suspended:  problem.CodeTenantSuspended,
	} {
		if _, err := list(t, s, contextapi.ListMyNotificationsParams{TenantId: tenant}); !problem.Is(err, code) {
			t.Errorf("tenant %s: %v, want %s", tenant, err, code)
		}
	}
	if len(in.tcs) != 0 {
		t.Fatalf("the inbox was read for %v", in.tcs)
	}
}

// Параметры вне контракта и чужой курсор — 400 malformed_request.
func TestListMyNotificationsBadParams(t *testing.T) {
	t.Parallel()
	s, in, _ := inboxServer()
	bad := contextapi.ListMyNotificationsParamsFilter("read")
	for name, p := range map[string]contextapi.ListMyNotificationsParams{
		"limit 0":   {TenantId: alta, Limit: new(0)},
		"limit 201": {TenantId: alta, Limit: new(201)},
		"filter":    {TenantId: alta, Filter: &bad},
	} {
		if _, err := list(t, s, p); !problem.Is(err, problem.CodeMalformedRequest) {
			t.Errorf("%s: %v", name, err)
		}
	}
	in.pageErr = fmt.Errorf("%w: issued for another selection", inbox.ErrBadCursor)
	if _, err := list(t, s, contextapi.ListMyNotificationsParams{TenantId: alta, Cursor: new("x")}); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("bad cursor: %v", err)
	}
	in.pageErr = problem.Wrap(problem.CodeDependencyUnavailable, errors.New("tenant DB down"))
	if _, err := list(t, s, contextapi.ListMyNotificationsParams{TenantId: alta}); !problem.Is(err, problem.CodeDependencyUnavailable) {
		t.Errorf("tenant DB down: %v", err)
	}
}

// Сводка (Q-W0.08-4): активные членства видимых организаций в порядке каталога; счётчики читаются у организаций
// с данными, приостановленная и недоступная — нули; приглашение и закрытая организация не показываются.
func TestGetMyNotificationSummary(t *testing.T) {
	t.Parallel()
	s, in, _ := inboxServer()
	latest := time.Date(2026, 10, 1, 7, 0, 0, 0, time.UTC)
	in.counters[alta] = inbox.Counter{Unread: 3, LatestAt: &latest}
	in.counters[lotos] = inbox.Counter{Unread: 2, LatestAt: &latest}
	in.down[readOnly] = true
	resp, err := s.GetMyNotificationSummary(signedIn(t), contextapi.GetMyNotificationSummaryRequestObject{})
	if err != nil {
		t.Fatal(err)
	}
	ok, isOK := resp.(contextapi.GetMyNotificationSummary200JSONResponse)
	if !isOK || ok.Headers.CacheControl == nil || *ok.Headers.CacheControl != noStore {
		t.Fatalf("response %T %+v", resp, resp)
	}
	want := contextapi.NotificationSummary{TotalUnread: 5, Tenants: []contextapi.NotificationTenantSummary{
		{TenantId: lotos, UnreadCount: 2, LatestAt: &latest},
		{TenantId: alta, UnreadCount: 3, LatestAt: &latest},
		{TenantId: readOnly},
		{TenantId: suspended},
	}}
	if !reflect.DeepEqual(ok.Body, want) {
		t.Fatalf("summary = %+v\nwant %+v", ok.Body, want)
	}
	for _, tc := range in.tcs {
		if tc.TenantID == suspended || tc.TenantID == invited || tc.TenantID == closed {
			t.Fatalf("counters of %s were read", tc.TenantID)
		}
	}
}

// Оператор платформы и аккаунт без членств — пустая сводка, не ошибка.
func TestGetMyNotificationSummaryEmpty(t *testing.T) {
	t.Parallel()
	s, _, dir := inboxServer()
	dir.ms = nil
	resp, err := s.GetMyNotificationSummary(signedIn(t), contextapi.GetMyNotificationSummaryRequestObject{})
	ok, isOK := resp.(contextapi.GetMyNotificationSummary200JSONResponse)
	if err != nil || !isOK || ok.Body.Tenants == nil || len(ok.Body.Tenants) != 0 || ok.Body.TotalUnread != 0 {
		t.Fatalf("summary = %+v %v", resp, err)
	}
}

func mark(t *testing.T, s *Server, body *contextapi.NotificationReadRequest) (contextapi.MarkMyNotificationsRead200JSONResponse, error) {
	t.Helper()
	resp, err := s.MarkMyNotificationsRead(signedIn(t), contextapi.MarkMyNotificationsReadRequestObject{Body: body})
	if err != nil {
		return contextapi.MarkMyNotificationsRead200JSONResponse{}, err
	}
	ok, isOK := resp.(contextapi.MarkMyNotificationsRead200JSONResponse)
	if !isOK {
		t.Fatalf("response %T", resp)
	}
	return ok, nil
}

// Ровно одно из notificationIds и upTo; notificationIds 1…200 без повторов — иначе 422 validation_failed.
func TestMarkMyNotificationsReadValidation(t *testing.T) {
	t.Parallel()
	s, in, _ := inboxServer()
	upTo := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	id := uuid.New()
	many := make([]uuid.UUID, 201)
	for i := range many {
		many[i] = uuid.New()
	}
	for name, b := range map[string]*contextapi.NotificationReadRequest{
		"оба":       {TenantId: alta, NotificationIds: &[]uuid.UUID{id}, UpTo: &upTo},
		"ни одного": {TenantId: alta},
		"пустой":    {TenantId: alta, NotificationIds: &[]uuid.UUID{}},
		"201":       {TenantId: alta, NotificationIds: &many},
		"повтор":    {TenantId: alta, NotificationIds: &[]uuid.UUID{id, id}},
	} {
		if _, err := mark(t, s, b); !problem.Is(err, codeValidationFailed) {
			t.Errorf("%s: %v", name, err)
		}
	}
	if _, err := mark(t, s, nil); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("no body: %v", err)
	}
	if _, err := mark(t, s, &contextapi.NotificationReadRequest{TenantId: cargo, UpTo: &upTo}); !problem.Is(err, problem.CodeNotFound) {
		t.Errorf("foreign tenant: %v", err)
	}
	if len(in.marks) != 0 {
		t.Fatalf("marked: %+v", in.marks)
	}
}

// Отметка в своей организации, в том числе в режиме чтения (личное состояние, не данные организации).
func TestMarkMyNotificationsRead(t *testing.T) {
	t.Parallel()
	s, in, _ := inboxServer()
	in.unread = 4
	ids := []uuid.UUID{uuid.New(), uuid.New()}
	resp, err := mark(t, s, &contextapi.NotificationReadRequest{TenantId: alta, NotificationIds: &ids})
	if err != nil {
		t.Fatal(err)
	}
	if resp.Body != (contextapi.NotificationCounter{TenantId: alta, UnreadCount: 4}) || resp.Headers.CacheControl == nil ||
		resp.Headers.IdempotencyReplayed == nil || *resp.Headers.IdempotencyReplayed {
		t.Fatalf("response = %+v", resp)
	}
	upTo := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	if _, err := mark(t, s, &contextapi.NotificationReadRequest{TenantId: readOnly, UpTo: &upTo}); err != nil {
		t.Fatalf("read_only tenant: %v", err)
	}
	want := []inbox.Mark{{IDs: ids}, {UpTo: &upTo}}
	if !reflect.DeepEqual(in.marks, want) || in.tcs[0].TenantID != alta || in.tcs[1].TenantID != readOnly {
		t.Fatalf("marks = %+v, tenants %v %v", in.marks, in.tcs[0].TenantID, in.tcs[1].TenantID)
	}
}

// Порт входящих не подключён — 501, как операция без реализации.
func TestNotificationsWithoutInbox(t *testing.T) {
	t.Parallel()
	s, _, _ := inboxServer()
	s.Inbox = nil
	if _, err := list(t, s, contextapi.ListMyNotificationsParams{TenantId: alta}); !problem.Is(err, problem.CodeNotImplemented) {
		t.Fatalf("list: %v", err)
	}
}
