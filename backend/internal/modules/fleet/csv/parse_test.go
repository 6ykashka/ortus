package csv

import (
	"errors"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// header is the header of the required columns (createVehicleImport) with «;».
const header = "registration_number;display_name;body_type;payload_kg;volume_m3;cargo_length_m;cargo_width_m;cargo_height_m;odometer_km"

func TestParseSemicolonBOMAndLines(t *testing.T) {
	t.Parallel()
	text := "\xef\xbb\xbf" + strings.ToUpper(header) + ";Depot\r\n" +
		"Х 101 АМ 77;Ford Transit Custom;van;1200;11,5;3,2;1,8;1,9;0;Склад № 1\r\n" +
		"\r\n" +
		";;;;;;;;;\r\n" +
		"\"А 412; МР 77\";ГАЗель Next;Тент;1500;16;4.2;2;2;84370;\r\n"
	recs, err := parse(text)
	require.NoError(t, err)
	require.Len(t, recs, 2, "blank lines and empty rows are skipped")
	assert.Equal(t, 2, recs[0].Line)
	assert.Equal(t, "Х 101 АМ 77", recs[0].Values[colPlate])
	assert.Equal(t, "11,5", recs[0].Values[colVolume])
	assert.Equal(t, "Склад № 1", recs[0].Values[colDepot])
	assert.Equal(t, 5, recs[1].Line, "the line of the file where the record starts")
	assert.Equal(t, "А 412; МР 77", recs[1].Values[colPlate])
}

func TestParseCommaAndExtraValues(t *testing.T) {
	t.Parallel()
	text := strings.ReplaceAll(header, ";", ",") + "\nХ 1,Фургон,van,1,1,1,1,1,0,лишнее\nХ 2,Фургон\n"
	recs, err := parse(text)
	require.NoError(t, err)
	require.Len(t, recs, 2)
	assert.True(t, recs[0].Extra)
	assert.False(t, recs[1].Extra, "a short row is padded with empty values")
	assert.Empty(t, recs[1].Values[colBody])
}

// headerViolation returns the violation of a header error.
func headerViolation(t *testing.T, err error) (string, violation) {
	t.Helper()
	he, ok := errors.AsType[*headerError](err)
	require.True(t, ok, "a header error, got %v", err)
	return he.Detail, he.Violation
}

func TestParseRejectsTheHeader(t *testing.T) {
	t.Parallel()
	detail, v := headerViolation(t, func() error { _, err := parse("display_name;body_type\nФургон;van\n"); return err }())
	assert.Equal(t, "В файле нет обязательной колонки registration_number.", detail)
	assert.Equal(t, violation{Field: "csv", Code: "missing_column", Message: "Нет колонки registration_number (госномер)"}, v)

	detail, v = headerViolation(t, func() error { _, err := parse(header + ";vin\n"); return err }())
	assert.Equal(t, "Неизвестная колонка vin.", detail)
	assert.Equal(t, violation{Field: "csv", Code: "unknown_column", Message: "Неизвестная колонка vin"}, v)

	detail, v = headerViolation(t, func() error { _, err := parse(header + ";depot;Depot\n"); return err }())
	assert.Equal(t, "Колонка depot повторяется.", detail)
	assert.Equal(t, "duplicate_column", v.Code)

	_, v = headerViolation(t, func() error { _, err := parse("   "); return err }())
	assert.Equal(t, "missing_column", v.Code, "an empty file has no required column")
}

func TestParseLimits(t *testing.T) {
	t.Parallel()
	_, err := parse(header + "\n" + strings.Repeat("x", MaxBytes))
	assert.True(t, problem.Is(err, codeTooLarge), "more than 1 MiB — 413: %v", err)

	var b strings.Builder
	b.WriteString(header + "\n")
	for range MaxRows + 1 {
		b.WriteString("Х;Ф;van;1;1;1;1;1;0\n")
	}
	_, err = parse(b.String())
	assert.True(t, problem.Is(err, codeTooLarge), "more than 2000 rows — 413: %v", err)

	_, err = parse(header + "\n\"broken;x\n")
	assert.True(t, problem.Is(err, codeValidation), "a broken quote — 422: %v", err)
}
