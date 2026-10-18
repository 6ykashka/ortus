//go:build concurrency

// Isolation negatives of the logistics on real objects (AC-01, AC-02, AC-05, AUTH-05; W2.30). The fixtures of W1.04
// have no trips, reservations, inspections, expenses or earnings, so the rows of backend/test/isolation take the id of
// a vehicle as «not a trip». Here the objects are made by shifts through the API and the rows of this file — one per
// operation and foreign seat — require for each of them:
//
//   - the answer equals the answer to the same request with every id of the objects replaced by a missing one (type,
//     title, status, code, detail: «чужой = несуществующий»);
//   - the status is the one of the gateway model below, with the x-permissions and the x-scope of the operation read
//     from the contract (internal/api/catalog): 404 not_found when the actor holds the action somewhere (or is no
//     member of the tenant of the path), 403 forbidden_action when it holds it nowhere, 403 function_blocked for the
//     earnings of a person with the function «Водитель» (D-10, ADR-0011), 501 for an operation without a handler;
//   - neither the body nor the headers carry an id of the objects; lists of the actor do not contain them;
//   - commands with the real If-Match change nothing: the ETags of the objects are the same after the rows, and the
//     legitimate actor then gets the answer of a live object (a positive control that the row hit it).
//
// Two sets of objects: those of the driver of the shifts (for the seats of other firms, tenants and drivers) and those
// of another driver of Москва-1 made by the owner (for the driver of the shifts himself: his grant on Москва-1 opens
// the vehicles of the firm, AUTH-05 «водитель видит свои брони, рейсы, осмотры» — not those of the other driver).
//
// The driver of the shifts himself sees his trips, his inbox and his context without any field of the earnings and
// gets 403 function_blocked for them (AC-05).

package concurrency

import (
	"encoding/json"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
)

// objects are the logistics objects of the negatives, made by one crew.
type objects struct {
	crew    crew
	done    *shift // accepted, earnings set: its vehicle, consumed reservation, inspections, approved expense, earnings
	open    *shift // submitted with a pending expense: acceptance and expense review
	held    *shift // reserved and inspected (a live hold): release, start, inspection, assignment
	blocked *shift // departure with a blocking defect in review
	defect  string
	earning string // finance.earnings.id of done (the DTO has no id: it must not surface anyway)
}

// ids are every id of the objects (what a foreign answer must never carry).
func (o objects) ids() []string {
	out := []string{}
	for _, s := range []*shift{o.done, o.open, o.held, o.blocked} {
		out = append(out, s.vehicle, s.trip, s.reservation, s.departure)
		for _, id := range []string{s.expense, s.ret} {
			if id != "" {
				out = append(out, id)
			}
		}
	}
	return append(out, o.defect, o.earning)
}

// vehicles are the vehicles of the objects.
func (o objects) vehicles() []string {
	return []string{o.done.vehicle, o.open.vehicle, o.held.vehicle, o.blocked.vehicle}
}

// newObjects runs the shifts of the negatives for crew c. A driver has one trip on the route at a time: done is
// accepted before open is started; held and blocked never start.
func newObjects(t *testing.T, c crew) objects {
	t.Helper()
	o := objects{crew: c}
	o.done = submittedOf(t, c)
	o.done.accept(t)
	draft := want(t, http.StatusOK, req{Actor: owner, Method: http.MethodGet, Path: o.done.earnings(t)})
	want(t, http.StatusOK, req{Actor: owner, Method: http.MethodPut, Path: o.done.earnings(t), IfMatch: draft.ETag(),
		Body: map[string]any{"amount": map[string]any{"amountMinor": earned, "currency": "RUB"}, "calculationNote": "Ставка за рейс"}})
	o.earning = scalar[string](t, `select id::text from finance.earnings where trip_id = $1::uuid`, o.done.trip)
	o.open = submittedOf(t, c)
	o.held = readyOf(t, c)
	var ds []map[string]any
	o.blocked, ds = blockedOf(t, c, "Шины и колёса")
	o.defect = str(ds[0], "id")
	return o
}

// earned is the amount of the earnings of the accepted shift (minor units): it never reaches the driver (AC-05).
const earned = 450000

// op is an operation of a row: its operationId (the contract gives its x-permissions and x-scope) and the request on
// the objects.
type op struct {
	name  string // the name of the row; the operationId unless id is set
	id    string // the operationId when the name differs (two rows of one operation)
	list  bool   // a list: 200 with none of the objects for an actor holding the action
	stub  bool   // no handler yet: an actor the gateway lets through gets 501 not_implemented, as for a missing id
	build func(t *testing.T, o objects, base string) req
	// extra are ids of the request besides the objects that the row replaces and looks for (the unit of a new vehicle).
	extra func(t *testing.T) []string
	// hidden is the answer of an object out of the scope of an actor holding the action (nil: 404 not_found).
	hidden *outcome
	// override is the outcome of an actor that a rule of the operation decides before the scope of the object (as a
	// row of the matrix says it): a driver reserves only for himself — 403 before the vehicle is looked up.
	override map[string]outcome
}

// operationID is the operationId of the row.
func (o op) operationID() string {
	if o.id != "" {
		return o.id
	}
	return o.name
}

// outcome is the status and the Problem.code of a row.
type outcome struct {
	status int
	code   string
}

// contract is the operation of the contract named id: the gateway of cmd/api checks the same entry before the handler.
func contract(t *testing.T, id string) catalog.Operation {
	t.Helper()
	for _, c := range catalog.Operations {
		if c.ID == id {
			if len(c.Permissions) != 1 || c.PermissionsMode != "all" {
				t.Fatalf("%s: x-permissions %v (%s) — the model of the rows takes one action", id, c.Permissions, c.PermissionsMode)
			}
			return c
		}
	}
	t.Fatalf("no operation %s in the contract", id)
	return catalog.Operation{}
}

// follows fails the test unless r is a request of the operation id of the contract (method and path template): the
// action and the scope of the model are those of the operation the request reaches.
func follows(t *testing.T, id string, r req) {
	t.Helper()
	c := contract(t, id)
	path, _, _ := strings.Cut(r.Path, "?")
	tpl, got := strings.Split(c.Path, "/"), strings.Split(path, "/")
	ok := r.Method == c.Method && len(tpl) == len(got)
	for i := 0; ok && i < len(tpl); i++ {
		ok = got[i] == tpl[i] || (strings.HasPrefix(tpl[i], "{") && got[i] != "")
	}
	if !ok {
		t.Fatalf("row %s: %s %s is not %s %s of the contract", id, r.Method, r.Path, c.Method, c.Path)
	}
}

func get(path string) func(*testing.T, objects, string) req {
	return func(_ *testing.T, _ objects, base string) req { return req{Method: http.MethodGet, Path: base + path} }
}

// ops are the reads of the rows. Paths are relative to the fleet base of the tenant of the row.
func ops() []op {
	return []op{
		{name: "listVehicles", list: true, build: get("/vehicles")},
		{name: "listReservations", list: true, build: get("/reservations")},
		{name: "listTrips", list: true, build: get("/trips")},
		{name: "listTripPlans", list: true, build: get("/trip-plans")},
		{name: "listInspections", list: true, build: get("/inspections")},
		{name: "listInspectionDefects", list: true, build: get("/defects?state=in_review")},
		{name: "listTripEarnings", list: true, build: get("/earnings")},
		{name: "getReservation", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodGet, Path: b + "/reservations/" + o.held.reservation}
		}},
		{name: "getTrip", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodGet, Path: b + "/trips/" + o.done.trip}
		}},
		{name: "getTripPlan", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodGet, Path: b + "/trip-plans/" + o.done.trip}
		}},
		{name: "getInspection", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodGet, Path: b + "/inspections/" + o.done.departure}
		}},
		{name: "getReturnInspection", id: "getInspection", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodGet, Path: b + "/inspections/" + o.done.ret}
		}},
		{name: "getInspectionChecklist", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodGet, Path: b + "/inspection-checklist?vehicleId=" + o.held.vehicle + "&kind=departure"}
		}, override: map[string]outcome{
			driver: {http.StatusOK, ""}, // the vehicles of Москва-1 are his (W2.02, Q-W2.30-1): not a foreign object
		}},
		{name: "getInspectionDefect", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodGet, Path: b + "/defects/" + o.defect}
		}},
		{name: "listTripExpenses", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodGet, Path: b + "/trips/" + o.done.trip + "/expenses"}
		}},
		{name: "getTripExpense", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodGet, Path: b + "/trips/" + o.done.trip + "/expenses/" + o.done.expense}
		}},
		{name: "getTripEarnings", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodGet, Path: b + "/trips/" + o.done.trip + "/earnings"}
		}},
	}
}

// command is a command of the rows, with the real If-Match of the objects (tags) and its positive control: the
// legitimate actor ("" — the crew of the objects) and the answer of a live object to it.
type command struct {
	op
	control string
	want    outcome
}

// vehicleBody is a new vehicle of unit for createVehicle.
func vehicleBody(t *testing.T, unit uuid.UUID) map[string]any {
	t.Helper()
	return map[string]any{
		"orgUnitId": unit, "registrationNumber": "К " + strings.ToUpper(uuid.NewString()[:6]) + " 99", "displayName": "Чужая машина",
		"bodyType": "van", "equipment": []string{}, "odometerKm": "0",
		"capacity": map[string]any{"payloadKg": "1500", "volumeM3": "16", "cargoLengthM": "4.2", "cargoWidthM": "1.9", "cargoHeightM": "2"},
	}
}

// msk1 is the unit of the objects (Москва-1 of tenant A): a new vehicle or trip there is foreign to another firm.
func msk1(t *testing.T) []string { t.Helper(); return []string{ref(t, "unit:a.msk1").String()} }

// invalidUnit is the answer of createVehicle and createTripPlan to a unit out of the scope of the actor: the same as
// to a unit that does not exist (vehicles/create.go unitOf: «unknown unit»).
var invalidUnit = &outcome{http.StatusUnprocessableEntity, "validation_failed"}

func commands(tags map[string]string) []command {
	return []command{
		{op: op{name: "releaseReservation", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodPatch, Path: b + "/reservations/" + o.held.reservation, IfMatch: tags["reservation"],
				Body: map[string]any{"action": "release", "reason": "Чужая бронь"}}
		}}, control: owner, want: outcome{http.StatusOK, ""}},
		{op: op{name: "reserveVehicle", build: func(t *testing.T, o objects, b string) req {
			t.Helper()
			who := person(t, driver) // the driver of the shifts in A; the namesake driver in B
			if strings.Contains(b, ref(t, "tenant:b").String()) {
				who = ref(t, "person:b.driver-msk1@b")
			}
			return req{Method: http.MethodPost, Path: b + "/reservations",
				Body: map[string]any{"vehicleId": o.held.vehicle, "driverMemberId": who, "window": o.held.win.hold().json()}}
		}, override: map[string]outcome{
			selfDriver: {http.StatusForbidden, "forbidden_action"}, "a.driver-earnings": {http.StatusForbidden, "forbidden_action"},
			// the vehicle of the other driver is a vehicle of Москва-1 the driver sees: it is held in the window
			driver: {http.StatusConflict, "reservation_overlap"},
		}}, control: owner, want: outcome{http.StatusCreated, ""}},
		{op: op{name: "startTrip", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodPost, Path: b + "/trips",
				Body: map[string]any{"reservationId": o.held.reservation, "departureInspectionId": o.held.departure}}
		}}, want: outcome{http.StatusConflict, "invalid_transition"}},
		{op: op{name: "submitInspection", build: func(t *testing.T, o objects, b string) req {
			t.Helper()
			return req{Method: http.MethodPost, Path: b + "/inspections", Body: map[string]any{
				"checklistVersionId": tags["checklist"], "vehicleId": o.held.vehicle, "reservationId": o.held.reservation,
				"kind": "departure", "odometerKm": "48260", "fuelPercent": 75, "capturedAt": "2026-10-01T07:20:00Z",
				"photos": shots(files(t, "inspection", "fleet.reservation", o.held.reservation, 5)),
				"checks": []map[string]any{{"key": "body", "result": "pass"}, {"key": "tires", "result": "pass"}, {"key": "docs", "result": "pass"}},
			}}
		}}, want: outcome{http.StatusConflict, "invalid_transition"}},
		{op: op{name: "assignTripVehicle", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodPut, Path: b + "/trips/" + o.held.trip + "/vehicle", IfMatch: tags["held"],
				Body: map[string]any{"vehicleId": o.held.vehicle}}
		}}, control: owner, want: outcome{http.StatusPreconditionFailed, "revision_mismatch"}},
		{op: op{name: "decideInspectionDefect", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodPost, Path: b + "/defects/" + o.defect + "/decision", IfMatch: tags["defect"],
				Body: map[string]any{"decision": "allow_departure", "comment": "Чужое решение"}}
		}}, control: logist, want: outcome{http.StatusOK, ""}},
		{op: op{name: "reviewInspection", stub: true, build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodPost, Path: b + "/inspections/" + o.blocked.departure + "/review",
				Body: map[string]any{"decision": "approve", "comment": "Чужая проверка"}}
		}}, control: logist, want: outcome{http.StatusNotImplemented, "not_implemented"}},
		{op: op{name: "createTripExpense", build: func(t *testing.T, o objects, b string) req {
			t.Helper()
			return req{Method: http.MethodPost, Path: b + "/trips/" + o.open.trip + "/expenses", Body: map[string]any{
				"kind": "other", "occurredAt": "2026-10-01T07:30:00Z", "comment": "Чужой расход",
				"amount":         map[string]any{"amountMinor": 1000, "currency": "RUB"},
				"receiptFileIds": files(t, "expense_receipt", "fleet.trip", o.open.trip, 1),
			}}
		}}, want: outcome{http.StatusConflict, "invalid_transition"}},
		{op: op{name: "finishTripRoute", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodPost, Path: b + "/trips/" + o.open.trip + "/route-completion", IfMatch: tags["open"]}
		}}, want: outcome{http.StatusConflict, "invalid_transition"}},
		{op: op{name: "returnTrip", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodPatch, Path: b + "/trips/" + o.open.trip, IfMatch: tags["open"],
				Body: map[string]any{"action": "return", "returnInspectionId": o.open.ret}}
		}}, want: outcome{http.StatusConflict, "invalid_transition"}},
		{op: op{name: "reviewTripExpense", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodPost, Path: b + "/trips/" + o.open.trip + "/expenses/" + o.open.expense + "/review",
				IfMatch: tags["expense"], Body: map[string]any{"decision": "reject", "comment": "Чужая проверка"}}
		}}, control: logist, want: outcome{http.StatusOK, ""}},
		{op: op{name: "reviewTrip", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodPost, Path: b + "/trips/" + o.open.trip + "/review", IfMatch: tags["open"],
				Body: map[string]any{"decision": "approve"}}
		}}, control: logist, want: outcome{http.StatusOK, ""}},
		{op: op{name: "setTripEarnings", build: func(_ *testing.T, o objects, b string) req {
			return req{Method: http.MethodPut, Path: b + "/trips/" + o.done.trip + "/earnings", IfMatch: tags["earnings"],
				Body: map[string]any{"amount": map[string]any{"amountMinor": 1, "currency": "RUB"}, "calculationNote": "Чужая запись"}}
		}}, control: owner, want: outcome{http.StatusOK, ""}},
		{op: op{name: "createVehicle", extra: msk1, hidden: invalidUnit, build: func(t *testing.T, _ objects, b string) req {
			t.Helper()
			return req{Method: http.MethodPost, Path: b + "/vehicles", Body: vehicleBody(t, ref(t, "unit:a.msk1"))}
		}}, control: logist, want: outcome{http.StatusCreated, ""}},
		{op: op{name: "createTripPlan", extra: msk1, hidden: invalidUnit, build: func(t *testing.T, _ objects, b string) req {
			t.Helper()
			w := newWindow()
			return req{Method: http.MethodPost, Path: b + "/trip-plans", Body: map[string]any{
				"orgUnitId": ref(t, "unit:a.msk1"), "title": "Чужой рейс", "plannedWindow": w.json(),
				"cargo": map[string]any{"description": "Сухой груз", "weightKg": "500", "volumeM3": "4", "lengthM": "2"},
				"stops": []map[string]any{{"sequence": 1, "op": "load", "address": "Склад", "weightKg": "500", "volumeM3": "4"}},
			}}
		}}, control: logist, want: outcome{http.StatusCreated, ""}},
	}
}

// seat is a foreign actor and the tenant of the path it calls; theirs — the row reads the objects of another driver
// of the firm (the seat is the driver of the shifts).
type seat struct {
	actor, tenant string
	theirs        bool
}

func (s seat) String() string {
	if s.theirs {
		return s.actor + "@" + s.tenant + "~theirs"
	}
	return s.actor + "@" + s.tenant
}

// seats are the foreign seats of the rows: the neighbouring firm, an observer of another firm, a driver of the firm
// with a role on «своё», a driver with the earnings of the firm through a group, another tenant through the path of
// tenant A and through its own path with the ids of A, and the driver of the shifts (a role on Москва-1 in a temporary
// assignment) on the objects of another driver of Москва-1 (brief §1 item 6).
func seats() []seat {
	return []seat{
		{actor: neighbour, tenant: fixtures.TenantA}, {actor: observer, tenant: fixtures.TenantA},
		{actor: selfDriver, tenant: fixtures.TenantA}, {actor: "a.driver-earnings", tenant: fixtures.TenantA},
		{actor: foreign, tenant: fixtures.TenantA}, {actor: foreign, tenant: fixtures.TenantB}, {actor: namesake, tenant: fixtures.TenantB},
		{actor: driver, tenant: fixtures.TenantA, theirs: true},
	}
}

// foreignIDs are the ids of o the seat must not see: every id, except the vehicles for the driver of the shifts — the
// vehicles of Москва-1 are open to his role there (W2.02, Q-W2.30-1), the reservations, trips, inspections, defects,
// expenses and earnings of the other driver are not (AUTH-05).
func foreignIDs(s seat, o objects) []string {
	ids := o.ids()
	if s.theirs {
		ids = slices.DeleteFunc(ids, func(id string) bool { return slices.Contains(o.vehicles(), id) })
	}
	return ids
}

// expected is the outcome of op for the seat by the gateway model of the fixtures and the contract: no membership —
// 404; the earnings of a person with the function «Водитель» — 403 function_blocked; the action in no grant of a scope
// kind the x-scope accepts — 403 forbidden_action; an operation without a handler — 501; otherwise the object is out
// of the scope — 404 (a list: 200; a unit of a body: the answer of hidden).
func expected(t *testing.T, s seat, o op) outcome {
	t.Helper()
	if w, ok := o.override[s.actor]; ok {
		return w
	}
	c := contract(t, o.operationID())
	m, ok := membership(t, s)
	switch {
	case !ok:
		return outcome{http.StatusNotFound, "not_found"}
	case strings.HasPrefix(c.Permissions[0], "fleet.earnings.") && m.Function == "driver":
		return outcome{http.StatusForbidden, "function_blocked"}
	case !holds(t, s.tenant, m, c):
		return outcome{http.StatusForbidden, "forbidden_action"}
	case o.stub:
		return outcome{http.StatusNotImplemented, "not_implemented"}
	case o.list:
		return outcome{http.StatusOK, ""}
	case o.hidden != nil:
		return *o.hidden
	}
	return outcome{http.StatusNotFound, "not_found"}
}

func membership(t *testing.T, s seat) (fixtures.MemberDef, bool) {
	t.Helper()
	for _, a := range world.Catalog.Actors {
		if a.Key != s.actor {
			continue
		}
		for _, m := range a.Memberships {
			if m.Tenant == s.tenant {
				return m, true
			}
		}
		return fixtures.MemberDef{}, false
	}
	t.Fatalf("no actor %s", s.actor)
	return fixtures.MemberDef{}, false
}

// holds tells whether membership m holds the action of the operation c in a current grant of a role or a group of a
// scope kind its x-scope accepts: a grant on «своё» counts only when the x-scope names self (W0.09: a grant of a kind
// the x-scope does not name is no grant for the gateway).
func holds(t *testing.T, tenant string, m fixtures.MemberDef, c catalog.Operation) bool {
	t.Helper()
	if m.Owner {
		return true
	}
	selfScoped := strings.Contains(c.Scope, "self")
	def := tenantDef(t, tenant)
	for _, g := range grantsOf(def, m) {
		if g.Period == fixtures.PeriodExpired || g.Period == fixtures.PeriodFuture || (g.Scope == fixtures.ScopeSelf && !selfScoped) {
			continue
		}
		for _, r := range def.Roles {
			if r.Key == g.Role && slices.Contains(r.Actions, c.Permissions[0]) {
				return true
			}
		}
	}
	return false
}

// tenantDef is the fixture tenant of key.
func tenantDef(t *testing.T, key string) fixtures.TenantDef {
	t.Helper()
	for _, td := range world.Catalog.Tenants {
		if td.Key == key {
			return td
		}
	}
	t.Fatalf("no tenant %s", key)
	return fixtures.TenantDef{}
}

// grantsOf are the grants of membership m: its own and those of its groups.
func grantsOf(def fixtures.TenantDef, m fixtures.MemberDef) []fixtures.GrantDef {
	grants := slices.Clone(m.Grants)
	for _, g := range def.Groups {
		if slices.Contains(m.Groups, g.Key) {
			grants = append(grants, g.Grants...)
		}
	}
	return grants
}

// missing is r with every id of ids replaced by a fresh one (the same id everywhere it occurs).
func missing(t *testing.T, r req, ids []string) req {
	t.Helper()
	body := ""
	if r.Body != nil {
		raw, err := json.Marshal(r.Body)
		if err != nil {
			t.Fatal(err)
		}
		body = string(raw)
	}
	path := r.Path
	for _, id := range ids {
		fresh := uuid.NewString()
		path, body = strings.ReplaceAll(path, id, fresh), strings.ReplaceAll(body, id, fresh)
	}
	r.Path = path
	if body != "" {
		r.Body = json.RawMessage(body)
	}
	return r
}

// leaks returns the ids of ids found in the body or the headers of r.
func leaks(r reply, ids []string) []string {
	var hs strings.Builder
	for k, vs := range r.Header {
		hs.WriteString(k + ": " + strings.Join(vs, ",") + "\n")
	}
	text := strings.ToLower(string(r.Raw) + "\n" + hs.String())
	var out []string
	for _, id := range ids {
		if strings.Contains(text, strings.ToLower(id)) {
			out = append(out, id)
		}
	}
	return out
}

// sameProblem tells whether two error answers say the same thing.
func sameProblem(a, b reply) bool {
	if a.Status != b.Status {
		return false
	}
	for _, k := range []string{"type", "title", "code", "detail"} {
		if str(a.Body, k) != str(b.Body, k) {
			return false
		}
	}
	return true
}

// row runs op as the seat on o and returns what is wrong: the status and the code against the model, a leak (on
// every page of a list), an answer other than the one for missing ids (errors).
func row(t *testing.T, s seat, o op, objs objects) []string {
	t.Helper()
	ids := foreignIDs(s, objs)
	if o.extra != nil {
		ids = append(ids, o.extra(t)...)
	}
	r := o.build(t, objs, fleetOf(t, s.tenant))
	follows(t, o.operationID(), r)
	r.Actor = s.actor
	w := expected(t, s, o)
	var answers []reply
	if o.list {
		answers = pages(t, r)
	} else {
		answers = []reply{call(t, r)}
	}
	got := answers[0]
	if got.Status != w.status || got.Code() != w.code {
		return []string{o.name + " as " + s.String() + ": " + got.String() + ", want " + strconv.Itoa(w.status) + " " + w.code}
	}
	var out []string
	for _, a := range answers {
		if l := leaks(a, ids); len(l) > 0 {
			out = append(out, o.name+" as "+s.String()+": the answer carries the ids "+strings.Join(l, ", ")+": "+a.String())
		}
	}
	if got.Status < http.StatusBadRequest {
		return out
	}
	if twin := call(t, missing(t, r, ids)); !sameProblem(got, twin) {
		out = append(out, o.name+" as "+s.String()+": the answer for the objects differs from the one for missing ids (AC-01):\n  real    "+
			got.String()+"\n  missing "+twin.String())
	}
	return out
}

// tags are the ETags of the objects the commands change, read by the owner (and the checklist of the held vehicle).
func tags(t *testing.T, o objects) map[string]string {
	t.Helper()
	etag := func(path string) string {
		t.Helper()
		return want(t, http.StatusOK, req{Actor: owner, Method: http.MethodGet, Path: fleet(t) + path}).ETag()
	}
	return map[string]string{
		"reservation": etag("/reservations/" + o.held.reservation),
		"held":        etag("/trip-plans/" + o.held.trip),
		"open":        etag("/trip-plans/" + o.open.trip),
		"done":        etag("/trip-plans/" + o.done.trip),
		"blocked":     etag("/trip-plans/" + o.blocked.trip),
		"inspection":  etag("/inspections/" + o.blocked.departure),
		"expense":     etag("/trips/" + o.open.trip + "/expenses/" + o.open.expense),
		"defect":      etag("/defects/" + o.defect),
		"earnings":    etag("/trips/" + o.done.trip + "/earnings"),
		"checklist":   o.held.checklist(t, "departure"),
	}
}

// sets are the two sets of objects of the rows: those of the driver of the shifts and those of another driver.
type sets struct{ mine, theirs objects }

// of is the set of objects the seat reads.
func (ss sets) of(s seat) objects {
	if s.theirs {
		return ss.theirs
	}
	return ss.mine
}

// TestIsolationLogistics: the rows of every read, list and command of the logistics for every foreign seat, on real
// objects; then the objects are unchanged and the legitimate actors get the answers of live objects.
func TestIsolationLogistics(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	ss := sets{mine: newObjects(t, ours(t)), theirs: newObjects(t, theirs(t))}
	for _, o := range []objects{ss.mine, ss.theirs} {
		for _, rd := range ops() { // the reads of the rows reach live objects: the owner reads each of them
			r := rd.build(t, o, fleet(t))
			r.Actor = owner
			want(t, http.StatusOK, r)
		}
	}
	before := map[bool]map[string]string{false: tags(t, ss.mine), true: tags(t, ss.theirs)}
	rows(t, ss, before)
	for theirs, o := range map[bool]objects{false: ss.mine, true: ss.theirs} {
		after := tags(t, o)
		for k, v := range before[theirs] {
			if k != "checklist" && after[k] != v {
				t.Errorf("object %s (theirs %v) changed by the rows: ETag %s → %s", k, theirs, v, after[k])
			}
		}
	}
	if !t.Failed() {
		controls(t, ss.mine, before[false])
		controls(t, ss.theirs, before[true])
	}
}

// Questions of the rows that reproduce a defect of a foreign package (report W2.30, decisionsNeeded).
const (
	qDriverReads = "Q-W2.30-4: водитель с ролью «Водитель» на подразделении читает брони, осмотры и дефекты другого водителя " +
		"этого подразделения — reservations/inspections/defects читают по v.unit_id без ограничения функции «Водитель» " +
		"(driverOnly есть только в trips, review, expenses, finance; AUTH-05)"
	qDriverSubmit = "Q-W2.30-5: submitInspection на бронь другого водителя видимой машины — 403 «Осмотр отправляет водитель " +
		"рейса.», на несуществующую бронь — 404: ответ раскрывает чужую бронь (AC-01)"
	qHeldByTrip = "Q-W2.30-6: listVehicles водителя несёт heldByTripId рейса другого водителя, которого getTrip ему не отдаёт"
)

// known are the rows that reproduce a defect of a foreign package (brief §2: the test stays, its failing part is
// skipped with its question; the logged lines are the red). A known row that passes fails: the defect is gone and
// its entry must go.
var known = map[string]string{
	"a.driver-msk2@a~theirs/listReservations":    qDriverReads,
	"a.driver-msk2@a~theirs/getReservation":      qDriverReads,
	"a.driver-msk2@a~theirs/listInspections":     qDriverReads,
	"a.driver-msk2@a~theirs/getInspection":       qDriverReads,
	"a.driver-msk2@a~theirs/getReturnInspection": qDriverReads,
	"a.driver-msk2@a~theirs/getInspectionDefect": qDriverReads,
	"a.driver-msk2@a~theirs/submitInspection":    qDriverSubmit,
	"a.driver-msk2@a~theirs/listVehicles":        qHeldByTrip,
}

// rows runs every operation for every seat as a subtest, one after another: the rows try to change the same objects
// and their ETags are compared after all of them.
func rows(t *testing.T, ss sets, tags map[bool]map[string]string) {
	t.Helper()
	n, width := 0, 0
	for _, s := range seats() {
		all := ops()
		for _, c := range commands(tags[s.theirs]) {
			all = append(all, c.op)
		}
		width = len(all)
		for _, rd := range all {
			n++
			name := s.String() + "/" + rd.name
			t.Run(name, func(t *testing.T) {
				probs := row(t, s, rd, ss.of(s))
				if q, ok := known[name]; ok {
					if len(probs) == 0 {
						t.Fatalf("%s passes: %s no longer reproduces — drop the row from known", name, q)
					}
					for _, p := range probs {
						t.Log(p)
					}
					t.Skip(q)
				}
				for _, p := range probs {
					t.Error(p)
				}
			})
		}
	}
	t.Logf("%d rows: %d seats × %d operations", n, len(seats()), width)
}

// controls: the legitimate actors perform the commands of the rows with the same If-Match and get the answer of a live
// object (a 404 here would mean the rows proved nothing). The order is the one of commands: the release of the hold
// comes first, so the start and the departure inspection of the held trip answer invalid_transition and its
// assignment a stale If-Match; the submitted trip refuses a new expense, the finish and the return.
func controls(t *testing.T, o objects, tags map[string]string) {
	t.Helper()
	for _, c := range commands(tags) {
		r := c.build(t, o, fleet(t))
		r.Actor = c.control
		if r.Actor == "" {
			r.Actor = o.crew.by
		}
		if got := call(t, r); got.Status != c.want.status || got.Code() != c.want.code {
			t.Errorf("control %s as %s: %s, want %d %s", c.name, r.Actor, got, c.want.status, c.want.code)
		}
	}
}

// earnings returns the JSON path of the first trace of the earnings in doc (a key naming them, the amount of the
// earnings as a number or a string), "" when there is none.
func earnings(doc any, at string) string {
	switch v := doc.(type) {
	case map[string]any:
		for k, x := range v {
			if strings.Contains(strings.ToLower(k), "earning") {
				return at + "." + k
			}
			if w := earnings(x, at+"."+k); w != "" {
				return w
			}
		}
	case []any:
		for i, x := range v {
			if w := earnings(x, at+"["+strconv.Itoa(i)+"]"); w != "" {
				return w
			}
		}
	case float64:
		if v == earned {
			return at
		}
	case string:
		if v == strconv.Itoa(earned) {
			return at
		}
	}
	return ""
}

// AC-05 (D-10, I-11): the driver of an accepted shift reads his trip, its card, his lists, his inbox, his decisions
// and his context without a single field of the earnings, and the earnings themselves are 403 function_blocked — his
// own included.
func TestIsolationDriverEarnings(t *testing.T) { //nolint:paralleltest // one trip on the route per driver (trips_active_driver_uq)
	s := submitted(t)
	s.accept(t)
	draft := want(t, http.StatusOK, req{Actor: owner, Method: http.MethodGet, Path: s.earnings(t)})
	want(t, http.StatusOK, req{Actor: owner, Method: http.MethodPut, Path: s.earnings(t), IfMatch: draft.ETag(),
		Body: map[string]any{"amount": map[string]any{"amountMinor": earned, "currency": "RUB"}, "calculationNote": "Ставка за рейс"}})
	tenant := ref(t, "tenant:a").String()
	paths := []string{}
	for _, p := range []string{"/trips/" + s.trip, "/trip-plans/" + s.trip, "/trips", "/trip-plans", "/trips/" + s.trip + "/expenses"} {
		paths = append(paths, fleet(t)+p)
	}
	paths = append(paths, "/api/v1/me/context", "/api/v1/me/notifications?tenantId="+tenant, "/api/v1/me/notifications/summary",
		"/api/v1/me/decisions?tenantId="+tenant)
	for _, path := range paths {
		got := want(t, http.StatusOK, req{Actor: driver, Method: http.MethodGet, Path: path})
		var doc any
		if err := json.Unmarshal(got.Raw, &doc); err != nil {
			t.Fatalf("GET %s: %v", path, err)
		}
		if where := earnings(doc, "$"); where != "" {
			t.Errorf("GET %s of the driver carries the earnings at %s: %s", path, where, got)
		}
	}
	for _, path := range []string{s.earnings(t), fleet(t) + "/earnings"} {
		got := call(t, req{Actor: driver, Method: http.MethodGet, Path: path})
		if got.Status != http.StatusForbidden || got.Code() != "function_blocked" || strings.Contains(string(got.Raw), strconv.Itoa(earned)) {
			t.Errorf("GET %s of the driver: %s, want 403 function_blocked", path, got)
		}
	}
	got := call(t, req{Actor: driver, Method: http.MethodPut, Path: s.earnings(t), IfMatch: `"2"`,
		Body: map[string]any{"amount": map[string]any{"amountMinor": 1, "currency": "RUB"}}})
	if got.Status != http.StatusForbidden || got.Code() != "function_blocked" {
		t.Errorf("setTripEarnings of the driver: %s, want 403 function_blocked", got)
	}
}
