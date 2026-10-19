package csv

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func fv(t *testing.T, set func(v *dataapi.FieldValue) error) dataapi.FieldValue {
	t.Helper()
	var v dataapi.FieldValue
	require.NoError(t, set(&v))
	return v
}

func text(t *testing.T, s string) dataapi.FieldValue {
	t.Helper()
	return fv(t, func(v *dataapi.FieldValue) error {
		return v.FromTextValue(dataapi.TextValue{Type: dataapi.TextValueTypeText, Value: s})
	})
}

var msk = time.FixedZone("MSK", 3*3600)

// Q-W2.52-11, Q-W2.52-18: labels of choices, rubles and decimals with a comma, ДД.ММ.ГГГГ, an apostrophe before a
// formula only in text cells (also after leading whitespace), RFC 4180 quotes around «;», quotes and line breaks.
func TestCellText(t *testing.T) {
	t.Parallel()
	kinds := dataapi.FieldDescriptor{Options: &[]dataapi.ChoiceOption{{Key: "fuel", Label: "Топливо"}, {Key: "wash", Label: "Мойка"}}}
	day := dataapi.DateValue{Type: dataapi.DateValueTypeDate}
	day.Value.Time = time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC)
	cases := []struct {
		name string
		f    dataapi.FieldDescriptor
		v    dataapi.FieldValue
		want string
	}{
		{"текст", dataapi.FieldDescriptor{}, text(t, "Р-208 · Северный маршрут"), "Р-208 · Северный маршрут"},
		{"формула", dataapi.FieldDescriptor{}, text(t, "=HYPERLINK(1)"), "'=HYPERLINK(1)"},
		{"минус в тексте", dataapi.FieldDescriptor{}, text(t, "-купон"), "'-купон"},
		{"плюс после пробелов", dataapi.FieldDescriptor{}, text(t, "  +7 900"), "'  +7 900"},
		{"собака", dataapi.FieldDescriptor{}, text(t, "@SUM"), "'@SUM"},
		{"табуляция", dataapi.FieldDescriptor{}, text(t, "\tA"), "'\tA"},
		{"точка с запятой", dataapi.FieldDescriptor{}, text(t, "А; Б"), `"А; Б"`},
		{"кавычки", dataapi.FieldDescriptor{}, text(t, `ООО "Альта"`), `"ООО ""Альта"""`},
		{"перевод строки", dataapi.FieldDescriptor{}, text(t, "1\n2"), "\"1\n2\""},
		{"варианты", kinds, fv(t, func(v *dataapi.FieldValue) error {
			return v.FromChoicesValue(dataapi.ChoicesValue{Type: dataapi.ChoicesValueTypeChoices, Value: []string{"fuel", "wash"}})
		}), "Топливо, Мойка"},
		{"неизвестный вариант", kinds, fv(t, func(v *dataapi.FieldValue) error {
			return v.FromChoicesValue(dataapi.ChoicesValue{Type: dataapi.ChoicesValueTypeChoices, Value: []string{"=x"}})
		}), "'=x"},
		{"деньги", dataapi.FieldDescriptor{}, fv(t, func(v *dataapi.FieldValue) error {
			return v.FromMoneyValue(dataapi.MoneyValue{Type: dataapi.MoneyValueTypeMoney, Value: dataapi.Money{AmountMinor: 123450, Currency: "RUB"}})
		}), "1234,50"},
		{"отрицательные деньги без апострофа", dataapi.FieldDescriptor{}, fv(t, func(v *dataapi.FieldValue) error {
			return v.FromMoneyValue(dataapi.MoneyValue{Type: dataapi.MoneyValueTypeMoney, Value: dataapi.Money{AmountMinor: -5, Currency: "RUB"}})
		}), "-0,05"},
		{"число", dataapi.FieldDescriptor{}, fv(t, func(v *dataapi.FieldValue) error {
			return v.FromDecimalValue(dataapi.DecimalValue{Type: dataapi.DecimalValueTypeDecimal, Value: "-11.5"})
		}), "-11,5"},
		{"дата", dataapi.FieldDescriptor{}, fv(t, func(v *dataapi.FieldValue) error { return v.FromDateValue(day) }), "01.10.2026"},
		{"момент в поясе организации", dataapi.FieldDescriptor{}, fv(t, func(v *dataapi.FieldValue) error {
			return v.FromInstantValue(dataapi.InstantValue{Type: dataapi.InstantValueTypeInstant, Value: time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)})
		}), "01.10.2026 10:30"},
		{"флаг", dataapi.FieldDescriptor{}, fv(t, func(v *dataapi.FieldValue) error {
			return v.FromBooleanValue(dataapi.BooleanValue{Type: dataapi.BooleanValueTypeBoolean, Value: true})
		}), "Да"},
		{"пусто", dataapi.FieldDescriptor{}, fv(t, func(v *dataapi.FieldValue) error {
			return v.FromNullValue(dataapi.NullValue{Type: dataapi.Null})
		}), ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			got, err := cellText(c.f, c.v, msk)
			require.NoError(t, err)
			assert.Equal(t, c.want, got)
		})
	}
}

// fakeData is the tag Data of the tests: one dataset of n rows of one text cell, pages of queryDataset by an offset
// cursor as W2.08 (a cursor up to 10 000).
type fakeData struct {
	ds      dataapi.Dataset
	n       int
	queries int
	invalid bool // the query answers the 422 of a hidden field
}

func (f *fakeData) ListDatasets(context.Context, dataapi.ListDatasetsRequestObject) (dataapi.ListDatasetsResponseObject, error) {
	return dataapi.ListDatasets200JSONResponse{Body: dataapi.DatasetCatalog{Items: []dataapi.Dataset{f.ds}}}, nil
}

func (f *fakeData) QueryDataset(_ context.Context, r dataapi.QueryDatasetRequestObject) (dataapi.QueryDatasetResponseObject, error) {
	f.queries++
	if r.DatasetId != f.ds.Id {
		return nil, problem.New(problem.CodeNotFound, "")
	}
	if f.invalid {
		return dataapi.QueryDataset422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: dataapi.ValidationApplicationProblemPlusJSONResponse{
			Body: dataapi.Problem{Code: codeValidation, Status: 422}}}, nil
	}
	off := 0
	if r.Body.Cursor != nil {
		off, _ = strconv.Atoi(*r.Body.Cursor)
	}
	res := dataapi.DatasetQueryResult{Rows: []dataapi.DatasetRow{}}
	for i := off; i < f.n && i < off+r.Body.Limit; i++ {
		var v dataapi.FieldValue
		_ = v.FromTextValue(dataapi.TextValue{Type: dataapi.TextValueTypeText, Value: "Р-" + strconv.Itoa(i)})
		res.Rows = append(res.Rows, dataapi.DatasetRow{RecordId: strconv.Itoa(i), Cells: []dataapi.FieldEntry{{FieldKey: "trip", Value: v}}})
	}
	if next := off + r.Body.Limit; next < f.n && next <= RowLimit {
		c := strconv.Itoa(next)
		res.NextCursor = &c
	}
	return dataapi.QueryDataset200JSONResponse{Body: res}, nil
}

func fakeSet(n int, export bool) *fakeData {
	return &fakeData{n: n, ds: dataapi.Dataset{
		Id: "fleet.trips", Name: "Поездки", ExportAllowed: &export,
		Fields: []dataapi.FieldDescriptor{{Key: "trip", Label: "Рейс", ValueType: "text"}},
	}}
}

func exportBody() *dataapi.DatasetExportCreate {
	return &dataapi.DatasetExportCreate{Select: []string{"trip"}, Filters: []dataapi.QueryFilter{}, Sort: []dataapi.QuerySort{}}
}

func runExport(t *testing.T, f *fakeData, id string) (dataapi.ExportDatasetResponseObject, error) {
	t.Helper()
	x := &Export{Catalog: f, Rows: f, Zone: func(context.Context, tenantctx.TenantContext) (*time.Location, error) { return msk, nil },
		Now: func() time.Time { return time.Date(2026, 10, 1, 22, 30, 0, 0, time.UTC) }}
	ctx := tenantctx.WithTenant(t.Context(), tenantctx.TenantContext{TenantID: uuid.New(), PersonID: uuid.New()})
	return DataServer{Export: x}.ExportDataset(ctx, dataapi.ExportDatasetRequestObject{DatasetId: id, Body: exportBody()})
}

func TestExportFile(t *testing.T) {
	t.Parallel()
	res, err := runExport(t, fakeSet(3, true), "fleet.trips")
	require.NoError(t, err)
	ok, is := res.(dataapi.ExportDataset200JSONResponse)
	require.True(t, is, "200, got %T", res)
	b := ok.Body
	assert.Equal(t, "Рейс\r\nР-0\r\nР-1\r\nР-2\r\n", b.Content)
	assert.Equal(t, "Поездки-2026-10-02.csv", b.FileName, "the day in the time zone of the organisation")
	assert.Equal(t, dataapi.DatasetExportContentType("text/csv; charset=utf-8"), b.ContentType)
	assert.Equal(t, int64(3), b.RowCount)
	assert.Equal(t, int64(RowLimit), b.RowLimit)
	assert.False(t, b.Truncated)
	assert.Equal(t, "fleet.trips", b.DatasetId)
}

// Up to 10 000 rows by pages of queryDataset; more matching rows — the first 10 000 and truncated.
func TestExportTruncates(t *testing.T) {
	t.Parallel()
	f := fakeSet(RowLimit+5, true)
	res, err := runExport(t, f, "fleet.trips")
	require.NoError(t, err)
	b := res.(dataapi.ExportDataset200JSONResponse).Body //nolint:forcetypeassert // checked by TestExportFile
	assert.Equal(t, int64(RowLimit), b.RowCount)
	assert.True(t, b.Truncated)
	assert.Equal(t, RowLimit+1, strings.Count(b.Content, "\r\n"))
	assert.Equal(t, RowLimit/pageLimit, f.queries)

	f = fakeSet(RowLimit, true)
	res, err = runExport(t, f, "fleet.trips")
	require.NoError(t, err)
	assert.False(t, res.(dataapi.ExportDataset200JSONResponse).Body.Truncated, "exactly 10 000 rows") //nolint:forcetypeassert // as above
}

func TestExportRefusals(t *testing.T) {
	t.Parallel()
	_, err := runExport(t, fakeSet(1, false), "fleet.trips")
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "a dataset without export — 403: %v", err)

	_, err = runExport(t, fakeSet(1, true), "fleet.unknown")
	assert.True(t, problem.Is(err, problem.CodeNotFound), "an unknown dataset — the 404 of queryDataset: %v", err)

	f := fakeSet(1, true)
	f.invalid = true
	res, err := runExport(t, f, "fleet.trips")
	require.NoError(t, err)
	_, is := res.(dataapi.ExportDataset422ApplicationProblemPlusJSONResponse)
	assert.True(t, is, "a hidden field — the 422 of queryDataset, got %T", res)
}

// fakeScoper answers a predicate per action.
type fakeScoper map[string]authz.Predicate

func (f fakeScoper) ScopeQuery(_ context.Context, _ tenantctx.TenantContext, action string, c authz.Columns, start int) (authz.Predicate, error) {
	p, ok := f[action]
	if !ok {
		return authz.Predicate{SQL: "false"}, nil
	}
	sql := strings.ReplaceAll(p.SQL, "$1", "$"+strconv.Itoa(start+1))
	sql = strings.ReplaceAll(sql, "{unit}", c.Unit)
	return authz.Predicate{SQL: sql, Args: p.Args}, nil
}

// The rows of an export are in the scope of the dataset permission AND of data.export over the same unit column.
func TestExportScope(t *testing.T) {
	t.Parallel()
	cols := authz.Columns{Unit: "t.unit_id", Persons: []string{"t.driver_person_id"}}
	s := ExportScope{Scoper: fakeScoper{
		"fleet.trips.read": {SQL: "{unit} = any($1)", Args: []any{"msk1,msk2"}},
		actionExport:       {SQL: "{unit} = any($1)", Args: []any{"msk1"}},
		"fleet.all":        {SQL: "true"},
	}}
	p, err := s.ScopeQuery(t.Context(), tenantctx.TenantContext{}, "fleet.trips.read", cols, 2)
	require.NoError(t, err)
	assert.Equal(t, "((t.unit_id = any($3)) and (t.unit_id = any($4)))", p.SQL)
	assert.Equal(t, []any{"msk1,msk2", "msk1"}, p.Args)

	p, err = s.ScopeQuery(t.Context(), tenantctx.TenantContext{}, "fleet.expenses.read", cols, 0)
	require.NoError(t, err)
	assert.Equal(t, "false", p.SQL, "no dataset permission — no row")

	p, err = s.ScopeQuery(t.Context(), tenantctx.TenantContext{}, actionExport, cols, 0)
	require.NoError(t, err)
	assert.Equal(t, "t.unit_id = any($1)", p.SQL, "data.export itself is not narrowed")

	none := ExportScope{Scoper: fakeScoper{"fleet.trips.read": {SQL: "true"}}}
	p, err = none.ScopeQuery(t.Context(), tenantctx.TenantContext{}, "fleet.trips.read", cols, 0)
	require.NoError(t, err)
	assert.Equal(t, "false", p.SQL, "no data.export — no row")
}
