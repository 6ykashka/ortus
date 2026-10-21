// Package branding is the branding of an organization in the control DB (W4.60, contract 0.8.0-stage4 of W4.07;
// design/docs/18-branding.md): the name, the short name, the logo and the sign, the accent with its contrast
// correction, the terms, the menu and «Работает на Ортус» as immutable versions; the files of the logo and the sign
// (the real type by the bytes, SVG by an allowlist, a square sign); the theme of the shell and the sign of the
// operator lists.
package branding

import (
	"fmt"
	"math"
	"strconv"
	"strings"
)

// DefaultAccent is the accent of the standard Ortus branding.
const DefaultAccent = "#1F6B52"

// Contrast correction (18-branding «Цвет», brandingVM, MSW fixAccent): white text on the accent needs 4.5:1; a lighter
// accent is darkened towards black in steps of 4%, at most 60 steps.
const (
	minContrast   = 4.5
	darkenStep    = 0.04
	maxDarkenings = 60
)

// Variants are the CSS variables of the accent (BrandingAccentVariants).
type Variants struct {
	Accent, Hover, Soft, Tint string
}

// rgb is a colour of #RRGGBB.
type rgb [3]float64

func parseHex(hex string) rgb {
	var c rgb
	for i := range c {
		v, _ := strconv.ParseUint(hex[1+2*i:3+2*i], 16, 8) // the pattern of accentHex is checked before
		c[i] = float64(v)
	}
	return c
}

// hexOf rounds each channel half up into 0–255 (Math.round of the prototype).
func hexOf(c rgb) string {
	var b strings.Builder
	b.WriteByte('#')
	for _, v := range c {
		fmt.Fprintf(&b, "%02X", int(math.Max(0, math.Min(255, math.Floor(v+0.5)))))
	}
	return b.String()
}

// mix moves hex towards to by t (0–1) and rounds, as mixHex of the prototype.
func mix(hex, to string, t float64) string {
	a, b := parseHex(hex), parseHex(to)
	var out rgb
	for i := range a {
		out[i] = a[i] + (b[i]-a[i])*t
	}
	return hexOf(out)
}

// ContrastWithWhite is the WCAG contrast of a colour with white text.
func ContrastWithWhite(hex string) float64 {
	c := parseHex(strings.ToUpper(hex))
	var lum float64
	for i, w := range [3]float64{0.2126, 0.7152, 0.0722} {
		v := c[i] / 255
		if v <= 0.03928 {
			v /= 12.92
		} else {
			v = math.Pow((v+0.055)/1.055, 2.4)
		}
		lum += w * v
	}
	return 1.05 / (lum + 0.05)
}

// FixAccent is the accent applied after the contrast correction (accentUsed): the colour of the owner, darkened
// towards black in steps of 4% until white text on it has a contrast of 4.5:1.
func FixAccent(hex string) string {
	c := strings.ToUpper(hex)
	for n := 0; ContrastWithWhite(c) < minContrast && n < maxDarkenings; n++ {
		c = mix(c, "#000000", darkenStep)
	}
	return c
}

// VariantsOf are the variables of an applied accent: hover −18% to black, soft 86% and tint 93% to white.
func VariantsOf(used string) Variants {
	return Variants{
		Accent: used, Hover: mix(used, "#000000", 0.18), Soft: mix(used, "#FFFFFF", 0.86), Tint: mix(used, "#FFFFFF", 0.93),
	}
}
