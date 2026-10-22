package forms

import (
	"math/big"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// moscow is the time of the organization of the prototype (UTC+3): «Принимать до», the labels of time.
var moscow = time.FixedZone("MSK", 3*60*60)

// bom opens the file of the export («BOM» of the prototype, dc:679–683).
const bom = "\xef\xbb\xbf"

// csvRow is a response as a row of the export.
type csvRow struct {
	number         string
	at             time.Time
	author, object string
	version        int
	status         string
	vals           answers
}

// statusLabel is the label of the status of review of a response.
func statusLabel(status string) string {
	switch status {
	case string(fapi.FormResponseReviewStatusAccepted):
		return textAccepted
	case string(fapi.FormResponseReviewStatusRejected):
		return textRejected
	}
	return textPending
}

// formulaRE is the start of a formula of a spreadsheet: = + - @ (also after leading spaces), TAB, CR.
var formulaRE = regexp.MustCompile(`^(?:[\t\r]|\s*[=+\-@])`)

// Cells of numbers and dates the server writes itself (labelOf): «-5», «84210.5», «01.10.2026».
var (
	numberCellRE = regexp.MustCompile(`^-?\d+(?:[.,]\d+)?$`)
	dateCellRE   = regexp.MustCompile(`^\d\d\.\d\d\.\d{4}$`)
)

// plainCell reports whether the cell label of v is a number, a date, a sum or «да / нет» the server made — no
// apostrophe («-5» stays a number). It follows the value, not the question (return 1): a parameter of a link is stored
// as text in a hidden question of any type (Q-W4.00-forms-20), and a text is always protected.
func plainCell(v *value, label string) bool {
	if v == nil {
		return true
	}
	switch v.Type {
	case vBoolean:
		return true
	case vDecimal, vMoney:
		return numberCellRE.MatchString(label)
	case vDate:
		return dateCellRE.MatchString(label)
	}
	return false
}

// csvCell is a cell of the export (exportFormResponses): a text cell starting with a formula gets an apostrophe (CSV
// formula injection, OWASP); «;», quotes, CR and LF are quoted by RFC 4180.
func csvCell(s string, text bool) string {
	if text && formulaRE.MatchString(s) {
		s = "'" + s
	}
	if strings.ContainsAny(s, ";\"\r\n") {
		return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
	}
	return s
}

// csvOf is the file of the export: «Ответ;Дата;Автор;Объект;Версия;Статус;…» and the questions cols, a row per response.
func csvOf(cols []question, rows []csvRow) string {
	var b strings.Builder
	b.WriteString(bom)
	head := []string{"Ответ", "Дата", "Автор", "Объект", "Версия", "Статус"}
	for _, c := range cols {
		head = append(head, c.Label)
	}
	for i, h := range head {
		head[i] = csvCell(h, true)
	}
	b.WriteString(strings.Join(head, ";") + "\r\n")
	for _, r := range rows {
		line := []string{
			csvCell(r.number, false),
			csvCell(r.at.In(moscow).Format("02.01.2006 15:04"), false),
			csvCell(r.author, true),
			csvCell(r.object, true),
			csvCell("v"+strconv.Itoa(r.version), false),
			csvCell(statusLabel(r.status), false),
		}
		for _, c := range cols {
			var v *value
			if x, ok := r.vals[c.Key]; ok {
				v = &x
			}
			label := labelOf(&c, v)
			line = append(line, csvCell(label, !plainCell(v, label)))
		}
		b.WriteString(strings.Join(line, ";") + "\r\n")
	}
	return b.String()
}

// columnsOf are the questions of all versions (newest first), each key once with its freshest form, statements out
// (respCols of the prototype, dc:985).
func columnsOf(versions []def) []question {
	seen := map[string]bool{}
	var out []question
	for _, d := range versions {
		for _, x := range d.Fields {
			if x.Type == fapi.FormQuestionTypeStatement || seen[x.Key] {
				continue
			}
			seen[x.Key] = true
			out = append(out, x)
		}
	}
	return out
}

// recentTexts is the number of the latest texts of a card of the summary.
const recentTexts = 3

// summaryOf is «Сводка» over the answers of rows (newest first) by the columns cols.
func summaryOf(formID uuid.UUID, cols []question, rows []answers) fapi.FormResponseSummary {
	out := fapi.FormResponseSummary{FormId: formID, Total: len(rows), Questions: []fapi.FormQuestionSummary{}}
	for _, c := range cols {
		var vals []value
		for _, r := range rows {
			if v, ok := r[c.Key]; ok && !isEmpty(&v) {
				vals = append(vals, v)
			}
		}
		s := fapi.FormQuestionSummary{FieldKey: c.Key, Label: c.Label, Type: c.Type, Answered: len(vals)}
		choice := optionType(c.Type) || c.Type == fapi.FormQuestionTypeBool
		if choice {
			s.Options = new(optionCounts(c, vals))
		}
		if st := numberStats(vals); st != nil {
			s.Numbers = st
		} else if !choice {
			texts := []string{}
			for _, v := range vals[:min(len(vals), recentTexts)] {
				texts = append(texts, clip(labelOf(&c, &v), 500))
			}
			s.RecentTexts = &texts
		}
		out.Questions = append(out.Questions, s)
	}
	return out
}

// optionCounts are the bars «n · p%» of a question of choice or «Да / нет».
func optionCounts(c question, vals []value) []fapi.FormOptionCount {
	type opt struct{ key, label string }
	var os []opt
	if c.Type == fapi.FormQuestionTypeBool {
		os = []opt{{"true", "Да"}, {"false", "Нет"}}
	} else {
		for _, o := range options(c) {
			os = append(os, opt{o.Key, o.Label})
		}
	}
	out := []fapi.FormOptionCount{}
	for _, o := range os {
		n := 0
		for i := range vals {
			if has(&vals[i], o.key) {
				n++
			}
		}
		pct := 0
		if len(vals) > 0 {
			pct = int(float64(n*100)/float64(len(vals)) + 0.5)
		}
		out = append(out, fapi.FormOptionCount{Key: o.key, Label: o.label, Count: n, Percent: pct})
	}
	return out
}

// numberStats are «Среднее … · мин … · макс …» of the decimal answers (nil — none), rounded to hundredths.
func numberStats(vals []value) *fapi.FormNumberStats {
	var nums []*big.Rat
	for _, v := range vals {
		if v.Type != vDecimal {
			continue
		}
		if n, ok := new(big.Rat).SetString(strings.ReplaceAll(v.str(), ",", ".")); ok {
			nums = append(nums, n)
		}
	}
	if len(nums) == 0 {
		return nil
	}
	sum, lo, hi := new(big.Rat), nums[0], nums[0]
	for _, n := range nums {
		sum.Add(sum, n)
		if n.Cmp(lo) < 0 {
			lo = n
		}
		if n.Cmp(hi) > 0 {
			hi = n
		}
	}
	avg := new(big.Rat).Quo(sum, big.NewRat(int64(len(nums)), 1))
	return &fapi.FormNumberStats{Average: decimal(avg), Min: decimal(lo), Max: decimal(hi)}
}

// decimal is r rounded to hundredths without trailing zeros (String(Math.round(n * 100) / 100)).
func decimal(r *big.Rat) string {
	s := r.FloatString(2)
	if strings.Contains(s, ".") {
		s = strings.TrimRight(strings.TrimRight(s, "0"), ".")
	}
	if s == "-0" {
		return "0"
	}
	return s
}

// clip is s cut to n characters.
func clip(s string, n int) string {
	rs := []rune(s)
	if len(rs) <= n {
		return s
	}
	return string(rs[:n])
}
