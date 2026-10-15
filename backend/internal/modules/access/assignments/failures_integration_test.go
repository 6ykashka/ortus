//go:build integration

package assignments_test

import (
	"testing"

	"github.com/google/uuid"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments"            //nolint:depguard // the package under test (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/accesstest" //nolint:depguard // the access module's own test helper (W1.06)
)

func second[T any](_ T, err error) error { return err }

// Ввод: без тела — 400, неизвестный тип принципала — 422, limit и курсор — 400, без TenantContext — 404.
func TestAssignmentsInput(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := w.Ctx(w.owner)
	zero, broken := 0, "!!"
	weird := member(w.m1, w.trips, tenantScope)
	weird.PrincipalType = "robot"
	for name, tc := range map[string]struct {
		err  error
		want string
	}{
		"назначение без тела":          {second(w.h.CreateAssignment(ctx, accessapi.CreateAssignmentRequestObject{TenantId: w.TenantID})), "malformed_request"},
		"передача без тела":            {second(w.h.TransferOwnership(ctx, accessapi.TransferOwnershipRequestObject{TenantId: w.TenantID})), "malformed_request"},
		"приглашение без тела":         {second(w.h.InviteMember(ctx, accessapi.InviteMemberRequestObject{TenantId: w.TenantID})), "malformed_request"},
		"тип принципала":               {second(w.create(t, w.owner, weird)), "validation_failed"},
		"область без ресурса":          {second(w.create(t, w.owner, member(w.m1, w.trips, accessapi.Scope{Kind: accessapi.ScopeKindOrgUnit, ResourceIds: []uuid.UUID{}}))), "validation_failed"},
		"limit 0":                      {second(w.h.ListAssignments(ctx, accessapi.ListAssignmentsRequestObject{TenantId: w.TenantID, Params: accessapi.ListAssignmentsParams{Limit: &zero}})), "malformed_request"},
		"курсор":                       {second(w.h.ListAssignments(ctx, accessapi.ListAssignmentsRequestObject{TenantId: w.TenantID, Params: accessapi.ListAssignmentsParams{Cursor: &broken}})), "malformed_request"},
		"курсор не время":              {second(w.h.ListAssignments(ctx, accessapi.ListAssignmentsRequestObject{TenantId: w.TenantID, Params: accessapi.ListAssignmentsParams{Cursor: new("eyJrIjoieCIsImkiOiIwMDAwMDAwMC0wMDAwLTAwMDAtMDAwMC0wMDAwMDAwMDAwMDEifQ")}})), "malformed_request"},
		"список без тенанта":           {second(w.h.ListAssignments(t.Context(), accessapi.ListAssignmentsRequestObject{TenantId: w.TenantID})), "not_found"},
		"назначение без тенанта":       {second(w.h.CreateAssignment(t.Context(), accessapi.CreateAssignmentRequestObject{TenantId: w.TenantID})), "not_found"},
		"снятие без тенанта":           {second(w.h.RevokeAssignment(t.Context(), accessapi.RevokeAssignmentRequestObject{TenantId: w.TenantID, AssignmentId: w.aM1})), "not_found"},
		"владельцы без тенанта":        {second(w.h.ListOwners(t.Context(), accessapi.ListOwnersRequestObject{TenantId: w.TenantID})), "not_found"},
		"передача без тенанта":         {second(w.h.TransferOwnership(t.Context(), accessapi.TransferOwnershipRequestObject{TenantId: w.TenantID})), "not_found"},
		"снятие владельца без тенанта": {second(w.h.RevokeOwnership(t.Context(), accessapi.RevokeOwnershipRequestObject{TenantId: w.TenantID})), "not_found"},
		"приглашение без тенанта":      {second(w.h.InviteMember(t.Context(), accessapi.InviteMemberRequestObject{TenantId: w.TenantID})), "not_found"},
	} {
		if got := accesstest.Code(tc.err); got != tc.want {
			t.Errorf("%s: %v, want %s", name, tc.err, tc.want)
		}
	}
}

// Сбой БД — 503 dependency_unavailable на чтении и на каждой команде; без control DB — 503 у владельцев,
// приглашения и снятия роли владельца.
func TestAssignmentsStoreFailures(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	own := w.Assign(accesstest.Grant{Principal: w.owner.PersonID, Role: w.ownerRole, Kind: "tenant", Descendants: true})
	noControl := w.Deps()
	noControl.Control = nil
	h := assignments.New(noControl)
	ctx := w.Ctx(w.owner)
	invite := invitation("Иван", "ivan@alta.example", w.f1)
	for name, err := range map[string]error{
		"владельцы":             second(h.ListOwners(ctx, accessapi.ListOwnersRequestObject{TenantId: w.TenantID})),
		"передача":              second(h.TransferOwnership(ctx, accessapi.TransferOwnershipRequestObject{TenantId: w.TenantID, Body: new(transferTo(w.m1, "m1@alta.example", true))})),
		"снятие владельца":      second(h.RevokeOwnership(ctx, accessapi.RevokeOwnershipRequestObject{TenantId: w.TenantID, MemberId: w.owner.PersonID})),
		"приглашение":           second(h.InviteMember(ctx, accessapi.InviteMemberRequestObject{TenantId: w.TenantID, Body: &invite})),
		"снятие роли владельца": second(h.RevokeAssignment(ctx, accessapi.RevokeAssignmentRequestObject{TenantId: w.TenantID, AssignmentId: own})),
	} {
		if got := accesstest.Code(err); got != "dependency_unavailable" {
			t.Errorf("without the control DB, %s: %v", name, err)
		}
	}
	b := newWorld(t)
	b.Break("access.role_assignments")
	for name, err := range map[string]error{
		"список":     second(b.h.ListAssignments(b.Ctx(b.owner), accessapi.ListAssignmentsRequestObject{TenantId: b.TenantID})),
		"назначение": second(b.create(t, b.owner, member(b.m2, b.review, unitScope(b.f2, false)))),
		"снятие":     b.revoke(t, b.owner, b.aM1),
		"приглашение": second(b.invite(t, b.owner, invitation("Иван", "ivan@alta.example", b.f1,
			accessapi.InvitationRole{RoleId: b.trips, Scope: unitScope(b.f1, true)}))),
	} {
		if got := accesstest.Code(err); got != "dependency_unavailable" {
			t.Errorf("%s: %v", name, err)
		}
	}
	a := newWorld(t)
	a.Break("audit.events")
	for name, err := range map[string]error{
		"назначение":  second(a.create(t, a.owner, member(a.m2, a.review, unitScope(a.f2, false)))),
		"снятие":      a.revoke(t, a.owner, a.aM1),
		"приглашение": second(a.invite(t, a.owner, invitation("Иван", "ivan@alta.example", a.f1))),
		"передача":    second(a.transfer(t, a.owner, transferTo(a.m1, "m1@alta.example", true))),
	} {
		if got := accesstest.Code(err); got != "dependency_unavailable" {
			t.Errorf("without audit, %s: %v", name, err)
		}
	}
}
