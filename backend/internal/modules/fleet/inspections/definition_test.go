package inspections

import (
	"encoding/json"
	"errors"
	"slices"
	"strings"
	"testing"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// holds fails the test at the first false check, printing what was checked.
func holds(t *testing.T, what string, got any, checks ...bool) {
	t.Helper()
	for i, ok := range checks {
		if !ok {
			t.Fatalf("%s: check %d of %d failed: %+v", what, i+1, len(checks), got)
		}
	}
}

func marshal(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func fieldKeys(fields []fleetapi.FormField) []string {
	out := []string{}
	for _, f := range fields {
		out = append(out, f.Key+":"+string(f.Type)+":"+f.Label)
	}
	return out
}

// The built-in version as a form (D-30 комплекта, InspectionChecklist.definition): «Осмотр перед выездом», the items
// — required single_choice pass/fail/not_applicable, then the photo roles — required file fields photo_<role>.
func TestChecklistDefinition(t *testing.T) {
	t.Parallel()
	dep := checklistDefinition(builtinChecklist(kindDeparture))
	holds(t, "departure form", dep, dep.Title == "Осмотр перед выездом", dep.Description == "", dep.ConfirmationText == "",
		dep.Visibility != nil, len(dep.Visibility) == 0)
	ret := checklistDefinition(builtinChecklist(kindReturn))
	holds(t, "return form", ret, ret.Title == "Осмотр при сдаче", ret.Fields[0].Key == "cargo")
	want := []string{
		"body:single_choice:Кузов и стёкла осмотрены", "tires:single_choice:Шины и световые приборы исправны",
		"docs:single_choice:Документы и комплект на месте", "photo_front:file:Спереди", "photo_rear:file:Сзади",
		"photo_left:file:Слева", "photo_right:file:Справа", "photo_odometer:file:Одометр",
	}
	holds(t, "fields", fieldKeys(dep.Fields), slices.Equal(fieldKeys(dep.Fields), want),
		!slices.ContainsFunc(dep.Fields, func(f fleetapi.FormField) bool { return !f.Required }))
	body := dep.Fields[0]
	holds(t, "item field", body, body.Options != nil, body.BlockingValues == nil, body.MaxFiles == nil)
	holds(t, "options", *body.Options, slices.Equal(*body.Options, []fleetapi.ChoiceOption{
		{Key: "pass", Label: "Исправно"}, {Key: "fail", Label: "Неисправно"}, {Key: "not_applicable", Label: "Не применимо"},
	}))
	front := dep.Fields[3]
	holds(t, "photo field", front, front.MaxFiles != nil, front.MaxFileBytes != nil, front.AllowedMimeTypes != nil, front.Options == nil)
	holds(t, "photo limits", front, *front.MaxFiles == 1, *front.MaxFileBytes == 20971520,
		slices.Equal(*front.AllowedMimeTypes, []string{"image/jpeg"}))
}

// failureBlocksRelease → blockingValues [fail]; the roles cargo and damage are fields «Груз», «Повреждение».
func TestChecklistDefinitionBlockingAndRoles(t *testing.T) {
	t.Parallel()
	c := builtinChecklist(kindDeparture)
	c.Items[1].FailureBlocksRelease = true
	c.Roles = append(c.Roles, roleCargo, roleDamage)
	def := checklistDefinition(c)
	tires := def.Fields[1]
	holds(t, "blocking item", tires, tires.BlockingValues != nil)
	holds(t, "blockingValues", *tires.BlockingValues, slices.Equal(*tires.BlockingValues, []string{"fail"}))
	holds(t, "cargo and damage", def.Fields, len(def.Fields) == 10, def.Fields[8].Label == "Груз", def.Fields[9].Label == "Повреждение")
}

// A version is read from its definition: the definition of a version gives back its items and roles.
func TestParseDefinitionRoundTrip(t *testing.T) {
	t.Parallel()
	for _, kind := range []string{kindDeparture, kindReturn} {
		c := builtinChecklist(kind)
		c.Items[2].Required = false
		c.Items[0].FailureBlocksRelease = true
		form, items, roles, err := parseDefinition(marshal(t, checklistDefinition(c)))
		if err != nil {
			t.Fatalf("%s: %v", kind, err)
		}
		holds(t, kind+" version", items, form.Title != "", len(form.Fields) == 8, slices.Equal(roles, c.Roles), len(items) == 3)
		for i, it := range items {
			w := c.Items[i]
			holds(t, kind+" item", it, it.Key == w.Key, it.Label == w.Label, it.Required == w.Required,
				it.FailureBlocksRelease == w.FailureBlocksRelease, len(it.Options) == 3)
		}
		holds(t, kind+" blocking", items, slices.Equal(items[0].Blocking, []string{"fail"}), items[1].Blocking == nil)
	}
}

// A definition the inspection cannot be written by (W2.45, Q-W2.52-21: the schema FormDefinition and the rules of a
// checklist) is not a checklist form: the version is read by its items.
func TestParseDefinitionRejects(t *testing.T) {
	t.Parallel()
	base := func() fleetapi.FormDefinition {
		c := builtinChecklist(kindDeparture)
		c.Items[0].FailureBlocksRelease = true
		d := checklistDefinition(c)
		if len(d.Fields) != 8 {
			t.Fatalf("the built-in form has 3 items and 5 photos: %+v", d)
		}
		return d
	}
	// The fields of the built-in form: 0 body (blocking), 1 tires, 2 docs, 3 photo_front, 4 photo_rear, 5 photo_left.
	cases := []struct {
		name   string
		mutate func(*fleetapi.FormDefinition)
	}{
		{"нет заголовка", func(d *fleetapi.FormDefinition) { d.Title = "" }},
		{"длинный заголовок", func(d *fleetapi.FormDefinition) { d.Title = strings.Repeat("я", 201) }},
		{"нет полей", func(d *fleetapi.FormDefinition) { d.Fields = []fleetapi.FormField{} }},
		{"только фото", func(d *fleetapi.FormDefinition) { d.Fields = d.Fields[3:] }},
		{"ключ не по шаблону", func(d *fleetapi.FormDefinition) { d.Fields[0].Key = "Body" }},
		{"дубль ключа", func(d *fleetapi.FormDefinition) { d.Fields[1].Key = "body" }},
		{"пустая подпись", func(d *fleetapi.FormDefinition) { d.Fields[0].Label = "" }},
		{"чужой тип", func(d *fleetapi.FormDefinition) { d.Fields[0].Type = "text" }},
		{"нет вариантов", func(d *fleetapi.FormDefinition) { d.Fields[0].Options = nil }},
		{"вариант вне результатов", func(d *fleetapi.FormDefinition) {
			d.Fields[0].Options = &[]fleetapi.ChoiceOption{{Key: "pass", Label: "Да"}, {Key: "broken", Label: "Сломано"}}
		}},
		{"дубль варианта", func(d *fleetapi.FormDefinition) {
			d.Fields[0].Options = &[]fleetapi.ChoiceOption{{Key: "pass", Label: "Да"}, {Key: "pass", Label: "Да"}}
		}},
		{"блокирует не вариант", func(d *fleetapi.FormDefinition) {
			d.Fields[0].Options = &[]fleetapi.ChoiceOption{{Key: "pass", Label: "Да"}, {Key: "not_applicable", Label: "Нет"}}
		}},
		{"условия видимости", func(d *fleetapi.FormDefinition) {
			d.Visibility = []fleetapi.FieldVisibility{{FieldKey: "docs", Conditions: []fleetapi.VisibilityCondition{{SourceFieldKey: "body", Operator: "equals"}}}}
		}},
		{"фото не photo_<роль>", func(d *fleetapi.FormDefinition) { d.Fields[3].Key = "photo_top" }},
		{"фото без ограничений", func(d *fleetapi.FormDefinition) { d.Fields[5].MaxFileBytes = nil }},
		{"фото без типов", func(d *fleetapi.FormDefinition) { d.Fields[5].AllowedMimeTypes = nil }},
		{"блокирующее фото", func(d *fleetapi.FormDefinition) { d.Fields[5].BlockingValues = &[]string{"fail"} }},
	}
	for _, c := range cases {
		d := base()
		c.mutate(&d)
		if _, _, _, err := parseDefinition(marshal(t, d)); !errors.Is(err, errNotChecklistForm) {
			t.Errorf("%s: %v, want errNotChecklistForm", c.name, err)
		}
	}
	for name, raw := range map[string]string{
		"не JSON":          "not json",
		"не объект":        `[]`,
		"лишнее свойство":  `{"title":"Осмотр","description":"","fields":[],"visibility":[],"confirmationText":"","x":1}`,
		"поля не массив":   `{"title":"Осмотр","fields":{}}`,
		"пустое (0017 ок)": `{"title":"Осмотр","fields":[]}`,
	} {
		if _, _, _, err := parseDefinition([]byte(raw)); !errors.Is(err, errNotChecklistForm) {
			t.Errorf("%s: %v, want errNotChecklistForm", name, err)
		}
	}
}

// A narrower item and an optional photo are a checklist form: the item takes its own options, the photo is allowed
// but not required.
func TestParseDefinitionNarrow(t *testing.T) {
	t.Parallel()
	d := checklistDefinition(builtinChecklist(kindDeparture))
	d.Fields[1].Options = &[]fleetapi.ChoiceOption{{Key: "pass", Label: "Да"}, {Key: "fail", Label: "Нет"}}
	d.Fields[7].Required = false // photo_odometer
	_, items, roles, err := parseDefinition(marshal(t, d))
	if err != nil {
		t.Fatal(err)
	}
	holds(t, "narrow item and optional photo", roles, len(items[1].Options) == 2,
		slices.Equal(roles, []string{"front", "rear", "left", "right"}))
}

var (
	legacyItems = []byte(`[{"key":"body","label":"Кузов","required":true},{"key":"lights","label":"Фары","required":false,"failureBlocksRelease":true}]`)
	legacyRoles = []string{"front", "back", "interior", "odometer"}
)

// Backward compatibility: a version is read by its definition when that is a checklist form, otherwise by its items
// and required_photo_roles (tenant 0002: back, interior) without a definition.
func TestReadVersion(t *testing.T) {
	t.Parallel()
	def := checklistDefinition(checklist{Kind: kindDeparture, Items: []checkItem{{Key: "glass", Label: "Стёкла", Required: true}},
		Roles: []string{roleFront}})
	c, err := readVersion(checklist{Kind: kindDeparture}, legacyItems, legacyRoles, marshal(t, def))
	if err != nil {
		t.Fatal(err)
	}
	holds(t, "by the definition", c, c.Definition != nil, len(c.Items) == 1, c.Items[0].Key == "glass",
		slices.Equal(c.Roles, []string{"front"}))
	c, err = readVersion(checklist{Kind: kindDeparture}, legacyItems, legacyRoles, []byte(`{"title":"Осмотр","fields":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	holds(t, "by the items", c, c.Definition == nil, len(c.Items) == 2, c.Items[1].Key == "lights", c.Items[1].FailureBlocksRelease,
		slices.Equal(c.Items[1].Blocking, []string{"fail"}), len(c.Items[0].Options) == 3,
		slices.Equal(c.Roles, []string{"front", "rear", "odometer"}))
	if _, err := readVersion(checklist{}, []byte("not json"), nil, []byte("not json")); err == nil {
		t.Error("neither a definition nor items: an error")
	}
}

// InspectionChecklist carries the definition of a version read by it, and none of a version read by its items.
func TestChecklistDTODefinition(t *testing.T) {
	t.Parallel()
	c, err := readVersion(checklist{Kind: kindDeparture}, legacyItems, legacyRoles, nil)
	if err != nil {
		t.Fatal(err)
	}
	dto := checklistDTO(c)
	holds(t, "dto of a version by its items", dto, dto.Definition == nil, len(dto.Items) == 2, len(dto.RequiredPhotoRoles) == 3)
	b := builtinChecklist(kindDeparture)
	form := checklistDefinition(b)
	b.Definition = &form
	dto = checklistDTO(b)
	holds(t, "dto carries the definition", dto, dto.Definition != nil)
	holds(t, "title", dto.Definition, dto.Definition.Title == "Осмотр перед выездом")
}

func narrowChecklist() checklist {
	c := builtinChecklist(kindDeparture)
	c.Items[0].Options = []fleetapi.ChoiceOption{{Key: "pass", Label: "Исправно"}, {Key: "fail", Label: "Неисправно"}}
	c.Items[1].Blocking = []string{"fail"}
	c.Items[1].FailureBlocksRelease = true
	return c
}

// The answers are checked against the version: an item of another version is 422, a result the item does not take 422.
func TestCheckAnswers(t *testing.T) {
	t.Parallel()
	c := narrowChecklist()
	if err := checkAnswers(c, []fleetapi.InspectionCheck{check("body"), check("tires"), {Key: "docs", Result: "not_applicable"}}); err != nil {
		t.Fatalf("valid answers: %v", err)
	}
	cases := []struct {
		name   string
		checks []fleetapi.InspectionCheck
		detail string
	}{
		{"пункт другой версии", []fleetapi.InspectionCheck{check("body"), check("cargo")}, "Неверный пункт чек-листа."},
		{"результат вне вариантов", []fleetapi.InspectionCheck{{Key: "body", Result: "not_applicable"}}, "Для пункта «Кузов и стёкла осмотрены» такого результата нет."},
	}
	for _, tc := range cases {
		err := checkAnswers(c, tc.checks)
		if !problem.Is(err, codeValidation) || !strings.Contains(err.Error(), tc.detail) {
			t.Errorf("%s: %v, want validation_failed %q", tc.name, err, tc.detail)
		}
	}
}

// A blocking answer before departure does not release the vehicle (FormField.blockingValues): a blocking defect of
// the item goes to the queue (S2-17) unless the driver reported a blocking defect of the same zone.
func TestBlockingDefects(t *testing.T) {
	t.Parallel()
	const zone = "Шины и световые приборы исправны"
	c := narrowChecklist()
	fail := []fleetapi.InspectionCheck{check("body"), {Key: "tires", Result: "fail"}, check("docs")}
	got := blockingDefects(c, kindDeparture, fail, nil)
	holds(t, "defect of a blocking answer", got, len(got) == 1)
	holds(t, "defect", got[0], got[0].Zone == zone, got[0].Severity == severityBlocking, got[0].Description == "Неисправно: "+zone)
	fail[1].Comment = new("Не горит левая фара")
	got = blockingDefects(c, kindDeparture, fail, nil)
	holds(t, "the comment of the item describes the defect", got, len(got) == 1)
	holds(t, "description", got[0], got[0].Description == "Не горит левая фара")
	cases := []struct {
		name     string
		kind     string
		checks   []fleetapi.InspectionCheck
		reported []fleetapi.InspectionDefectReport
		want     int
	}{
		{"критический дефект зоны уже отмечен", kindDeparture, fail, []fleetapi.InspectionDefectReport{{Zone: zone, Description: "Порез", Severity: severityBlocking}}, 0},
		{"некритичный дефект зоны не заменяет ответ", kindDeparture, fail, []fleetapi.InspectionDefectReport{{Zone: zone, Description: "Скол", Severity: "minor"}}, 1},
		{"при сдаче критичность не выбирается", kindReturn, fail, nil, 0},
		{"fail пункта без blockingValues", kindDeparture, []fleetapi.InspectionCheck{{Key: "body", Result: "fail"}}, nil, 0},
	}
	for _, tc := range cases {
		if got := blockingDefects(c, tc.kind, tc.checks, tc.reported); len(got) != tc.want {
			t.Errorf("%s: %+v, want %d", tc.name, got, tc.want)
		}
	}
	long := c
	long.Items = slices.Clone(c.Items)
	long.Items[1].Label = strings.Repeat("я", 300)
	got = blockingDefects(long, kindDeparture, fail[1:2:2], nil)
	holds(t, "the zone is cut to 100 characters", got, len(got) == 1)
	holds(t, "zone", got[0].Zone, len([]rune(got[0].Zone)) == maxZone)
}
