package forms

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W4.24 (D-30 комплекта, ответ владельца 17.10): the inspection of a trip is written as a response of «Осмотр машины»
// like recordInspection of the reference (design/ortus/api.js:64–77) — the consumer of fleet.inspection.submitted.v1
// in cmd/worker; the rules of the form run in the transaction of the response.

// The event of the inspections the module consumes and its consumer of outbox.inbox.
const (
	EventInspectionSubmitted = "fleet.inspection.submitted.v1"
	ConsumerInspections      = "forms.inspection_responses"
)

// Kinds of an inspection (fleet.inspections.kind).
const (
	inspDeparture = "departure"
	inspReturn    = "return"
)

// DefectTasks is the port of the module of tasks for the blocking defect of an inspection (W4.24, D-29): the check of
// the defect is the task of the response of the inspection when its rule made one (task), else a task of its own.
type DefectTasks interface {
	InspectionDefects(ctx context.Context, tx pgx.Tx, tenant, inspection uuid.UUID, task *uuid.UUID) error
}

// InspectionResponses writes the inspections of the trips as responses of «Осмотр машины» (cmd/worker).
type InspectionResponses struct {
	Service *Service
	Defects DefectTasks // nil: a blocking defect gets no task here
}

// Register adds the handler to reg (cmd/worker).
func (c InspectionResponses) Register(reg *events.Registry) {
	reg.Handle(EventInspectionSubmitted, c.Handle)
}

// inspectionEvent is the payload of fleet.inspection.submitted.v1 (fleet/inspections).
type inspectionEvent struct {
	Inspection uuid.UUID `json:"inspectionId"`
	Blocking   bool      `json:"blocking"`
}

// Handle consumes one fleet.inspection.submitted.v1 in one transaction of the tenant DB of the message: the response of
// the inspection with its rules, then the task of its blocking defect (Defects). A repeated delivery changes nothing.
func (c InspectionResponses) Handle(ctx context.Context, m events.Message) error {
	var p inspectionEvent
	if err := json.Unmarshal(m.Payload, &p); err != nil {
		return fmt.Errorf("%s payload: %w", m.Type, err)
	}
	pool, err := c.Service.Pools.For(ctx, m.TenantID)
	if err != nil {
		return err
	}
	return pgx.BeginFunc(ctx, pool, func(tx pgx.Tx) error {
		first, err := events.Once(ctx, tx, ConsumerInspections, m.EventID)
		if err != nil || !first {
			return err
		}
		task, err := c.Service.RecordInspection(ctx, tx, m.TenantID, p.Inspection)
		if err != nil || !p.Blocking || c.Defects == nil {
			return err
		}
		return c.Defects.InspectionDefects(ctx, tx, m.TenantID, p.Inspection, task)
	})
}

// RecordInspection writes the inspection id as a response of «Осмотр машины» in tx (recordInspection, api.js:65–77)
// and returns the task its rule «задача» made (nil — none). The form is the form of the organization of that name (the
// name is unique) while it accepts responses; none — nothing is written, as the reference does without its form. A
// response of the same trip:kind:rev (Q-59) is not written again: its task is returned. The response is the driver's,
// about the trip, accepted, of the moment of the inspection; its rules run as for a response of an employee.
func (s *Service) RecordInspection(ctx context.Context, tx pgx.Tx, tenant, id uuid.UUID) (*uuid.UUID, error) {
	r := &req{s: s, tc: tenantctx.TenantContext{TenantID: tenant}, tx: tx, now: s.now()}
	in, f, err := r.inspectionTarget(ctx, id)
	if err != nil || f == nil {
		return nil, err
	}
	key := inspectionKey(in.trip, in.kind, in.attempt)
	have, err := r.responsesWhere(ctx, `x.form_id = $1 and x.dedup_key = $2`, f.id, key)
	switch {
	case err != nil:
		return nil, err
	case len(have) > 0:
		return journalTask(have[0]), nil
	}
	v, err := r.version(ctx, f.id, *f.current)
	if err != nil || v == nil {
		return nil, err
	}
	x := &responseRow{id: uuid.New(), form: f.id, version: *f.current, channel: channelInspection, author: &in.author,
		subject: &fapi.FormResponseSubject{Ref: fapi.ObjectRef{ModuleKey: moduleFleet, EntityType: entityTrip, EntityId: in.trip},
			Label: inspectionLabel(in.number, in.kind)},
		answers: inspectionAnswers(v.def, *in), linkKeys: []string{}, review: reviewAccepted, revision: 1, submittedAt: in.at}
	if f.set.extra.Scoring {
		sc := scoreOf(v.def, answersOf(x.answers), f.set.extra.PassScore)
		x.score = &sc
	}
	if err := r.writeInspection(ctx, f, x, key); err != nil {
		return nil, err
	}
	return journalTask(x), nil
}

// inspectionTarget is the inspection id and «Осмотр машины» that takes its response now (f nil — no inspection, no
// form, or the form does not accept responses).
func (r *req) inspectionTarget(ctx context.Context, id uuid.UUID) (*inspected, *formRow, error) {
	in, err := r.inspected(ctx, id)
	if err != nil || in == nil {
		return nil, nil, err
	}
	f, err := r.inspectionForm(ctx)
	if err != nil || f == nil || f.current == nil {
		return nil, nil, err
	}
	if closed, err := r.closedReason(ctx, f); err != nil || closed {
		return nil, nil, err
	}
	return in, f, nil
}

// writeInspection writes the response x of an inspection with its key, its events, its rules and their notices.
func (r *req) writeInspection(ctx context.Context, f *formRow, x *responseRow, key string) error {
	if err := r.insertResponse(ctx, f, x, key); err != nil {
		return err
	}
	if err := r.responded(ctx, f, x); err != nil {
		return err
	}
	if err := r.runRules(ctx, f, x); err != nil {
		return err
	}
	return r.flushNotices(ctx)
}

// journalTask is the task the rule «задача» made for x (nil — none).
func journalTask(x *responseRow) *uuid.UUID {
	for _, a := range x.actions {
		if a.kind == kindTask && a.ok && a.task != nil {
			return a.task
		}
	}
	return nil
}

// entityTrip is the entity of a trip of «Логистика» (the object of the response of an inspection).
const entityTrip = "trip"

// textInspectionForm is the name of the form of the inspections (mock-data.js fm-insp).
const textInspectionForm = "Осмотр машины"

// inspectionForm is «Осмотр машины» of the organization taken for the transaction (nil — none): the row of the form
// serializes the responses as a submission does.
func (r *req) inspectionForm(ctx context.Context) (*formRow, error) {
	var id uuid.UUID
	err := r.tx.QueryRow(ctx, `select id from forms.forms where lower(btrim(name)) = lower($1)`, textInspectionForm).Scan(&id)
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("inspection form", err)
	}
	return r.form(ctx, id, true)
}

// inspectedSQL reads an inspection (fleet/inspections, tenant 0002, 0011) with the number of its trip and the items
// of its version of the checklist.
const inspectedSQL = `
select i.trip_id, t.number, i.kind, i.attempt, i.submitted_by, i.submitted_at, i.odometer_km::float8, i.fuel_level, i.answers,
       coalesce(c.items, '[]'::jsonb)
  from fleet.inspections i join fleet.trips t on t.id = i.trip_id
  left join fleet.checklist_versions c on c.id = i.checklist_version_id
 where i.id = $1`

// inspectedAnswers is what the response takes of fleet.inspections.answers.
type inspectedAnswers struct {
	Checks []struct {
		Key    string `json:"key"`
		Result string `json:"result"`
	} `json:"checks"`
	Photos []struct {
		Role string `json:"role"`
	} `json:"photos"`
}

// checklistItem is an item of fleet.checklist_versions.items: its key and label.
type checklistItem struct {
	Key   string `json:"key"`
	Label string `json:"label"`
}

// rolePhotoDamage is the role of a photo of a damage: not one of the photos of the inspection («5 фото»).
const rolePhotoDamage = "damage"

// inspected reads the inspection id with its checks and defects (nil — none).
func (r *req) inspected(ctx context.Context, id uuid.UUID) (*inspected, error) {
	in := inspected{id: id}
	var (
		odometer      float64
		raw, rawItems []byte
	)
	err := r.tx.QueryRow(ctx, inspectedSQL, id).Scan(&in.trip, &in.number, &in.kind, &in.attempt, &in.author, &in.at, &odometer,
		&in.fuel, &raw, &rawItems)
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("inspection", err)
	}
	in.odometer = strconv.FormatFloat(odometer, 'f', -1, 64)
	var (
		a     inspectedAnswers
		items []checklistItem
	)
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil, store("inspection answers", err)
	}
	if err := json.Unmarshal(rawItems, &items); err != nil {
		return nil, store("checklist items", err)
	}
	for _, p := range a.Photos {
		if p.Role != rolePhotoDamage {
			in.photos++
		}
	}
	for _, c := range a.Checks {
		label := c.Key
		if i := slices.IndexFunc(items, func(it checklistItem) bool { return it.Key == c.Key }); i >= 0 {
			label = items[i].Label
		}
		in.checks = append(in.checks, inspCheck{key: c.Key, label: label, result: c.Result})
	}
	in.defects, err = r.inspectedDefects(ctx, id)
	return &in, err
}

// inspectedDefects are the defects of the inspection id in the order of the report.
func (r *req) inspectedDefects(ctx context.Context, id uuid.UUID) ([]inspDefect, error) {
	rows, err := r.tx.Query(ctx, `select zone, description, severity = 'blocking' from fleet.defects where inspection_id = $1
		order by created_at, id`, id)
	if err != nil {
		return nil, store("inspection defects", err)
	}
	out, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (inspDefect, error) {
		var d inspDefect
		return d, row.Scan(&d.zone, &d.description, &d.blocking)
	})
	return out, store("inspection defects", err)
}

// inspectionChecklist is the checklist of the task of the response of an inspection (api.js:76).
var inspectionChecklist = []string{"Сверить фото с прошлым осмотром", "Проверить пробег"}

// priorityUrgent is the priority «Срочно» of a task.
const priorityUrgent = "urgent"

// inspectionTask makes t the task of the response x of an inspection like recordInspection (api.js:76): «{правило}
// Р-208 (выезд)», urgent with a critical defect, the checklist of the reference, the trip among the related objects. The
// inspection is the one of the trip and the kind of the response (its key) at its moment (the response keeps the moment
// of the inspection), so «Повторить» builds the same task; none (the trip is gone) — t stays the task of the rule.
func (r *req) inspectionTask(ctx context.Context, x *responseRow, t *FormTask) error {
	if x.subject == nil || x.subject.Ref.ModuleKey != moduleFleet || x.subject.Ref.EntityType != entityTrip {
		return nil
	}
	var (
		number, kind string
		critical     bool
	)
	err := r.tx.QueryRow(ctx, `select t.number, i.kind, exists (select 1 from fleet.defects d where d.inspection_id = i.id
		and d.severity = 'blocking') from forms.responses x join fleet.inspections i on i.trip_id = $2 and i.submitted_at = $3
		and split_part(x.dedup_key, ':', 2) = case i.kind when 'return' then 'ret' else 'dep' end
		join fleet.trips t on t.id = i.trip_id where x.id = $1 order by i.attempt desc limit 1`, x.id, x.subject.Ref.EntityId,
		x.submittedAt).Scan(&number, &kind, &critical)
	switch {
	case noRows(err):
		return nil
	case err != nil:
		return store("inspection of the task", err)
	}
	t.Title = inspectionTitle(t.Title, number, kind)
	if critical {
		t.Priority = priorityUrgent
	}
	t.Checklist = slices.Clone(inspectionChecklist)
	t.Related = []fapi.ObjectRef{x.subject.Ref}
	return nil
}

// inspected is what an inspection gives its response.
type inspected struct {
	id, trip, author uuid.UUID
	number           string // «Р-208»
	kind             string // departure | return
	attempt          int
	at               time.Time
	odometer         string // «84530»
	fuel             string // quarter | half | three_quarters | full
	photos           int
	checks           []inspCheck
	defects          []inspDefect
}

// inspCheck is an item of the checklist of an inspection: its key, its label in the version and the result.
type inspCheck struct{ key, label, result string }

// inspDefect is a defect of an inspection.
type inspDefect struct {
	zone, description string
	blocking          bool
}

// inspectionKey is the key of deduplication «trip:kind:rev» of the response of an inspection (Q-59, «как в
// прототипе», api.js:67): a departure is always rev1 — a departure again after «Подтвердить неисправность» writes no
// second response; the first return is rev1, every return after the rework rev2.
func inspectionKey(trip uuid.UUID, kind string, attempt int) string {
	short, rev := "dep", "rev1"
	if kind == inspReturn {
		short = "ret"
		if attempt > 1 {
			rev = "rev2"
		}
	}
	return trip.String() + ":" + short + ":" + rev
}

// kindWord is the word of a kind of an inspection in its object and in the title of its task.
func kindWord(kind string) string {
	if kind == inspReturn {
		return "сдача"
	}
	return "выезд"
}

// inspectionLabel is the object of the response: «Рейс Р-208 · выезд» / «· сдача» (api.js:73).
func inspectionLabel(number, kind string) string {
	return "Рейс " + number + " · " + kindWord(kind)
}

// inspectionTitle is the title of the task of the response: the title of the rule and «Р-208 (выезд)» (api.js:76).
func inspectionTitle(title, number, kind string) string {
	return strings.TrimSpace(title) + " " + number + " (" + kindWord(kind) + ")"
}

// The questions of «Осмотр машины» of the reference the inspection answers (values of recordInspection, api.js:71).
const (
	qPhotos     = "q-photos"
	qOdometer   = "q-odo"
	qFuel       = "q-fuel"
	qFuelText   = "q-fuel-t"
	qChecks     = "q-checks"
	qDefect     = "q-defect"
	qDefectText = "q-defect-text"
	qCritical   = "q-critical"
)

// fuelLabels are the labels of fleet.inspections.fuel_level (FUEL of the prototype).
var fuelLabels = map[string]string{"quarter": "¼", "half": "½", "three_quarters": "¾", "full": "Полный"}

// Results of an item of the checklist (InspectionCheck.result).
const checkFail = "fail"

// inspectionAnswers are the answers of the inspection to the questions of d, in their order: the questions of
// «Осмотр машины» of the reference by their keys and the items of the checklist by theirs (a form of the definition of
// the checklist, W2.45). A question the inspection knows nothing of and a question its condition hides stay empty.
func inspectionAnswers(d def, in inspected) []entry {
	vals := answers{}
	out := []entry{}
	for _, q := range d.Fields {
		if q.Type == fapi.FormQuestionTypeStatement || deref(q.Hidden) {
			continue
		}
		v, ok := inspectionValue(q, in)
		if !ok || !shown(q, vals) {
			continue
		}
		vals[q.Key] = v
		out = append(out, entry{FieldKey: q.Key, Value: v})
	}
	return out
}

// inspectionValue is the answer of the inspection to q (false — none).
func inspectionValue(q question, in inspected) (value, bool) {
	var first *inspDefect
	if len(in.defects) > 0 {
		first = &in.defects[0]
	}
	switch q.Key {
	case qPhotos:
		return typedValue(q, strconv.Itoa(in.photos)+" фото", in.photos > 0)
	case qOdometer:
		return typedValue(q, in.odometer, in.odometer != "")
	case qFuel, qFuelText:
		label, ok := fuelLabels[in.fuel]
		return typedValue(q, label, ok)
	case qChecks:
		return checksValue(q, in.checks)
	case qDefect, qDefectText, qCritical:
		return defectValue(q, first)
	}
	for _, c := range in.checks {
		if c.key == q.Key && optionType(q.Type) && hasOption(q, c.result) {
			return jsonValue(vChoices, []string{c.result}), true
		}
	}
	return value{}, false
}

// defectValue is the answer to a question of the defects of «Осмотр машины» (api.js:71): «Есть дефекты?», the text
// «зона: описание» and the criticality of the first defect (none — the last two stay empty).
func defectValue(q question, first *inspDefect) (value, bool) {
	switch {
	case q.Key == qDefect:
		return flagValue(q, first != nil), true
	case first == nil:
		return value{}, false
	case q.Key == qDefectText:
		return typedValue(q, first.zone+": "+first.description, true)
	}
	return flagValue(q, first.blocking), true
}

// typedValue is text as an answer to q (false when ok is false or q cannot take it): the option of an option question
// whose label it is, a number of a number question, a text otherwise.
func typedValue(q question, text string, ok bool) (value, bool) {
	switch {
	case !ok:
		return value{}, false
	case optionType(q.Type):
		for _, o := range options(q) {
			if strings.EqualFold(strings.TrimSpace(o.Label), strings.TrimSpace(text)) {
				return jsonValue(vChoices, []string{o.Key}), true
			}
		}
		return value{}, false
	case numberType(q.Type):
		if _, err := strconv.ParseFloat(text, 64); err != nil {
			return value{}, false
		}
		return jsonValue(vDecimal, text), true
	}
	return textValue(text), true
}

// flagValue is «да / нет» as an answer to q: a boolean of a question «Да / нет», a text otherwise.
func flagValue(q question, b bool) value {
	if q.Type == fapi.FormQuestionTypeBool {
		return jsonValue(vBoolean, b)
	}
	if b {
		return textValue("да")
	}
	return textValue("нет")
}

// checksValue is the checklist as an answer to q: the options of an option question but those whose label is in the
// label of a failed item, «все пункты» (api.js:71) as a text — or the failed items.
func checksValue(q question, checks []inspCheck) (value, bool) {
	var failed []string
	for _, c := range checks {
		if c.result == checkFail {
			failed = append(failed, c.label)
		}
	}
	if !optionType(q.Type) {
		if len(failed) == 0 {
			return textValue("все пункты"), true
		}
		return textValue("все пункты, кроме: " + strings.Join(failed, ", ")), true
	}
	keys := []string{}
	for _, o := range options(q) {
		if !slices.ContainsFunc(failed, func(l string) bool {
			return strings.Contains(strings.ToLower(l), strings.ToLower(strings.TrimSpace(o.Label)))
		}) {
			keys = append(keys, o.Key)
		}
	}
	if len(keys) == 0 || (q.Type != fapi.FormQuestionTypeMulti && len(keys) > 1) {
		return value{}, false
	}
	return jsonValue(vChoices, keys), true
}

func hasOption(q question, key string) bool {
	return slices.ContainsFunc(options(q), func(o fapi.FormOption) bool { return o.Key == key })
}

// jsonValue is a value of typ with v as its JSON (a string, a bool or a list of keys always encodes).
func jsonValue(typ string, v any) value {
	b, _ := json.Marshal(v)
	return value{Type: typ, Value: b}
}
