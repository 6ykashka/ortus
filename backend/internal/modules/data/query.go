package data

import (
	"fmt"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
)

// Bounds of DatasetQuery (api/openapi/components/data/schemas.yaml).
const (
	maxSelect     = 100
	maxFilters    = 50
	maxValues     = 100
	maxSort       = 5
	maxGroupBy    = 5
	maxAggregates = 20
	maxLimit      = 200
	maxSearch     = 200
	maxCursor     = 2048
)

var (
	aliasRE   = regexp.MustCompile(`^[a-z][a-z0-9_]{0,49}$`)
	decimalRE = regexp.MustCompile(`^-?(0|[1-9][0-9]*)(\.[0-9]+)?$`)
)

// filter is a checked condition of a query: values are the parameters of its field type (string for text, choices,
// decimal and date; int64 for money).
type filter struct {
	field  Field
	op     dataapi.QueryFilterOperator
	values []any
}

// order is a checked sort key: a field, or an alias of an aggregate in a grouped query.
type order struct {
	key  string
	desc bool
}

// aggregate is a checked aggregate; field is nil for count.
type aggregate struct {
	fn    dataapi.QueryAggregateFunction
	alias string
	field *Field
}

// plan is a checked query of a view.
type plan struct {
	view    view
	selects []string
	filters []filter
	search  string // the needle in lower case; "" — no search
	sort    []order
	groupBy []string
	aggs    []aggregate
	limit   int
	offset  int
	count   bool
	binding string // what the cursor is bound to
}

// grouped reports whether the query groups the rows (groupBy or aggregates).
func (p plan) grouped() bool { return len(p.groupBy) > 0 || len(p.aggs) > 0 }

// alias returns the aggregate of a grouped plan named key.
func (p plan) alias(key string) (aggregate, bool) {
	i := slices.IndexFunc(p.aggs, func(a aggregate) bool { return a.alias == key })
	if i < 0 {
		return aggregate{}, false
	}
	return p.aggs[i], true
}

// parse checks q against the visible fields of v; member is the identity the cursor is bound to (tenant and
// membership). The checks go as in MSW W2.51: select, filters, sort, groupBy, aggregates.
func parse(v view, q *dataapi.DatasetQuery, member string) (plan, error) {
	if q == nil {
		return plan{}, malformed("Нет тела выборки.")
	}
	if err := sizes(q); err != nil {
		return plan{}, err
	}
	if err := enums(q); err != nil {
		return plan{}, err
	}
	p, aggs := start(v, q)
	aliases := map[string]bool{}
	for _, a := range aggs {
		aliases[a.Alias] = true
	}
	grouped := len(p.groupBy) > 0 || len(aggs) > 0
	for _, check := range []func() error{
		func() error { return p.checkSelect(q.Select, aliases, grouped) },
		func() error { return p.checkFilters(q.Filters) },
		func() error { return p.checkSort(q.Sort, aliases, grouped) },
		p.checkGroups,
		func() error { return p.checkAggregates(aggs) },
	} {
		if err := check(); err != nil {
			return plan{}, err
		}
	}
	if len(p.sort) == 0 && !grouped {
		for _, s := range v.spec.DefaultSort {
			p.sort = append(p.sort, order{key: s.Field, desc: s.Desc})
		}
	}
	p.binding = p.fingerprint(member)
	if q.Cursor != nil {
		off, err := decodeCursor(*q.Cursor, p.binding)
		if err != nil {
			return plan{}, err
		}
		p.offset = off
	}
	return p, nil
}

// start is the plan of q before the checks of its keys: limit, count, search, groups; and its aggregates.
func start(v view, q *dataapi.DatasetQuery) (plan, []dataapi.QueryAggregate) {
	p := plan{view: v, limit: q.Limit, count: q.IncludeCount != nil && *q.IncludeCount}
	if q.GroupBy != nil && len(*q.GroupBy) > 0 { // [] and no groupBy are the same selection (cursor)
		p.groupBy = slices.Clone(*q.GroupBy)
	}
	if q.Search != nil {
		p.search = strings.ToLower(strings.TrimSpace(*q.Search))
	}
	if q.Aggregates == nil {
		return p, nil
	}
	return p, *q.Aggregates
}

// sizes checks the sizes of DatasetQuery the strict server does not check.
func sizes(q *dataapi.DatasetQuery) error {
	switch {
	case q.Limit < 1 || q.Limit > maxLimit:
		return malformed("limit: 1…" + strconv.Itoa(maxLimit))
	case q.Search != nil && utf8.RuneCountInString(*q.Search) > maxSearch:
		return malformed("search: до " + strconv.Itoa(maxSearch) + " символов")
	case q.Cursor != nil && len(*q.Cursor) > maxCursor:
		return malformed(textBadCursor)
	}
	return lengths(q)
}

// lengths checks the numbers of items of the lists of DatasetQuery.
func lengths(q *dataapi.DatasetQuery) error {
	switch {
	case len(q.Select) < 1 || len(q.Select) > maxSelect:
		return malformed("select: 1…" + strconv.Itoa(maxSelect))
	case len(q.Filters) > maxFilters:
		return malformed("filters: до " + strconv.Itoa(maxFilters))
	case len(q.Sort) > maxSort:
		return malformed("sort: до " + strconv.Itoa(maxSort))
	case q.GroupBy != nil && len(*q.GroupBy) > maxGroupBy:
		return malformed("groupBy: до " + strconv.Itoa(maxGroupBy))
	case q.Aggregates != nil && len(*q.Aggregates) > maxAggregates:
		return malformed("aggregates: до " + strconv.Itoa(maxAggregates))
	}
	return nil
}

// enums checks the enums and patterns of DatasetQuery (operators, directions, functions, aliases) and the number of
// values of a filter.
func enums(q *dataapi.DatasetQuery) error {
	for i, f := range q.Filters {
		if !f.Operator.Valid() || len(f.Values) > maxValues {
			return malformed(fmt.Sprintf("filters[%d]", i))
		}
	}
	for i, s := range q.Sort {
		if !s.Direction.Valid() {
			return malformed(fmt.Sprintf("sort[%d].direction", i))
		}
	}
	if q.Aggregates == nil {
		return nil
	}
	for i, a := range *q.Aggregates {
		if !a.Function.Valid() || !aliasRE.MatchString(a.Alias) {
			return malformed(fmt.Sprintf("aggregates[%d]", i))
		}
	}
	return nil
}

// checkSelect: every key is a visible field; in a grouped query — a group field or an alias.
func (p *plan) checkSelect(keys []string, aliases map[string]bool, grouped bool) error {
	for i, k := range keys {
		if grouped && aliases[k] {
			continue
		}
		path := fmt.Sprintf("select[%d]", i)
		if _, ok := p.view.field(k); !ok {
			return unknownField(k, path)
		}
		if grouped && !slices.Contains(p.groupBy, k) {
			return notGrouped(k, path)
		}
	}
	p.selects = slices.Clone(keys)
	return nil
}

func (p *plan) checkFilters(filters []dataapi.QueryFilter) error {
	for i, f := range filters {
		checked, err := checkFilter(p.view, f, i)
		if err != nil {
			return err
		}
		p.filters = append(p.filters, checked)
	}
	return nil
}

// checkSort: a visible field (in a grouped query — a group field) or an alias of a grouped query.
func (p *plan) checkSort(sorts []dataapi.QuerySort, aliases map[string]bool, grouped bool) error {
	for i, s := range sorts {
		path := fmt.Sprintf("sort[%d].fieldKey", i)
		_, field := p.view.field(s.FieldKey)
		switch {
		case grouped && aliases[s.FieldKey]:
		case !field:
			return unknownField(s.FieldKey, path)
		case grouped && !slices.Contains(p.groupBy, s.FieldKey):
			return notGrouped(s.FieldKey, path)
		}
		p.sort = append(p.sort, order{key: s.FieldKey, desc: s.Direction == dataapi.Desc})
	}
	return nil
}

func (p *plan) checkGroups() error {
	for i, g := range p.groupBy {
		if _, ok := p.view.field(g); !ok {
			return unknownField(g, fmt.Sprintf("groupBy[%d]", i))
		}
	}
	return nil
}

// checkAggregates: sum, avg, min and max over an aggregatable visible field; count over the rows (its field, if any,
// must be visible); an alias repeats neither a visible field nor another alias.
func (p *plan) checkAggregates(aggs []dataapi.QueryAggregate) error {
	seen := map[string]bool{}
	for i, a := range aggs {
		out := aggregate{fn: a.Function, alias: a.Alias}
		path := fmt.Sprintf("aggregates[%d]", i)
		key := ""
		if a.FieldKey != nil {
			key = *a.FieldKey
		}
		count := a.Function == dataapi.QueryAggregateFunctionCount
		f, ok := p.view.field(key)
		switch {
		case count && key == "":
		case !ok, !count && !aggregatable(f):
			return unknownField(key, path+".fieldKey")
		}
		if !count {
			out.field = &f
		}
		if _, field := p.view.field(a.Alias); field || seen[a.Alias] {
			return &fieldError{Detail: "Псевдоним занят: " + a.Alias + ".", Field: path + ".alias", Code: violationAlias, Message: messageAliasInUse}
		}
		seen[a.Alias] = true
		p.aggs = append(p.aggs, out)
	}
	return nil
}

func unknownField(key, path string) *fieldError {
	return &fieldError{Detail: fmt.Sprintf(detailUnknownField, key), Field: path, Code: violationUnknown, Message: messageUnknown}
}

// notGrouped is a field of a grouped query outside its groups (in select or sort).
func notGrouped(key, path string) *fieldError {
	return &fieldError{Detail: "Поле вне группировки: " + key + ".", Field: path, Code: violationGrouped, Message: messageNotGrouped}
}

// checkFilter checks the i-th filter: a visible field, an operator of the field, values of its type.
func checkFilter(v view, f dataapi.QueryFilter, i int) (filter, error) {
	path := fmt.Sprintf("filters[%d]", i)
	field, ok := v.field(f.FieldKey)
	if !ok {
		return filter{}, unknownField(f.FieldKey, path+".fieldKey")
	}
	if !slices.Contains(operators(field), dataapi.FieldDescriptorFilterOperators(f.Operator)) {
		return filter{}, &fieldError{Detail: "Оператор недоступен: " + string(f.Operator) + ".", Field: path + ".operator",
			Code: violationOperator, Message: messageOperator}
	}
	badValues := func(at string) error {
		return &fieldError{Detail: "Проверьте значения фильтра: " + field.Key + ".", Field: at, Code: violationValues, Message: messageValues}
	}
	var vals []any
	for j, fv := range f.Values {
		got, ok := values(field, fv)
		if !ok {
			return filter{}, badValues(fmt.Sprintf("%s.values[%d]", path, j))
		}
		vals = append(vals, got...)
	}
	if !arity(f.Operator, len(f.Values), len(vals)) {
		return filter{}, badValues(path + ".values")
	}
	return filter{field: field, op: f.Operator, values: vals}, nil
}

// arity reports whether an operator has the right number of values (n — values, codes — parameters after the codes of
// choices are spread): is_null none, in one or more, the others exactly one.
func arity(op dataapi.QueryFilterOperator, n, codes int) bool {
	switch op {
	case dataapi.QueryFilterOperatorIsNull:
		return n == 0
	case dataapi.QueryFilterOperatorIn:
		return codes > 0
	case dataapi.QueryFilterOperatorEq, dataapi.QueryFilterOperatorNe, dataapi.QueryFilterOperatorLt,
		dataapi.QueryFilterOperatorLte, dataapi.QueryFilterOperatorGt, dataapi.QueryFilterOperatorGte,
		dataapi.QueryFilterOperatorContains:
	}
	return n == 1 && codes == 1
}

// decoders read a value of a filter by its type for a field of the given value type; a pair without a decoder does not
// fit (a choice takes codes as text or choices, a decimal and a date also take their text form).
var decoders = map[string]func(f Field, fv dataapi.FieldValue) ([]any, bool){
	string(dataapi.TextValueTypeText): func(f Field, fv dataapi.FieldValue) ([]any, bool) {
		t, err := fv.AsTextValue()
		if err != nil {
			return nil, false
		}
		return textValue(f, t.Value)
	},
	string(dataapi.ChoicesValueTypeChoices): func(f Field, fv dataapi.FieldValue) ([]any, bool) {
		c, err := fv.AsChoicesValue()
		if err != nil || f.Type != Choices {
			return nil, false
		}
		out := make([]any, 0, len(c.Value))
		for _, code := range c.Value {
			out = append(out, code)
		}
		return out, true
	},
	string(dataapi.DecimalValueTypeDecimal): func(f Field, fv dataapi.FieldValue) ([]any, bool) {
		d, err := fv.AsDecimalValue()
		if err != nil || f.Type != Decimal || !decimalRE.MatchString(d.Value) {
			return nil, false
		}
		return []any{d.Value}, true
	},
	string(dataapi.MoneyValueTypeMoney): func(f Field, fv dataapi.FieldValue) ([]any, bool) {
		m, err := fv.AsMoneyValue()
		if err != nil || f.Type != Money {
			return nil, false
		}
		return []any{int64(m.Value.AmountMinor)}, true
	},
	string(dataapi.DateValueTypeDate): func(f Field, fv dataapi.FieldValue) ([]any, bool) {
		d, err := fv.AsDateValue()
		if err != nil || f.Type != Date {
			return nil, false
		}
		return []any{d.Value.Format(dateLayout)}, true
	},
}

// values returns the parameters of a value of a filter of f; false — the value does not fit the field.
func values(f Field, fv dataapi.FieldValue) ([]any, bool) {
	kind, err := fv.Discriminator()
	if err != nil {
		return nil, false
	}
	decode, ok := decoders[kind]
	if !ok {
		return nil, false
	}
	return decode(f, fv)
}

// textValue is a text value of a filter of f.
func textValue(f Field, s string) ([]any, bool) {
	switch f.Type {
	case Text, Choices:
		return []any{s}, true
	case Decimal:
		return []any{s}, decimalRE.MatchString(s)
	case Date:
		_, err := time.Parse(dateLayout, s)
		return []any{s}, err == nil
	case Money:
	}
	return nil, false
}

// fingerprint is the binding of the cursor: the dataset, the member, the permission version, the filters, the search,
// the sort, the groups and the aggregates (select and limit may change between pages).
func (p plan) fingerprint(member string) string {
	type key struct {
		F string `json:"f"`
		O string `json:"o"`
		V []any  `json:"v"`
	}
	filters := make([]key, 0, len(p.filters))
	for _, f := range p.filters {
		filters = append(filters, key{F: f.field.Key, O: string(f.op), V: f.values})
	}
	sorts := make([]string, 0, len(p.sort))
	for _, s := range p.sort {
		sorts = append(sorts, s.key+"|"+strconv.FormatBool(s.desc))
	}
	aggs := make([]string, 0, len(p.aggs))
	for _, a := range p.aggs {
		field := ""
		if a.field != nil {
			field = a.field.Key
		}
		aggs = append(aggs, string(a.fn)+"|"+field+"|"+a.alias)
	}
	return bindingOf(p.view.spec.ID, member, p.view.version, filters, p.search, sorts, p.groupBy, aggs)
}
