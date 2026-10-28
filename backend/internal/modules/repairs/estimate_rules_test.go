package repairs

import (
	"bytes"
	"testing"

	"github.com/google/uuid"
)

// The rules of the measurement and of the estimate (W6.12) that need no database: the totals of the rooms, the volumes
// by the formulas of a template, the rounding of a line, the discount, the comparison of two versions by the key of the
// line and the code of the signature by SMS.

func sampleRooms() []room {
	return []room{
		{Name: "Кухня", LengthM: 4000, WidthM: 3000, HeightM: 2500, OpeningsM2: 2000},
		{Name: "Санузел", LengthM: 2000, WidthM: 1500, HeightM: 2500, OpeningsM2: 1600, Wet: true},
	}
}

func TestMeasureRooms(t *testing.T) {
	t.Parallel()
	got := measureRooms(sampleRooms())
	want := totals{floor: 15_000_000, walls: 48_900_000, perimeter: 21_000_000, wetFloor: 3_000_000, wetWalls: 15_900_000, wetPerimeter: 7_000_000}
	if got != want {
		t.Fatalf("totals %+v, want %+v", got, want)
	}
	// the openings never make a negative wall
	if w := measureRooms([]room{{Name: "Ниша", LengthM: 1000, WidthM: 1000, HeightM: 1000, OpeningsM2: 99_000}}); w.walls != 0 {
		t.Fatalf("walls of a niche %d, want 0", w.walls)
	}
	if got := measureRooms(nil); got != (totals{}) {
		t.Fatalf("no rooms: %+v", got)
	}
}

func TestWetRoom(t *testing.T) {
	t.Parallel()
	for name, want := range map[string]bool{"Санузел": true, "  санузел 2": true, "САНУЗЕЛ": true, "Кухня": false, "Ванная": false, "Гостевой санузел": false} {
		if got := wetByName(name); got != want {
			t.Errorf("wetByName(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestFormulaValue(t *testing.T) {
	t.Parallel()
	tt := measureRooms(sampleRooms())
	for f, want := range map[string]micro{
		"floor": 15_000_000, "floor_dry": 12_000_000, "walls": 48_900_000, "walls_dry": 33_000_000,
		"wet": 18_900_000, "perimeter": 21_000_000, "perimeter_dry": 14_000_000,
	} {
		got, ok := formulaValue(f, tt)
		if !ok || got != want {
			t.Errorf("formula %s = %d (%v), want %d", f, got, ok, want)
		}
	}
	if _, ok := formulaValue("volume", tt); ok {
		t.Error("an unknown formula is accepted")
	}
}

func TestVolume(t *testing.T) {
	t.Parallel()
	tt := measureRooms(sampleRooms())
	for _, c := range []struct {
		name, formula, unit string
		coef                milli
		want                milli
	}{
		{"area to a tenth, half up", "floor", "m2", 1070, 16_100},              // 15 × 1.07 = 16.05
		{"area as is", "walls_dry", "m2", 1000, 33_000},                        // 33.0
		{"bags round up", "walls_dry", "mesh", 400, 14_000},                    // 13.2 → 14
		{"an exact integer is not bumped", "floor_dry", "piece", 1000, 12_000}, // 12 → 12
		{"liters round up", "walls", "liter", 200, 10_000},                     // 9.78 → 10
		{"metres to a tenth", "perimeter_dry", "m", 1050, 14_700},              // 14.7
		{"wet rooms with a reserve", "wet", "m2", 1100, 20_800},                // 18.9 × 1.1 = 20.79 → 20.8
		{"set rounds up", "perimeter", "set", 1000, 21_000},
		{"trip rounds up", "floor", "trip", 1010, 16_000}, // 15.15 → 16
	} {
		if got := volume(c.formula, c.coef, c.unit, tt); got != c.want {
			t.Errorf("%s: %s × %s %s = %s, want %s", c.name, c.formula, c.coef, c.unit, got, c.want)
		}
	}
	if got := volume("floor", 1000, "m2", totals{}); got != 0 {
		t.Errorf("volume of an empty measurement %s", got)
	}
}

func TestLineSumAndTotal(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		price int64
		qty   milli
		want  int64
	}{
		{65_000, 46_820, 3_043_300},
		{12_345, 333, 4_111}, // 4110.885 → 4111
		{100, 5, 1},          // 0.5 → 1
		{100, 4, 0},          // 0.4 → 0
		{0, 10_000, 0},
		{9_007_199_254_740_991, 1_000, 9_007_199_254_740_991},
	} {
		got, ok := lineSum(c.price, c.qty)
		if !ok || got != c.want {
			t.Errorf("lineSum(%d, %s) = %d (%v), want %d", c.price, c.qty, got, ok, c.want)
		}
	}
	if _, ok := lineSum(9_007_199_254_740_991, 2_000); ok {
		t.Error("a sum above the integer range of the contract is accepted")
	}
	sub, discount, total := estimateTotal([]int64{600_000, 400_001}, 10)
	if sub != 1_000_001 || discount != 100_000 || total != 900_001 {
		t.Errorf("total %d %d %d", sub, discount, total)
	}
	if _, d, tot := estimateTotal([]int64{5}, 10); d != 1 || tot != 4 { // 0.5 → 1 half up
		t.Errorf("discount of 5 kopecks: %d %d", d, tot)
	}
	if sub, d, tot := estimateTotal(nil, 50); sub != 0 || d != 0 || tot != 0 {
		t.Errorf("empty estimate: %d %d %d", sub, d, tot)
	}
}

func TestDiffLines(t *testing.T) {
	t.Parallel()
	x, y, z, w, v := uuid.New(), uuid.New(), uuid.New(), uuid.New(), uuid.New()
	a := []lineVer{{key: x, name: "Стяжка", qty: 10_000, price: 100, sum: 1000}, {key: y, name: "Плитка", qty: 5_000, price: 200, sum: 1000},
		{key: z, name: "Плинтус", qty: 1_000, price: 300, sum: 300}, {key: v, name: "Старый ламинат", qty: 2_000, price: 400, sum: 800}}
	b := []lineVer{{key: y, name: "Плитка", qty: 6_000, price: 200, sum: 1200}, {key: z, name: "Плинтус", qty: 1_000, price: 350, sum: 350},
		{key: v, name: "Старый ламинат", qty: 2_000, price: 400, sum: 800}, {key: w, name: "Новый ламинат", qty: 2_000, price: 450, sum: 900}}
	rows := diffLines(a, b)
	var got []string
	for _, r := range rows {
		got = append(got, r.change+":"+r.name())
	}
	want := []string{"removed:Стяжка", "changed:Плитка", "changed:Плинтус", "same:Старый ламинат", "added:Новый ламинат"}
	if len(got) != len(want) {
		t.Fatalf("rows %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("rows %v, want %v", got, want)
		}
	}
	if rows[0].delta() != -1000 || rows[1].delta() != 200 || rows[2].delta() != 50 || rows[3].delta() != 0 || rows[4].delta() != 900 {
		t.Errorf("deltas %d %d %d %d %d", rows[0].delta(), rows[1].delta(), rows[2].delta(), rows[3].delta(), rows[4].delta())
	}
}

func TestSignCode(t *testing.T) {
	t.Parallel()
	code, err := newSignCode(bytes.NewReader(bytes.Repeat([]byte{7}, 64)))
	if err != nil || len(code) != 6 || !digits(code) {
		t.Fatalf("code %q, %v", code, err)
	}
	// the source of randomness fails: no code
	if _, err := newSignCode(bytes.NewReader(nil)); err == nil {
		t.Error("a code from an empty source")
	}
	key, doc := []byte("server-key"), uuid.New()
	hash := signHash(key, doc, "482910")
	if hash == "" || hash == "482910" || len(hash) != 64 {
		t.Fatalf("hash %q", hash)
	}
	if !signMatches(key, doc, "482910", hash) {
		t.Error("the right code does not match")
	}
	for name, ok := range map[string]bool{
		"another code":     signMatches(key, doc, "482911", hash),
		"another document": signMatches(key, uuid.New(), "482910", hash),
		"another key":      signMatches([]byte("other"), doc, "482910", hash),
		"empty hash":       signMatches(key, doc, "482910", ""),
	} {
		if ok {
			t.Errorf("%s matches", name)
		}
	}
}

func TestMaskPhone(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]string{
		"+7 900 000-11-22":  "+7 *** ***-11-22",
		"8 (900) 123-45-67": "+7 *** ***-45-67",
		"79001234567":       "+7 *** ***-45-67",
		"12":                "***",
		"":                  "***",
	} {
		if got := maskPhone(in); got != want {
			t.Errorf("maskPhone(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestAgreementTitle(t *testing.T) {
	t.Parallel()
	if got := agreementTitle(2, []int{1, 3}); got != "Допсоглашение № 2 · ДР-1, ДР-3" {
		t.Errorf("title %q", got)
	}
	if got := agreementTitle(1, nil); got != "Допсоглашение № 1" {
		t.Errorf("title %q", got)
	}
}
