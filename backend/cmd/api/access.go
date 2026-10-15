package main

import (
	"context"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/modules/importer"
	"github.com/ortus/ortus-crm/backend/internal/modules/org"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit"
	peoplemod "github.com/ortus/ortus-crm/backend/internal/modules/people"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Aliases give the embedded servers of the modules distinct field names (all three types are named Server).
type (
	orgServer      = org.Server
	peopleServer   = peoplemod.Server
	importerServer = importer.Server
)

// accessServer is the strict server of the tag Access. The tag has several owners: W1.05 (structure, people and
// their work functions, the CSV import — modules org, people, importer), W1.03 (invitations) and W1.06 (roles,
// assignments, groups, owners, explainAccess). Every owner embeds its server here (one line and one line in
// newAccessServer); the operations without an owner yet answer 501 not_implemented through accessPending, whose
// methods are one level deeper than the methods of the embedded servers and therefore never shadow them.
type accessServer struct {
	*orgServer
	*peopleServer
	*importerServer
	accessPending
}

var _ accessapi.StrictServerInterface = (*accessServer)(nil)

// newAccessServer wires the modules of W1.05 over the tenant pools, the evaluator of W1.04, the control DB (the
// memberships of people) and the clock of the application (APP_FIXED_NOW outside prod).
func newAccessServer(pools *tenantctx.Pools, ev *authz.Evaluator, control *pgxpool.Pool, now func() time.Time) *accessServer {
	var dir kit.Directory
	if control != nil {
		dir = kit.ControlDirectory{DB: control}
	}
	return &accessServer{
		orgServer:    &org.Server{Pools: pools, Authz: ev, Now: now},
		peopleServer: &peoplemod.Server{Pools: pools, Authz: ev, Directory: dir, Now: now},
		// sendInvitations of an import needs the invitation service of W1.03 (Inviter); until then — 501.
		importerServer: &importer.Server{Pools: pools, Authz: ev, Directory: dir, Now: now},
	}
}

// accessImplemented are the operations of the tag Access that have a server (W1.05). W1.03 and W1.06 add theirs
// together with the embedded server.
var accessImplemented = map[string]bool{
	"listOrgUnits": true, "getOrgUnit": true, "createOrgUnit": true, "updateOrgUnit": true, "previewOrgUnitMove": true,
	"listMembers": true, "getMember": true, "createMember": true,
	"listWorkProfiles": true, "createWorkProfile": true, "updateWorkProfile": true,
	"createPeopleImport": true, "getPeopleImport": true, "commitPeopleImport": true,
}

// mountAccessPending answers 501 for the operations of the tag Access without a server over the routes of the
// generated strict handler (chi replaces the endpoint): they answer before their parameters are bound, as a tag
// without a server does, so the pending isolation rows of their owners keep seeing 501.
func mountAccessPending(r chi.Router) {
	for _, op := range catalog.Operations {
		if op.Tag == "Access" && !accessImplemented[op.ID] {
			r.MethodFunc(op.Method, op.Path, notImplemented)
		}
	}
}

// accessPending puts the stubs one level below the embedded servers.
type accessPending struct{ accessNotImplemented }

// accessNotImplemented answers 501 not_implemented for every operation of the tag Access.
type accessNotImplemented struct{}

var errAccessNotImplemented = problem.New(problem.CodeNotImplemented, "")

func (accessNotImplemented) ExplainAccess(context.Context, accessapi.ExplainAccessRequestObject) (accessapi.ExplainAccessResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) ListAssignments(context.Context, accessapi.ListAssignmentsRequestObject) (accessapi.ListAssignmentsResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) CreateAssignment(context.Context, accessapi.CreateAssignmentRequestObject) (accessapi.CreateAssignmentResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) RevokeAssignment(context.Context, accessapi.RevokeAssignmentRequestObject) (accessapi.RevokeAssignmentResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) ListGroups(context.Context, accessapi.ListGroupsRequestObject) (accessapi.ListGroupsResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) CreateGroup(context.Context, accessapi.CreateGroupRequestObject) (accessapi.CreateGroupResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) DeleteGroup(context.Context, accessapi.DeleteGroupRequestObject) (accessapi.DeleteGroupResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) GetGroup(context.Context, accessapi.GetGroupRequestObject) (accessapi.GetGroupResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) UpdateGroup(context.Context, accessapi.UpdateGroupRequestObject) (accessapi.UpdateGroupResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) SetGroupMembers(context.Context, accessapi.SetGroupMembersRequestObject) (accessapi.SetGroupMembersResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) InviteMember(context.Context, accessapi.InviteMemberRequestObject) (accessapi.InviteMemberResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) ListMembers(context.Context, accessapi.ListMembersRequestObject) (accessapi.ListMembersResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) CreateMember(context.Context, accessapi.CreateMemberRequestObject) (accessapi.CreateMemberResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) GetMember(context.Context, accessapi.GetMemberRequestObject) (accessapi.GetMemberResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) UpdateMember(context.Context, accessapi.UpdateMemberRequestObject) (accessapi.UpdateMemberResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) ListWorkProfiles(context.Context, accessapi.ListWorkProfilesRequestObject) (accessapi.ListWorkProfilesResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) CreateWorkProfile(context.Context, accessapi.CreateWorkProfileRequestObject) (accessapi.CreateWorkProfileResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) UpdateWorkProfile(context.Context, accessapi.UpdateWorkProfileRequestObject) (accessapi.UpdateWorkProfileResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) ListOrgUnits(context.Context, accessapi.ListOrgUnitsRequestObject) (accessapi.ListOrgUnitsResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) CreateOrgUnit(context.Context, accessapi.CreateOrgUnitRequestObject) (accessapi.CreateOrgUnitResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) GetOrgUnit(context.Context, accessapi.GetOrgUnitRequestObject) (accessapi.GetOrgUnitResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) UpdateOrgUnit(context.Context, accessapi.UpdateOrgUnitRequestObject) (accessapi.UpdateOrgUnitResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) PreviewOrgUnitMove(context.Context, accessapi.PreviewOrgUnitMoveRequestObject) (accessapi.PreviewOrgUnitMoveResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) ListOwners(context.Context, accessapi.ListOwnersRequestObject) (accessapi.ListOwnersResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) TransferOwnership(context.Context, accessapi.TransferOwnershipRequestObject) (accessapi.TransferOwnershipResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) RevokeOwnership(context.Context, accessapi.RevokeOwnershipRequestObject) (accessapi.RevokeOwnershipResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) CreatePeopleImport(context.Context, accessapi.CreatePeopleImportRequestObject) (accessapi.CreatePeopleImportResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) GetPeopleImport(context.Context, accessapi.GetPeopleImportRequestObject) (accessapi.GetPeopleImportResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) CommitPeopleImport(context.Context, accessapi.CommitPeopleImportRequestObject) (accessapi.CommitPeopleImportResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) ListRoles(context.Context, accessapi.ListRolesRequestObject) (accessapi.ListRolesResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) CreateRole(context.Context, accessapi.CreateRoleRequestObject) (accessapi.CreateRoleResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) DeleteRole(context.Context, accessapi.DeleteRoleRequestObject) (accessapi.DeleteRoleResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) GetRole(context.Context, accessapi.GetRoleRequestObject) (accessapi.GetRoleResponseObject, error) {
	return nil, errAccessNotImplemented
}

func (accessNotImplemented) UpdateRole(context.Context, accessapi.UpdateRoleRequestObject) (accessapi.UpdateRoleResponseObject, error) {
	return nil, errAccessNotImplemented
}
