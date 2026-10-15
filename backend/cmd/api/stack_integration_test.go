//go:build integration

package main

// Сквозной тест шага 0.7 (S0-04, критерий выхода этапа 0 плана 27): HTTP-клиент с cookie → BFF (dev-вход) →
// шлюз API → control DB → tenant DB с проверкой права. База — testcontainers (migratetest W0.06), миграции
// control 0001–0003, Go-сид W0.06 (`go run ./cmd/seed`: «Альта Групп» и SPA «Лотос» с tenant DB).

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"os"
	"os/exec"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

var (
	stack      *migratetest.Cluster
	controlDB  string
	seedAlta   = uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:platform:t-alta"))
	seedLotos  = uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:platform:t-lotos"))
	seedKotova = uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:platform:acc-2"))
)

func TestMain(m *testing.M) {
	ctx := context.Background()
	c, stop, err := migratetest.Start(ctx, migratetest.Images()[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	stack = c
	code := 1
	if err := prepare(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "stack: ", err)
	} else {
		code = m.Run()
	}
	stop()
	os.Exit(code)
}

// prepare migrates a control DB and runs the Go seed of W0.06 (it creates the tenant DBs t_alta and t_lotos).
func prepare(ctx context.Context) error {
	super, err := sql.Open("pgx", stack.URL("postgres", migratetest.Super))
	if err != nil {
		return err
	}
	defer super.Close()
	controlDB = "ortus_control_w009"
	if err := migrations.CreateDatabase(ctx, super, controlDB); err != nil {
		return err
	}
	mig, err := sql.Open("pgx", stack.URL(controlDB, migrations.RoleMigrator))
	if err != nil {
		return err
	}
	defer mig.Close()
	if _, err := migrations.Up(ctx, mig, migrations.Control); err != nil {
		return fmt.Errorf("migrate control: %w", err)
	}
	cmd := exec.CommandContext(ctx, "go", "run", "./cmd/seed") //nolint:gosec // G702: fixed command; env holds test DSNs
	cmd.Dir = "../.."
	cmd.Env = append(os.Environ(),
		"MIGRATOR_DB_URL="+stack.URL(controlDB, migrations.RoleMigrator),
		"PG_SUPER_URL="+stack.URL(controlDB, migratetest.Super))
	if out, err := cmd.CombinedOutput(); err != nil {
		return fmt.Errorf("seed: %w\n%s", err, out)
	}
	return nil
}

// server starts cmd/api over the stack exactly as main does (build), behind a real HTTP listener.
func server(t *testing.T) *httptest.Server {
	t.Helper()
	cfg := config{
		AppEnv: envE2E, AuthProvider: envDev, ControlDBURL: stack.URL(controlDB, migrations.RoleAPI),
		SessionCookie: "ortus_sid", SessionTTL: time.Hour, AllowedOrigins: []string{"http://127.0.0.1:5213"},
	}
	getenv := func(k string) string {
		if k == "TENANT_DB_URL" {
			return stack.URL("postgres", migrations.RoleAPI)
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
	return srv
}

type browser struct {
	t    *testing.T
	base string
	http *http.Client
	csrf string
}

func newBrowser(t *testing.T, srv *httptest.Server) *browser {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return &browser{t: t, base: srv.URL, http: &http.Client{Jar: jar}}
}

func (b *browser) call(method, path, body string) (int, map[string]any) {
	b.t.Helper()
	req, err := http.NewRequestWithContext(b.t.Context(), method, b.base+path, strings.NewReader(body))
	if err != nil {
		b.t.Fatal(err)
	}
	req.Header.Set("Origin", "http://127.0.0.1:5213")
	req.Header.Set("Content-Type", "application/json")
	if b.csrf != "" {
		req.Header.Set("X-CSRF-Token", b.csrf)
	}
	resp, err := b.http.Do(req)
	if err != nil {
		b.t.Fatal(err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out
}

func (b *browser) login(persona string) *browser {
	b.t.Helper()
	status, body := b.call(http.MethodPost, "/api/v1/dev/login", `{"persona":"`+persona+`"}`)
	if status != http.StatusOK {
		b.t.Fatalf("login %s: %d %v", persona, status, body)
	}
	b.csrf, _ = body["csrfToken"].(string)
	return b
}

func tenantNames(me map[string]any) []string {
	var names []string
	ts, _ := me["tenants"].([]any)
	for _, x := range ts {
		m, _ := x.(map[string]any)
		name, _ := m["name"].(string)
		names = append(names, name)
	}
	return names
}

func super(t *testing.T, db string) *sql.DB {
	t.Helper()
	return stack.DB(t, db, migratetest.Super)
}

// Позитивный кейс: владелец «Альты» после dev-входа получает /me/context — имя из control DB, домашнее
// подразделение и возможности из tenant DB t_alta (пул открыт по secret_ref и sentinel).
func TestStackMeContext(t *testing.T) { //nolint:paralleltest // one seeded stack; TestStackSentinelMismatch changes it
	srv := server(t)
	status, me := newBrowser(t, srv).login("owner").call(http.MethodGet, "/api/v1/me/context", "")
	if status != http.StatusOK || me["displayName"] != "Дарья Зимина" || me["platformOperator"] != false {
		t.Fatalf("%d %v", status, me)
	}
	if names := tenantNames(me); !slices.Equal(names, []string{"Альта Групп"}) {
		t.Fatalf("tenants = %v", names)
	}
	tenant, _ := me["tenants"].([]any)[0].(map[string]any)
	var home string
	if err := super(t, "t_alta").QueryRowContext(t.Context(),
		`select home_unit_id::text from people.person_profiles where email = 'd.zimina@alta.example'`).Scan(&home); err != nil {
		t.Fatal(err)
	}
	units, _ := tenant["orgUnitIds"].([]any)
	caps, _ := tenant["capabilities"].([]any)
	if len(units) != 1 || units[0] != home || len(caps) == 0 {
		t.Fatalf("tenant = %v (home unit %s)", tenant, home)
	}

	_, morozova := newBrowser(t, srv).login("therapist").call(http.MethodGet, "/api/v1/me/context", "")
	if names := tenantNames(morozova); !slices.Equal(names, []string{"SPA «Лотос»", "Альта Групп"}) {
		t.Fatalf("therapist tenants = %v", names)
	}
}

// 401: без сессии; 403: менеджер без ролей; владелец проходит проверку права (501 — тег не реализован);
// чужая организация — 404. После выдачи роли в tenant DB менеджер проходит ту же проверку.
func TestStackPermissionCheck(t *testing.T) { //nolint:paralleltest // one seeded stack; grants a role in t_alta
	srv := server(t)
	members := "/api/v1/tenants/" + seedAlta.String() + "/members"
	if status, body := newBrowser(t, srv).call(http.MethodGet, "/api/v1/me/context", ""); status != http.StatusUnauthorized ||
		body["code"] != problem.CodeSessionExpired {
		t.Fatalf("anonymous: %d %v", status, body)
	}
	owner, manager := newBrowser(t, srv).login("owner"), newBrowser(t, srv).login("manager")
	for name, tc := range map[string]struct {
		b      *browser
		path   string
		status int
		code   string
	}{
		"владелец: право есть":    {owner, members, http.StatusNotImplemented, problem.CodeNotImplemented},
		"менеджер: нет роли":      {manager, members, http.StatusForbidden, problem.CodeForbiddenAction},
		"владелец: чужая «Лотос»": {owner, "/api/v1/tenants/" + seedLotos.String() + "/members", http.StatusNotFound, problem.CodeNotFound},
	} {
		if status, body := tc.b.call(http.MethodGet, tc.path, ""); status != tc.status || body["code"] != tc.code {
			t.Errorf("%s: %d %v", name, status, body)
		}
	}

	grantTenantRole(t, "members.read")
	if status, body := manager.call(http.MethodGet, members, ""); status != http.StatusNotImplemented {
		t.Fatalf("manager with role: %d %v", status, body)
	}
}

// grantTenantRole gives the manager of «Альта» (acc-2) a role with actions at the tenant scope in t_alta.
func grantTenantRole(t *testing.T, actions ...string) {
	t.Helper()
	var personID string
	if err := super(t, controlDB).QueryRowContext(t.Context(),
		`select person_profile_id::text from memberships where account_id = $1 and tenant_id = $2`, seedKotova, seedAlta).
		Scan(&personID); err != nil {
		t.Fatal(err)
	}
	role, granter, assignment := uuid.New(), uuid.New(), uuid.New()
	db := super(t, "t_alta")
	for _, q := range []struct {
		sql  string
		args []any
	}{
		{`insert into access.roles (id, name, kind) values ($1, 'W0.09 читатель', 'custom')`, []any{role}},
		{`insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`, []any{role, actions, granter}},
		{`insert into access.role_assignments (id, principal_kind, principal_id, role_id, role_version, scope_kind, granted_by)
		  values ($4, 'person', $1, $2, 1, 'tenant', $3)`, []any{personID, role, granter, assignment}},
	} {
		if _, err := db.ExecContext(t.Context(), q.sql, q.args...); err != nil {
			t.Fatalf("%s: %v", q.sql, err)
		}
	}
	// The seeded stack is shared by the tests of the package (W1.04: the parity of /me/context reads the grants).
	t.Cleanup(func() {
		ctx := context.WithoutCancel(t.Context())
		for _, q := range []struct {
			sql string
			id  uuid.UUID
		}{
			{`delete from access.role_assignments where id = $1`, assignment},
			{`delete from access.role_versions where role_id = $1`, role},
			{`delete from access.roles where id = $1`, role},
		} {
			if _, err := db.ExecContext(ctx, q.sql, q.id); err != nil {
				t.Errorf("%s: %v", q.sql, err)
			}
		}
	})
}

// K-32 (WS-40; 09 I-22): sentinel tenant_routing не совпал с core.tenant_identity — пул не открывается:
// tenant-операция → 503 dependency_unavailable, /me/context показывает организацию без возможностей.
func TestStackSentinelMismatch(t *testing.T) { //nolint:paralleltest // changes tenant_routing of t-lotos
	ctl := super(t, controlDB)
	var sentinel string
	if err := ctl.QueryRowContext(t.Context(), `select sentinel::text from tenant_routing where tenant_id = $1`, seedLotos).
		Scan(&sentinel); err != nil {
		t.Fatal(err)
	}
	if _, err := ctl.ExecContext(t.Context(), `update tenant_routing set sentinel = $2 where tenant_id = $1`, seedLotos, uuid.New()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = ctl.ExecContext(context.Background(), `update tenant_routing set sentinel = $2 where tenant_id = $1`, seedLotos, sentinel)
	})
	// A member, not an owner: the permission check reads the grants of the tenant DB (an owner is checked in the
	// control DB only, so its request would reach the handler, which opens the pool itself).
	b := newBrowser(t, server(t)).login("therapist@t-lotos")
	if status, body := b.call(http.MethodGet, "/api/v1/tenants/"+seedLotos.String()+"/members", ""); status != http.StatusServiceUnavailable ||
		body["code"] != problem.CodeDependencyUnavailable {
		t.Fatalf("members: %d %v", status, body)
	}
	_, me := b.call(http.MethodGet, "/api/v1/me/context", "")
	ts, _ := me["tenants"].([]any)
	if len(ts) != 2 {
		t.Fatalf("me = %v", me)
	}
	for _, x := range ts {
		tenant, _ := x.(map[string]any)
		units, _ := tenant["orgUnitIds"].([]any)
		lotos := tenant["tenantId"] == seedLotos.String()
		if lotos == (len(units) != 0) {
			t.Errorf("tenant %v: units %v (Лотос — fail-closed, Альта — из своей tenant DB)", tenant["name"], units)
		}
	}
}
