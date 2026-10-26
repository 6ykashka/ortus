package data

import (
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
)

// countCap bounds visibleCount (DatasetQueryResult: «capped at 10000»).
const countCap = 10000

// collation orders and lower-cases texts: Cyrillic before Latin as localeCompare('ru') of MSW W2.51 (dataVM of the
// prototype), and the case of Cyrillic letters whatever the collation of the database.
const collation = ` collate "ru-x-icu"`

// args collects the positional parameters of a statement.
type args struct{ vals []any }

// add appends v and returns its placeholder.
func (a *args) add(v any) string {
	a.vals = append(a.vals, v)
	return "$" + strconv.Itoa(len(a.vals))
}

// restrictor returns the predicate of the restriction of a field with its placeholders numbered after start
// (Evaluator.ScopeQuery).
type restrictor func(r Restriction, start int) (authz.Predicate, error)

// statement is a statement with one {{scope}} (scopeddb) and its parameters; the scope predicate is numbered after them.
type statement struct {
	sql  string
	args []any
}

// Columns of the rows of the dataset (the inner select, alias d).
func col(key string) string { return `d."f_` + key + `"` }
func cur(key string) string { return `d."c_` + key + `"` }

// casts turn the parameters of filters into the SQL type of the field: strings for every type but money (bigint), so
// that the driver never guesses the encoding of a decimal or a date.
var casts = map[ValueType]string{Text: "::text", Choices: "::text", Decimal: "::text::numeric", Money: "::bigint", Date: "::text::date"}

// arrayCasts are casts of the parameter of an in filter.
var arrayCasts = map[ValueType]string{
	Text: "::text[]", Choices: "::text[]", Decimal: "::text[]::numeric[]", Money: "::bigint[]", Date: "::text[]::date[]",
}

// quote is a SQL string literal of a constant of a Spec (labels of options).
func quote(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }

// hides reports whether any expression of the spec uses HiddenParam: only then the service asks its Hider (a read of
// the DB). inner replaces the placeholder in the whole statement, so every expression it puts there is looked at — a
// placeholder missed here would become an empty array and keep the closed rows (fail-open).
func (s Spec) hides() bool {
	return slices.ContainsFunc(s.expressions(), func(e string) bool { return strings.Contains(e, HiddenParam) })
}

// expressions are the SQL parts of the spec inner builds its statement from.
func (s Spec) expressions() []string {
	out := make([]string, 0, 3+len(s.Order)+2*len(s.Fields)+len(s.Reaches))
	out = append(out, s.From, s.Where, s.RecordID)
	out = append(out, s.Order...)
	for _, f := range s.Fields {
		out = append(out, f.SQL, f.Currency)
	}
	for _, r := range s.Reaches {
		out = append(out, r.When)
	}
	return out
}

// inner is the select of the rows of the dataset the member sees: the record id, the order columns and every visible
// field (a restricted one is null outside the scope of its permission), limited by {{scope}} and Spec.Where.
func (p plan) inner(a *args, person uuid.UUID, now time.Time, restrict restrictor) (string, error) {
	s := p.view.spec
	cols := []string{"(" + s.RecordID + ")::text as r__id"}
	for i, o := range s.Order {
		cols = append(cols, "("+o+") as o"+strconv.Itoa(i))
	}
	for _, f := range p.view.fields {
		value, currency := f.SQL, f.Currency
		if currency == "" {
			currency = "'RUB'"
		}
		if f.Restricted != nil {
			pred, err := restrict(*f.Restricted, len(a.vals))
			if err != nil {
				return "", err
			}
			a.vals = append(a.vals, pred.Args...)
			value = "case when (" + pred.SQL + ") then " + value + " end"
			currency = "case when (" + pred.SQL + ") then " + currency + " end"
		}
		cols = append(cols, "("+value+`) as "f_`+f.Key+`"`)
		if f.Type == Money {
			cols = append(cols, "("+currency+`)::text as "c_`+f.Key+`"`)
		}
	}
	where, err := p.reaches(a, restrict)
	if err != nil {
		return "", err
	}
	if s.Where != "" {
		where = "(" + s.Where + ") and " + where
	}
	sql := "select " + strings.Join(cols, ", ") + " from " + s.From + " where " + where
	if strings.Contains(sql, PersonParam) {
		sql = strings.ReplaceAll(sql, PersonParam, a.add(person)+"::uuid")
	}
	if strings.Contains(sql, NowParam) {
		sql = strings.ReplaceAll(sql, NowParam, a.add(now)+"::timestamptz")
	}
	if strings.Contains(sql, HiddenParam) {
		hidden := p.hidden
		if hidden == nil {
			hidden = []uuid.UUID{} // never NULL: «<> all('{}')» keeps every row
		}
		sql = strings.ReplaceAll(sql, HiddenParam, a.add(hidden)+"::uuid[]")
	}
	return sql, nil
}

// reaches is the condition of the visible rows (W4.80): the scope of the dataset permission ({{scope}}) or one of the
// reaches of the spec — the predicate of its permission over its columns where its condition holds; a reach Anywhere
// is «true» when the member holds its permission in some scope and «false» otherwise (no argument). Without reaches —
// the scope alone.
func (p plan) reaches(a *args, restrict restrictor) (string, error) {
	rs := p.view.spec.Reaches
	if len(rs) == 0 {
		return scopeddb.Placeholder, nil
	}
	alts := make([]string, 0, len(rs)+1)
	alts = append(alts, scopeddb.Placeholder)
	for _, r := range rs {
		pred, err := restrict(Restriction{Permission: r.Permission, Columns: r.Columns}, len(a.vals))
		if err != nil {
			return "", err
		}
		cond := pred.SQL
		switch {
		case r.Anywhere && pred.SQL == sqlFalse:
			cond = sqlFalse
		case r.Anywhere:
			cond = "true"
		default:
			a.vals = append(a.vals, pred.Args...)
		}
		if r.When != "" {
			cond = "(" + r.When + ") and (" + cond + ")"
		}
		alts = append(alts, "("+cond+")")
	}
	return "(" + strings.Join(alts, " or ") + ")", nil
}

// where is the condition of the filters and the search over the rows of inner ("" — none).
func (p plan) where(a *args) string {
	conds := make([]string, 0, len(p.filters)+1)
	for _, f := range p.filters {
		conds = append(conds, condition(f, a))
	}
	if p.search != "" {
		needle := a.add(p.search)
		parts := make([]string, 0, len(p.view.fields))
		for _, f := range p.view.fields {
			parts = append(parts, "strpos(lower(coalesce(("+searchText(f)+"), '')"+collation+"), "+needle+") > 0")
		}
		conds = append(conds, "("+strings.Join(parts, " or ")+")")
	}
	if len(conds) == 0 {
		return ""
	}
	return " where " + strings.Join(conds, " and ")
}

// condition is the SQL of one filter; its values are parameters of the type of the field.
func condition(f filter, a *args) string {
	c := col(f.field.Key)
	one := func() string {
		if f.op == dataapi.QueryFilterOperatorContains {
			s, _ := f.values[0].(string) // contains is a text operator: parse gives a string
			return a.add(strings.ToLower(s))
		}
		return a.add(f.values[0]) + casts[f.field.Type]
	}
	switch f.op {
	case dataapi.QueryFilterOperatorIsNull:
		return c + " is null"
	case dataapi.QueryFilterOperatorIn:
		return c + " = any(" + a.add(list(f)) + arrayCasts[f.field.Type] + ")"
	case dataapi.QueryFilterOperatorNe:
		return c + " is distinct from " + one()
	case dataapi.QueryFilterOperatorContains:
		return "strpos(lower(coalesce(" + c + ", '')" + collation + "), " + one() + ") > 0"
	case dataapi.QueryFilterOperatorLt:
		return c + " < " + one()
	case dataapi.QueryFilterOperatorLte:
		return c + " <= " + one()
	case dataapi.QueryFilterOperatorGt:
		return c + " > " + one()
	case dataapi.QueryFilterOperatorGte:
		return c + " >= " + one()
	case dataapi.QueryFilterOperatorEq:
	}
	return c + " = " + one()
}

// list is the array parameter of an in filter: bigint for money, text otherwise.
func list(f filter) any {
	if f.field.Type == Money {
		out := make([]int64, 0, len(f.values))
		for _, v := range f.values {
			n, _ := v.(int64) // parse gives int64 for money
			out = append(out, n)
		}
		return out
	}
	out := make([]string, 0, len(f.values))
	for _, v := range f.values {
		s, _ := v.(string) // parse gives strings for the other types
		out = append(out, s)
	}
	return out
}

// labels is the label of the code of a choices field (the code itself when it has none).
func labels(f Field) string {
	var b strings.Builder
	b.WriteString("case " + col(f.Key))
	for _, o := range f.Options {
		b.WriteString(" when " + quote(o.Key) + " then " + quote(o.Label))
	}
	b.WriteString(" else " + col(f.Key) + " end")
	return b.String()
}

// searchText is the text of a cell the search looks in: the text, the label of a choice, the number (money in units
// of the currency, as MSW), the date as YYYY-MM-DD.
func searchText(f Field) string {
	c := col(f.Key)
	switch f.Type {
	case Choices:
		return labels(f)
	case Decimal:
		return "trim_scale(" + c + ")::text"
	case Money:
		return "trim_scale(" + c + " / 100.0)::text"
	case Date:
		return "to_char(" + c + ", 'YYYY-MM-DD')"
	case Text:
	}
	return c + "::text"
}

// output returns the columns of a cell of f (money: amount and currency) as text.
func output(f Field) []string {
	c := col(f.Key)
	switch f.Type {
	case Decimal:
		return []string{"trim_scale(" + c + ")::text"}
	case Money:
		return []string{c + "::text", cur(f.Key)}
	case Date:
		return []string{"to_char(" + c + ", 'YYYY-MM-DD')"}
	case Text, Choices:
	}
	return []string{c + "::text"}
}

// aggValue is the SQL of an aggregate (for the order); aggOutput — its cell columns as text with its value type.
func aggValue(a aggregate) string {
	if a.field == nil {
		return "count(*)"
	}
	return string(a.fn) + "(" + col(a.field.Key) + ")"
}

func aggOutput(a aggregate) ([]string, ValueType) {
	if a.field == nil {
		return []string{"count(*)::text"}, Decimal
	}
	c := col(a.field.Key)
	if a.field.Type == Money {
		value := aggValue(a) + "::text"
		if a.fn == dataapi.QueryAggregateFunctionAvg {
			value = "round(avg(" + c + "))::bigint::text"
		}
		k := cur(a.field.Key)
		return []string{value, "case when count(distinct " + k + ") <= 1 then min(" + k + ") end"}, Money
	}
	if a.fn == dataapi.QueryAggregateFunctionAvg {
		return []string{"trim_scale(round(avg(" + c + "), 2))::text"}, Decimal
	}
	return []string{"trim_scale(" + aggValue(a) + ")::text"}, Decimal
}

// sortKey is the expression of a sort key: texts and labels in the Russian collation, numbers and dates as they are,
// an alias of a grouped query — its aggregate.
func (p plan) sortKey(key string) string {
	if a, ok := p.alias(key); ok && p.grouped() {
		return aggValue(a)
	}
	f, _ := p.view.field(key) // parse checked the key
	switch f.Type {
	case Text:
		return col(key) + collation
	case Choices:
		return "(" + labels(f) + ")" + collation
	case Decimal, Money, Date:
	}
	return col(key)
}

// orderBy is the order of the rows: the sort of the query, then the stable order of the dataset (the groups of a
// grouped query).
func (p plan) orderBy() string {
	keys := make([]string, 0, len(p.sort)+len(p.view.spec.Order)+1)
	for _, s := range p.sort {
		dir := " asc"
		if s.desc {
			dir = " desc"
		}
		keys = append(keys, p.sortKey(s.key)+dir)
	}
	if p.grouped() {
		for _, g := range p.groupBy {
			keys = append(keys, col(g))
		}
	} else {
		for i := range p.view.spec.Order {
			keys = append(keys, "d.o"+strconv.Itoa(i))
		}
		keys = append(keys, "d.r__id")
	}
	if len(keys) == 0 {
		return ""
	}
	return " order by " + strings.Join(keys, ", ")
}

// rows returns the statement of the page of p (one row more than the limit) and the types of its cells in the order
// of select; the first column of a row is its record id ("" for a group), a money cell takes two columns (amount,
// currency).
func (p plan) rows(person uuid.UUID, now time.Time, restrict restrictor) (statement, []ValueType, error) {
	a := &args{}
	inner, err := p.inner(a, person, now, restrict)
	if err != nil {
		return statement{}, nil, err
	}
	outs := []string{"d.r__id"}
	if p.grouped() {
		outs = []string{"''::text"}
	}
	types := make([]ValueType, 0, len(p.selects))
	for _, key := range p.selects {
		if ag, ok := p.alias(key); ok && p.grouped() {
			cols, typ := aggOutput(ag)
			outs, types = append(outs, cols...), append(types, typ)
			continue
		}
		f, _ := p.view.field(key) // parse checked the key
		outs, types = append(outs, output(f)...), append(types, f.Type)
	}
	sql := "select " + strings.Join(outs, ", ") + " from (" + inner + ") d" + p.where(a)
	if len(p.groupBy) > 0 {
		groups := make([]string, 0, len(p.groupBy))
		for _, g := range p.groupBy {
			groups = append(groups, col(g))
			if f, _ := p.view.field(g); f.Type == Money { // the currency of a money group is a part of the group
				groups = append(groups, cur(g))
			}
		}
		sql += " group by " + strings.Join(groups, ", ")
	}
	sql += p.orderBy() + " limit " + a.add(p.limit+1) + " offset " + a.add(p.offset)
	return statement{sql: sql, args: a.vals}, types, nil
}

// counted returns the statement of the number of the visible rows of p after filters and search, at most
// countCap + 1.
func (p plan) counted(person uuid.UUID, now time.Time, restrict restrictor) (statement, error) {
	a := &args{}
	inner, err := p.inner(a, person, now, restrict)
	if err != nil {
		return statement{}, err
	}
	sql := "select count(*) from (select 1 from (" + inner + ") d" + p.where(a) + " limit " + a.add(countCap+1) + ") c"
	return statement{sql: sql, args: a.vals}, nil
}
