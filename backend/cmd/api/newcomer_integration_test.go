//go:build integration

package main

// T-6 of the brief W1.50 (П-13 of the stage 1 critique): a person who has never signed in is invited by the owner of
// «Альта Групп», gets the letter, signs in through the dev provider for the first time (the login creates the
// account, issuer urn:ortus:dev, as the first OIDC sign-in does), accepts the invitation and sees «Альта Групп» in
// /me/context. A repeated login is the same account.

import (
	"net/http"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail/mailtest"
)

// devLogin posts a dev login body and returns the account of the session.
func (b *browser) devLogin(body string) string {
	b.t.Helper()
	status, out := b.call(http.MethodPost, "/api/v1/dev/login", body)
	if status != http.StatusOK {
		b.t.Fatalf("dev login %s: %d %v", body, status, out)
	}
	b.csrf, _ = out["csrfToken"].(string)
	userID, _ := out["userId"].(string)
	return userID
}

// seatAndHome gives «Альта» a seat for one more person (the seed fills its trial) and returns the home unit of the
// owner.
func seatAndHome(t *testing.T) string {
	t.Helper()
	if _, err := super(t, controlDB).ExecContext(t.Context(), `update entitlements set limit_value = limit_value + 1
		where tenant_id = $1 and feature_key = 'seats' and limit_value is not null`, seedAlta); err != nil {
		t.Fatal(err)
	}
	var home string
	if err := super(t, "t_alta").QueryRowContext(t.Context(),
		`select home_unit_id::text from people.person_profiles where email = 'd.zimina@alta.example'`).Scan(&home); err != nil {
		t.Fatal(err)
	}
	return home
}

func TestStackNewcomerAcceptsInvitation(t *testing.T) { //nolint:paralleltest // one seeded stack; adds a member to «Альта»
	srv := mailtest.Start(t, mailtest.Options{})
	api := mailServer(t, srv, &lockedBuffer{})
	short := uuid.New().String()[:8]
	email := "w150." + short + "@alta.example"
	subject := "new-" + email
	login := `{"persona":"` + subject + `","email":"` + email + `","displayName":"Иван Новиков"}`
	home := seatAndHome(t)

	before := newBrowser(t, api)
	if status, body := before.call(http.MethodPost, "/api/v1/dev/login", `{"persona":"`+subject+`"}`); status != http.StatusUnauthorized {
		t.Fatalf("login of an unknown subject without an e-mail: %d %v", status, body)
	}

	owner := newBrowser(t, api).login("owner")
	status, body, _ := owner.callH(http.MethodPost, "/api/v1/tenants/"+seedAlta.String()+"/invitations",
		`{"email":"`+email+`","displayName":"Иван Новиков","orgUnitIds":["`+home+`"],"roleAssignments":[]}`,
		map[string]string{"Idempotency-Key": "w150-" + short + "-invite"})
	if status != http.StatusCreated || body["status"] != "pending" {
		t.Fatalf("inviteMember: %d %v", status, body)
	}
	token := mailtest.Parse(t, srv.Wait(t, 1)[0].Data).Token()
	if token == "" {
		t.Fatal("no token in the letter")
	}

	newcomer := newBrowser(t, api)
	userID := newcomer.devLogin(login)
	var issuer, emailNorm, name string
	if err := super(t, controlDB).QueryRowContext(t.Context(), `select issuer, email_norm, display_name from accounts where id = $1`,
		userID).Scan(&issuer, &emailNorm, &name); err != nil || issuer != "urn:ortus:dev" || emailNorm != email || name != "Иван Новиков" {
		t.Fatalf("account of the newcomer %s: %s %s %s %v", userID, issuer, emailNorm, name, err)
	}
	acceptByLink(t, newcomer, token, "w150-"+short) // the Idempotency-Key admits no '@' of the subject

	if again := newBrowser(t, api).devLogin(login); again != userID {
		t.Fatalf("repeated login: account %s, want %s", again, userID)
	}
}
