package files

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
)

// Codes of rejected files (files.objects.rejected_code).
const (
	CodeMalware       = "malware_detected"
	CodeMIMEMismatch  = "mime_mismatch"
	CodeTooLarge      = "too_large"
	CodeObjectMissing = "object_missing"
	// CodeChecksumMismatch: the checked object is not the one completeUpload verified (size or SHA-256).
	CodeChecksumMismatch = "checksum_mismatch"
)

// Verdict is the result of a check.
type Verdict struct {
	Clean        bool
	Code         string // rejected_code when not clean
	DetectedMIME string
}

// Scanner checks the content of an uploaded file against its declared type (FILE-02). An antivirus engine
// (ClamAV or the provider's) plugs in here; the choice is D-05/ADR-0006.
type Scanner interface {
	Scan(ctx context.Context, r io.Reader, declared string) (Verdict, error)
}

// BasicScanner rejects the EICAR test signature and a real type that differs from the declared one.
type BasicScanner struct{}

var _ Scanner = BasicScanner{}

// eicar is the signature of the standard antivirus test file.
var eicar = []byte(`EICAR-STANDARD-ANTIVIRUS-TEST-FILE`)

// sniffed lists the real types accepted for a declared type (net/http sniffing, HEIC by its ftyp brand).
var sniffed = map[string]func(string) bool{
	mimeJPEG: equals(mimeJPEG), mimePNG: equals(mimePNG), mimeWebP: equals(mimeWebP), mimeHEIC: equals(mimeHEIC),
	mimePDF: equals(mimePDF), mimeDOCX: equals("application/zip"), mimeXLSX: equals("application/zip"),
	mimeText: textual, mimeCSV: textual,
	mimeMP4: equals(mimeMP4), mimeWebM: equals(mimeWebM), mimeMP3: equals(mimeMP3), mimeOGG: oggAudio,
}

// oggAudio accepts what net/http sniffs for an Ogg container: audio/ogg or application/ogg.
func oggAudio(got string) bool { return got == mimeOGG || got == "application/ogg" }

func equals(want string) func(string) bool { return func(got string) bool { return got == want } }

func textual(got string) bool { return strings.HasPrefix(got, mimeText) }

// heicBrands are the ftyp brands of HEIF images.
var heicBrands = []string{"heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"}

// detect is the real type of data.
func detect(data []byte) string {
	if len(data) >= 12 && string(data[4:8]) == "ftyp" && slices.Contains(heicBrands, string(data[8:12])) {
		return mimeHEIC
	}
	return http.DetectContentType(data)
}

// Scan implements Scanner: the body is read up to MaxBytes.
func (BasicScanner) Scan(_ context.Context, r io.Reader, declared string) (Verdict, error) {
	data, err := io.ReadAll(io.LimitReader(r, MaxBytes+1))
	if err != nil {
		return Verdict{}, fmt.Errorf("files: scan: %w", err)
	}
	if int64(len(data)) > MaxBytes {
		return Verdict{Code: CodeTooLarge}, nil
	}
	v := Verdict{DetectedMIME: detect(data)}
	accepts, known := sniffed[declared]
	switch {
	case bytes.Contains(data, eicar):
		v.Code = CodeMalware
	case !known || !accepts(v.DetectedMIME):
		v.Code = CodeMIMEMismatch
	default:
		v.Clean = true
	}
	return v, nil
}
