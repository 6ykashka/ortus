package importer

import (
	"encoding/csv"
	"errors"
	"io"
	"slices"
	"strconv"
	"strings"

	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Limits of a file (createPeopleImport: «up to 1 MiB and 2000 data rows; 413 payload_too_large above»).
const (
	MaxRows  = 2000
	MaxBytes = 1 << 20
)

// Columns of the file (the contract of createPeopleImport); full_name is required.
const (
	colFullName    = "full_name"
	colEmail       = "email"
	colPhone       = "phone"
	colOrgUnit     = "org_unit"
	colWorkProfile = "work_profile"
	colValidFrom   = "valid_from"
)

var columns = []string{colFullName, colEmail, colPhone, colOrgUnit, colWorkProfile, colValidFrom}

// utf8BOM is the byte order mark spreadsheets put at the start of a UTF-8 CSV.
const utf8BOM = "\xef\xbb\xbf"

// rowData are the values of a row as written in the file, trimmed; they are kept in people.import_rows.data (the
// raw file is not stored) and checked again at commit.
type rowData struct {
	FullName    string `json:"fullName"`
	Email       string `json:"email,omitempty"`
	Phone       string `json:"phone,omitempty"`
	OrgUnit     string `json:"orgUnit,omitempty"`
	WorkProfile string `json:"workProfile,omitempty"`
	ValidFrom   string `json:"validFrom,omitempty"`
}

// record is a data row of the file: its line (the header is line 1) and values; Extra — more values than columns.
type record struct {
	Line  int
	Data  rowData
	Extra bool
}

func tooLarge(detail string) error { return problem.New(kit.CodePayloadTooLarge, detail) }

// parse reads a CSV of people: UTF-8 with an optional byte order mark, a header row, the delimiter «,» or «;»
// detected from the header. Blank rows are skipped. An unknown, repeated or missing required column, a broken
// quote — 422 validation_failed; more than MaxBytes or MaxRows — 413 payload_too_large.
func parse(text string) ([]record, error) {
	if len(text) > MaxBytes {
		return nil, tooLarge("Файл больше 1 МБ.")
	}
	text = strings.TrimPrefix(text, utf8BOM)
	if strings.TrimSpace(text) == "" {
		return nil, kit.Invalid("Файл пустой.")
	}
	first, _, _ := strings.Cut(text, "\n")
	r := csv.NewReader(strings.NewReader(text))
	r.Comma = ','
	if strings.Count(first, ";") > strings.Count(first, ",") {
		r.Comma = ';'
	}
	r.FieldsPerRecord = -1
	header, err := r.Read()
	if err != nil {
		return nil, readError(err)
	}
	cols, err := headerColumns(header)
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
			return nil, tooLarge("В файле больше 2000 строк.")
		}
		line, _ := r.FieldPos(0)
		out = append(out, toRecord(line, cols, values))
	}
}

// readError is the answer to a CSV the reader cannot read (a broken quote).
func readError(err error) error {
	if pe, ok := errors.AsType[*csv.ParseError](err); ok {
		return problem.New(kit.CodeValidationFailed, "Не удалось прочитать строку "+strconv.Itoa(pe.StartLine)+": проверьте кавычки.")
	}
	return kit.Invalid("Не удалось прочитать файл.")
}

// headerColumns maps the header to the known columns (case-insensitive, trimmed).
func headerColumns(header []string) ([]string, error) {
	seen := map[string]bool{}
	cols := make([]string, len(header))
	for i, h := range header {
		c := strings.ToLower(strings.TrimSpace(h))
		switch {
		case !slices.Contains(columns, c):
			return nil, kit.Invalid("Неизвестная колонка «" + c + "». Допустимы: " + strings.Join(columns, ", ") + ".")
		case seen[c]:
			return nil, kit.Invalid("Колонка «" + c + "» повторяется.")
		}
		seen[c] = true
		cols[i] = c
	}
	if !seen[colFullName] {
		return nil, kit.Invalid("Нет обязательной колонки " + colFullName + ".")
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
	rec := record{Line: line}
	for i, v := range values {
		v = strings.TrimSpace(v)
		if i >= len(cols) {
			rec.Extra = rec.Extra || v != ""
			continue
		}
		switch cols[i] {
		case colFullName:
			rec.Data.FullName = v
		case colEmail:
			rec.Data.Email = v
		case colPhone:
			rec.Data.Phone = v
		case colOrgUnit:
			rec.Data.OrgUnit = v
		case colWorkProfile:
			rec.Data.WorkProfile = v
		case colValidFrom:
			rec.Data.ValidFrom = v
		}
	}
	return rec
}
