//go:build integration

package pool_test

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W2.57, решение Q-W2.07-1 «только рейс»: временное назначение — системная роль «Временный водитель» в области self
// (рейс, его осмотры, расходы, брони и файлы) и та же роль в области resource на машину рейса; без задач, базы знаний,
// календаря, начислений, других машин и броней фирмы-получателя.

// temporaryRole is the live system role «Временный водитель» of the tenant (the approval creates it once).
func temporaryRole(t *testing.T) uuid.UUID {
	t.Helper()
	return scalar[uuid.UUID](t, `select id from access.roles where template_key = 'temporary_driver' and kind = 'system'
		and archived_at is null`)
}

// newVehicle registers a vehicle of company key.
func newVehicle(t *testing.T, key string) uuid.UUID {
	t.Helper()
	v := uuid.New()
	exec(t, `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm)
	         values ($1, $2, $3, 'van', 1500, 12, 3200)`, v, unit(key), fmt.Sprintf("В %03d ПЛ 77", seq.Add(1)%1000))
	return v
}

// assignVehicle puts vehicle v on the trip (assignTripVehicle of the logist, W2.03); uuid.Nil takes it off (the trip
// goes back to planning).
func assignVehicle(t *testing.T, tr trip, v uuid.UUID) {
	t.Helper()
	if v == uuid.Nil {
		exec(t, `update fleet.trips set vehicle_id = null, state = 'planned' where id = $1`, tr.ID)
		return
	}
	exec(t, `update fleet.trips set vehicle_id = $2, state = 'assigned' where id = $1`, tr.ID, v)
}

// vehicleGrant is the assignment of the vehicle of transfer id (fleet.driver_transfers.vehicle_assignment_id); nil —
// none.
func vehicleGrant(t *testing.T, id uuid.UUID) *grantRow {
	t.Helper()
	a := scalar[*uuid.UUID](t, `select vehicle_assignment_id from fleet.driver_transfers where id = $1`, id)
	if a == nil {
		return nil
	}
	g := assignmentRow(t, *a)
	return &g
}

// vehicleOf is the resource of vehicle v of company key with its object of the kind resource (the vehicles module).
func vehicleOf(key string, v uuid.UUID) authz.Resource {
	return authz.Resource{Unit: unit(key), Objects: map[string]uuid.UUID{authz.KindResource: v}}
}

// blocked reports whether a denial of action to the subject of tc is function_blocked (fleet.earnings.*, AUTH-05).
func (e *env) blocked(t *testing.T, tc tenantctx.TenantContext, action string, r authz.Resource) bool {
	t.Helper()
	return problem.Is(e.ev.Permit(t.Context(), tc, action, r), authz.CodeFunctionBlocked)
}

// Одобрение назначает системную роль «Временный водитель» — её версия несёт ровно действия шаблона каталога; вторая
// организация роли не создаёт: одобрения тенанта берут ту же роль.
func TestApproveGivesTheNarrowRole(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	mgr2 := e.tc(t, "a.manager-msk2")
	first := e.decide(t, mgr2, e.newDecision(t, "Узкая роль", 540*time.Hour).x, approve)
	second := e.decide(t, mgr2, e.newDecision(t, "Узкая роль 2", 550*time.Hour).x, approve)
	role := temporaryRole(t)
	var name, kind, list string
	if err := db(t).QueryRowContext(t.Context(), `select r.name, r.kind, array_to_string(v.actions, ',') from access.roles r
		join access.role_versions v on v.role_id = r.id and v.version = r.current_version where r.id = $1`, role).
		Scan(&name, &kind, &list); err != nil {
		t.Fatal(err)
	}
	actions := strings.Split(list, ",")
	want := slices.Sorted(slices.Values(pool.TemporaryDriverActions))
	slices.Sort(actions)
	expect(t, "the role «Временный водитель»", actions, name == "Временный водитель", kind == "system",
		slices.Equal(actions, want))
	for _, x := range []fleetapi.DriverTransfer{first, second} {
		g := grantOf(t, x)
		expect(t, "assignment of the role", g, g.role == role, g.scopeKind == "self", g.scopeRef == nil, g.source == "transfer")
	}
}

// Что назначение открывает в окне (бриф W2.57 §4 п. 2): рейс, который водитель ведёт, — чтение, старт, сдача, осмотр,
// расходы, файлы; не открывает задачи, базу знаний, календарь, машины фирмы без брони рейса, бронирование, другие рейсы
// фирмы и её филиал; начисления закрыты функцией. После окна не начатый рейс — 404.
func TestNarrowRoleExposure(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	c := e.newDecision(t, "Обозримый", 560*time.Hour)
	e.decide(t, e.tc(t, "a.manager-msk2"), c.x, approve)
	other := newTrip(t, "msk1", c.w, newDriver(t, "msk1", "Свой водитель Москвы-1"))
	branch := newBranch(t, "msk1")
	d := as(c.d)
	own := authz.Resource{Unit: c.tr.Unit, Persons: []uuid.UUID{c.d}}
	msk1 := authz.Resource{Unit: unit("msk1")}

	e.clock.Set(c.w.Start.Add(time.Hour))
	for _, a := range []string{"fleet.trips.read", "fleet.trips.start", "fleet.trips.return", "fleet.inspections.read",
		"fleet.inspections.submit", "fleet.expenses.read", "fleet.expenses.create", "fleet.reservations.read", "files.read",
		"files.upload", "fleet.routes.read"} {
		if !e.opens(t, d, a, own) {
			t.Errorf("%s on his trip in the window: denied, want allowed", a)
		}
	}
	for _, k := range []struct {
		action string
		r      authz.Resource
	}{
		{"tasks.read", own}, {"tasks.read", msk1}, {"knowledge.read", msk1}, {"calendar.availability.read", msk1},
		{"calendar.availability.read", own}, {"files.read", msk1}, {"fleet.vehicles.read", msk1},
		{"fleet.reservations.create", own}, {"fleet.reservations.manage", own}, {"fleet.trips.read", msk1},
		{"fleet.trips.read", authz.Resource{Unit: other.Unit, Persons: driverOf(t, other)}},
		{"fleet.trips.read", authz.Resource{Unit: branch}}, {"fleet.vehicles.read", authz.Resource{Unit: branch}},
	} {
		if e.opens(t, d, k.action, k.r) {
			t.Errorf("%s on %+v in the window: allowed, want 404 or 403 (Q-W2.07-1)", k.action, k.r)
		}
	}
	if !e.blocked(t, d, "fleet.earnings.read", own) {
		t.Error("fleet.earnings.read of the temporary driver: not closed by the function «Водитель» (AC-05)")
	}
	e.clock.Set(c.w.End.Add(time.Minute))
	if e.opens(t, d, "fleet.trips.read", own) {
		t.Error("the trip he did not start after the window: allowed, want 404 (AC-06)")
	}
}

// atMoment reports whether the bound p is the moment want (nil — an open bound — is none).
func atMoment(p *time.Time, want time.Time) bool { return p != nil && p.Equal(want) }

// seesVehicles requires that the subject of tc reads the vehicles of Москва-1 in want and none of not.
func (e *env) seesVehicles(t *testing.T, tc tenantctx.TenantContext, what string, want, not []uuid.UUID) {
	t.Helper()
	for _, v := range want {
		if !e.opens(t, tc, "fleet.vehicles.read", vehicleOf("msk1", v)) {
			t.Errorf("%s: the vehicle %s is denied, want allowed", what, v)
		}
	}
	for _, v := range not {
		if e.opens(t, tc, "fleet.vehicles.read", vehicleOf("msk1", v)) {
			t.Errorf("%s: the vehicle %s is allowed, want 404", what, v)
		}
	}
}

// settleTrip settles the transfers of tr at the clock of the test (the overlay after a command of the trip).
func (e *env) settleTrip(t *testing.T, tr trip) {
	t.Helper()
	if _, err := e.svc.SettleTrip(t.Context(), ref("tenant:a"), tr.ID); err != nil {
		t.Fatal(err)
	}
}

// Машина рейса — вторая строка роли в области resource (бриф W2.57 §2 п. 1): создаётся, когда у рейса есть машина,
// следует за машиной рейса (замена — прежняя закрыта, новая открыта; снятие — закрыта сейчас) и не переживает окно.
func TestVehicleGrantFollowsTheTrip(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	c := e.newDecision(t, "Машина рейса", 580*time.Hour)
	v1, v2 := newVehicle(t, "msk1"), newVehicle(t, "msk1")
	assignVehicle(t, c.tr, v1)
	x := e.decide(t, e.tc(t, "a.manager-msk2"), c.x, approve)
	g := vehicleGrant(t, x.Id)
	if g == nil {
		t.Fatal("no assignment of the vehicle of the trip after the approval")
	}
	expect(t, "assignment of the vehicle", g, g.principal == c.d, g.role == temporaryRole(t), g.scopeKind == "resource",
		g.scopeRef != nil && *g.scopeRef == v1, !g.descendants, g.source == "transfer", g.state == "active",
		atMoment(g.from, c.w.Start), atMoment(g.until, c.w.End))
	expect(t, "grant of the transfer", x.Grant, x.Grant != nil && x.Grant.VehicleId != nil && *x.Grant.VehicleId == v1)
	d := as(c.d)
	e.seesVehicles(t, d, "before the window", nil, []uuid.UUID{v1})
	e.clock.Set(c.w.Start.Add(time.Hour))
	e.seesVehicles(t, d, "in the window", []uuid.UUID{v1}, []uuid.UUID{v2})
	assignVehicle(t, c.tr, v2)
	e.settleTrip(t, c.tr)
	if old := assignmentRow(t, resourceAssignment(t, c.d, v1)); !atMoment(old.until, e.clock.Now()) {
		t.Errorf("assignment of the replaced vehicle ends at %v, want %v", old.until, e.clock.Now())
	}
	e.seesVehicles(t, d, "after the replacement", []uuid.UUID{v2}, []uuid.UUID{v1})
	assignVehicle(t, c.tr, uuid.Nil)
	e.clock.Set(e.clock.Now().Add(time.Minute))
	e.settleTrip(t, c.tr)
	e.seesVehicles(t, d, "after the release", nil, []uuid.UUID{v2})
	got, err := e.svc.Transfer(t.Context(), e.tc(t, "a.manager-msk1"), x.Id)
	expect(t, "grant without a vehicle", got, err == nil, got.Grant != nil && got.Grant.VehicleId == nil)
	assignVehicle(t, c.tr, v1)
	e.settleTrip(t, c.tr)
	e.seesVehicles(t, d, "the vehicle put on the trip again", []uuid.UUID{v1}, nil)
	e.clock.Set(c.w.End.Add(time.Minute))
	e.seesVehicles(t, d, "after the window (AC-06)", nil, []uuid.UUID{v1})
}

// resourceAssignment is the latest temporary assignment of person in scope resource on vehicle v.
func resourceAssignment(t *testing.T, person, v uuid.UUID) uuid.UUID {
	t.Helper()
	return scalar[uuid.UUID](t, `select id from access.role_assignments where principal_id = $1 and source = 'transfer'
		and scope_kind = 'resource' and scope_ref = $2 order by created_at desc, id desc limit 1`, person, v)
}

// Роль создаётся одна: одновременные одобрения в тенанте без неё создают одну роль «Временный водитель».
func TestApproveCreatesTheRoleOnce(t *testing.T) { //nolint:paralleltest // archives the role «Временный водитель» of the tenant
	e := newEnv(t)
	mgr2 := e.tc(t, "a.manager-msk2")
	a, b := e.newDecision(t, "Первая роль", 600*time.Hour), e.newDecision(t, "Вторая роль", 610*time.Hour)
	exec(t, `update access.roles set archived_at = now() where template_key = 'temporary_driver' and archived_at is null`)
	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i, c := range []decision{a, b} {
		wg.Go(func() {
			_, errs[i] = e.svc.Decide(t.Context(), mgr2, c.x.Id, etag(1), fleetapi.DriverTransferDecision{Decision: approve})
		})
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatalf("concurrent approvals in a tenant without the role: %v", err)
		}
	}
	if n := scalar[int](t, `select count(*) from access.roles where template_key = 'temporary_driver' and archived_at is null`); n != 1 {
		t.Fatalf("live roles «Временный водитель»: %d, want 1", n)
	}
}

// Имя роли занято своей ролью организации (без системной): одобрение — 409 invalid_transition с каноническим текстом
// кода, без подписи модуля; запрос остаётся открытым.
func TestApproveWithTheNameTaken(t *testing.T) { //nolint:paralleltest // archives the role «Временный водитель» of the tenant
	e := newEnv(t)
	c := e.newDecision(t, "Имя занято", 620*time.Hour)
	exec(t, `update access.roles set archived_at = now() where template_key = 'temporary_driver' and archived_at is null`)
	custom := scalar[uuid.UUID](t, `insert into access.roles (name, kind) values ('Временный водитель', 'custom') returning id`)
	t.Cleanup(func() {
		if _, err := db(t).ExecContext(context.WithoutCancel(t.Context()), `update access.roles set archived_at = now() where id = $1`,
			custom); err != nil {
			t.Error(err)
		}
	})
	_, err := e.svc.Decide(t.Context(), e.tc(t, "a.manager-msk2"), c.x.Id, etag(1), fleetapi.DriverTransferDecision{Decision: approve})
	if pe, ok := errors.AsType[*problem.Error](err); !ok || pe.Code != "invalid_transition" || pe.Detail != "" {
		t.Fatalf("approval with the name of the role taken: %v, want invalid_transition without a detail of the module", err)
	}
	wantStored(t, c.x.Id, "requested", 1)
}

// Шаблон изменился после первого одобрения в тенанте (роль несёт прежний набор действий): следующее одобрение добавляет
// роли версию с действиями шаблона и назначает её (Q-W2.57-7); набор шаблона — тот же, что у pool.TemporaryDriverActions.
func TestApproveFollowsTheTemplate(t *testing.T) { //nolint:paralleltest // replaces the role «Временный водитель» of the tenant
	e := newEnv(t)
	mgr2 := e.tc(t, "a.manager-msk2")
	c := e.newDecision(t, "Шаблон изменился", 630*time.Hour)
	exec(t, `update access.roles set archived_at = now() where template_key = 'temporary_driver' and archived_at is null`)
	old := scalar[uuid.UUID](t, `insert into access.roles (name, kind, template_key) values ('Временный водитель', 'system',
		'temporary_driver') returning id`)
	exec(t, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
		old, []string{"fleet.trips.read", "tasks.read"}, mgr2.PersonID)
	if _, err := e.svc.Decide(t.Context(), mgr2, c.x.Id, etag(1), fleetapi.DriverTransferDecision{Decision: approve}); err != nil {
		t.Fatal(err)
	}
	if got := temporaryRole(t); got != old {
		t.Fatalf("role %s, want the same role %s with a new version", got, old)
	}
	current := scalar[int](t, `select current_version from access.roles where id = $1`, old)
	version := scalar[int](t, `select ra.role_version from access.role_assignments ra
		join fleet.driver_transfers x on x.assignment_id = ra.id where x.id = $1`, c.x.Id)
	actions := scalar[string](t, `select array_to_string(array(select a from unnest(actions) a order by a collate "C"), ',')
		from access.role_versions where role_id = $1 and version = $2`, old, current)
	want := strings.Join(slices.Sorted(slices.Values(pool.TemporaryDriverActions)), ",")
	if current != 2 || version != 2 || actions != want {
		t.Fatalf("current version %d, assigned %d, actions %s; want 2, 2 and the template %s", current, version, actions, want)
	}
}
