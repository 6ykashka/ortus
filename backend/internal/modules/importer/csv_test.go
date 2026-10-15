package importer

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

func TestParseComma(t *testing.T) {
	t.Parallel()
	recs, err := parse("full_name,email,phone\nИван Петров,i.petrov@alta.example,+7 900 000-00-01\n")
	require.NoError(t, err)
	require.Len(t, recs, 1)
	assert.Equal(t, 2, recs[0].Line)
	assert.Equal(t, "Иван Петров", recs[0].Data.FullName)
	assert.Equal(t, "i.petrov@alta.example", recs[0].Data.Email)
	assert.Equal(t, "+7 900 000-00-01", recs[0].Data.Phone)
	assert.False(t, recs[0].Extra)
}

func TestParseSemicolonBOMQuotesAndBlankLines(t *testing.T) {
	t.Parallel()
	text := bom + "Full_Name ; Org_Unit;work_profile;valid_from\r\n" +
		"\"Сидорова; Анна\";Москва-1;driver;2026-10-02\r\n" +
		"\r\n" +
		";;;\r\n" +
		"\"Многострочное\nимя\";Самара;foreman;02.10.2026\r\n"
	recs, err := parse(text)
	require.NoError(t, err)
	require.Len(t, recs, 2, "blank lines and empty rows are skipped")
	assert.Equal(t, 2, recs[0].Line)
	assert.Equal(t, "Сидорова; Анна", recs[0].Data.FullName)
	assert.Equal(t, "Москва-1", recs[0].Data.OrgUnit)
	assert.Equal(t, "driver", recs[0].Data.WorkProfile)
	assert.Equal(t, "2026-10-02", recs[0].Data.ValidFrom)
	assert.Equal(t, 5, recs[1].Line, "the line of the file where the record starts")
	assert.Equal(t, "Многострочное\nимя", recs[1].Data.FullName)
}

func TestParseExtraValues(t *testing.T) {
	t.Parallel()
	recs, err := parse("full_name,email\nИван,i@alta.example,лишнее\nПётр\n")
	require.NoError(t, err)
	require.Len(t, recs, 2)
	assert.True(t, recs[0].Extra)
	assert.False(t, recs[1].Extra, "a short row is padded with empty values")
	assert.Empty(t, recs[1].Data.Email)
}

func TestParseRejectsTheFile(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name, text, code, detail string
	}{
		{"unknown column", "full_name,salary\nИван,1\n", kit.CodeValidationFailed, "salary"},
		{"missing full_name", "email\ni@alta.example\n", kit.CodeValidationFailed, "full_name"},
		{"duplicate column", "full_name,email,EMAIL\nИван,a@b.c,a@b.c\n", kit.CodeValidationFailed, "email"},
		{"empty", "", kit.CodeValidationFailed, ""},
		{"bad quotes", "full_name\n\"Иван\"Петров\n", kit.CodeValidationFailed, ""},
		{"too many rows", "full_name\n" + strings.Repeat("Иван\n", MaxRows+1), kit.CodePayloadTooLarge, ""},
		{"too large", "full_name\n" + strings.Repeat("а", MaxBytes), kit.CodePayloadTooLarge, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			_, err := parse(c.text)
			require.Error(t, err)
			assert.True(t, problem.Is(err, c.code), "%v", err)
			if c.detail != "" {
				assert.Contains(t, err.Error(), c.detail)
			}
		})
	}
}

func TestParseExactlyMaxRows(t *testing.T) {
	t.Parallel()
	recs, err := parse("full_name\n" + strings.Repeat("Иван\n", MaxRows))
	require.NoError(t, err)
	assert.Len(t, recs, MaxRows)
}

// bom is the byte order mark Excel writes at the start of a UTF-8 CSV.
const bom = "\xef\xbb\xbf"

var msk = time.FixedZone("MSK", 3*60*60)

func fields(vs []violation) []string {
	out := make([]string, 0, len(vs))
	for _, v := range vs {
		out = append(out, v.Field+":"+v.Code)
	}
	return out
}

func TestCheckStatic(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 1, 10, 30, 0, 0, msk)
	ok := rowData{FullName: "Иван Петров", Email: "I.Petrov@Alta.Example", Phone: "8 (900) 000-00-01", WorkProfile: "practitioner", ValidFrom: "01.10.2026"}
	got := checkStatic(record{Line: 2, Data: ok}, now, msk)
	assert.Empty(t, got.Errors)
	assert.Equal(t, "i.petrov@alta.example", got.Email, "e-mail in lower case")
	assert.Equal(t, "79000000001", got.Phone, "digits, 8 → 7")
	assert.Equal(t, "therapist", got.Function)
	require.NotNil(t, got.From)
	assert.True(t, got.From.Equal(time.Date(2026, 10, 1, 0, 0, 0, 0, msk)), "a date starts at its midnight; today is a correction of the current day")

	later := checkStatic(record{Line: 3, Data: rowData{FullName: "Пётр", WorkProfile: "driver", ValidFrom: "2026-10-05"}}, now, msk)
	assert.Empty(t, later.Errors)
	assert.True(t, later.From.Equal(time.Date(2026, 10, 5, 0, 0, 0, 0, msk)))

	noDate := checkStatic(record{Line: 4, Data: rowData{FullName: "Пётр", WorkProfile: "foreman"}}, now, msk)
	assert.Empty(t, noDate.Errors)
	assert.True(t, noDate.From.Equal(now), "without valid_from the function starts now")

	bad := []struct {
		data rowData
		want string
	}{
		{rowData{}, "full_name:required"},
		{rowData{FullName: strings.Repeat("я", 151)}, "full_name:too_long"},
		{rowData{FullName: "Иван", Email: "ivan"}, "email:format"},
		{rowData{FullName: "Иван", Phone: "12-34"}, "phone:format"},
		{rowData{FullName: "Иван", WorkProfile: "worker"}, "work_profile:unknown"},
		{rowData{FullName: "Иван", WorkProfile: "driver", ValidFrom: "завтра"}, "valid_from:format"},
		{rowData{FullName: "Иван", WorkProfile: "driver", ValidFrom: "2026-09-30"}, "valid_from:past"},
		{rowData{FullName: "Иван", ValidFrom: "2026-10-05"}, "valid_from:without_function"},
	}
	for _, c := range bad {
		got := checkStatic(record{Line: 2, Data: c.data}, now, msk)
		assert.Contains(t, fields(got.Errors), c.want, "%+v", c.data)
	}
	extra := checkStatic(record{Line: 2, Data: ok, Extra: true}, now, msk)
	assert.Contains(t, fields(extra.Errors), "row:extra_values")
}
