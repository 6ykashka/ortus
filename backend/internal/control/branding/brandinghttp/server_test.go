package brandinghttp

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	brandingapi "github.com/ortus/ortus-crm/backend/internal/api/branding"
	"github.com/ortus/ortus-crm/backend/internal/control/branding"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var (
	now    = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	lotos  = uuid.MustParse("e4f2195f-f5a3-5f61-98be-f6ed76ea565a")
	alta   = uuid.MustParse("f04f636e-b66d-509e-ae10-9c27a18e3baa")
	belova = branding.AccountRef{AccountID: new(uuid.MustParse("b2d93da5-f9c0-59ca-994d-baa75ffd2ad8")), DisplayName: "Ирина Белова"}
	visit  = map[string]branding.Term{"visit": {One: "сеанс", Plural: "сеансы", Few: "сеанса", Many: "сеансов"}}
)

// lotosV3 is the branding of «Лотос» of the example getTenantBranding/ok.
func lotosV3() branding.Branding {
	return branding.Branding{
		Version: 3, DisplayName: "SPA «Лотос»", ShortName: new("Лотос"), AccentHex: "#7A3E79", AccentUsed: "#7A3E79", Terms: visit,
		Menu: branding.Menu{Items: map[string]branding.MenuItem{}, Order: []string{}}, PoweredBy: true,
		UpdatedAt: new(time.Date(2026, 9, 24, 9, 10, 0, 0, time.UTC)), UpdatedBy: &belova,
	}
}

func markAsset() branding.Asset {
	sha := "0651366c1bbe04aa80c06f4013d157607d512970e0b987e6a0d211a06dc0c045"
	return branding.Asset{
		ID: uuid.MustParse("a3ecbda9-12cc-59fb-91f8-14c655ce1d56"), Kind: branding.KindMark, ContentType: branding.TypePNG,
		URL: "/brand-assets/" + sha + ".png", SizeBytes: 48213, SHA256: sha, Width: new(512), Height: new(512),
	}
}

type fake struct {
	branding branding.Branding
	asset    branding.Asset
	err      error
	update   branding.Update
	upload   branding.Upload
	tenant   uuid.UUID
}

func (f *fake) Current(_ context.Context, id uuid.UUID) (branding.Branding, error) {
	f.tenant = id
	return f.branding, f.err
}

func (f *fake) Update(_ context.Context, u branding.Update) (branding.Branding, error) {
	f.update = u
	return f.branding, f.err
}

func (f *fake) UploadAsset(_ context.Context, u branding.Upload) (branding.Asset, error) {
	f.upload = u
	return f.asset, f.err
}

type events struct{ saved []int }

func (e *events) BrandingUpdated(_ context.Context, _ uuid.UUID, b branding.Branding) {
	e.saved = append(e.saved, b.Version)
}

func owner(t *testing.T, tenant uuid.UUID) context.Context {
	t.Helper()
	return tenantctx.WithTenant(t.Context(), tenantctx.TenantContext{TenantID: tenant, MembershipID: uuid.New(), AccountID: *belova.AccountID, Owner: true})
}

func example(t *testing.T, op, name string, withoutRequestID bool) string {
	t.Helper()
	root, err := os.OpenRoot(filepath.Join("..", "..", "..", "..", "..", "api", "openapi", "examples", op))
	if err != nil {
		t.Fatal(err)
	}
	defer root.Close()
	raw, err := root.ReadFile(name + ".json")
	if err != nil {
		t.Fatal(err)
	}
	return canonical(t, raw, withoutRequestID)
}

func canonical(t *testing.T, raw []byte, withoutRequestID bool) string {
	t.Helper()
	var v any
	if err := json.Unmarshal(raw, &v); err != nil {
		t.Fatal(err)
	}
	if m, ok := v.(map[string]any); ok && withoutRequestID {
		delete(m, "requestId")
	}
	out, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return string(out)
}

func jsonOf(t *testing.T, v any, withoutRequestID bool) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return canonical(t, raw, withoutRequestID)
}

func same(t *testing.T, what, got, want string) {
	t.Helper()
	if got != want {
		t.Errorf("%s\n got %s\nwant %s", what, got, want)
	}
}

func eq[T any](t *testing.T, what string, got, want T) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n got %+v\nwant %+v", what, got, want)
	}
}

// Оформление владельца: тело = примеры ok и standard (shortName null), ETag «rev-N».
func TestGetTenantBranding(t *testing.T) {
	t.Parallel()
	f := &fake{branding: lotosV3()}
	srv := Server{Service: f}
	resp, err := srv.GetTenantBranding(owner(t, lotos), brandingapi.GetTenantBrandingRequestObject{TenantId: lotos})
	if err != nil {
		t.Fatal(err)
	}
	ok, _ := resp.(brandingapi.GetTenantBranding200JSONResponse)
	same(t, "ok", jsonOf(t, ok.Body, false), example(t, "getTenantBranding", "ok", false))
	eq(t, "etag and tenant", [3]any{*ok.Headers.ETag, *ok.Headers.CacheControl, f.tenant}, [3]any{`"rev-3"`, "private, no-store", lotos})
	f.branding = branding.Branding{Version: 1, DisplayName: "Альта Групп", AccentHex: branding.DefaultAccent, AccentUsed: branding.DefaultAccent,
		Terms: map[string]branding.Term{}, Menu: branding.Menu{Items: map[string]branding.MenuItem{}, Order: []string{}}, PoweredBy: true}
	resp, err = srv.GetTenantBranding(owner(t, alta), brandingapi.GetTenantBrandingRequestObject{TenantId: alta})
	if err != nil {
		t.Fatal(err)
	}
	ok, _ = resp.(brandingapi.GetTenantBranding200JSONResponse)
	same(t, "standard", jsonOf(t, ok.Body, false), example(t, "getTenantBranding", "standard", false))
	if _, err := srv.GetTenantBranding(t.Context(), brandingapi.GetTenantBrandingRequestObject{TenantId: alta}); !problem.Is(err, problem.CodeNotFound) {
		t.Errorf("without tenant: %v", err)
	}
}

func lotosV4() branding.Branding {
	b := lotosV3()
	b.Version, b.AccentHex, b.AccentUsed = 4, "#C9A227", "#8B701D"
	b.Menu = branding.Menu{Items: map[string]branding.MenuItem{"calendar": {Label: "Записи", Icon: "event_available"}}, Order: []string{}}
	b.UpdatedAt, b.Mark = new(now), new(markAsset())
	return b
}

// Сохранение: тело = пример ok, ETag новой версии, событие; команда несёт If-Match, термины, меню, файлы; отказы —
// 412 и 422 примеров.
func TestUpdateTenantBranding(t *testing.T) {
	t.Parallel()
	ev := &events{}
	f := &fake{branding: lotosV4()}
	srv := Server{Service: f, Events: ev}
	mark := markAsset().ID
	body := &brandingapi.BrandingUpdate{
		DisplayName: "SPA «Лотос»", ShortName: new("Лотос"), AccentHex: "#C9A227", MarkAssetId: &mark, PoweredBy: true,
		Terms: brandingapi.BrandingTerms{Visit: &brandingapi.BrandingTerm{One: "сеанс", Plural: "сеансы", Few: "сеанса", Many: "сеансов"}},
		Menu:  brandingapi.BrandingMenu{Items: map[string]brandingapi.BrandingMenuItem{"calendar": {Label: new("Записи"), Icon: new("event_available")}}, Order: []string{}},
	}
	resp, err := srv.UpdateTenantBranding(owner(t, lotos), brandingapi.UpdateTenantBrandingRequestObject{TenantId: lotos,
		Params: brandingapi.UpdateTenantBrandingParams{IfMatch: `"rev-3"`}, Body: body})
	if err != nil {
		t.Fatal(err)
	}
	ok, _ := resp.(brandingapi.UpdateTenantBranding200JSONResponse)
	same(t, "ok", jsonOf(t, ok.Body, false), example(t, "updateTenantBranding", "ok", false))
	eq(t, "etag and events", [2]any{*ok.Headers.ETag, ev.saved}, [2]any{`"rev-4"`, []int{4}})
	u := f.update
	eq(t, "command", [6]any{u.IfMatch, u.Terms, u.Menu, *u.MarkAssetID, u.LogoAssetID == nil, u.Owner.TenantID},
		[6]any{`"rev-3"`, visit, branding.Menu{Items: map[string]branding.MenuItem{"calendar": {Label: "Записи", Icon: "event_available"}}, Order: []string{}},
			mark, true, lotos})
	f.err = branding.ErrRevisionMismatch
	_, err = srv.UpdateTenantBranding(owner(t, lotos), brandingapi.UpdateTenantBrandingRequestObject{TenantId: lotos, Body: body})
	pe, _ := errors.AsType[*problem.Error](err)
	eq(t, "412", [2]string{pe.Code, pe.Detail}, [2]string{"revision_mismatch", "Данные изменились. Обновите оформление и повторите."})
	f.err = branding.ErrRevisionRequired
	_, err = srv.UpdateTenantBranding(owner(t, lotos), brandingapi.UpdateTenantBrandingRequestObject{TenantId: lotos, Body: body})
	eq(t, "428", problem.Is(err, "revision_required"), true)
	f.err = &branding.RefusalError{Code: "validation_failed", Detail: "Проверьте оформление.", Violations: []branding.Violation{
		{Field: "terms.visit.many", Code: "required", Message: "Термин «визит»: заполните все четыре формы"},
	}}
	resp, err = srv.UpdateTenantBranding(owner(t, lotos), brandingapi.UpdateTenantBrandingRequestObject{TenantId: lotos, Body: body})
	if err != nil {
		t.Fatal(err)
	}
	refused, _ := resp.(brandingapi.UpdateTenantBranding422ApplicationProblemPlusJSONResponse)
	same(t, "422", jsonOf(t, refused.Body, true), example(t, "updateTenantBranding", "validation_failed", true))
	eq(t, "no events on a refusal", ev.saved, []int{4})
}

// Файл: тело = пример ok; 413 и 422 — тела примеров; без хранилища — 503.
func TestUploadBrandingAsset(t *testing.T) {
	t.Parallel()
	f := &fake{asset: markAsset()}
	srv := Server{Service: f}
	data := []byte("\x89PNG...")
	resp, err := srv.UploadBrandingAsset(owner(t, lotos), brandingapi.UploadBrandingAssetRequestObject{TenantId: lotos,
		Body: &brandingapi.BrandingAssetUpload{Kind: "mark", FileName: "mark.png", ContentType: "image/png", ContentBase64: data}})
	if err != nil {
		t.Fatal(err)
	}
	ok, _ := resp.(brandingapi.UploadBrandingAsset201JSONResponse)
	same(t, "ok", jsonOf(t, ok.Body, false), example(t, "uploadBrandingAsset", "ok", false))
	eq(t, "command", [4]any{f.upload.Kind, f.upload.ContentType, string(f.upload.Data), f.upload.Owner.TenantID}, [4]any{"mark", "image/png", string(data), lotos})
	f.err = branding.ErrTooLarge
	resp, err = srv.UploadBrandingAsset(owner(t, lotos), brandingapi.UploadBrandingAssetRequestObject{TenantId: lotos, Body: &brandingapi.BrandingAssetUpload{}})
	if err != nil {
		t.Fatal(err)
	}
	large, _ := resp.(brandingapi.UploadBrandingAsset413ApplicationProblemPlusJSONResponse)
	same(t, "413", jsonOf(t, large.Body, true), example(t, "uploadBrandingAsset", "payload_too_large", true))
	f.err = &branding.RefusalError{Code: "validation_failed", Detail: "Нужен PNG, SVG, JPG или WebP.", Violations: []branding.Violation{
		{Field: "contentType", Code: "content_type", Message: "Нужен PNG, SVG, JPG или WebP"},
	}}
	resp, _ = srv.UploadBrandingAsset(owner(t, lotos), brandingapi.UploadBrandingAssetRequestObject{TenantId: lotos, Body: &brandingapi.BrandingAssetUpload{}})
	refused, _ := resp.(brandingapi.UploadBrandingAsset422ApplicationProblemPlusJSONResponse)
	same(t, "422", jsonOf(t, refused.Body, true), example(t, "uploadBrandingAsset", "validation_failed", true))
	f.err = branding.ErrNoStorage
	_, err = srv.UploadBrandingAsset(owner(t, lotos), brandingapi.UploadBrandingAssetRequestObject{TenantId: lotos, Body: &brandingapi.BrandingAssetUpload{}})
	eq(t, "503", problem.Is(err, problem.CodeDependencyUnavailable), true)
}

// Тема оболочки: оформление без автора и момента сохранения (BrandingTheme), одна на всех участников.
func TestTheme(t *testing.T) {
	t.Parallel()
	themes := Themes{Service: &fake{branding: lotosV3()}}
	theme, err := themes.Theme(t.Context(), lotos)
	if err != nil {
		t.Fatal(err)
	}
	var want map[string]any
	if err := json.Unmarshal([]byte(example(t, "getTenantBranding", "ok", false)), &want); err != nil {
		t.Fatal(err)
	}
	delete(want, "updatedAt")
	delete(want, "updatedBy")
	same(t, "theme", jsonOf(t, theme, false), jsonOf(t, want, false))
}

// fakeMarks are the signs of the service.
type fakeMarks map[uuid.UUID]branding.Mark

func (f fakeMarks) Marks(context.Context, []uuid.UUID) (map[uuid.UUID]branding.Mark, error) {
	return f, nil
}

// Знак для списков оператора: короткое имя и адрес знака — когда есть.
func TestMarks(t *testing.T) {
	t.Parallel()
	marks, err := Marks{Service: fakeMarks{
		alta:  {AccentUsed: "#1F6B52"},
		lotos: {ShortName: "Лотос", AccentUsed: "#7A3E79", MarkURL: "/brand-assets/x.png"},
	}}.Marks(t.Context(), []uuid.UUID{alta, lotos})
	if err != nil {
		t.Fatal(err)
	}
	same(t, "marks", jsonOf(t, marks, false), canonical(t, []byte(`{"`+alta.String()+`": {"accentUsed": "#1F6B52"},
		"`+lotos.String()+`": {"accentUsed": "#7A3E79", "shortName": "Лотос", "markUrl": "/brand-assets/x.png"}}`), false))
}

// fakePublic serves one file.
type fakePublic struct{ err error }

func (f fakePublic) Public(_ context.Context, file string) (string, io.ReadCloser, error) {
	if f.err != nil {
		return "", nil, f.err
	}
	if file != "abc.svg" {
		return "", nil, branding.ErrNotFound
	}
	return branding.TypeSVG, io.NopCloser(strings.NewReader("<svg/>")), nil
}

// Публичный файл: тип из записи, nosniff, CSP sandbox, неизменяемый кеш; неизвестный — 404; без хранилища — 503.
func TestPublicFiles(t *testing.T) {
	t.Parallel()
	h := Public{Service: fakePublic{}}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/brand-assets/abc.svg", nil))
	eq(t, "file", [5]string{rec.Header().Get("Content-Type"), rec.Header().Get("X-Content-Type-Options"), rec.Header().Get("Content-Security-Policy"),
		rec.Header().Get("Cache-Control"), rec.Body.String()},
		[5]string{"image/svg+xml", "nosniff", "sandbox", "public, max-age=31536000, immutable", "<svg/>"})
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/brand-assets/nope.svg", nil))
	eq(t, "unknown", rec.Code, http.StatusNotFound)
	rec = httptest.NewRecorder()
	Public{Service: fakePublic{err: branding.ErrNoStorage}}.ServeHTTP(rec, httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/brand-assets/abc.svg", nil))
	eq(t, "no storage", rec.Code, http.StatusServiceUnavailable)
}
