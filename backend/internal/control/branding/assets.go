package branding

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"regexp"

	"github.com/google/uuid"
)

// MaxFile is the size limit of a file of the branding (1 MiB decoded).
const MaxFile = 1 << 20

// minMark is the side of the smallest raster sign (a square, PWA icon).
const minMark = 512

// extensions are the file extensions of the public addresses by content type.
var extensions = map[string]string{TypePNG: "png", TypeSVG: "svg", TypeJPEG: "jpg", TypeWebP: "webp"}

var publicRE = regexp.MustCompile(`^([0-9a-f]{64})\.(png|svg|jpg|webp)$`)

// PublicPrefix is the path of the public files of the branding (served by cmd/api).
const PublicPrefix = "/brand-assets/"

// publicURL is the immutable public address of a file by its content.
func publicURL(hash, contentType string) string {
	return PublicPrefix + hash + "." + extensions[contentType]
}

// parsePublic parses «<sha256>.<ext>» into the hash and the content type.
func parsePublic(file string) (string, string, bool) {
	m := publicRE.FindStringSubmatch(file)
	if m == nil {
		return "", "", false
	}
	for ct, ext := range extensions {
		if ext == m[2] {
			return m[1], ct, true
		}
	}
	return "", "", false
}

// storageKey is the object key of a file in the storage.
func storageKey(hash, contentType string) string {
	return "branding/" + hash + "." + extensions[contentType]
}

// assetOf reads a file of the branding (nil id — none).
func assetOf(ctx context.Context, q queryer, id uuid.NullUUID) (*Asset, error) {
	if !id.Valid {
		return nil, nil //nolint:nilnil // no file is not an error
	}
	a := Asset{ID: id.UUID}
	var w, h sql.NullInt64
	err := q.QueryRowContext(ctx, `select kind, content_type, size_bytes, encode(sha256, 'hex'), width, height from branding_assets where id = $1`, id.UUID).
		Scan(&a.Kind, &a.ContentType, &a.SizeBytes, &a.SHA256, &w, &h)
	if err != nil {
		return nil, fmt.Errorf("branding: file %s: %w", id.UUID, err)
	}
	a.URL = publicURL(a.SHA256, a.ContentType)
	if w.Valid && h.Valid {
		a.Width, a.Height = new(int(w.Int64)), new(int(h.Int64))
	}
	return &a, nil
}

// UploadAsset checks and stores a file of the branding (uploadBrandingAsset; the strict server decodes the base64 of
// contentBase64): larger than 1 MiB — ErrTooLarge; the real type by the bytes must be the declared one (422
// contentType), SVG passes the sanitizer (422 unsafe_svg), a raster sign is a square of at least 512×512 (422
// mark_size). The bytes go to the object storage under the address of their content; the file takes effect when a
// version refers to it.
func (s *Service) UploadAsset(ctx context.Context, u Upload) (Asset, error) {
	if u.Kind != KindLogo && u.Kind != KindMark {
		return Asset{}, refusal("kind", "kind", "Логотип или знак")
	}
	data := u.Data
	if len(data) > MaxFile {
		return Asset{}, ErrTooLarge
	}
	a, err := checkFile(u, data)
	if err != nil {
		return Asset{}, err
	}
	if s.Blobs == nil {
		return Asset{}, ErrNoStorage
	}
	sum := sha256.Sum256(data)
	a.SHA256 = hex.EncodeToString(sum[:])
	a.URL, a.ID = publicURL(a.SHA256, a.ContentType), uuid.New()
	if err := s.Blobs.Put(ctx, storageKey(a.SHA256, a.ContentType), a.ContentType, data); err != nil {
		return Asset{}, fmt.Errorf("branding: store file: %w", err)
	}
	if _, err := s.Control.ExecContext(ctx, `insert into branding_assets (id, tenant_id, kind, content_type, size_bytes, sha256, storage_key, width,
  height, uploaded_by) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, a.ID, u.Owner.TenantID, a.Kind, a.ContentType, a.SizeBytes, sum[:],
		storageKey(a.SHA256, a.ContentType), a.Width, a.Height, u.Owner.AccountID); err != nil {
		return Asset{}, fmt.Errorf("branding: file record: %w", err)
	}
	return a, nil
}

// checkFile checks the bytes of an upload and describes them.
func checkFile(u Upload, data []byte) (Asset, error) {
	sniffed := Sniff(data)
	if sniffed == "" || sniffed != u.ContentType {
		return Asset{}, &RefusalError{Code: codeValidated, Detail: "Нужен PNG, SVG, JPG или WebP.",
			Violations: []Violation{{Field: "contentType", Code: "content_type", Message: "Нужен PNG, SVG, JPG или WebP"}}}
	}
	if sniffed == TypeSVG && UnsafeSVG(data) {
		return Asset{}, &RefusalError{Code: codeValidated, Detail: "SVG небезопасен.",
			Violations: []Violation{{Field: "contentBase64", Code: "unsafe_svg", Message: "В SVG не должно быть скриптов и внешних ссылок"}}}
	}
	a := Asset{Kind: u.Kind, ContentType: sniffed, SizeBytes: len(data)}
	w, h, ok := RasterSize(sniffed, data)
	if ok {
		a.Width, a.Height = &w, &h
	}
	if u.Kind == KindMark && sniffed != TypeSVG && (!ok || w != h || w < minMark) {
		return Asset{}, &RefusalError{Code: codeValidated, Detail: "Знак — квадрат не меньше 512×512.",
			Violations: []Violation{{Field: "contentBase64", Code: "mark_size", Message: "Знак — квадрат не меньше 512×512"}}}
	}
	return a, nil
}
