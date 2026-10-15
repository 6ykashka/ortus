package fleetrules

import (
	"math"
	"strings"
	"testing"
)

type formatFixture struct {
	Num    []pair[float64] `json:"num"`
	Int    []pair[float64] `json:"int"`
	Plural []pair[int]     `json:"plural"`
}

func TestFormat_Fixture(t *testing.T) {
	t.Parallel()
	var fx formatFixture
	loadFixture(t, "format", &fx)
	if len(fx.Num) == 0 || len(fx.Int) == 0 || len(fx.Plural) == 0 {
		t.Fatal("format.json: пустые таблицы")
	}
	t.Run("num", func(t *testing.T) {
		t.Parallel()
		for _, p := range fx.Num {
			if got := num(p.In); got != p.Want {
				t.Errorf("num(%v) = %q, want %q", p.In, got, p.Want)
			}
		}
	})
	t.Run("int", func(t *testing.T) {
		t.Parallel()
		for _, p := range fx.Int {
			if got := formatInt(p.In); got != p.Want {
				t.Errorf("formatInt(%v) = %q, want %q", p.In, got, p.Want)
			}
		}
	})
	t.Run("plural", func(t *testing.T) {
		t.Parallel()
		for _, p := range fx.Plural {
			if got := plural(p.In, "пункт", "пункта", "пунктов"); got != p.Want {
				t.Errorf("plural(%d) = %q, want %q", p.In, got, p.Want)
			}
		}
	})
}

func TestJSString(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   float64
		want string
	}{
		{name: "ноль", in: 0, want: "0"},
		{name: "минус ноль", in: math.Copysign(0, -1), want: "0"},
		{name: "дробь", in: 1.5, want: "1.5"},
		{name: "отрицательная дробь", in: -2.5, want: "-2.5"},
		{name: "0,1 + 0,2 в float64", in: 0.30000000000000004, want: "0.30000000000000004"},
		{name: "1e20 полностью", in: 1e20, want: "100000000000000000000"},
		{name: "1e21 экспонентой", in: 1e21, want: "1e+21"},
		{name: "1,23e22", in: 1.23e22, want: "1.23e+22"},
		{name: "1e-6 полностью", in: 1e-6, want: "0.000001"},
		{name: "1e-7 экспонентой", in: 1e-7, want: "1e-7"},
		{name: "1,5e-7", in: 1.5e-7, want: "1.5e-7"},
		{name: "наименьшее", in: 5e-324, want: "5e-324"},
		{name: "наибольшее", in: math.MaxFloat64, want: "1.7976931348623157e+308"},
		{name: "NaN", in: math.NaN(), want: "NaN"},
		{name: "+Inf", in: math.Inf(1), want: "Infinity"},
		{name: "-Inf", in: math.Inf(-1), want: "-Infinity"},
		{name: "целое", in: 84370, want: "84370"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := jsString(tt.in); got != tt.want {
				t.Errorf("jsString(%v) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestFormatInt_Edges(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		in   float64
		want string
	}{
		{name: "NaN", in: math.NaN(), want: "не число"},
		{name: "+Inf", in: math.Inf(1), want: "∞"},
		{name: "-Inf", in: math.Inf(-1), want: "-∞"},
		{name: "минус ноль", in: math.Copysign(0, -1), want: "-0"},
		{name: "округление в следующий разряд", in: 999.9995, want: "1\u00a0000"},
		{name: "меньше половины тысячной", in: 0.0004, want: "0"},
		{name: "отрицательное к нулю", in: -0.0004, want: "-0"},
		{name: "миллион", in: 1e6, want: "1\u00a0000\u00a0000"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			if got := formatInt(tt.in); got != tt.want {
				t.Errorf("formatInt(%v) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestToNumber(t *testing.T) {
	t.Parallel()
	nan := math.NaN()
	tests := []struct {
		name string
		in   string
		want float64
	}{
		{name: "пусто — 0", in: "", want: 0},
		{name: "пробелы — 0", in: " \t\n", want: 0},
		{name: "пробел в числе", in: "84 400", want: 84400},
		{name: "NBSP", in: "84\u00a0400", want: 84400},
		{name: "узкий NBSP", in: "84\u202f400", want: 84400},
		{name: "BOM", in: "\ufeff1", want: 1},
		{name: "em space и ideographic space", in: "1\u2003\u30002", want: 12},
		{name: "NEL — не пробел JS", in: "\u00851", want: nan},
		{name: "ведущие нули", in: "00012", want: 12},
		{name: "дробь", in: "0.1", want: 0.1},
		{name: "точка в начале со знаком", in: "+.5", want: 0.5},
		{name: "точка в конце", in: "5.", want: 5},
		{name: "только точка", in: ".", want: nan},
		{name: "экспонента", in: "1e5", want: 1e5},
		{name: "экспонента E со знаком", in: "1E+5", want: 1e5},
		{name: "отрицательная экспонента", in: "-.5e1", want: -5},
		{name: "e без цифр", in: "1e", want: nan},
		{name: "только e", in: "e5", want: nan},
		{name: "hex", in: "0x14A02", want: 84482},
		{name: "HEX", in: "0X1f", want: 31},
		{name: "bin", in: "0b11", want: 3},
		{name: "oct", in: "0o7", want: 7},
		{name: "OCT", in: "0O17", want: 15},
		{name: "префикс без цифр", in: "0x", want: nan},
		{name: "знак перед hex", in: "+0x10", want: nan},
		{name: "минус перед hex", in: "-0x10", want: nan},
		{name: "плохая цифра bin", in: "0b2", want: nan},
		{name: "длинный hex", in: "0x" + strings.Repeat("F", 20), want: 1208925819614629174706175},
		{name: "Infinity", in: "Infinity", want: math.Inf(1)},
		{name: "+Infinity", in: "+Infinity", want: math.Inf(1)},
		{name: "-Infinity", in: "-Infinity", want: math.Inf(-1)},
		{name: "infinity строчными", in: "infinity", want: nan},
		{name: "inf", in: "inf", want: nan},
		{name: "NaN", in: "NaN", want: nan},
		{name: "переполнение", in: "1e400", want: math.Inf(1)},
		{name: "отрицательное переполнение", in: "-1e400", want: math.Inf(-1)},
		{name: "исчезновение", in: "1e-400", want: 0},
		{name: "подчёркивание", in: "1_000", want: nan},
		{name: "запятая", in: "1,5", want: nan},
		{name: "арабская цифра", in: "٣", want: nan},
		{name: "два знака", in: "--1", want: nan},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := toNumber(tt.in)
			if math.IsNaN(tt.want) {
				if !math.IsNaN(got) {
					t.Errorf("toNumber(%q) = %v, want NaN", tt.in, got)
				}
				return
			}
			if got != tt.want {
				t.Errorf("toNumber(%q) = %v, want %v", tt.in, got, tt.want)
			}
		})
	}
	t.Run("минус ноль сохраняет знак", func(t *testing.T) {
		t.Parallel()
		if got := toNumber("-0"); got != 0 || !math.Signbit(got) {
			t.Errorf("toNumber(-0) = %v, want -0", got)
		}
	})
}
