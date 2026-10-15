//go:build integration

package assignments_test

// W1.43 (Q-W1.41-10, П-14): с выключенной почтой (mail.Off — нет SMTP_HOST) исход inviteMember хранится в транзакции
// эффекта. Процесс упал между COMMIT и записью исхода guard'ом — повтор с тем же Idempotency-Key отвечает replay 201,
// а не 422 «адрес уже приглашён».

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments" //nolint:depguard // the package under test (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/idem"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/mail"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// crashed is a store of a process that dies right after the command: the outcome is never stored by the guard and
// the key is never released (the record stays in progress until its lease ends).
type crashed struct{ idem.Store }

func (crashed) Complete(context.Context, idem.Record, idem.Outcome, time.Time) error {
	return errors.New("the process died before the guard stored the outcome")
}

func (crashed) Release(context.Context, idem.Record) error { return nil }

type crashedStores struct{ idem.Stores }

func (s crashedStores) For(ctx context.Context, tenant uuid.UUID) (idem.Store, error) {
	st, err := s.Stores.For(ctx, tenant)
	return crashed{st}, err
}

// inviteEndpoint serves inviteMember of h like the strict server: the body of the request, 201 or the problem.
func inviteEndpoint(w *world, h *assignments.Handler) http.Handler {
	return http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		var body accessapi.InvitationCreate
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			problem.Write(rw, r, problem.Wrap(problem.CodeMalformedRequest, err))
			return
		}
		resp, err := h.InviteMember(r.Context(), accessapi.InviteMemberRequestObject{TenantId: w.TenantID, Body: &body})
		if err != nil {
			problem.Write(rw, r, err)
			return
		}
		_ = resp.VisitInviteMemberResponse(rw)
	})
}

func TestInviteMemberMailOffReplays(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	h := w.h.WithInvitationMail(mail.Invitations{Origin: stand, Sender: mail.Off{}})
	raw, err := json.Marshal(invitation("Иван Тестов", "i.testov@alta.example", w.f1,
		accessapi.InvitationRole{RoleId: w.trips, Scope: unitScope(w.f1, true)}))
	if err != nil {
		t.Fatal(err)
	}
	ns := idem.Namespace{TenantID: w.TenantID, ActorID: w.owner.AccountID, Operation: "inviteMember"}
	const key = "w143-invite-mail-off-0001"
	call := func(g *idem.Guard) *httptest.ResponseRecorder {
		req := httptest.NewRequestWithContext(w.Ctx(w.owner), http.MethodPost, "/api/v1/tenants/"+w.TenantID.String()+"/invitations",
			bytes.NewReader(raw))
		req.Header.Set(idem.HeaderKey, key)
		rec := httptest.NewRecorder()
		g.Serve(rec, req, ns, inviteEndpoint(w, h))
		return rec
	}
	stores := idem.TenantStores{Pools: w.Pools()}

	first := call(&idem.Guard{Stores: crashedStores{stores}})
	if first.Code != http.StatusCreated {
		t.Fatalf("first: %d %s", first.Code, first.Body)
	}
	// The process is back after the lease of the record: the client repeats the command with the same key.
	later := func() time.Time { return time.Now().Add(idem.DefaultLease + time.Minute) }
	repeat := call(&idem.Guard{Stores: stores, Now: later})
	if repeat.Code != http.StatusCreated || repeat.Header().Get(idem.HeaderReplayed) != "true" {
		t.Fatalf("repeat: %d %s %s, want a replay of 201", repeat.Code, repeat.Header().Get(idem.HeaderReplayed), repeat.Body)
	}
	var a, b accessapi.Invitation
	if err := json.Unmarshal(first.Body.Bytes(), &a); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(repeat.Body.Bytes(), &b); err != nil {
		t.Fatal(err)
	}
	if a.Id != b.Id {
		t.Errorf("the replay answers invitation %s, the first call %s", b.Id, a.Id)
	}
	if n := w.ControlCount(`select 1 from invitations where tenant_id = $1 and email_norm = 'i.testov@alta.example'`, w.TenantID); n != 1 {
		t.Errorf("invitations: %d, want 1", n)
	}
}
