package branding

import (
	"context"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Errors of the service.
var (
	ErrNotFound         = errors.New("branding: not found")
	ErrRevisionRequired = errors.New("branding: If-Match is required")
	ErrRevisionMismatch = errors.New("branding: If-Match is not the version in force")
	ErrTooLarge         = errors.New("branding: the file is larger than 1 MiB")
	ErrNoStorage        = errors.New("branding: the object storage is not configured")
)

// Violation is one field error of a 422 (ProblemViolation).
type Violation struct {
	Field, Code, Message string
}

// RefusalError is a refused command (422) with the detail and the field violations.
type RefusalError struct {
	Code, Detail string
	Violations   []Violation
}

func (r *RefusalError) Error() string {
	parts := []string{"branding: " + r.Code, r.Detail}
	for _, v := range r.Violations {
		parts = append(parts, v.Field+": "+v.Message)
	}
	return strings.Join(parts, "; ")
}

// Kinds of a file of the branding.
const (
	KindLogo = "logo"
	KindMark = "mark"
)

// Asset is a logo or a sign (BrandingAsset).
type Asset struct {
	ID                uuid.UUID
	Kind, ContentType string
	URL               string // public immutable address /brand-assets/<sha256>.<ext>
	SizeBytes         int
	SHA256            string // hex
	Width, Height     *int   // a raster image
}

// Term are the four forms of a term of the catalogue.
type Term struct {
	One, Plural, Few, Many string
}

// MenuItem is the override of one menu item.
type MenuItem struct {
	Label, Icon string
	Hidden      bool
}

// Menu are the menu settings of the organization.
type Menu struct {
	Items map[string]MenuItem
	Order []string
}

// AccountRef is the author of a version.
type AccountRef struct {
	AccountID   *uuid.UUID
	DisplayName string
}

// Branding is the branding of an organization in force (Branding).
type Branding struct {
	Version     int
	DisplayName string
	ShortName   *string
	AccentHex   string
	AccentUsed  string
	Logo, Mark  *Asset
	Terms       map[string]Term
	Menu        Menu
	PoweredBy   bool
	UpdatedAt   *time.Time  // nil — the standard branding
	UpdatedBy   *AccountRef // nil — the standard branding
}

// Owner is the owner of the organization acting (the TenantContext of the gateway).
type Owner struct {
	TenantID, MembershipID, AccountID uuid.UUID
}

// Update is updateTenantBranding (BrandingUpdate: the whole branding of the new version).
type Update struct {
	Owner                    Owner
	IfMatch                  string
	DisplayName              string
	ShortName                *string
	AccentHex                string
	LogoAssetID, MarkAssetID *uuid.UUID
	Terms                    map[string]Term
	Menu                     Menu
	PoweredBy                bool
	RequestID                string
}

// Upload is uploadBrandingAsset.
type Upload struct {
	Owner       Owner
	Kind        string
	FileName    string
	ContentType string
	Data        []byte // the decoded bytes of contentBase64
}

// Mark is the sign of an organization for the operator lists (TenantBrandMark).
type Mark struct {
	ShortName, AccentUsed, MarkURL string
}

// Blobs is the public object storage of the files of the branding.
type Blobs interface {
	Put(ctx context.Context, key, contentType string, data []byte) error
	Open(ctx context.Context, key string) (io.ReadCloser, error)
}
