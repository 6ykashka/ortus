package repairs

import (
	"slices"
	"testing"
)

func TestCostOf(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name  string
		qty   milli
		price int64
		want  int64
	}{
		{"whole", 4000, 25000, 100000},
		{"fraction", 2500, 10000, 25000},
		{"rounds half up", 333, 1500, 500}, // 0.333 × 15,00 = 4,995 → 5,00
		{"rounds down", 1001, 100, 100},    // 1.001 × 1,00 = 1,001 → 1,00
		{"zero price", 7000, 0, 0},
		{"zero quantity", 0, 500, 0},
	} {
		if got := costOf(c.qty, c.price); got != c.want {
			t.Errorf("%s: costOf(%d, %d) = %d, want %d", c.name, c.qty, c.price, got, c.want)
		}
	}
}

func TestShareOf(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name       string
		cost       int64
		take, have milli
		want       int64
	}{
		{"all", 90000, 6000, 6000, 90000},
		{"more than there is", 90000, 7000, 6000, 90000},
		{"half", 90000, 3000, 6000, 45000},
		{"rounds half up", 100, 1000, 3000, 33},
		{"rounds up", 200, 1000, 3000, 67},
		{"nothing there", 0, 1000, 0, 0},
		{"no cost", 0, 1000, 5000, 0},
	} {
		if got := shareOf(c.cost, c.take, c.have); got != c.want {
			t.Errorf("%s: shareOf(%d, %d, %d) = %d, want %d", c.name, c.cost, c.take, c.have, got, c.want)
		}
	}
}

func TestAllocate(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name string
		free []int64
		want int64
		take []int64
		ok   bool
	}{
		{"first row is enough", []int64{5_000_000, 3_000_000}, 4_000_000, []int64{4_000_000, 0}, true},
		{"spills over", []int64{1_500_000, 3_000_000, 9_000_000}, 4_000_000, []int64{1_500_000, 2_500_000, 0}, true},
		{"exactly all", []int64{2_000_000, 2_000_000}, 4_000_000, []int64{2_000_000, 2_000_000}, true},
		{"not enough", []int64{1_000_000, 2_000_000}, 3_000_001, nil, false},
		{"skips empty rows", []int64{0, 2_000_000}, 1_000_000, []int64{0, 1_000_000}, true},
		{"nothing wanted", []int64{1_000_000}, 0, []int64{0}, true},
		{"no rows", nil, 1, nil, false},
	} {
		got, ok := allocate(c.free, c.want)
		if ok != c.ok || (ok && !slices.Equal(got, c.take)) {
			t.Errorf("%s: allocate(%v, %d) = %v, %v; want %v, %v", c.name, c.free, c.want, got, ok, c.take, c.ok)
		}
	}
}

func TestUnitPrice(t *testing.T) {
	t.Parallel()
	last := int64(31000)
	if got := unitPriceOf(&last, 25000); got != 31000 {
		t.Errorf("last purchase wins: %d", got)
	}
	if got := unitPriceOf(nil, 25000); got != 25000 {
		t.Errorf("catalog price without purchases: %d", got)
	}
}

func TestSupplyStatesFlow(t *testing.T) {
	t.Parallel()
	// the allowed ways of a request: request → reserved → issued → used, request → ordered → bought → used
	for _, c := range []struct {
		from, to string
		ok       bool
	}{
		{"request", "reserved", true}, {"reserved", "issued", true}, {"issued", "used", true},
		{"request", "ordered", true}, {"ordered", "bought", true}, {"bought", "used", true},
		{"request", "issued", false}, {"reserved", "ordered", false}, {"ordered", "used", false},
		{"used", "issued", false}, {"bought", "issued", false},
	} {
		if got := supplyStep(c.from, c.to); got != c.ok {
			t.Errorf("%s → %s: %v, want %v", c.from, c.to, got, c.ok)
		}
	}
}
