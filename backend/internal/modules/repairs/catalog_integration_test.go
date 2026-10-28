//go:build integration

package repairs

import (
	"slices"
	"strings"
	"testing"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

func price(rub int) rapi.Money { return rapi.Money{AmountMinor: rub * 100, Currency: "RUB"} }

func newItem(name string) rapi.PriceItemCreate {
	return rapi.PriceItemCreate{Section: "Полы", Name: name, Unit: rapi.RepairUnitM2, Kind: rapi.PriceItemCreateKindWork, Price: price(1500)}
}

func TestCreatePriceItem(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	it := must(s.CreatePriceItem(ctx, office, newItem("  Кат/Плитка 60×60 "))).of(t)
	if it.Name != "Кат/Плитка 60×60" || it.Section != "Полы" || it.Unit != rapi.RepairUnitM2 || it.Kind != rapi.PriceItemKindWork || it.Price != price(1500) ||
		it.UsedInTemplates != 0 || it.Archived || it.Revision != 1 {
		t.Fatalf("created: %+v", it)
	}
	// a duplicate among the live items, whatever the case and the spaces
	_, err := s.CreatePriceItem(ctx, office, newItem("кат/плитка 60×60"))
	wantField(t, err, "name", "price_item_duplicate")
	f, _ := asFailure(err)
	if f == nil || f.violations[0].message != "Такая позиция уже есть в справочнике." || f.violations[0].code != "duplicate" {
		t.Fatalf("duplicate: %+v", f)
	}

	for field, mod := range map[string]func(*rapi.PriceItemCreate){
		"name":    func(b *rapi.PriceItemCreate) { b.Name = "  " },
		"section": func(b *rapi.PriceItemCreate) { b.Section = "" },
		"unit":    func(b *rapi.PriceItemCreate) { b.Unit = "parsec" },
		"kind":    func(b *rapi.PriceItemCreate) { b.Kind = "service" },
		"price":   func(b *rapi.PriceItemCreate) { b.Price = rapi.Money{AmountMinor: 0, Currency: "RUB"} },
	} {
		b := newItem("Кат/Проверка " + field)
		mod(&b)
		_, err = s.CreatePriceItem(ctx, office, b)
		wantField(t, err, field, "")
	}
	b := newItem("Кат/Другая валюта")
	b.Price.Currency = "USD"
	_, err = s.CreatePriceItem(ctx, office, b)
	wantField(t, err, "price", "")
	b = newItem("Кат/Слишком дорого")
	b.Price.AmountMinor = 9_007_199_254_740_992
	_, err = s.CreatePriceItem(ctx, office, b)
	wantField(t, err, "price", "")

	// the price list is kept by the catalog right; the estimator reads it but does not change it
	for _, who := range []string{"a.manager-msk1", "ab.member", "a.manager-msk2"} {
		_, err = s.CreatePriceItem(ctx, as(t, who), newItem("Кат/"+who))
		wantCode(t, err, "forbidden_action", "")
	}
}

func TestListPriceItems(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	for i, name := range []string{"Список/Б", "Список/А", "Список/В"} {
		b := newItem(name)
		if i == 2 {
			b.Kind, b.Unit, b.Section = rapi.PriceItemCreateKindMaterial, rapi.RepairUnitMesh, "Материалы"
		}
		must(s.CreatePriceItem(ctx, office, b)).of(t)
	}
	q := func(q string, kind *string, limit *int, cursor *string) rapi.PriceItemPage {
		return must(s.PriceItems(ctx, office, PriceQuery{Q: &q, Kind: kind, Limit: limit, Cursor: cursor})).of(t)
	}
	all := q("список/", nil, nil, nil)
	var names []string
	for _, it := range all.Items {
		names = append(names, it.Name)
	}
	if !slices.Equal(names, []string{"Список/А", "Список/Б", "Список/В"}) { // the sections go first (Полы, then Материалы), the names inside a section
		t.Fatalf("order %v", names)
	}
	if k := q("список/", new("material"), nil, nil); len(k.Items) != 1 || k.Items[0].Name != "Список/В" {
		t.Fatalf("kind filter: %+v", k.Items)
	}
	page := q("список/", nil, new(2), nil)
	if len(page.Items) != 2 || page.NextCursor == nil {
		t.Fatalf("page: %+v", page)
	}
	rest := q("список/", nil, new(2), page.NextCursor)
	if len(rest.Items) != 1 || rest.NextCursor != nil {
		t.Fatalf("rest: %+v", rest)
	}
	_, err := s.PriceItems(ctx, office, PriceQuery{Kind: new("service")})
	wantCode(t, err, "malformed_request", "")
	_, err = s.PriceItems(ctx, office, PriceQuery{Cursor: new("zzz")})
	wantCode(t, err, "malformed_request", "")

	// used in templates: counted once per template, whatever the number of lines
	item := all.Items[0].Id
	newTemplate(t, "Список/шаблон 1", tline{section: "Полы", item: item, qty: "1"}, tline{section: "Полы", item: item, qty: "2"})
	newTemplate(t, "Список/шаблон 2", tline{section: "Полы", item: item, qty: "3"})
	if got := q("список/а", nil, nil, nil); got.Items[0].UsedInTemplates != 2 {
		t.Fatalf("used in templates: %+v", got.Items[0])
	}
	// archived items are not offered
	must(s.UpdatePriceItem(ctx, office, all.Items[1].Id, rev(1), rapi.PriceItemPatch{Archived: new(true)})).of(t)
	if got := q("список/", nil, nil, nil); len(got.Items) != 2 {
		t.Fatalf("archived: %+v", got.Items)
	}
	// the estimator reads the list, the foreman and the desk do not
	if _, err := s.PriceItems(ctx, as(t, "a.region-msk"), PriceQuery{}); err != nil {
		t.Fatal(err)
	}
	for _, who := range []string{"a.manager-msk1", "ab.member"} {
		_, err = s.PriceItems(ctx, as(t, who), PriceQuery{})
		wantCode(t, err, "forbidden_action", "")
	}
}

func TestUpdatePriceItem(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	k := newKit(t, "Цена/смета", seedOpts{status: "draft"})
	est := must(s.EstimateFromTemplate(ctx, office, k.project, k.template)).of(t)
	it := must(s.CreatePriceItem(ctx, office, newItem("Цена/Позиция"))).of(t)
	other := must(s.CreatePriceItem(ctx, office, newItem("Цена/Другая"))).of(t)

	_, err := s.UpdatePriceItem(ctx, office, it.Id, rev(5), rapi.PriceItemPatch{Price: &rapi.Money{AmountMinor: 200_000, Currency: "RUB"}})
	wantCode(t, err, "revision_mismatch", "")
	up := must(s.UpdatePriceItem(ctx, office, it.Id, rev(it.Revision), rapi.PriceItemPatch{
		Price: &rapi.Money{AmountMinor: 200_000, Currency: "RUB"}, Name: new(" Цена/Позиция 2 "), Section: new("Стены"), Unit: new(rapi.RepairUnitM)})).of(t)
	if up.Price.AmountMinor != 200_000 || up.Name != "Цена/Позиция 2" || up.Section != "Стены" || up.Unit != rapi.RepairUnitM || up.Revision != it.Revision+1 {
		t.Fatalf("updated: %+v", up)
	}
	// a new price does not move the versions that exist: only the lines added afterwards take it
	k2 := catalogItem(t, "Цена/Штукатурка", "m2", "work", 70_000)
	if _, err := superA.Exec(ctx, `update repairs.template_lines set price_item_id = $2 where template_id = $1 and part = 'estimate' and formula = 'walls_dry' and coef = 1`, k.template, k2); err != nil {
		t.Fatal(err)
	}
	must(s.UpdatePriceItem(ctx, office, k.plaster, rev(1), rapi.PriceItemPatch{Price: &rapi.Money{AmountMinor: 99_000, Currency: "RUB"}})).of(t)
	if got := must(s.Estimate(ctx, office, k.project, 1)).of(t); lineOf(t, got, "Цена/смета/Штукатурка").Price.AmountMinor != 65_000 || got.Revision != est.Revision {
		t.Fatalf("a price change moved a draft: %+v", got)
	}
	patched := must(s.PatchEstimate(ctx, office, k.project, 1, rev(est.Revision), rapi.EstimateDraftPatch{
		AddLines: &[]rapi.EstimateLineAdd{{SectionId: est.Sections[0].Id, PriceItemId: k.plaster, Quantity: new("1")}}})).of(t)
	var added rapi.EstimateLine
	for _, l := range patched.Lines {
		if l.IsNew {
			added = l
		}
	}
	if added.Price.AmountMinor != 99_000 || !added.IsNew {
		t.Fatalf("a line added from the price list takes the new price: %+v", added)
	}
	// a draft built afterwards takes it too
	later := project(t, "Цена/позже", seedOpts{status: "draft"})
	if e := must(s.EstimateFromTemplate(ctx, office, later, k.template)).of(t); lineOf(t, e, "Цена/Штукатурка").Price.AmountMinor != 70_000 {
		t.Fatalf("a new draft: %+v", e.Lines)
	}

	_, err = s.UpdatePriceItem(ctx, office, it.Id, rev(up.Revision), rapi.PriceItemPatch{Name: &other.Name})
	wantField(t, err, "name", "price_item_duplicate")
	_, err = s.UpdatePriceItem(ctx, office, it.Id, rev(up.Revision), rapi.PriceItemPatch{Price: &rapi.Money{AmountMinor: 0, Currency: "RUB"}})
	wantField(t, err, "price", "")
	_, err = s.UpdatePriceItem(ctx, office, it.Id, rev(up.Revision), rapi.PriceItemPatch{Unit: new(rapi.RepairUnit("parsec"))})
	wantField(t, err, "unit", "")
	_, err = s.UpdatePriceItem(ctx, office, uuid.New(), rev(1), rapi.PriceItemPatch{Archived: new(true)})
	wantCode(t, err, "not_found", "")
	_, err = s.UpdatePriceItem(ctx, as(t, "ab.member"), it.Id, rev(up.Revision), rapi.PriceItemPatch{Archived: new(true)})
	wantCode(t, err, "forbidden_action", "")
	// an archived item can be restored, and its name is free for another one meanwhile
	ar := must(s.UpdatePriceItem(ctx, office, it.Id, rev(up.Revision), rapi.PriceItemPatch{Archived: new(true)})).of(t)
	must(s.CreatePriceItem(ctx, office, newItem(up.Name))).of(t)
	_, err = s.UpdatePriceItem(ctx, office, it.Id, rev(ar.Revision), rapi.PriceItemPatch{Archived: new(false)})
	wantField(t, err, "name", "price_item_duplicate")
}

// ---- the templates ----

func TestStarterTemplates(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	list := must(s.Templates(ctx, office)).of(t)
	var ortus []rapi.Template
	for _, tpl := range list.Items {
		if tpl.Source == rapi.TemplateSource("ortus") {
			ortus = append(ortus, tpl)
		}
	}
	if len(ortus) != 3 {
		t.Fatalf("the starter templates of Ortus: %d", len(ortus))
	}
	names := map[string]rapi.Template{}
	for _, tpl := range ortus {
		names[tpl.Name] = tpl
	}
	capital, ok := names["Капитальный ремонт квартиры"]
	if !ok || names["Косметический ремонт"].Id == uuid.Nil || names["Коммерческое помещение"].Id == uuid.Nil {
		t.Fatalf("starter names: %v", names)
	}
	// asking again does not copy them again
	if again := must(s.Templates(ctx, office)).of(t); countSource(again.Items, rapi.TemplateSource("ortus")) != 3 {
		t.Fatalf("copied twice: %d", countSource(again.Items, rapi.TemplateSource("ortus")))
	}
	if n := count(t, `select count(*) from repairs.price_items where name = 'Демонтаж напольного покрытия' and not archived`); n != 1 {
		t.Fatalf("starter price list: %d", n)
	}
	// the six parts
	got := must(s.Template(ctx, office, capital.Id)).of(t)
	if got.Kind != "капитальный ремонт" || len(got.Lines) != 14 || len(got.Stages) != 9 || len(got.Documents) != 7 || len(got.Checklist) != 8 || len(got.Materials) != 6 ||
		got.WarrantyMonths != 24 || got.Revision != 1 || got.UsedByObjects != 0 || got.CopiedFromId != nil {
		t.Fatalf("capital repair: %d lines, %d stages, %d documents, %d checklist, %d materials, %d months", len(got.Lines), len(got.Stages), len(got.Documents), len(got.Checklist), len(got.Materials), got.WarrantyMonths)
	}
	first := got.Lines[0]
	if first.Section != "Демонтаж" || first.Formula == nil || *first.Formula != "floor" || first.Quantity != nil {
		t.Fatalf("first line: %+v", first)
	}
	if st := got.Stages[2]; st.Name != "Штукатурка стен" || st.RatePerDay == nil || *st.RatePerDay != "12" || st.PauseDays == nil || *st.PauseDays != -3 {
		t.Fatalf("stage: %+v", st)
	}
	if got.Documents[0] != rapi.RepairDocumentKindContract || got.Documents[5] != rapi.RepairDocumentKindHandoverAct {
		t.Fatalf("documents: %v", got.Documents)
	}
	// a template of the starter set builds an estimate
	p := project(t, "Шаблоны/сборка", seedOpts{status: "draft"})
	est := must(s.EstimateFromTemplate(ctx, office, p, capital.Id)).of(t)
	if len(est.Lines) != 14 || len(est.Sections) != 5 {
		t.Fatalf("estimate of the starter template: %d lines, %v", len(est.Lines), sectionNames(est))
	}
	// the catalog is for those who keep it or estimate
	for _, who := range []string{"a.manager-msk1", "ab.member"} {
		_, err := s.Templates(ctx, as(t, who))
		wantCode(t, err, "forbidden_action", "")
		_, err = s.Template(ctx, as(t, who), capital.Id)
		wantCode(t, err, "forbidden_action", "")
	}
	_, err := s.Template(ctx, office, uuid.New())
	wantCode(t, err, "not_found", "")
}

func countSource(items []rapi.Template, src rapi.TemplateSource) int {
	n := 0
	for _, i := range items {
		if i.Source == src {
			n++
		}
	}
	return n
}

func TestUpdateTemplate(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	a := catalogItem(t, "Шаблон/А", "m2", "work", 1000)
	b := catalogItem(t, "Шаблон/Б", "piece", "material", 500)
	id := newTemplate(t, "Шаблон/Исходный", tline{section: "Полы", item: a, formula: "floor", coef: "1"})
	tpl := must(s.Template(ctx, office, id)).of(t)
	if tpl.Source != rapi.TemplateSource("own") || tpl.Revision != 1 || len(tpl.Lines) != 1 || len(tpl.Stages) != 0 || tpl.WarrantyMonths != 24 {
		t.Fatalf("template: %+v", tpl)
	}
	patch := rapi.TemplatePatch{
		Name: new(" Шаблон/Новый "),
		Lines: &[]rapi.TemplateLine{
			{PriceItemId: a, Section: "Полы", Formula: new(rapi.TemplateLineFormula("floor_dry")), Coef: new("1.05")},
			{PriceItemId: b, Section: "Материалы", Quantity: new("3")},
		},
		Materials:      &[]rapi.TemplateLine{{PriceItemId: b, Section: "Материалы", Formula: new(rapi.TemplateLineFormula("perimeter")), Coef: new("1.1")}},
		Stages:         &[]rapi.TemplateStage{{Name: "Полы", RatePerDay: new("20"), PauseDays: new(3), Sections: &[]string{"Полы"}}, {Name: "Сдача"}},
		Documents:      &[]rapi.RepairDocumentKind{rapi.RepairDocumentKindContract, rapi.RepairDocumentKindAct, rapi.RepairDocumentKindAct},
		Checklist:      &[]string{"Пол ровный", "Мусор вывезен"},
		WarrantyMonths: new(36),
	}
	up := must(s.UpdateTemplate(ctx, office, id, rev(tpl.Revision), patch)).of(t)
	if up.Name != "Шаблон/Новый" || len(up.Lines) != 2 || up.Lines[0].Coef == nil || *up.Lines[0].Coef != "1.05" || up.Lines[1].Quantity == nil || *up.Lines[1].Quantity != "3" ||
		len(up.Materials) != 1 || len(up.Stages) != 2 || up.Stages[0].Sections == nil || (*up.Stages[0].Sections)[0] != "Полы" || up.Stages[1].RatePerDay != nil ||
		len(up.Documents) != 3 || len(up.Checklist) != 2 || up.WarrantyMonths != 36 || up.Revision != tpl.Revision+1 || up.UpdatedAt.IsZero() {
		t.Fatalf("updated: %+v", up)
	}
	_, err := s.UpdateTemplate(ctx, office, id, rev(tpl.Revision), rapi.TemplatePatch{Name: new("x")})
	wantCode(t, err, "revision_mismatch", "")
	for field, p := range map[string]rapi.TemplatePatch{
		"lines[0].priceItemId":     {Lines: &[]rapi.TemplateLine{{PriceItemId: uuid.New(), Section: "П", Quantity: new("1")}}},
		"lines[1]":                 {Lines: &[]rapi.TemplateLine{{PriceItemId: a, Section: "П", Quantity: new("1")}, {PriceItemId: a, Section: "П"}}},
		"lines[0]/both":            {Lines: &[]rapi.TemplateLine{{PriceItemId: a, Section: "П", Quantity: new("1"), Formula: new(rapi.TemplateLineFormula("floor"))}}},
		"lines[0].quantity":        {Lines: &[]rapi.TemplateLine{{PriceItemId: a, Section: "П", Quantity: new("-2")}}},
		"lines[0].coef":            {Lines: &[]rapi.TemplateLine{{PriceItemId: a, Section: "П", Formula: new(rapi.TemplateLineFormula("floor")), Coef: new("0")}}},
		"lines[0].formula":         {Lines: &[]rapi.TemplateLine{{PriceItemId: a, Section: "П", Formula: new(rapi.TemplateLineFormula("volume"))}}},
		"materials[0].priceItemId": {Materials: &[]rapi.TemplateLine{{PriceItemId: uuid.New(), Section: "П", Quantity: new("1")}}},
		"stages[0].name":           {Stages: &[]rapi.TemplateStage{{Name: " "}}},
		"stages[0].ratePerDay":     {Stages: &[]rapi.TemplateStage{{Name: "С", RatePerDay: new("0")}}},
		"documents[0]":             {Documents: &[]rapi.RepairDocumentKind{"invoice2"}},
		"warrantyMonths":           {WarrantyMonths: new(121)},
		"name":                     {Name: new("   ")},
	} {
		_, err = s.UpdateTemplate(ctx, office, id, rev(up.Revision), p)
		wantField(t, err, strings.TrimSuffix(field, "/both"), "")
	}
	_, err = s.UpdateTemplate(ctx, as(t, "ab.member"), id, rev(up.Revision), rapi.TemplatePatch{Name: new("x")})
	wantCode(t, err, "forbidden_action", "")
	_, err = s.UpdateTemplate(ctx, office, uuid.New(), rev(1), rapi.TemplatePatch{Name: new("x")})
	wantCode(t, err, "not_found", "")

	// the change does not touch the objects that are built already
	p := project(t, "Шаблон/объект", seedOpts{status: "draft"})
	est := must(s.EstimateFromTemplate(ctx, office, p, id)).of(t)
	must(s.UpdateTemplate(ctx, office, id, rev(up.Revision), rapi.TemplatePatch{Lines: &[]rapi.TemplateLine{{PriceItemId: b, Section: "Новое", Quantity: new("9")}}})).of(t)
	if got := must(s.Estimate(ctx, office, p, 1)).of(t); len(got.Lines) != len(est.Lines) || got.Revision != est.Revision {
		t.Fatalf("the estimate moved with its template: %+v", got)
	}
	if n := must(s.Template(ctx, office, id)).of(t).UsedByObjects; n != 1 {
		t.Fatalf("used by objects %d", n)
	}
}

func TestCopyTemplate(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	a := catalogItem(t, "Копия/А", "m2", "work", 1000)
	src := newTemplate(t, "Копия/Исходный", tline{section: "Полы", item: a, formula: "floor", coef: "1.2"}, tline{section: "Полы", item: a, qty: "4"})
	if _, err := superA.Exec(ctx, `update repairs.templates set checklist = '{"Пол"}', documents = '{contract,act}', warranty_months = 18 where id = $1`, src); err != nil {
		t.Fatal(err)
	}
	if _, err := superA.Exec(ctx, `insert into repairs.template_stages (template_id, name, rate_per_day, pause_days, sections, sort) values ($1, 'Полы', 10, 2, '{Полы}', 0)`, src); err != nil {
		t.Fatal(err)
	}
	cp := must(s.CopyTemplate(ctx, office, src, nil)).of(t)
	if cp.Id == src || cp.Name != "Копия/Исходный (копия)" || cp.Source != rapi.TemplateSource("own") || cp.CopiedFromId == nil || *cp.CopiedFromId != src || cp.Revision != 1 ||
		len(cp.Lines) != 2 || len(cp.Stages) != 1 || len(cp.Checklist) != 1 || len(cp.Documents) != 2 || cp.WarrantyMonths != 18 || cp.SourceProjectId != nil {
		t.Fatalf("copy: %+v", cp)
	}
	if cp.Lines[0].Coef == nil || *cp.Lines[0].Coef != "1.2" || cp.Lines[1].Quantity == nil || *cp.Lines[1].Quantity != "4" {
		t.Fatalf("lines of the copy: %+v", cp.Lines)
	}
	named := must(s.CopyTemplate(ctx, office, src, new("  Свой шаблон "))).of(t)
	if named.Name != "Свой шаблон" {
		t.Fatalf("named: %q", named.Name)
	}
	// the copy is independent
	must(s.UpdateTemplate(ctx, office, cp.Id, rev(1), rapi.TemplatePatch{Lines: &[]rapi.TemplateLine{}})).of(t)
	if orig := must(s.Template(ctx, office, src)).of(t); len(orig.Lines) != 2 {
		t.Fatalf("the source changed with its copy: %+v", orig.Lines)
	}
	_, err := s.CopyTemplate(ctx, office, uuid.New(), nil)
	wantCode(t, err, "not_found", "")
	_, err = s.CopyTemplate(ctx, as(t, "ab.member"), src, nil)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.CopyTemplate(ctx, office, src, new(strings.Repeat("я", 201)))
	wantField(t, err, "name", "")
}

func TestSaveProjectAsTemplate(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	k := fieldKit(t, "Сохранить/объект")
	if _, err := superA.Exec(ctx, `update repairs.templates set checklist = '{"Пол ровный"}', documents = '{contract,handover_act}', warranty_months = 30 where id = $1`, k.template); err != nil {
		t.Fatal(err)
	}
	if _, err := superA.Exec(ctx, `insert into repairs.template_lines (template_id, part, section, price_item_id, formula, coef, sort) values ($1, 'material', 'Материалы', $2, 'walls', 0.2, 0)`, k.template, k.bags); err != nil {
		t.Fatal(err)
	}
	// the manual volume of a line becomes a fixed quantity of the template? no: the formula and its coefficient go
	tpl := must(s.SaveProjectAsTemplate(ctx, office, k.project, new("Сохранить/шаблон"))).of(t)
	if tpl.Name != "Сохранить/шаблон" || tpl.Source != rapi.TemplateSource("own") || tpl.SourceProjectId == nil || *tpl.SourceProjectId != k.project || tpl.CopiedFromId != nil ||
		len(tpl.Lines) != 3 || len(tpl.Materials) != 1 || len(tpl.Checklist) != 1 || len(tpl.Documents) != 2 || tpl.WarrantyMonths != 30 || tpl.Revision != 1 {
		t.Fatalf("saved: %+v", tpl)
	}
	var plaster, trips *rapi.TemplateLine
	for i := range tpl.Lines {
		switch tpl.Lines[i].PriceItemId {
		case k.plaster:
			plaster = &tpl.Lines[i]
		case k.trips:
			trips = &tpl.Lines[i]
		}
	}
	if plaster == nil || plaster.Formula == nil || *plaster.Formula != "walls_dry" || plaster.Section != "Стены" || trips == nil || trips.Quantity == nil || *trips.Quantity != "2" || trips.Formula != nil {
		t.Fatalf("lines: %+v", tpl.Lines)
	}
	// the default name is the name of the object
	if d := must(s.SaveProjectAsTemplate(ctx, office, k.project, nil)).of(t); d.Name != "Сохранить/объект" {
		t.Fatalf("default name %q", d.Name)
	}
	// no estimate in force — no template
	bare := project(t, "Сохранить/без сметы", seedOpts{status: "draft"})
	_, err := s.SaveProjectAsTemplate(ctx, office, bare, nil)
	wantReason(t, err, "repair_estimate_not_approved")
	_, err = s.SaveProjectAsTemplate(ctx, office, uuid.New(), nil)
	wantCode(t, err, "not_found", "")
	_, err = s.SaveProjectAsTemplate(ctx, as(t, "ab.member"), k.project, nil)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.SaveProjectAsTemplate(ctx, as(t, "a.manager-msk1"), k.project, nil) // the foreman does not keep templates
	wantCode(t, err, "forbidden_action", "")
}
