package branding

import (
	"bytes"
	"encoding/xml"
	"errors"
	"io"
	"regexp"
	"strings"
	"unicode"
)

// The sanitizer of SVG (contract uploadBrandingAsset, integratorNotes W4.07, Q-W4.07-17): the file is parsed by an
// XML parser, not by regular expressions, and refused — not cleaned — when anything is outside the allowlist: an
// element or an attribute that does not draw, an element outside the SVG namespace, an event handler, a DOCTYPE or an
// entity, a processing instruction other than the XML declaration, CDATA, a javascript:, vbscript: or data: URI, a link
// (href, src, url()) to anything but a local #fragment, a backslash in a value (a CSS escape that hides url()). The parser resolves namespace prefixes (any prefix of xlink:href
// is caught) and character references (&#106;avascript: is caught) before the checks.

const svgNamespace = "http://www.w3.org/2000/svg"

// svgElements are the elements of a drawing (lower-case local names).
var svgElements = set(
	"svg", "g", "defs", "symbol", "use", "title", "desc", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
	"text", "tspan", "lineargradient", "radialgradient", "stop", "clippath", "mask", "pattern", "metadata",
)

// svgAttributes are the attributes of a drawing (lower-case local names); data-* and aria-* are allowed too.
var svgAttributes = set(
	"id", "class", "style", "title", "lang", "space", "version", "baseprofile", "viewbox", "preserveaspectratio", "transform",
	"width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "fx", "fy", "fr", "d", "points", "pathlength",
	"fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-miterlimit",
	"stroke-dasharray", "stroke-dashoffset", "stroke-opacity", "opacity", "color", "display", "visibility", "overflow",
	"clip-path", "clip-rule", "mask", "offset", "stop-color", "stop-opacity", "gradientunits", "gradienttransform", "spreadmethod",
	"patternunits", "patterncontentunits", "patterntransform", "maskunits", "maskcontentunits", "clippathunits",
	"font-family", "font-size", "font-weight", "font-style", "font-variant", "text-anchor", "dominant-baseline",
	"alignment-baseline", "baseline-shift", "letter-spacing", "word-spacing", "text-decoration", "dx", "dy", "rotate",
	"textlength", "lengthadjust", "href", "role", "focusable", "shape-rendering", "text-rendering", "image-rendering",
	"color-interpolation", "vector-effect", "paint-order", "mix-blend-mode", "isolation", "enable-background",
)

// linkAttributes may only point to a local #fragment.
var linkAttributes = set("href", "src")

func set(keys ...string) map[string]bool {
	out := make(map[string]bool, len(keys))
	for _, k := range keys {
		out[k] = true
	}
	return out
}

var (
	// forbiddenValue: a script or inline-data URI, an import, an expression (after whitespace and controls are removed).
	forbiddenValue = regexp.MustCompile(`javascript:|vbscript:|data:|@import|expression\(|behavior:`)
	// externalURL: url( not followed by an optional quote and #.
	externalURL = regexp.MustCompile(`url\(\s*(?:['"]\s*)?[^#'"\s]`)
)

// UnsafeSVG reports whether an SVG must be refused (see the rules above).
func UnsafeSVG(data []byte) bool {
	if bytes.Contains(data, []byte("<![CDATA[")) {
		return true
	}
	dec := xml.NewDecoder(bytes.NewReader(bytes.TrimPrefix(data, []byte("\xef\xbb\xbf"))))
	dec.Strict = true
	root := true
	for {
		tok, err := dec.Token()
		if errors.Is(err, io.EOF) {
			return root // an empty document draws nothing
		}
		if err != nil {
			return true // malformed XML, an unknown entity, an unclosed tag
		}
		if !safeToken(tok, &root) {
			return true
		}
	}
}

// safeToken checks one token; root is cleared by the first element, which must be svg.
func safeToken(tok xml.Token, root *bool) bool {
	switch t := tok.(type) {
	case xml.StartElement:
		name := strings.ToLower(t.Name.Local)
		if *root && name != "svg" {
			return false
		}
		*root = false
		if (t.Name.Space != "" && t.Name.Space != svgNamespace) || !svgElements[name] {
			return false
		}
		for _, a := range t.Attr {
			if !safeAttribute(a) {
				return false
			}
		}
	case xml.Directive: // DOCTYPE, ENTITY
		return false
	case xml.ProcInst:
		return t.Target == "xml"
	}
	return true
}

// safeAttribute checks one attribute: a namespace declaration, or a drawing attribute without a script, an inline-data
// URI or a link outside the document.
func safeAttribute(a xml.Attr) bool {
	if a.Name.Space == "xmlns" || (a.Name.Space == "" && a.Name.Local == "xmlns") {
		return true
	}
	name := strings.ToLower(a.Name.Local)
	if strings.HasPrefix(name, "on") {
		return false
	}
	if !svgAttributes[name] && !strings.HasPrefix(name, "data-") && !strings.HasPrefix(name, "aria-") {
		return false
	}
	return safeValue(name, a.Value)
}

// safeValue checks the value of a drawing attribute name: no script or inline-data URI, no CSS escape, a link only to a
// local #fragment.
func safeValue(name, raw string) bool {
	value := strings.ToLower(strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || unicode.IsControl(r) {
			return -1
		}
		return r
	}, raw))
	// A backslash is a CSS escape (fill:\75 rl(…) is url(…)): a drawing never needs one, so it is refused before the
	// checks of url() rather than unescaped.
	if strings.ContainsRune(value, '\\') || forbiddenValue.MatchString(value) {
		return false
	}
	if linkAttributes[name] && !strings.HasPrefix(value, "#") {
		return false
	}
	return !externalURL.MatchString(strings.ToLower(raw))
}
