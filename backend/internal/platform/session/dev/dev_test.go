package dev

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/session/oidc"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const origin = "http://127.0.0.1:5213"

// accounts of the seed W0.06 by issuer + subject.
type fakeAccounts map[string]tenantctx.Account

func (f fakeAccounts) AccountBySubject(_ context.Context, issuer, subject string) (tenantctx.Account, error) {
	if a, ok := f[issuer+" "+subject]; ok {
		return a, nil
	}
	return tenantctx.Account{}, tenantctx.ErrNotFound
}

var (
	zimina   = tenantctx.Account{ID: uuid.MustParse("0281a55e-725e-53b1-920f-4189ab46e08a"), DisplayName: "Дарья Зимина", Status: "active"}
	gromov   = tenantctx.Account{ID: uuid.New(), DisplayName: "Кирилл Громов", Status: "active"}
	lapteva  = tenantctx.Account{ID: uuid.New(), DisplayName: "Евгения Лаптева", Status: "active"}
	isoOwner = tenantctx.Account{ID: uuid.New(), DisplayName: "Владелец A", Status: "active"}
	shishkin = tenantctx.Account{ID: uuid.New(), DisplayName: "Денис Шишкин", Status: "locked"}
)

func setup() (http.Handler, *session.Manager) {
	m := &session.Manager{
		CookieName: "ortus_sid", CSRFCookieName: "ortus_csrf", TTL: 12 * time.Hour,
		AllowedOrigins: []string{origin}, Store: session.NewMemStore(),
	}
	r := chi.NewRouter()
	Routes(r, m, fakeAccounts{
		IssuerUsers + " acc-1":       zimina,
		IssuerUsers + " acc-7":       gromov,
		IssuerUsers + " acc-13":      shishkin,
		IssuerUsers + " iso-a.owner": isoOwner,
		IssuerOperators + " op-1":    lapteva,
	})
	return requestid.Middleware(r), m
}

func post(t *testing.T, h http.Handler, path, body string, hdr map[string]string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequestWithContext(t.Context(), http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func login(t *testing.T, h http.Handler, persona string) *httptest.ResponseRecorder {
	t.Helper()
	return post(t, h, LoginPath, `{"persona":"`+persona+`"}`, map[string]string{"Origin": origin})
}

func code(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var b problem.Body
	_ = json.Unmarshal(rec.Body.Bytes(), &b)
	return b.Code
}

// Персонажи e2e (PD-54, e2e-kit persona.ts) входят dev-провайдером под учёткой сида W0.06
// (issuer urn:ortus:dev, subject = id прототипа); оператор — urn:ortus:dev-operators.
func TestLoginPersonas(t *testing.T) {
	t.Parallel()
	h, m := setup()
	for persona, want := range map[string]uuid.UUID{
		"owner": zimina.ID, "acc-7": gromov.ID, "operator": lapteva.ID,
		"iso-a.owner": isoOwner.ID, // любой subject dev-идентичности (фикстуры набора изоляции W0.15)
	} {
		rec := login(t, h, persona)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: status %d body %s", persona, rec.Code, rec.Body.String())
		}
		var body struct{ UserID, CSRFToken string }
		if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		cookies := map[string]string{}
		for _, c := range rec.Result().Cookies() {
			cookies[c.Name] = c.Value
		}
		s, err := m.Store.Get(t.Context(), cookies["ortus_sid"])
		if err != nil || s.AccountID != want || body.UserID != want.String() || body.CSRFToken != cookies["ortus_csrf"] {
			t.Fatalf("%s: session %+v (%v), body %+v, cookies %v", persona, s, err, body, cookies)
		}
	}
}

// K-21 (WS-40; 12 R5 «одинаковый отказ на любую причину»): неизвестный персонаж и заблокированная учётка
// (acc-13, accounts.status = locked) — одинаковые 401 session_expired, cookie не ставятся.
func TestLoginRefusals(t *testing.T) {
	t.Parallel()
	h, _ := setup()
	hdr := map[string]string{"Origin": origin, requestid.Header: "rid-same"}
	unknown := post(t, h, LoginPath, `{"persona":"nobody"}`, hdr)
	locked := post(t, h, LoginPath, `{"persona":"acc-13"}`, hdr)
	if unknown.Code != http.StatusUnauthorized || unknown.Body.String() != locked.Body.String() || code(t, unknown) != problem.CodeSessionExpired {
		t.Fatalf("unknown %d %s / locked %d %s", unknown.Code, unknown.Body, locked.Code, locked.Body)
	}
	if len(unknown.Result().Cookies())+len(locked.Result().Cookies()) != 0 {
		t.Fatal("a refused login sets cookies")
	}
}

// K-34 (WS-40) и проверка Origin входа: лишнее поле, битый JSON, чужой Origin; без Origin (k6, curl) — вход.
func TestLoginRequestChecks(t *testing.T) {
	t.Parallel()
	h, _ := setup()
	cases := []struct {
		name, body, origin, code string
		status                   int
	}{
		{"лишнее поле", `{"persona":"owner","x":1}`, origin, problem.CodeUnknownField, http.StatusBadRequest},
		{"битый JSON", `{`, origin, problem.CodeMalformedRequest, http.StatusBadRequest},
		{"чужой Origin", `{"persona":"owner"}`, "https://evil.example", problem.CodeOriginNotAllowed, http.StatusForbidden},
		{"без Origin", `{"persona":"owner"}`, "", "", http.StatusOK},
	}
	for _, tc := range cases {
		hdr := map[string]string{}
		if tc.origin != "" {
			hdr["Origin"] = tc.origin
		}
		rec := post(t, h, LoginPath, tc.body, hdr)
		if rec.Code != tc.status || code(t, rec) != tc.code {
			t.Errorf("%s: %d %s", tc.name, rec.Code, rec.Body.String())
		}
	}
}

// world is the control DB of the newcomer tests: the directory of the provider and the account store of OIDC over
// the same accounts, so an account created by a first login is found by the next one.
type world struct {
	mu       sync.Mutex
	accounts map[string]tenantctx.Account // issuer + " " + subject
	seen     []oidc.Identity              // identities passed to Upsert
	status   string                       // status of a created account; "" — active
}

func newWorld() *world {
	return &world{accounts: map[string]tenantctx.Account{IssuerUsers + " acc-1": zimina, IssuerOperators + " op-1": lapteva}}
}

func (w *world) AccountBySubject(_ context.Context, issuer, subject string) (tenantctx.Account, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if a, ok := w.accounts[issuer+" "+subject]; ok {
		return a, nil
	}
	return tenantctx.Account{}, tenantctx.ErrNotFound
}

func (w *world) Upsert(_ context.Context, id oidc.Identity) (oidc.AccountRef, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.seen = append(w.seen, id)
	key := id.Issuer + " " + id.Subject
	a, ok := w.accounts[key]
	if !ok {
		a = tenantctx.Account{ID: uuid.New(), DisplayName: id.Name, Status: "active"}
		if w.status != "" {
			a.Status = w.status
		}
		w.accounts[key] = a
	}
	return oidc.AccountRef{ID: a.ID, Status: a.Status}, nil
}

func (w *world) upserts() []oidc.Identity {
	w.mu.Lock()
	defer w.mu.Unlock()
	return slices.Clone(w.seen)
}

// newcomers is setup with the dev provider of appEnv over w; creator false — no account store passed.
func newcomers(appEnv string, w *world, creator bool) (http.Handler, *session.Manager) {
	m := &session.Manager{
		CookieName: "ortus_sid", CSRFCookieName: "ortus_csrf", TTL: 12 * time.Hour,
		AllowedOrigins: []string{origin}, Store: session.NewMemStore(),
	}
	var c Creator
	if creator {
		c = w
	}
	r := chi.NewRouter()
	Routes(r, m, w, Newcomers(appEnv, c))
	return requestid.Middleware(r), m
}

type loginBody struct {
	UserID    string `json:"userId"`
	CSRFToken string `json:"csrfToken"`
}

// enter posts a login body and returns the answer and the account of the session it started (uuid.Nil — none).
func enter(t *testing.T, h http.Handler, m *session.Manager, body string) (*httptest.ResponseRecorder, loginBody, uuid.UUID) {
	t.Helper()
	rec := post(t, h, LoginPath, body, map[string]string{"Origin": origin, requestid.Header: "rid-w150"})
	var out loginBody
	_ = json.Unmarshal(rec.Body.Bytes(), &out)
	for _, c := range rec.Result().Cookies() {
		if c.Name == "ortus_sid" && c.Value != "" {
			if s, err := m.Store.Get(t.Context(), c.Value); err == nil {
				return rec, out, s.AccountID
			}
		}
	}
	return rec, out, uuid.Nil
}

const novikov = `{"persona":"new-i.novikov@alta.example","email":" I.Novikov@Alta.Example ","displayName":" Иван Новиков "}`

// W1.50 T-1: в dev и e2e первый вход нового subject с адресом и именем создаёт аккаунт так же, как первый вход
// OIDC (issuer urn:ortus:dev, адрес нормализован, имя без пробелов по краям; без имени — адрес) и начинает сессию.
func TestNewcomerFirstLogin(t *testing.T) {
	t.Parallel()
	for _, env := range []string{"dev", "e2e"} {
		w := newWorld()
		h, m := newcomers(env, w, true)
		rec, body, acc := enter(t, h, m, novikov)
		if rec.Code != http.StatusOK || acc == uuid.Nil || body.UserID != acc.String() || body.CSRFToken == "" {
			t.Fatalf("%s: %d %s, session account %s", env, rec.Code, rec.Body, acc)
		}
		want := oidc.Identity{Issuer: IssuerUsers, Subject: "new-i.novikov@alta.example", Email: "i.novikov@alta.example",
			EmailVerified: true, Name: "Иван Новиков"}
		if seen := w.upserts(); len(seen) != 1 || !sameIdentity(seen[0], want) {
			t.Fatalf("%s: Upsert %+v, want %+v", env, seen, want)
		}

		rec, _, acc = enter(t, h, m, `{"persona":"new-p","email":"p@alta.example"}`)
		if seen := w.upserts(); rec.Code != http.StatusOK || acc == uuid.Nil || len(seen) != 2 || seen[1].Name != "p@alta.example" {
			t.Fatalf("%s without a name: %d %s, Upsert %+v", env, rec.Code, rec.Body, seen)
		}
	}
}

func sameIdentity(a, b oidc.Identity) bool {
	return a.Issuer == b.Issuer && a.Subject == b.Subject && a.Email == b.Email && a.EmailVerified == b.EmailVerified &&
		a.Name == b.Name
}

// W1.50 T-2: повторный вход нового — тот же аккаунт без второго создания, поля повторного входа его не меняют;
// аккаунт сида с адресом в теле входит как раньше, без создания.
func TestNewcomerSecondLogin(t *testing.T) {
	t.Parallel()
	w := newWorld()
	h, m := newcomers("e2e", w, true)
	_, first, _ := enter(t, h, m, novikov)
	for _, body := range []string{
		novikov,
		`{"persona":"new-i.novikov@alta.example","email":"other@alta.example","displayName":"Другое имя"}`,
		`{"persona":"new-i.novikov@alta.example"}`,
	} {
		rec, again, acc := enter(t, h, m, body)
		if rec.Code != http.StatusOK || again.UserID != first.UserID || acc.String() != first.UserID {
			t.Fatalf("%s: %d %s, first %s", body, rec.Code, rec.Body, first.UserID)
		}
	}
	rec, owner, _ := enter(t, h, m, `{"persona":"acc-1","email":"x@alta.example","displayName":"X"}`)
	if rec.Code != http.StatusOK || owner.UserID != zimina.ID.String() {
		t.Fatalf("seed account: %d %s", rec.Code, rec.Body)
	}
	if seen := w.upserts(); len(seen) != 1 {
		t.Fatalf("Upsert %d times, want 1: %+v", len(seen), seen)
	}
}

// W1.50 T-3: вне dev и e2e, без хранилища, без корректного адреса, с недопустимым именем, для псевдонима и оператора
// аккаунт не создаётся — тот же 401 session_expired, что у неизвестного персонажа, без cookie. Созданный, но не
// активный аккаунт (гонка с блокировкой) — тоже 401.
func TestNewcomerRefusals(t *testing.T) {
	t.Parallel()
	const ok = `"email":"n@alta.example","displayName":"Новый"`
	cases := []struct {
		name, env, body string
		creator         bool
		upserts         int
	}{
		{"prod", "prod", `{"persona":"new-n",` + ok + `}`, true, 0},
		{"неизвестное окружение", "stage", `{"persona":"new-n",` + ok + `}`, true, 0},
		{"пустое окружение", "", `{"persona":"new-n",` + ok + `}`, true, 0},
		{"нет хранилища", "e2e", `{"persona":"new-n",` + ok + `}`, false, 0},
		{"нет адреса", "e2e", `{"persona":"new-n","displayName":"Новый"}`, true, 0},
		{"адрес без домена", "e2e", `{"persona":"new-n","email":"n@","displayName":"Новый"}`, true, 0},
		{"адрес без имени ящика", "e2e", `{"persona":"new-n","email":"@alta.example","displayName":"Новый"}`, true, 0},
		{"не адрес", "e2e", `{"persona":"new-n","email":"not-an-email","displayName":"Новый"}`, true, 0},
		{"пробел в адресе", "e2e", `{"persona":"new-n","email":"n n@alta.example","displayName":"Новый"}`, true, 0},
		{"адрес с именем", "e2e", `{"persona":"new-n","email":"Новый <n@alta.example>","displayName":"Новый"}`, true, 0},
		{"перевод строки в адресе", "e2e", `{"persona":"new-n","email":"n@alta\n.example","displayName":"Новый"}`, true, 0},
		{"длинный адрес", "e2e", `{"persona":"new-n","email":"` + strings.Repeat("n", 250) + `@a.example","displayName":"Новый"}`, true, 0},
		{"длинное имя", "e2e", `{"persona":"new-n","email":"n@alta.example","displayName":"` + strings.Repeat("Я", 201) + `"}`, true, 0},
		{"управляющий символ в имени", "e2e", `{"persona":"new-n","email":"n@alta.example","displayName":"Но\u0007вый"}`, true, 0},
		{"псевдоним без аккаунта", "e2e", `{"persona":"manager",` + ok + `}`, true, 0},
		{"оператор", "e2e", `{"persona":"op-9",` + ok + `}`, true, 0},
		{"псевдоним оператора", "dev", `{"persona":"operator",` + ok + `}`, true, 0},
		{"недопустимый subject", "e2e", `{"persona":"New Person",` + ok + `}`, true, 0},
	}
	for _, tc := range cases {
		w := newWorld()
		if tc.name == "псевдоним оператора" {
			delete(w.accounts, IssuerOperators+" op-1")
		}
		h, m := newcomers(tc.env, w, tc.creator)
		unknown, _, _ := enter(t, h, m, `{"persona":"nobody"}`)
		rec, _, acc := enter(t, h, m, tc.body)
		if rec.Code != http.StatusUnauthorized || code(t, rec) != problem.CodeSessionExpired || rec.Body.String() != unknown.Body.String() ||
			len(rec.Result().Cookies()) != 0 || acc != uuid.Nil {
			t.Errorf("%s: %d %s (unknown persona: %s)", tc.name, rec.Code, rec.Body, unknown.Body)
		}
		if n := len(w.upserts()); n != tc.upserts {
			t.Errorf("%s: Upsert %d times, want %d", tc.name, n, tc.upserts)
		}
	}

	w := newWorld()
	w.status = "locked"
	h, m := newcomers("e2e", w, true)
	if rec, _, acc := enter(t, h, m, novikov); rec.Code != http.StatusUnauthorized || code(t, rec) != problem.CodeSessionExpired || acc != uuid.Nil {
		t.Errorf("created locked: %d %s", rec.Code, rec.Body)
	}
}

// W1.50 T-4: тело входа разбирается строго и с новыми полями — лишнее поле 400 unknown_field.
func TestNewcomerStrictBody(t *testing.T) {
	t.Parallel()
	w := newWorld()
	h, m := newcomers("e2e", w, true)
	rec, _, _ := enter(t, h, m, `{"persona":"new-n","email":"n@alta.example","displayName":"Н","role":"owner"}`)
	if rec.Code != http.StatusBadRequest || code(t, rec) != problem.CodeUnknownField || len(w.upserts()) != 0 {
		t.Fatalf("%d %s", rec.Code, rec.Body)
	}
}

// K-22 (WS-40): выход с CSRF — 204 и сессия удалена; без токена — 403 csrf_failed; без сессии — 401.
func TestLogout(t *testing.T) {
	t.Parallel()
	h, m := setup()
	var sid, csrf *http.Cookie
	for _, c := range login(t, h, "owner").Result().Cookies() {
		switch c.Name {
		case "ortus_sid":
			sid = c
		case "ortus_csrf":
			csrf = c
		}
	}
	if rec := post(t, h, LogoutPath, "", map[string]string{"Origin": origin}, sid, csrf); rec.Code != http.StatusForbidden || code(t, rec) != problem.CodeCSRFFailed {
		t.Fatalf("without token: %d %s", rec.Code, rec.Body)
	}
	if rec := post(t, h, LogoutPath, "", map[string]string{"Origin": origin}); rec.Code != http.StatusUnauthorized {
		t.Fatalf("without session: %d %s", rec.Code, rec.Body)
	}
	rec := post(t, h, LogoutPath, "", map[string]string{"Origin": origin, session.CSRFHeader: csrf.Value}, sid, csrf)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("logout: %d %s", rec.Code, rec.Body)
	}
	if _, err := m.Store.Get(t.Context(), sid.Value); err == nil {
		t.Fatal("session survives logout")
	}
}
