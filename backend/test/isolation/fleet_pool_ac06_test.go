//go:build isolation

package isolation

import (
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"maps"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
	"github.com/ortus/ortus-crm/backend/test/isolation/matrix"
)

// AC-06 построчно (W2.57, решение Q-W2.07-1 «только рейс»; S2-14, AUTH-07, D09; бриф W2.57 §4 п. 2): временный
// водитель b.driver-msk1 («Москва-1» тенанта B, домашняя роль «Водитель» в области self — как фикстуры W1.04) переведён в
// «Москву-2» на рейсы во всех фазах перевода. Фикстуры W1.04 переводов и рейсов не держат, а время набора одно (01.10.2026
// 10:30 MSK), поэтому фазы — данные: запросы с окнами до, вокруг и после «сейчас», рейсы в нужных состояниях и назначения
// роли «Временный водитель», как их пишет одобрение и досчёт пула (pool.TemporaryDriverActions, tenant 0018). Строки
// ссылаются на эти объекты своими ссылками ac06:* (строки YAML ссылаются только на фикстуры — README). Тенант B
// выбран, чтобы назначения водителя не меняли строк тенанта A. Задачи, база знаний и календарь подразделения
// по HTTP — строки ac06UnitRows (403 шлюза; задачи — 404 и нет в списке, обработчик W4.11), и их закрывает
// состав роли (pool TestTemporaryDriverActions, cmd/api TestTemporaryDriverTemplate, integration TestNarrowRoleExposure).

// ac06Refs resolves the references ac06:* of the seeded transfers and delegates the rest to the fixtures.
type ac06Refs struct {
	base matrix.Resolver
	ids  map[string]uuid.UUID
}

func (r ac06Refs) ID(ref string) (uuid.UUID, error) {
	if id, ok := r.ids[ref]; ok {
		return id, nil
	}
	return r.base.ID(ref)
}

func (r ac06Refs) Actor(key string) (fixtures.Actor, error) { return r.base.Actor(key) }

// ac06ID is the stable id of a seeded object (UUID v5, as the fixtures).
func ac06ID(name string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:isolation:ac06:"+name))
}

// The seeded objects: trips of «Москва-2» of tenant B in the phases of their transfers, vehicles, expenses, files and
// the hold of the started trip.
var ac06Names = []string{
	"trip-active", "trip-future", "trip-over", "trip-closing", "trip-accepted", "trip-revoked-started",
	"trip-revoked", "trip-cancelled", "trip-unassigned", "trip-other", "trip-history",
	"vehicle-active", "vehicle-closing", "vehicle-revoked", "vehicle-accepted", "vehicle-spare",
	"expense-closing", "expense-over", "expense-accepted", "expense-cancelled", "expense-unassigned",
	"file-trip", "file-unit", "file-closing", "file-accepted", "file-over", "file-future", "file-expense-accepted",
	"file-departure",
	"resource-closing", "reservation-closing", "resource-active", "reservation-active",
	// Объекты подразделения «Москва-2» в задачах, базе знаний и календаре (ac06UnitRows): задачу открытого проекта
	// «Москвы-2» сеет набор (W4.11); страница и бронь календаря закрыты шлюзом до чтения.
	"task-msk2", "page-msk2", "booking-msk2",
}

func ac06IDs() map[string]uuid.UUID {
	out := map[string]uuid.UUID{}
	for _, n := range ac06Names {
		out["ac06:"+n] = ac06ID(n)
	}
	return out
}

// ac06Seed writes the transfers of the driver into tenant B (ortus_api, as the module writes them).
type ac06Seed struct {
	t                  *testing.T
	db                 *sql.DB
	now                time.Time
	driver, other      uuid.UUID
	home, target, role uuid.UUID
	publication, owner uuid.UUID
}

func (s *ac06Seed) exec(q string, args ...any) {
	s.t.Helper()
	if _, err := s.db.ExecContext(s.t.Context(), q, args...); err != nil {
		s.t.Fatalf("%s: %v", q, err)
	}
}

func (s *ac06Seed) id(q string, args ...any) uuid.UUID {
	s.t.Helper()
	var id uuid.UUID
	if err := s.db.QueryRowContext(s.t.Context(), q, args...).Scan(&id); err != nil {
		s.t.Fatalf("%s: %v", q, err)
	}
	return id
}

func (s *ac06Seed) at(d time.Duration) time.Time { return s.now.Add(d) }

// vehicle registers a vehicle of «Москва-2».
func (s *ac06Seed) vehicle(name string) uuid.UUID {
	id := ac06ID(name)
	s.exec(`insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm)
		values ($1, $2, $3, 'van', 1500, 12, 3200)`, id, s.target, "АС-"+id.String()[:6])
	return id
}

// trip plans a trip of «Москва-2» in state with driver (uuid.Nil — none) and vehicle (uuid.Nil — none) for w.
func (s *ac06Seed) trip(name, state string, driver, vehicle uuid.UUID, from, until time.Time) uuid.UUID {
	id := ac06ID(name)
	var d, v, started, reviewed any
	if driver != uuid.Nil {
		d = driver
	}
	if vehicle != uuid.Nil {
		v = vehicle
	}
	switch state {
	case "on_route", "submitted", "rework", "accepted":
		started = from
	}
	if state == "accepted" {
		reviewed = until.Add(time.Hour)
	}
	s.exec(`insert into fleet.trips (id, number, unit_id, state, driver_person_id, vehicle_id, planned, started_at, reviewed_at)
		values ($1, $2, $3, $4, $5, $6, tstzrange($7, $8), $9, $10)`, id, "АС-"+id.String()[:6], s.target, state, d, v,
		from, until, started, reviewed)
	return id
}

// departed writes the approved departure inspection of a started trip and links it to the trip.
func (s *ac06Seed) departed(trip, vehicle, checklist uuid.UUID) {
	s.t.Helper()
	insp := s.id(`insert into fleet.inspections (trip_id, vehicle_id, kind, checklist_version_id, odometer_km, fuel_level,
		answers, state, submitted_by) values ($1, $2, 'departure', $3, 48200, 'half', '{}', 'approved', $4) returning id`,
		trip, vehicle, checklist, s.driver)
	s.exec(`update fleet.trips set departure_inspection_id = $1 where id = $2`, insp, trip)
}

// ac06Checklist returns the current departure checklist of tenant B as the module of inspections publishes it
// (getInspectionChecklist of the owner on a vehicle of «Москва-2»).
func ac06Checklist(t *testing.T, vehicle uuid.UUID) uuid.UUID {
	t.Helper()
	owner, err := suite.Refs.Actor("b.owner")
	if err != nil {
		t.Fatal(err)
	}
	tenant, err := suite.Refs.ID("tenant:b")
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/api/v1/tenants/"+tenant.String()+
		"/fleet/inspection-checklist?kind=departure&vehicleId="+vehicle.String(), nil)
	if err := suite.Target.Authenticate(req, owner); err != nil {
		t.Fatal(err)
	}
	rec := httptest.NewRecorder()
	suite.Target.Handler.ServeHTTP(rec, req)
	var body struct {
		VersionID uuid.UUID `json:"versionId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); rec.Code != http.StatusOK || err != nil || body.VersionID == uuid.Nil {
		t.Fatalf("departure checklist of tenant B: %d %s (%v)", rec.Code, rec.Body.String(), err)
	}
	return body.VersionID
}

// grant writes an assignment of the role «Временный водитель» to the driver: scope self or resource on ref.
func (s *ac06Seed) grant(scope string, ref any, from time.Time, until any, state string) uuid.UUID {
	return s.id(`insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind,
		scope_ref, include_descendants, valid, state, source, granted_by, reason)
		values ('person', $1, $2, 1, $3, $4, false, tstzrange($5, $6, '[)'), $7, 'transfer', $8, 'AC-06') returning id`,
		s.driver, s.role, scope, ref, from, until, state, s.owner)
}

// transfer writes a transfer of the driver for trip in state over [from, until) with its grants: self (open when
// grantUntil is nil) and, with a vehicle, resource on it until vehicleUntil.
func (s *ac06Seed) transfer(trip uuid.UUID, state string, from, until time.Time, grantUntil any, grantState string,
	vehicle uuid.UUID, vehicleUntil time.Time) {
	s.t.Helper()
	self := s.grant("self", nil, from, grantUntil, grantState)
	var va any
	if vehicle != uuid.Nil {
		va = s.grant("resource", vehicle, from, vehicleUntil, "active")
	}
	var completed, revokedBy any
	switch state {
	case "completed":
		completed = until
	case "revoked":
		completed, revokedBy = from.Add(time.Hour), s.owner
	}
	s.exec(`insert into fleet.driver_transfers (publication_id, source_unit_id, target_unit_id, trip_id, period, state,
		requested_by, decided_by, decided_at, assignment_id, vehicle_assignment_id, completed_at, revoked_by)
		values ($1, $2, $3, $4, tstzrange($5, $6, '[)'), $7, $8, $8, $9, $10, $11, $12, $13)`,
		s.publication, s.home, s.target, trip, from, until, state, s.owner, from.Add(-48*time.Hour), self, va, completed,
		revokedBy)
}

func (s *ac06Seed) setup(w *fixtures.World) {
	b := func(ref string) uuid.UUID {
		id, err := w.ID(ref)
		if err != nil {
			s.t.Fatal(err)
		}
		return id
	}
	s.driver, s.home, s.target, s.owner = b("person:b.driver-msk1@b"), b("unit:b.msk1"), b("unit:b.msk2"), b("person:b.owner@b")
	s.other = s.id(`insert into people.person_profiles (full_name, home_unit_id) values ('Свой водитель Москвы-2', $1)
		returning id`, s.target)
	s.role = s.id(`insert into access.roles (name, kind, template_key) values ('Временный водитель', 'system', 'temporary_driver')
		returning id`)
	s.exec(`insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
		s.role, pool.TemporaryDriverActions, s.owner)
	s.publication = s.id(`insert into fleet.pool_publications (person_id, home_unit_id, available, published_by, display_name)
		values ($1, $2, tstzrange($3, $4), $5, 'Водитель #АС-06') returning id`, s.driver, s.home, s.at(-30*24*time.Hour),
		s.at(30*24*time.Hour), s.owner)
}

// seedAC06 writes the phases (the clock of the suite — harness.Now) and raises policy_version: cmd/api sees the
// assignments at once (realtime.PolicyCache).
func seedAC06(t *testing.T) {
	t.Helper()
	w, ok := suite.Refs.(*fixtures.World)
	if !ok {
		t.Fatalf("suite refs %T, want the fixtures", suite.Refs)
	}
	s := &ac06Seed{t: t, db: w.Cluster.DB(t, w.TenantDBs[fixtures.TenantB], migrations.RoleAPI), now: w.Now}
	s.setup(w)
	h := time.Hour
	d := s.driver
	// В окне: рейс с забронированной машиной; запасная машина фирмы без брони.
	vActive := s.vehicle("vehicle-active")
	s.vehicle("vehicle-spare")
	s.transfer(s.trip("trip-active", "assigned", d, vActive, s.at(-h), s.at(5*h)), "approved", s.at(-h), s.at(5*h),
		s.at(5*h), "active", vActive, s.at(5*h))
	// До окна (scheduled) и после окна — рейс не начат, досчёт ещё не снял водителя.
	s.transfer(s.trip("trip-future", "planned", d, uuid.Nil, s.at(24*h), s.at(28*h)), "approved", s.at(24*h), s.at(28*h),
		s.at(28*h), "active", uuid.Nil, time.Time{})
	s.transfer(s.trip("trip-over", "assigned", d, uuid.Nil, s.at(-10*h), s.at(-6*h)), "approved", s.at(-10*h), s.at(-6*h),
		s.at(-6*h), "active", uuid.Nil, time.Time{})
	// После окна начатый рейс — продолжение; машина рейса закрыта концом окна.
	vClosing := s.vehicle("vehicle-closing")
	s.transfer(s.trip("trip-closing", "on_route", d, vClosing, s.at(-30*h), s.at(-26*h)), "approved", s.at(-30*h),
		s.at(-26*h), nil, "active", vClosing, s.at(-26*h))
	// Принят — завершён; отозван начатый (доработка) — продолжение; отозван не начатый; отменён; водителя сменили.
	vAccepted := s.vehicle("vehicle-accepted")
	s.transfer(s.trip("trip-accepted", "accepted", d, vAccepted, s.at(-50*h), s.at(-46*h)), "completed", s.at(-50*h),
		s.at(-46*h), s.at(-45*h), "active", vAccepted, s.at(-46*h))
	vRevoked := s.vehicle("vehicle-revoked")
	s.transfer(s.trip("trip-revoked-started", "rework", d, vRevoked, s.at(-74*h), s.at(-70*h)), "revoked", s.at(-74*h),
		s.at(-70*h), nil, "active", vRevoked, s.at(-73*h))
	s.transfer(s.trip("trip-revoked", "planned", uuid.Nil, uuid.Nil, s.at(-80*h), s.at(-76*h)), "revoked", s.at(-80*h),
		s.at(-76*h), s.at(-79*h), "revoked", uuid.Nil, time.Time{})
	s.transfer(s.trip("trip-cancelled", "cancelled", d, uuid.Nil, s.at(-2*h), s.at(4*h)), "approved", s.at(-2*h),
		s.at(4*h), s.at(4*h), "active", uuid.Nil, time.Time{})
	s.transfer(s.trip("trip-unassigned", "assigned", s.other, uuid.Nil, s.at(-3*h), s.at(3*h)), "approved", s.at(-3*h),
		s.at(3*h), s.at(3*h), "active", uuid.Nil, time.Time{})
	// Рейсы фирмы без перевода: текущий и исторический у своего водителя.
	s.trip("trip-other", "assigned", s.other, uuid.Nil, s.at(-h), s.at(5*h))
	vHistory := s.vehicle("vehicle-history")
	s.trip("trip-history", "accepted", s.other, vHistory, s.at(-200*h), s.at(-196*h))
	// Начатые рейсы — с осмотром выезда (getTrip и listTrips показывают рейс с ним, W2.05): иначе 404 «Рейс ещё не
	// начат.» модуля рейса закрывал бы строку и без пула. Версию чек-листа публикует сам модуль осмотров (встроенная
	// версия 1, одна во всех тенантах), поэтому «текущий» чек-лист тенанта B для других строк не меняется.
	checklist := ac06Checklist(t, vActive)
	for trip, vehicle := range map[string]uuid.UUID{"trip-closing": vClosing, "trip-accepted": vAccepted,
		"trip-revoked-started": vRevoked, "trip-history": vHistory} {
		s.departed(ac06ID(trip), vehicle, checklist)
	}
	// Расходы рейсов перевода во всех фазах: заявил сам водитель (claimed_by — он же).
	for name, trip := range map[string]string{"expense-closing": "trip-closing", "expense-over": "trip-over",
		"expense-accepted": "trip-accepted", "expense-cancelled": "trip-cancelled", "expense-unassigned": "trip-unassigned"} {
		s.exec(`insert into fleet.expenses (id, trip_id, category, amount_minor, occurred_on, claimed_by)
			values ($1, $2, 'wash', 50000, $3::date, $4)`, ac06ID(name), ac06ID(trip), s.now, d)
	}
	// Файлы рейсов перевода во всех фазах (фото принятого рейса загрузил ответственный фирмы-получателя, чек расхода —
	// сам водитель) и файл подразделения (машина без брони).
	for _, f := range []struct{ name, purpose, owner, parent string }{
		{"file-trip", "inspection", "fleet.trip", "trip-active"}, {"file-unit", "inspection", "fleet.vehicle", "vehicle-spare"},
		{"file-closing", "inspection", "fleet.trip", "trip-closing"}, {"file-accepted", "inspection", "fleet.trip", "trip-accepted"},
		{"file-over", "inspection", "fleet.trip", "trip-over"}, {"file-future", "inspection", "fleet.trip", "trip-future"},
		{"file-expense-accepted", "expense_receipt", "fleet.expense", "expense-accepted"},
		{"file-departure", "inspection", "fleet.reservation", "reservation-closing"},
	} {
		key := "isolation/b/ac06/" + f.name + ".jpg"
		sum := sha256.Sum256([]byte(key))
		by := d
		if f.name == "file-accepted" {
			by = s.owner
		}
		s.exec(`insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime, detected_mime,
			bytes, sha256, uploaded_by, created_at, ready_at)
			values ($1, $2, 'ready', $3, $4, $5, 'image/jpeg', 'image/jpeg', 2048, $6, $7, $8, $8)`,
			ac06ID(f.name), key, f.purpose, f.owner, ac06ID(f.parent), sum[:], by, s.at(-h))
	}
	// Бронь начатого рейса (машина выдана — consumed; бронировал сам водитель): в продолжении она не открывается и не
	// снимается, фото выезда по ней не читаются и не загружаются (D09).
	s.exec(`insert into sched.resources (id, kind, ref_id, home_unit_id) values ($1, 'vehicle', $2, $3)`,
		ac06ID("resource-closing"), vClosing, s.target)
	s.exec(`insert into sched.reservations (id, resource_id, bundle_id, during, occupied, state, source_type, source_id, created_by)
		values ($1, $2, $1, tstzrange($3, $4), tstzrange($3, $4), 'consumed', 'fleet.trip', $5, $6)`,
		ac06ID("reservation-closing"), ac06ID("resource-closing"), s.at(-30*h), s.at(-26*h), ac06ID("trip-closing"), d)
	// Бронь рейса в окне (подтверждена, бронировал сам водитель): в списке броней она есть, бронь продолжения — нет.
	s.exec(`insert into sched.resources (id, kind, ref_id, home_unit_id) values ($1, 'vehicle', $2, $3)`,
		ac06ID("resource-active"), vActive, s.target)
	s.exec(`insert into sched.reservations (id, resource_id, bundle_id, during, occupied, state, source_type, source_id, created_by)
		values ($1, $2, $1, tstzrange($3, $4), tstzrange($3, $4), 'confirmed', 'fleet.trip', $5, $6)`,
		ac06ID("reservation-active"), ac06ID("resource-active"), s.at(-h), s.at(5*h), ac06ID("trip-active"), d)
	// «Данные»: шаблон «Водитель» data.query не даёт — водителю тенанта B выдана своя роль организации с одним
	// data.query на организацию (AND права набора — строки по-прежнему по fleet.trips.read/fleet.expenses.read в self).
	query := s.id(`insert into access.roles (name, kind) values ('Выборки АС-06', 'custom') returning id`)
	s.exec(`insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
		query, []string{"data.query"}, s.owner)
	s.exec(`insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind,
		include_descendants, valid, state, source, granted_by, reason)
		values ('person', $1, $2, 1, 'tenant', true, tstzrange($3, null, '[)'), 'active', 'manual', $4, 'AC-06')`,
		d, query, s.at(-30*24*h), s.owner)
	// Задача подразделения-получателя (W4.11): открытый проект «Москвы-2» (роль фирмы дала бы в нём всё) и его задача
	// у своего водителя — временному водителю её не видно: роль без tasks.*, домашняя «Водитель» — self.
	project := ac06ID("project-msk2")
	s.exec(`insert into tasks.projects (id, key, name, org_unit_id, access, flow, workflow_key, owner_id, current_version)
		values ($1, 'АСШ', 'Рейсы Москвы-2', $2, 'open', 'tasks', 'simple', $3, 1)`, project, s.target, s.owner)
	s.exec(`insert into tasks.workflow_versions (project_id, version, statuses, transitions) values ($1, 1, $2::jsonb, '[]')`,
		project, `[{"id":"s1","name":"Новая","category":"todo"},{"id":"s4","name":"Готово","category":"done"}]`)
	s.exec(`insert into tasks.tasks (id, project_id, number, title, status_id, workflow_version, assignee_id, author_id)
		values ($1, $2, 101, 'Подготовить рейс', 's1', 1, $3, $4)`, ac06ID("task-msk2"), project, s.other, s.owner)
	s.exec(`update access.policy_state set policy_version = policy_version + 1 where $1::uuid is not null`, d)
}

const ac06Driver = "b.driver-msk1"

// ac06Row is a row of the temporary driver in tenant B.
func ac06Row(params map[string]string, status int, code string, present, absent []string, note string) matrix.Row {
	p := map[string]string{"tenantId": "tenant:b"}
	maps.Copy(p, params)
	return matrix.Row{Actor: ac06Driver, Params: p, Status: status, Code: code, Present: present, Absent: absent, Note: note}
}

func trip(name string) map[string]string { return map[string]string{"tripId": "ac06:" + name} }

// ac06Rows are the rows of AC-06 (бриф W2.57 §4 п. 2).
func ac06Rows() matrix.File {
	const plan = "/api/v1/tenants/{tenantId}/fleet/trip-plans/{tripId}"
	notFound := func(name, note string) matrix.Row {
		return ac06Row(trip(name), http.StatusNotFound, "not_found", nil, []string{"ac06:" + name}, note)
	}
	open := func(name, note string) matrix.Row {
		return ac06Row(trip(name), http.StatusOK, "", []string{"ac06:" + name}, nil, note)
	}
	f := matrix.File{Module: "fleet_pool_ac06", Endpoints: []matrix.Endpoint{
		{Op: "getTripPlan", Method: http.MethodGet, Path: plan, Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
			open("trip-active", "в окне — свой рейс"),
			notFound("trip-future", "до окна (scheduled) — 404, хотя водитель уже на рейсе (Q-W2.07-2)"),
			notFound("trip-over", "после окна не начатый рейс — 404 сразу, без досчёта (AC-06)"),
			open("trip-closing", "после окна начатый рейс — продолжение (D09): чтение рейса"),
			notFound("trip-accepted", "после приёмки — 404, хотя домашняя роль self видит рейс, где он водитель"),
			open("trip-revoked-started", "отзыв начатого рейса — продолжение до приёмки (08 §4.6 п. 8)"),
			notFound("trip-revoked", "отзыв не начатого рейса — 404"),
			notFound("trip-cancelled", "отмена рейса гасит назначение — 404"),
			notFound("trip-unassigned", "снятие водителя с рейса — 404 (Q-W2.07-14)"),
			notFound("trip-other", "другой рейс фирмы-получателя — 404"),
			notFound("trip-history", "исторический рейс фирмы-получателя — 404"),
		}},

		{Op: "listTripPlans", Method: http.MethodGet, Path: "/api/v1/tenants/{tenantId}/fleet/trip-plans",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				ac06Row(nil, http.StatusOK, "", []string{"ac06:trip-active", "ac06:trip-closing", "ac06:trip-revoked-started"},
					[]string{"ac06:trip-future", "ac06:trip-over", "ac06:trip-accepted", "ac06:trip-revoked", "ac06:trip-cancelled",
						"ac06:trip-unassigned", "ac06:trip-other", "ac06:trip-history"},
					"список — рейсы перевода в окне и в продолжении, без закрытых водителю и чужих"),
			}},
		{Op: "getTrip", Method: http.MethodGet, Path: "/api/v1/tenants/{tenantId}/fleet/trips/{tripId}",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				// getTrip and listTrips show started trips only (W2.05): the trip in the window is not started yet.
				open("trip-closing", "продолжение (D09): чтение начатого рейса"),
				open("trip-revoked-started", "отзыв начатого рейса — продолжение до приёмки"),
				notFound("trip-accepted", "после приёмки — 404, хотя рейс начат и водитель — он (self)"),
				notFound("trip-over", "после окна не начатый рейс — 404"),
				notFound("trip-history", "исторический рейс фирмы-получателя — 404"),
			}},
		{Op: "listTrips", Method: http.MethodGet, Path: "/api/v1/tenants/{tenantId}/fleet/trips",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				ac06Row(nil, http.StatusOK, "", []string{"ac06:trip-closing", "ac06:trip-revoked-started"},
					[]string{"ac06:trip-accepted", "ac06:trip-history", "ac06:trip-over", "ac06:trip-future"},
					"начатые рейсы водителя — только рейсы перевода в продолжении, без принятого"),
			}},
		{Op: "listVehicles", Method: http.MethodGet, Path: "/api/v1/tenants/{tenantId}/fleet/vehicles",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				ac06Row(nil, http.StatusOK, "", []string{"ac06:vehicle-active"},
					[]string{"ac06:vehicle-spare", "ac06:vehicle-closing", "ac06:vehicle-revoked", "ac06:vehicle-accepted"},
					"машины фирмы — только забронированная под рейс в окне (область resource)"),
			}},
		{Op: "listTripExpenses", Method: http.MethodGet, Path: "/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/expenses",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				ac06Row(trip("trip-closing"), http.StatusOK, "", []string{"ac06:expense-closing"}, nil, "продолжение: расходы рейса"),
				ac06Row(trip("trip-over"), http.StatusNotFound, "not_found", nil, []string{"ac06:expense-over"},
					"после окна не начатый рейс — 404"),
				ac06Row(trip("trip-accepted"), http.StatusNotFound, "not_found", nil, []string{"ac06:expense-accepted"},
					"после приёмки — 404, хотя расход заявил он сам"),
				ac06Row(trip("trip-cancelled"), http.StatusNotFound, "not_found", nil, []string{"ac06:expense-cancelled"},
					"после отмены — 404"),
				ac06Row(trip("trip-unassigned"), http.StatusNotFound, "not_found", nil, []string{"ac06:expense-unassigned"},
					"снят с рейса — 404"),
			}},
		{Op: "getTripExpense", Method: http.MethodGet,
			Path: "/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/expenses/{expenseId}", Channel: matrix.ChannelHTTP,
			Rows: []matrix.Row{
				ac06Row(map[string]string{"tripId": "ac06:trip-closing", "expenseId": "ac06:expense-closing"}, http.StatusOK, "",
					[]string{"ac06:expense-closing"}, nil, "продолжение: расход рейса"),
				ac06Row(map[string]string{"tripId": "ac06:trip-over", "expenseId": "ac06:expense-over"}, http.StatusNotFound,
					"not_found", nil, []string{"ac06:expense-over"}, "после окна не начатый рейс — 404"),
				ac06Row(map[string]string{"tripId": "ac06:trip-accepted", "expenseId": "ac06:expense-accepted"},
					http.StatusNotFound, "not_found", nil, []string{"ac06:expense-accepted"}, "после приёмки — 404"),
			}},
		{Op: "getReservation", Method: http.MethodGet, Path: "/api/v1/tenants/{tenantId}/fleet/reservations/{reservationId}",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				ac06Row(map[string]string{"reservationId": "ac06:reservation-closing"}, http.StatusNotFound, "not_found", nil,
					[]string{"ac06:reservation-closing", "ac06:vehicle-closing"}, "продолжение: бронь начатого рейса — 404 (D09)"),
			}},
		{Op: "listReservations", Method: http.MethodGet, Path: "/api/v1/tenants/{tenantId}/fleet/reservations",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				ac06Row(nil, http.StatusOK, "", []string{"ac06:reservation-active"}, []string{"ac06:reservation-closing"},
					"брони водителя — рейса в окне; бронь начатого рейса в продолжении — нет, как getReservation (D09)"),
			}},
		{Op: "startTrip", Method: http.MethodPost, Path: "/api/v1/tenants/{tenantId}/fleet/trips",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				func() matrix.Row {
					r := ac06Row(nil, http.StatusNotFound, "not_found", nil, []string{"ac06:trip-closing"},
						"продолжение: новый старт по брони начатого рейса — новая работа, 404")
					r.Body = `{"reservationId": "{{ac06:reservation-closing}}", "departureInspectionId": "{{ac06:file-closing}}"}`
					return r
				}(),
			}},
		{Op: "submitInspection", Method: http.MethodPost, Path: "/api/v1/tenants/{tenantId}/fleet/inspections",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				func() matrix.Row {
					r := ac06Row(nil, http.StatusNotFound, "not_found", nil, []string{"ac06:trip-closing"},
						"продолжение: осмотр выезда по брони начатого рейса — новая работа, 404")
					r.Body = `{"checklistVersionId": "{{ac06:file-closing}}", "vehicleId": "{{ac06:vehicle-closing}}", ` +
						`"reservationId": "{{ac06:reservation-closing}}", "kind": "departure", "odometerKm": "48210", "fuelPercent": 75, ` +
						`"checks": [{"key": "body", "result": "pass"}], "photos": [{"role": "front", "fileId": "{{ac06:file-closing}}", ` +
						`"capturedAt": "2026-10-01T07:00:00Z"}], "capturedAt": "2026-10-01T07:00:00Z"}`
					return r
				}(),
			}},
		{Op: "queryDataset", Method: http.MethodPost, Path: "/api/v1/tenants/{tenantId}/datasets/fleet.trips/query",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				func() matrix.Row {
					r := ac06Row(nil, http.StatusOK, "", []string{"ac06:trip-active", "ac06:trip-closing", "ac06:trip-revoked-started"},
						[]string{"ac06:trip-accepted", "ac06:trip-over", "ac06:trip-future", "ac06:trip-other", "ac06:trip-history"},
						"«Данные» · «Поездки»: рейсы перевода в окне и в продолжении, без закрытых водителю (AC-06)")
					r.Body = `{"select": ["trip", "state"], "filters": [], "sort": [], "limit": 100}`
					return r
				}(),
			}},
		{Op: "queryDataset", Method: http.MethodPost, Path: "/api/v1/tenants/{tenantId}/datasets/fleet.expenses/query",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				func() matrix.Row {
					r := ac06Row(nil, http.StatusOK, "", []string{"ac06:expense-closing"},
						[]string{"ac06:expense-accepted", "ac06:expense-over", "ac06:expense-cancelled", "ac06:expense-unassigned"},
						"«Данные» · «Расходы»: расходы рейса в продолжении, без рейсов, закрытых водителю (AC-06)")
					r.Body = `{"select": ["trip", "amount"], "filters": [], "sort": [], "limit": 100}`
					return r
				}(),
			}},
		{Op: "reserveVehicle", Method: http.MethodPost, Path: "/api/v1/tenants/{tenantId}/fleet/reservations",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				ac06Row(nil, http.StatusNotFound, "not_found", nil, []string{"ac06:vehicle-closing"},
					"продолжение: бронь на начатый рейс — новая работа, 404 (D09)"),
			}},
		{Op: "getTripEarnings", Method: http.MethodGet, Path: "/api/v1/tenants/{tenantId}/fleet/trips/{tripId}/earnings",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				ac06Row(trip("trip-active"), http.StatusForbidden, "function_blocked", nil, nil,
					"начисления рейса закрыты функцией «Водитель» (AC-05)"),
			}},
		{Op: "getFile", Method: http.MethodGet, Path: "/api/v1/tenants/{tenantId}/files/{fileId}",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				ac06Row(map[string]string{"fileId": "ac06:file-trip"}, http.StatusOK, "", []string{"ac06:file-trip"}, nil,
					"в окне — файл рейса"),
				ac06Row(map[string]string{"fileId": "ac06:file-unit"}, http.StatusNotFound, "not_found", nil,
					[]string{"ac06:file-unit"}, "файлы подразделения (машина без брони) — 404"),
				file("file-closing", http.StatusOK, "продолжение: фото начатого рейса"),
				file("file-accepted", http.StatusNotFound, "после приёмки — 404, хотя фото загрузил логист его рейса (self)"),
				file("file-over", http.StatusNotFound, "после окна не начатый рейс — 404"),
				file("file-future", http.StatusNotFound, "до окна — 404, хотя одобрение уже поставило его водителем"),
				file("file-expense-accepted", http.StatusNotFound, "чек расхода принятого рейса — 404, хотя расход его"),
				file("file-departure", http.StatusNotFound, "продолжение: фото выезда по брони начатого рейса — 404, хотя бронь его (D09)"),
			}},
		{Op: "getFileDownload", Method: http.MethodGet, Path: "/api/v1/tenants/{tenantId}/files/{fileId}/download",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				ac06Row(map[string]string{"fileId": "ac06:file-closing"}, http.StatusOK, "", nil, nil,
					"продолжение: фото начатого рейса скачивается"),
				ac06Row(map[string]string{"fileId": "ac06:file-accepted"}, http.StatusNotFound, "not_found", nil,
					[]string{"ac06:file-accepted"}, "после приёмки — 404"),
			}},
		{Op: "listFiles", Method: http.MethodGet, Path: "/api/v1/tenants/{tenantId}/files",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				ac06Row(nil, http.StatusOK, "", []string{"ac06:file-trip", "ac06:file-closing"},
					[]string{"ac06:file-accepted", "ac06:file-over", "ac06:file-future", "ac06:file-expense-accepted", "ac06:file-unit",
						"ac06:file-departure"},
					"файлы — рейса в окне и в продолжении, без рейсов, закрытых водителю (до пагинации)"),
			}},
		{Op: "initiateUpload", Method: http.MethodPost, Path: "/api/v1/tenants/{tenantId}/files/uploads",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
				upload("trip-closing", http.StatusCreated, "продолжение: фото начатого рейса загружается (D09)"),
				upload("trip-accepted", http.StatusNotFound, "к принятому рейсу — 404: запись после конца назначения"),
				upload("trip-over", http.StatusNotFound, "после окна не начатый рейс — 404"),
				upload("trip-future", http.StatusNotFound, "до окна — 404"),
				uploadTo("reservation", "reservation-closing", http.StatusNotFound,
					"продолжение: фото выезда к брони начатого рейса — новая работа, 404 (D09)"),
			}},
	}}
	f.Endpoints = append(f.Endpoints, ac06UnitRows()...)
	return f
}

// ac06UnitRows are the rows of AC-06 for the tasks, the knowledge base and the calendar of the unit (бриф W2.57 §4.2):
// the role «Временный водитель» holds none of their actions. The pages of the knowledge base and the bookings of the
// calendar are in no role of the driver at all — the gateway answers 403 forbidden_action before any object is read
// (the order of checks of the contract, the answer is the same for any id; Q-W2.57-10). The tasks are in his home role
// «Водитель» in scope self only, so a task of «Москва-2» is 404 and out of the list (the handler of W4.11, task-msk2 of
// an open project of «Москва-2» seeded by seedAC06).
func ac06UnitRows() []matrix.Endpoint {
	denied := func(params map[string]string, note string) matrix.Row {
		return ac06Row(params, http.StatusForbidden, "forbidden_action", nil, nil, note)
	}
	const base = "/api/v1/tenants/{tenantId}/"
	return []matrix.Endpoint{
		{Op: "listTasks", Method: http.MethodGet, Path: base + "tasks", Channel: matrix.ChannelHTTP,
			Rows: []matrix.Row{ac06Row(nil, http.StatusOK, "", nil, []string{"ac06:task-msk2"},
				"задачи подразделения-получателя — нет в списке (роль без tasks.*, домашняя — self)")}},
		{Op: "getTask", Method: http.MethodGet, Path: base + "tasks/{taskId}", Channel: matrix.ChannelHTTP,
			Rows: []matrix.Row{ac06Row(map[string]string{"taskId": "ac06:task-msk2"}, http.StatusNotFound, "not_found", nil,
				[]string{"ac06:task-msk2"}, "задача подразделения-получателя — 404")}},
		{Op: "listKnowledgePages", Method: http.MethodGet, Path: base + "knowledge/pages", Channel: matrix.ChannelHTTP,
			Rows: []matrix.Row{denied(nil, "база знаний — действия нет ни в одной роли водителя, 403 шлюза")}},
		{Op: "getKnowledgePage", Method: http.MethodGet, Path: base + "knowledge/pages/{pageId}", Channel: matrix.ChannelHTTP,
			Rows: []matrix.Row{denied(map[string]string{"pageId": "ac06:page-msk2"},
				"страница базы знаний подразделения-получателя — 403 шлюза, страница не читается")}},
		{Op: "listCalendarBookings", Method: http.MethodGet, Path: base + "calendar/bookings", Channel: matrix.ChannelHTTP,
			Rows: []matrix.Row{denied(nil, "календарь подразделения — действия нет ни в одной роли водителя, 403 шлюза")}},
		{Op: "getCalendarBooking", Method: http.MethodGet, Path: base + "calendar/bookings/{bookingId}",
			Channel: matrix.ChannelHTTP, Rows: []matrix.Row{denied(map[string]string{"bookingId": "ac06:booking-msk2"},
				"бронь календаря подразделения-получателя — 403 шлюза, бронь не читается")}},
	}
}

// file is a row of getFile of a seeded file.
func file(name string, status int, note string) matrix.Row {
	params := map[string]string{"fileId": "ac06:" + name}
	if status == http.StatusOK {
		return ac06Row(params, status, "", []string{"ac06:" + name}, nil, note)
	}
	return ac06Row(params, status, "not_found", nil, []string{"ac06:" + name}, note)
}

// upload is a row of initiateUpload of a photo of the trip name (one Idempotency-Key per request — target_test.go).
func upload(name string, status int, note string) matrix.Row {
	return uploadTo("trip", name, status, note)
}

// uploadTo is a row of initiateUpload of an inspection photo of the seeded parent name of the fleet entity.
func uploadTo(entity, name string, status int, note string) matrix.Row {
	code, absent := "", []string(nil)
	if status == http.StatusNotFound {
		code, absent = "not_found", []string{"ac06:" + name}
	}
	r := ac06Row(map[string]string{"owner": "ac06:" + name}, status, code, nil, absent, note)
	r.Body = `{"fileName": "ac06.jpg", "contentType": "image/jpeg", "sizeBytes": 2048, ` +
		`"sha256": "a3f1c9e2b7d4058e6c1f2a9b3d7e4c5f8a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d", "purpose": "inspection", ` +
		`"owner": {"moduleKey": "fleet", "entityType": "` + entity + `", "entityId": "{{ac06:` + name + `}}"}}`
	return r
}

func TestIsolationFleetPoolAC06(t *testing.T) {
	t.Parallel()
	seedAC06(t)
	rows := ac06Rows()
	// The body of reserveVehicle refers to seeded objects: a hold of the vehicle of the closing trip for that trip.
	body := `{"vehicleId": "{{ac06:vehicle-closing}}", "driverMemberId": "{{person:b.driver-msk1@b}}", "tripId": "{{ac06:trip-closing}}", ` +
		`"window": {"startsAt": "2026-10-01T09:00:00Z", "endsAt": "2026-10-01T10:00:00Z", "timeZone": "Europe/Moscow"}}`
	for i, ep := range rows.Endpoints {
		if ep.Op == "reserveVehicle" {
			rows.Endpoints[i].Rows[0].Body = body
		}
	}
	s := &matrix.Suite{Refs: ac06Refs{base: suite.Refs, ids: ac06IDs()}, Target: suite.Target, Strict: suite.Strict}
	matrix.Run(t, s, rows)
	t.Run("commands", func(t *testing.T) { runAC06Commands(t, s) })
}

// ac06Command is a command of the temporary driver the row format does not express (If-Match): the overlay closes it
// (404 not_found; 403 forbidden_action when no role of the driver holds the action anywhere — the gateway answers
// before the trip is read, so the answer reveals no trip) or lets it through to the module of the trip, which answers
// by its own checks after reading and authorizing the trip and changes nothing: If-Match "999" never matches the
// revision (412 revision_mismatch), the receipt of the expense is a photo of the inspection, not a receipt (422
// validation_failed «Чек не относится к этому рейсу.»). An exact answer, so a wrong 403, 409 or 5xx of the overlay or
// the module fails the command; nothing is written into the seed of tenant B.
type ac06Command struct {
	op, method, path, body string
	ifMatch                bool
	want                   int
	code, detail           string
	note                   string
}

// ac06Commands are the commands of the continuation (D09) and after the grant (AC-06).
func ac06Commands() []ac06Command {
	const (
		trips    = "/api/v1/tenants/{{tenant:b}}/fleet/trips/"
		notFound = "not_found"
		denied   = "forbidden_action"
		stale    = "revision_mismatch"
		invalid  = "validation_failed"
		foreign  = "Чек не относится к этому рейсу."
	)
	ret := `{"action": "return", "returnInspectionId": "{{ac06:file-closing}}"}`
	expense := `{"kind": "wash", "occurredAt": "2026-10-01T06:00:00Z", "amount": {"amountMinor": 50000, "currency": "RUB"}, ` +
		`"receiptFileIds": ["{{ac06:file-closing}}"]}`
	return []ac06Command{
		{"returnTrip", http.MethodPatch, trips + "{{ac06:trip-closing}}", ret, true, http.StatusPreconditionFailed, stale, "",
			"продолжение: сдача начатого рейса доходит до модуля (проверка ревизии)"},
		{"finishTripRoute", http.MethodPost, trips + "{{ac06:trip-closing}}/route-completion", "", true,
			http.StatusPreconditionFailed, stale, "", "продолжение: «Завершить рейс» доходит до модуля (проверка ревизии)"},
		{"createTripExpense", http.MethodPost, trips + "{{ac06:trip-closing}}/expenses", expense, false,
			http.StatusUnprocessableEntity, invalid, foreign, "продолжение: расход начатого рейса доходит до проверки чека"},
		{"returnTrip", http.MethodPatch, trips + "{{ac06:trip-accepted}}", ret, true, http.StatusNotFound, notFound, "",
			"после приёмки — 404"},
		{"finishTripRoute", http.MethodPost, trips + "{{ac06:trip-over}}/route-completion", "", true, http.StatusNotFound,
			notFound, "", "после окна не начатый рейс — 404"},
		{"createTripExpense", http.MethodPost, trips + "{{ac06:trip-accepted}}/expenses", expense, false, http.StatusNotFound,
			notFound, "", "после приёмки — 404"},
		{"createTripExpense", http.MethodPost, trips + "{{ac06:trip-future}}/expenses", expense, false, http.StatusNotFound,
			notFound, "", "до окна — 404"},
		// Не его операции: ни одна роль водителя их не даёт — шлюз отвечает 403 по порядку проверок контракта.
		{"assignTripVehicle", http.MethodPut, trips + "{{ac06:trip-closing}}/vehicle", `{"vehicleId": "{{ac06:vehicle-spare}}"}`,
			true, http.StatusForbidden, denied, "", "другая машина — fleet.routes.manage нет"},
		{"reviewTrip", http.MethodPost, trips + "{{ac06:trip-closing}}/review", `{"decision": "approve"}`, true,
			http.StatusForbidden, denied, "", "приёмка — fleet.trips.review нет"},
		{"releaseReservation", http.MethodPatch, "/api/v1/tenants/{{tenant:b}}/fleet/reservations/{{ac06:reservation-closing}}",
			`{"action": "release"}`, true, http.StatusForbidden, denied, "", "снять бронь — fleet.reservations.manage нет"},
	}
}

var ac06RefRe = regexp.MustCompile(`\{\{([^{}]+)\}\}`)

// runAC06Commands sends each command as the temporary driver and checks the answer of the overlay.
func runAC06Commands(t *testing.T, s *matrix.Suite) {
	t.Helper()
	actor, err := s.Refs.Actor(ac06Driver)
	if err != nil {
		t.Fatal(err)
	}
	resolve := func(in string) string {
		return ac06RefRe.ReplaceAllStringFunc(in, func(m string) string {
			id, err := s.Refs.ID(m[2 : len(m)-2])
			if err != nil {
				t.Fatalf("%s: %v", m, err)
			}
			return id.String()
		})
	}
	for _, c := range ac06Commands() {
		t.Run(c.op, func(t *testing.T) {
			req := httptest.NewRequestWithContext(t.Context(), c.method, resolve(c.path), strings.NewReader(resolve(c.body)))
			if c.body != "" {
				req.Header.Set("Content-Type", "application/json")
			}
			if c.ifMatch {
				req.Header.Set("If-Match", `"999"`)
			}
			if err := s.Target.Authenticate(req, actor); err != nil {
				t.Fatal(err)
			}
			rec := httptest.NewRecorder()
			s.Target.Handler.ServeHTTP(rec, req)
			body := rec.Body.String()
			if rec.Code != c.want || !strings.Contains(body, `"`+c.code+`"`) || !strings.Contains(body, c.detail) {
				t.Errorf("%s %s: %d %s — want %d %s %q (%s)", c.method, c.path, rec.Code, body, c.want, c.code, c.detail, c.note)
			}
		})
	}
}
