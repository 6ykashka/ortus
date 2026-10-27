package chats

import (
	"encoding/hex"
	"math"
	"strconv"
	"strings"
)

// sizeText is the size in MB as the domain shows it (core/format.ts gb): «3,2 ГБ» from 1000 MB, otherwise «МБ».
func sizeText(mb float64) string {
	if mb >= 1000 {
		return decimal(math.Round(mb/100)/10) + " ГБ"
	}
	return decimal(math.Round(mb*10)/10) + " МБ"
}

// bytesMB converts bytes to MB the way the domain counts them (decimal: 1 MB = 10^6 bytes, 1 GB = 1000 MB).
func bytesMB(b int64) float64 { return float64(b) / 1e6 }

// decimal writes f with a comma and without a trailing zero.
func decimal(f float64) string {
	return strings.Replace(strconv.FormatFloat(f, 'f', -1, 64), ".", ",", 1)
}

// plural picks the Russian form of a noun for n (core/format.ts plural).
func plural(n int, one, few, many string) string {
	m, h := n%10, n%100
	switch {
	case m == 1 && h != 11:
		return one
	case m >= 2 && m <= 4 && (h < 10 || h >= 20):
		return few
	}
	return many
}

// pluralN is «n форма».
func pluralN(n int, one, few, many string) string {
	return strconv.Itoa(n) + " " + plural(n, one, few, many)
}

// clip cuts s to n characters with an ellipsis.
func clip(s string, n int) string {
	rs := []rune(s)
	if len(rs) <= n {
		return s
	}
	return string(rs[:n-1]) + "…"
}

// hexOf writes bytes in hex (the sha256 of a file).
func hexOf(b []byte) string { return hex.EncodeToString(b) }
