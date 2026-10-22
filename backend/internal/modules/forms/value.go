package forms

import (
	"encoding/json"
	"errors"
	"math/big"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// The kinds of FieldValue (FieldValue.type of the contract).
const (
	vText      = "text"
	vDecimal   = "decimal"
	vBoolean   = "boolean"
	vDate      = "date"
	vInstant   = "instant"
	vReference = "reference"
	vMoney     = "money"
	vFiles     = "files"
	vChoices   = "choices"
	vNull      = "null"
)

// keyOther is the key of «Другое — свой вариант» (FormOption.key: other is reserved).
const keyOther = "other"

// value is a FieldValue of the contract as stored (forms.responses.answers) and compared: the type, the raw value and
// the label of a reference or the text of «Другое».
type value struct {
	Type      string          `json:"type"`
	Value     json.RawMessage `json:"value"`
	Label     *string         `json:"label,omitempty"`
	OtherText *string         `json:"otherText,omitempty"`
}

// entry is a FieldEntry.
type entry struct {
	FieldKey string `json:"fieldKey"`
	Value    value  `json:"value"`
}

// answers are the values of a response by question key.
type answers map[string]value

// textValue is a TextValue.
func textValue(s string) value {
	b, _ := json.Marshal(s) // a string always encodes
	return value{Type: vText, Value: b}
}

// str is the string of a text, decimal, date or instant value ("" — another kind).
func (v value) str() string {
	var s string
	if json.Unmarshal(v.Value, &s) != nil {
		return ""
	}
	return s
}

// flag is the boolean of a boolean value.
func (v value) flag() (bool, bool) {
	var b bool
	err := json.Unmarshal(v.Value, &b)
	return b, v.Type == vBoolean && err == nil
}

// list is the keys of a choices value or the ids of a files value.
func (v value) list() []string {
	var out []string
	if json.Unmarshal(v.Value, &out) != nil {
		return nil
	}
	return out
}

// ref is the object of a reference value.
func (v value) ref() (fapi.ObjectRef, bool) {
	var r fapi.ObjectRef
	if v.Type != vReference || json.Unmarshal(v.Value, &r) != nil {
		return fapi.ObjectRef{}, false
	}
	return r, true
}

// money is the sum of a money value.
func (v value) money() (fapi.Money, bool) {
	var m fapi.Money
	if v.Type != vMoney || json.Unmarshal(v.Value, &m) != nil {
		return fapi.Money{}, false
	}
	return m, true
}

// isEmpty reports whether v is not an answer: absent, null, a blank text, no choice or no file.
func isEmpty(v *value) bool {
	if v == nil || v.Type == vNull || v.Type == "" {
		return true
	}
	switch v.Type {
	case vText:
		return strings.TrimSpace(v.str()) == ""
	case vChoices, vFiles:
		return len(v.list()) == 0
	}
	return false
}

// has reports whether v matches the value of a condition: the key of an option, true/false of «Да / нет», the text
// without regard to case (condOk of the prototype, by keys — Q-W4.00-forms-3).
func has(v *value, want string) bool {
	if v == nil {
		return false
	}
	switch v.Type {
	case vChoices:
		return slices.Contains(v.list(), want)
	case vBoolean:
		b, _ := v.flag()
		return strconv.FormatBool(b) == want
	case vText, vDecimal, vDate:
		return strings.EqualFold(v.str(), want)
	}
	return false
}

// shown reports whether a question is shown by its condition over the answers above.
func shown(x question, vals answers) bool {
	c := x.ShowIf
	if c == nil || len(c.Conditions) == 0 {
		return true
	}
	anyOf := c.Mode == fapi.FormShowIfModeAny
	for _, k := range c.Conditions {
		var v *value
		if got, ok := vals[k.FieldKey]; ok {
			v = &got
		}
		ok := has(v, k.Value)
		if k.Operator == fapi.FormShowIfConditionOperatorNotEquals {
			ok = !ok
		}
		if anyOf && ok {
			return true
		}
		if !anyOf && !ok {
			return false
		}
	}
	return !anyOf
}

var dateRE = regexp.MustCompile(`^(\d{4})-(\d\d)-(\d\d)$`)

// labelOf is the label of a value for the knowledge base, CSV and the summary: the labels of options from the version
// (Q-W4.00-forms-3), «да» / «нет», «N фото», the label of a reference, the date «ДД.ММ.ГГГГ».
func labelOf(x *question, v *value) string {
	if v == nil || v.Type == vNull {
		return ""
	}
	switch v.Type {
	case vChoices:
		var labels []string
		for _, k := range v.list() {
			labels = append(labels, choiceLabel(x, v, k))
		}
		return strings.Join(labels, ", ")
	case vBoolean:
		if b, _ := v.flag(); b {
			return "да"
		}
		return "нет"
	case vFiles:
		return strconv.Itoa(len(v.list())) + " фото"
	case vReference:
		return deref(v.Label)
	case vMoney:
		m, _ := v.money()
		return strconv.FormatFloat(float64(m.AmountMinor)/100, 'f', -1, 64)
	case vDate:
		if m := dateRE.FindStringSubmatch(v.str()); m != nil {
			return m[3] + "." + m[2] + "." + m[1]
		}
	}
	return v.str()
}

// choiceLabel is the label of the option k of x («Другое» — the text of the respondent).
func choiceLabel(x *question, v *value, k string) string {
	if k == keyOther {
		if v.OtherText != nil {
			return *v.OtherText
		}
		return textOther
	}
	if x != nil {
		for _, o := range options(*x) {
			if o.Key == k {
				return o.Label
			}
		}
	}
	return k
}

// pvTypes are the kinds of values a question takes (FormQuestionType of the contract).
var pvTypes = map[fapi.FormQuestionType][]string{
	fapi.FormQuestionTypeText: {vText}, fapi.FormQuestionTypeLongtext: {vText}, fapi.FormQuestionTypeEmail: {vText},
	fapi.FormQuestionTypePhone: {vText}, fapi.FormQuestionTypeInn: {vText}, fapi.FormQuestionTypeUrl: {vText},
	fapi.FormQuestionTypeNumber: {vDecimal}, fapi.FormQuestionTypeInt: {vDecimal}, fapi.FormQuestionTypeScale: {vDecimal},
	fapi.FormQuestionTypeRating: {vDecimal}, fapi.FormQuestionTypeMoney: {vMoney},
	fapi.FormQuestionTypeChoice: {vChoices}, fapi.FormQuestionTypeSelect: {vChoices}, fapi.FormQuestionTypeMulti: {vChoices},
	fapi.FormQuestionTypeBool: {vBoolean}, fapi.FormQuestionTypeDate: {vDate, vInstant}, fapi.FormQuestionTypePhoto: {vFiles},
	fapi.FormQuestionTypePerson: {vReference}, fapi.FormQuestionTypeUnit: {vReference}, fapi.FormQuestionTypeRef: {vReference},
}

var (
	emailRE  = regexp.MustCompile(`^\S+@\S+\.\S+$`)
	urlRE    = regexp.MustCompile(`^https?://\S+`)
	intRE    = regexp.MustCompile(`^-?\d+$`)
	nonDigit = regexp.MustCompile(`\D`)
	spaces   = regexp.MustCompile(`\s`)
)

// defaultMaxFiles is «не больше N файлов» by default.
const defaultMaxFiles = 5

// pvCheck is the error of an answer to x with the texts of the prototype (pvCheck, dc:688–705), "" — none.
func pvCheck(x question, v *value) string {
	if isEmpty(v) {
		if x.Required && x.Type != fapi.FormQuestionTypeStatement {
			return textRequired
		}
		return ""
	}
	if x.Type == fapi.FormQuestionTypeStatement {
		return ""
	}
	if !slices.Contains(pvTypes[x.Type], v.Type) {
		return textWrongType
	}
	if m := pvText(x, v); m != "" {
		return m
	}
	if m := pvNumber(x, v); m != "" {
		return m
	}
	switch v.Type {
	case vChoices:
		return pvChoices(x, v)
	case vFiles:
		limit := defaultMaxFiles
		if x.MaxFiles != nil {
			limit = *x.MaxFiles
		}
		if len(v.list()) > limit {
			return "Не больше " + strconv.Itoa(limit) + " файлов"
		}
	}
	return ""
}

// pvText checks a text: the address of mail, the phone, the INN, the link, the length.
func pvText(x question, v *value) string {
	if v.Type != vText {
		return ""
	}
	s := v.str()
	if m := pvFormat(x.Type, s); m != "" || !textType(x.Type) {
		return m
	}
	n := utf8.RuneCountInString(s)
	switch {
	case x.MinLength != nil && n < *x.MinLength:
		return "Не короче " + strconv.Itoa(*x.MinLength) + " символов"
	case x.MaxLength != nil && n > *x.MaxLength:
		return "Не длиннее " + strconv.Itoa(*x.MaxLength) + " символов"
	}
	return ""
}

// pvFormat checks the format of a text of the type t: the address of mail, the phone, the INN, the link.
func pvFormat(t fapi.FormQuestionType, s string) string {
	digits := len(nonDigit.ReplaceAllString(s, ""))
	switch {
	case t == fapi.FormQuestionTypeEmail && !emailRE.MatchString(s):
		return "Проверьте адрес почты"
	case t == fapi.FormQuestionTypePhone && digits < 10:
		return "Нужно не меньше 10 цифр"
	case t == fapi.FormQuestionTypeInn && digits != 10 && digits != 12:
		return "ИНН — 10 или 12 цифр"
	case t == fapi.FormQuestionTypeUrl && !urlRE.MatchString(s):
		return "Ссылка начинается с http:// или https://"
	}
	return ""
}

// pvNumber checks a number: an integer, «от» and «до».
func pvNumber(x question, v *value) string {
	var num *big.Rat
	switch v.Type {
	case vDecimal:
		s := strings.TrimSpace(v.str())
		if x.Type == fapi.FormQuestionTypeInt && !intRE.MatchString(s) {
			return "Нужно целое число"
		}
		n, ok := new(big.Rat).SetString(strings.ReplaceAll(spaces.ReplaceAllString(s, ""), ",", "."))
		if !ok {
			return "Нужно число"
		}
		num = n
	case vMoney:
		m, _ := v.money()
		num = big.NewRat(int64(m.AmountMinor), 100)
	default:
		return ""
	}
	if !numberType(x.Type) {
		return ""
	}
	if x.MinValue != nil {
		if lo, ok := new(big.Rat).SetString(*x.MinValue); ok && num.Cmp(lo) < 0 {
			return "Не меньше " + *x.MinValue
		}
	}
	if x.MaxValue != nil {
		if hi, ok := new(big.Rat).SetString(*x.MaxValue); ok && num.Cmp(hi) > 0 {
			return "Не больше " + *x.MaxValue
		}
	}
	return ""
}

// pvChoices checks the options chosen: from the list (or «Другое» of a question with it), one or the bounds of multi.
func pvChoices(x question, v *value) string {
	keys := v.list()
	for _, k := range keys {
		known := slices.ContainsFunc(options(x), func(o fapi.FormOption) bool { return o.Key == k })
		if !known && (k != keyOther || !deref(x.OtherOption)) {
			return "Выберите вариант из списка"
		}
	}
	return pvSelected(x, len(keys))
}

// pvSelected checks how many options are chosen: one, or the bounds «Сколько вариантов выбрать» of multi.
func pvSelected(x question, n int) string {
	lo, hi := deref(x.MinSelected), deref(x.MaxSelected)
	switch {
	case x.Type != fapi.FormQuestionTypeMulti && n > 1:
		return "Выберите один вариант"
	case x.Type != fapi.FormQuestionTypeMulti:
		return ""
	case lo > 0 && n < lo:
		return "Выберите не меньше " + strconv.Itoa(lo)
	case hi > 0 && n > hi:
		return "Выберите не больше " + strconv.Itoa(hi)
	}
	return ""
}

// scoreOf is the score of a test (score() of the prototype): the options with scores of the shown, not hidden
// questions of choice; passed — against the pass score (nil — not set).
func scoreOf(d def, vals answers, pass *int) fapi.FormResponseScore {
	points, maxPoints := 0, 0
	for _, x := range d.Fields {
		if !optionType(x.Type) || (x.Hidden != nil && *x.Hidden) || !shown(x, vals) {
			continue
		}
		scores := map[string]int{}
		best, sum := 0, 0
		for _, o := range options(x) {
			s := deref(o.Score)
			scores[o.Key] = s
			best = max(best, s)
			if s > 0 {
				sum += s
			}
		}
		if x.Type == fapi.FormQuestionTypeMulti {
			maxPoints += sum
		} else {
			maxPoints += best
		}
		if v, ok := vals[x.Key]; ok && v.Type == vChoices {
			for _, k := range v.list() {
				points += scores[k]
			}
		}
	}
	out := fapi.FormResponseScore{Points: points, MaxPoints: maxPoints}
	if pass != nil {
		out.Passed = new(points >= *pass)
	}
	return out
}

// answersOf indexes the entries of a response by key.
func answersOf(es []entry) answers {
	out := answers{}
	for _, e := range es {
		out[e.FieldKey] = e.Value
	}
	return out
}

// errNoType is a FieldValue without its type.
var errNoType = errors.New("forms: a value without a type")

// fromAPI converts the entries of the contract to the stored ones.
func fromAPI(in []fapi.FieldEntry) ([]entry, error) {
	b, err := json.Marshal(in)
	if err != nil {
		return nil, err
	}
	var out []entry
	if err := json.Unmarshal(b, &out); err != nil {
		return nil, err
	}
	for _, e := range out {
		if e.Value.Type == "" {
			return nil, errNoType
		}
	}
	return out, nil
}

// toAPI converts the stored entries to the contract.
func toAPI(es []entry) []fapi.FieldEntry {
	out := []fapi.FieldEntry{}
	if len(es) == 0 {
		return out
	}
	b, err := json.Marshal(es)
	if err == nil {
		err = json.Unmarshal(b, &out)
	}
	if err != nil {
		panic("forms: answers: " + err.Error()) // the stored answers are JSON of the contract
	}
	return out
}
