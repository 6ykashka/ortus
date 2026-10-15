package files_test

import (
	"bytes"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/modules/files" //nolint:depguard // the package under test
)

// eicar is the standard antivirus test file (EICAR): every scanner reports it.
const eicar = `X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*`

var (
	jpegBytes = append([]byte{0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0x00}, bytes.Repeat([]byte{1}, 64)...)
	pngBytes  = append([]byte("\x89PNG\r\n\x1a\n"), bytes.Repeat([]byte{2}, 64)...)
	pdfBytes  = []byte("%PDF-1.7\n1 0 obj << >> endobj\n")
	zipBytes  = append([]byte("PK\x03\x04"), bytes.Repeat([]byte{3}, 64)...)
	heicBytes = append([]byte("\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic"), bytes.Repeat([]byte{4}, 64)...)
)

// FILE-02: before the check the file is not evidence; the check rejects malware and a real type that differs
// from the declared one.
func TestBasicScanner(t *testing.T) {
	t.Parallel()
	docx := "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
	cases := []struct {
		name, declared string
		content        []byte
		code, detected string
	}{
		{"JPEG", "image/jpeg", jpegBytes, "", "image/jpeg"},
		{"PNG", "image/png", pngBytes, "", "image/png"},
		{"PDF", "application/pdf", pdfBytes, "", "application/pdf"},
		{"DOCX", docx, zipBytes, "", "application/zip"},
		{"HEIC", "image/heic", heicBytes, "", "image/heic"},
		{"текст", "text/plain", []byte("Привет"), "", "text/plain; charset=utf-8"},
		{"PNG под видом JPEG", "image/jpeg", pngBytes, files.CodeMIMEMismatch, "image/png"},
		{"HTML под видом PDF", "application/pdf", []byte("<html><script>alert(1)</script></html>"), files.CodeMIMEMismatch, "text/html; charset=utf-8"},
		{"EICAR", "text/plain", []byte(eicar), files.CodeMalware, "text/plain; charset=utf-8"},
		{"EICAR внутри JPEG", "image/jpeg", append(slicesClone(jpegBytes), []byte(eicar)...), files.CodeMalware, "image/jpeg"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			v, err := files.BasicScanner{}.Scan(t.Context(), bytes.NewReader(tc.content), tc.declared)
			if err != nil {
				t.Fatal(err)
			}
			if v.Clean != (tc.code == "") || v.Code != tc.code || v.DetectedMIME != tc.detected {
				t.Fatalf("verdict %+v, want code %q detected %q", v, tc.code, tc.detected)
			}
		})
	}
}

// A body longer than the limit is not read whole: the scanner rejects it as too large.
func TestBasicScannerTooLarge(t *testing.T) {
	t.Parallel()
	big := strings.NewReader(string(jpegBytes) + strings.Repeat("x", int(files.MaxBytes)))
	v, err := files.BasicScanner{}.Scan(t.Context(), big, "image/jpeg")
	if err != nil || v.Clean || v.Code != files.CodeTooLarge {
		t.Fatalf("verdict %+v %v", v, err)
	}
}

func slicesClone(b []byte) []byte { return append([]byte(nil), b...) }
