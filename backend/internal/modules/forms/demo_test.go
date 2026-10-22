package forms

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// statement is an insert of the demo with its arguments.
type statement struct {
	table string
	args  []any
}

func record(t *testing.T, tenant string) []statement {
	t.Helper()
	var out []statement
	ex := func(_ context.Context, q string, args ...any) error {
		f := strings.Fields(q)
		switch {
		case len(f) > 2 && f[0] == "insert":
			out = append(out, statement{f[2], args})
		case strings.Contains(q, "setval"):
			out = append(out, statement{"setval", args})
		}
		return nil
	}
	id := func(proto string) uuid.UUID {
		return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:"+tenant+":"+proto))
	}
	require.NoError(t, WriteDemo(t.Context(), ex, tenant, id))
	return out
}

func inserts(st []statement, table string) int {
	n := 0
	for _, s := range st {
		if s.table == table {
			n++
		}
	}
	return n
}

// The forms of the seed 14.10 (domain W4.20, MSW seedForms): «Альта» — «Осмотр машины» v1–v3 with the rules au-1
// (задача) and au-2 (строка «Осмотры»), the draft of the report of the foreman, the accepted responses R-0988 (v2) and
// R-1012 (v3) with their lines of the journal; the counter of the numbers after R-1012; «Лотос» — no forms.
func TestWriteDemo(t *testing.T) {
	t.Parallel()
	st := record(t, "t-alta")
	for table, n := range map[string]int{"forms.forms": 2, "forms.drafts": 2, "forms.versions": 3, "forms.rules": 2,
		"forms.responses": 2, "forms.response_actions": 2, "setval": 1} {
		assert.Equal(t, n, inserts(st, table), table)
	}
	assert.Empty(t, record(t, "t-lotos"))
}

// The definitions of the versions follow toDefV2 of MSW: a section is a page, the options of «Чек-лист: кузов, шины,
// документы» come from its label, a condition «да» of «Да / нет» is "true".
func TestDemoDefinitions(t *testing.T) {
	t.Parallel()
	d := demoVersions()[2].def
	assert.Equal(t, []string{"Фото", "Показания", "Проверка", "Дефекты"}, []string{d.Pages[0].Title, d.Pages[1].Title, d.Pages[2].Title, d.Pages[3].Title})
	keys := []string{}
	for _, q := range d.Fields {
		keys = append(keys, q.Key)
	}
	assert.Equal(t, []string{"q-photos", "q-odo", "q-fuel", "q-checks", "q-defect", "q-defect-text", "q-critical"}, keys)
	fuel, checks, text := d.Fields[2], d.Fields[3], d.Fields[5]
	assert.Equal(t, []string{"¼", "½", "¾", "Полный"}, labels(*fuel.Options))
	assert.Equal(t, []string{"o1", "o2", "o3"}, optionKeys(*checks.Options))
	assert.Equal(t, []string{"кузов", "шины", "документы"}, labels(*checks.Options))
	require.NotNil(t, text.ShowIf)
	raw, err := json.Marshal(text.ShowIf)
	require.NoError(t, err)
	assert.JSONEq(t, `{"mode":"all","conditions":[{"fieldKey":"q-defect","operator":"equals","value":"true"}]}`, string(raw))
	assert.Equal(t, 7, questionCount(d))
}

// The answers of the seed are the values of MSW answerOf: a number without its spaces, a choice by its key, «нет» is
// false, a photo of the seed is a text.
func TestDemoAnswers(t *testing.T) {
	t.Parallel()
	rs := demoResponses()
	require.Len(t, rs, 2)
	raw, err := json.Marshal(rs[1].answers)
	require.NoError(t, err)
	assert.JSONEq(t, `[{"fieldKey":"q-photos","value":{"type":"text","value":"5 фото"}},
		{"fieldKey":"q-odo","value":{"type":"decimal","value":"84210"}},
		{"fieldKey":"q-fuel","value":{"type":"choices","value":["o3"]}},
		{"fieldKey":"q-checks","value":{"type":"choices","value":["o1","o2","o3"]}},
		{"fieldKey":"q-defect","value":{"type":"boolean","value":false}}]`, string(raw))
	assert.Equal(t, []any{988, 2, "Рейс Р-171", "m-gromov"}, []any{rs[0].number, rs[0].version, rs[0].subject, rs[0].author})
	assert.Equal(t, "2026-09-27T06:05:00Z", rs[1].at.UTC().Format("2006-01-02T15:04:05Z"))
}

func labels(os []fapi.FormOption) []string {
	out := []string{}
	for _, o := range os {
		out = append(out, o.Label)
	}
	return out
}

func optionKeys(os []fapi.FormOption) []string {
	out := []string{}
	for _, o := range os {
		out = append(out, o.Key)
	}
	return out
}
