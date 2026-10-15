//go:build integration

package assignments_test

import (
	"context"
	"slices"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments"            //nolint:depguard // the package under test (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func (w *world) owners(t *testing.T, tc tenantctx.TenantContext) []uuid.UUID {
	t.Helper()
	resp, err := w.h.ListOwners(w.Ctx(tc), accessapi.ListOwnersRequestObject{TenantId: w.TenantID})
	list := accesstest.As[accessapi.ListOwners200JSONResponse](t, resp, err).Body
	out := make([]uuid.UUID, 0, len(list.Items))
	for _, o := range list.Items {
		out = append(out, o.MemberId)
	}
	return out
}

// Владельцы — OwnerBinding control DB (не роль): участник, имя и почта аккаунта, с какого момента.
func TestListOwners(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	resp, err := w.h.ListOwners(w.Ctx(w.regionAdmin), accessapi.ListOwnersRequestObject{TenantId: w.TenantID})
	list := accesstest.As[accessapi.ListOwners200JSONResponse](t, resp, err).Body
	if len(list.Items) != 1 {
		t.Fatalf("owners %+v", list.Items)
	}
	o := list.Items[0]
	if o.MemberId != w.owner.PersonID || o.DisplayName != "Дарья Зимина" || string(o.Email) != "d.zimina@alta.example" || o.Since.IsZero() {
		t.Errorf("owner %+v", o)
	}
}

func (w *world) transfer(t *testing.T, tc tenantctx.TenantContext, body accessapi.OwnershipTransferCreate) ([]uuid.UUID, error) {
	t.Helper()
	resp, err := w.h.TransferOwnership(w.Ctx(tc), accessapi.TransferOwnershipRequestObject{TenantId: w.TenantID, Body: &body})
	if err != nil {
		return nil, err
	}
	list := accesstest.As[accessapi.TransferOwnership200JSONResponse](t, resp, nil).Body
	out := []uuid.UUID{}
	for _, o := range list.Items {
		out = append(out, o.MemberId)
	}
	return out, nil
}

func transferTo(person uuid.UUID, email string, keep bool) accessapi.OwnershipTransferCreate {
	return accessapi.OwnershipTransferCreate{ToMemberId: person, Confirmation: email, KeepCurrentOwner: keep, Reason: "Передаю управление бизнесом"}
}

// Передача владения (S1-16, AUTH-08): совладелец или передача с уходом; аудит с причиной, событие для «Входящих»,
// policy_version + 1.
func TestTransferOwnership(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	before := w.PolicyVersion()
	got, err := w.transfer(t, w.owner, transferTo(w.m1, " M1@Alta.Example ", true))
	if err != nil || !slices.Equal(got, []uuid.UUID{w.owner.PersonID, w.m1}) {
		t.Fatalf("co-owner: %v %v", got, err)
	}
	if w.PolicyVersion() != before+1 {
		t.Errorf("policy version %d → %d", before, w.PolicyVersion())
	}
	if n := w.Count(`select 1 from audit.events where action = 'access.owner.transfer' and reason = 'Передаю управление бизнесом'`); n != 1 {
		t.Errorf("tenant audit: %d", n)
	}
	if n := w.ControlCount(`select 1 from platform_audit where action = 'access.owner.transfer' and actor_kind = 'owner' and target_id = $1`, w.TenantID); n != 1 {
		t.Errorf("platform audit: %d", n)
	}
	if n := w.Count(`select 1 from outbox.events where type = 'access.owner.changed.v1' and payload->>'change' = 'transfer'`); n != 1 {
		t.Errorf("owner events: %d", n)
	}
	// Передача с уходом: действующий владелец перестаёт им быть в той же транзакции.
	got, err = w.transfer(t, w.owner, transferTo(w.m2, "m2@alta.example", false))
	if err != nil || !slices.Equal(sorted(got...), sorted(w.m1, w.m2)) { // both granted at the same clock of the world
		t.Fatalf("transfer and leave: %v %v", got, err)
	}
	if n := w.ControlCount(`select 1 from owner_bindings where membership_id = $1 and revoked_at is not null and revoke_reason = 'Передаю управление бизнесом'`,
		w.owner.MembershipID); n != 1 {
		t.Errorf("former owner binding: %d", n)
	}
}

// Отказы передачи: свежий вход 401, подтверждение и причина 422, получатель — активный участник с действующим
// аккаунтом и ещё не владелец (409), чужой — 404.
func TestTransferOwnershipRefusals(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	invited := w.MemberWith("Приглашённая", "invited@alta.example", w.f1, "invited", "active")
	locked := w.MemberWith("Заблокированный", "locked@alta.example", w.f1, "active", "locked")
	card := w.Card("Без аккаунта", w.f1)
	short := transferTo(w.m1, "m1@alta.example", true)
	short.Reason = "надо"
	for name, tc := range map[string]struct {
		body accessapi.OwnershipTransferCreate
		want string
	}{
		"подтверждение не совпадает": {transferTo(w.m1, "m2@alta.example", true), "validation_failed|Подтверждение не совпадает с почтой получателя."},
		"короткая причина":           {short, "validation_failed"},
		"уже владелец":               {transferTo(w.owner.PersonID, "d.zimina@alta.example", true), "invalid_transition"},
		"приглашённая":               {transferTo(invited, "invited@alta.example", true), "invalid_transition"},
		"заблокированный аккаунт":    {transferTo(locked, "locked@alta.example", true), "invalid_transition"},
		"карточка без аккаунта":      {transferTo(card, "x@alta.example", true), "not_found"},
		"не участник":                {transferTo(uuid.New(), "x@alta.example", true), "not_found"},
	} {
		_, err := w.transfer(t, w.owner, tc.body)
		if got := accesstest.Problem(err); got != tc.want && accesstest.Code(err) != tc.want {
			t.Errorf("%s: %s, want %s", name, got, tc.want)
		}
	}
	stale := w.Deps()
	stale.AuthTime = func(context.Context) (time.Time, bool) { return w.Now.Add(-11 * time.Minute), true }
	_, err := assignments.New(stale).TransferOwnership(w.Ctx(w.owner), accessapi.TransferOwnershipRequestObject{TenantId: w.TenantID,
		Body: new(transferTo(w.m1, "m1@alta.example", true))})
	if accesstest.Code(err) != "session_expired" {
		t.Errorf("stale sign-in: %v", err)
	}
	if got := w.owners(t, w.owner); !slices.Equal(got, []uuid.UUID{w.owner.PersonID}) {
		t.Errorf("owners changed by refusals: %v", got)
	}
}

func (w *world) revokeOwner(tc tenantctx.TenantContext, person uuid.UUID) error {
	_, err := w.h.RevokeOwnership(w.Ctx(tc), accessapi.RevokeOwnershipRequestObject{TenantId: w.TenantID, MemberId: person})
	return err
}

// Снятие владельца: не владелец — 404, последний — 409 last_owner_required (и сам себя тоже); совладелец снимается.
func TestRevokeOwnership(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	if got := accesstest.Code(w.revokeOwner(w.owner, w.m1)); got != "not_found" {
		t.Errorf("not an owner: %s", got)
	}
	if got := accesstest.Code(w.revokeOwner(w.owner, w.owner.PersonID)); got != "last_owner_required" {
		t.Errorf("last owner: %s", got)
	}
	w.Owner(w.m1)
	if err := w.revokeOwner(w.owner, w.m1); err != nil {
		t.Fatal(err)
	}
	if got := w.owners(t, w.owner); !slices.Equal(got, []uuid.UUID{w.owner.PersonID}) {
		t.Errorf("owners: %v", got)
	}
	if n := w.Count(`select 1 from outbox.events where type = 'access.owner.changed.v1' and payload->>'change' = 'revoke'`); n != 1 {
		t.Errorf("owner events: %d", n)
	}
}

// AUTH-08 под конкуренцией: два владельца одновременно снимают друг друга — строка tenants блокирует, один успех;
// второй к своей очереди уже не владелец — 403 forbidden_action (актор проверяется под блокировкой); владелец остаётся.
func TestRevokeOwnershipConcurrent(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	w.Owner(w.m1)
	second := w.TC(w.m1)
	errs := make([]error, 2)
	var wg sync.WaitGroup
	for i, pair := range [][2]tenantctx.TenantContext{{w.owner, second}, {second, w.owner}} {
		wg.Go(func() { errs[i] = w.revokeOwner(pair[0], pair[1].PersonID) })
	}
	wg.Wait()
	codes := []string{accesstest.Code(errs[0]), accesstest.Code(errs[1])}
	slices.Sort(codes)
	if !slices.Equal(codes, []string{"", "forbidden_action"}) {
		t.Errorf("codes %v", codes)
	}
	if n := len(w.owners(t, w.owner)); n != 1 {
		t.Errorf("%d owners remain", n)
	}
}
