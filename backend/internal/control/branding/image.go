package branding

import (
	"bytes"
	"encoding/binary"
	"image/jpeg"
	"image/png"
	"strings"
)

// Content types of the files of the branding (BrandingAsset.contentType).
const (
	TypePNG  = "image/png"
	TypeSVG  = "image/svg+xml"
	TypeJPEG = "image/jpeg"
	TypeWebP = "image/webp"
)

// Sniff is the real type of a file by its bytes (PNG, JPEG, WebP; SVG — an svg element at the start, optionally after
// a BOM, whitespace and the XML declaration, a comment or a DOCTYPE, within the first 512 bytes); "" — none of them.
// A DOCTYPE makes it SVG all the same: the sanitizer then refuses it as unsafe_svg, not as a wrong content type.
func Sniff(data []byte) string {
	switch {
	case bytes.HasPrefix(data, []byte("\x89PNG")):
		return TypePNG
	case bytes.HasPrefix(data, []byte{0xff, 0xd8, 0xff}):
		return TypeJPEG
	case len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WEBP":
		return TypeWebP
	}
	head := data[:min(len(data), 512)]
	head = bytes.TrimPrefix(head, []byte("\xef\xbb\xbf"))
	text := strings.ToLower(strings.TrimLeft(string(head), " \t\r\n"))
	prolog := strings.HasPrefix(text, "<?xml") || strings.HasPrefix(text, "<!--") || strings.HasPrefix(text, "<!doctype")
	if strings.HasPrefix(text, "<svg") || (prolog && strings.Contains(text, "<svg")) {
		return TypeSVG
	}
	return ""
}

// RasterSize reads the pixels of a raster image of contentType (PNG, JPEG, WebP by its first chunk VP8X, VP8L or
// «VP8 »); ok is false for SVG and for a file whose size cannot be read.
func RasterSize(contentType string, data []byte) (w, h int, ok bool) {
	switch contentType {
	case TypePNG:
		cfg, err := png.DecodeConfig(bytes.NewReader(data))
		return cfg.Width, cfg.Height, err == nil
	case TypeJPEG:
		cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
		return cfg.Width, cfg.Height, err == nil
	case TypeWebP:
		return webpSize(data)
	}
	return 0, 0, false
}

// webpSize reads the canvas of a WebP (MSW webpSize).
func webpSize(b []byte) (int, int, bool) {
	if len(b) < 16 {
		return 0, 0, false
	}
	u24 := func(i int) int { return int(b[i]) | int(b[i+1])<<8 | int(b[i+2])<<16 }
	switch string(b[12:16]) {
	case "VP8X":
		if len(b) >= 30 {
			return u24(24) + 1, u24(27) + 1, true
		}
	case "VP8L":
		if len(b) >= 25 && b[20] == 0x2f {
			bits := binary.LittleEndian.Uint32(b[21:25])
			return int(bits&0x3fff) + 1, int(bits>>14&0x3fff) + 1, true
		}
	case "VP8 ":
		if len(b) >= 30 && b[23] == 0x9d && b[24] == 0x01 && b[25] == 0x2a {
			return int(binary.LittleEndian.Uint16(b[26:28]) & 0x3fff), int(binary.LittleEndian.Uint16(b[28:30]) & 0x3fff), true
		}
	}
	return 0, 0, false
}
