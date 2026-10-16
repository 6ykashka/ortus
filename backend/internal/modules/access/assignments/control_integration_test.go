//go:build integration

package assignments_test

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
)

// Шлюз проверил x-scope tenant-owner до блокировки: если владение актора сняли раньше, чем его команда взяла
// FOR UPDATE tenants, команда — 403 forbidden_action, владельцы не меняются.
func TestOwnerCommandsOfFormerOwner(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	w.Owner(w.m1)
	former := w.TC(w.m1) // passed the gateway as an owner
	if _, err := w.Control.Exec(t.Context(), `update owner_bindings set revoked_at = now(), revoke_reason = 'revokeOwnership'
		where membership_id = $1`, former.MembershipID); err != nil {
		t.Fatal(err)
	}
	if _, err := w.transfer(t, former, transferTo(w.m2, "m2@alta.example", false)); accesstest.Code(err) != "forbidden_action" {
		t.Errorf("transfer by a former owner: %v", err)
	}
	w.Owner(w.m2)
	if got := accesstest.Code(w.revokeOwner(former, w.m2)); got != "forbidden_action" {
		t.Errorf("revoke by a former owner: %s", got)
	}
	if got := w.owners(t, w.owner); !slices.Equal(sorted(got...), sorted(w.owner.PersonID, w.m2)) {
		t.Errorf("owners: %v", got)
	}
}

// Q-W1.03-12: команда, меняющая control и tenant DB, первой берёт FOR UPDATE tenants и только потом блокировки
// tenant DB: пока она ждёт строку tenants, блокировка политики свободна.
func TestControlCommandsLockTenantFirst(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	for name, run := range map[string]func() error{
		"inviteMember": func() error {
			body := invitation("Иван Тестов", "i.testov@alta.example", w.f1)
			_, err := w.h.InviteMember(w.Ctx(w.owner), accessapi.InviteMemberRequestObject{TenantId: w.TenantID, Body: &body})
			return err
		},
		"transferOwnership": func() error {
			body := transferTo(w.m1, "m1@alta.example", true)
			_, err := w.h.TransferOwnership(w.Ctx(w.owner), accessapi.TransferOwnershipRequestObject{TenantId: w.TenantID, Body: &body})
			return err
		},
	} {
		ctl := w.HoldTenantRow()
		cmd := accesstest.Go(run)
		if _, ok := w.Waiter(w.Control, cmd, accesstest.PID(ctl)); !ok {
			t.Errorf("%s did not wait for the tenant row", name)
		}
		if free := w.PolicyFree(); !free {
			t.Errorf("%s holds the policy lock of the tenant DB while it waits for the tenant row", name)
		}
		if err := ctl.Commit(t.Context()); err != nil {
			t.Fatal(err)
		}
		if err := cmd.Wait(); err != nil {
			t.Errorf("%s: %v", name, err)
		}
	}
}

// Роль «Владелец бизнеса» последнего владельца: проверка — под FOR UPDATE tenants. Параллельное снятие второго
// владельца держит строку tenants — снятие роли ждёт его и получает 409 last_owner_required.
func TestRevokeOwnerRoleWaitsForOwnershipChange(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	own := w.Assign(accesstest.Grant{Principal: w.owner.PersonID, Role: w.ownerRole, Kind: "tenant", Descendants: true})
	w.Owner(w.m1)
	second := w.TC(w.m1)
	ctl := w.HoldTenantRow()
	if _, err := ctl.Exec(t.Context(), `update owner_bindings set revoked_at = now(), revoke_reason = 'revokeOwnership'
		where membership_id = $1`, second.MembershipID); err != nil {
		t.Fatal(err)
	}
	cmd := accesstest.Go(func() error {
		_, err := w.h.RevokeAssignment(w.Ctx(w.owner), accessapi.RevokeAssignmentRequestObject{TenantId: w.TenantID, AssignmentId: own})
		return err
	})
	if _, ok := w.Waiter(w.Control, cmd, accesstest.PID(ctl)); !ok {
		t.Error("revokeAssignment of the owner role did not wait for the tenant row")
	}
	if err := ctl.Commit(t.Context()); err != nil {
		t.Fatal(err)
	}
	if got := accesstest.Code(cmd.Wait()); got != "last_owner_required" {
		t.Errorf("owner role of the last owner: %q", got)
	}
}

// Распределённая фиксация: control DB фиксируется раньше tenant DB; если фиксация tenant DB не прошла, изменение
// control DB компенсируется — владение не меняется, приглашение отозвано.
func TestControlChangeCompensatedWhenTenantCommitFails(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	w.FailTenantCommitOn("access.owner.transfer", "access.owner.revoke", "access.invitation.create")
	if _, err := w.transfer(t, w.owner, transferTo(w.m1, "m1@alta.example", false)); err == nil {
		t.Fatal("transfer committed although the tenant DB refused")
	}
	if got := w.owners(t, w.owner); !slices.Equal(got, []uuid.UUID{w.owner.PersonID}) {
		t.Errorf("owners after a failed transfer: %v", got)
	}
	w.Owner(w.m2)
	if err := w.revokeOwner(w.owner, w.m2); err == nil {
		t.Fatal("revoke committed although the tenant DB refused")
	}
	if got := w.owners(t, w.owner); !slices.Equal(sorted(got...), sorted(w.owner.PersonID, w.m2)) {
		t.Errorf("owners after a failed revoke: %v", got)
	}
	if _, err := w.invite(t, w.owner, invitation("Иван Тестов", "i.testov@alta.example", w.f1)); err == nil {
		t.Fatal("invitation committed although the tenant DB refused")
	}
	if n := w.ControlCount(`select 1 from invitations where tenant_id = $1 and email_norm = 'i.testov@alta.example' and revoked_at is null`, w.TenantID); n != 0 {
		t.Errorf("pending invitations after a failed invite: %d", n)
	}
}
