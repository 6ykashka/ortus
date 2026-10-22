package forms

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

func csvLines(cols []question, rows []csvRow) []string {
	out := csvOf(cols, rows)
	return strings.Split(strings.TrimPrefix(out, "\xef\xbb\xbf"), "\r\n")
}

// Cells of the export of responses (exportFormResponses): RFC 4180, «;», CRLF, BOM, an apostrophe before a text cell
// starting with = + - @ TAB CR (also after spaces); numbers, dates and «да / нет» never.
func TestCSV(t *testing.T) {
	t.Parallel()
	cols := []question{
		q("q-name", fapi.FormQuestionTypeText, "Имя", false),
		q("q-sum", fapi.FormQuestionTypeNumber, "Сумма", false),
		q("q-day", fapi.FormQuestionTypeDate, "Дата", false),
		q("q-note", fapi.FormQuestionTypeLongtext, "=Комментарий", false),
	}
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	row := csvRow{number: "R-0001", at: at, author: "Гость", version: 1, status: "pending", vals: answers{
		"q-name": *val(t, `{"type":"text","value":"=HYPERLINK(\"http://x\";\"y\")"}`),
		"q-sum":  *val(t, `{"type":"decimal","value":"-5"}`),
		"q-day":  *val(t, `{"type":"date","value":"2026-10-01"}`),
		"q-note": *val(t, `{"type":"text","value":"  @SUM(A1)"}`),
	}}
	out := csvOf(cols, []csvRow{row})
	assert.True(t, strings.HasPrefix(out, "\xef\xbb\xbf"), "BOM")
	assert.True(t, strings.HasSuffix(out, "\r\n"))
	lines := csvLines(cols, []csvRow{row})
	assert.Equal(t, "Ответ;Дата;Автор;Объект;Версия;Статус;Имя;Сумма;Дата;'=Комментарий", lines[0])
	assert.True(t, strings.HasPrefix(lines[1], "R-0001;01.10.2026 10:30;Гость;;v1;На проверке;"), lines[1])
	assert.Contains(t, lines[1], `"'=HYPERLINK(""http://x"";""y"")"`)
	cells := strings.Split(lines[1], ";")
	assert.Equal(t, "-5", cells[len(cells)-3])
	assert.Equal(t, "01.10.2026", cells[len(cells)-2])
	assert.Equal(t, "'  @SUM(A1)", cells[len(cells)-1])

	row2 := csvRow{number: "R-0002", at: at, author: "-Иван", object: "@Рейс", version: 2, status: "accepted", vals: answers{
		"q-name": *val(t, `{"type":"text","value":"строка\rвторая"}`),
		"q-note": *val(t, `{"type":"text","value":"+7 900"}`),
	}}
	line := csvLines(cols, []csvRow{row2})[1]
	assert.Contains(t, line, ";'-Иван;'@Рейс;v2;Принят;")
	assert.Contains(t, line, "\"строка\rвторая\"")
	assert.True(t, strings.HasSuffix(line, ";'+7 900"), line)
	assert.Equal(t, "Отклонён", statusLabel("rejected"))
}

// Return 1: the protection follows the value, not the question — a parameter of a link is stored as text in a hidden
// question of any type (Q-W4.00-forms-20), so a text in a column of numbers, dates or «да / нет» gets its apostrophe;
// a real number, date, sum or «да / нет» never.
func TestCSVFormulaByValue(t *testing.T) {
	t.Parallel()
	cols := []question{
		q("q-n", fapi.FormQuestionTypeNumber, "Номер", false),
		q("q-day", fapi.FormQuestionTypeDate, "Дата", false),
		q("q-ok", fapi.FormQuestionTypeBool, "Да / нет", false),
		q("q-sum", fapi.FormQuestionTypeMoney, "Сумма", false),
	}
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	injected := csvRow{number: "R-0003", at: at, version: 1, status: "pending", vals: answers{
		"q-n":   *val(t, `{"type":"text","value":"=HYPERLINK(\"http://x\",\"y\")"}`),
		"q-day": *val(t, `{"type":"date","value":"+1-1"}`),
		"q-ok":  *val(t, `{"type":"text","value":"@SUM(A1)"}`),
		"q-sum": *val(t, `{"type":"text","value":"-2+3"}`),
	}}
	cells := strings.Split(csvLines(cols, []csvRow{injected})[1], ";")
	assert.Equal(t, []string{`"'=HYPERLINK(""http://x"",""y"")"`, "'+1-1", "'@SUM(A1)", "'-2+3"}, cells[len(cells)-4:])
	plain := csvRow{number: "R-0004", at: at, version: 1, status: "accepted", vals: answers{
		"q-n":   *val(t, `{"type":"decimal","value":"-5"}`),
		"q-day": *val(t, `{"type":"date","value":"2026-10-01"}`),
		"q-ok":  *val(t, `{"type":"boolean","value":true}`),
		"q-sum": *val(t, `{"type":"money","value":{"amountMinor":-1250,"currency":"RUB"}}`),
	}}
	cells = strings.Split(csvLines(cols, []csvRow{plain})[1], ";")
	assert.Equal(t, []string{"-5", "01.10.2026", "да", "-12.5"}, cells[len(cells)-4:])
}

// The columns of the summary, the table and CSV: the questions of all versions, the fresh version first, statements out.
func TestColumnsOf(t *testing.T) {
	t.Parallel()
	v1 := defOf(q("q-photos", fapi.FormQuestionTypePhoto, "Фото", true), q("q-fuel-t", fapi.FormQuestionTypeText, "Уровень топлива", false))
	v2 := defOf(q("q-photos", fapi.FormQuestionTypePhoto, "Фото, одометр", true), q("s", fapi.FormQuestionTypeStatement, "Текст", false),
		q("q-fuel", fapi.FormQuestionTypeChoice, "Уровень топлива", true))
	cols := columnsOf([]def{v2, v1})
	keys := []string{}
	for _, c := range cols {
		keys = append(keys, c.Key)
	}
	assert.Equal(t, []string{"q-photos", "q-fuel", "q-fuel-t"}, keys)
	assert.Equal(t, "Фото, одометр", cols[0].Label)
}

// «Сводка»: answered, options with percents, numbers, three latest texts.
func TestSummaryOf(t *testing.T) {
	t.Parallel()
	fuel := q("q-fuel", fapi.FormQuestionTypeChoice, "Топливо", true)
	fuel.Options = opts("¼", "½", "¾")
	cols := []question{fuel, q("q-defect", fapi.FormQuestionTypeBool, "Дефекты", false),
		q("q-odo", fapi.FormQuestionTypeNumber, "Пробег", true), q("q-note", fapi.FormQuestionTypeText, "Заметка", false)}
	rows := []answers{
		{"q-fuel": *val(t, `{"type":"choices","value":["o3"]}`), "q-defect": *val(t, `{"type":"boolean","value":false}`),
			"q-odo": *val(t, `{"type":"decimal","value":"84210"}`), "q-note": *val(t, `{"type":"text","value":"ok"}`)},
		{"q-fuel": *val(t, `{"type":"choices","value":["o3"]}`), "q-odo": *val(t, `{"type":"decimal","value":"83902"}`)},
		{"q-fuel": *val(t, `{"type":"choices","value":["o1"]}`), "q-odo": *val(t, `{"type":"decimal","value":"100.333"}`)},
	}
	id := uuid.New()
	s := summaryOf(id, cols, rows)
	assert.Equal(t, id, s.FormId)
	assert.Equal(t, 3, s.Total)
	require.Len(t, s.Questions, 4)
	assert.Equal(t, 3, s.Questions[0].Answered)
	assert.Equal(t, []fapi.FormOptionCount{{Key: "o1", Label: "¼", Count: 1, Percent: 33}, {Key: "o2", Label: "½", Count: 0, Percent: 0},
		{Key: "o3", Label: "¾", Count: 2, Percent: 67}}, *s.Questions[0].Options)
	assert.Equal(t, []fapi.FormOptionCount{{Key: "true", Label: "Да", Count: 0, Percent: 0}, {Key: "false", Label: "Нет", Count: 1, Percent: 100}},
		*s.Questions[1].Options)
	assert.Equal(t, fapi.FormNumberStats{Average: "56070.78", Min: "100.33", Max: "84210"}, *s.Questions[2].Numbers)
	assert.Nil(t, s.Questions[2].RecentTexts)
	assert.Equal(t, []string{"ok"}, *s.Questions[3].RecentTexts)
}
