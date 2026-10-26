// Package forms is the provider of the dataset of the module of forms for «Данные» (W4.80; the FollowUp П-1 of the
// critique of the exit of stage 4): «Ответы на осмотр» of the prototype (dataVM :4189 of design-2026-10-19,
// SETS.responses) — the columns «Ответ», «Объект», «Автор», «Версия формы», «Топливо» (q-fuel or q-fuel-t); the row
// opens the response in the editor of its form, so its record id is «{formId}:{responseId}». The rows are the responses
// of the form of the inspections «Осмотр машины» (by its name, as RecordInspection of W4.24) the member reads as
// listFormResponses shows them (Q-W4.00-forms-9): forms.responses.read in the area of the form — every response (a
// form of the whole organization — a grant of the organization); with the key anywhere — his own responses and those
// about a trip or a vehicle he sees (the objects of the port of the module: fleet.trips.read with the trips the driver
// pool closes to him left out, AC-06; fleet.vehicles.read), and, as the stub of the prototype, those about a trip that
// is gone with fleet.trips.read anywhere (Q-W4.21-17). A response about a task is seen only in the area of the form
// (fail-closed: the hider of the tasks is a read of its module). The module of forms is a module of the core: its
// dataset exists in every tenant.
package forms

import (
	"github.com/ortus/ortus-crm/backend/internal/modules/data" //nolint:depguard // the registry this provider plugs into
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// ModuleKey is the key of the module of forms (a module of the core, modulesreg.CoreKeys).
const ModuleKey = "forms"

// Responses is the dataset of the module (Dataset.id).
const Responses = "forms.responses"

// permRead is the own read permission of the dataset.
const permRead = "forms.responses.read"

// Provider registers the dataset of the responses of the inspection.
type Provider struct{}

var (
	_ data.Provider = Provider{}
	_ data.Core     = Provider{}
)

// Module implements data.Provider.
func (Provider) Module() string { return ModuleKey }

// Core implements data.Core: the module of forms is never installed.
func (Provider) Core() bool { return true }

// Datasets implements data.Provider: «Ответы на осмотр».
func (Provider) Datasets() []data.Spec { return []data.Spec{responses()} }

// Scope columns: a response by the area of its form, its author (scope self) and the driver of the trip it is about
// (scope relation); a trip — as the port of the objects of the module reads it (the unit of the trip, its driver); a
// vehicle — by its unit.
var (
	responseColumns = authz.Columns{Unit: "f.org_unit_id", Persons: []string{"x.author_id"}, Related: []string{"t.driver_person_id"}}
	tripColumns     = authz.Columns{Unit: "t.unit_id", Persons: []string{"t.driver_person_id"}}
	vehicleColumns  = authz.Columns{Unit: "v.unit_id"}
)

// inspectionForm keeps the responses of the form of the inspections «Осмотр машины» (textInspectionForm of the module
// of forms: the name of a form is unique in the organization).
const inspectionForm = `lower(btrim(f.name)) = lower('Осмотр машины')`

// numberSQL is «R-NNNN» of a response (numberOf of the module of forms: four digits at least).
const numberSQL = `'R-' || case when x.number < 10000 then lpad(x.number::text, 4, '0') else x.number::text end`

// fuelSQL is «Топливо» of the prototype (r.values['q-fuel'] || r.values['q-fuel-t']): the label of the option of the
// choice q-fuel in the version of the response (the answer keeps the key of the option, Q-W4.00-forms-3), else the text
// of q-fuel or of q-fuel-t (the text question of v1 and v2 of «Осмотр машины»).
const fuelSQL = `coalesce(
  (select o->>'label' from jsonb_array_elements(x.answers) e
     join forms.versions fv on fv.form_id = x.form_id and fv.number = x.version_number
     cross join lateral jsonb_array_elements(fv.definition->'fields') q
     cross join lateral jsonb_array_elements(case when jsonb_typeof(q->'options') = 'array' then q->'options' else '[]'::jsonb end) o
    where e->>'fieldKey' = 'q-fuel' and e->'value'->>'type' = 'choices' and q->>'key' = 'q-fuel'
      and o->>'key' = e->'value'->'value'->>0 limit 1),
  (select nullif(e->'value'->>'value', '') from jsonb_array_elements(x.answers) e
    where e->>'fieldKey' = 'q-fuel' and e->'value'->>'type' = 'text' limit 1),
  (select nullif(e->'value'->>'value', '') from jsonb_array_elements(x.answers) e
    where e->>'fieldKey' = 'q-fuel-t' and e->'value'->>'type' = 'text' limit 1))`

// tripSubject is a response about a trip of «Логистика» (FormResponseSubject).
const tripSubject = `x.subject_module = 'fleet' and x.subject_type = 'trip'`

func responses() data.Spec {
	return data.Spec{
		ID: Responses, Name: "Ответы на осмотр", Permission: permRead, EntityType: "form_response",
		From: `forms.responses x
  join forms.forms f on f.id = x.form_id
  left join people.person_profiles a on a.id = x.author_id
  left join fleet.trips t on ` + tripSubject + ` and t.id = x.subject_id
  left join fleet.vehicles v on x.subject_module = 'fleet' and x.subject_type = 'vehicle' and v.id = x.subject_id`,
		Where:   inspectionForm,
		Columns: responseColumns, RecordID: "f.id::text || ':' || x.id::text", Order: []string{"x.number", "x.id"},
		Fields: []data.Field{
			{Key: "response", Label: "Ответ", Type: data.Text, SQL: numberSQL},
			{Key: "object", Label: "Объект", Type: data.Text, Nullable: true, SQL: "x.subject_label"},
			{Key: "author", Label: "Автор", Type: data.Text, Nullable: true, SQL: "a.full_name"},
			{Key: "version", Label: "Версия формы", Type: data.Text, SQL: "'v' || x.version_number"},
			{Key: "fuel", Label: "Топливо", Type: data.Text, Nullable: true, SQL: fuelSQL},
		},
		DefaultSort: []data.Sort{{Field: "response"}},
		Reaches: []data.Reach{
			// His own responses, with the key anywhere (the dataset is open only so).
			{When: "x.author_id = " + data.PersonParam, Permission: permRead, Columns: responseColumns, Anywhere: true},
			// A trip he sees, not closed to him by the driver pool.
			{When: "t.id is not null and t.id <> all(" + data.HiddenParam + ")", Permission: "fleet.trips.read", Columns: tripColumns},
			// A trip that is gone (no row in the tenant) — with fleet.trips.read anywhere.
			{When: tripSubject + " and x.subject_id is not null and t.id is null", Permission: "fleet.trips.read", Columns: tripColumns, Anywhere: true},
			// A vehicle he sees.
			{When: "v.id is not null", Permission: "fleet.vehicles.read", Columns: vehicleColumns},
		},
	}
}
