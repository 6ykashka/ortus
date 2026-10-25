//go:build integration

package forms

import (
	"context"
	"encoding/json"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// W4.24 (D-30 комплекта): the consumer of fleet.inspection.submitted.v1 writes the inspection of a trip as a response
// of «Осмотр машины» (recordInspection, api.js:64–77) with its rules; the rows of the inspection are written by the
// superuser as fleet/inspections writes them (the module of inspections and its event are W2.04).

// fakeDefects records the calls of the port of the task of a blocking defect (tasks/inspection.go is tested there).
type fakeDefects struct {
	mu    sync.Mutex
	calls map[uuid.UUID][]*uuid.UUID // inspection → the tasks of the responses given
}

func (f *fakeDefects) InspectionDefects(_ context.Context, _ pgx.Tx, _, inspection uuid.UUID, task *uuid.UUID) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls[inspection] = append(f.calls[inspection], task)
	return nil
}

func (f *fakeDefects) of(inspection uuid.UUID) []*uuid.UUID {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls[inspection]
}

// inspItems are the items of the checklists of the tests (DEP_CHECKS, RET_CHECKS of the prototype).
var inspItems = map[string][]checklistItem{
	inspDeparture: {{"body", "Кузов и стёкла осмотрены"}, {"tires", "Шины и световые приборы исправны"},
		{"docs", "Документы и комплект на месте"}},
	inspReturn: {{"cargo", "Груз выгружен полностью"}, {"personal", "Личные вещи забраны"}, {"keys", "Ключи и документы на месте"}},
}

// checklistOf is the version of the checklist of kind of the tests (the definition — by the trigger of tenant 0017).
func checklistOf(t *testing.T, kind string) uuid.UUID {
	t.Helper()
	id := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:w424:checklist:"+kind))
	items, err := json.Marshal(inspItems[kind])
	require.NoError(t, err)
	_, err = superA.Exec(t.Context(), `insert into fleet.checklist_versions (id, kind, version, items) values ($1, $2, 424, $3)
		on conflict do nothing`, id, kind, items)
	require.NoError(t, err)
	return id
}

// inspVehicle is the vehicle of the inspections of the tests (Москва-1; the fixtures of the module have no content).
func inspVehicle(t *testing.T) uuid.UUID {
	t.Helper()
	id := uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:w424:vehicle"))
	_, err := superA.Exec(t.Context(), `insert into fleet.vehicles (id, unit_id, plate, body_type, payload_kg, volume_m3,
		cargo_length_mm, display_name) values ($1, $2, 'А 424 МР 77', 'van', 1500, 12, 3200, 'ГАЗель Next') on conflict do nothing`,
		id, unit("msk1"))
	require.NoError(t, err)
	return id
}

// inspTrip is a planned trip of Москва-1 of the driver a.driver-msk1.
func inspTrip(t *testing.T, number string) uuid.UUID {
	t.Helper()
	id, now := uuid.New(), harness.Now()
	_, err := superA.Exec(t.Context(), `insert into fleet.trips (id, number, unit_id, state, driver_person_id, planned)
		values ($1, $2, $3, 'planned', $4, tstzrange($5::timestamptz, $6::timestamptz))`, id, number, unit("msk1"),
		person("a.driver-msk1"), now, now.Add(4*time.Hour))
	require.NoError(t, err)
	return id
}

// inspDefectRow is a defect an inspection reports.
type inspDefectRow struct {
	zone, severity, description string
}

// inspRow writes an inspection of trip (kind, attempt) with five photos, every item passed but those failed, and its
// defects (a blocking one of a departure — in the queue); its moment is the moment of the suites plus attempt seconds
// (a return — four hours later).
func inspRow(t *testing.T, trip uuid.UUID, kind string, attempt int, failed []string, defects ...inspDefectRow) (uuid.UUID, time.Time) {
	t.Helper()
	ctx := t.Context()
	checks := []map[string]string{}
	for _, it := range inspItems[kind] {
		r := "pass"
		if slices.Contains(failed, it.Key) {
			r = checkFail
		}
		checks = append(checks, map[string]string{"key": it.Key, "result": r})
	}
	photos := []map[string]string{}
	for _, role := range []string{"front", "rear", "left", "right", "odometer", "damage"} {
		photos = append(photos, map[string]string{"role": role, "fileId": uuid.NewString()})
	}
	answers, err := json.Marshal(map[string]any{"checks": checks, "photos": photos, "fuelPercent": 75, "odometerKm": "84530"})
	require.NoError(t, err)
	at := harness.Now().Add(time.Duration(attempt) * time.Second)
	if kind == inspReturn {
		at = at.Add(4 * time.Hour)
	}
	id, at := uuid.New(), at.Truncate(time.Microsecond)
	_, err = superA.Exec(ctx, `insert into fleet.inspections (id, trip_id, vehicle_id, kind, checklist_version_id, odometer_km,
		fuel_level, answers, state, submitted_by, submitted_at, attempt) values ($1, $2, $3, $4, $5, 84530, 'three_quarters', $6,
		'submitted', $7, $8, $9)`, id, trip, inspVehicle(t), kind, checklistOf(t, kind), answers, person("a.driver-msk1"), at, attempt)
	require.NoError(t, err)
	for i, d := range defects {
		state := "open"
		if kind == inspDeparture && d.severity == "blocking" {
			state = "in_review"
		}
		_, err := superA.Exec(ctx, `insert into fleet.defects (vehicle_id, inspection_id, trip_id, zone, severity, description, state,
			reported_by, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, inspVehicle(t), id, trip, d.zone, d.severity,
			d.description, state, person("a.driver-msk1"), at.Add(time.Duration(i)*time.Microsecond))
		require.NoError(t, err)
	}
	return id, at
}

// deliverInspection hands the consumer a fleet.inspection.submitted.v1 of tenant A, as the worker does.
func deliverInspection(t *testing.T, c InspectionResponses, event, inspection, trip uuid.UUID, kind string, blocking bool) {
	t.Helper()
	b, err := json.Marshal(map[string]any{"inspectionId": inspection, "tripId": trip, "vehicleId": inspVehicle(t), "kind": kind,
		"blocking": blocking})
	require.NoError(t, err)
	require.NoError(t, c.Handle(t.Context(), events.Message{TenantID: ref("tenant:a"), EventID: event, Type: EventInspectionSubmitted,
		Payload: b}))
}

// inspResponse is a response of the form as stored.
type inspResponse struct {
	id                     uuid.UUID
	number, version        int
	channel, review, label string
	dedup                  *string
	author, subject        *uuid.UUID
	module, typ            *string
	at                     time.Time
	answers                []entry
}

// responsesOf are the responses of form of the channel inspection, by number.
func responsesOf(t *testing.T, form uuid.UUID) []inspResponse {
	t.Helper()
	rows, err := superA.Query(t.Context(), `select id, number, version_number, channel, review_status, coalesce(subject_label, ''),
		dedup_key, author_id, subject_id, subject_module, subject_type, submitted_at, answers from forms.responses
		where form_id = $1 and channel = 'inspection' order by number`, form)
	require.NoError(t, err)
	defer rows.Close()
	var out []inspResponse
	for rows.Next() {
		var (
			x   inspResponse
			raw []byte
		)
		require.NoError(t, rows.Scan(&x.id, &x.number, &x.version, &x.channel, &x.review, &x.label, &x.dedup, &x.author, &x.subject,
			&x.module, &x.typ, &x.at, &raw))
		require.NoError(t, json.Unmarshal(raw, &x.answers))
		out = append(out, x)
	}
	require.NoError(t, rows.Err())
	return out
}

// taskOf is the task the fake of the tasks got for the response id (nil — none).
func taskOf(id uuid.UUID) *FormTask {
	tasks.mu.Lock()
	defer tasks.mu.Unlock()
	for i := range tasks.created {
		if tasks.created[i].Response == id {
			x := tasks.created[i]
			return &x
		}
	}
	return nil
}

// inspForm is «Осмотр машины» of tenant A — v3 of the seed (module «Логистика») with the rules «задача» «Проверить
// осмотр» and «в БЗ» (a row of «Осмотры»).
func inspForm(t *testing.T) (fapi.Form, fapi.FormRule, fapi.FormRule) {
	t.Helper()
	ctx, owner, s := t.Context(), as(t, "a.owner"), service()
	f := published(t, "a.owner", "Осмотр машины", demoVersions()[2].def)
	_, err := superA.Exec(ctx, `update forms.forms set module_key = 'fleet' where id = $1`, f.Id)
	require.NoError(t, err)
	project := uuid.New()
	tasks.mu.Lock()
	if tasks.may == nil {
		tasks.may = map[uuid.UUID]bool{}
	}
	tasks.may[project] = true
	tasks.mu.Unlock()
	node, table, col := uuid.New(), uuid.New(), uuid.New()
	kb.mu.Lock()
	if kb.nodes == nil {
		kb.nodes, kb.hidden = map[uuid.UUID]KBNode{}, map[uuid.UUID]bool{}
	}
	kb.nodes[node] = KBNode{ID: node, Title: "Журнал осмотров машин", Tables: []KBTable{{ID: table, Title: "Осмотры", Columns: []uuid.UUID{col}}}}
	kb.mu.Unlock()
	task := must(s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindTask, Trigger: fapi.FormRuleTriggerAccepted,
		Task: &fapi.FormRuleTask{ProjectId: project, Title: "Проверить осмотр", AssigneeMemberId: person("a.manager-msk1")}})).of(t)
	kbRule := must(s.CreateRule(ctx, owner, f.Id, fapi.FormRuleCreate{Kind: fapi.FormRuleKindKb, Trigger: fapi.FormRuleTriggerAccepted,
		Kb: &fapi.FormRuleKbInput{NodeId: node, Mode: fapi.FormRuleKbInputModeTable, TableId: new(table), Position: fapi.FormRuleKbInputPositionTop,
			Fields: []fapi.FormRuleKbField{{ColumnId: new(col), Name: "Рейс", Source: "$object"}}}})).of(t)
	return f, task, kbRule
}

// The inspection of a trip is a response of «Осмотр машины» (D-30): the channel inspection, the acting version (v1 of the
// form of the test), the
// driver, the trip («Рейс … · выезд»), «Принят», the moment of the inspection and the answers of recordInspection; its
// rules run — the task «Проверить осмотр Р-… (выезд)» (urgent with a blocking defect, the checklist and the trip of the
// reference) and the row of «Осмотры» — and the task goes to the port of the blocking defect. One response per
// trip:kind:rev (Q-59): a repeated delivery, a second departure and a third return write nothing.
//
//nolint:paralleltest // «Осмотр машины» is the one form of its name in tenant A; the fakes of the ports are shared
func TestInspectionResponse(t *testing.T) {
	ctx, owner := t.Context(), as(t, "a.owner")
	f, taskRule, kbRule := inspForm(t)
	defects := &fakeDefects{calls: map[uuid.UUID][]*uuid.UUID{}}
	c := InspectionResponses{Service: service(), Defects: defects}
	trip := inspTrip(t, "Р-4241")

	dep, at := inspRow(t, trip, inspDeparture, 1, nil, inspDefectRow{"Шины", "blocking", "Порез боковины"})
	event := uuid.New()
	deliverInspection(t, c, event, dep, trip, inspDeparture, true)
	rows := responsesOf(t, f.Id)
	require.Len(t, rows, 1)
	x := rows[0]
	assert.Equal(t, []any{channelInspection, reviewAccepted, 1, "Рейс Р-4241 · выезд", trip.String() + ":dep:rev1"},
		[]any{x.channel, x.review, x.version, x.label, deref(x.dedup)})
	assert.Equal(t, []any{person("a.driver-msk1"), trip, "fleet", "trip"}, []any{deref(x.author), deref(x.subject), deref(x.module), deref(x.typ)})
	assert.True(t, x.at.Equal(at), "the moment of the inspection: %v, want %v", x.at, at)
	assert.Equal(t, []got{
		{"q-photos", vText, "5 фото"}, {"q-odo", vDecimal, "84530"}, {"q-fuel", vChoices, []string{"o3"}},
		{"q-checks", vChoices, []string{"o1", "o2", "o3"}}, {"q-defect", vBoolean, true},
		{"q-defect-text", vText, "Шины: Порез боковины"}, {"q-critical", vBoolean, true},
	}, flatten(x.answers))
	resp := must(service().Response(ctx, owner, f.Id, x.id)).of(t)
	byRule := map[uuid.UUID]fapi.FormResponseAction{}
	for _, a := range resp.Actions {
		byRule[a.RuleId] = a
	}
	require.True(t, byRule[taskRule.Id].Ok, "the task of the rule")
	assert.Regexp(t, `^Задача LOG-\d+ «Проверить осмотр Р-4241 \(выезд\)» · Исполнитель · К выполнению$`, *byRule[taskRule.Id].Text)
	assert.True(t, byRule[kbRule.Id].Ok, "the row of «Осмотры»")
	task := taskOf(x.id)
	require.NotNil(t, task)
	assert.Equal(t, []any{"Проверить осмотр Р-4241 (выезд)", "urgent", []string{"Сверить фото с прошлым осмотром", "Проверить пробег"},
		[]fapi.ObjectRef{{ModuleKey: "fleet", EntityType: "trip", EntityId: trip}}},
		[]any{task.Title, task.Priority, task.Checklist, task.Related})
	calls := defects.of(dep)
	require.Len(t, calls, 1, "the blocking defect goes to the port of the tasks")
	require.NotNil(t, calls[0])
	assert.Equal(t, byRule[taskRule.Id].TaskId, calls[0], "with the task of the response")
	assert.Equal(t, 1, count(t, `select count(*) from outbox.events where type = 'forms.response.submitted.v1' and aggregate_id = $1`, x.id))

	deliverInspection(t, c, event, dep, trip, inspDeparture, true) // the same delivery again
	deliverInspection(t, c, uuid.New(), dep, trip, inspDeparture, true)
	again, _ := inspRow(t, trip, inspDeparture, 2, nil) // a departure again after «Подтвердить неисправность»
	deliverInspection(t, c, uuid.New(), again, trip, inspDeparture, false)
	assert.Len(t, responsesOf(t, f.Id), 1, "one response of the departure of the trip")
	assert.Empty(t, defects.of(again), "a departure without a blocking defect has no task of a defect")

	ret, _ := inspRow(t, trip, inspReturn, 1, nil)
	deliverInspection(t, c, uuid.New(), ret, trip, inspReturn, false)
	rework, _ := inspRow(t, trip, inspReturn, 2, nil)
	deliverInspection(t, c, uuid.New(), rework, trip, inspReturn, false)
	third, _ := inspRow(t, trip, inspReturn, 3, nil)
	deliverInspection(t, c, uuid.New(), third, trip, inspReturn, false)
	rows = responsesOf(t, f.Id)
	require.Len(t, rows, 3, "the departure, the return and the return after the rework")
	assert.Equal(t, []string{trip.String() + ":ret:rev1", trip.String() + ":ret:rev2"}, []string{deref(rows[1].dedup), deref(rows[2].dedup)})
	assert.Equal(t, "Рейс Р-4241 · сдача", rows[1].label)
	back := taskOf(rows[1].id)
	require.NotNil(t, back)
	assert.Equal(t, []any{"Проверить осмотр Р-4241 (сдача)", ""}, []any{back.Title, back.Priority}, "a return without a blocking defect")
}

// No response where the reference writes none (api.js:66): no form «Осмотр машины», the form closed or its module
// off; an unknown inspection is consumed without a response.
//
//nolint:paralleltest // changes «Осмотр машины» of tenant A
func TestInspectionWithoutForm(t *testing.T) {
	ctx := t.Context()
	f := formNamed(t, "Осмотр машины")
	c := InspectionResponses{Service: service(), Defects: &fakeDefects{calls: map[uuid.UUID][]*uuid.UUID{}}}
	for i, change := range []struct {
		what, set, undo string
	}{
		{"closed", `update forms.forms set status = 'closed' where id = $1`, `update forms.forms set status = 'published' where id = $1`},
		{"module off", `update forms.forms set module_key = 'repairs' where id = $1`, `update forms.forms set module_key = 'fleet' where id = $1`},
		{"no form", `update forms.forms set name = 'Осмотр машины · архив' where id = $1`, `update forms.forms set name = 'Осмотр машины' where id = $1`},
	} {
		_, err := superA.Exec(ctx, change.set, f)
		require.NoError(t, err)
		trip := inspTrip(t, "Р-425"+string(rune('1'+i)))
		dep, _ := inspRow(t, trip, inspDeparture, 1, nil)
		deliverInspection(t, c, uuid.New(), dep, trip, inspDeparture, false)
		_, err = superA.Exec(ctx, change.undo, f)
		require.NoError(t, err)
		assert.Zero(t, count(t, `select count(*) from forms.responses where dedup_key = $1`, trip.String()+":dep:rev1"), change.what)
	}
	deliverInspection(t, c, uuid.New(), uuid.New(), uuid.New(), inspDeparture, false)
}

// formNamed is the id of the form name of tenant A, made as «Осмотр машины» of the tests when missing.
func formNamed(t *testing.T, name string) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	err := superA.QueryRow(t.Context(), `select id from forms.forms where name = $1`, name).Scan(&id)
	if err == nil {
		return id
	}
	f, _, _ := inspForm(t)
	return f.Id
}
