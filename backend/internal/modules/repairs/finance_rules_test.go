package repairs

import (
	"slices"
	"strings"
	"testing"
)

func TestCrewPool(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name   string
		amount int64
		pct    int
		want   int64
		wantOK bool
	}{
		{"forty percent", 1_000_000, 40, 400_000, true},
		{"rounds half up", 1_004, 40, 402, true},
		{"all of it", 777, 100, 777, true},
		{"zero share", 1_000, 0, 0, true},
		{"over a hundred", 1_000, 101, 0, false},
		{"negative", 1_000, -1, 0, false},
		{"no amount", 0, 40, 0, true},
	} {
		got, ok := crewPool(c.amount, c.pct)
		if ok != c.wantOK || (ok && got != c.want) {
			t.Errorf("%s: crewPool(%d, %d) = %d, %v; want %d, %v", c.name, c.amount, c.pct, got, ok, c.want, c.wantOK)
		}
	}
}

func TestSplitPool(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		name    string
		pool    int64
		weights []int
		want    []int64
	}{
		{"by marks", 100_000, []int{3, 1}, []int64{75_000, 25_000}},
		{"remainder to the first", 100, []int{1, 1, 1}, []int64{34, 33, 33}},
		{"one worker takes all", 12_345, []int{5}, []int64{12_345}},
		{"no marks - equal", 10, []int{0, 0}, []int64{5, 5}},
		{"zero weight gets nothing when others have marks", 90, []int{2, 0, 1}, []int64{60, 0, 30}},
		{"nobody", 100, nil, nil},
	} {
		got := splitPool(c.pool, c.weights)
		if !slices.Equal(got, c.want) {
			t.Errorf("%s: splitPool(%d, %v) = %v, want %v", c.name, c.pool, c.weights, got, c.want)
		}
		var sum int64
		for _, g := range got {
			sum += g
		}
		if len(got) > 0 && sum != c.pool {
			t.Errorf("%s: the parts sum to %d, want %d", c.name, sum, c.pool)
		}
	}
}

func TestClientToken(t *testing.T) {
	t.Parallel()
	a, err := newClientToken()
	if err != nil {
		t.Fatal(err)
	}
	b, err := newClientToken()
	if err != nil {
		t.Fatal(err)
	}
	if a == b || len(a) != 43 || strings.ContainsAny(a, "+/=") {
		t.Errorf("tokens %q, %q: want distinct base64url of 32 bytes without padding", a, b)
	}
	d := clientDigest("abc")
	if d != "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Errorf("digest of abc = %s", d)
	}
}

func TestClientURL(t *testing.T) {
	t.Parallel()
	if got := clientURL("https://crm.example/", "tok"); got != "https://crm.example/c/tok" {
		t.Errorf("clientURL = %s", got)
	}
	if got := clientURL("", "tok"); got != "/c/tok" {
		t.Errorf("clientURL without a base = %s", got)
	}
}

func TestPayoutTitle(t *testing.T) {
	t.Parallel()
	if got := payoutTitle(2, 150_000); got != "Выплата бригаде: 2 начисл., 1500.00 ₽" {
		t.Errorf("payoutTitle = %q", got)
	}
}
