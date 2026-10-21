package branding

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"testing"
)

// Цвет (18-branding «Цвет», brandingVM эталона, MSW fixAccent): контраст с белым текстом ≥ 4.5:1, иначе шаги по 4%
// к чёрному; производные — −18% к чёрному, 86% и 93% к белому. Значения посчитаны алгоритмом MSW.
func TestAccent(t *testing.T) {
	t.Parallel()
	for in, want := range map[string]Variants{
		"#1F6B52": {Accent: "#1F6B52", Hover: "#195843", Soft: "#E0EAE7", Tint: "#EFF5F3"},
		"#7A3E79": {Accent: "#7A3E79", Hover: "#643363", Soft: "#ECE4EC", Tint: "#F6F1F6"},
		"#9A4A1F": {Accent: "#9A4A1F", Hover: "#7E3D19", Soft: "#F1E6E0", Tint: "#F8F2EF"},
		"#2B5479": {Accent: "#2B5479", Hover: "#234563", Soft: "#E1E7EC", Tint: "#F0F3F6"},
		"#f5c518": {Accent: "#8A6F0C", Hover: "#715B0A", Soft: "#EFEBDD", Tint: "#F7F5EE"},
		"#FFFFFF": {Accent: "#757575", Hover: "#606060", Soft: "#ECECEC", Tint: "#F5F5F5"},
		"#2e9e6b": {Accent: "#26865B", Hover: "#1F6E4B", Soft: "#E1EEE8", Tint: "#F0F7F4"},
		"#00a3ff": {Accent: "#007AC0", Hover: "#00649D", Soft: "#DBECF6", Tint: "#EDF6FB"},
	} {
		used := FixAccent(in)
		if used != want.Accent {
			t.Errorf("%s: used %s, want %s", in, used, want.Accent)
		}
		if got := VariantsOf(used); got != want {
			t.Errorf("%s: variants %+v, want %+v", in, got, want)
		}
		if c := ContrastWithWhite(used); c < 4.5 {
			t.Errorf("%s: contrast %.2f", in, c)
		}
	}
}

const ns = `xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`

// SVG по allowlist элементов и атрибутов на XML-парсере (контракт uploadBrandingAsset, integratorNotes W4.07,
// Q-W4.07-17): векторы conformance W4.07 — небезопасны; рисунок с градиентом и локальной ссылкой — можно.
func TestUnsafeSVG(t *testing.T) {
	t.Parallel()
	unsafe := map[string]string{
		"script":                `<svg ` + ns + `><script>alert(1)</script></svg>`,
		"javascript в href":     `<svg ` + ns + `><a href="javascript:alert(1)"><rect width="1" height="1"/></a></svg>`,
		"JaVaScRiPt в xlink":    `<svg ` + ns + `><a xlink:href=" JaVaScRiPt:alert(1)"><rect width="1" height="1"/></a></svg>`,
		"style @import":         `<svg ` + ns + `><style>@import url(https://evil.example/x.css);</style></svg>`,
		"style url внешний":     `<svg ` + ns + `><rect style="fill:url(https://evil.example/p.svg#p)" width="1" height="1"/></svg>`,
		"iframe":                `<svg ` + ns + `><iframe src="https://evil.example"/></svg>`,
		"embed":                 `<svg ` + ns + `><embed src="x.swf"/></svg>`,
		"DOCTYPE и сущность":    `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg ` + ns + `><text>&x;</text></svg>`,
		"image data:":           `<svg ` + ns + `><image href="data:image/svg+xml;base64,PHN2Zy8+" width="1" height="1"/></svg>`,
		"use внешний":           `<svg ` + ns + `><use xlink:href="other.svg#a"/></svg>`,
		"«>» в значении":        `<svg ` + ns + `><rect title="a>b" onload="alert(1)" width="1"/></svg>`,
		"«>» в одинарных":       `<svg ` + ns + `><rect title='x>' onload="alert(1)"/></svg>`,
		"«>» и внешний use":     `<svg ` + ns + `><use title="a>" xlink:href="https://evil.example/s.svg#a"/></svg>`,
		"«>» и style":           `<svg ` + ns + `><rect title="a>b" style="fill:url(https://evil.example/p.svg#p)"/></svg>`,
		"script в desc":         `<svg ` + ns + `><desc title="a>"><script>alert(1)</script></desc></svg>`,
		"CDATA":                 `<svg ` + ns + `><![CDATA[<script>alert(1)</script>]]></svg>`,
		"a:href (Q-W4.07-17)":   `<svg xmlns="http://www.w3.org/2000/svg" xmlns:a="http://www.w3.org/1999/xlink"><use a:href="https://evil.example/s.svg#a"/></svg>`,
		"&#60; (Q-W4.07-17)":    `<svg ` + ns + ` onload="alert(1)"><title>&#60;svg</title></svg>`,
		"числовая javascript":   `<svg ` + ns + `><a href="&#x6A;avascript:alert(1)"><rect/></a></svg>`,
		"foreignObject":         `<svg ` + ns + `><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>`,
		"чужое пространство":    `<svg ` + ns + ` xmlns:h="http://www.w3.org/1999/xhtml"><h:img src="#x"/></svg>`,
		"xml-stylesheet":        `<?xml-stylesheet href="https://evil.example/x.css"?><svg ` + ns + `/>`,
		"незакрытый":            `<svg ` + ns + `><rect`,
		"обработчик в верхнем":  `<svg ` + ns + ` OnLoad="alert(1)"/>`,
		"неизвестный атрибут":   `<svg ` + ns + `><rect formaction="x"/></svg>`,
		"не svg":                `<html><body/></html>`,
		"src внешний у feImage": `<svg ` + ns + `><feImage href="https://evil.example/x.png"/></svg>`,
		// Возврат 1: CSS-экранирование обходит проверку url() — обратная косая черта в значениях не нужна рисунку.
		"экранирование в style": `<svg ` + ns + `><rect style="fill:\75 rl(https://evil.example/t)" width="1" height="1"/></svg>`,
		"экранирование в fill":  `<svg ` + ns + `><rect fill="\000075rl(https://evil.example/t)" width="1" height="1"/></svg>`,
	}
	for name, svg := range unsafe {
		if !UnsafeSVG([]byte(svg)) {
			t.Errorf("%s: passed: %s", name, svg)
		}
	}
	for name, svg := range map[string]string{
		"градиент и локальная ссылка": `<svg ` + ns + ` viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#7A3E79"/></linearGradient></defs><rect width="10" height="10" fill="url(#g)"/><use xlink:href="#g"/></svg>`,
		"комментарий, &gt;, title":    `<svg ` + ns + ` viewBox="0 0 10 10"><!-- a > b --><title>Лотос &gt; знак</title><rect title="a>b" width="10" height="10" fill="#7A3E79"/></svg>`,
		"пролог и путь":               `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><path d="M0 0L10 10" stroke="#000" stroke-width="2"/><circle cx="5" cy="5" r="2" style="fill:#fff;opacity:.5"/></svg>`,
		"пустой":                      `<svg xmlns="http://www.w3.org/2000/svg"/>`,
		"комментарий до svg":          `<!-- Лотос, знак --><svg xmlns="http://www.w3.org/2000/svg"/>`,
	} {
		if UnsafeSVG([]byte(svg)) {
			t.Errorf("%s: refused: %s", name, svg)
		}
	}
}

func pngOf(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func jpegOf(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.White)
	if err := jpeg.Encode(&b, img, nil); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

// webpVP8X is the header of a WebP with an extended canvas of w×h.
func webpVP8X(w, h uint32) []byte {
	b := []byte("RIFF\x00\x00\x00\x00WEBPVP8X\x0a\x00\x00\x00\x00\x00\x00\x00")
	put24 := func(v uint32) { b = append(b, binary.LittleEndian.AppendUint32(nil, v)[:3]...) }
	put24(w - 1)
	put24(h - 1)
	return b
}

// webpVP8L is the header of a lossless WebP of w×h.
func webpVP8L(w, h uint32) []byte {
	b := []byte("RIFF\x00\x00\x00\x00WEBPVP8L\x00\x00\x00\x00\x2f")
	bits := (w - 1) | (h-1)<<14
	return binary.LittleEndian.AppendUint32(b, bits)
}

// Тип файла — по байтам; размеры растра — PNG, JPEG, WebP (VP8X, VP8L, VP8); SVG — без размеров.
func TestSniffAndSize(t *testing.T) {
	t.Parallel()
	for name, c := range map[string]struct {
		data    []byte
		kind    string
		w, h    int
		hasSize bool
	}{
		"PNG 640×512":    {pngOf(t, 640, 512), "image/png", 640, 512, true},
		"JPEG 512²":      {jpegOf(t, 512, 512), "image/jpeg", 512, 512, true},
		"WebP VP8X":      {webpVP8X(1024, 1024), "image/webp", 1024, 1024, true},
		"WebP VP8L":      {webpVP8L(600, 600), "image/webp", 600, 600, true},
		"WebP VP8":       {append([]byte("RIFF\x00\x00\x00\x00WEBPVP8 \x00\x00\x00\x00\x00\x00\x00\x9d\x01\x2a"), 0x00, 0x02, 0x00, 0x02), "image/webp", 512, 512, true},
		"SVG":            {[]byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`), "image/svg+xml", 0, 0, false},
		"SVG с прологом": {[]byte("\xef\xbb\xbf  <?xml version=\"1.0\"?>\n<svg/>"), "image/svg+xml", 0, 0, false},
		"текст":          {[]byte("hello"), "", 0, 0, false},
		// Возврат 1: SVG после комментария или DOCTYPE — тоже SVG (DOCTYPE затем отклоняет санитайзер: unsafe_svg).
		"SVG после комментария": {[]byte("<!-- logo -->\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>"), "image/svg+xml", 0, 0, false},
		"SVG после DOCTYPE":     {[]byte("<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1//EN\" \"x\"><svg/>"), "image/svg+xml", 0, 0, false},
		"комментарий без svg":   {[]byte("<!-- hello -->"), "", 0, 0, false},
		"битый PNG":             {[]byte("\x89PNG\r\n\x1a\n"), "image/png", 0, 0, false},
	} {
		if got := Sniff(c.data); got != c.kind {
			t.Errorf("%s: sniff %q, want %q", name, got, c.kind)
		}
		w, h, ok := RasterSize(c.kind, c.data)
		if ok != c.hasSize || w != c.w || h != c.h {
			t.Errorf("%s: size %d×%d %v, want %d×%d %v", name, w, h, ok, c.w, c.h, c.hasSize)
		}
	}
}
