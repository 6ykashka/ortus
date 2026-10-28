//go:build integration

package repairs

import (
	"fmt"
	"sync/atomic"
	"testing"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

// ---- the world of the estimates: the price list, the templates and the objects of the tests ----

var phones atomic.Int64

// catalogItem writes an item of the price list (the name is unique among the live items: every test uses its own).
func catalogItem(t *testing.T, name, unit, kind string, price int64) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := superA.Exec(t.Context(), `insert into repairs.price_items (id, section, name, unit, kind, price_minor) values ($1, 'Стены', $2, $3, $4, $5)`,
		id, name, unit, kind, price); err != nil {
		t.Fatal(err)
	}
	return id
}

// tline is a line of a template: a formula with a coefficient or a fixed quantity.
type tline struct {
	section string
	item    uuid.UUID
	formula string
	coef    string
	qty     string
}

// newTemplate writes a template of the organization with the lines of its estimate.
func newTemplate(t *testing.T, name string, lines ...tline) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := superA.Exec(t.Context(), `insert into repairs.templates (id, name, kind, source) values ($1, $2, 'капитальный ремонт', 'own')`, id, name); err != nil {
		t.Fatal(err)
	}
	for i, l := range lines {
		var formula, coef, qty any
		if l.formula != "" {
			formula, coef = l.formula, l.coef
		} else {
			qty = l.qty
		}
		if _, err := superA.Exec(t.Context(), `insert into repairs.template_lines (template_id, part, section, price_item_id, quantity, formula, coef, sort)
			values ($1, 'estimate', $2, $3, $4, $5, $6, $7)`, id, l.section, l.item, qty, formula, coef, i); err != nil {
			t.Fatal(err)
		}
	}
	return id
}

// clientPhone gives the object a phone of its own and returns it.
func clientPhone(t *testing.T, projectID uuid.UUID) string {
	t.Helper()
	phone := fmt.Sprintf("+7 900 %03d-%02d-%02d", 100+phones.Add(1), 11, 22)
	if _, err := superA.Exec(t.Context(), `update repairs.projects set client_phone = $2 where id = $1`, projectID, phone); err != nil {
		t.Fatal(err)
	}
	return phone
}

func flatRooms() []rapi.MeasurementRoomInput {
	return []rapi.MeasurementRoomInput{
		{Name: "Кухня", LengthM: "4", WidthM: "3", HeightM: "2.5", OpeningsM2: "2"},
		{Name: "Санузел", LengthM: "2", WidthM: "1.5", HeightM: "2.5", OpeningsM2: "1.6"},
	}
}

// kit is an object with a measurement, three items of the price list and a template over them.
type kit struct {
	project, template, plaster, bags, trips uuid.UUID
}

func newKit(t *testing.T, name string, o seedOpts) kit {
	t.Helper()
	k := kit{
		plaster: catalogItem(t, name+"/Штукатурка", "m2", "work", 65_000),
		bags:    catalogItem(t, name+"/Смесь", "mesh", "material", 40_000),
		trips:   catalogItem(t, name+"/Вывоз", "trip", "work", 650_000),
	}
	k.template = newTemplate(t, name+"/Шаблон",
		tline{section: "Стены", item: k.plaster, formula: "walls_dry", coef: "1"},
		tline{section: "Материалы", item: k.bags, formula: "walls_dry", coef: "0.4"},
		tline{section: "Демонтаж", item: k.trips, qty: "2"})
	k.project = project(t, name, o)
	clientPhone(t, k.project)
	s, office := service(), as(t, "a.region-msk")
	m := must(s.Measurement(t.Context(), office, k.project)).of(t)
	must(s.PutMeasurement(t.Context(), office, k.project, rev(m.Revision), rapi.MeasurementPut{Rooms: flatRooms()})).of(t)
	return k
}

func sectionNames(e rapi.Estimate) []string {
	var out []string
	for _, s := range e.Sections {
		out = append(out, s.Name)
	}
	return out
}

func lineOf(t *testing.T, e rapi.Estimate, name string) rapi.EstimateLine {
	t.Helper()
	for _, l := range e.Lines {
		if l.Name == name {
			return l
		}
	}
	t.Fatalf("no line %q in %+v", name, e.Lines)
	return rapi.EstimateLine{}
}

// approve makes a version of the estimate the one in force, the way the cabinet does.
func approve(t *testing.T, projectID uuid.UUID, version int) {
	t.Helper()
	if _, err := service().ApproveEstimate(t.Context(), as(t, "a.owner"), projectID, version); err != nil {
		t.Fatal(err)
	}
}

// ---- the measurement ----

func TestMeasurement(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Замер/объект", seedOpts{status: "draft"})
	m := must(s.Measurement(ctx, office, id)).of(t)
	if m.Version != 1 || m.Revision != 1 || len(m.Rooms) != 0 || m.Totals.FloorM2 != "0" {
		t.Fatalf("no measurement yet: %+v", m)
	}
	_, err := s.PutMeasurement(ctx, office, id, rev(7), rapi.MeasurementPut{Rooms: flatRooms()})
	wantCode(t, err, "revision_mismatch", "")

	m = must(s.PutMeasurement(ctx, office, id, rev(m.Revision), rapi.MeasurementPut{Rooms: flatRooms()})).of(t)
	if m.Version != 2 || m.Revision != 2 || len(m.Rooms) != 2 || m.MeasuredAt == nil || m.MeasuredByMemberId == nil || *m.MeasuredByMemberId != person("a.region-msk") {
		t.Fatalf("saved: %+v", m)
	}
	want := rapi.MeasurementTotals{FloorM2: "15", WallsM2: "48.9", PerimeterM: "21", WetFloorM2: "3", WetWallsM2: "15.9"}
	if m.Totals != want {
		t.Fatalf("totals %+v, want %+v", m.Totals, want)
	}
	if m.Rooms[0].Wet == nil || *m.Rooms[0].Wet || m.Rooms[1].Wet == nil || !*m.Rooms[1].Wet {
		t.Fatalf("wet rooms: %+v", m.Rooms)
	}
	again := must(s.Measurement(ctx, office, id)).of(t)
	if again.Version != 2 || again.Totals != want || again.Rooms[0].Id != m.Rooms[0].Id {
		t.Fatalf("read back: %+v", again)
	}
	// the old version stays in the history: a new one is a new row
	if n := count(t, `select count(*) from repairs.measurements where project_id = $1`, id); n != 1 {
		t.Fatalf("rows %d", n)
	}
	m = must(s.PutMeasurement(ctx, office, id, rev(m.Revision), rapi.MeasurementPut{Rooms: flatRooms()[:1]})).of(t)
	if m.Version != 3 || m.Totals.FloorM2 != "12" {
		t.Fatalf("v3: %+v", m)
	}
	if n := count(t, `select count(*) from repairs.measurements where project_id = $1`, id); n != 2 {
		t.Fatalf("rows %d", n)
	}

	for _, c := range []struct {
		field string
		room  rapi.MeasurementRoomInput
	}{
		{"rooms[0].lengthM", rapi.MeasurementRoomInput{Name: "К", LengthM: "0", WidthM: "1", HeightM: "1", OpeningsM2: "0"}},
		{"rooms[0].widthM", rapi.MeasurementRoomInput{Name: "К", LengthM: "1", WidthM: "-1", HeightM: "1", OpeningsM2: "0"}},
		{"rooms[0].heightM", rapi.MeasurementRoomInput{Name: "К", LengthM: "1", WidthM: "1", HeightM: "abc", OpeningsM2: "0"}},
		{"rooms[0].openingsM2", rapi.MeasurementRoomInput{Name: "К", LengthM: "1", WidthM: "1", HeightM: "1", OpeningsM2: "1.2345"}},
		{"rooms[0].name", rapi.MeasurementRoomInput{Name: "  ", LengthM: "1", WidthM: "1", HeightM: "1", OpeningsM2: "0"}},
		{"rooms[0].lengthM", rapi.MeasurementRoomInput{Name: "К", LengthM: "5000", WidthM: "1", HeightM: "1", OpeningsM2: "0"}},
	} {
		_, err = s.PutMeasurement(ctx, office, id, rev(m.Revision), rapi.MeasurementPut{Rooms: []rapi.MeasurementRoomInput{c.room}})
		wantField(t, err, c.field, "")
	}
	// who: the foreman of the object measures; a reader does not; a hidden or missing object is 404
	me := person("a.manager-msk1")
	own := project(t, "Замер/прораб", seedOpts{foreman: &me})
	fm := as(t, "a.manager-msk1")
	got := must(s.PutMeasurement(ctx, fm, own, rev(1), rapi.MeasurementPut{Rooms: flatRooms()})).of(t)
	if got.Version != 2 {
		t.Fatalf("foreman: %+v", got)
	}
	_, err = s.PutMeasurement(ctx, as(t, "ab.member"), own, rev(got.Revision), rapi.MeasurementPut{Rooms: flatRooms()}) // the desk reads and manages, but does not measure
	wantCode(t, err, "forbidden_action", "")
	_, err = s.PutMeasurement(ctx, fm, id, rev(1), rapi.MeasurementPut{Rooms: flatRooms()})
	wantCode(t, err, "not_found", "")
	_, err = s.Measurement(ctx, office, uuid.New())
	wantCode(t, err, "not_found", "")
	handed := project(t, "Замер/сдан", seedOpts{status: "handed_over"})
	_, err = s.PutMeasurement(ctx, office, handed, rev(1), rapi.MeasurementPut{Rooms: flatRooms()})
	wantReason(t, err, "project_handed_over")
}

func TestMeasurementRecalculatesTheDraftOnly(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	k := newKit(t, "Замер/пересчёт", seedOpts{status: "draft"})
	est := must(s.EstimateFromTemplate(ctx, office, k.project, k.template)).of(t)
	if l := lineOf(t, est, "Замер/пересчёт/Штукатурка"); l.Quantity != "33" {
		t.Fatalf("plaster %+v", l)
	}
	// a manual volume is kept, the others follow the new measurement
	est = must(s.PatchEstimate(ctx, office, k.project, 1, rev(est.Revision), rapi.EstimateDraftPatch{
		Lines: &[]rapi.EstimateLinePatch{{Id: lineOf(t, est, "Замер/пересчёт/Смесь").Id, Quantity: new("20")}}})).of(t)
	m := must(s.Measurement(ctx, office, k.project)).of(t)
	must(s.PutMeasurement(ctx, office, k.project, rev(m.Revision), rapi.MeasurementPut{Rooms: flatRooms()[:1]})).of(t) // 33 m2 of walls, 12 of floor
	must(s.PutMeasurement(ctx, office, k.project, rev(m.Revision+1), rapi.MeasurementPut{Rooms: []rapi.MeasurementRoomInput{
		{Name: "Зал", LengthM: "5", WidthM: "4", HeightM: "3", OpeningsM2: "4"}}})).of(t) // walls (5+4) × 2 × 3 − 4 = 50
	got := must(s.Estimate(ctx, office, k.project, 1)).of(t)
	if l := lineOf(t, got, "Замер/пересчёт/Штукатурка"); l.Quantity != "50" || l.Manual {
		t.Fatalf("plaster follows the measurement: %+v", l)
	}
	if l := lineOf(t, got, "Замер/пересчёт/Смесь"); l.Quantity != "20" || !l.Manual {
		t.Fatalf("a manual volume is kept: %+v", l)
	}
	if l := lineOf(t, got, "Замер/пересчёт/Вывоз"); l.Quantity != "2" {
		t.Fatalf("a fixed quantity does not move: %+v", l)
	}
	// a sent version is never changed by the measurement
	sent := must(s.SendEstimate(ctx, office, k.project, 1, rev(got.Revision))).of(t)
	m = must(s.Measurement(ctx, office, k.project)).of(t)
	must(s.PutMeasurement(ctx, office, k.project, rev(m.Revision), rapi.MeasurementPut{Rooms: flatRooms()})).of(t)
	after := must(s.Estimate(ctx, office, k.project, 1)).of(t)
	if lineOf(t, after, "Замер/пересчёт/Штукатурка").Quantity != "50" || after.Revision != sent.Revision || after.State != rapi.EstimateStateSent {
		t.Fatalf("sent version moved: %+v", after)
	}
}

// ---- build, edit, send, recall, delete ----

func TestEstimateFromTemplate(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	k := newKit(t, "Смета/сборка", seedOpts{status: "draft"})
	est := must(s.EstimateFromTemplate(ctx, office, k.project, k.template)).of(t)
	if est.Version != 1 || est.Kind != rapi.EstimateKindFirst || est.State != rapi.EstimateStateDraft || est.Revision != 1 || est.DiscountPct != 0 ||
		est.TemplateId == nil || *est.TemplateId != k.template || est.BaseVersion != nil || len(est.ChangeOrderIds) != 0 {
		t.Fatalf("estimate: %+v", est)
	}
	if got := sectionNames(est); len(got) != 3 || got[0] != "Стены" || got[1] != "Материалы" || got[2] != "Демонтаж" {
		t.Fatalf("sections in the order of the template: %v", got)
	}
	// 33 m2 × 650 ₽ + 14 bags (13.2 up) × 400 ₽ + 2 trips × 6 500 ₽
	p := lineOf(t, est, "Смета/сборка/Штукатурка")
	if p.Quantity != "33" || p.Price.AmountMinor != 65_000 || p.Sum.AmountMinor != 2_145_000 || p.Manual || p.IsNew || p.Formula == nil || *p.Formula != "walls_dry" ||
		p.PriceItemId == nil || *p.PriceItemId != k.plaster || p.Kind != rapi.EstimateLineKindWork || p.Unit != rapi.RepairUnitM2 {
		t.Fatalf("plaster: %+v", p)
	}
	if b := lineOf(t, est, "Смета/сборка/Смесь"); b.Quantity != "14" || b.Coef == nil || *b.Coef != "0.4" || b.Sum.AmountMinor != 560_000 || b.Kind != rapi.EstimateLineKindMaterial {
		t.Fatalf("bags: %+v", b)
	}
	if v := lineOf(t, est, "Смета/сборка/Вывоз"); v.Quantity != "2" || v.Formula != nil || v.Sum.AmountMinor != 1_300_000 {
		t.Fatalf("trips: %+v", v)
	}
	if est.Total.AmountMinor != 4_005_000 || est.Total.Currency != "RUB" {
		t.Fatalf("total %+v", est.Total)
	}
	if n := count(t, `select count(*) from repairs.projects where id = $1 and template_id = $2`, k.project, k.template); n != 1 {
		t.Fatal("the object does not remember its template")
	}
	list := must(s.Estimates(ctx, office, k.project)).of(t)
	if len(list.Items) != 1 || list.Items[0].Version != 1 {
		t.Fatalf("list: %+v", list)
	}

	// refusals
	_, err := s.EstimateFromTemplate(ctx, office, k.project, k.template)
	wantCode(t, err, "estimate_draft_exists", "")
	other := project(t, "Смета/сборка/второй", seedOpts{status: "draft"})
	_, err = s.EstimateFromTemplate(ctx, office, other, uuid.New())
	wantField(t, err, "templateId", "")
	_, err = s.EstimateFromTemplate(ctx, as(t, "ab.member"), other, k.template) // no repairs.estimates.edit
	wantCode(t, err, "forbidden_action", "")
	_, err = s.EstimateFromTemplate(ctx, as(t, "a.manager-msk1"), other, k.template) // the foreman does not see a draft
	wantCode(t, err, "not_found", "")
	_, err = s.EstimateFromTemplate(ctx, office, uuid.New(), k.template)
	wantCode(t, err, "not_found", "")
	handed := project(t, "Смета/сдан", seedOpts{status: "handed_over"})
	_, err = s.EstimateFromTemplate(ctx, office, handed, k.template)
	wantReason(t, err, "project_handed_over")
	// an empty measurement gives zero volumes of the formulas
	empty := must(s.EstimateFromTemplate(ctx, office, other, k.template)).of(t)
	if p := lineOf(t, empty, "Смета/сборка/Штукатурка"); p.Quantity != "0" || p.Sum.AmountMinor != 0 {
		t.Fatalf("no measurement: %+v", p)
	}

	// one build per object: after a version was approved, a new one is a revision
	must(s.SendEstimate(ctx, office, k.project, 1, rev(est.Revision))).of(t)
	approve(t, k.project, 1)
	_, err = s.EstimateFromTemplate(ctx, office, k.project, k.template)
	wantCode(t, err, "invalid_transition", "")
}

func TestPatchEstimateDraft(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	k := newKit(t, "Смета/правка", seedOpts{status: "draft"})
	est := must(s.EstimateFromTemplate(ctx, office, k.project, k.template)).of(t)
	plaster := lineOf(t, est, "Смета/правка/Штукатурка")
	bags := lineOf(t, est, "Смета/правка/Смесь")
	trips := lineOf(t, est, "Смета/правка/Вывоз")
	extra := catalogItem(t, "Смета/правка/Грунт", "liter", "material", 9_500)
	archived := catalogItem(t, "Смета/правка/Старьё", "piece", "material", 100)
	if _, err := superA.Exec(ctx, `update repairs.price_items set archived = true where id = $1`, archived); err != nil {
		t.Fatal(err)
	}

	// a section, a line of the price list in it, a manual volume and price, a discount — in one batch
	got := must(s.PatchEstimate(ctx, office, k.project, 1, rev(est.Revision), rapi.EstimateDraftPatch{
		AddSections: &[]string{"  Сантехника "},
		DiscountPct: new(10),
		Lines: &[]rapi.EstimateLinePatch{
			{Id: plaster.Id, Quantity: new("40")},
			{Id: trips.Id, Price: &rapi.Money{AmountMinor: 700_000, Currency: "RUB"}},
		},
		RemoveLineIds: &[]rapi.Id{bags.Id},
	})).of(t)
	if got.Revision != est.Revision+1 || got.DiscountPct != 10 || len(got.Sections) != 4 || got.Sections[3].Name != "Сантехника" {
		t.Fatalf("patched: %+v", got)
	}
	if p := lineOf(t, got, "Смета/правка/Штукатурка"); p.Quantity != "40" || !p.Manual || p.Sum.AmountMinor != 2_600_000 {
		t.Fatalf("manual volume: %+v", p)
	}
	if v := lineOf(t, got, "Смета/правка/Вывоз"); v.Price.AmountMinor != 700_000 || v.Sum.AmountMinor != 1_400_000 || v.Manual {
		t.Fatalf("manual price: %+v", v)
	}
	if len(got.Lines) != 2 {
		t.Fatalf("a line was not removed: %+v", got.Lines)
	}
	// 2 600 000 + 1 400 000 = 4 000 000, less 10 %
	if got.Total.AmountMinor != 3_600_000 {
		t.Fatalf("total %d", got.Total.AmountMinor)
	}
	section := got.Sections[3].Id
	got = must(s.PatchEstimate(ctx, office, k.project, 1, rev(got.Revision), rapi.EstimateDraftPatch{
		AddLines: &[]rapi.EstimateLineAdd{{SectionId: section, PriceItemId: extra, Quantity: new("12.5")}, {SectionId: section, PriceItemId: k.bags}}})).of(t)
	if g := lineOf(t, got, "Смета/правка/Грунт"); g.Quantity != "12.5" || !g.IsNew || g.Manual || g.Unit != rapi.RepairUnitLiter || g.SectionId != section || g.Sum.AmountMinor != 118_750 {
		t.Fatalf("added line: %+v", g)
	}
	if b := lineOf(t, got, "Смета/правка/Смесь"); b.Quantity != "1" || b.Formula != nil {
		t.Fatalf("a line without a quantity is 1: %+v", b)
	}
	// «вернуть из замера»
	got = must(s.PatchEstimate(ctx, office, k.project, 1, rev(got.Revision), rapi.EstimateDraftPatch{ResetLineIds: &[]rapi.Id{plaster.Id}})).of(t)
	if p := lineOf(t, got, "Смета/правка/Штукатурка"); p.Quantity != "33" || p.Manual {
		t.Fatalf("reset: %+v", p)
	}

	// refusals
	_, err := s.PatchEstimate(ctx, office, k.project, 1, rev(est.Revision), rapi.EstimateDraftPatch{DiscountPct: new(5)})
	wantCode(t, err, "revision_mismatch", "")
	for field, patch := range map[string]rapi.EstimateDraftPatch{
		"lines[0].id":             {Lines: &[]rapi.EstimateLinePatch{{Id: uuid.New(), Quantity: new("1")}}},
		"lines[0].quantity":       {Lines: &[]rapi.EstimateLinePatch{{Id: plaster.Id, Quantity: new("-1")}}},
		"lines[0].price":          {Lines: &[]rapi.EstimateLinePatch{{Id: plaster.Id, Price: &rapi.Money{AmountMinor: -5, Currency: "RUB"}}}},
		"addLines[0].sectionId":   {AddLines: &[]rapi.EstimateLineAdd{{SectionId: uuid.New(), PriceItemId: extra}}},
		"addLines[0].priceItemId": {AddLines: &[]rapi.EstimateLineAdd{{SectionId: section, PriceItemId: archived}}},
		"addLines[0].quantity":    {AddLines: &[]rapi.EstimateLineAdd{{SectionId: section, PriceItemId: extra, Quantity: new("x")}}},
		"removeLineIds[0]":        {RemoveLineIds: &[]rapi.Id{uuid.New()}},
		"resetLineIds[0]":         {ResetLineIds: &[]rapi.Id{uuid.New()}},
		"discountPct":             {DiscountPct: new(101)},
		"addSections[0]":          {AddSections: &[]string{"   "}},
	} {
		_, err = s.PatchEstimate(ctx, office, k.project, 1, rev(got.Revision), patch)
		wantField(t, err, field, "")
	}
	_, err = s.PatchEstimate(ctx, as(t, "ab.member"), k.project, 1, rev(got.Revision), rapi.EstimateDraftPatch{DiscountPct: new(5)})
	wantCode(t, err, "forbidden_action", "")
	_, err = s.PatchEstimate(ctx, office, k.project, 9, rev(1), rapi.EstimateDraftPatch{DiscountPct: new(5)})
	wantCode(t, err, "not_found", "")
	// a refused batch changes nothing
	if again := must(s.Estimate(ctx, office, k.project, 1)).of(t); again.Revision != got.Revision {
		t.Fatalf("revision moved by a refusal: %d → %d", got.Revision, again.Revision)
	}
	// a sent version is locked
	sent := must(s.SendEstimate(ctx, office, k.project, 1, rev(got.Revision))).of(t)
	_, err = s.PatchEstimate(ctx, office, k.project, 1, rev(sent.Revision), rapi.EstimateDraftPatch{DiscountPct: new(5)})
	wantCode(t, err, "estimate_version_locked", "")
}

func TestSendRecallDeleteEstimate(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	k := newKit(t, "Смета/отправка", seedOpts{status: "draft"})
	empty := project(t, "Смета/отправка/пустая", seedOpts{status: "draft"})
	bare := must(s.EstimateFromTemplate(ctx, office, empty, newTemplate(t, "Смета/отправка/пустой шаблон"))).of(t)
	_, err := s.SendEstimate(ctx, office, empty, 1, rev(bare.Revision))
	wantField(t, err, "lines", "")

	est := must(s.EstimateFromTemplate(ctx, office, k.project, k.template)).of(t)
	_, err = s.SendEstimate(ctx, office, k.project, 1, rev(est.Revision+3))
	wantCode(t, err, "revision_mismatch", "")
	_, err = s.SendEstimate(ctx, as(t, "ab.member"), k.project, 1, rev(est.Revision))
	wantCode(t, err, "forbidden_action", "")
	sent := must(s.SendEstimate(ctx, office, k.project, 1, rev(est.Revision))).of(t)
	if sent.State != rapi.EstimateStateSent || sent.SentAt == nil || sent.Revision != est.Revision+1 || sent.AgreementNo != nil {
		t.Fatalf("sent: %+v", sent)
	}
	if n := count(t, `select count(*) from repairs.documents where project_id = $1`, k.project); n != 0 {
		t.Fatalf("a first version is approved in the cabinet, no agreement yet: %d documents", n)
	}
	_, err = s.SendEstimate(ctx, office, k.project, 1, rev(sent.Revision))
	wantCode(t, err, "estimate_version_locked", "")
	err = s.DeleteEstimate(ctx, office, k.project, 1, rev(sent.Revision))
	wantCode(t, err, "estimate_version_locked", "")

	back := must(s.RecallEstimate(ctx, office, k.project, 1, rev(sent.Revision))).of(t)
	if back.State != rapi.EstimateStateDraft || back.SentAt != nil || back.Revision != sent.Revision+1 {
		t.Fatalf("recalled: %+v", back)
	}
	_, err = s.RecallEstimate(ctx, office, k.project, 1, rev(back.Revision))
	wantCode(t, err, "estimate_version_locked", "")

	// delete: the draft is gone and the number is free again
	if err := s.DeleteEstimate(ctx, office, k.project, 1, rev(back.Revision-1)); err == nil {
		t.Fatal("deleted with a stale revision")
	}
	if err := s.DeleteEstimate(ctx, office, k.project, 1, rev(back.Revision)); err != nil {
		t.Fatal(err)
	}
	_, err = s.Estimate(ctx, office, k.project, 1)
	wantCode(t, err, "not_found", "")
	if n := count(t, `select count(*) from repairs.estimate_lines l join repairs.estimates e on e.id = l.estimate_id where e.project_id = $1`, k.project); n != 0 {
		t.Fatalf("lines of a deleted draft remain: %d", n)
	}
	again := must(s.EstimateFromTemplate(ctx, office, k.project, k.template)).of(t)
	if again.Version != 1 {
		t.Fatalf("version after a deleted draft: %d", again.Version)
	}

	// an approved version can be neither recalled nor deleted nor sent
	s2 := must(s.SendEstimate(ctx, office, k.project, 1, rev(again.Revision))).of(t)
	approve(t, k.project, 1)
	cur := must(s.Estimate(ctx, office, k.project, 1)).of(t)
	if cur.State != rapi.EstimateStateApproved || cur.ApprovedAt == nil || cur.Revision <= s2.Revision {
		t.Fatalf("approved: %+v", cur)
	}
	_, err = s.RecallEstimate(ctx, office, k.project, 1, rev(cur.Revision))
	wantCode(t, err, "estimate_version_locked", "")
	err = s.DeleteEstimate(ctx, office, k.project, 1, rev(cur.Revision))
	wantCode(t, err, "estimate_version_locked", "")
}

func TestEstimateReadsNeedFinance(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	k := newKit(t, "Смета/чтение", seedOpts{status: "draft"})
	must(s.EstimateFromTemplate(ctx, office, k.project, k.template)).of(t)
	for name, tc := range map[string]string{"desk without finance": "ab.member"} {
		_, err := s.Estimates(ctx, as(t, tc), k.project)
		if err == nil {
			t.Errorf("%s reads the estimates", name)
			continue
		}
		wantCode(t, err, "forbidden_action", "")
		_, err = s.Estimate(ctx, as(t, tc), k.project, 1)
		wantCode(t, err, "forbidden_action", "")
		_, err = s.DiffEstimates(ctx, as(t, tc), k.project, 1, 1)
		wantCode(t, err, "forbidden_action", "")
	}
	// the foreman of an active object sees the object but never its prices
	me := person("a.manager-msk1")
	own := project(t, "Смета/чтение/прораб", seedOpts{foreman: &me})
	_, err := s.Estimates(ctx, as(t, "a.manager-msk1"), own)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.Estimates(ctx, office, uuid.New())
	wantCode(t, err, "not_found", "")
	_, err = s.Estimate(ctx, office, k.project, 7)
	wantCode(t, err, "not_found", "")
}

func TestDiffEstimates(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	k := newKit(t, "Смета/сравнение", seedOpts{status: "draft"})
	est := must(s.EstimateFromTemplate(ctx, office, k.project, k.template)).of(t)
	must(s.SendEstimate(ctx, office, k.project, 1, rev(est.Revision))).of(t)
	approve(t, k.project, 1)

	v2 := must(s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindRevision})).of(t)
	if v2.Version != 2 || v2.Kind != rapi.EstimateKindRevision || v2.BaseVersion == nil || *v2.BaseVersion != 1 || v2.State != rapi.EstimateStateDraft || len(v2.Lines) != 3 {
		t.Fatalf("v2: %+v", v2)
	}
	for _, l := range v2.Lines {
		if l.IsNew {
			t.Errorf("a copied line is new: %+v", l)
		}
	}
	// the copied lines keep the key of the line: the comparison matches by it
	v1 := must(s.Estimate(ctx, office, k.project, 1)).of(t)
	if lineOf(t, v1, "Смета/сравнение/Штукатурка").Id != lineOf(t, v2, "Смета/сравнение/Штукатурка").Id {
		t.Fatal("a copy of a line changed its id")
	}
	// v2: another volume of the plaster, no bags, a new item instead of the trips
	skip := catalogItem(t, "Смета/сравнение/Контейнер", "trip", "work", 800_000)
	sec := v2.Sections[2].Id
	v2 = must(s.PatchEstimate(ctx, office, k.project, 2, rev(v2.Revision), rapi.EstimateDraftPatch{
		Lines:         &[]rapi.EstimateLinePatch{{Id: lineOf(t, v2, "Смета/сравнение/Штукатурка").Id, Quantity: new("40")}},
		RemoveLineIds: &[]rapi.Id{lineOf(t, v2, "Смета/сравнение/Смесь").Id, lineOf(t, v2, "Смета/сравнение/Вывоз").Id},
		AddLines:      &[]rapi.EstimateLineAdd{{SectionId: sec, PriceItemId: skip, Quantity: new("2")}},
	})).of(t)
	d := must(s.DiffEstimates(ctx, office, k.project, 1, 2)).of(t)
	if d.From != 1 || d.To != 2 || d.TotalFrom.AmountMinor != 4_005_000 || d.TotalTo.AmountMinor != 2_600_000+1_600_000 || d.Delta.AmountMinor != 195_000 {
		t.Fatalf("diff totals: %+v", d)
	}
	byName := map[string]rapi.EstimateDiffRow{}
	for _, r := range d.Rows {
		byName[r.Name] = r
	}
	if len(d.Rows) != 4 {
		t.Fatalf("rows: %+v", d.Rows)
	}
	if r := byName["Смета/сравнение/Штукатурка"]; r.Change != rapi.EstimateDiffRowChange("changed") || r.Delta.AmountMinor != 455_000 || r.QuantityA == nil || *r.QuantityA != "33" || r.QuantityB == nil || *r.QuantityB != "40" {
		t.Fatalf("changed: %+v", r)
	}
	if r := byName["Смета/сравнение/Смесь"]; r.Change != rapi.EstimateDiffRowChange("removed") || r.Delta.AmountMinor != -560_000 || r.QuantityB != nil || r.PriceB != nil {
		t.Fatalf("removed: %+v", r)
	}
	if r := byName["Смета/сравнение/Вывоз"]; r.Change != rapi.EstimateDiffRowChange("removed") || r.Delta.AmountMinor != -1_300_000 {
		t.Fatalf("replaced is removed: %+v", r)
	}
	if r := byName["Смета/сравнение/Контейнер"]; r.Change != rapi.EstimateDiffRowChange("added") || r.Delta.AmountMinor != 1_600_000 || r.QuantityA != nil || r.LineId == nil {
		t.Fatalf("replaced is added: %+v", r)
	}
	_, err := s.DiffEstimates(ctx, office, k.project, 1, 9)
	wantCode(t, err, "not_found", "")
	same := must(s.DiffEstimates(ctx, office, k.project, 1, 1)).of(t)
	for _, r := range same.Rows {
		if r.Change != rapi.EstimateDiffRowChange("same") || r.Delta.AmountMinor != 0 {
			t.Fatalf("a version against itself: %+v", r)
		}
	}
}

func TestEstimateRevisionRules(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	k := newKit(t, "Смета/версии", seedOpts{status: "draft"})
	_, err := s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindRevision})
	wantReason(t, err, "repair_estimate_not_approved")
	est := must(s.EstimateFromTemplate(ctx, office, k.project, k.template)).of(t)
	_, err = s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindRevision})
	wantCode(t, err, "estimate_draft_exists", "")
	must(s.SendEstimate(ctx, office, k.project, 1, rev(est.Revision))).of(t)
	approve(t, k.project, 1)

	// before the contract only a revision; with change orders it is not a revision at all
	_, err = s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindChange})
	wantField(t, err, "kind", "")
	_, err = s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindRevision, ChangeOrderIds: &[]uuid.UUID{uuid.New()}})
	wantField(t, err, "changeOrderIds[0]", "")
	_, err = s.EstimateRevision(ctx, as(t, "ab.member"), k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindRevision})
	wantCode(t, err, "forbidden_action", "")
	v2 := must(s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindRevision})).of(t)
	if v2.Version != 2 || v2.DiscountPct != 0 {
		t.Fatalf("v2: %+v", v2)
	}
	sent := must(s.SendEstimate(ctx, office, k.project, 2, rev(v2.Revision))).of(t)
	_, err = s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindRevision})
	wantCode(t, err, "estimate_draft_exists", "") // a sent revision (not an agreement) is an open version
	approve(t, k.project, 2)
	old := must(s.Estimate(ctx, office, k.project, 1)).of(t)
	cur := must(s.Estimate(ctx, office, k.project, 2)).of(t)
	if old.State != rapi.EstimateStateReplaced || cur.State != rapi.EstimateStateApproved || cur.Revision <= sent.Revision {
		t.Fatalf("v1 %s, v2 %s", old.State, cur.State)
	}
	// the budget follows the version in force
	if n := count(t, `select count(*) from repairs.projects where id = $1 and budget_minor = 4005000`, k.project); n != 1 {
		t.Fatal("budget of the approved version")
	}
	// a replaced version is not edited, recalled or deleted
	err = s.DeleteEstimate(ctx, office, k.project, 1, rev(old.Revision))
	wantCode(t, err, "estimate_version_locked", "")
}
