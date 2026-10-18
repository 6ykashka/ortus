package data

import (
	"fmt"
	"reflect"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// A field closed by the rights of the member and a field that does not exist get the same 422 in every place of a
// query: the answer never confirms that a hidden field exists (description of queryDataset W2.51).
func TestParseHiddenIsUnknown(t *testing.T) {
	t.Parallel()
	places := []struct {
		name, raw, path string
	}{
		{"select", `{"select": ["%s"], "filters": [], "sort": [], "limit": 50}`, "select[0]"},
		{"filter", `{"select": ["name"], "filters": [{"fieldKey": "%s", "operator": "is_null", "values": []}], "sort": [], "limit": 50}`, "filters[0].fieldKey"},
		{"sort", `{"select": ["name"], "filters": [], "sort": [{"fieldKey": "%s", "direction": "asc"}], "limit": 50}`, "sort[0].fieldKey"},
		{"groupBy", `{"select": ["n"], "filters": [], "sort": [], "groupBy": ["%s"], "aggregates": [{"function": "count", "alias": "n"}], "limit": 50}`, "groupBy[0]"},
		{"aggregate", `{"select": ["n"], "filters": [], "sort": [], "aggregates": [{"function": "sum", "fieldKey": "%s", "alias": "n"}], "limit": 50}`, "aggregates[0].fieldKey"},
	}
	for _, p := range places {
		t.Run(p.name, func(t *testing.T) {
			t.Parallel()
			_, errHidden := parse(itemsView(false), query(t, fmt.Sprintf(p.raw, "secret")), member)
			_, errUnknown := parse(itemsView(false), query(t, fmt.Sprintf(p.raw, "plate")), member)
			hidden, unknown := asFieldError(t, errHidden), asFieldError(t, errUnknown)
			if *unknown != (fieldError{Detail: "Поле недоступно: plate.", Field: p.path, Code: "unknown_field", Message: "Поле недоступно"}) {
				t.Fatalf("unknown: %+v", unknown)
			}
			if hidden.Detail != "Поле недоступно: secret." || hidden.Field != unknown.Field || hidden.Code != unknown.Code ||
				hidden.Message != unknown.Message {
				t.Fatalf("hidden %+v differs from unknown %+v", hidden, unknown)
			}
			if _, err := parse(itemsView(true), query(t, fmt.Sprintf(p.raw, "secret")), member); err != nil {
				t.Fatalf("open field: %v", err)
			}
		})
	}
}

func TestParseOperators(t *testing.T) {
	t.Parallel()
	for _, c := range []struct{ name, filter string }{
		{"contains on a decimal", `{"fieldKey": "size", "operator": "contains", "values": [{"type": "text", "value": "1"}]}`},
		{"is_null on a required field", `{"fieldKey": "name", "operator": "is_null", "values": []}`},
		{"lt on a choice", `{"fieldKey": "kind", "operator": "lt", "values": [{"type": "text", "value": "a"}]}`},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			_, err := parse(itemsView(false), query(t, `{"select": ["name"], "filters": [`+c.filter+`], "sort": [], "limit": 50}`), member)
			fe := asFieldError(t, err)
			if fe.Field != "filters[0].operator" || fe.Code != "operator" || !strings.HasPrefix(fe.Detail, "Оператор недоступен: ") {
				t.Fatalf("%+v", fe)
			}
		})
	}
}

// Values of a filter: is_null — none, in — one or more, any other operator — exactly one, of the type of the field
// (a choice takes its code as text or choices, a decimal and a date also take their text form).
func TestParseValues(t *testing.T) {
	t.Parallel()
	ok := []struct {
		name, filter string
		want         []any
	}{
		{"text eq", `{"fieldKey": "name", "operator": "eq", "values": [{"type": "text", "value": "ГАЗель"}]}`, []any{"ГАЗель"}},
		{"choice as text", `{"fieldKey": "kind", "operator": "eq", "values": [{"type": "text", "value": "a"}]}`, []any{"a"}},
		{"choices in", `{"fieldKey": "kind", "operator": "in", "values": [{"type": "choices", "value": ["a", "b"]}]}`, []any{"a", "b"}},
		{"decimal", `{"fieldKey": "size", "operator": "gte", "values": [{"type": "decimal", "value": "14.5"}]}`, []any{"14.5"}},
		{"decimal as text", `{"fieldKey": "size", "operator": "lt", "values": [{"type": "text", "value": "14"}]}`, []any{"14"}},
		{"money", `{"fieldKey": "price", "operator": "gt", "values": [{"type": "money", "value": {"amountMinor": 250000, "currency": "RUB"}}]}`, []any{int64(250000)}},
		{"date", `{"fieldKey": "day", "operator": "eq", "values": [{"type": "date", "value": "2026-10-01"}]}`, []any{"2026-10-01"}},
		{"date as text", `{"fieldKey": "day", "operator": "lte", "values": [{"type": "text", "value": "2026-10-01"}]}`, []any{"2026-10-01"}},
		{"is_null", `{"fieldKey": "size", "operator": "is_null", "values": []}`, nil},
	}
	for _, c := range ok {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			p, err := parse(itemsView(false), query(t, `{"select": ["name"], "filters": [`+c.filter+`], "sort": [], "limit": 50}`), member)
			if err != nil {
				t.Fatal(err)
			}
			if len(p.filters) != 1 || !reflect.DeepEqual(p.filters[0].values, c.want) {
				t.Fatalf("values %#v, want %#v", p.filters, c.want)
			}
		})
	}
	bad := []struct{ name, filter, path string }{
		{"eq without a value", `{"fieldKey": "name", "operator": "eq", "values": []}`, "filters[0].values"},
		{"eq with two", `{"fieldKey": "name", "operator": "eq", "values": [{"type": "text", "value": "a"}, {"type": "text", "value": "b"}]}`, "filters[0].values"},
		{"eq with two codes", `{"fieldKey": "kind", "operator": "eq", "values": [{"type": "choices", "value": ["a", "b"]}]}`, "filters[0].values"},
		{"in without a value", `{"fieldKey": "kind", "operator": "in", "values": []}`, "filters[0].values"},
		{"is_null with a value", `{"fieldKey": "size", "operator": "is_null", "values": [{"type": "decimal", "value": "1"}]}`, "filters[0].values"},
		{"text for money", `{"fieldKey": "price", "operator": "eq", "values": [{"type": "text", "value": "2500"}]}`, "filters[0].values[0]"},
		{"not a decimal", `{"fieldKey": "size", "operator": "eq", "values": [{"type": "text", "value": "много"}]}`, "filters[0].values[0]"},
		{"not a date", `{"fieldKey": "day", "operator": "eq", "values": [{"type": "text", "value": "01.10.2026"}]}`, "filters[0].values[0]"},
		{"money for text", `{"fieldKey": "name", "operator": "eq", "values": [{"type": "money", "value": {"amountMinor": 1, "currency": "RUB"}}]}`, "filters[0].values[0]"},
		{"null value", `{"fieldKey": "name", "operator": "ne", "values": [{"type": "null", "value": null}]}`, "filters[0].values[0]"},
	}
	for _, c := range bad {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			_, err := parse(itemsView(false), query(t, `{"select": ["name"], "filters": [`+c.filter+`], "sort": [], "limit": 50}`), member)
			fe := asFieldError(t, err)
			if fe.Field != c.path || fe.Code != "values" || !strings.HasPrefix(fe.Detail, "Проверьте значения фильтра: ") {
				t.Fatalf("%+v", fe)
			}
		})
	}
}

// Grouping: select holds group fields and aliases only; sum/avg/min/max need an aggregatable field; an alias may not
// repeat a visible field or another alias, and may repeat a closed one (no leak of its existence).
func TestParseGrouping(t *testing.T) {
	t.Parallel()
	p, err := parse(itemsView(false), query(t, `{"select": ["kind", "total", "n"], "filters": [], "sort": [{"fieldKey": "total", "direction": "desc"}],
		"groupBy": ["kind"], "aggregates": [{"function": "sum", "fieldKey": "price", "alias": "total"}, {"function": "count", "alias": "n"}],
		"limit": 50}`), member)
	if err != nil {
		t.Fatal(err)
	}
	if !p.grouped() || len(p.aggs) != 2 || p.aggs[1].field != nil || p.aggs[0].field == nil || p.aggs[0].field.Key != "price" ||
		!reflect.DeepEqual(p.sort, []order{{key: "total", desc: true}}) {
		t.Fatalf("plan %+v", p)
	}
	if _, err := parse(itemsView(false), query(t, `{"select": ["secret"], "filters": [], "sort": [], "aggregates": [{"function": "count", "alias": "secret"}], "limit": 50}`), member); err != nil {
		t.Fatalf("alias of a closed field: %v", err)
	}
	for _, c := range []struct{ name, raw, path, code string }{
		{"field outside the groups", `{"select": ["kind", "name"], "filters": [], "sort": [], "groupBy": ["kind"], "limit": 50}`, "select[1]", "not_grouped"},
		{"sum of a text", `{"select": ["n"], "filters": [], "sort": [], "aggregates": [{"function": "sum", "fieldKey": "name", "alias": "n"}], "limit": 50}`, "aggregates[0].fieldKey", "unknown_field"},
		{"sum without a field", `{"select": ["n"], "filters": [], "sort": [], "aggregates": [{"function": "sum", "alias": "n"}], "limit": 50}`, "aggregates[0].fieldKey", "unknown_field"},
		{"alias of a field", `{"select": ["name"], "filters": [], "sort": [], "aggregates": [{"function": "count", "alias": "name"}], "limit": 50}`, "aggregates[0].alias", "alias"},
		{"same alias twice", `{"select": ["n"], "filters": [], "sort": [], "aggregates": [{"function": "count", "alias": "n"}, {"function": "max", "fieldKey": "size", "alias": "n"}], "limit": 50}`, "aggregates[1].alias", "alias"},
		{"alias outside a grouping", `{"select": ["name"], "filters": [], "sort": [{"fieldKey": "n", "direction": "asc"}], "limit": 50}`, "sort[0].fieldKey", "unknown_field"},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			_, err := parse(itemsView(false), query(t, c.raw), member)
			fe := asFieldError(t, err)
			if fe.Field != c.path || fe.Code != c.code {
				t.Fatalf("%+v", fe)
			}
		})
	}
}

// The bounds of the schema of DatasetQuery are 400 malformed_request (the strict server does not check them).
func TestParseBounds(t *testing.T) {
	t.Parallel()
	many := func(n int, item string) string { return strings.TrimSuffix(strings.Repeat(item+",", n), ",") }
	f := `{"fieldKey": "name", "operator": "ne", "values": [{"type": "text", "value": "x"}]}`
	s := `{"fieldKey": "name", "direction": "asc"}`
	for _, c := range []struct{ name, raw string }{
		{"no select", `{"select": [], "filters": [], "sort": [], "limit": 50}`},
		{"101 select", `{"select": [` + many(101, `"name"`) + `], "filters": [], "sort": [], "limit": 50}`},
		{"51 filters", `{"select": ["name"], "filters": [` + many(51, f) + `], "sort": [], "limit": 50}`},
		{"101 values", `{"select": ["name"], "filters": [{"fieldKey": "name", "operator": "in", "values": [` + many(101, `{"type": "text", "value": "x"}`) + `]}], "sort": [], "limit": 50}`},
		{"6 sort keys", `{"select": ["name"], "filters": [], "sort": [` + many(6, s) + `], "limit": 50}`},
		{"6 groups", `{"select": ["name"], "filters": [], "sort": [], "groupBy": [` + many(6, `"name"`) + `], "limit": 50}`},
		{"21 aggregates", `{"select": ["name"], "filters": [], "sort": [], "aggregates": [` + many(21, `{"function": "count", "alias": "n"}`) + `], "limit": 50}`},
		{"limit 0", `{"select": ["name"], "filters": [], "sort": [], "limit": 0}`},
		{"limit 201", `{"select": ["name"], "filters": [], "sort": [], "limit": 201}`},
		{"long search", `{"select": ["name"], "filters": [], "sort": [], "limit": 50, "search": "` + strings.Repeat("я", 201) + `"}`},
		{"long cursor", `{"select": ["name"], "filters": [], "sort": [], "limit": 50, "cursor": "` + strings.Repeat("a", 2049) + `"}`},
		{"operator", `{"select": ["name"], "filters": [{"fieldKey": "name", "operator": "like", "values": []}], "sort": [], "limit": 50}`},
		{"direction", `{"select": ["name"], "filters": [], "sort": [{"fieldKey": "name", "direction": "up"}], "limit": 50}`},
		{"function", `{"select": ["n"], "filters": [], "sort": [], "aggregates": [{"function": "median", "alias": "n"}], "limit": 50}`},
		{"alias pattern", `{"select": ["N"], "filters": [], "sort": [], "aggregates": [{"function": "count", "alias": "N"}], "limit": 50}`},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			_, err := parse(itemsView(false), query(t, c.raw), member)
			wantMalformed(t, err)
		})
	}
	if _, err := parse(itemsView(false), nil, member); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Fatalf("no body: %v", err)
	}
}

// Without sort the rows go in the default order of the dataset (a grouping has none); the search is trimmed and lower
// case; includeCount asks for visibleCount.
func TestParseDefaults(t *testing.T) {
	t.Parallel()
	p, err := parse(itemsView(false), query(t, `{"select": ["name", "name"], "filters": [], "sort": [], "limit": 2, "search": "  ГАЗель Next ", "includeCount": true}`), member)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(p.sort, []order{{key: "name"}}) || p.search != "газель next" || !p.count || p.limit != 2 || p.offset != 0 ||
		!reflect.DeepEqual(p.selects, []string{"name", "name"}) {
		t.Fatalf("plan %+v", p)
	}
	p, err = parse(itemsView(false), query(t, `{"select": ["kind"], "filters": [], "sort": [], "groupBy": ["kind"], "limit": 50, "search": "   "}`), member)
	if err != nil {
		t.Fatal(err)
	}
	if len(p.sort) != 0 || p.search != "" || p.count {
		t.Fatalf("grouped plan %+v", p)
	}
}

// The cursor continues the same selection: select and limit may change; another dataset, member, permission version,
// filter, search, sort, grouping or aggregate makes it foreign (400 «Курсор не подходит к выборке.»).
func TestParseCursor(t *testing.T) {
	t.Parallel()
	const base = `{"select": ["name"], "filters": [{"fieldKey": "kind", "operator": "eq", "values": [{"type": "text", "value": "a"}]}],
		"sort": [{"fieldKey": "size", "direction": "desc"}], "limit": 2, "search": "газ"%s}`
	first, err := parse(itemsView(false), query(t, fmt.Sprintf(base, "")), member)
	if err != nil {
		t.Fatal(err)
	}
	cursor := encodeCursor(2, first.binding)
	with := func(extra string) string { return fmt.Sprintf(base, `, "cursor": "`+cursor+`"`+extra) }
	next, err := parse(itemsView(false), query(t, strings.Replace(with(""), `"select": ["name"]`, `"select": ["kind", "size"]`, 1)), member)
	if err != nil || next.offset != 2 {
		t.Fatalf("next page: %+v %v", next, err)
	}
	other := itemsView(false)
	other.version = "8"
	renamed := itemsView(false)
	renamed.spec.ID = "test.other"
	foreign := []struct {
		name   string
		v      view
		raw    string
		member string
	}{
		{"another member", itemsView(false), with(""), "tenant|other"},
		{"another permission version", other, with(""), member},
		{"another dataset", renamed, with(""), member},
		{"another search", itemsView(false), strings.Replace(with(""), `"газ"`, `"газон"`, 1), member},
		{"another sort", itemsView(false), strings.Replace(with(""), `"desc"`, `"asc"`, 1), member},
		{"another filter", itemsView(false), strings.Replace(with(""), `"value": "a"`, `"value": "b"`, 1), member},
		{"a grouping", itemsView(false), strings.Replace(with(`, "groupBy": ["kind", "size"]`), `"select": ["name"]`, `"select": ["kind"]`, 1), member},
	}
	for _, c := range foreign {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			_, err := parse(c.v, query(t, c.raw), c.member)
			wantMalformed(t, err)
			if pe, _ := err.(*problem.Error); pe == nil || pe.Detail != "Курсор не подходит к выборке." { //nolint:errorlint // parse returns the problem itself
				t.Fatalf("detail: %v", err)
			}
		})
	}
	_, err = parse(itemsView(false), query(t, fmt.Sprintf(base, `, "cursor": "не курсор"`)), member)
	if pe, _ := err.(*problem.Error); pe == nil || pe.Code != problem.CodeMalformedRequest || pe.Detail != "Неверный курсор выборки." { //nolint:errorlint // parse returns the problem itself
		t.Fatalf("garbage cursor: %v", err)
	}
}
