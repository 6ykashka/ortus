//go:build integration

package main

// T-7 of the brief W1.41 (S1-06 through the stack): the owner of «Альта Групп» invites a person through
// inviteMember → the letter reaches SMTP (mailtest, as Mailpit on the stand) → the invitee signs in, inspects and
// accepts the invitation with the token of the link → /me/context lists «Альта Групп». The token is in no log of
// the API and in no row of the databases.

import (
	"bytes"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"slices"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail/mailtest"
	"github.com/ortus/ortus-crm/backend/migrations"
)

// lockedBuffer collects the log of a server: handlers of concurrent requests write it.
type lockedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (l *lockedBuffer) Write(p []byte) (int, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.Write(p)
}

func (l *lockedBuffer) String() string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.b.String()
}

// mailServer is server(t) with the SMTP of srv and the log in logs.
func mailServer(t *testing.T, srv *mailtest.Server, logs *lockedBuffer) *httptest.Server {
	t.Helper()
	cfg := config{
		AppEnv: envE2E, AuthProvider: envDev, ControlDBURL: stack.URL(controlDB, migrations.RoleAPI),
		SessionCookie: "ortus_sid", SessionTTL: time.Hour, AllowedOrigins: []string{"http://127.0.0.1:5213"},
	}
	env := map[string]string{
		"TENANT_DB_URL": stack.URL("postgres", migrations.RoleAPI),
		"SMTP_HOST":     srv.Host, "SMTP_PORT": strconv.Itoa(srv.Port),
		"MAIL_FROM": "no-reply@ortus.local", "PUBLIC_ORIGIN": "http://127.0.0.1:5213",
	}
	log := slog.New(slog.NewJSONHandler(logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	d, closeDeps, err := build(t.Context(), cfg, log, func(k string) string { return env[k] })
	if err != nil {
		t.Fatal(err)
	}
	hs := httptest.NewServer(newHandler(d))
	t.Cleanup(func() {
		hs.Close()
		closeDeps()
	})
	return hs
}

func TestStackInvitationLetter(t *testing.T) { //nolint:paralleltest // one seeded stack; adds a member to «Альта»
	srv := mailtest.Start(t, mailtest.Options{})
	logs := &lockedBuffer{}
	api := mailServer(t, srv, logs)
	subject, email, home := newInvitee(t)
	owner := newBrowser(t, api).login("owner")
	invite := func() (int, map[string]any, http.Header) {
		return owner.callH(http.MethodPost, "/api/v1/tenants/"+seedAlta.String()+"/invitations",
			`{"email":"`+email+`","displayName":"Новый Сотрудник","orgUnitIds":["`+home+`"],"roleAssignments":[]}`,
			map[string]string{"Idempotency-Key": subject + "-invite"})
	}

	refusedRecipient(t, srv, logs, email, invite)
	status, body, header := invite()
	if status != http.StatusCreated || body["status"] != "pending" || header.Get("Idempotency-Replayed") == "true" {
		t.Fatalf("inviteMember: %d %v %v", status, body, header)
	}
	l := mailtest.Parse(t, srv.Wait(t, 1)[0].Data)
	token := l.Token()
	if l.To != email || l.FromName != "Альта Групп · через Ортус" || token == "" ||
		!strings.Contains(l.Text, "Дарья Зимина приглашает вас в «Альта Групп».") ||
		!strings.Contains(l.Text, "http://127.0.0.1:5213/auth/invitation#token="+token) {
		t.Fatalf("letter %+v", l)
	}
	acceptByLink(t, newBrowser(t, api).login(subject), token, subject)
	if out := logs.String(); strings.Contains(out, token) || !strings.Contains(out, "/invitations") {
		t.Errorf("the API log carries the token or misses the requests:\n%s", out)
	}
	noTokenInStack(t, token)
}

// refusedRecipient: the server refuses the recipient and echoes its address — invite answers 503, the API log has
// the reply with the address masked; then the server accepts the recipient again. The retry with the same
// Idempotency-Key runs the command again: the 503 is not stored.
func refusedRecipient(t *testing.T, srv *mailtest.Server, logs *lockedBuffer, email string, invite func() (int, map[string]any, http.Header)) {
	t.Helper()
	srv.Refuse("RCPT", "550 5.1.1 <"+email+">: Recipient address rejected")
	defer srv.Refuse("RCPT", "")
	if status, body, _ := invite(); status != http.StatusServiceUnavailable || body["code"] != "dependency_unavailable" {
		t.Fatalf("inviteMember, recipient refused: %d %v", status, body)
	}
	if out := logs.String(); strings.Contains(out, "<"+email+">") || !strings.Contains(out, "Recipient address rejected") {
		t.Errorf("the API log carries the address of the SMTP reply or misses the reply:\n%s", out)
	}
}

// newInvitee gives «Альта» a seat for one more person (the seed fills its trial) and creates the dev identity of the
// invitee (AUTH_PROVIDER=dev); it returns its dev subject, its e-mail and the home unit of the owner.
func newInvitee(t *testing.T) (subject, email, home string) {
	t.Helper()
	id := uuid.New()
	subject, email = "w141-"+id.String()[:8], "w141."+id.String()[:8]+"@alta.example"
	ctl := super(t, controlDB)
	if _, err := ctl.ExecContext(t.Context(), `update entitlements set limit_value = limit_value + 1
		where tenant_id = $1 and feature_key = 'seats' and limit_value is not null`, seedAlta); err != nil {
		t.Fatal(err)
	}
	if _, err := ctl.ExecContext(t.Context(), `insert into accounts (id, issuer, subject, email_norm, display_name, status)
		values ($1, 'urn:ortus:dev', $2, $3, 'Новый Сотрудник', 'active')`, id, subject, email); err != nil {
		t.Fatal(err)
	}
	if err := super(t, "t_alta").QueryRowContext(t.Context(),
		`select home_unit_id::text from people.person_profiles where email = 'd.zimina@alta.example'`).Scan(&home); err != nil {
		t.Fatal(err)
	}
	return subject, email, home
}

// acceptByLink: the signed-in invitee inspects and accepts the invitation with the token of the link; /me/context
// then lists «Альта Групп».
func acceptByLink(t *testing.T, b *browser, token, key string) {
	t.Helper()
	if status, body := b.call(http.MethodPost, "/api/v1/auth/invitations/inspect", `{"token":"`+token+`"}`); status != http.StatusOK ||
		body["status"] != "pending" || body["tenantName"] != "Альта Групп" {
		t.Fatalf("inspect: %d %v", status, body)
	}
	status, body, _ := b.callH(http.MethodPost, "/api/v1/auth/invitations/accept", `{"token":"`+token+`"}`,
		map[string]string{"Idempotency-Key": key + "-accept"})
	if status != http.StatusOK || body["membershipStatus"] != "active" || body["tenantId"] != seedAlta.String() {
		t.Fatalf("accept: %d %v", status, body)
	}
	status, me := b.call(http.MethodGet, "/api/v1/me/context", "")
	if status != http.StatusOK || !slices.Contains(tenantNames(me), "Альта Групп") {
		t.Fatalf("/me/context of the invitee: %d %v", status, me)
	}
}

// noTokenInStack: no row of the tenant DB of «Альта» and of the control DB carries the token.
func noTokenInStack(t *testing.T, token string) {
	t.Helper()
	for db, tables := range map[string][]string{
		"t_alta":  {"audit.events", "outbox.events", "core.idempotency_keys"},
		controlDB: {"invitations", "platform_audit", "memberships"},
	} {
		for _, table := range tables {
			var n int
			if err := super(t, db).QueryRowContext(t.Context(), `select count(*) from `+table+` r where r::text like '%' || $1 || '%'`,
				token).Scan(&n); err != nil || n != 0 {
				t.Errorf("%s.%s: %d rows with the token, %v", db, table, n, err)
			}
		}
	}
}
