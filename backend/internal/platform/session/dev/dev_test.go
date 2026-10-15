package dev

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
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
