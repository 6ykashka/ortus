//go:build integration

package pool_test

import (
	"errors"
	"testing"
	"time"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Продление (W2.57, 08-domain-scenarios §4.6 п. 7, описание decideDriverTransfer): решение extend фирмы-источника с
// новым концом окна endsAt — тем же порядком проверок, что одобрение.

const extend = fleetapi.DriverTransferDecisionDecisionExtend

// extendTo is the decision extend of the transfer to until.
func extendTo(until time.Time) fleetapi.DriverTransferDecision {
	return fleetapi.DriverTransferDecision{Decision: extend, EndsAt: &until}
}

// Порядок проверок продления: форма тела (endsAt без extend и extend без endsAt) — 422 до остальных; невидимый —
// 404; без approve над фирмой-источником — 403; If-Match; не одобренный — 409; конец не позже нынешнего — 422 «Проверьте
// срок.»; не позже сейчас — 422 «Окно уже прошло.»; вне свободного окна — 422; водитель занят в добавленном отрезке —
// 409 resources_unavailable.
func TestExtendChecks(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	c := e.newDecision(t, "Продлеваемый", 740*time.Hour) // free [740 h, 748 h), window [741 h, 745 h)
	later := c.w.End.Add(time.Hour)
	_, err := e.svc.Decide(ctx, mgr2, c.x.Id, etag(1), fleetapi.DriverTransferDecision{Decision: extend})
	wantProblem(t, err, "validation_failed", textWindow)
	_, err = e.svc.Decide(ctx, mgr2, c.x.Id, etag(1), fleetapi.DriverTransferDecision{Decision: approve, EndsAt: &later})
	wantProblem(t, err, "validation_failed", textWindow)
	_, err = e.svc.Decide(ctx, mgr2, c.x.Id, etag(1), extendTo(later))
	wantProblem(t, err, "invalid_transition", textDecided)

	x := e.decide(t, mgr2, c.x, approve)
	for _, k := range []struct {
		name, ifMatch string
		tc            tenantctx.TenantContext
		until         time.Time
		code, detail  string
	}{
		{"фирма-получатель", etag(2), mgr1, later, "forbidden_action", ""},
		{"третья фирма", etag(2), as(newManager(t, "msk3")), later, "not_found", textTransferNotFn},
		{"устаревший If-Match", etag(1), mgr2, later, "revision_mismatch", ""},
		{"не позже нынешнего конца", etag(2), mgr2, c.w.End, "validation_failed", textWindow},
		{"вне свободного окна", etag(2), mgr2, c.w.End.Add(4 * time.Hour), "validation_failed", textOutside},
	} {
		_, err := e.svc.Decide(ctx, k.tc, x.Id, k.ifMatch, extendTo(k.until))
		if pe, ok := errors.AsType[*problem.Error](err); !ok || pe.Code != k.code || (k.detail != "" && pe.Detail != k.detail) {
			t.Errorf("%s: %v, want %s %q", k.name, err, k.code, k.detail)
		}
	}
	busy := e.request(t, mgr1, transferOf(c.d, "msk2", "msk1", pool.Window{Start: c.w.End, End: c.w.End.Add(2 * time.Hour)}, nil))
	e.decide(t, mgr2, busy, approve)
	_, err = e.svc.Decide(ctx, mgr2, x.Id, etag(2), extendTo(later))
	wantProblem(t, err, "resources_unavailable", textDriverBusy)
	e.decide(t, mgr2, x, revoke)
	_, err = e.svc.Decide(ctx, mgr2, x.Id, etag(3), extendTo(later))
	wantProblem(t, err, "invalid_transition", textDecided)
}

// Продление сдвигает конец окна, срок назначения и машины рейса; ревизия +1, policy_version поднята, аудит и событие
// решения extend; одобривший остаётся автором решения.
func TestExtend(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2 := e.tc(t, "a.manager-msk2")
	c := e.newDecision(t, "Продлённый", 760*time.Hour)
	assignVehicle(t, c.tr, newVehicle(t, "msk1"))
	x := e.decide(t, mgr2, c.x, approve)
	policy := scalar[int64](t, `select coalesce((select policy_version from access.policy_state), 0)`)
	until := c.w.End.Add(2 * time.Hour)
	got, err := e.svc.Decide(ctx, e.tc(t, "a.owner"), x.Id, etag(2), extendTo(until))
	expect(t, "extended", got, err == nil, got.Status == pool.StatusApproved, got.Revision == 3, got.Window.EndsAt.Equal(until),
		got.Window.StartsAt.Equal(c.w.Start), got.Grant != nil && got.Grant.ValidUntil.Equal(until),
		got.DecidedByMemberId != nil && *got.DecidedByMemberId == person("a.manager-msk2"))
	if g := grantOf(t, got); g.until == nil || !g.until.Equal(until) {
		t.Fatalf("assignment after the extension ends at %v, want %v", g.until, until)
	}
	if v := vehicleGrant(t, x.Id); v == nil || v.until == nil || !v.until.Equal(until) {
		t.Fatalf("assignment of the vehicle after the extension: %+v, want until %v", v, until)
	}
	if v := scalar[int64](t, `select coalesce((select policy_version from access.policy_state), 0)`); v <= policy {
		t.Errorf("policy_version %d after the extension, want > %d", v, policy)
	}
	if n := scalar[int](t, `select count(*) from outbox.events where type = 'fleet.driver_transfer.decided.v1'
		and payload->>'id' = $1 and payload->>'decision' = 'extend' and payload->>'endsAt' is not null`, x.Id.String()); n != 1 {
		t.Errorf("fleet.driver_transfer.decided.v1 of the extension: %d, want 1", n)
	}
	if n := scalar[int](t, `select count(*) from audit.events where action = 'fleet.driver_transfer.decide'
		and target_id = $1 and diff->>'decision' = 'extend'`, x.Id); n != 1 {
		t.Errorf("audit of the extension: %d, want 1", n)
	}
}

// Просрочка (closing начатого рейса после окна) видна обеим фирмам; продление в closing снова открывает назначение:
// active, машина рейса — до нового конца.
func TestExtendWhileClosing(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	c, x := e.startedDecision(t, "Просроченный", 780*time.Hour)
	e.clock.Set(c.w.End.Add(30 * time.Minute))
	for _, actor := range []string{"a.manager-msk1", "a.manager-msk2"} {
		got, err := e.svc.Transfer(ctx, e.tc(t, actor), x.Id)
		expect(t, "overdue for "+actor, got, err == nil, got.Grant != nil &&
			got.Grant.State == fleetapi.TemporaryDriverGrantStateClosing && got.Grant.Overdue != nil && *got.Grant.Overdue)
	}
	vehicle := scalar[string](t, `select vehicle_id::text from fleet.trips where id = $1`, c.tr.ID)
	_, err := e.svc.Decide(ctx, e.tc(t, "a.manager-msk2"), x.Id, etag(2), extendTo(c.w.End.Add(20*time.Minute)))
	wantProblem(t, err, "validation_failed", textPast)
	until := c.w.End.Add(2 * time.Hour)
	got, err := e.svc.Decide(ctx, e.tc(t, "a.manager-msk2"), x.Id, etag(2), extendTo(until))
	expect(t, "extended while closing", got, err == nil, got.Grant != nil &&
		got.Grant.State == fleetapi.TemporaryDriverGrantStateActive && got.Grant.Overdue == nil &&
		got.Grant.VehicleId != nil && got.Grant.VehicleId.String() == vehicle)
	if v := vehicleGrant(t, x.Id); v == nil || v.until == nil || !v.until.Equal(until) {
		t.Fatalf("assignment of the vehicle after the extension: %+v, want until %v", v, until)
	}
}
