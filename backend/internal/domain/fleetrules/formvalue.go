package fleetrules

import (
	"bytes"
	"encoding/json"
	"errors"
	"math"
)

// ErrFormValue — значение поля формы в JSON не строка, не число и не null.
var ErrFormValue = errors.New("fleetrules: значение поля формы — строка, число или null")

type formKind uint8

const (
	formEmpty formKind = iota
	formText
	formNumber
)

// FormValue — значение поля формы в том виде, в каком его передаёт клиент: строка ввода
// («84 400», «1 500,50»), число или пусто (null или поля нет). Нулевое значение — пусто.
// Пустая строка — не пусто: правила эталона различают пустую строку и null.
type FormValue struct {
	kind formKind
	text string
	num  float64
}

// Text — строка ввода как есть.
func Text(s string) FormValue { return FormValue{kind: formText, text: s} }

// Number — число.
func Number(n float64) FormValue { return FormValue{kind: formNumber, num: n} }

// IsEmpty сообщает, что значения нет (null или поле не передано).
func (v FormValue) IsEmpty() bool { return v.kind == formEmpty }

// jsString — String(x) эталона; пусто даёт «null» (Number(«null») = NaN, как и у undefined).
func (v FormValue) jsString() string {
	switch v.kind {
	case formText:
		return v.text
	case formNumber:
		return jsString(v.num)
	case formEmpty:
		return "null"
	}
	return "null"
}

// String возвращает строку ввода, число в записи JS или пустую строку для пустого значения.
func (v FormValue) String() string {
	if v.kind == formEmpty {
		return ""
	}
	return v.jsString()
}

// UnmarshalJSON принимает строку, число или null.
func (v *FormValue) UnmarshalJSON(b []byte) error {
	b = bytes.TrimSpace(b)
	switch {
	case bytes.Equal(b, []byte("null")):
		*v = FormValue{}
		return nil
	case len(b) > 0 && b[0] == '"':
		var s string
		if err := json.Unmarshal(b, &s); err != nil {
			return err
		}
		*v = Text(s)
		return nil
	}
	var n float64
	if err := json.Unmarshal(b, &n); err != nil {
		return errors.Join(ErrFormValue, err)
	}
	*v = Number(n)
	return nil
}

// MarshalJSON пишет строку, число или null; NaN и ±Inf — null, как JSON.stringify.
func (v FormValue) MarshalJSON() ([]byte, error) {
	switch {
	case v.kind == formText:
		return json.Marshal(v.text)
	case v.kind == formNumber && !math.IsNaN(v.num) && !math.IsInf(v.num, 0):
		return json.Marshal(v.num)
	default:
		return []byte("null"), nil
	}
}
