//go:build integration

package pool_test

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const (
	textDecided     = "Запрос уже рассмотрен."
	textTripStarted = "Рейс уже начат или закрыт."
	textDriverBusy  = "Водитель уже назначен в это время."
)

const (
	approve = fleetapi.DriverTransferDecisionDecisionApprove
	reject  = fleetapi.DriverTransferDecisionDecisionReject
	revoke  = fleetapi.DriverTransferDecisionDecisionRevoke
)

// grantRow is the temporary assignment of a transfer (access.role_assignments).
type grantRow struct {
	principal, role, scopeRef uuid.UUID
	scopeKind, source, state  string
	descendants               bool
	from                      time.Time
	until                     *time.Time
}

func grantOf(t *testing.T, x fleetapi.DriverTransfer) grantRow {
	t.Helper()
	if x.Grant == nil {
		t.Fatalf("transfer %s has no grant: %+v", x.Id, x)
	}
	var g grantRow
	if err := db(t).QueryRowContext(t.Context(), `select principal_id, role_id, scope_ref, scope_kind, source, state,
		include_descendants, lower(valid), upper(valid) from access.role_assignments where id = $1`, x.Grant.AssignmentId).
		Scan(&g.principal, &g.role, &g.scopeRef, &g.scopeKind, &g.source, &g.state, &g.descendants, &g.from, &g.until); err != nil {
		t.Fatal(err)
	}
	return g
}

func tripDriver(t *testing.T, tr trip) *uuid.UUID {
	t.Helper()
	return scalar[*uuid.UUID](t, `select driver_person_id from fleet.trips where id = $1`, tr.ID)
}

// decision is a request of a published driver of Москва-2 by Москва-1 for a trip of its own.
type decision struct {
	d  uuid.UUID
	w  pool.Window
	tr trip
	x  fleetapi.DriverTransfer
}

func (e *env) newDecision(t *testing.T, name string, from time.Duration) decision {
	t.Helper()
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	d := newDriver(t, "msk2", name)
	e.publish(t, mgr2, d, "msk2", e.window(from, from+8*time.Hour))
	w := e.window(from+time.Hour, from+5*time.Hour)
	tr := newTrip(t, "msk1", w, uuid.Nil)
	return decision{d: d, w: w, tr: tr, x: e.request(t, mgr1, transferOf(d, "msk2", "msk1", w, &tr))}
}

// Решает фирма-источник (approve на домашнюю фирму водителя) или владелец, с If-Match: получатель — 403, третья
// фирма — 404, без If-Match — 428, устаревший — 412, неизвестное решение — 400.
func TestDecideChecks(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	x := e.newDecision(t, "Проверяемый", 160*time.Hour).x
	body := fleetapi.DriverTransferDecision{Decision: approve}
	mgr2 := e.tc(t, "a.manager-msk2")
	for _, c := range []struct {
		name, ifMatch string
		tc            tenantctx.TenantContext
		body          fleetapi.DriverTransferDecision
		code, detail  string
	}{
		{"фирма-получатель", etag(1), e.tc(t, "a.manager-msk1"), body, "forbidden_action", ""},
		{"третья фирма", etag(1), as(newManager(t, "msk3")), body, "not_found", textTransferNotFn},
		{"без If-Match", "", mgr2, body, "revision_required", ""},
		{"устаревший If-Match", etag(5), mgr2, body, "revision_mismatch", ""},
		{"неизвестное решение", etag(1), mgr2, fleetapi.DriverTransferDecision{Decision: "postpone"}, problem.CodeMalformedRequest, ""},
	} {
		_, err := e.svc.Decide(ctx, c.tc, x.Id, c.ifMatch, c.body)
		if pe, ok := errors.AsType[*problem.Error](err); !ok || pe.Code != c.code || (c.detail != "" && pe.Detail != c.detail) {
			t.Errorf("%s: %v, want %s %q", c.name, err, c.code, c.detail)
		}
	}
}

// S2-14, AUTH-07: одобрение создаёт временное назначение роли «Водитель» на подразделение рейса со сроком окна,
// ставит водителя на рейс, поднимает policy_version и уведомляет логистов фирмы-получателя; повтор — 409.
func TestApprove(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2 := e.tc(t, "a.manager-msk2")
	c := e.newDecision(t, "Одобряемый", 168*time.Hour)
	policy := scalar[int64](t, `select coalesce((select policy_version from access.policy_state), 0)`)
	comment := "Отпускаем до 18:00"
	got, err := e.svc.Decide(ctx, mgr2, c.x.Id, etag(1), fleetapi.DriverTransferDecision{Decision: approve, Comment: &comment})
	expect(t, "approved", got, err == nil, got.Status == pool.StatusApproved, got.Revision == 2,
		got.DecidedByMemberId != nil && *got.DecidedByMemberId == person("a.manager-msk2"), got.DecidedAt != nil,
		got.DecisionComment != nil && *got.DecisionComment == comment, got.Grant != nil)
	gr := got.Grant
	expect(t, "grant", gr, gr.OrgUnitId == unit("msk1"), gr.TripId != nil && *gr.TripId == c.tr.ID,
		gr.ValidFrom.Equal(c.w.Start), gr.ValidUntil.Equal(c.w.End), gr.State == fleetapi.TemporaryDriverGrantStateScheduled,
		gr.EndedAt == nil)
	row := grantOf(t, got)
	expect(t, "role assignment", row, row.principal == c.d, row.role == ref("role:a.driver"), row.scopeKind == "unit",
		row.scopeRef == c.tr.Unit, !row.descendants, row.source == "transfer", row.state == "active", row.from.Equal(c.w.Start),
		row.until != nil && row.until.Equal(c.w.End))
	if p := tripDriver(t, c.tr); p == nil || *p != c.d {
		t.Fatalf("driver of the trip after the approval: %v, want %s", p, c.d)
	}
	if v := scalar[int64](t, `select coalesce((select policy_version from access.policy_state), 0)`); v <= policy {
		t.Errorf("policy_version %d after the approval, want > %d", v, policy)
	}
	if n := scalar[int](t, `select count(*) from outbox.events where type = 'access.policy.bumped.v1'
		 and payload->'personIds' ? $1::text`, c.d.String()); n == 0 {
		t.Error("no access.policy.bumped.v1 for the driver")
	}
	if n := scalar[int](t, `select count(*) from notify.notifications where recipient_person_id = $1 and kind = 'fleet.driver_transfer.decided'
		 and title = 'Запрос водителя ' || $2 || ' одобрен фирмой Москва-2' and entity_id = $3`,
		person("a.manager-msk1"), *c.x.DriverDisplayName, c.x.Id); n != 1 {
		t.Errorf("notifications of the logist of Москва-1: %d, want 1", n)
	}
	if read, err := e.svc.Transfer(ctx, e.tc(t, "a.manager-msk1"), c.x.Id); err != nil || read.Revision != 2 || read.Grant == nil {
		t.Fatalf("getDriverTransfer after the approval: %v %+v", err, read)
	}
	_, err = e.svc.Decide(ctx, mgr2, c.x.Id, etag(2), fleetapi.DriverTransferDecision{Decision: approve})
	wantProblem(t, err, "invalid_transition", textDecided)
}

// Отзыв закрывает назначение моментом отзыва, хранит, кто отозвал (одобривший остаётся), и снимает водителя с не
// начатого рейса; повторный отзыв — 409. Отказ — без назначения, с комментарием.
func TestRevokeAndReject(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2 := e.tc(t, "a.manager-msk2")
	c := e.newDecision(t, "Отзываемый в окне", 176*time.Hour)
	e.decide(t, mgr2, c.x, approve)
	e.clock.Set(c.w.Start.Add(time.Hour))
	revoked, err := e.svc.Decide(ctx, mgr2, c.x.Id, etag(2), fleetapi.DriverTransferDecision{Decision: revoke})
	expect(t, "revoked", revoked, err == nil, revoked.Status == pool.StatusRevoked, revoked.Revision == 3,
		revoked.RevokedByMemberId != nil && *revoked.RevokedByMemberId == person("a.manager-msk2"),
		revoked.DecidedByMemberId != nil && *revoked.DecidedByMemberId == person("a.manager-msk2"),
		revoked.CompletedAt != nil && revoked.CompletedAt.Equal(e.clock.Now()), revoked.Grant != nil &&
			revoked.Grant.State == fleetapi.TemporaryDriverGrantStateEnded && revoked.Grant.EndReason != nil &&
			*revoked.Grant.EndReason == fleetapi.TemporaryDriverGrantEndReasonRevoked)
	row := grantOf(t, revoked)
	expect(t, "revoked assignment", row, row.state == "revoked", row.until != nil && row.until.Equal(e.clock.Now()))
	if p := tripDriver(t, c.tr); p != nil {
		t.Fatalf("driver of the trip after the revocation: %v, want none", *p)
	}
	_, err = e.svc.Decide(ctx, mgr2, c.x.Id, etag(3), fleetapi.DriverTransferDecision{Decision: revoke})
	wantProblem(t, err, "invalid_transition", textDecided)

	later := pool.Window{Start: c.w.Start.Add(2 * time.Hour), End: c.w.End}
	y := e.request(t, e.tc(t, "a.manager-msk1"), transferOf(c.d, "msk2", "msk1", later, nil))
	no := "Водитель нужен своей фирме"
	rejected, err := e.svc.Decide(ctx, e.tc(t, "a.owner"), y.Id, etag(1), fleetapi.DriverTransferDecision{Decision: reject, Comment: &no})
	expect(t, "rejected", rejected, err == nil, rejected.Status == pool.StatusRejected, rejected.Grant == nil,
		rejected.DecisionComment != nil && *rejected.DecisionComment == no, rejected.DecidedAt != nil)
}

// Одобрение перепроверяет рейс и занятость водителя (Q-W2.51-12, описание decideDriverTransfer): у рейса уже другой
// водитель — 409; рейс начат или закрыт — 409; одобренный пересекающийся запрос того же водителя — 409
// resources_unavailable; истёкший к началу окна запрос — 409.
func TestApproveRechecks(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	d := newDriver(t, "msk2", "Перепроверяемый")
	e.publish(t, mgr2, d, "msk2", e.window(192*time.Hour, 200*time.Hour))
	w := e.window(193*time.Hour, 196*time.Hour)

	tr := newTrip(t, "msk1", w, uuid.Nil)
	x := e.request(t, mgr1, transferOf(d, "msk2", "msk1", w, &tr))
	exec(t, `update fleet.trips set driver_person_id = $2 where id = $1`, tr.ID, newDriver(t, "msk1", "Нашёлся свой"))
	_, err := e.svc.Decide(t.Context(), mgr2, x.Id, etag(1), fleetapi.DriverTransferDecision{Decision: approve})
	wantProblem(t, err, "invalid_transition", textTripDriver)
	exec(t, `update fleet.trips set driver_person_id = null, state = 'inspection' where id = $1`, tr.ID)
	_, err = e.svc.Decide(t.Context(), mgr2, x.Id, etag(1), fleetapi.DriverTransferDecision{Decision: approve})
	wantProblem(t, err, "invalid_transition", textTripStarted)
	e.decide(t, mgr2, x, reject)

	first := e.request(t, mgr1, transferOf(d, "msk2", "msk1", w, nil))
	e.decide(t, mgr2, first, approve)
	second := e.request(t, mgr1, transferOf(d, "msk2", "msk1", e.window(195*time.Hour, 198*time.Hour), nil))
	_, err = e.svc.Decide(t.Context(), mgr2, second.Id, etag(1), fleetapi.DriverTransferDecision{Decision: approve})
	wantProblem(t, err, "resources_unavailable", textDriverBusy)

	e.clock.Set(e.t0.Add(195 * time.Hour))
	late, err := e.svc.Transfer(t.Context(), mgr2, second.Id)
	expect(t, "request after the start of its window", late, err == nil, late.Status == pool.StatusExpired, late.Revision == 2)
	_, err = e.svc.Decide(t.Context(), mgr2, second.Id, etag(2), fleetapi.DriverTransferDecision{Decision: approve})
	wantProblem(t, err, "invalid_transition", textDecided)
}

// Организация без живой роли «Водитель» (шаблон driver архивирован): одобрение — 409 invalid_transition с каноническим
// текстом кода, без придуманной модулем подписи; запрос остаётся открытым.
func TestApproveWithoutDriverRole(t *testing.T) { //nolint:paralleltest // archives the role «Водитель» of the tenant for a while
	e := newEnv(t)
	c := e.newDecision(t, "Без роли", 500*time.Hour)
	exec(t, `update access.roles set archived_at = now() where id = $1`, ref("role:a.driver"))
	t.Cleanup(func() {
		if _, err := db(t).ExecContext(context.WithoutCancel(t.Context()), `update access.roles set archived_at = null where id = $1`,
			ref("role:a.driver")); err != nil {
			t.Error(err)
		}
	})
	_, err := e.svc.Decide(t.Context(), e.tc(t, "a.manager-msk2"), c.x.Id, etag(1), fleetapi.DriverTransferDecision{Decision: approve})
	if pe, ok := errors.AsType[*problem.Error](err); !ok || pe.Code != "invalid_transition" || pe.Detail != "" {
		t.Fatalf("approval without the role «Водитель»: %v, want invalid_transition without a detail of the module", err)
	}
	wantStored(t, c.x.Id, "requested", 1)
}

// askedRecipients records the people the module resolves through the control DB.
type askedRecipients struct {
	inner inbox.Recipients
	mu    sync.Mutex
	asked map[uuid.UUID]bool
}

func (r *askedRecipients) Recipient(ctx context.Context, tenant, person uuid.UUID) (tenantctx.TenantContext, error) {
	r.mu.Lock()
	r.asked[person] = true
	r.mu.Unlock()
	return r.inner.Recipient(ctx, tenant, person)
}

// Q-W2.07-8: о решении узнают логисты фирмы-получателя и владелец; control DB модуль спрашивает только о держателях
// fleet.driver_transfers.request и о владельцах, а не о каждом человеке организации.
func TestNotifyAsksOnlyCandidates(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	asked := &askedRecipients{inner: e.svc.Recipients, asked: map[uuid.UUID]bool{}}
	e.svc.Recipients = asked
	c := e.newDecision(t, "Уведомляемый", 480*time.Hour)
	x := e.decide(t, e.tc(t, "a.manager-msk2"), c.x, approve)
	for name, p := range map[string]uuid.UUID{"the driver": c.d, "a driver of Москва-1": person("a.driver-msk1")} {
		if asked.asked[p] {
			t.Errorf("the module resolves %s without fleet.driver_transfers.request through the control DB", name)
		}
	}
	for _, actor := range []string{"a.manager-msk1", "a.owner"} {
		if n := scalar[int](t, `select count(*) from notify.notifications where recipient_person_id = $1
			 and kind = 'fleet.driver_transfer.decided' and entity_id = $2`, person(actor), x.Id); n != 1 {
			t.Errorf("notifications of %s about the decision: %d, want 1", actor, n)
		}
	}
}

// AC-06: менеджер фирмы-источника и владелец одобряют один запрос в один момент — одно временное назначение, второе
// решение — 409 или 412; запрос одобрен один раз.
func TestConcurrentApprovals(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	mgr2, mgr1, owner := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1"), e.tc(t, "a.owner")
	for i := range 5 {
		d := newDriver(t, "msk2", "Гонка")
		base := time.Duration(216+i*10) * time.Hour
		e.publish(t, mgr2, d, "msk2", e.window(base, base+8*time.Hour))
		x := e.request(t, mgr1, transferOf(d, "msk2", "msk1", e.window(base+time.Hour, base+3*time.Hour), nil))
		var wg sync.WaitGroup
		errs := make([]error, 2)
		for j, tc := range []tenantctx.TenantContext{mgr2, owner} {
			wg.Go(func() {
				_, errs[j] = e.svc.Decide(t.Context(), tc, x.Id, etag(1),
					fleetapi.DriverTransferDecision{Decision: approve})
			})
		}
		wg.Wait()
		ok, lost := 0, 0
		for _, err := range errs {
			switch {
			case err == nil:
				ok++
			case problem.Is(err, "invalid_transition"), problem.Is(err, "revision_mismatch"):
				lost++
			default:
				t.Fatalf("round %d: %v", i, err)
			}
		}
		n := scalar[int](t, `select count(*) from access.role_assignments where principal_id = $1 and source = 'transfer'`, d)
		got, err := e.svc.Transfer(t.Context(), mgr1, x.Id)
		expect(t, "two approvals of one request", errs, ok == 1, lost == 1, n == 1, err == nil,
			got.Status == pool.StatusApproved, got.Revision == 2)
	}
}
