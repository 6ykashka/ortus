package data

import (
	"slices"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
)

var (
	testPerson = uuid.MustParse("10000000-0000-4000-8000-000000000001")
	testNow    = time.Date(2026, time.October, 1, 7, 30, 0, 0, time.UTC)
)

// unitScope is the restriction predicate of the tests: one unit, its placeholder after start.
func unitScope(calls *[]int) restrictor {
	return func(r Restriction, start int) (authz.Predicate, error) {
		*calls = append(*calls, start)
		a := authz.NewArgs(start)
		return authz.Predicate{SQL: r.Columns.Unit + " = " + a.Add("unit-1"), Args: a.Values()}, nil
	}
}

func mustParse(t *testing.T, v view, raw string) plan {
	t.Helper()
	p, err := parse(v, query(t, raw), member)
	if err != nil {
		t.Fatal(err)
	}
	return p
}

// checkStatement: one scope placeholder, no placeholder of the spec left, every argument used.
func checkStatement(t *testing.T, st statement) {
	t.Helper()
	if strings.Count(st.sql, scopeddb.Placeholder) != 1 {
		t.Fatalf("want one %s:\n%s", scopeddb.Placeholder, st.sql)
	}
	if strings.Contains(st.sql, PersonParam) || strings.Contains(st.sql, NowParam) {
		t.Fatalf("placeholders of the spec left:\n%s", st.sql)
	}
	for i := range st.args {
		if !strings.Contains(st.sql, "$"+strconv.Itoa(i+1)) {
			t.Fatalf("$%d is not used:\n%s", i+1, st.sql)
		}
	}
}

// A value of a request is always a parameter, never SQL; the scope placeholder is once in the statement; the
// placeholders of the spec become the parameters of the person and the clock.
func TestRowsStatementParameters(t *testing.T) {
	t.Parallel()
	const evil = "'; drop table fleet.trips; --"
	p := mustParse(t, itemsView(false), `{"select": ["name", "price"], "filters": [
		{"fieldKey": "name", "operator": "contains", "values": [{"type": "text", "value": "`+evil+`"}]},
		{"fieldKey": "kind", "operator": "in", "values": [{"type": "choices", "value": ["a", "b"]}]}],
		"sort": [{"fieldKey": "kind", "direction": "desc"}], "limit": 20, "search": "Газ"}`)
	var calls []int
	st, types, err := p.rows(testPerson, testNow, unitScope(&calls))
	if err != nil {
		t.Fatal(err)
	}
	checkStatement(t, st)
	if strings.Contains(st.sql, evil) || strings.Contains(st.sql, "Газ") || strings.Contains(st.sql, "газ") {
		t.Fatalf("a value of the request is in the SQL:\n%s", st.sql)
	}
	for _, want := range []any{evil, []string{"a", "b"}, "газ", testPerson, testNow, 21} {
		if !slices.ContainsFunc(st.args, func(a any) bool { return equalArg(a, want) }) {
			t.Fatalf("argument %v missing in %v", want, st.args)
		}
	}
	if !slices.Equal(types, []ValueType{Text, Money}) {
		t.Fatalf("types %v", types)
	}
	if len(calls) != 0 || strings.Contains(st.sql, "x.secret_minor") {
		t.Fatalf("a closed field reached the statement (restrictions %v):\n%s", calls, st.sql)
	}
	if !strings.Contains(st.sql, `collate "ru-x-icu"`) {
		t.Fatalf("text order without the Russian collation:\n%s", st.sql)
	}
}

// An open restricted field takes the predicate of its permission: the value outside its scope is null.
func TestRowsStatementRestrictedField(t *testing.T) {
	t.Parallel()
	p := mustParse(t, itemsView(true), `{"select": ["secret"], "filters": [], "sort": [], "limit": 50, "cursor": "`+
		encodeCursor(50, mustParse(t, itemsView(true), `{"select": ["name"], "filters": [], "sort": [], "limit": 50}`).binding)+`"}`)
	var calls []int
	st, types, err := p.rows(testPerson, testNow, unitScope(&calls))
	if err != nil {
		t.Fatal(err)
	}
	checkStatement(t, st)
	if len(calls) != 1 || !strings.Contains(st.sql, "case when (x.unit_id = $") || !slices.Contains(st.args, any("unit-1")) {
		t.Fatalf("restriction %v:\n%s\n%v", calls, st.sql, st.args)
	}
	if !slices.Equal(types, []ValueType{Money}) || !slices.Contains(st.args, any(50)) {
		t.Fatalf("types %v, args %v (offset 50)", types, st.args)
	}
}

// W2.57 (AC-06): {{hidden}} of a spec becomes a uuid[] parameter — the ids the Hider of the service closes to the
// member; without them an empty array (never NULL: «<> all('{}')» keeps every row), in the rows and in the count.
func TestHiddenParameter(t *testing.T) {
	t.Parallel()
	v := itemsView(false)
	v.spec.Where += " and x.trip_id <> all({{hidden}})"
	p := mustParse(t, v, `{"select": ["name"], "filters": [], "sort": [], "limit": 10, "includeCount": true}`)
	var calls []int
	st, _, err := p.rows(testPerson, testNow, unitScope(&calls))
	if err != nil {
		t.Fatal(err)
	}
	ct, err := p.counted(testPerson, testNow, unitScope(&calls))
	if err != nil {
		t.Fatal(err)
	}
	for name, s := range map[string]statement{"rows": st, "count": ct} {
		checkStatement(t, s)
		if strings.Contains(s.sql, "{{hidden}}") || !strings.Contains(s.sql, "::uuid[])") {
			t.Fatalf("%s: {{hidden}} is not a uuid[] parameter:\n%s", name, s.sql)
		}
		if !slices.ContainsFunc(s.args, func(a any) bool { ids, ok := a.([]uuid.UUID); return ok && ids != nil && len(ids) == 0 }) {
			t.Fatalf("%s: no empty uuid[] argument in %v", name, s.args)
		}
	}
}

// W2.57, return 2: the Hider is a read of the DB — only a spec whose From or Where compares with {{hidden}} asks it
// («Автомобили» never does).
func TestSpecHides(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		from, where string
		want        bool
	}{
		{"fleet.vehicles v", "v.unit_id is not null", false},
		{"fleet.trips t", "t.id <> all({{hidden}})", true},
		{"fleet.expenses e join fleet.trips t on t.id = e.trip_id and t.id <> all({{hidden}})", "", true},
	} {
		if got := (Spec{From: c.from, Where: c.where}).hides(); got != c.want {
			t.Errorf("from %q where %q: hides %v, want %v", c.from, c.where, got, c.want)
		}
	}
}

// W2.57, return 3 (review): inner replaces {{hidden}} in the whole statement — a spec that puts it into any of its
// expressions (a field, its currency, the record id, the order) asks the Hider too, otherwise the placeholder becomes
// an empty array and the expression keeps the closed rows (fail-open).
func TestSpecHidesInEveryExpression(t *testing.T) {
	t.Parallel()
	const uses = "x.trip_id <> all({{hidden}})"
	for name, s := range map[string]Spec{
		"field":    {Fields: []Field{{Key: "open", SQL: uses}}},
		"currency": {Fields: []Field{{Key: "sum", Type: Money, SQL: "x.sum", Currency: "case when " + uses + " then 'RUB' end"}}},
		"recordId": {RecordID: "case when " + uses + " then x.id end"},
		"order":    {Order: []string{"x.at", uses}},
	} {
		s.From = "fleet.trips x"
		if !s.hides() {
			t.Errorf("%s: {{hidden}} in an expression — hides false, the Hider is not asked", name)
		}
	}
	if (Spec{From: "fleet.vehicles v", RecordID: "v.id", Order: []string{"v.plate"}, Fields: []Field{{Key: "plate", SQL: "v.plate"}}}).hides() {
		t.Error("a spec without {{hidden}} asks the Hider")
	}
}

// Every placeholder the inner select replaces is in an expression hides looks at: a spec whose statement keeps
// {{hidden}} after inner is impossible without hides — checked on the statement itself.
func TestHidesMatchesTheStatement(t *testing.T) {
	t.Parallel()
	v := itemsView(false)
	v.fields = append(v.fields, Field{Key: "open", Label: "Открыт", Type: Text, SQL: "(x.trip_id <> all({{hidden}}))::text"})
	v.spec.Fields = append(v.spec.Fields, v.fields[len(v.fields)-1])
	p := mustParse(t, v, `{"select": ["name", "open"], "filters": [], "sort": [], "limit": 10}`)
	var calls []int
	st, _, err := p.rows(testPerson, testNow, unitScope(&calls))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(st.sql, "::uuid[]") != v.spec.hides() {
		t.Fatalf("the statement compares with the hidden ids, hides %v:\n%s", v.spec.hides(), st.sql)
	}
}

// reachScope is the restriction predicate of the tests of Spec.Reaches: «false» for the permissions of closed (held in
// no scope), else the unit of the columns.
func reachScope(calls *[]string, closed ...string) restrictor {
	return func(r Restriction, start int) (authz.Predicate, error) {
		*calls = append(*calls, r.Permission)
		if slices.Contains(closed, r.Permission) {
			return authz.Predicate{SQL: "false"}, nil
		}
		a := authz.NewArgs(start)
		return authz.Predicate{SQL: r.Columns.Unit + " = " + a.Add("unit-"+r.Permission), Args: a.Values()}, nil
	}
}

// reachView is itemsView with the reaches of «Ответы на осмотр» (W4.80): its own rows (author — the member) with the
// key anywhere, the rows about a trip the member sees, the rows about a trip that is gone with fleet.trips.read anywhere.
func reachView() view {
	v := itemsView(false)
	v.spec.Reaches = []Reach{
		{When: "x.author_id = " + PersonParam, Permission: "forms.responses.read", Columns: testColumns, Anywhere: true},
		{When: "t.id is not null and t.id <> all(" + HiddenParam + ")", Permission: "fleet.trips.read", Columns: authz.Columns{Unit: "t.unit_id"}},
		{When: "x.subject_id is not null and t.id is null", Permission: "fleet.trips.read", Columns: authz.Columns{Unit: "t.unit_id"}, Anywhere: true},
	}
	return v
}

// checkReachStatement: one scope placeholder among the alternatives, no placeholder of a reach left.
func checkReachStatement(t *testing.T, name string, s statement) {
	t.Helper()
	checkStatement(t, s)
	if !strings.Contains(s.sql, "("+scopeddb.Placeholder+" or (") {
		t.Fatalf("%s: the scope is not one of the alternatives:\n%s", name, s.sql)
	}
	if !strings.Contains(s.sql, "(x.author_id = $") || strings.Contains(s.sql, "{{hidden}}") || strings.Contains(s.sql, "{{person}}") {
		t.Fatalf("%s: placeholders of the reaches:\n%s", name, s.sql)
	}
}

// W4.80: a row is visible in the scope of the dataset permission OR by a reach — the predicate of its permission
// over its columns where its condition holds (Anywhere: the member holds the permission in some scope, no arguments);
// the reaches are in the rows and in the count, the scope placeholder stays once.
func TestReachesStatement(t *testing.T) {
	t.Parallel()
	p := mustParse(t, reachView(), `{"select": ["name"], "filters": [], "sort": [], "limit": 10, "includeCount": true}`)
	var calls []string
	st, _, err := p.rows(testPerson, testNow, reachScope(&calls, "fleet.trips.read"))
	if err != nil {
		t.Fatal(err)
	}
	ct, err := p.counted(testPerson, testNow, reachScope(&calls))
	if err != nil {
		t.Fatal(err)
	}
	checkReachStatement(t, "rows", st)
	checkReachStatement(t, "count", ct)
	if !slices.Equal(calls, []string{"forms.responses.read", "fleet.trips.read", "fleet.trips.read",
		"forms.responses.read", "fleet.trips.read", "fleet.trips.read"}) {
		t.Fatalf("restrictions %v", calls)
	}
	// fleet.trips.read held in no scope: the trip reaches give nothing; forms.responses.read anywhere — «true».
	if !strings.Contains(st.sql, ") and (false))") || !strings.Contains(st.sql, ") and (true))") ||
		slices.Contains(st.args, any("unit-fleet.trips.read")) || slices.Contains(st.args, any("unit-forms.responses.read")) {
		t.Fatalf("rows:\n%s\n%v", st.sql, st.args)
	}
	// Held in a scope: the trip reach takes the predicate and its argument; Anywhere — still no argument.
	if !strings.Contains(ct.sql, "and (t.unit_id = $") || !slices.Contains(ct.args, any("unit-fleet.trips.read")) ||
		slices.Contains(ct.args, any("unit-forms.responses.read")) {
		t.Fatalf("count:\n%s\n%v", ct.sql, ct.args)
	}
	if !reachView().spec.hides() {
		t.Fatal("{{hidden}} in a reach — hides false, the Hider is not asked (fail-open)")
	}
}

func TestGroupedAndCountStatements(t *testing.T) {
	t.Parallel()
	p := mustParse(t, itemsView(false), `{"select": ["kind", "total", "n"], "filters": [], "sort": [{"fieldKey": "total", "direction": "desc"}],
		"groupBy": ["kind"], "aggregates": [{"function": "avg", "fieldKey": "price", "alias": "total"}, {"function": "count", "alias": "n"}],
		"limit": 10, "includeCount": true}`)
	var calls []int
	st, types, err := p.rows(testPerson, testNow, unitScope(&calls))
	if err != nil {
		t.Fatal(err)
	}
	checkStatement(t, st)
	if !strings.Contains(st.sql, "group by") || !slices.Equal(types, []ValueType{Choices, Money, Decimal}) {
		t.Fatalf("types %v:\n%s", types, st.sql)
	}
	ct, err := p.counted(testPerson, testNow, unitScope(&calls))
	if err != nil {
		t.Fatal(err)
	}
	checkStatement(t, ct)
	if strings.Contains(ct.sql, "group by") || !slices.Contains(ct.args, any(countCap+1)) {
		t.Fatalf("count over the rows before the grouping, capped:\n%s\n%v", ct.sql, ct.args)
	}
}

func equalArg(a, want any) bool {
	switch w := want.(type) {
	case []string:
		got, ok := a.([]string)
		return ok && slices.Equal(got, w)
	default:
		return a == want
	}
}
