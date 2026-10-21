//go:build integration

package pool_test

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// sees reports whether the subject of tc reads the trip tr (fleet.trips.read over its unit and its driver — the
// resource of the trip modules W2.03–W2.06); a denial must be 404, as a missing trip (AC-01).
func (e *env) sees(t *testing.T, tc tenantctx.TenantContext, tr trip) bool {
	t.Helper()
	err := e.ev.Permit(t.Context(), tc, "fleet.trips.read", authz.Resource{Unit: tr.Unit, Persons: driverOf(t, tr)})
	if err != nil && !problem.Is(err, problem.CodeNotFound) {
		t.Fatalf("permit fleet.trips.read: %v, want nil or not_found", err)
	}
	return err == nil
}

func driverOf(t *testing.T, tr trip) []uuid.UUID {
	t.Helper()
	if p := tripDriver(t, tr); p != nil {
		return []uuid.UUID{*p}
	}
	return nil
}

// inCatalog reports whether driver is in the catalog of the subject of tc for w.
func (e *env) inCatalog(t *testing.T, tc tenantctx.TenantContext, w pool.Window, driver uuid.UUID) bool {
	t.Helper()
	page, err := e.svc.Catalog(t.Context(), tc, fleetapi.ListAvailableDriversParams{AvailableFrom: w.Start, AvailableUntil: w.End})
	if err != nil {
		t.Fatalf("listAvailableDrivers: %v", err)
	}
	for _, it := range page.Items {
		if it.DriverMemberId == driver {
			return true
		}
	}
	return false
}

// listed reports whether transfer id is in listDriverTransfers of the subject of tc with params, on any page (the
// tests of the package request many drivers of the same companies).
func (e *env) listed(t *testing.T, tc tenantctx.TenantContext, params fleetapi.ListDriverTransfersParams, id uuid.UUID) bool {
	t.Helper()
	for {
		page, err := e.svc.Transfers(t.Context(), tc, params)
		if err != nil {
			t.Fatalf("listDriverTransfers: %v", err)
		}
		for _, it := range page.Items {
			if it.Id == id {
				return true
			}
		}
		if page.NextCursor == nil {
			return false
		}
		params.Cursor = page.NextCursor
	}
}

// wantStored requires the state and the revision of a transfer in the database.
func wantStored(t *testing.T, id uuid.UUID, state string, revision int64) {
	t.Helper()
	var (
		s   string
		rev int64
	)
	if err := db(t).QueryRowContext(t.Context(), `select state, revision from fleet.driver_transfers where id = $1`, id).
		Scan(&s, &rev); err != nil {
		t.Fatal(err)
	}
	if s != state || rev != revision {
		t.Fatalf("stored transfer: %s rev %d, want %s rev %d", s, rev, state, revision)
	}
}

// «Фирма без grant не видит водителя» (AUTH-06, AC-01, Q-W2.51-5): третья фирма не видит ни запроса, ни публикации,
// ни рейса с временным водителем, а занятого водителя нет в её каталоге; водитель без одобрения не видит рейс и машины
// фирмы-получателя.
func TestNoGrantNoDriver(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	third := as(newManager(t, "msk3"))
	d := newDriver(t, "msk2", "Невидимый Пётр")
	p := e.publish(t, mgr2, d, "msk2", e.window(288*time.Hour, 296*time.Hour))
	w := e.window(289*time.Hour, 293*time.Hour)
	tr := newTrip(t, "msk1", w, uuid.Nil)
	x := e.request(t, mgr1, transferOf(d, "msk2", "msk1", w, &tr))

	if e.sees(t, as(d), tr) {
		t.Fatal("the driver sees the trip of Москва-1 before the approval")
	}
	if err := e.ev.Permit(ctx, as(d), "fleet.vehicles.read", authz.Resource{Unit: unit("msk1")}); !problem.Is(err, problem.CodeNotFound) {
		t.Fatalf("vehicles of Москва-1 for the driver before the approval: %v, want not_found", err)
	}
	if !e.inCatalog(t, third, w, d) {
		t.Fatal("the published free driver is not in the catalog of a third company")
	}
	x = e.decide(t, mgr2, x, approve)

	_, err := e.svc.Transfer(ctx, third, x.Id)
	wantProblem(t, err, "not_found", textTransferNotFn)
	if e.listed(t, third, fleetapi.ListDriverTransfersParams{}, x.Id) {
		t.Fatal("a third company lists the transfer")
	}
	_, err = e.svc.Publication(ctx, third, p.Id)
	wantProblem(t, err, "not_found", textNotFound)
	_, err = e.svc.Publication(ctx, mgr1, p.Id)
	wantProblem(t, err, "not_found", textNotFound)
	if e.inCatalog(t, third, w, d) {
		t.Error("the catalog of a third company shows the driver busy in the window")
	}
	if e.sees(t, third, tr) {
		t.Error("a third company sees the trip of Москва-1")
	}
}

// Q-W2.51-5, AC-02: фирма-получатель и третья фирма не разрешают id временного водителя через людей его фирмы
// (members.read — 404, как отсутствующий); другая организация не видит ни запроса, ни публикации.
func TestDriverReferenceStaysOpaque(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	d := newDriver(t, "msk2", "Непрозрачный")
	p := e.publish(t, mgr2, d, "msk2", e.window(300*time.Hour, 306*time.Hour))
	x := e.decide(t, mgr2, e.request(t, mgr1, transferOf(d, "msk2", "msk1", e.window(301*time.Hour, 303*time.Hour), nil)), approve)
	for name, tc := range map[string]tenantctx.TenantContext{"Москва-1": mgr1, "третья фирма": as(newManager(t, "msk3"))} {
		err := e.ev.Permit(ctx, tc, "members.read", authz.Resource{Unit: unit("msk2"), Persons: []uuid.UUID{d}})
		if !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s resolves the driver of Москва-2 through members.read: %v, want not_found", name, err)
		}
	}
	foreign := e.tc(t, "b.owner", "b")
	_, err := e.svc.Transfer(ctx, foreign, x.Id)
	wantProblem(t, err, "not_found", textTransferNotFn)
	_, err = e.svc.Publication(ctx, foreign, p.Id)
	wantProblem(t, err, "not_found", textNotFound)
}

// AC-06, Q-W2.51-15: временное назначение открывает рейс водителю только в окне — до окна и после него рейс отвечает
// 404, как несуществующий, даже без воркера (шлюз по upper(valid)); досчёт завершает назначение и снимает водителя с не
// начатого рейса.
func TestTemporaryGrantWindow(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	d := newDriver(t, "msk2", "Временный Илья")
	e.publish(t, mgr2, d, "msk2", e.window(30*time.Minute, 5*time.Hour))
	w := e.window(time.Hour, 3*time.Hour)
	tr := newTrip(t, "msk1", w, uuid.Nil)
	x := e.decide(t, mgr2, e.request(t, mgr1, transferOf(d, "msk2", "msk1", w, &tr)), approve)
	if e.sees(t, as(d), tr) {
		t.Fatal("the driver sees the trip before the window (scheduled)")
	}
	e.clock.Set(e.t0.Add(90 * time.Minute))
	if !e.sees(t, as(d), tr) {
		t.Fatal("the driver does not see the trip in the window")
	}
	if err := e.ev.Permit(ctx, as(d), "fleet.vehicles.read", authz.Resource{Unit: unit("msk3")}); err == nil {
		t.Fatal("the temporary assignment opens another company")
	}
	got, err := e.svc.Transfer(ctx, mgr1, x.Id)
	expect(t, "active", got, err == nil, got.Grant != nil && got.Grant.State == fleetapi.TemporaryDriverGrantStateActive)

	e.clock.Set(w.End.Add(time.Minute))
	if e.sees(t, as(d), tr) {
		t.Fatal("the driver sees the trip after the window before any settlement (AC-06)")
	}
	got, err = e.svc.Transfer(ctx, mgr1, x.Id)
	expect(t, "completed on read", got, err == nil, got.Status == pool.StatusCompleted, got.Revision == 3,
		got.CompletedAt != nil && got.CompletedAt.Equal(w.End), got.Grant != nil &&
			got.Grant.State == fleetapi.TemporaryDriverGrantStateEnded && got.Grant.EndReason != nil &&
			*got.Grant.EndReason == fleetapi.TemporaryDriverGrantEndReasonCompleted)
	res, err := e.svc.SettleTenant(ctx, ref("tenant:a"))
	expect(t, "settlement", res, err == nil, res.Completed >= 1, res.Unassigned >= 1)
	wantStored(t, x.Id, "completed", 3)

	if p := tripDriver(t, tr); p != nil {
		t.Fatal("the temporary driver stays on the trip he did not start")
	}
	again, err := e.svc.Transfer(ctx, mgr1, x.Id)
	expect(t, "read after the settlement", again, err == nil, again.Revision == 3)
}

// AC-06: отзыв закрывает временному водителю рейс сразу, в окне.
func TestRevocationClosesTheTrip(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	d := newDriver(t, "msk2", "Отзываемый")
	e.publish(t, mgr2, d, "msk2", e.window(4*time.Hour, 9*time.Hour))
	w := e.window(5*time.Hour, 8*time.Hour)
	tr := newTrip(t, "msk1", w, uuid.Nil)
	y := e.decide(t, mgr2, e.request(t, mgr1, transferOf(d, "msk2", "msk1", w, &tr)), approve)
	e.clock.Set(w.Start.Add(time.Hour))
	if !e.sees(t, as(d), tr) {
		t.Fatal("the driver does not see his trip in the window")
	}
	e.decide(t, mgr2, y, revoke)
	if e.sees(t, as(d), tr) {
		t.Fatal("the driver sees the trip after the revocation (AC-06)")
	}
}

// D09, Q-W2.51-4, Q-W2.51-15: начатый в окне рейс держит назначение (closing) после окна — водитель доводит, сдаёт и
// дорабатывает рейс; приёмка закрывает доступ моментом приёмки и завершает назначение (completedAt — приёмка).
func TestClosingUntilAcceptance(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	d := newDriver(t, "msk2", "Закрывающий")
	e.publish(t, mgr2, d, "msk2", e.window(312*time.Hour, 320*time.Hour))
	w := e.window(313*time.Hour, 316*time.Hour)
	tr := newTrip(t, "msk1", w, uuid.Nil)
	x := e.decide(t, mgr2, e.request(t, mgr1, transferOf(d, "msk2", "msk1", w, &tr)), approve)
	e.clock.Set(w.Start.Add(30 * time.Minute))
	startTrip(t, tr, "on_route", e.clock.Now())
	res, err := e.svc.SettleTenant(ctx, ref("tenant:a"))
	expect(t, "settlement after the start", res, err == nil, res.Opened >= 1)
	if until := grantOf(t, x).until; until != nil {
		t.Fatalf("grant of a started trip ends at %v, want open", *until)
	}

	e.clock.Set(w.End.Add(time.Hour))
	exec(t, `update fleet.trips set state = 'rework' where id = $1`, tr.ID)
	if !e.sees(t, as(d), tr) {
		t.Fatal("the driver does not see his started trip after the window (closing, D09)")
	}
	got, err := e.svc.Transfer(ctx, mgr1, x.Id)
	expect(t, "closing", got, err == nil, got.Status == pool.StatusApproved,
		got.Grant != nil && got.Grant.State == fleetapi.TemporaryDriverGrantStateClosing)

	accepted := w.End.Add(90 * time.Minute)
	exec(t, `update fleet.trips set state = 'accepted', reviewed_at = $2 where id = $1`, tr.ID, accepted)
	e.clock.Set(accepted.Add(5 * time.Minute))
	got, err = e.svc.Transfer(ctx, mgr1, x.Id)
	expect(t, "completed at the acceptance", got, err == nil, got.Status == pool.StatusCompleted,
		got.CompletedAt != nil && got.CompletedAt.Equal(accepted))
	if _, err := e.svc.SettleTenant(ctx, ref("tenant:a")); err != nil {
		t.Fatal(err)
	}
	if until := grantOf(t, x).until; until == nil || !until.Equal(accepted) {
		t.Fatalf("grant after the acceptance ends at %v, want %v", until, accepted)
	}
	if e.sees(t, as(d), tr) {
		t.Fatal("the driver sees the accepted trip after the completion (AC-06)")
	}
	if p := tripDriver(t, tr); p == nil || *p != d {
		t.Fatal("the history of the accepted trip lost its driver")
	}
}

// opens reports whether the subject of tc may apply action to r; a denial must be 404 or 403 (AC-01).
func (e *env) opens(t *testing.T, tc tenantctx.TenantContext, action string, r authz.Resource) bool {
	t.Helper()
	err := e.ev.Permit(t.Context(), tc, action, r)
	if err != nil && !problem.Is(err, problem.CodeNotFound) && !problem.Is(err, problem.CodeForbiddenAction) {
		t.Fatalf("permit %s: %v, want nil, not_found or forbidden_action", action, err)
	}
	return err == nil
}

// newBranch registers a branch of company key (org.units and its closure).
func newBranch(t *testing.T, key string) uuid.UUID {
	t.Helper()
	parent := unit(key)
	b := scalar[uuid.UUID](t, `insert into org.units (parent_id, kind, name, time_zone) values ($1, 'branch', $2, 'Europe/Moscow')
		returning id`, parent, fmt.Sprintf("Филиал %s-%d", key, seq.Add(1)))
	exec(t, `insert into org.unit_closure (ancestor_id, descendant_id, depth)
		select ancestor_id, $2::uuid, depth + 1 from org.unit_closure where descendant_id = $1::uuid
		union all select $2::uuid, $2::uuid, 0`, parent, b)
	return b
}

// newSelfDriver registers a person of company home with the function «Водитель» and the role «Водитель» in the scope
// self (default_scope of the template; a.driver-msk2 of the fixtures W1.04).
func newSelfDriver(t *testing.T, home, name string) uuid.UUID {
	t.Helper()
	p := newPerson(t, home, name)
	exec(t, `insert into people.work_profiles (person_id, function, unit_id, valid) values ($1, 'driver', $2, tstzrange($3, null))`,
		p, unit(home), since())
	exec(t, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind,
		valid, granted_by, reason) values ('person', $1, $2, 1, 'self', tstzrange($3, null), $1, 'pool test')`,
		p, ref("role:a.driver"), since())
	return p
}

// Q-W2.07-10: домашняя роль «Водитель» в области self открывает рейс, где человек — водитель, без временного
// назначения. Одобрение ставит его на рейс сразу — рейс виден до окна; после окна не начатый рейс виден до досчёта
// (снятие с рейса — досчёт воркера или команды), после досчёта и после отзыва — 404 (AC-06).
func TestSelfScopedHomeDriver(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	d := newSelfDriver(t, "msk2", "Свой рейс")
	e.publish(t, mgr2, d, "msk2", e.window(380*time.Hour, 392*time.Hour))
	w := e.window(381*time.Hour, 384*time.Hour)
	tr := newTrip(t, "msk1", w, uuid.Nil)
	e.decide(t, mgr2, e.request(t, mgr1, transferOf(d, "msk2", "msk1", w, &tr)), approve)
	if !e.sees(t, as(d), tr) {
		t.Fatal("a self-scoped driver does not see the trip he was put on before the window")
	}
	if e.opens(t, as(d), "fleet.vehicles.read", authz.Resource{Unit: unit("msk1")}) {
		t.Fatal("a self-scoped driver sees the vehicles of Москва-1 before the window")
	}
	e.clock.Set(w.End.Add(time.Minute))
	if !e.sees(t, as(d), tr) {
		t.Fatal("a self-scoped driver lost the trip after the window before the settlement: the pin is stale")
	}
	if _, err := e.svc.SettleTenant(ctx, ref("tenant:a")); err != nil {
		t.Fatal(err)
	}
	if e.sees(t, as(d), tr) {
		t.Fatal("a self-scoped driver sees the trip he did not start after the settlement (AC-06)")
	}

	rw := e.window(386*time.Hour, 389*time.Hour)
	other := newTrip(t, "msk1", rw, uuid.Nil)
	y := e.decide(t, mgr2, e.request(t, mgr1, transferOf(d, "msk2", "msk1", rw, &other)), approve)
	e.clock.Set(rw.Start.Add(time.Hour))
	e.decide(t, mgr2, y, revoke)
	if e.sees(t, as(d), other) {
		t.Fatal("a self-scoped driver sees the trip after the revocation (AC-06)")
	}
}

// Назначение, отозванное через API доступа (state = 'revoked'), досчёт не открывает снова: старт рейса не трогает
// верхнюю границу его срока.
func TestSettleKeepsRevokedAssignment(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	d := newDriver(t, "msk2", "Отозванный доступом")
	e.publish(t, mgr2, d, "msk2", e.window(400*time.Hour, 408*time.Hour))
	w := e.window(401*time.Hour, 404*time.Hour)
	tr := newTrip(t, "msk1", w, uuid.Nil)
	x := e.decide(t, mgr2, e.request(t, mgr1, transferOf(d, "msk2", "msk1", w, &tr)), approve)
	at := w.Start.Add(30 * time.Minute)
	e.clock.Set(at)
	exec(t, `update access.role_assignments set state = 'revoked', revoked_at = $2, valid = tstzrange(lower(valid), $2, '[)')
		where id = $1`, x.Grant.AssignmentId, at)
	startTrip(t, tr, "on_route", at)
	e.clock.Set(at.Add(time.Minute))
	if _, err := e.svc.SettleTenant(t.Context(), ref("tenant:a")); err != nil {
		t.Fatal(err)
	}
	if g := grantOf(t, x); g.state != "revoked" || g.until == nil || !g.until.Equal(at) {
		t.Fatalf("revoked assignment after the settlement: %s until %v, want revoked until %v", g.state, g.until, at)
	}
}

// hold locks the row of table id in a transaction of its own (another session) until the test ends or release.
func hold(t *testing.T, table string, id uuid.UUID) (tx *sql.Tx, release func()) {
	t.Helper()
	tx, err := db(t).BeginTx(t.Context(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var got uuid.UUID
	if err := tx.QueryRowContext(t.Context(), `select id from `+table+` where id = $1 for update`, id).Scan(&got); err != nil {
		_ = tx.Rollback()
		t.Fatalf("lock %s %s: %v", table, id, err)
	}
	var once sync.Once
	release = func() { once.Do(func() { _ = tx.Rollback() }) }
	t.Cleanup(release)
	return tx, release
}

// lockedElsewhere reports whether the row of table id is locked by another session (for update nowait in tx fails
// with lock_not_available).
func lockedElsewhere(t *testing.T, tx *sql.Tx, table string, id uuid.UUID) bool {
	t.Helper()
	var got uuid.UUID
	err := tx.QueryRowContext(t.Context(), `select id from `+table+` where id = $1 for update nowait`, id).Scan(&got)
	if pe, ok := errors.AsType[*pgconn.PgError](err); ok && pe.Code == "55P03" {
		return true
	}
	if err != nil {
		t.Fatalf("lock nowait %s %s: %v", table, id, err)
	}
	return false
}

// pause lets a command started in a goroutine reach the lock it waits for.
const pause = 700 * time.Millisecond

// Досчёт берёт только запросы, которые время меняет сейчас: одобренный запрос будущего окна с не начатым рейсом,
// занятый другой сессией, досчёт не ждёт.
func TestSettleSkipsUnchangedTransfers(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	d := newDriver(t, "msk2", "Будущий")
	e.publish(t, mgr2, d, "msk2", e.window(420*time.Hour, 428*time.Hour))
	w := e.window(421*time.Hour, 424*time.Hour)
	tr := newTrip(t, "msk1", w, uuid.Nil)
	x := e.decide(t, mgr2, e.request(t, mgr1, transferOf(d, "msk2", "msk1", w, &tr)), approve)
	hold(t, "fleet.driver_transfers", x.Id)
	ctx, cancel := context.WithTimeout(t.Context(), 3*time.Second)
	defer cancel()
	if _, err := e.svc.SettleTenant(ctx, ref("tenant:a")); err != nil {
		t.Fatalf("settlement with a future approved transfer locked elsewhere: %v, want no wait", err)
	}
}

// Порядок блокировок — рейс, затем запрос (как у команд рейса W2.02–W2.06, вызывающих pool.SettleTripTx): досчёт и
// решение, ждущие рейс, ещё не держат его запрос.
func TestLocksTheTripFirst(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	d := newDriver(t, "msk2", "Порядок блокировок")
	e.publish(t, mgr2, d, "msk2", e.window(440*time.Hour, 452*time.Hour))
	w := e.window(441*time.Hour, 444*time.Hour)
	tr := newTrip(t, "msk1", w, uuid.Nil)
	x := e.request(t, mgr1, transferOf(d, "msk2", "msk1", w, &tr))

	tx, release := hold(t, "fleet.trips", tr.ID)
	done := make(chan error, 1)
	go func() {
		_, err := e.svc.Decide(context.WithoutCancel(t.Context()), mgr2, x.Id, etag(1), fleetapi.DriverTransferDecision{Decision: approve})
		done <- err
	}()
	time.Sleep(pause)
	if lockedElsewhere(t, tx, "fleet.driver_transfers", x.Id) {
		t.Error("the decision waiting for the trip holds the transfer (lock order transfer → trip)")
	}
	release()
	if err := <-done; err != nil {
		t.Fatalf("decideDriverTransfer after the trip is free: %v", err)
	}

	e.clock.Set(w.End.Add(time.Minute))
	tx, release = hold(t, "fleet.trips", tr.ID)
	go func() {
		_, err := e.svc.SettleTenant(context.WithoutCancel(t.Context()), ref("tenant:a"))
		done <- err
	}()
	time.Sleep(pause)
	if lockedElsewhere(t, tx, "fleet.driver_transfers", x.Id) {
		t.Error("the settlement waiting for the trip holds the transfer (lock order transfer → trip)")
	}
	release()
	if err := <-done; err != nil {
		t.Fatalf("settlement after the trip is free: %v", err)
	}
	wantStored(t, x.Id, "completed", 3)
}

// pool.LockDriver — блокировка водителя, под которой одобрение перепроверяет его расписание: команда, ставящая
// водителя на рейс (W2.05), берёт её до своей проверки, и одобрение того же водителя ждёт её транзакцию.
func TestLockDriverSerializesApproval(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	c := e.newDecision(t, "Под замком", 520*time.Hour)
	conn, err := pgxpool.New(ctx, world.TenantURL("a", "super"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(conn.Close)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = tx.Rollback(context.WithoutCancel(ctx)) })
	if err := pool.LockDriver(ctx, tx, c.d); err != nil {
		t.Fatal(err)
	}
	done := make(chan error, 1)
	go func() {
		_, err := e.svc.Decide(context.WithoutCancel(ctx), e.tc(t, "a.manager-msk2"), c.x.Id, etag(1),
			fleetapi.DriverTransferDecision{Decision: approve})
		done <- err
	}()
	select {
	case err := <-done:
		t.Fatalf("the approval did not wait for the lock of its driver: %v", err)
	case <-time.After(pause):
	}
	if err := tx.Rollback(ctx); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatalf("approval after the lock is released: %v", err)
	}
}

// Досчёт после команды рейса (надстройка cmd/api, pool.SettleTripTx в транзакции команды) пишет только запросы этого
// рейса; остальные досчитывает воркер.
func TestSettleTripScope(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	d := newDriver(t, "msk2", "Досчёт рейса")
	e.publish(t, mgr2, d, "msk2", e.window(460*time.Hour, 472*time.Hour))
	w := e.window(461*time.Hour, 464*time.Hour)
	tr := newTrip(t, "msk1", w, uuid.Nil)
	x := e.decide(t, mgr2, e.request(t, mgr1, transferOf(d, "msk2", "msk1", w, &tr)), approve)
	other := newDriver(t, "msk2", "Чужой досчёт")
	e.publish(t, mgr2, other, "msk2", e.window(460*time.Hour, 472*time.Hour))
	y := e.request(t, mgr1, transferOf(other, "msk2", "msk1", e.window(462*time.Hour, 465*time.Hour), nil))

	e.clock.Set(w.End.Add(time.Minute))
	res, err := e.svc.SettleTrip(ctx, ref("tenant:a"), tr.ID)
	expect(t, "settlement of the trip", res, err == nil, res.Completed == 1, res.Unassigned == 1, res.Expired == 0)
	wantStored(t, x.Id, "completed", 3)
	wantStored(t, y.Id, "requested", 1)
	if res, err := e.svc.SettleTrip(ctx, ref("tenant:a"), uuid.New()); err != nil || res != (pool.Result{}) {
		t.Fatalf("settlement of an unknown trip: %+v %v, want nothing", res, err)
	}
}

// Открытый запрос истекает к началу окна: чтение показывает expired сразу, досчёт записывает его один раз.
func TestSettleExpiresRequests(t *testing.T) { //nolint:paralleltest // the settlement of the pool writes the whole tenant
	e := newEnv(t)
	ctx := t.Context()
	mgr2, mgr1 := e.tc(t, "a.manager-msk2"), e.tc(t, "a.manager-msk1")
	d := newDriver(t, "msk2", "Неотвеченный")
	e.publish(t, mgr2, d, "msk2", e.window(336*time.Hour, 344*time.Hour))
	x := e.request(t, mgr1, transferOf(d, "msk2", "msk1", e.window(337*time.Hour, 340*time.Hour), nil))
	e.clock.Set(e.t0.Add(337 * time.Hour))
	got, err := e.svc.Transfer(ctx, mgr1, x.Id)
	expect(t, "expired on read", got, err == nil, got.Status == pool.StatusExpired, got.Revision == 2)
	res, err := e.svc.SettleTenant(ctx, ref("tenant:a"))
	expect(t, "settlement", res, err == nil, res.Expired >= 1)
	if _, err := e.svc.SettleTenant(ctx, ref("tenant:a")); err != nil {
		t.Fatal(err)
	}
	wantStored(t, x.Id, "expired", 2)

	expired := []fleetapi.ListDriverTransfersParamsStatus{fleetapi.ListDriverTransfersParamsStatusExpired}
	if !e.listed(t, mgr2, fleetapi.ListDriverTransfersParams{Status: &expired}, x.Id) {
		t.Fatal("the expired request is not listed as expired")
	}
}
