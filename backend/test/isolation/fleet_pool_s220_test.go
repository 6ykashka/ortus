//go:build isolation

package isolation

import (
	"maps"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
	"github.com/ortus/ortus-crm/backend/test/isolation/matrix"
)

// S2-20 «Машина для временного водителя» (W2.71, контракт 0.7.1-stage4, tenant 0023; D-35 комплекта; docs/29
// «Приёмка» — дополнения к AC-06). Временный водитель b.driver-msk1 (тенант B, «Москва-1» → «Москва-2», как AC-06)
// получил предложения машин на рейсы перевода: открытое (машина фирмы рейса и его обычная, срок выбора через 90
// минут), просроченное (срок прошёл 20 минут назад), уже выбранное (одна confirmed, другая released) и предложение
// другому водителю; бронь без предложения. Строки ссылаются на объекты s220:*. Обработчика chooseReservation нет до
// W2.72 — строки pending: W2.72 (501 до хендлера; в строгом режиме isolation_pending — красные). Строка, ответ которой
// без W2.72 не 501 (бронь временного водителя: сейчас 404 надстройки рейса до окна), — только в строгом режиме: W2.72
// переносит её в обычный набор, когда она зелёная. Машины водителя до окна — обычная строка (строки области resource
// на каждую предложенную машину, как их пишет одобрение). Публикация и роль — свои (не пересекаются с засевом AC-06 того же водителя).

var s220Names = []string{
	"trip-offer", "trip-deadline", "trip-chosen", "trip-other",
	"vehicle-host", "vehicle-usual", "vehicle-spare", "vehicle-dl-host", "vehicle-dl-usual",
	"vehicle-ch-host", "vehicle-ch-usual", "vehicle-other",
	"res-host", "res-usual", "res-plain", "res-dl-host", "res-dl-usual", "res-ch-host", "res-ch-usual", "res-other",
}

func s220ID(name string) uuid.UUID { return ac06ID("s220-" + name) }

func s220IDs() map[string]uuid.UUID {
	out := map[string]uuid.UUID{}
	for _, n := range s220Names {
		out["s220:"+n] = s220ID(n)
	}
	return out
}

// s220Seed writes the offers of the temporary driver into tenant B (ortus_api, as W2.72 writes them).
type s220Seed struct{ ac06Seed }

// vehicle registers a vehicle of unit.
func (s *s220Seed) vehicle(name string, unit uuid.UUID) uuid.UUID {
	id := s220ID(name)
	s.exec(`insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3, cargo_length_mm)
		values ($1, $2, $3, 'van', 1500, 12, 3200)`, id, unit, "S2-"+id.String()[:6])
	s.exec(`insert into sched.resources (kind, ref_id, home_unit_id) values ('vehicle', $1, $2)`, id, unit)
	return id
}

// reserve writes a reservation of vehicle for trip over [from, until): an offer (group, to, kind, chooseUntil) or a
// plain hold (group uuid.Nil).
func (s *s220Seed) reserve(name string, vehicle, trip uuid.UUID, from, until time.Time, state string, expires any,
	group, to uuid.UUID, kind string, chooseUntil any, chosen, released any, reason any) {
	s.t.Helper()
	var g, o, k any
	if group != uuid.Nil {
		g, o, k = group, to, kind
	}
	s.exec(`insert into sched.reservations (id, resource_id, bundle_id, during, occupied, state, hold_expires_at,
		source_type, source_id, created_by, offer_group_id, offered_to, offer_kind, choose_until, chosen_at, released_at,
		release_reason)
		select $1, r.id, $1, tstzrange($3, $4), tstzrange($3, $4), $5, $6, 'fleet.trip', $7, $8, $9, $10, $11, $12, $13,
			$14, $15
		from sched.resources r where r.kind = 'vehicle' and r.ref_id = $2`,
		s220ID(name), vehicle, from, until, state, expires, trip, s.owner, g, o, k, chooseUntil, chosen, released, reason)
}

func (s *s220Seed) setup(w *fixtures.World) {
	b := func(ref string) uuid.UUID {
		id, err := w.ID(ref)
		if err != nil {
			s.t.Fatal(err)
		}
		return id
	}
	s.driver, s.home, s.target, s.owner = b("person:b.driver-msk1@b"), b("unit:b.msk1"), b("unit:b.msk2"), b("person:b.owner@b")
	s.other = s.id(`insert into people.person_profiles (full_name, home_unit_id) values ('Другой водитель S2-20', $1)
		returning id`, s.target)
	s.role = s.id(`insert into access.roles (name, kind, template_key) values ('Временный водитель · S2-20', 'system',
		'temporary_driver') returning id`)
	s.exec(`insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
		s.role, pool.TemporaryDriverActions, s.owner)
	s.publication = s.id(`insert into fleet.pool_publications (person_id, home_unit_id, available, published_by,
		display_name) values ($1, $2, tstzrange($3, $4), $5, 'Водитель #S2-20') returning id`, s.driver, s.home,
		s.at(40*24*time.Hour), s.at(50*24*time.Hour), s.owner)
}

// seedS220 writes the offers (the clock of the suite — harness.Now) and raises policy_version.
func seedS220(t *testing.T) {
	t.Helper()
	w, ok := suite.Refs.(*fixtures.World)
	if !ok {
		t.Fatalf("suite refs %T, want the fixtures", suite.Refs)
	}
	s := &s220Seed{ac06Seed{t: t, db: w.Cluster.DB(t, w.TenantDBs[fixtures.TenantB], migrations.RoleAPI), now: w.Now}}
	s.setup(w)
	h, m := time.Hour, time.Minute
	d := s.driver
	none := any(nil)

	// Открытое предложение: окно через 2 часа, срок выбора — за 30 минут до него (TD-02).
	host, usual, spare := s.vehicle("vehicle-host", s.target), s.vehicle("vehicle-usual", s.home), s.vehicle("vehicle-spare", s.target)
	from, until := s.at(2*h), s.at(6*h)
	choose := from.Add(-30 * m)
	offer := s.trip("s220-trip-offer", "planned", d, uuid.Nil, from, until)
	s.transfer(offer, "approved", from, until, until, "active", host, until)
	// С одобрения водителю открыты рейс и предложенные машины (S2-20; выбор — до окна): строка роли в области self и
	// строки области resource на каждую предложенную машину.
	s.grant("self", nil, s.at(-h), until, "active")
	s.grant("resource", host, s.at(-h), until, "active")
	s.grant("resource", usual, s.at(-h), until, "active")
	group := uuid.New()
	s.exec(`update fleet.driver_transfers set vehicle_mode = 'host_or_home', host_vehicle_id = $2, home_vehicle_id = $3,
		vehicle_decision = 'approved', offer_group_id = $4 where trip_id = $1`, offer, host, usual, group)
	s.reserve("res-host", host, offer, from, until, "hold", choose, group, d, "host", choose, none, none, none)
	s.reserve("res-usual", usual, offer, from, until, "hold", choose, group, d, "usual", choose, none, none, none)
	// Бронь без предложения на тот же рейс (поставил владелец) — выбирать нечего.
	s.reserve("res-plain", spare, offer, from, until, "hold", s.at(30*m), uuid.Nil, uuid.Nil, "", none, none, none, none)

	// Срок выбора прошёл (окно через 10 минут, срок — 20 минут назад), выбора не было.
	dlFrom, dlUntil := s.at(10*m), s.at(4*h)
	dlChoose := dlFrom.Add(-30 * m)
	deadline := s.trip("s220-trip-deadline", "planned", d, uuid.Nil, dlFrom, dlUntil)
	s.transfer(deadline, "approved", dlFrom, dlUntil, dlUntil, "active", uuid.Nil, time.Time{})
	dlGroup := uuid.New()
	dlHost, dlUsual := s.vehicle("vehicle-dl-host", s.target), s.vehicle("vehicle-dl-usual", s.home)
	s.reserve("res-dl-host", dlHost, deadline, dlFrom, dlUntil, "hold", dlChoose, dlGroup, d, "host", dlChoose, none, none, none)
	s.reserve("res-dl-usual", dlUsual, deadline, dlFrom, dlUntil, "hold", dlChoose, dlGroup, d, "usual", dlChoose, none, none, none)

	// Уже выбрано: обычная подтверждена 5 минут назад, машина фирмы рейса снята (chosen).
	chFrom, chUntil := s.at(3*h), s.at(7*h)
	chosen := s.trip("s220-trip-chosen", "planned", d, uuid.Nil, chFrom, chUntil)
	s.transfer(chosen, "approved", chFrom, chUntil, chUntil, "active", uuid.Nil, time.Time{})
	chGroup := uuid.New()
	chHost, chUsual := s.vehicle("vehicle-ch-host", s.target), s.vehicle("vehicle-ch-usual", s.home)
	s.reserve("res-ch-usual", chUsual, chosen, chFrom, chUntil, "confirmed", chUntil, chGroup, d, "usual", chFrom.Add(-30*m),
		s.at(-5*m), none, none)
	s.reserve("res-ch-host", chHost, chosen, chFrom, chUntil, "released", chFrom.Add(-30*m), chGroup, d, "host",
		chFrom.Add(-30*m), none, s.at(-5*m), "chosen")

	// Предложение другому водителю на его рейс.
	other := s.trip("s220-trip-other", "planned", s.other, uuid.Nil, from, until)
	vOther := s.vehicle("vehicle-other", s.target)
	s.reserve("res-other", vOther, other, from, until, "hold", choose, uuid.New(), s.other, "host", choose, none, none, none)

	s.exec(`update access.policy_state set policy_version = policy_version + 1 where $1::uuid is not null`, d)
}

const s220Driver = "b.driver-msk1"

func s220Row(params map[string]string, status int, code string, present, absent []string, note string) matrix.Row {
	p := map[string]string{"tenantId": "tenant:b"}
	maps.Copy(p, params)
	return matrix.Row{Actor: s220Driver, Params: p, Status: status, Code: code, Present: present, Absent: absent, Note: note}
}

// s220Rows are the rows of S2-20 (docs/29 «Приёмка»; DoR s2-20 §6): pending W2.72 — the handler of chooseReservation.
func s220Rows(strict bool) matrix.File {
	const choose = "/api/v1/tenants/{tenantId}/fleet/reservations/{reservationId}/choose"
	res := func(name string) map[string]string { return map[string]string{"reservationId": "s220:" + name} }
	f := matrix.File{Module: "fleet_pool_s220", Endpoints: []matrix.Endpoint{
		{Op: "chooseReservation", Method: http.MethodPost, Path: choose, Channel: matrix.ChannelHTTP, Pending: "W2.72",
			Rows: []matrix.Row{
				s220Row(res("res-plain"), http.StatusNotFound, "not_found", nil, []string{"s220:res-plain"},
					"бронь рейса без предложения — 404, как несуществующая"),
				s220Row(res("res-other"), http.StatusNotFound, "not_found", nil, []string{"s220:res-other", "s220:trip-other"},
					"предложение другому водителю на его рейс — 404"),
				s220Row(res("res-dl-usual"), http.StatusConflict, "offer_closed", nil, nil,
					"срок выбора прошёл — 409 offer_closed, данные не меняются"),
				s220Row(res("res-ch-host"), http.StatusConflict, "offer_closed", nil, nil,
					"второй выбор после выбора — 409 offer_closed"),
				s220Row(res("res-ch-usual"), http.StatusConflict, "offer_closed", nil, nil,
					"повторный выбор выбранной (новый ключ) — 409 offer_closed"),
			}},
	}}
	// Машины временного водителя до окна — только предложенные (строки области resource, как их пишет одобрение).
	f.Endpoints = append(f.Endpoints, matrix.Endpoint{Op: "listVehicles", Method: http.MethodGet,
		Path: "/api/v1/tenants/{tenantId}/fleet/vehicles", Channel: matrix.ChannelHTTP, Rows: []matrix.Row{
			s220Row(nil, http.StatusOK, "", []string{"s220:vehicle-host", "s220:vehicle-usual"},
				[]string{"s220:vehicle-spare", "s220:vehicle-dl-host", "s220:vehicle-ch-host", "s220:vehicle-other"},
				"до окна — только машины, предложенные ему на рейс; других машин фирм нет"),
		}})
	if !strict {
		return f
	}
	// Ответ этой строки без W2.72 — не 501 (обработчик есть, сейчас 404 надстройки рейса до окна): только в строгом
	// режиме, пока W2.72 не даст 403 временному водителю.
	f.Endpoints = append(f.Endpoints,
		matrix.Endpoint{Op: "reserveVehicle", Method: http.MethodPost, Path: "/api/v1/tenants/{tenantId}/fleet/reservations",
			Channel: matrix.ChannelHTTP, Pending: "W2.72", Rows: []matrix.Row{func() matrix.Row {
				r := s220Row(nil, http.StatusForbidden, "forbidden_action", nil, nil,
					"временный водитель брони не создаёт — 403 (вариант (a) отклонён)")
				r.Body = `{"vehicleId": "{{s220:vehicle-spare}}", "driverMemberId": "{{person:b.driver-msk1@b}}", ` +
					`"tripId": "{{s220:trip-offer}}", "window": {"startsAt": "2026-10-01T09:30:00Z", "endsAt": "2026-10-01T13:30:00Z", ` +
					`"timeZone": "Europe/Moscow"}}`
				return r
			}()}},
	)

	return f
}

func TestIsolationFleetPoolS220(t *testing.T) {
	t.Parallel()
	seedS220(t)
	s := &matrix.Suite{Refs: ac06Refs{base: suite.Refs, ids: s220IDs()}, Target: suite.Target, Strict: suite.Strict}
	matrix.Run(t, s, s220Rows(suite.Strict))
}
