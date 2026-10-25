//go:build integration

package main

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// W4.83 (Q-W4.90-1) end to end over build: the guest of a public form of «Альта» sends his commands with the Origin of
// his browser. A foreign site gets 403 origin_not_allowed and writes nothing; the SPA of ALLOWED_ORIGINS, a site of
// FORMS_PUBLIC_ORIGINS and a request without Origin (no browser) are served.
func TestStackFormsOrigin(t *testing.T) { //nolint:paralleltest // one seeded stack; creates a form of t_alta
	const partner = "https://partner.example"
	cfg := config{
		AppEnv: envE2E, AuthProvider: envDev, ControlDBURL: stack.URL(controlDB, migrations.RoleAPI),
		SessionCookie: "ortus_sid", SessionTTL: time.Hour, AllowedOrigins: []string{stackOrigin},
	}
	getenv := func(k string) string {
		switch k {
		case "TENANT_DB_URL":
			return stack.URL("postgres", migrations.RoleAPI)
		case "FORMS_PUBLIC_ORIGINS":
			return partner
		}
		return ""
	}
	d, closeDeps, err := build(t.Context(), cfg, slog.New(slog.DiscardHandler), getenv)
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(newHandler(d))
	t.Cleanup(func() {
		srv.Close()
		closeDeps()
	})

	owner := newBrowser(t, srv).login("owner")
	base := "/api/v1/tenants/" + seedAlta.String()
	id, token := stackPublicForm(t, owner, base)
	responses := func() int {
		status, _, page := owner.do(http.MethodGet, base+"/forms/"+id+"/responses", "", nil)
		items, _ := page["items"].([]any)
		if status != http.StatusOK {
			t.Fatalf("responses: %d %v", status, page)
		}
		return len(items)
	}

	for _, c := range []struct {
		name, origin string
		want         int
		code         string
	}{
		{"a foreign site", "https://evil.example", http.StatusForbidden, "origin_not_allowed"},
		{"opaque null", "null", http.StatusForbidden, "origin_not_allowed"},
		{"the SPA", stackOrigin, http.StatusCreated, ""},
		{"a site of FORMS_PUBLIC_ORIGINS", partner, http.StatusCreated, ""},
		{"no Origin", "", http.StatusCreated, ""},
	} {
		before := responses()
		status, out := guestSubmit(t, srv.URL, token, c.origin)
		if status != c.want || (c.code != "" && out["code"] != c.code) {
			t.Fatalf("%s: %d %v, want %d %s", c.name, status, out, c.want, c.code)
		}
		want := before
		if c.want == http.StatusCreated {
			want++
		}
		if got := responses(); got != want {
			t.Fatalf("%s: responses %d → %d, want %d", c.name, before, got, want)
		}
	}
}

// stackPublicForm is a public form with one text question the owner creates and publishes, with its token.
func stackPublicForm(t *testing.T, owner *browser, base string) (string, string) {
	t.Helper()
	body := `{"name":"Отзыв W483","definition":{"pages":[{"id":"p1","title":"Страница 1"}],
		"fields":[{"key":"q-text","pageId":"p1","type":"text","label":"Ваш отзыв","required":true}]}}`
	status, _, form := owner.do(http.MethodPost, base+"/forms", body, map[string]string{"Idempotency-Key": "w483-stack-create"})
	id, _ := form["id"].(string)
	if status != http.StatusCreated || id == "" {
		t.Fatalf("create: %d %v", status, form)
	}
	status, hdr, form := owner.do(http.MethodPatch, base+"/forms/"+id, `{"settings":{"access":"public"}}`,
		map[string]string{"Idempotency-Key": "w483-stack-public", "If-Match": `"rev-1"`})
	if status != http.StatusOK {
		t.Fatalf("public: %d %v", status, form)
	}
	status, _, form = owner.do(http.MethodPost, base+"/forms/"+id+"/publish", `{"draftRevision":1}`,
		map[string]string{"Idempotency-Key": "w483-stack-publish", "If-Match": hdr.Get("ETag")})
	share, _ := form["share"].(map[string]any)
	token, _ := share["publicToken"].(string)
	if status != http.StatusOK || token == "" {
		t.Fatalf("publish: %d %v", status, form)
	}
	return id, token
}

// guestSubmit opens the public form of token as a new guest and sends a response from origin ("" — no Origin).
func guestSubmit(t *testing.T, base, token, origin string) (int, map[string]any) {
	t.Helper()
	call := func(method, path, body string, hdr map[string]string) (int, map[string]any) {
		req, err := http.NewRequestWithContext(t.Context(), method, base+path, strings.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Content-Type", "application/json")
		for k, v := range hdr {
			req.Header.Set(k, v)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(resp.Body)
		var out map[string]any
		_ = json.Unmarshal(raw, &out)
		return resp.StatusCode, out
	}
	status, pub := call(http.MethodGet, "/api/v1/public/forms/"+token, "", nil)
	nonce, _ := pub["submissionNonce"].(string)
	version, _ := pub["versionId"].(string)
	if status != http.StatusOK || nonce == "" {
		t.Fatalf("public form: %d %v", status, pub)
	}
	hdr := map[string]string{"Idempotency-Key": "w483-" + uuid.NewString()}
	if origin != "" {
		hdr["Origin"] = origin
	}
	return call(http.MethodPost, "/api/v1/public/forms/"+token+"/responses", `{"versionId":"`+version+`","submissionNonce":"`+nonce+
		`","answers":[{"fieldKey":"q-text","value":{"type":"text","value":"W483"}}]}`, hdr)
}
