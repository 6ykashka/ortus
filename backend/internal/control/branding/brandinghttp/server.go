// Package brandinghttp serves the branding of an organization (W4.60, contract 0.8.0-stage4 of W4.07): the tag
// Branding, the theme of the shell in /me/context (TenantContext.branding), the signs of the operator lists and the
// public files of the branding.
package brandinghttp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	brandingapi "github.com/ortus/ortus-crm/backend/internal/api/branding"
	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/branding"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Service is the branding service (branding.Service).
type Service interface {
	Current(ctx context.Context, tenantID uuid.UUID) (branding.Branding, error)
	Update(ctx context.Context, u branding.Update) (branding.Branding, error)
	UploadAsset(ctx context.Context, u branding.Upload) (branding.Asset, error)
}

// Events follow a saved version (cmd/api: the notification of the owners and context.changed, ADR-0015); best effort.
type Events interface {
	BrandingUpdated(ctx context.Context, tenantID uuid.UUID, b branding.Branding)
}

// Server is the strict server of the tag Branding.
type Server struct {
	Service Service
	Events  Events // nil — none
}

var _ brandingapi.StrictServerInterface = Server{}

const (
	noStore              = "private, no-store"
	codeRevisionRequired = "revision_required"
	codeRevisionMismatch = "revision_mismatch"
	codePayloadTooLarge  = "payload_too_large"
	detailStale          = "Данные изменились. Обновите оформление и повторите."
	detailTooLarge       = "Файл больше 1 МБ."
)

// ETag is the entity tag of a version of the branding ("rev-<version>").
func ETag(version int) string { return `"rev-` + strconv.Itoa(version) + `"` }

type assetView struct {
	ID          uuid.UUID `json:"id"`
	Kind        string    `json:"kind"`
	URL         string    `json:"url"`
	ContentType string    `json:"contentType"`
	SizeBytes   int       `json:"sizeBytes"`
	SHA256      string    `json:"sha256"`
	Width       *int      `json:"width,omitempty"`
	Height      *int      `json:"height,omitempty"`
}

func assetOf(a *branding.Asset) *assetView {
	if a == nil {
		return nil
	}
	return &assetView{ID: a.ID, Kind: a.Kind, URL: a.URL, ContentType: a.ContentType, SizeBytes: a.SizeBytes, SHA256: a.SHA256, Width: a.Width, Height: a.Height}
}

type termView struct {
	One    string `json:"one"`
	Plural string `json:"plural"`
	Few    string `json:"few"`
	Many   string `json:"many"`
}

type menuItemView struct {
	Label  *string `json:"label,omitempty"`
	Icon   *string `json:"icon,omitempty"`
	Hidden *bool   `json:"hidden,omitempty"`
}

type menuView struct {
	Items map[string]menuItemView `json:"items"`
	Order []string                `json:"order"`
}

type variantsView struct {
	Accent string `json:"accent"`
	Hover  string `json:"hover"`
	Soft   string `json:"soft"`
	Tint   string `json:"tint"`
}

type accountRefView struct {
	AccountID   *uuid.UUID `json:"accountId,omitempty"`
	DisplayName string     `json:"displayName"`
}

// brandingView is the Branding of the contract; without the author it is the BrandingTheme of the shell.
type brandingView struct {
	Version        int                 `json:"version"`
	DisplayName    string              `json:"displayName"`
	ShortName      *string             `json:"shortName"`
	AccentHex      string              `json:"accentHex"`
	AccentUsed     string              `json:"accentUsed"`
	AccentVariants variantsView        `json:"accentVariants"`
	Logo           *assetView          `json:"logo,omitempty"`
	Mark           *assetView          `json:"mark,omitempty"`
	Terms          map[string]termView `json:"terms"`
	Menu           menuView            `json:"menu"`
	PoweredBy      bool                `json:"poweredBy"`
	UpdatedAt      *time.Time          `json:"updatedAt,omitempty"`
	UpdatedBy      *accountRefView     `json:"updatedBy,omitempty"`
}

func viewOf(b branding.Branding) brandingView {
	v := branding.VariantsOf(b.AccentUsed)
	out := brandingView{
		Version: b.Version, DisplayName: b.DisplayName, ShortName: b.ShortName, AccentHex: b.AccentHex, AccentUsed: b.AccentUsed,
		AccentVariants: variantsView(v), Logo: assetOf(b.Logo), Mark: assetOf(b.Mark), Terms: make(map[string]termView, len(b.Terms)),
		Menu: menuView{Items: make(map[string]menuItemView, len(b.Menu.Items)), Order: b.Menu.Order}, PoweredBy: b.PoweredBy,
		UpdatedAt: b.UpdatedAt,
	}
	for k, t := range b.Terms {
		out.Terms[k] = termView(t)
	}
	for id, it := range b.Menu.Items {
		mv := menuItemView{}
		if it.Label != "" {
			mv.Label = new(it.Label)
		}
		if it.Icon != "" {
			mv.Icon = new(it.Icon)
		}
		if it.Hidden {
			mv.Hidden = new(true)
		}
		out.Menu.Items[id] = mv
	}
	if out.Menu.Order == nil {
		out.Menu.Order = []string{}
	}
	if b.UpdatedBy != nil {
		out.UpdatedBy = &accountRefView{AccountID: b.UpdatedBy.AccountID, DisplayName: b.UpdatedBy.DisplayName}
	}
	return out
}

// recast converts a view into a generated type with the same JSON.
func recast[T any](v any) (T, error) {
	var out T
	raw, err := json.Marshal(v)
	if err != nil {
		return out, fmt.Errorf("brandinghttp: %T: %w", v, err)
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, fmt.Errorf("brandinghttp: %T as %T: %w", v, out, err)
	}
	return out, nil
}

// serviceError maps the errors of the service to Problem codes.
func serviceError(err error) error {
	var refusal *branding.RefusalError
	switch {
	case errors.As(err, &refusal):
		return problem.New(refusal.Code, refusal.Detail)
	case errors.Is(err, branding.ErrNotFound):
		return problem.New(problem.CodeNotFound, "")
	case errors.Is(err, branding.ErrRevisionRequired):
		return problem.New(codeRevisionRequired, "")
	case errors.Is(err, branding.ErrRevisionMismatch):
		return problem.New(codeRevisionMismatch, detailStale)
	case errors.Is(err, branding.ErrTooLarge):
		return problem.New(codePayloadTooLarge, detailTooLarge)
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

// problemOf is the Problem body of code with detail and violations.
func problemOf(ctx context.Context, code, detail string, violations []branding.Violation) brandingapi.Problem {
	p := catalog.Problems[code]
	vs := make([]brandingapi.ProblemViolation, 0, len(violations))
	for _, v := range violations {
		vs = append(vs, brandingapi.ProblemViolation{Field: v.Field, Code: v.Code, Message: v.Message})
	}
	out := brandingapi.Problem{
		Type: problem.TypeBase + code, Title: p.Title, Status: int64(p.Status), Code: brandingapi.ProblemCode(code), Detail: &detail,
		RequestId: requestid.FromContext(ctx),
	}
	if len(vs) > 0 {
		out.Violations = &vs
	}
	return out
}

// validation is the 422 body of a refusal with violations.
func validation(ctx context.Context, err error) (brandingapi.Problem, bool) {
	var refusal *branding.RefusalError
	if !errors.As(err, &refusal) || len(refusal.Violations) == 0 || catalog.Problems[refusal.Code].Status != http.StatusUnprocessableEntity {
		return brandingapi.Problem{}, false
	}
	return problemOf(ctx, refusal.Code, refusal.Detail, refusal.Violations), true
}

// ownerOf is the owner of the request (the gateway admitted x-scope tenant-owner).
func ownerOf(ctx context.Context) (branding.Owner, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return branding.Owner{}, problem.New(problem.CodeNotFound, "")
	}
	return branding.Owner{TenantID: tc.TenantID, MembershipID: tc.MembershipID, AccountID: tc.AccountID}, nil
}

// GetTenantBranding implements brandingapi.StrictServerInterface: the branding in force for the Оформление screen.
func (s Server) GetTenantBranding(ctx context.Context, _ brandingapi.GetTenantBrandingRequestObject) (brandingapi.GetTenantBrandingResponseObject, error) {
	owner, err := ownerOf(ctx)
	if err != nil {
		return nil, err
	}
	b, err := s.Service.Current(ctx, owner.TenantID)
	if err != nil {
		return nil, serviceError(err)
	}
	body, err := recast[brandingapi.Branding](viewOf(b))
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cache, rid, tag := noStore, requestid.FromContext(ctx), ETag(b.Version)
	return brandingapi.GetTenantBranding200JSONResponse{Body: body,
		Headers: brandingapi.GetTenantBranding200ResponseHeaders{CacheControl: &cache, ETag: &tag, XRequestId: &rid}}, nil
}

// updateOf is the body of updateTenantBranding as a command.
func updateOf(owner branding.Owner, ifMatch string, b brandingapi.BrandingUpdate) branding.Update {
	u := branding.Update{
		Owner: owner, IfMatch: ifMatch, DisplayName: b.DisplayName, ShortName: b.ShortName, AccentHex: b.AccentHex,
		LogoAssetID: b.LogoAssetId, MarkAssetID: b.MarkAssetId, PoweredBy: b.PoweredBy, Terms: map[string]branding.Term{},
		Menu: branding.Menu{Items: map[string]branding.MenuItem{}, Order: b.Menu.Order},
	}
	for key, t := range map[string]*brandingapi.BrandingTerm{
		"shift": b.Terms.Shift, "vehicle": b.Terms.Vehicle, "trip": b.Terms.Trip, "visit": b.Terms.Visit, "object": b.Terms.Object,
	} {
		if t != nil {
			u.Terms[key] = branding.Term{One: t.One, Plural: t.Plural, Few: t.Few, Many: t.Many}
		}
	}
	for id, it := range b.Menu.Items {
		item := branding.MenuItem{}
		if it.Label != nil {
			item.Label = *it.Label
		}
		if it.Icon != nil {
			item.Icon = *it.Icon
		}
		item.Hidden = it.Hidden != nil && *it.Hidden
		u.Menu.Items[id] = item
	}
	if u.Menu.Order == nil {
		u.Menu.Order = []string{}
	}
	return u
}

// UpdateTenantBranding implements brandingapi.StrictServerInterface: a new version; a field refusal is the 422 of the
// example, a stale If-Match the 412 with the text of the screen.
func (s Server) UpdateTenantBranding(ctx context.Context, req brandingapi.UpdateTenantBrandingRequestObject) (brandingapi.UpdateTenantBrandingResponseObject, error) {
	owner, err := ownerOf(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	b, err := s.Service.Update(ctx, updateOf(owner, req.Params.IfMatch, *req.Body))
	if p, ok := validation(ctx, err); ok {
		return brandingapi.UpdateTenantBranding422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: brandingapi.ValidationApplicationProblemPlusJSONResponse{
			Body: p, Headers: brandingapi.ValidationResponseHeaders{XRequestId: &p.RequestId}}}, nil
	}
	if err != nil {
		return nil, serviceError(err)
	}
	if s.Events != nil {
		s.Events.BrandingUpdated(ctx, owner.TenantID, b)
	}
	body, err := recast[brandingapi.Branding](viewOf(b))
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cache, rid, tag, replayed := noStore, requestid.FromContext(ctx), ETag(b.Version), false
	return brandingapi.UpdateTenantBranding200JSONResponse{Body: body, Headers: brandingapi.UpdateTenantBranding200ResponseHeaders{
		CacheControl: &cache, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: &rid}}, nil
}

// UploadBrandingAsset implements brandingapi.StrictServerInterface: larger than 1 MiB — the 413 of the example; the
// checks of the file — the 422 of the example.
func (s Server) UploadBrandingAsset(ctx context.Context, req brandingapi.UploadBrandingAssetRequestObject) (brandingapi.UploadBrandingAssetResponseObject, error) {
	owner, err := ownerOf(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	a, err := s.Service.UploadAsset(ctx, branding.Upload{
		Owner: owner, Kind: string(req.Body.Kind), FileName: req.Body.FileName, ContentType: string(req.Body.ContentType), Data: req.Body.ContentBase64,
	})
	if errors.Is(err, branding.ErrTooLarge) {
		p := problemOf(ctx, codePayloadTooLarge, detailTooLarge, nil)
		return brandingapi.UploadBrandingAsset413ApplicationProblemPlusJSONResponse{TooLargeApplicationProblemPlusJSONResponse: brandingapi.TooLargeApplicationProblemPlusJSONResponse{
			Body: p, Headers: brandingapi.TooLargeResponseHeaders{XRequestId: &p.RequestId}}}, nil
	}
	if p, ok := validation(ctx, err); ok {
		return brandingapi.UploadBrandingAsset422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: brandingapi.ValidationApplicationProblemPlusJSONResponse{
			Body: p, Headers: brandingapi.ValidationResponseHeaders{XRequestId: &p.RequestId}}}, nil
	}
	if err != nil {
		return nil, serviceError(err)
	}
	body, err := recast[brandingapi.BrandingAsset](assetOf(&a))
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	cache, rid, replayed := noStore, requestid.FromContext(ctx), false
	return brandingapi.UploadBrandingAsset201JSONResponse{Body: body, Headers: brandingapi.UploadBrandingAsset201ResponseHeaders{
		CacheControl: &cache, IdempotencyReplayed: &replayed, XRequestId: &rid}}, nil
}

// Current reads the branding in force (branding.Service).
type Current interface {
	Current(ctx context.Context, tenantID uuid.UUID) (branding.Branding, error)
}

// Themes is the theme of the shell for /me/context (mehttp.Branding): the branding in force without its author and
// save moment, the same for every member.
type Themes struct{ Service Current }

// Theme implements mehttp.Branding.
func (t Themes) Theme(ctx context.Context, tenantID uuid.UUID) (*contextapi.BrandingTheme, error) {
	b, err := t.Service.Current(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	v := viewOf(b)
	v.UpdatedAt, v.UpdatedBy = nil, nil
	theme, err := recast[contextapi.BrandingTheme](v)
	if err != nil {
		return nil, err
	}
	return &theme, nil
}

// MarkSource is the signs of the branding service.
type MarkSource interface {
	Marks(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]branding.Mark, error)
}

// Marks are the signs of the operator lists (billinghttp.Marks).
type Marks struct{ Service MarkSource }

// Marks implements billinghttp.Marks.
func (m Marks) Marks(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]platformapi.TenantBrandMark, error) {
	marks, err := m.Service.Marks(ctx, ids)
	if err != nil {
		return nil, err
	}
	out := make(map[uuid.UUID]platformapi.TenantBrandMark, len(marks))
	for id, mk := range marks {
		v := platformapi.TenantBrandMark{AccentUsed: mk.AccentUsed}
		if mk.ShortName != "" {
			v.ShortName = new(mk.ShortName)
		}
		if mk.MarkURL != "" {
			v.MarkUrl = new(mk.MarkURL)
		}
		out[id] = v
	}
	return out, nil
}

// PublicSource opens the public files of the branding.
type PublicSource interface {
	Public(ctx context.Context, file string) (string, io.ReadCloser, error)
}

// Public serves GET /brand-assets/{sha256}.{ext}: public immutable files of logos and signs with the stored content
// type, X-Content-Type-Options nosniff and Content-Security-Policy sandbox (an SVG opened directly runs nothing).
type Public struct{ Service PublicSource }

func (p Public) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	file := strings.TrimPrefix(r.URL.Path, branding.PublicPrefix)
	contentType, body, err := p.Service.Public(r.Context(), file)
	switch {
	case errors.Is(err, branding.ErrNotFound):
		problem.Write(w, r, problem.New(problem.CodeNotFound, ""))
		return
	case err != nil:
		problem.Write(w, r, problem.Wrap(problem.CodeDependencyUnavailable, err))
		return
	}
	defer body.Close()
	h := w.Header()
	h.Set("Content-Type", contentType)
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Content-Security-Policy", "sandbox")
	h.Set("Cache-Control", "public, max-age=31536000, immutable")
	w.WriteHeader(http.StatusOK)
	_, _ = io.Copy(w, body) // the client is gone if the copy fails
}
