//go:build integration

package inspections_test

import (
	"database/sql"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/inspections" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: clock of the suites
)

// D-30 комплекта (W2.45): the checklist version is read and the inspection checked by its definition in the
// FormDefinition format; a version written without a definition (the trigger of tenant 0017) is read by the same rule,
// a version whose definition is not a checklist form — by its items. The versions are published in tenant B: the
// current version of a kind is shared by every trip of a tenant, the other tests of the package work in A.
//
//nolint:paralleltest // the subtests publish versions one after another: each is the current version of the next
func TestChecklistVersions(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	f := versions{e: e, d: db(t, "b"), owner: e.tc(t, "b.owner", "b"), driver: ref("person:b.driver-msk1@b")}
	f.vehicle = seedTrip(t, "b", "msk1", f.driver).Vehicle
	t.Run("встроенная версия пишется с определением по правилу 0017", f.builtin)
	t.Run("версия без definition — по триггеру 0017", f.legacy)
	t.Run("блокирующий ответ — дефект пункта в очереди", f.blocking)
	t.Run("определение — источник версии", f.bySource)
	t.Run("определение не форма чек-листа — по items, без definition", f.byItems)
	t.Run("определения тенантов сверены с FormDefinition", f.allForms)
}

// versions is the world of TestChecklistVersions: tenant B, its owner submits for its driver.
type versions struct {
	e       env
	d       *sql.DB
	owner   tenantctx.TenantContext
	driver  uuid.UUID
	vehicle uuid.UUID
}

func (f versions) current(t *testing.T) fleetapi.InspectionChecklist {
	t.Helper()
	list, err := f.e.svc.Checklist(t.Context(), f.owner, f.vehicle, "departure")
	if err != nil {
		t.Fatalf("Checklist: %v", err)
	}
	return list
}

// body is a departure of a new trip of the driver by list with the results of the items and photos of the roles.
func (f versions) body(t *testing.T, list fleetapi.InspectionChecklist, results map[string]string, roles ...string) fleetapi.InspectionCreate {
	t.Helper()
	tr := seedTrip(t, "b", "msk1", f.driver)
	res := tr.Reservation
	b := fleetapi.InspectionCreate{ChecklistVersionId: list.VersionId, VehicleId: tr.Vehicle, ReservationId: &res,
		Kind: "departure", OdometerKm: "48250", FuelPercent: 75, CapturedAt: harness.Now().Add(-5 * time.Minute)}
	for _, it := range list.Items {
		if r, ok := results[it.Key]; ok {
			b.Checks = append(b.Checks, fleetapi.InspectionCheck{Key: it.Key, Result: fleetapi.InspectionCheckResult(r)})
		}
	}
	for _, role := range roles {
		b.Photos = append(b.Photos, fleetapi.InspectionPhoto{Role: fleetapi.InspectionPhotoRole(role),
			FileId: photoFile(t, "b", "fleet.reservation", tr.Reservation, "ready"), CapturedAt: harness.Now().Add(-10 * time.Minute)})
	}
	return b
}

func (f versions) submit(t *testing.T, b fleetapi.InspectionCreate) fleetapi.Inspection {
	t.Helper()
	got, err := f.e.svc.Submit(t.Context(), f.owner, b)
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	return got
}

// publish writes a departure version as a writer of tenant 0002 does (definition nil — the trigger of 0017 fills it).
func (f versions) publish(t *testing.T, version int, items, roles string, definition *string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	exec(t, f.d, `insert into fleet.checklist_versions (id, kind, version, items, required_photo_roles, definition)
	              values ($1, 'departure', $2, $3::jsonb, $4::text[], $5::jsonb)`, id, version, items, roles, definition)
	return id
}

func roleList(roles ...string) []fleetapi.InspectionChecklistRequiredPhotoRoles {
	out := []fleetapi.InspectionChecklistRequiredPhotoRoles{}
	for _, r := range roles {
		out = append(out, fleetapi.InspectionChecklistRequiredPhotoRoles(r))
	}
	return out
}

// The built-in version 1 is published with the definition the Go writer builds — the same jsonb as
// fleet.checklist_definition of its items and roles; fail of an item without blockingValues does not block.
func (f versions) builtin(t *testing.T) {
	list := f.current(t)
	expect(t, "definition", list, list.Definition != nil, len(list.Items) == 3, len(list.RequiredPhotoRoles) == 5)
	def := list.Definition
	expect(t, "form", def, def.Title == "Осмотр перед выездом", len(def.Fields) == 8, def.Fields[0].Key == "body",
		def.Fields[0].Type == "single_choice", def.Fields[3].Key == "photo_front")
	ret, err := f.e.svc.Checklist(t.Context(), f.owner, f.vehicle, "return")
	expect(t, "return definition", ret, err == nil, ret.Definition != nil)
	expect(t, "return title", ret.Definition, ret.Definition.Title == "Осмотр при сдаче")
	for _, id := range []uuid.UUID{list.VersionId, ret.VersionId} {
		same := scalar[bool](t, f.d, `select definition = fleet.checklist_definition(kind, items, required_photo_roles)
		                                from fleet.checklist_versions where id = $1`, id)
		expect(t, "the Go writer = fleet.checklist_definition", id, same)
	}
	got := f.submit(t, f.body(t, list, map[string]string{"body": "pass", "tires": "fail", "docs": "not_applicable"},
		"front", "rear", "left", "right", "odometer"))
	expect(t, "fail of an item that does not block", got, got.Status == "submitted", got.Defects != nil)
	expect(t, "no defects", got.Defects, len(*got.Defects) == 0)
}

// A version written without a definition: the trigger of 0017 fills it, interior (not a role of the contract) is
// skipped, an item without required is required, failureBlocksRelease is blockingValues [fail].
func (f versions) legacy(t *testing.T) {
	id := f.publish(t, 2, `[{"key":"body","label":"Кузов и стёкла осмотрены","required":true},
	                        {"key":"tires","label":"Шины и колёса","failureBlocksRelease":true}]`, `{front,back,interior,odometer}`, nil)
	list := f.current(t)
	expect(t, "legacy version", list, list.VersionId == id, list.Definition != nil, len(list.Items) == 2,
		slices.Equal(list.RequiredPhotoRoles, roleList("front", "rear", "odometer")))
	expect(t, "items", list.Items, list.Items[1].Required, list.Items[1].FailureBlocksRelease, !list.Items[0].FailureBlocksRelease)
	expect(t, "fields", list.Definition.Fields, len(list.Definition.Fields) == 5)
	got := f.submit(t, f.body(t, list, map[string]string{"body": "pass", "tires": "pass"}, "front", "rear", "odometer"))
	expect(t, "three photos of the version", got, got.Status == "submitted")
}

// A blocking answer before departure does not release the vehicle: the inspection waits for the manager with the
// blocking defect of the item, the trip is in defect_review; a blocking defect of the zone reported by the driver
// stands for it.
func (f versions) blocking(t *testing.T) {
	list := f.current(t)
	b := f.body(t, list, map[string]string{"body": "pass", "tires": "fail"}, "front", "rear", "odometer")
	got := f.submit(t, b)
	expect(t, "a blocking answer does not release the vehicle", got, got.Status == "requires_review", got.Defects != nil)
	expect(t, "one defect", got.Defects, len(*got.Defects) == 1)
	defect := (*got.Defects)[0]
	expect(t, "defect of the item", defect, defect.Zone == "Шины и колёса", defect.Severity == "blocking",
		defect.State == "in_review", defect.Description == "Неисправно: Шины и колёса")
	state := scalar[string](t, f.d, `select t.state from fleet.trips t join sched.reservations r on r.source_id = t.id
	                                  where r.id = $1`, *b.ReservationId)
	expect(t, "trip", state, state == "defect_review")
	reported := f.body(t, list, map[string]string{"body": "pass", "tires": "fail"}, "front", "rear", "odometer")
	reported.Defects = &[]fleetapi.InspectionDefectReport{{Zone: "Шины и колёса", Description: "Порез боковины", Severity: "blocking"}}
	got = f.submit(t, reported)
	expect(t, "the reported blocking defect of the zone", got, got.Defects != nil)
	expect(t, "no second defect", got.Defects, len(*got.Defects) == 1, (*got.Defects)[0].Description == "Порез боковины")
}

// photoForm is the file field of a photo role in a definition written by hand (one JPEG up to 20 MB).
func photoForm(role string, required bool) string {
	req := "false"
	if required {
		req = "true"
	}
	return `{"key":"photo_` + role + `","label":"` + role + `","type":"file","required":` + req +
		`,"maxFiles":1,"allowedMimeTypes":["image/jpeg"],"maxFileBytes":20971520}`
}

// The definition is the source of a version (step 4.2: the checklist is a form): its items, their options, optional
// items and photos — whatever the items of the row say.
func (f versions) bySource(t *testing.T) {
	def := `{"title":"Осмотр перед выездом","description":"","visibility":[],"confirmationText":"","fields":[
	  {"key":"body","label":"Кузов","type":"single_choice","required":true,"options":[{"key":"pass","label":"Да"},{"key":"fail","label":"Нет"}]},
	  {"key":"lights","label":"Фары","type":"single_choice","required":true,"options":[{"key":"pass","label":"Да"},{"key":"fail","label":"Нет"},{"key":"not_applicable","label":"—"}]},
	  {"key":"docs","label":"Документы","type":"single_choice","required":false,"options":[{"key":"pass","label":"Да"}]},
	  ` + photoForm("front", true) + `,` + photoForm("cargo", false) + `]}`
	id := f.publish(t, 3, `[{"key":"body","label":"Кузов и стёкла осмотрены","required":true}]`, `{front,back,left,right,odometer}`, &def)
	list := f.current(t)
	keys := []string{}
	for _, it := range list.Items {
		keys = append(keys, it.Key)
	}
	expect(t, "version by its definition", list, list.VersionId == id, slices.Equal(keys, []string{"body", "lights", "docs"}),
		!list.Items[2].Required, slices.Equal(list.RequiredPhotoRoles, roleList("front")), list.Definition != nil)
	b := f.body(t, list, map[string]string{"body": "pass", "lights": "pass"}, "front", "cargo")
	cases := []struct {
		name   string
		mutate func(*fleetapi.InspectionCreate)
		code   string
		detail string
	}{
		{"пункт другой версии", func(b *fleetapi.InspectionCreate) {
			b.Checks = append(b.Checks, fleetapi.InspectionCheck{Key: "tires", Result: "pass"})
		}, "validation_failed", "Неверный пункт чек-листа."},
		{"результат вне вариантов", func(b *fleetapi.InspectionCreate) { b.Checks[0].Result = "not_applicable" },
			"validation_failed", "Для пункта «Кузов» такого результата нет."},
		{"обязательный пункт", func(b *fleetapi.InspectionCreate) { b.Checks = b.Checks[:1] },
			"inspection_incomplete", "Осмотр не завершён: 1 пункт чек-листа"},
		{"обязательное фото", func(b *fleetapi.InspectionCreate) { b.Photos = b.Photos[1:] },
			"inspection_incomplete", "Осмотр не завершён: 1 фото"},
	}
	for _, c := range cases {
		m := b
		m.Checks, m.Photos = slices.Clone(b.Checks), slices.Clone(b.Photos)
		c.mutate(&m)
		if _, err := f.e.svc.Submit(t.Context(), f.owner, m); !isCode(err, c.code) || !strings.Contains(err.Error(), c.detail) {
			t.Errorf("%s: %v, want %s %q", c.name, err, c.code, c.detail)
		}
	}
	got := f.submit(t, b)
	expect(t, "by the definition: optional item and photo", got, got.Status == "submitted", len(got.Photos) == 2, len(got.Checks) == 2)
}

// A definition that is not a checklist form (it passes the CHECK of 0017 but not FormDefinition: no fields): the
// version is read and checked by its items, the answer has no definition.
func (f versions) byItems(t *testing.T) {
	broken := `{"title":"Осмотр","fields":[]}`
	id := f.publish(t, 4, `[{"key":"wipers","label":"Дворники","required":true}]`, `{front}`, &broken)
	list := f.current(t)
	expect(t, "version by its items", list, list.VersionId == id, list.Definition == nil, len(list.Items) == 1,
		list.Items[0].Key == "wipers", slices.Equal(list.RequiredPhotoRoles, roleList("front")))
	got := f.submit(t, f.body(t, list, map[string]string{"wipers": "not_applicable"}, "front"))
	expect(t, "submitted by the items", got, got.Status == "submitted")
}

// forms returns the definitions of the checklist versions of tenant by «kind/version».
func forms(t *testing.T, tenant string) map[string]string {
	t.Helper()
	rows, err := db(t, tenant).QueryContext(t.Context(), `select kind||'/'||version, definition::text from fleet.checklist_versions`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var key, raw string
		if err := rows.Scan(&key, &raw); err != nil {
			t.Fatal(err)
		}
		out[key] = raw
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return out
}

// Q-W2.52-21: the definitions the writers leave (the built-in versions of A and B, the trigger of 0017) are checklist
// forms by FormDefinition; the only exception is the broken version written by hand above.
func (f versions) allForms(t *testing.T) {
	for _, tenant := range []string{"a", "b"} {
		all := forms(t, tenant)
		if tenant == "b" && len(all) != 5 {
			t.Errorf("tenant b: %d versions, want 5", len(all))
		}
		for key, raw := range all {
			if err := inspections.CheckForm([]byte(raw)); err != nil && (tenant != "b" || key != "departure/4") {
				t.Errorf("tenant %s, version %s: %v", tenant, key, err)
			}
		}
	}
}
