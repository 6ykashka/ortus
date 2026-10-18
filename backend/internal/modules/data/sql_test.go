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
