package fleetrules

import (
	"errors"
	"math"
	"math/big"
	"regexp"
	"strconv"
	"strings"
)

// Числа по правилам JS: тексты правил собираются из String(n), Number(s) и
// toLocaleString('ru-RU') эталона, поэтому Go повторяет их байт в байт.

// nbsp — разделитель групп разрядов ru-RU в ICU (U+00A0).
const nbsp = "\u00a0"

// intFractionDigits — maximumFractionDigits по умолчанию у toLocaleString.
const intFractionDigits = 3

// shortest возвращает кратчайшие десятичные цифры |n| (конечного, не нуля) и позицию точки:
// |n| = 0.<digits> × 10^point. Это то же представление, что у Number::toString в JS.
func shortest(n float64) (digits string, point int) {
	s := strconv.FormatFloat(math.Abs(n), 'e', -1, 64) // «d.ddde±XX»
	mant, exp, _ := strings.Cut(s, "e")
	e, _ := strconv.Atoi(exp)
	return strings.Replace(mant, ".", "", 1), e + 1
}

// jsString — String(n) для числа JS (Number::toString, ECMA-262 §6.1.6.1.20).
func jsString(n float64) string {
	switch {
	case math.IsNaN(n):
		return "NaN"
	case math.IsInf(n, 1):
		return "Infinity"
	case math.IsInf(n, -1):
		return "-Infinity"
	case n == 0:
		return "0"
	}
	sign := ""
	if n < 0 {
		sign = "-"
	}
	d, p := shortest(n)
	k := len(d)
	switch {
	case k <= p && p <= 21:
		return sign + d + strings.Repeat("0", p-k)
	case 0 < p && p <= 21:
		return sign + d[:p] + "." + d[p:]
	case -6 < p && p <= 0:
		return sign + "0." + strings.Repeat("0", -p) + d
	}
	return sign + jsExponent(d, p)
}

// jsExponent — экспоненциальная запись Number::toString: «d.ddde±X».
func jsExponent(d string, p int) string {
	e := p - 1
	expSign := "+"
	if e < 0 {
		expSign, e = "-", -e
	}
	m := d[:1]
	if len(d) > 1 {
		m += "." + d[1:]
	}
	return m + "e" + expSign + strconv.Itoa(e)
}

// num — `num` эталона: String(n) с запятой вместо первой точки.
func num(n float64) string {
	return strings.Replace(jsString(n), ".", ",", 1)
}

// formatInt — `int` эталона: Number(n).toLocaleString('ru-RU'). Как ICU: кратчайшее десятичное
// представление, до трёх знаков дроби с округлением «половина от нуля», группы по три через
// U+00A0, десятичная запятая; знак минуса сохраняется и у -0.
func formatInt(n float64) string {
	switch {
	case math.IsNaN(n):
		return "не число"
	case math.IsInf(n, 1):
		return "∞"
	case math.IsInf(n, -1):
		return "-∞"
	}
	sign := ""
	if math.Signbit(n) {
		sign = "-"
	}
	scaled := "0"
	if n != 0 {
		d, p := shortest(n)
		scaled = roundScaled(d, p+intFractionDigits)
	}
	if pad := intFractionDigits + 1 - len(scaled); pad > 0 {
		scaled = strings.Repeat("0", pad) + scaled
	}
	cut := len(scaled) - intFractionDigits
	out := sign + groupThousands(scaled[:cut])
	if frac := strings.TrimRight(scaled[cut:], "0"); frac != "" {
		out += "," + frac
	}
	return out
}

// roundScaled округляет 0.<digits> × 10^q до целого «половиной от нуля» и возвращает его цифры.
func roundScaled(digits string, q int) string {
	switch {
	case q < 0:
		return "0"
	case q >= len(digits):
		return digits + strings.Repeat("0", q-len(digits))
	}
	head := digits[:q]
	if digits[q] < '5' {
		if head == "" {
			return "0"
		}
		return head
	}
	return incDecimal(head)
}

// incDecimal прибавляет единицу к десятичной записи неотрицательного целого («» = 0).
func incDecimal(s string) string {
	b := []byte(s)
	for i := len(b) - 1; i >= 0; i-- {
		if b[i] < '9' {
			b[i]++
			return string(b)
		}
		b[i] = '0'
	}
	return "1" + string(b)
}

// groupThousands разбивает целую часть на группы по три цифры через U+00A0.
func groupThousands(s string) string {
	var sb strings.Builder
	for i, r := range s {
		if i > 0 && (len(s)-i)%3 == 0 {
			sb.WriteString(nbsp)
		}
		sb.WriteRune(r)
	}
	return sb.String()
}

// plural — форма слова для n: «1 пункт», «2 пункта», «5 пунктов».
func plural(n int, one, few, many string) string {
	m, h := n%10, n%100
	if m == 1 && h != 11 {
		return one
	}
	if m >= 2 && m <= 4 && (h < 10 || h >= 20) {
		return few
	}
	return many
}

var (
	// jsDecimal — StrDecimalLiteral без Infinity (ECMA-262 §7.1.4.1.1): только цифры ASCII.
	jsDecimal = regexp.MustCompile(`^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)(?:[eE][+-]?[0-9]+)?$`)
	// jsRadix — NonDecimalIntegerLiteral: 0x, 0o, 0b без знака.
	jsRadix = regexp.MustCompile(`^0([xXoObB])([0-9a-fA-F]+)$`)
)

// toNumber — Number(String(s).replace(/\s/g, ”)) эталона: пробелы JS удаляются, пустая
// строка — 0, Infinity, экспонента и 0x/0o/0b допустимы, всё остальное — NaN.
func toNumber(s string) float64 {
	s = strings.Map(func(r rune) rune {
		if isJSSpace(r) {
			return -1
		}
		return r
	}, s)
	switch s {
	case "":
		return 0
	case "Infinity", "+Infinity":
		return math.Inf(1)
	case "-Infinity":
		return math.Inf(-1)
	}
	if jsDecimal.MatchString(s) {
		f, err := strconv.ParseFloat(s, 64)
		if err != nil && !errors.Is(err, strconv.ErrRange) {
			return math.NaN()
		}
		return f // при переполнении — ±Inf, как в JS
	}
	if m := jsRadix.FindStringSubmatch(s); m != nil {
		i, ok := new(big.Int).SetString(m[2], radixBase(m[1]))
		if !ok {
			return math.NaN()
		}
		f, _ := new(big.Float).SetInt(i).Float64()
		return f
	}
	return math.NaN()
}

func radixBase(prefix string) int {
	switch strings.ToLower(prefix) {
	case "x":
		return 16
	case "o":
		return 8
	default:
		return 2
	}
}

// isJSSpace — класс \s регулярных выражений JS: WhiteSpace и LineTerminator (ECMA-262 §12.2–12.3).
func isJSSpace(r rune) bool {
	switch r {
	case '\t', '\n', '\v', '\f', '\r', ' ',
		0x00a0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff:
		return true
	}
	return r >= 0x2000 && r <= 0x200a
}
