//go:build integration

package branding

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/png"
	"io"
	"os"
	"reflect"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

var cluster *migratetest.Cluster

func TestMain(m *testing.M) {
	c, stop, err := migratetest.Start(context.Background(), migratetest.Images()[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	cluster = c
	code := m.Run()
	stop()
	os.Exit(code)
}

var now = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)

// memBlobs is the object storage of the tests.
type memBlobs struct {
	mu    sync.Mutex
	files map[string][]byte
	types map[string]string
}

func (m *memBlobs) Put(_ context.Context, key, contentType string, data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.files[key], m.types[key] = bytes.Clone(data), contentType
	return nil
}

func (m *memBlobs) Open(_ context.Context, key string) (io.ReadCloser, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	data, ok := m.files[key]
	if !ok {
		return nil, ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(data)), nil
}

// world: «Альта» with the standard branding, «Лотос» with its version 3 of the seed (by Белова), «Чужая» with a sign
// file of its own.
type world struct {
	t                    *testing.T
	admin                *sql.DB
	svc                  *Service
	blobs                *memBlobs
	alta, lotos, foreign uuid.UUID
	zimina, belova       Owner
	foreignMark          uuid.UUID
}

func newWorld(t *testing.T) *world {
	t.Helper()
	name := cluster.NewDatabase(t, "branding")
	admin := cluster.DB(t, name, migrations.RoleMigrator)
	if _, err := migrations.Up(t.Context(), admin, migrations.Control); err != nil {
		t.Fatal(err)
	}
	w := &world{t: t, admin: admin, blobs: &memBlobs{files: map[string][]byte{}, types: map[string]string{}}}
	w.svc = &Service{Control: cluster.DB(t, name, migrations.RoleAPI), Blobs: w.blobs, Now: func() time.Time { return now }}
	w.alta, w.lotos, w.foreign = w.tenant("Альта Групп"), w.tenant("SPA «Лотос»"), w.tenant("Чужая")
	w.zimina, w.belova = w.owner(w.alta, "Дарья Зимина"), w.owner(w.lotos, "Ирина Белова")
	w.exec(`insert into tenant_branding_versions (tenant_id, version, display_name, short_name, accent_hex, accent_used, terms, menu,
		powered_by, created_by, created_by_account, created_at)
		values ($1, 3, 'SPA «Лотос»', 'Лотос', '#7A3E79', '#7A3E79', '{"visit": {"one": "сеанс", "plural": "сеансы", "few": "сеанса", "many": "сеансов"}}',
		'{"items": {}, "order": []}', true, $2, $3, '2026-09-24T09:10:00Z')`, w.lotos, w.belova.MembershipID, w.belova.AccountID)
	foreign := w.owner(w.foreign, "Чужой владелец")
	w.foreignMark = uuid.New()
	w.exec(`insert into branding_assets (id, tenant_id, kind, content_type, size_bytes, sha256, storage_key, uploaded_by)
		values ($1, $2, 'mark', 'image/svg+xml', 10, $3, 'branding/x.svg', $4)`, w.foreignMark, w.foreign, bytes.Repeat([]byte{1}, 32), foreign.AccountID)
	return w
}

func (w *world) exec(q string, args ...any) {
	w.t.Helper()
	if _, err := w.admin.ExecContext(w.t.Context(), q, args...); err != nil {
		w.t.Fatalf("%s: %v", q, err)
	}
}

func (w *world) one(q string, args ...any) string {
	w.t.Helper()
	var v sql.NullString
	if err := w.admin.QueryRowContext(w.t.Context(), q, args...).Scan(&v); err != nil {
		w.t.Fatalf("%s: %v", q, err)
	}
	return v.String
}

func (w *world) tenant(name string) uuid.UUID {
	w.t.Helper()
	id := uuid.New()
	w.exec(`insert into tenants (id, slug, display_name, industry_pack, state) values ($1, $2, $3, 'custom', 'active')`, id, "t-"+id.String()[:8], name)
	return id
}

func (w *world) owner(tenant uuid.UUID, name string) Owner {
	w.t.Helper()
	account, membership := uuid.New(), uuid.New()
	w.exec(`insert into accounts (id, issuer, subject, email_norm, display_name) values ($1, 'urn:test', $2, $2, $3)`, account, account.String(), name)
	w.exec(`insert into memberships (id, tenant_id, account_id, status, person_profile_id) values ($1, $2, $3, 'active', $4)`, membership, tenant, account, uuid.New())
	w.exec(`insert into owner_bindings (tenant_id, membership_id) values ($1, $2)`, tenant, membership)
	return Owner{TenantID: tenant, MembershipID: membership, AccountID: account}
}

func eq[T any](t *testing.T, what string, got, want T) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n got %+v\nwant %+v", what, got, want)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

func refused(t *testing.T, err error, field, code string) {
	t.Helper()
	r, ok := errors.AsType[*RefusalError](err)
	if !ok || len(r.Violations) != 1 || r.Violations[0].Field != field || r.Violations[0].Code != code {
		t.Fatalf("err = %v, want %s %s", err, field, code)
	}
}

// violationOf is the field and the code of the only violation of a refusal ("" when err is not one).
func violationOf(err error) [2]string {
	r, ok := errors.AsType[*RefusalError](err)
	if !ok || len(r.Violations) != 1 {
		return [2]string{}
	}
	return [2]string{r.Violations[0].Field, r.Violations[0].Code}
}

func update(owner Owner, ifMatch string) Update {
	return Update{
		Owner: owner, IfMatch: ifMatch, DisplayName: "  Альта Логистик ", ShortName: new(" Альта "), AccentHex: "#f5c518",
		Terms: map[string]Term{"trip": {One: "рейс", Plural: "рейсы", Few: "рейса", Many: "рейсов"}},
		Menu: Menu{Items: map[string]MenuItem{
			"fleet": {Label: " Перевозки ", Icon: "local_shipping"}, "billing": {Hidden: true}, "tasks": {Hidden: true},
		}, Order: []string{"fleet", "tasks"}},
		PoweredBy: false, RequestID: "r-save",
	}
}

// Стандартное оформление — версия 1 без строки (Q-W4.07-5); версия сида — со своим автором.
func TestCurrent(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	b, err := w.svc.Current(t.Context(), w.alta)
	must(t, err)
	eq(t, "standard", b, Branding{
		Version: 1, DisplayName: "Альта Групп", AccentHex: DefaultAccent, AccentUsed: DefaultAccent, Terms: map[string]Term{},
		Menu: Menu{Items: map[string]MenuItem{}, Order: []string{}}, PoweredBy: true,
	})
	b, err = w.svc.Current(t.Context(), w.lotos)
	must(t, err)
	eq(t, "lotos", [6]any{b.Version, *b.ShortName, b.AccentUsed, b.Terms["visit"].Many, b.UpdatedBy.DisplayName, *b.UpdatedAt},
		[6]any{3, "Лотос", "#7A3E79", "сеансов", "Ирина Белова", time.Date(2026, 9, 24, 9, 10, 0, 0, time.UTC)})
	_, err = w.svc.Current(t.Context(), uuid.New())
	eq(t, "unknown", errors.Is(err, ErrNotFound), true)
}

// Сохранение: новая неизменяемая версия с контрастом и производными; скрытие разделов управления не действует; имя
// организации меняется в той же транзакции; журнал владельца; If-Match.
func TestUpdate(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	_, err := w.svc.Update(ctx, update(w.zimina, ""))
	eq(t, "no If-Match", errors.Is(err, ErrRevisionRequired), true)
	_, err = w.svc.Update(ctx, update(w.zimina, `"rev-2"`))
	eq(t, "stale", errors.Is(err, ErrRevisionMismatch), true)
	b, err := w.svc.Update(ctx, update(w.zimina, `"rev-1"`))
	must(t, err)
	eq(t, "saved", [6]any{b.Version, b.DisplayName, *b.ShortName, b.AccentHex, b.AccentUsed, b.PoweredBy},
		[6]any{2, "Альта Логистик", "Альта", "#f5c518", "#8A6F0C", false})
	eq(t, "menu", b.Menu, Menu{Items: map[string]MenuItem{"fleet": {Label: "Перевозки", Icon: "local_shipping"}, "tasks": {Hidden: true}},
		Order: []string{"fleet", "tasks"}})
	eq(t, "author", [2]any{b.UpdatedBy.DisplayName, *b.UpdatedAt}, [2]any{"Дарья Зимина", now})
	eq(t, "tenant name", w.one(`select display_name from tenants where id = $1`, w.alta), "Альта Логистик")
	eq(t, "audit", w.one(`select concat_ws('|', actor_kind, actor_id, action, target_type, target_id, details->>'version') from platform_audit
		where request_id = 'r-save'`), fmt.Sprintf("owner|%s|branding.updated|tenant|%s|2", w.zimina.AccountID, w.alta))
	again, err := w.svc.Current(ctx, w.alta)
	must(t, err)
	eq(t, "read back", again, b)
	_, err = w.svc.Update(ctx, update(w.zimina, `"rev-1"`))
	eq(t, "the old version", errors.Is(err, ErrRevisionMismatch), true)
}

// Проверки сохранения (422 с полем): имя, термин без формы, термин вне каталога, иконка, файл чужой организации и
// файл другого вида.
func TestUpdateRefusals(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	for name, c := range map[string]struct {
		edit        func(*Update)
		field, code string
	}{
		"пустое имя":          {func(u *Update) { u.DisplayName = "  " }, "displayName", "required"},
		"имя длиннее 60":      {func(u *Update) { u.DisplayName = string(make([]rune, 61)) }, "displayName", "length"},
		"короткое длиннее 16": {func(u *Update) { u.ShortName = new("Очень длинное имя!") }, "shortName", "length"},
		"цвет":                {func(u *Update) { u.AccentHex = "red" }, "accentHex", "pattern"},
		"термин без формы": {func(u *Update) {
			u.Terms = map[string]Term{"visit": {One: "сеанс", Plural: "сеансы", Many: "сеансов"}}
		}, "terms.visit.few", "required"},
		"термин вне каталога":    {func(u *Update) { u.Terms = map[string]Term{"order": {One: "a", Plural: "b", Few: "c", Many: "d"}} }, "terms.order", "unknown"},
		"иконка":                 {func(u *Update) { u.Menu.Items["fleet"] = MenuItem{Icon: "<svg>"} }, "menu.items.fleet.icon", "pattern"},
		"порядок повторяется":    {func(u *Update) { u.Menu.Order = []string{"fleet", "fleet"} }, "menu.order", "unique"},
		"знак чужой организации": {func(u *Update) { u.MarkAssetID = new(w.foreignMark) }, "markAssetId", "unknown"},
	} {
		u := update(w.zimina, `"rev-1"`)
		c.edit(&u)
		_, err := w.svc.Update(ctx, u)
		eq(t, name, violationOf(err), [2]string{c.field, c.code})
	}
	eq(t, "nothing saved", w.one(`select count(*)::text from tenant_branding_versions where tenant_id = $1`, w.alta), "0")
}

func pngOfSize(t *testing.T, w, h int) []byte {
	t.Helper()
	var b bytes.Buffer
	if err := png.Encode(&b, image.NewRGBA(image.Rect(0, 0, w, h))); err != nil {
		t.Fatal(err)
	}
	return b.Bytes()
}

func upload(owner Owner, kind, contentType string, data []byte) Upload {
	return Upload{Owner: owner, Kind: kind, FileName: "file", ContentType: contentType, Data: data}
}

// Файлы: тип по байтам, SVG по allowlist, знак — квадрат ≥ 512, 1 МиБ; адрес по содержимому; оформление ссылается
// на свои файлы; знак — в списках оператора; публичная отдача.
func TestAssets(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	svg := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#7A3E79"/></svg>`)
	logo, err := w.svc.UploadAsset(ctx, upload(w.zimina, KindLogo, TypeSVG, svg))
	must(t, err)
	sum := sha256.Sum256(svg)
	eq(t, "logo", [5]any{logo.Kind, logo.ContentType, logo.URL, logo.SizeBytes, logo.Width == nil},
		[5]any{KindLogo, TypeSVG, "/brand-assets/" + hex.EncodeToString(sum[:]) + ".svg", len(svg), true})
	eq(t, "stored", w.blobs.types["branding/"+hex.EncodeToString(sum[:])+".svg"], TypeSVG)
	mark, err := w.svc.UploadAsset(ctx, upload(w.zimina, KindMark, TypePNG, pngOfSize(t, 512, 512)))
	must(t, err)
	eq(t, "mark size", [2]int{*mark.Width, *mark.Height}, [2]int{512, 512})
	for name, c := range map[string]struct {
		u           Upload
		field, code string
	}{
		"небезопасный SVG": {upload(w.zimina, KindLogo, TypeSVG, []byte(`<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>`)), "contentBase64", "unsafe_svg"},
		"не тот тип":       {upload(w.zimina, KindLogo, TypePNG, svg), "contentType", "content_type"},
		"не картинка":      {upload(w.zimina, KindLogo, TypePNG, []byte("hello")), "contentType", "content_type"},
		"знак не квадрат":  {upload(w.zimina, KindMark, TypePNG, pngOfSize(t, 640, 512)), "contentBase64", "mark_size"},
		"знак меньше 512":  {upload(w.zimina, KindMark, TypePNG, pngOfSize(t, 100, 100)), "contentBase64", "mark_size"},
	} {
		_, err := w.svc.UploadAsset(ctx, c.u)
		eq(t, name, violationOf(err), [2]string{c.field, c.code})
	}
	_, err = w.svc.UploadAsset(ctx, upload(w.zimina, KindLogo, TypePNG, pngOfSize(t, 640, 200))) // a logo of any shape
	must(t, err)
	_, err = w.svc.UploadAsset(ctx, upload(w.zimina, KindLogo, TypePNG, make([]byte, 1<<20+1)))
	eq(t, "too large", errors.Is(err, ErrTooLarge), true)

	u := update(w.zimina, `"rev-1"`)
	u.LogoAssetID, u.MarkAssetID = &logo.ID, &mark.ID
	b, err := w.svc.Update(ctx, u)
	must(t, err)
	eq(t, "files of the version", [2]string{b.Logo.URL, b.Mark.URL}, [2]string{logo.URL, mark.URL})
	u = update(w.zimina, `"rev-2"`)
	u.LogoAssetID = &mark.ID
	_, err = w.svc.Update(ctx, u)
	refused(t, err, "logoAssetId", "unknown")

	marks, err := w.svc.Marks(ctx, []uuid.UUID{w.alta, w.lotos, uuid.New()})
	must(t, err)
	eq(t, "marks", marks, map[uuid.UUID]Mark{
		w.alta:  {ShortName: "Альта", AccentUsed: "#8A6F0C", MarkURL: mark.URL},
		w.lotos: {ShortName: "Лотос", AccentUsed: "#7A3E79"},
	})
	ct, body, err := w.svc.Public(ctx, hex.EncodeToString(sum[:])+".svg")
	must(t, err)
	data, _ := io.ReadAll(body)
	_ = body.Close()
	eq(t, "public", [2]any{ct, string(data)}, [2]any{TypeSVG, string(svg)})
	for _, file := range []string{"nope.svg", hex.EncodeToString(sum[:]) + ".png", "../etc/passwd"} {
		_, _, err := w.svc.Public(ctx, file)
		eq(t, file, errors.Is(err, ErrNotFound), true)
	}
	w.svc.Blobs = nil
	_, err = w.svc.UploadAsset(ctx, upload(w.zimina, KindLogo, TypeSVG, svg))
	eq(t, "no storage", errors.Is(err, ErrNoStorage), true)
}
