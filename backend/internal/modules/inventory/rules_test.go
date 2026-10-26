package inventory

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestParseQuantity(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		in   string
		want Qty
		ok   bool
	}{
		{"0", 0, true},
		{"1", 1_000_000, true},
		{"0.025", 25_000, true},
		{"12.5", 12_500_000, true},
		{"0.000001", 1, true},
		{"999999999999.999999", 999_999_999_999_999_999, true},
		{"", 0, false},
		{"-1", 0, false},
		{"01", 0, false},
		{"1.", 0, false},
		{".5", 0, false},
		{"1.0000001", 0, false},
		{"1e3", 0, false},
		{"1,5", 0, false},
		{"1000000000000", 0, false}, // 13 digits do not fit numeric(18, 6)
		{" 1", 0, false},
	} {
		got, err := ParseQuantity(c.in)
		if (err == nil) != c.ok || got != c.want {
			t.Errorf("ParseQuantity(%q) = %d, %v; want %d ok=%v", c.in, got, err, c.want, c.ok)
		}
	}
}

func TestQtyString(t *testing.T) {
	t.Parallel()
	for in, want := range map[Qty]string{0: "0", 1_000_000: "1", 25_000: "0.025", 12_500_000: "12.5", 1: "0.000001", 10_000_001: "10.000001"} {
		if got := in.String(); got != want {
			t.Errorf("Qty(%d).String() = %q, want %q", in, got, want)
		}
	}
}

func day(s string) *time.Time {
	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return &d
}

func TestAllocateFEFO(t *testing.T) {
	t.Parallel()
	early, late, none, gone := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	received := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	lots := []Lot{
		{ID: none, Available: 100, ReceivedAt: received},
		{ID: late, ExpiresOn: day("2027-01-10"), Available: 50, ReceivedAt: received},
		{ID: early, ExpiresOn: day("2026-11-01"), Available: 30, ReceivedAt: received.Add(time.Hour)},
		{ID: gone, ExpiresOn: day("2026-09-30"), Available: 500, ReceivedAt: received},
	}
	today := *day("2026-10-26")

	got, err := AllocateFEFO(lots, today, 70)
	if err != nil {
		t.Fatal(err)
	}
	want := []Take{{LotID: early, Qty: 30}, {LotID: late, Qty: 40}}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("takes %v, want %v: the earliest expiry first, the expired lot skipped", got, want)
	}

	got, err = AllocateFEFO(lots, today, 180)
	if err != nil || len(got) != 3 || got[2] != (Take{LotID: none, Qty: 100}) {
		t.Fatalf("takes %v, %v: the lot without expiry goes last", got, err)
	}

	if _, err = AllocateFEFO(lots, today, 181); !errors.Is(err, ErrLotExpired) {
		t.Fatalf("181: %v, want lot_expired: only the expired lot covers the rest", err)
	}
	if _, err = AllocateFEFO(lots, today, 681); !errors.Is(err, ErrInsufficient) {
		t.Fatalf("681: %v, want insufficient_stock", err)
	}
}

func TestAllocateFEFOEdges(t *testing.T) {
	t.Parallel()
	early := uuid.New()
	received := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	today := *day("2026-10-26")
	if _, err := AllocateFEFO(nil, today, 1); !errors.Is(err, ErrInsufficient) {
		t.Fatalf("no lots: %v, want insufficient_stock", err)
	}
	if got, err := AllocateFEFO([]Lot{{ID: early, Available: 5, ReceivedAt: received}}, today, 0); err != nil || len(got) != 0 {
		t.Fatalf("zero: %v, %v", got, err)
	}
	// An expiry today is not expired yet: the lot is good through its date.
	edge := []Lot{{ID: early, ExpiresOn: day("2026-10-26"), Available: 5, ReceivedAt: received}}
	if got, err := AllocateFEFO(edge, today, 5); err != nil || len(got) != 1 {
		t.Fatalf("expiry today: %v, %v", got, err)
	}
	// A zero today takes the expired lots too (a write-off, a reversal).
	old := []Lot{{ID: early, ExpiresOn: day("2020-01-01"), Available: 5, ReceivedAt: received}}
	if got, err := AllocateFEFO(old, time.Time{}, 5); err != nil || len(got) != 1 {
		t.Fatalf("zero today: %v, %v", got, err)
	}
}

func TestAllocateFEFOStableOrder(t *testing.T) {
	t.Parallel()
	a, b := uuid.MustParse("00000000-0000-4000-8000-000000000001"), uuid.MustParse("00000000-0000-4000-8000-000000000002")
	at := time.Date(2026, 9, 1, 10, 0, 0, 0, time.UTC)
	got, err := AllocateFEFO([]Lot{{ID: b, Available: 5, ReceivedAt: at}, {ID: a, Available: 5, ReceivedAt: at}}, at, 7)
	if err != nil || got[0].LotID != a || got[1].LotID != b {
		t.Fatalf("same expiry and receipt: %v, %v: by id", got, err)
	}
}

func TestSumByItem(t *testing.T) {
	t.Parallel()
	a, b := uuid.New(), uuid.New()
	got := Totals([]Take{{Item: a, Qty: 5}, {Item: b, Qty: 2}, {Item: a, Qty: 7}})
	if got[a] != 12 || got[b] != 2 || len(got) != 2 {
		t.Fatalf("totals %v", got)
	}
}
