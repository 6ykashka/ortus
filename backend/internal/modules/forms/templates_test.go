package forms

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// example reads an example of the contract (api/openapi/examples) — the snapshot of the scenario server W4.05 over
// the domain W4.20: the parity of the code catalogue of templates (Q-W4.00-forms-14).
func example(t *testing.T, name string, out any) {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "api", "openapi", "examples", name+".json")) //nolint:gosec // G304: an example of the repository
	require.NoError(t, err)
	require.NoError(t, json.Unmarshal(b, out))
}

// The 15 templates of the code catalogue in the order of the prototype — the same as the domain (listFormTemplates/ok).
func TestTemplatesParity(t *testing.T) {
	t.Parallel()
	var want fapi.FormTemplateList
	example(t, "listFormTemplates/ok", &want)
	got := templateList(func(string) bool { return true })
	require.Len(t, got.Items, 15)
	for i := range want.Items {
		w, g := want.Items[i], got.Items[i]
		w.Available = true
		assert.Equal(t, w, g, w.Id)
	}
	got = templateList(func(key string) bool { return key == "fleet" })
	assert.False(t, got.Items[13].Available, "tpl-foreman: «Ремонт и стройка» is not active")
	assert.True(t, got.Items[12].Available)
	assert.True(t, got.Items[0].Available, "a template of every organization")
}

// The draft of a template is FormDefinition v2 (toDefV2 of MSW): pages p1…, options o1…, conditions by keys.
func TestTemplateDefinition(t *testing.T) {
	t.Parallel()
	fb, ok := templateByID("tpl-feedback")
	require.True(t, ok)
	d := fb.definition()
	keys := []string{}
	for _, x := range d.Fields {
		keys = append(keys, x.Key)
	}
	assert.Equal(t, []string{"q-rate", "q-recommend", "q-better", "q-comment", "q-phone"}, keys)
	assert.Equal(t, []fapi.FormPageDefinition{{Id: "p1", Title: "Отзыв"}}, d.Pages)
	assert.Equal(t, showIf(fapi.FormShowIfModeAll, eq("q-recommend", "o2")), d.Fields[2].ShowIf, "«Нет» is the option o2")
	assert.Equal(t, fapi.FormSettingsAccessPublic, fb.settings().api().Access)

	req, _ := templateByID("tpl-request")
	rd := req.definition()
	assert.Equal(t, []fapi.FormPageDefinition{{Id: "p1", Title: "Что нужно"}, {Id: "p2", Title: "Контакты"}}, rd.Pages)
	why := rd.Fields[len(rd.Fields)-1]
	assert.Equal(t, "q-why", why.Key)
	assert.Equal(t, "p2", why.PageId)
	assert.Equal(t, showIf(fapi.FormShowIfModeAll, eq("q-urgent", "true")), why.ShowIf, "«да» of «Да / нет» is true")
	photo := rd.Fields[3]
	assert.Equal(t, fapi.FormQuestionAcceptPhoto, *photo.Accept)
	assert.Equal(t, 5, *photo.MaxFiles)
	assert.Equal(t, 20, *photo.MaxFileMb)

	quiz, _ := templateByID("tpl-quiz")
	s := quiz.settings().api()
	assert.True(t, s.Scoring)
	assert.Equal(t, 4, *s.PassScore)
	qd := quiz.definition()
	assert.Equal(t, []fapi.FormOption{{Key: "o1", Label: "Выехать и сообщить после рейса", Score: new(0)},
		{Key: "o2", Label: "Отметить дефект в осмотре и сообщить менеджеру", Score: new(1)},
		{Key: "o3", Label: "Ничего, если дефект мелкий", Score: new(0)}}, *qd.Fields[0].Options)

	nps, _ := templateByID("tpl-nps")
	n := nps.definition().Fields[0]
	assert.Equal(t, fapi.FormQuestionScaleMin(0), *n.ScaleMin)
	assert.Equal(t, 10, *n.ScaleMax)
	assert.Equal(t, "Точно нет", *n.ScaleLeftLabel)

	sup, _ := templateByID("tpl-support")
	left := sup.definition().Fields[3]
	assert.Equal(t, showIf(fapi.FormShowIfModeAny, eq("q-solved", "o2"), eq("q-solved", "o3")), left.ShowIf)

	foreman, _ := templateByID("tpl-foreman")
	assert.Equal(t, "repairs", foreman.module)
	assert.Equal(t, fapi.FormQuestionRefKindObject, *foreman.definition().Fields[0].RefKind)
	_, ok = templateByID("tpl-none")
	assert.False(t, ok)
	assert.Equal(t, "Пустая форма", templateName("blank"))
}

// FORM_SETTINGS of the prototype (models.js:85) — the defaults of a new form.
func TestDefaultSettings(t *testing.T) {
	t.Parallel()
	var f fapi.Form
	example(t, "getForm/ok", &f)
	assert.Equal(t, f.Settings, defaultSettings().api())
}
