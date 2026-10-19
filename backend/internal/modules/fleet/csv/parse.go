package csv

import (
	stdcsv "encoding/csv"
	"errors"
	"io"
	"slices"
	"strconv"
	"strings"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Limits of a file (createVehicleImport: «up to 1 MiB and 2000 data rows; 413 payload_too_large above»).
const (
	MaxRows  = 2000
	MaxBytes = 1 << 20
)

// Problem codes of the answers (api/errors.yaml).
const (
	codeValidation = "validation_failed"
	codeTooLarge   = "payload_too_large"
)

// textTooLarge is the 413 of a file over the limits (MSW W2.52 fleet/imports.ts).
const textTooLarge = "Файл больше 1 МБ или 2000 строк. Разделите его на части."

// Columns of the file (the description of createVehicleImport).
const (
	colPlate     = "registration_number"
	colName      = "display_name"
	colBody      = "body_type"
	colPayload   = "payload_kg"
	colVolume    = "volume_m3"
	colLength    = "cargo_length_m"
	colWidth     = "cargo_width_m"
	colHeight    = "cargo_height_m"
	colOdometer  = "odometer_km"
	colTempMin   = "temperature_min_c"
	colTempMax   = "temperature_max_c"
	colEquipment = "equipment"
	colDepot     = "depot"
	colOrgUnit   = "org_unit"
)

// required are the required columns with the words of the error of a missing one, in the order of the contract.
var required = []struct{ name, label string }{
	{colPlate, "госномер"}, {colName, "название"}, {colBody, "кузов"}, {colPayload, "грузоподъёмность, кг"},
	{colVolume, "объём, м³"}, {colLength, "длина кузова, м"}, {colWidth, "ширина кузова, м"},
	{colHeight, "высота кузова, м"}, {colOdometer, "пробег, км"},
}

// optional are the other columns of the file.
var optional = []string{colTempMin, colTempMax, colEquipment, colDepot, colOrgUnit}

// utf8BOM is the byte order mark spreadsheets put at the start of a UTF-8 CSV.
const utf8BOM = "\xef\xbb\xbf"

// record is a data row of the file: its line (the header is line 1), its values by column (trimmed) and whether it
// has more values than the header has columns.
type record struct {
	Line   int
	Values map[string]string
	Extra  bool
}

// violation is a ProblemViolation of the contract: of a row or of the header.
type violation struct {
	Field   string `json:"field"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// headerError is the 422 of a file whose header the import cannot use: the detail and its violation (field csv).
type headerError struct {
	Detail    string
	Violation violation
}

func (e *headerError) Error() string { return codeValidation + ": " + e.Detail }

func tooLarge() error { return problem.New(codeTooLarge, textTooLarge) }

// parse reads a CSV of vehicles: UTF-8 with an optional byte order mark, a header row, the delimiter «,» or «;»
// detected from the header (as the import of people, W1.05). Blank rows are skipped. A missing required, an unknown
// or a repeated column — the 422 of the header; a broken quote — 422; more than MaxBytes or MaxRows — 413.
func parse(text string) ([]record, error) {
	if len(text) > MaxBytes {
		return nil, tooLarge()
	}
	text = strings.TrimPrefix(text, utf8BOM)
	first, _, _ := strings.Cut(text, "\n")
	r := stdcsv.NewReader(strings.NewReader(text))
	r.Comma = ','
	if strings.Count(first, ";") > strings.Count(first, ",") {
		r.Comma = ';'
	}
	r.FieldsPerRecord = -1
	var head []string
	if strings.TrimSpace(text) != "" {
		var err error
		if head, err = r.Read(); err != nil {
			return nil, readError(err)
		}
	}
	cols, err := headerColumns(head)
	if err != nil {
		return nil, err
	}
	var out []record
	for {
		values, err := r.Read()
		if errors.Is(err, io.EOF) {
			return out, nil
		}
		if err != nil {
			return nil, readError(err)
		}
		if blank(values) {
			continue
		}
		if len(out) == MaxRows {
			return nil, tooLarge()
		}
		line, _ := r.FieldPos(0)
		out = append(out, toRecord(line, cols, values))
	}
}

// readError is the answer to a CSV the reader cannot read (a broken quote).
func readError(err error) error {
	if pe, ok := errors.AsType[*stdcsv.ParseError](err); ok {
		return problem.New(codeValidation, "Не удалось прочитать строку "+strconv.Itoa(pe.StartLine)+": проверьте кавычки.")
	}
	return problem.New(codeValidation, "Не удалось прочитать файл.")
}

// headerColumns maps the header to the known columns (case-insensitive, trimmed): a missing required column first,
// then an unknown or a repeated one.
func headerColumns(header []string) ([]string, error) {
	cols := make([]string, len(header))
	for i, h := range header {
		cols[i] = strings.ToLower(strings.TrimSpace(h))
	}
	for _, c := range required {
		if !slices.Contains(cols, c.name) {
			return nil, &headerError{
				Detail:    "В файле нет обязательной колонки " + c.name + ".",
				Violation: violation{Field: "csv", Code: "missing_column", Message: "Нет колонки " + c.name + " (" + c.label + ")"},
			}
		}
	}
	seen := map[string]bool{}
	for _, c := range cols {
		known := slices.Contains(optional, c) || slices.ContainsFunc(required, func(r struct{ name, label string }) bool { return r.name == c })
		switch {
		case c != "" && !known:
			return nil, &headerError{
				Detail:    "Неизвестная колонка " + c + ".",
				Violation: violation{Field: "csv", Code: "unknown_column", Message: "Неизвестная колонка " + c},
			}
		case seen[c]:
			return nil, &headerError{
				Detail:    "Колонка " + c + " повторяется.",
				Violation: violation{Field: "csv", Code: "duplicate_column", Message: "Колонка " + c + " повторяется"},
			}
		}
		seen[c] = c != ""
	}
	return cols, nil
}

func blank(values []string) bool {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return false
		}
	}
	return true
}

func toRecord(line int, cols, values []string) record {
	rec := record{Line: line, Values: make(map[string]string, len(cols))}
	for i, v := range values {
		v = strings.TrimSpace(v)
		if i >= len(cols) || cols[i] == "" {
			rec.Extra = rec.Extra || v != ""
			continue
		}
		rec.Values[cols[i]] = v
	}
	return rec
}
