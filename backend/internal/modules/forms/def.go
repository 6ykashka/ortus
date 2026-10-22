package forms

import (
	"encoding/json"
	"math/big"
	"slices"
	"strconv"
	"strings"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// def is FormDefinitionV2 — the questions of a draft or of an immutable version; question is FormQuestion.
type (
	def      = fapi.FormDefinitionV2
	question = fapi.FormQuestion
)

// The types of questions by what they ask (TYPES of the prototype, dc:474–482).
var (
	optionTypes = []fapi.FormQuestionType{fapi.FormQuestionTypeChoice, fapi.FormQuestionTypeMulti, fapi.FormQuestionTypeSelect}
	crmTypes    = []fapi.FormQuestionType{fapi.FormQuestionTypePerson, fapi.FormQuestionTypeUnit, fapi.FormQuestionTypeRef}
	numberTypes = []fapi.FormQuestionType{fapi.FormQuestionTypeNumber, fapi.FormQuestionTypeInt, fapi.FormQuestionTypeMoney}
	textTypes   = []fapi.FormQuestionType{fapi.FormQuestionTypeText, fapi.FormQuestionTypeLongtext}
)

func optionType(t fapi.FormQuestionType) bool { return slices.Contains(optionTypes, t) }
func crmType(t fapi.FormQuestionType) bool    { return slices.Contains(crmTypes, t) }
func numberType(t fapi.FormQuestionType) bool { return slices.Contains(numberTypes, t) }
func textType(t fapi.FormQuestionType) bool   { return slices.Contains(textTypes, t) }

// violation is a violation of a 422 validation_failed: the field, its code and the message.
type violation struct{ field, code, message string }

// keyMax is the limit of FormQuestion.key (^[a-zA-Z][a-zA-Z0-9_-]{0,63}$).
const keyMax = 64

// emptyDef is the definition of an empty form: one page «Страница 1».
func emptyDef() def {
	return def{Pages: []fapi.FormPageDefinition{{Id: "p1", Title: textFirstPage}}, Fields: []question{}}
}

// structureErrors are the errors of the structure of a draft — it cannot be saved: a page or a key repeated, a
// question on a missing page. An incomplete question is an issue, not an error.
func structureErrors(d def) []violation {
	var out []violation
	pages := map[string]bool{}
	for _, p := range d.Pages {
		if pages[p.Id] {
			out = append(out, violation{"pages", "duplicate", textPagesRepeat})
		}
		pages[p.Id] = true
	}
	keys := map[string]bool{}
	for _, x := range d.Fields {
		if keys[x.Key] {
			out = append(out, violation{x.Key, "duplicate", textKeyTaken})
		}
		keys[x.Key] = true
		if !pages[x.PageId] {
			out = append(out, violation{x.Key, "unknown_page", textPageNotFound})
		}
	}
	return out
}

// nameOf is the name of a question in the texts of issues(): «текст» or «Вопрос N».
func nameOf(x question, i int) string {
	if l := strings.TrimSpace(x.Label); l != "" {
		return "«" + l + "»"
	}
	return "Вопрос " + strconv.Itoa(i+1)
}

// options are the options of a question (none — empty).
func options(x question) []fapi.FormOption {
	if x.Options == nil {
		return nil
	}
	return *x.Options
}

// issuesOf are the issues that block the publication — issues() of the prototype (dc:721–738) with its texts; a public
// form may not ask CRM data.
func issuesOf(public bool, d def) []fapi.FormIssue {
	out := []fapi.FormIssue{}
	idx := map[string]int{}
	for i, x := range d.Fields {
		if _, ok := idx[x.Key]; !ok {
			idx[x.Key] = i
		}
	}
	if !slices.ContainsFunc(d.Fields, func(x question) bool { return x.Type != fapi.FormQuestionTypeStatement }) {
		out = append(out, fapi.FormIssue{Message: textNoQuestions})
	}
	seen := map[string]bool{}
	for i, x := range d.Fields {
		for _, m := range questionIssues(x, i, idx, seen) {
			out = append(out, fapi.FormIssue{FieldKey: new(x.Key), Message: m})
		}
		seen[x.Key] = true
	}
	if public {
		for _, x := range d.Fields {
			if crmType(x.Type) {
				out = append(out, fapi.FormIssue{FieldKey: new(x.Key), Message: "«" + x.Label + "»: публичная форма не может спрашивать данные CRM"})
			}
		}
	}
	return out
}

// questionIssues are the issues of question i in their order: no text, no or an empty option, a repeated key (seen —
// the keys above), the conditions, a hidden required question without a default, «от» above «до».
func questionIssues(x question, i int, idx map[string]int, seen map[string]bool) []string {
	var out []string
	nm := nameOf(x, i)
	if strings.TrimSpace(x.Label) == "" {
		out = append(out, nm+": нет текста")
	}
	if m := optionIssue(x); m != "" {
		out = append(out, nm+m)
	}
	if seen[x.Key] {
		out = append(out, "Идентификатор "+x.Key+" повторяется")
	}
	out = append(out, conditionIssues(x, i, nm, idx)...)
	if deref(x.Hidden) && x.Required && strings.TrimSpace(deref(x.DefaultValue)) == "" {
		out = append(out, nm+": скрытый обязательный вопрос без значения по умолчанию")
	}
	if lo, hi, ok := bounds(x); ok && lo.Cmp(hi) > 0 {
		out = append(out, nm+": «от» больше «до»")
	}
	return out
}

// optionIssue is the issue of the options of a question of choice ("" — none).
func optionIssue(x question) string {
	if !optionType(x.Type) {
		return ""
	}
	switch {
	case !slices.ContainsFunc(options(x), func(o fapi.FormOption) bool { return strings.TrimSpace(o.Label) != "" }):
		return ": нет вариантов ответа"
	case slices.ContainsFunc(options(x), func(o fapi.FormOption) bool { return strings.TrimSpace(o.Label) == "" }):
		return ": есть пустой вариант"
	}
	return ""
}

// conditionIssues are the issues of the conditions of question i: a condition on a removed question or below.
func conditionIssues(x question, i int, nm string, idx map[string]int) []string {
	if x.ShowIf == nil {
		return nil
	}
	var out []string
	for _, c := range x.ShowIf.Conditions {
		j, ok := idx[c.FieldKey]
		switch {
		case !ok:
			out = append(out, nm+": условие ссылается на удалённый вопрос")
		case j >= i:
			out = append(out, nm+": условие ссылается на вопрос ниже — условие может зависеть только от вопросов выше")
		}
	}
	return out
}

// bounds are «от» and «до» of a question: the length of a text, the value of a number.
func bounds(x question) (lo, hi *big.Rat, ok bool) {
	switch {
	case textType(x.Type) && x.MinLength != nil && x.MaxLength != nil:
		return big.NewRat(int64(*x.MinLength), 1), big.NewRat(int64(*x.MaxLength), 1), true
	case numberType(x.Type) && x.MinValue != nil && x.MaxValue != nil:
		lo, okLo := new(big.Rat).SetString(*x.MinValue)
		hi, okHi := new(big.Rat).SetString(*x.MaxValue)
		return lo, hi, okLo && okHi
	}
	return nil, nil, false
}

// apiChecks are the checks of publishForm of api.js (validatePublish, api.js:559–567) in their order: the first one
// fails ("" — none).
func apiChecks(public bool, d def) string {
	fs := d.Fields
	switch {
	case !slices.ContainsFunc(fs, func(x question) bool { return x.Type != fapi.FormQuestionTypeStatement }):
		return textNoQuestions
	case slices.ContainsFunc(fs, func(x question) bool { return strings.TrimSpace(x.Label) == "" }):
		return "У вопроса нет текста"
	}
	for _, x := range fs {
		if optionType(x.Type) && !slices.ContainsFunc(options(x), func(o fapi.FormOption) bool { return strings.TrimSpace(o.Label) != "" }) {
			return "У вопроса «" + x.Label + "» нет вариантов ответа"
		}
	}
	if public {
		for _, x := range fs {
			if crmType(x.Type) {
				return "Публичная форма не может спрашивать «" + x.Label + "»: справочники CRM гостю не показываются"
			}
		}
	}
	ids := map[string]bool{}
	for _, x := range fs {
		if ids[x.Key] {
			return "Повторяется идентификатор вопроса " + x.Key
		}
		ids[x.Key] = true
	}
	return ""
}

// publishViolations are the violations of publishForm: the check of api.js first (field «form», code publish), then
// issues() (code issue) without repeating its text (Q-W4.00-forms-4).
func publishViolations(public bool, d def) []violation {
	var out []violation
	if m := apiChecks(public, d); m != "" {
		out = append(out, violation{"form", "publish", m})
	}
	for _, i := range issuesOf(public, d) {
		if slices.ContainsFunc(out, func(v violation) bool { return v.message == i.Message }) {
			continue
		}
		field := "form"
		if i.FieldKey != nil {
			field = *i.FieldKey
		}
		out = append(out, violation{field, "issue", i.Message})
	}
	return out
}

// versionKey is «{key}-v{N}» within 64 characters; a taken key — «-v{N}-2», «-v{N}-3»… (FormVersion).
func versionKey(key string, n int, taken map[string]bool) string {
	for i := 1; ; i++ {
		suffix := "-v" + strconv.Itoa(n)
		if i > 1 {
			suffix += "-" + strconv.Itoa(i)
		}
		base := key
		if len(base) > keyMax-len(suffix) {
			base = base[:keyMax-len(suffix)]
		}
		if k := base + suffix; !taken[k] {
			return k
		}
	}
}

// nextVersion is the definition of version n published from d: a question whose type changed against prev gets a
// new key (api.js:566, nextVersionFields); the conditions of the version follow it. Conditions of rules and sources of
// the knowledge base keep the old key (as the prototype).
func nextVersion(d def, prev *def, n int) def {
	out := cloneDef(d)
	if prev == nil {
		return out
	}
	old := map[string]fapi.FormQuestionType{}
	for _, x := range prev.Fields {
		old[x.Key] = x.Type
	}
	taken := map[string]bool{}
	for _, x := range out.Fields {
		taken[x.Key] = true
	}
	for i := range out.Fields {
		x := &out.Fields[i]
		t, ok := old[x.Key]
		if !ok || t == x.Type {
			continue
		}
		from := x.Key
		x.Key = versionKey(from, n, taken)
		taken[x.Key] = true
		for j := range out.Fields {
			if c := out.Fields[j].ShowIf; c != nil {
				for k := range c.Conditions {
					if c.Conditions[k].FieldKey == from {
						c.Conditions[k].FieldKey = x.Key
					}
				}
			}
		}
	}
	return out
}

// questionCount is the number of questions of d («Текст без вопроса» is not a question).
func questionCount(d def) int {
	n := 0
	for _, x := range d.Fields {
		if x.Type != fapi.FormQuestionTypeStatement {
			n++
		}
	}
	return n
}

// cloneDef is a deep copy of d (through JSON, as structuredClone of MSW).
func cloneDef(d def) def {
	var out def
	b, err := json.Marshal(d)
	if err == nil {
		err = json.Unmarshal(b, &out)
	}
	if err != nil {
		panic("forms: clone of a definition: " + err.Error()) // a definition always round-trips
	}
	if out.Fields == nil {
		out.Fields = []question{}
	}
	return out
}

// sameDef reports whether two definitions are equal (their JSON; no questions and an empty list are the same).
func sameDef(a, b def) bool {
	x, errA := json.Marshal(cloneDef(a))
	y, errB := json.Marshal(cloneDef(b))
	return errA == nil && errB == nil && string(x) == string(y)
}

// alloc sets *p to a new T and returns it: a field of a type of the runtime of the generator (openapi_types.Date) is
// set without naming it — depguard keeps that runtime out of internal/modules.
func alloc[T any](p **T) *T {
	*p = new(T)
	return *p
}

// deref is *p, the zero value for nil.
func deref[T any](p *T) T {
	var zero T
	if p == nil {
		return zero
	}
	return *p
}
