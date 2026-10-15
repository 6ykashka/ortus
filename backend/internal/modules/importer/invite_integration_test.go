//go:build integration

package importer

// W1.43 (Q-W1.05-10): commitPeopleImport с sendInvitations=true над приглашениями модуля доступа (assignments.Handler,
// как его подключает cmd/api): создаваемые строки с почтой получают приглашение W1.03 и письмо после COMMIT; строки без
// почты — карточки без приглашения; totals.invited — число ушедших писем.

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments"               //nolint:depguard // integration test: the Inviter of cmd/api (access module)
	accesskit "github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit" //nolint:depguard // integration test: the dependencies of the access module
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail/mailtest"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: the clock of the fixtures
)

// cardInviter is the adapter of cmd/api (access.go importInviter): importer.Invitee ↔ assignments.Invitee.
type cardInviter struct{ h *assignments.Handler }

func (a cardInviter) InviteCards(ctx context.Context, tc tenantctx.TenantContext, fn func(tx pgx.Tx) ([]Invitee, error), complete func(tx pgx.Tx) error) (int, error) {
	return a.h.InviteCards(ctx, tc, func(tx pgx.Tx) ([]assignments.Invitee, error) {
		in, err := fn(tx)
		out := make([]assignments.Invitee, 0, len(in))
		for _, v := range in {
			out = append(out, assignments.Invitee{Person: v.Person, Email: v.Email, Unit: v.Unit, Line: v.Line})
		}
		return out, err
	}, complete)
}

// withInviter is e with the invitations of the access module over the fixtures; the letters go to srv.
func (e env) withInviter(t *testing.T, srv *mailtest.Server) env {
	t.Helper()
	now := harness.Now
	src := authz.PGSource{Pools: e.pools}
	d := accesskit.Deps{Pools: e.pools, Evaluator: authz.New(src, src, now), Control: e.control, Now: now}
	h := assignments.New(d).WithInvitationMail(mail.Invitations{Origin: "http://localhost:5208", Sender: &mail.SMTP{Config: mail.Config{
		Host: srv.Host, Port: srv.Port, From: "no-reply@ortus.local", AllowPlain: true, Timeout: 10 * time.Second,
	}}})
	srvCopy := *e.srv
	srvCopy.Inviter = cardInviter{h: h}
	e.srv = &srvCopy
	return e
}

// requested is ctx with the request id of the gateway (the audit of the access module requires it).
func requested(ctx context.Context) context.Context {
	var req *http.Request
	requestid.Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { req = r })).
		ServeHTTP(httptest.NewRecorder(), httptest.NewRequestWithContext(ctx, http.MethodGet, "/", nil))
	return req.Context()
}

func TestSendInvitations(t *testing.T) {
	t.Parallel()
	srv := mailtest.Start(t, mailtest.Options{})
	e := newEnv(t, 0).withInviter(t, srv)
	s := suffix()
	email := "invited." + s + "@alta.example"
	csv := strings.Join([]string{
		"full_name,email",
		"Приглашённый " + s + "," + email,                                       // 2 create with an e-mail: invited
		"Без почты " + s + ",",                                                  // 3 create without an e-mail: a card only
		"Водитель Москва-1 (импорт " + s + "),iso-a.driver-msk1@isolation.test", // 4 update: never invited
	}, "\n")
	got, err := preview(e.as(t, "a.owner"), t, e, id(t, "unit:a.msk1"), csv)
	require.NoError(t, err)

	hr, _ := e.hr(t, "unit:a.msk1")
	_, err = commit(hr, t, e, got.Body.Id, *got.Headers.ETag, true, true)
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "sendInvitations needs members.invite: %v", err)

	done, err := commit(requested(e.as(t, "a.owner")), t, e, got.Body.Id, *got.Headers.ETag, true, true)
	require.NoError(t, err)
	c := done.Body
	assert.Equal(t, accessapi.PeopleImportTotals{Rows: 3, Create: 2, Update: 1, Invited: 1}, c.Totals)
	created := row(t, c, 2).MemberId
	require.NotNil(t, created)

	letters := srv.Wait(t, 1)
	require.Len(t, letters, 1)
	assert.Equal(t, []string{email}, letters[0].To)
	letter := mailtest.Parse(t, letters[0].Data)
	assert.NotEmpty(t, letter.Token(), "the link carries the token")
	var person uuid.UUID
	require.NoError(t, e.control.QueryRow(t.Context(), `select person_profile_id from invitations
		where tenant_id = $1 and email_norm = $2 and revoked_at is null and accepted_at is null`, tenantA(t), email).Scan(&person))
	assert.Equal(t, *created, person, "the invitation of the card the row created")

	fetched, err := get(e.as(t, "a.owner"), t, e, c.Id)
	require.NoError(t, err)
	assert.Equal(t, int64(1), fetched.Body.Totals.Invited, "the stored totals")
}

// Письмо не ушло: приглашение отозвано, карточка осталась, totals.invited — без него и в ответе, и в сохранённом
// импорте; ревизия импорта та же, что в ответе.
func TestSendInvitationsLetterFails(t *testing.T) {
	t.Parallel()
	srv := mailtest.Start(t, mailtest.Options{})
	srv.Refuse("RCPT", "451 4.3.0 try again later")
	e := newEnv(t, 0).withInviter(t, srv)
	s := suffix()
	email := "refused." + s + "@alta.example"
	got, err := preview(e.as(t, "a.owner"), t, e, id(t, "unit:a.msk1"), "full_name,email\nОтказ "+s+","+email+"\n")
	require.NoError(t, err)
	done, err := commit(requested(e.as(t, "a.owner")), t, e, got.Body.Id, *got.Headers.ETag, true, true)
	require.NoError(t, err)
	assert.Equal(t, int64(0), done.Body.Totals.Invited)
	assert.Equal(t, int64(1), done.Body.Totals.Create)
	require.NotNil(t, row(t, done.Body, 2).MemberId, "the card stays")
	fetched, err := get(e.as(t, "a.owner"), t, e, got.Body.Id)
	require.NoError(t, err)
	assert.Equal(t, done.Body.Totals, fetched.Body.Totals, "the stored totals")
	assert.Equal(t, done.Body.Revision, fetched.Body.Revision)
	var live int
	require.NoError(t, e.control.QueryRow(t.Context(), `select count(*) from invitations where tenant_id = $1 and email_norm = $2
		and revoked_at is null`, tenantA(t), email).Scan(&live))
	assert.Zero(t, live, "the invitation without a letter is withdrawn")
}
