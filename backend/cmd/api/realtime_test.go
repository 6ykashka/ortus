package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants"
	"github.com/ortus/ortus-crm/backend/internal/control/tenants/operators"
	"github.com/ortus/ortus-crm/backend/internal/platform/idem"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc/authhttp"
)

// Тесты A-1…A-3 брифа W1.42: канал реального времени (ADR-0015) смонтирован в cmd/api.

const ticketPath = "/api/v1/auth/realtime-tickets"

// A-1: GET /api/v1/realtime проходит шлюз контракта cmd/api (путь вне paths, аутентификация — билет первым кадром)
// и попадает в шлюз канала: чужой Origin → 403 origin_not_allowed до апгрейда, без подпротокола → 400. Без канала
// маршрута нет — 404, как у любого неизвестного пути.
func TestRealtimeRouteMounted(t *testing.T) {
	t.Parallel()
	upgrade := func(origin, protocol string) map[string]string {
		h := map[string]string{"Origin": origin, "Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13",
			"Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="}
		if protocol != "" {
			h["Sec-WebSocket-Protocol"] = protocol
		}
		return h
	}
	without := testDeps(testConfig())
	if rec := newClient(t, newHandler(without)).do(http.MethodGet, realtime.Path, "", upgrade(testOrigin, realtime.Protocol)); rec.Code != http.StatusNotFound {
		t.Fatalf("without the channel: %d %s", rec.Code, rec.Body)
	}
	d := testDeps(testConfig())
	d.realtime = &realtime.Gateway{
		Hub: realtime.NewHub(realtime.HubOptions{}), Tickets: realtime.NewMemTickets(nil), Sessions: session.NewMemStore(),
		AllowedOrigins: []string{testOrigin},
	}
	h := newHandler(d)
	for name, tc := range map[string]struct {
		hdr    map[string]string
		status int
		code   string
	}{
		"чужой Origin":     {upgrade("http://evil.example", realtime.Protocol), http.StatusForbidden, problem.CodeOriginNotAllowed},
		"без подпротокола": {upgrade(testOrigin, ""), http.StatusBadRequest, problem.CodeMalformedRequest},
	} {
		if rec := newClient(t, h).do(http.MethodGet, realtime.Path, "", tc.hdr); rec.Code != tc.status || codeOf(rec) != tc.code {
			t.Errorf("%s: %d %s", name, rec.Code, rec.Body)
		}
	}
}

// A-1: createRealtimeTicket 201 — билет контракта (путь, подпротокол, heartbeat шлюза, срок 60 с); шлюз канала
// погашает его тем же аккаунтом и сессией, что запросили билет, и только один раз.
func TestCreateRealtimeTicketWired(t *testing.T) {
	t.Parallel()
	d := testDeps(testConfig())
	mem := realtime.NewMemTickets(nil)
	d.servers.Auth = &authhttp.Server{Sessions: d.sessions, Realtime: realtimeTickets{tickets: mem, heartbeat: 30 * time.Second}}
	owner := newClient(t, newHandler(d)).login("owner")
	body := ticketOf(t, owner.do(http.MethodPost, ticketPath, "", map[string]string{"Origin": testOrigin, session.CSRFHeader: owner.csrf}))
	if body.Path != realtime.Path || body.Protocol != realtime.Protocol || body.HeartbeatSeconds != 30 || body.Ticket == "" ||
		time.Until(body.ExpiresAt) > realtime.TicketTTL {
		t.Fatalf("ticket = %+v", body)
	}
	p, err := mem.Redeem(t.Context(), body.Ticket)
	if err != nil || p.AccountID != people[0].acc.ID || p.SessionID == "" {
		t.Fatalf("Redeem = %+v, %v; want the account of the owner", p, err)
	}
	if _, err := mem.Redeem(t.Context(), body.Ticket); !errors.Is(err, realtime.ErrTicket) {
		t.Fatalf("second Redeem: %v, want ErrTicket", err)
	}
	if rec := newClient(t, newHandler(d)).do(http.MethodPost, ticketPath, "", map[string]string{"Origin": testOrigin}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("without a session: %d %s", rec.Code, rec.Body)
	}
	if rec := owner.do(http.MethodPost, ticketPath, "", map[string]string{"Origin": testOrigin}); rec.Code != http.StatusForbidden {
		t.Fatalf("without CSRF: %d %s", rec.Code, rec.Body)
	}
}

type ticketBody struct {
	Ticket, Path, Protocol string
	HeartbeatSeconds       int
	ExpiresAt              time.Time
}

// ticketOf reads a 201 RealtimeTicket answered with Cache-Control private, no-store.
func ticketOf(t *testing.T, rec *httptest.ResponseRecorder) ticketBody {
	t.Helper()
	var body ticketBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil || rec.Code != http.StatusCreated ||
		rec.Header().Get("Cache-Control") != "private, no-store" {
		t.Fatalf("createRealtimeTicket: %d %v %s", rec.Code, rec.Header(), rec.Body)
	}
	return body
}

// A-2 (Q-W1.01-2, ADR-0015): билет одноразовый и не хранится — операция без Idempotency-Key в контракте не идёт
// через idem.Guard, даже если клиент прислал ключ: каждый вызов доходит до обработчика, хранилище ключей не трогается.
func TestGatewayTicketNotIdempotent(t *testing.T) {
	t.Parallel()
	h, stores, calls := idemGateway(t)
	owner := newClient(t, h).login("owner")
	hdr := map[string]string{"Origin": testOrigin, session.CSRFHeader: owner.csrf, idem.HeaderKey: "ticket-0123456789abcdef"}
	for range 2 {
		if rec := owner.do(http.MethodPost, ticketPath, "", hdr); rec.Code != http.StatusCreated || rec.Header().Get(idem.HeaderReplayed) != "" {
			t.Fatalf("ticket: %d %v", rec.Code, rec.Header())
		}
	}
	if calls.Load() != 2 || len(stores.asked()) != 0 {
		t.Fatalf("handler calls %d, store asked %v; want 2 and none", calls.Load(), stores.asked())
	}
}

// keyIgnored are the non-public operations that change state (CSRF applies) but declare no Idempotency-Key: the only
// ones whose answer to a sent key the switch from op.Mutating to op.Idempotent changed (возврат 3 W1.42, замечание
// ревью «поведение для всех эндпоинтов»). Public operations skip the gateway and idem.Guard on both sides of it.
var keyIgnored = []string{"createRealtimeTicket", "findCalendarAvailability", "queryDataset"}

// A-2b (возврат 3): idem.Guard по op.Idempotent меняет поведение ровно трёх операций и только при присланном ключе:
// каждая с ключом дважды доходит до обработчика, хранилище не спрошено; операция с Idempotency-Key по-прежнему
// повторяется из хранилища (TestGatewayIdempotency). Красный — gate.go из main (op.Mutating): хранилище спрошено.
func TestGatewayKeyOnlyForDeclaredOperations(t *testing.T) {
	t.Parallel()
	var changed []string
	for _, op := range catalog.Operations {
		if !op.Public && op.Mutating && !op.Idempotent {
			changed = append(changed, op.ID)
		}
	}
	slices.Sort(changed)
	if !slices.Equal(changed, keyIgnored) {
		t.Fatalf("mutating operations without Idempotency-Key = %v, want %v (a new one: check that its key may be ignored)",
			changed, keyIgnored)
	}
	paths := map[string]string{
		"createRealtimeTicket":     ticketPath,
		"findCalendarAvailability": "/api/v1/tenants/" + alta.String() + "/calendar/availability",
		"queryDataset":             "/api/v1/tenants/" + alta.String() + "/datasets/" + uuid.NewString() + "/query",
	}
	for _, id := range keyIgnored {
		t.Run(id, func(t *testing.T) {
			t.Parallel()
			h, stores, calls := idemGateway(t)
			owner := newClient(t, h).login("owner")
			hdr := map[string]string{"Origin": testOrigin, session.CSRFHeader: owner.csrf, idem.HeaderKey: "ignored-0123456789abcdef"}
			for range 2 {
				if rec := owner.do(http.MethodPost, paths[id], `{}`, hdr); rec.Code != http.StatusCreated || rec.Header().Get(idem.HeaderReplayed) != "" {
					t.Fatalf("%d %v %s", rec.Code, rec.Header(), rec.Body)
				}
			}
			if calls.Load() != 2 || len(stores.asked()) != 0 {
				t.Fatalf("handler calls %d, store asked %v; want 2 and none", calls.Load(), stores.asked())
			}
		})
	}
}

// fakeCommands are operator commands that succeed or fail.
type fakeCommands struct {
	operators.Commands
	fail error
}

func (f fakeCommands) Suspend(_ context.Context, c operators.StatusChange) (tenants.Tenant, error) {
	return tenants.Tenant{ID: c.TenantID, State: "suspended"}, f.fail
}

func (f fakeCommands) Resume(_ context.Context, c operators.StatusChange) (tenants.Tenant, error) {
	return tenants.Tenant{ID: c.TenantID, State: "active"}, f.fail
}

func (f fakeCommands) ExtendTrial(_ context.Context, c operators.TrialExtension) (subscriptions.Subscription, error) {
	return subscriptions.Subscription{Status: subscriptions.StatusTrialing, Revision: int64(c.Days)}, f.fail
}

func (f fakeCommands) Rename(_ context.Context, c operators.Rename) (tenants.Tenant, error) {
	return tenants.Tenant{ID: c.TenantID, State: "active"}, f.fail
}

type hints struct {
	mu        sync.Mutex
	tenants   []uuid.UUID
	deadlines []time.Duration // time left to the deadline of each hint; -1 — no deadline
	fail      error
}

func (h *hints) hint(ctx context.Context, tenant uuid.UUID) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.tenants = append(h.tenants, tenant)
	left := time.Duration(-1)
	if at, ok := ctx.Deadline(); ok {
		left = time.Until(at)
	}
	h.deadlines = append(h.deadlines, left)
	return h.fail
}

func (h *hints) got() []uuid.UUID {
	h.mu.Lock()
	defer h.mu.Unlock()
	return slices.Clone(h.tenants)
}

// A-3 (Q-W1.48-12): после приостановки, возобновления, продления trial и переименования (название организации — в
// /me/context; возврат 1 W1.42) участники организации получают context.changed; отказ команды подсказки не даёт;
// сбой подсказки не отменяет закоммиченную команду.
func TestHintingCommands(t *testing.T) {
	t.Parallel()
	tenant := uuid.New()
	run := func(c operators.Commands) []error {
		ctx := t.Context()
		_, e1 := c.Suspend(ctx, operators.StatusChange{TenantID: tenant})
		_, e2 := c.Resume(ctx, operators.StatusChange{TenantID: tenant})
		_, e3 := c.ExtendTrial(ctx, operators.TrialExtension{TenantID: tenant, Days: 7})
		_, e4 := c.Rename(ctx, operators.Rename{TenantID: tenant, Name: "Альта Плюс"})
		return []error{e1, e2, e3, e4}
	}
	ok := &hints{}
	if errs := run(hintingCommands{Commands: fakeCommands{}, hint: ok.hint, log: slog.New(slog.DiscardHandler)}); errors.Join(errs...) != nil {
		t.Fatal(errs)
	}
	if got := ok.got(); !slices.Equal(got, []uuid.UUID{tenant, tenant, tenant, tenant}) {
		t.Fatalf("hints after success = %v, want the tenant four times", got)
	}
	refused := &hints{}
	errs := run(hintingCommands{Commands: fakeCommands{fail: operators.ErrInvalidTransition}, hint: refused.hint, log: slog.New(slog.DiscardHandler)})
	if len(refused.got()) != 0 || !errors.Is(errs[0], operators.ErrInvalidTransition) {
		t.Fatalf("refused command: hints %v, errors %v", refused.got(), errs)
	}
	down := &hints{fail: errors.New("pg_notify: connection refused")}
	if errs := run(hintingCommands{Commands: fakeCommands{}, hint: down.hint, log: slog.New(slog.DiscardHandler)}); errors.Join(errs...) != nil {
		t.Fatalf("a failed hint fails the committed command: %v", errs)
	}
}

// A-3 (возврат 1 W1.42): подсказка после закоммиченной команды — best effort в обработчике HTTP-запроса. Она идёт с
// коротким сроком (не дольше 2 с), чтобы зависшая control DB не держала ответ команды, и не наследует отмену
// запроса: клиент, закрывший соединение после коммита, подсказку не отменяет.
func TestHintingCommandsBounded(t *testing.T) {
	t.Parallel()
	h := &hints{}
	c := hintingCommands{Commands: fakeCommands{}, hint: h.hint, log: slog.New(slog.DiscardHandler)}
	gone, cancel := context.WithCancel(t.Context())
	cancel() // the client went away after the commit
	if _, err := c.Suspend(gone, operators.StatusChange{TenantID: uuid.New()}); err != nil {
		t.Fatal(err)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.deadlines) != 1 || h.deadlines[0] <= 0 || h.deadlines[0] > 2*time.Second {
		t.Fatalf("time left to the hint = %v, want a live deadline of at most 2s", h.deadlines)
	}
}
