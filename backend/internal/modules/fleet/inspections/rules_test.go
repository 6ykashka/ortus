package inspections

import (
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func TestPhotoRoles(t *testing.T) {
	t.Parallel()
	for api, db := range map[string]string{"front": "front", "rear": "back", "left": "left", "right": "right", "odometer": "odometer", "cargo": "cargo"} {
		got, ok := storedRole(api)
		if !ok || got != db {
			t.Errorf("storedRole(%q) = %q, %v; want %q", api, got, ok, db)
		}
		if back := apiRole(db); back != api {
			t.Errorf("apiRole(%q) = %q, want %q", db, back, api)
		}
	}
	if _, ok := storedRole("damage"); ok {
		t.Error("damage has no row of fleet.inspection_photos: one per role, kept in answers")
	}
	if _, ok := storedRole("interior"); ok {
		t.Error("interior is not a role of the contract")
	}
}

func TestFuelLevel(t *testing.T) {
	t.Parallel()
	for percent, want := range map[int]string{0: "quarter", 25: "quarter", 37: "quarter", 38: "half", 50: "half", 62: "half", 63: "three_quarters", 87: "three_quarters", 88: "full", 100: "full"} {
		if got := fuelLevel(percent); got != want {
			t.Errorf("fuelLevel(%d) = %q, want %q", percent, got, want)
		}
	}
}

func TestPlural(t *testing.T) {
	t.Parallel()
	for n, want := range map[int]string{1: "пункт", 2: "пункта", 4: "пункта", 5: "пунктов", 11: "пунктов", 12: "пунктов", 21: "пункт", 22: "пункта", 25: "пунктов", 111: "пунктов"} {
		if got := plural(n, "пункт", "пункта", "пунктов"); got != want {
			t.Errorf("plural(%d) = %q, want %q", n, got, want)
		}
	}
}

func TestBuiltinChecklists(t *testing.T) {
	t.Parallel()
	dep := builtinChecklist(kindDeparture)
	if dep.ID != checklistID(kindDeparture, 1) || dep.Version != 1 || dep.Kind != kindDeparture {
		t.Fatalf("departure checklist %+v", dep)
	}
	keys := func(c checklist) []string {
		out := []string{}
		for _, it := range c.Items {
			out = append(out, it.Key+":"+it.Label)
			if !it.Required || it.FailureBlocksRelease {
				t.Errorf("item %+v: every built-in item is required and does not block release", it)
			}
		}
		return out
	}
	// DEP_CHECKS and RET_CHECKS of models.js (fleetrules W2.01), PHOTO_SIDES as roles of the contract.
	if got := keys(dep); !slices.Equal(got, []string{"body:Кузов и стёкла осмотрены", "tires:Шины и световые приборы исправны", "docs:Документы и комплект на месте"}) {
		t.Errorf("departure items %v", got)
	}
	ret := builtinChecklist(kindReturn)
	if got := keys(ret); !slices.Equal(got, []string{"cargo:Груз выгружен полностью", "personal:Личные вещи забраны", "keys:Ключи и документы на месте"}) {
		t.Errorf("return items %v", got)
	}
	want := []string{"front", "rear", "left", "right", "odometer"}
	if !slices.Equal(dep.Roles, want) || !slices.Equal(ret.Roles, want) {
		t.Errorf("roles %v / %v, want %v", dep.Roles, ret.Roles, want)
	}
	if checklistID(kindDeparture, 1) == checklistID(kindReturn, 1) || checklistID(kindDeparture, 1) == checklistID(kindDeparture, 2) {
		t.Error("checklist ids must differ by kind and version")
	}
}

func photo(role string) fleetapi.InspectionPhoto {
	return fleetapi.InspectionPhoto{Role: fleetapi.InspectionPhotoRole(role), FileId: uuid.New(), CapturedAt: time.Now()}
}

func check(key string) fleetapi.InspectionCheck {
	return fleetapi.InspectionCheck{Key: key, Result: "pass"}
}

// inspMissing of models.js: «N фото», «N пунктов чек-листа»; the fields odometer and fuel are required by the
// contract and checked as fields.
func TestMissing(t *testing.T) {
	t.Parallel()
	dep := builtinChecklist(kindDeparture)
	all := []fleetapi.InspectionPhoto{photo("front"), photo("rear"), photo("left"), photo("right"), photo("odometer")}
	checks := []fleetapi.InspectionCheck{check("body"), check("tires"), check("docs")}
	cases := []struct {
		name   string
		photos []fleetapi.InspectionPhoto
		checks []fleetapi.InspectionCheck
		want   []string
	}{
		{"всё есть", all, checks, nil},
		{"4 фото из 5", all[:4], checks, []string{"1 фото"}},
		{"фото повреждения не заменяет ракурс", append(slices.Clone(all[:4]), photo("damage")), checks, []string{"1 фото"}},
		{"нет пунктов", all, checks[:1], []string{"2 пункта чек-листа"}},
		{"ничего", nil, nil, []string{"5 фото", "3 пункта чек-листа"}},
		{"пункт с другим ключом не засчитан", all, []fleetapi.InspectionCheck{check("body"), check("tires"), check("cargo")}, []string{"1 пункт чек-листа"}},
	}
	for _, c := range cases {
		if got := missing(dep, c.photos, c.checks); !slices.Equal(got, c.want) {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
	if got := incompleteDetail(kindDeparture, []string{"1 фото"}); got != "Осмотр не завершён: 1 фото" {
		t.Errorf("departure detail %q", got)
	}
	if got := incompleteDetail(kindReturn, []string{"1 фото", "2 пункта чек-листа"}); got != "Сдача не завершена: 1 фото, 2 пункта чек-листа" {
		t.Errorf("return detail %q", got)
	}
}

func TestOdometer(t *testing.T) {
	t.Parallel()
	for _, s := range []string{"48210", "0", "48210.5", "123456789.125"} {
		if _, err := parseQuantity(s); err != nil {
			t.Errorf("parseQuantity(%q): %v", s, err)
		}
	}
	for _, s := range []string{"", "-1", "1e3", "12,5", "abc", " 1", "1.2345", "1234567890"} {
		if _, err := parseQuantity(s); err == nil {
			t.Errorf("parseQuantity(%q) accepted", s)
		}
	}
	if err := checkOdometer("48100", 48210); !problem.Is(err, codeOdometerDecrease) || !strings.Contains(err.Error(), "Пробег не может быть меньше 48") {
		t.Errorf("decrease: %v", err)
	}
	if err := checkOdometer("48210", 48210); err != nil {
		t.Errorf("equal: %v", err)
	}
	if err := checkOdometer("99999", 48210); err != nil {
		t.Errorf("more than +3000 is a warning of the form, not an error: %v", err)
	}
	if err := checkOdometer("x", 0); !problem.Is(err, codeValidation) {
		t.Errorf("not a number: %v", err)
	}
}

func validCreate(kind string) fleetapi.InspectionCreate {
	id := uuid.New()
	b := fleetapi.InspectionCreate{
		ChecklistVersionId: uuid.New(), VehicleId: uuid.New(), Kind: fleetapi.InspectionCreateKind(kind), OdometerKm: "48210",
		FuelPercent: 75, Checks: []fleetapi.InspectionCheck{check("body")}, Photos: []fleetapi.InspectionPhoto{photo("front")},
		CapturedAt: time.Now(),
	}
	if kind == kindDeparture {
		b.ReservationId = &id
	} else {
		b.TripId = &id
	}
	return b
}

func TestValidateCreate(t *testing.T) {
	t.Parallel()
	if err := validateCreate(validCreate(kindDeparture)); err != nil {
		t.Fatalf("valid departure: %v", err)
	}
	if err := validateCreate(validCreate(kindReturn)); err != nil {
		t.Fatalf("valid return: %v", err)
	}
	long := strings.Repeat("я", 2001)
	cases := []struct {
		name   string
		mutate func(*fleetapi.InspectionCreate)
		detail string
	}{
		{"вид", func(b *fleetapi.InspectionCreate) { b.Kind = "other" }, ""},
		{"выезд без брони", func(b *fleetapi.InspectionCreate) { b.ReservationId = nil }, "Осмотр перед выездом оформляется по брони."},
		{"топливо", func(b *fleetapi.InspectionCreate) { b.FuelPercent = 101 }, ""},
		{"нет пунктов", func(b *fleetapi.InspectionCreate) { b.Checks = nil }, ""},
		{"результат пункта", func(b *fleetapi.InspectionCreate) { b.Checks[0].Result = "maybe" }, ""},
		{"нет фото", func(b *fleetapi.InspectionCreate) { b.Photos = nil }, ""},
		{"ракурс", func(b *fleetapi.InspectionCreate) { b.Photos[0].Role = "top" }, ""},
		{"ракурс дважды", func(b *fleetapi.InspectionCreate) { b.Photos = append(b.Photos, photo("front")) }, ""},
		{"комментарий", func(b *fleetapi.InspectionCreate) { b.Comment = new(long) }, ""},
		{"зона дефекта", func(b *fleetapi.InspectionCreate) {
			b.Defects = &[]fleetapi.InspectionDefectReport{{Zone: " ", Description: "Скол", Severity: "minor"}}
		}, ""},
		{"описание дефекта", func(b *fleetapi.InspectionCreate) {
			b.Defects = &[]fleetapi.InspectionDefectReport{{Zone: "Кузов", Description: long, Severity: "minor"}}
		}, ""},
		{"критичность", func(b *fleetapi.InspectionCreate) {
			b.Defects = &[]fleetapi.InspectionDefectReport{{Zone: "Кузов", Description: "Скол", Severity: "fatal"}}
		}, ""},
	}
	for _, c := range cases {
		b := validCreate(kindDeparture)
		c.mutate(&b)
		err := validateCreate(b)
		if !problem.Is(err, codeValidation) {
			t.Errorf("%s: %v, want validation_failed", c.name, err)
			continue
		}
		if c.detail != "" && !strings.Contains(err.Error(), c.detail) {
			t.Errorf("%s: %v, want %q", c.name, err, c.detail)
		}
	}
	ret := validCreate(kindReturn)
	ret.TripId = nil
	if err := validateCreate(ret); !problem.Is(err, codeValidation) || !strings.Contains(err.Error(), "Осмотр при сдаче оформляется по рейсу.") {
		t.Errorf("return without trip: %v", err)
	}
	ret = validCreate(kindReturn)
	ret.Defects = &[]fleetapi.InspectionDefectReport{{Zone: "Кузов", Description: "Вмятина", Severity: "blocking"}}
	if err := validateCreate(ret); !problem.Is(err, codeValidation) || !strings.Contains(err.Error(), "Критичность дефекта выбирается только перед выездом.") {
		t.Errorf("blocking on return: %v", err)
	}
	dep := validCreate(kindDeparture)
	dep.Photos = append(dep.Photos, photo("damage"), photo("damage"))
	if err := validateCreate(dep); err != nil {
		t.Errorf("several damage photos are allowed: %v", err)
	}
}

// AC-04: five photos are five files — one file on two roles (or on a role and a damage) is 422, whatever the roles.
func TestValidatePhotosOneFileOnce(t *testing.T) {
	t.Parallel()
	const sameFile = "Одно фото прикреплено дважды. Сделайте отдельный снимок."
	for _, roles := range [][2]string{{"front", "rear"}, {"left", "odometer"}, {"front", "damage"}, {"damage", "damage"}} {
		b := validCreate(kindDeparture)
		first, second := photo(roles[0]), photo(roles[1])
		second.FileId = first.FileId
		b.Photos = []fleetapi.InspectionPhoto{first, second}
		err := validateCreate(b)
		if !problem.Is(err, codeValidation) || !strings.Contains(err.Error(), sameFile) {
			t.Errorf("%s and %s of one file: %v, want validation_failed %q", roles[0], roles[1], err, sameFile)
		}
	}
}

func TestInspectionStatus(t *testing.T) {
	t.Parallel()
	cases := []struct {
		state     string
		confirmed bool
		want      fleetapi.InspectionStatus
	}{
		{"submitted", false, "submitted"},
		{"approved", false, "approved"},
		{"blocked", false, "requires_review"},
		{"blocked", true, "rejected"},
	}
	for _, c := range cases {
		if got := inspectionStatus(c.state, c.confirmed); got != c.want {
			t.Errorf("inspectionStatus(%q, %v) = %q, want %q", c.state, c.confirmed, got, c.want)
		}
	}
}

func TestNotificationTitles(t *testing.T) {
	t.Parallel()
	if got := blockingTitle("Газель Next", "М 608 КТ 77", "Шины и колёса"); got != "Критический дефект: Газель Next М 608 КТ 77 — Шины и колёса. Выезд заблокирован." {
		t.Errorf("blocking %q", got)
	}
	if got := blockingTitle("", "М 608 КТ 77", "Кузов"); got != "Критический дефект: М 608 КТ 77 — Кузов. Выезд заблокирован." {
		t.Errorf("blocking without a name %q", got)
	}
	if allowTitle != "Менеджер разрешил выезд: дефект признан некритичным" {
		t.Errorf("allow %q", allowTitle)
	}
	if got := confirmTitle("Р-208"); got != "Неисправность подтверждена. Выберите другую машину для рейса Р-208" {
		t.Errorf("confirm %q", got)
	}
}

func TestCursor(t *testing.T) {
	t.Parallel()
	at, id := time.Date(2026, 10, 1, 7, 0, 0, 123456000, time.UTC), uuid.New()
	raw := encodeCursor(at, id, "bind")
	gotAt, gotID, err := decodeCursor(raw, "bind")
	if err != nil || !gotAt.Equal(at) || gotID != id {
		t.Fatalf("round trip: %v %v %v", gotAt, gotID, err)
	}
	if _, _, err := decodeCursor(raw, "other"); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("foreign binding: %v", err)
	}
	if _, _, err := decodeCursor("%%%", "bind"); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("garbage: %v", err)
	}
	if binding("a", "b") == binding("a", "c") {
		t.Error("binding must depend on every part")
	}
}

func TestDecisionInput(t *testing.T) {
	t.Parallel()
	if err := validateDecision(fleetapi.DefectDecision{Decision: "allow_departure"}); err != nil {
		t.Errorf("allow: %v", err)
	}
	if err := validateDecision(fleetapi.DefectDecision{Decision: "confirm_out_of_service", Comment: new("Шина порвана")}); err != nil {
		t.Errorf("confirm: %v", err)
	}
	if err := validateDecision(fleetapi.DefectDecision{Decision: "repair"}); !problem.Is(err, codeValidation) {
		t.Errorf("unknown decision: %v", err)
	}
	if err := validateDecision(fleetapi.DefectDecision{Decision: "allow_departure", Comment: new(strings.Repeat("я", 2001))}); !problem.Is(err, codeValidation) {
		t.Errorf("long comment: %v", err)
	}
}

func TestCheckRevision(t *testing.T) {
	t.Parallel()
	if err := checkRevision(`"3"`, 3); err != nil {
		t.Errorf("current: %v", err)
	}
	if err := checkRevision("", 3); !problem.Is(err, codeRevisionRequired) {
		t.Errorf("missing: %v", err)
	}
	for _, v := range []string{`"2"`, "*", `W/"3"`, "3"} {
		if err := checkRevision(v, 3); !problem.Is(err, codeRevisionMismatch) {
			t.Errorf("%q: %v", v, err)
		}
	}
	if etag(7) != `"7"` {
		t.Errorf("etag %q", etag(7))
	}
}
