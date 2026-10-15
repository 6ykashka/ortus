package fleetrules

import (
	"encoding/json"
	"math"
	"testing"
)

func TestFormValue_UnmarshalJSON(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		in        string
		wantEmpty bool
		wantJS    string
	}{
		{name: "строка", in: `"84 400"`, wantJS: "84 400"},
		{name: "пустая строка — не пусто", in: `""`, wantJS: ""},
		{name: "число", in: `84370`, wantJS: "84370"},
		{name: "дробное число", in: `1500.5`, wantJS: "1500.5"},
		{name: "экспонента", in: `1e+21`, wantJS: "1e+21"},
		{name: "null", in: `null`, wantEmpty: true, wantJS: "null"},
		{name: "null с пробелами", in: ` null `, wantEmpty: true, wantJS: "null"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			var v FormValue
			if err := json.Unmarshal([]byte(tt.in), &v); err != nil {
				t.Fatalf("Unmarshal(%s): %v", tt.in, err)
			}
			if v.IsEmpty() != tt.wantEmpty {
				t.Errorf("IsEmpty() = %v, want %v", v.IsEmpty(), tt.wantEmpty)
			}
			if got := v.jsString(); got != tt.wantJS {
				t.Errorf("jsString() = %q, want %q", got, tt.wantJS)
			}
		})
	}
}

func TestFormValue_UnmarshalJSON_Invalid(t *testing.T) {
	t.Parallel()
	for _, in := range []string{`true`, `{}`, `[1]`} {
		var v FormValue
		if err := json.Unmarshal([]byte(in), &v); err == nil {
			t.Errorf("Unmarshal(%s): want error", in)
		}
	}
}

func TestFormValue_FieldAbsent(t *testing.T) {
	t.Parallel()
	var d struct {
		V FormValue `json:"v"`
	}
	if err := json.Unmarshal([]byte(`{}`), &d); err != nil {
		t.Fatal(err)
	}
	if !d.V.IsEmpty() {
		t.Error("поля нет — значение должно быть пустым")
	}
}

func TestFormValue_MarshalJSON(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   FormValue
		want string
	}{
		{name: "пусто", in: FormValue{}, want: `null`},
		{name: "строка", in: Text("1 500,50"), want: `"1 500,50"`},
		{name: "число", in: Number(1500.5), want: `1500.5`},
		{name: "NaN как в JSON.stringify", in: Number(math.NaN()), want: `null`},
		{name: "Inf как в JSON.stringify", in: Number(math.Inf(1)), want: `null`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			b, err := json.Marshal(tt.in)
			if err != nil {
				t.Fatal(err)
			}
			if string(b) != tt.want {
				t.Errorf("Marshal = %s, want %s", b, tt.want)
			}
		})
	}
}

func TestFormValue_String(t *testing.T) {
	t.Parallel()
	if got := Text("abc").String(); got != "abc" {
		t.Errorf("Text.String() = %q", got)
	}
	if got := Number(1e21).String(); got != "1e+21" {
		t.Errorf("Number.String() = %q", got)
	}
	if got := (FormValue{}).String(); got != "" {
		t.Errorf("пусто String() = %q", got)
	}
}
