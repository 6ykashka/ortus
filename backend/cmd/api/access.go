package main

import (
	"context"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments"
	accesskit "github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/explain"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/groups"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/roles"
	"github.com/ortus/ortus-crm/backend/internal/modules/importer"
	"github.com/ortus/ortus-crm/backend/internal/modules/org"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit"
	peoplemod "github.com/ortus/ortus-crm/backend/internal/modules/people"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/session"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Aliases give the embedded servers of the modules distinct field names (the types are named Server or Handler).
type (
	orgServer          = org.Server
	peopleServer       = peoplemod.Server
	importerServer     = importer.Server
	rolesHandler       = roles.Handler       // W1.06: roles (S1-12)
	assignmentsHandler = assignments.Handler // W1.06: assignments (S1-13), owners (S1-16)
	groupsHandler      = groups.Handler      // W1.06: groups
	explainHandler     = explain.Handler     // W1.06: «Почему доступно» (S1-14)
)

// accessServer is the strict server of the tag Access. The tag has several owners: W1.05 (structure, people and
// their work functions, the CSV import — modules org, people, importer), W1.03 (invitations: accepted by authhttp)
// and W1.06 (roles, assignments, groups, owners, explainAccess, inviteMember — modules/access/{roles,assignments,
// groups,explain}), W1.43 (updateMember — modules/access/assignments). Every owner embeds its server here (one line
// and one line in newAccessServer). Since W1.43 every operation of the tag has a server: the stubs of the operations
// without one (accessPending, 501 not_implemented) are gone, and the assertion below fails to compile when a
// regenerated contract adds an operation nobody serves yet.
type accessServer struct {
	*orgServer
	*peopleServer
	*importerServer
	*rolesHandler
	*assignmentsHandler
	*groupsHandler
	*explainHandler
}

var _ accessapi.StrictServerInterface = (*accessServer)(nil)

// newAccessServer wires the modules of W1.05 and the access model of W1.06 over the tenant pools, the evaluator of
// W1.04, the control DB (the memberships of people; the owner bindings) and the clock of the application
// (APP_FIXED_NOW outside prod).
func newAccessServer(pools *tenantctx.Pools, ev *authz.Evaluator, control *pgxpool.Pool, now func() time.Time) *accessServer {
	var dir kit.Directory
	if control != nil {
		dir = kit.ControlDirectory{DB: control}
	}
	// A fresh sign-in of the owner commands of W1.06 is the authentication at the provider (Session.AuthTime, W1.03).
	d := accesskit.Deps{Pools: pools, Evaluator: ev, Control: control, Now: now, AuthTime: sessionAuthTime}
	s := &accessServer{
		orgServer:          &org.Server{Pools: pools, Authz: ev, Now: now},
		peopleServer:       &peoplemod.Server{Pools: pools, Authz: ev, Directory: dir, Now: now},
		importerServer:     &importer.Server{Pools: pools, Authz: ev, Directory: dir, Now: now},
		rolesHandler:       roles.New(d),
		assignmentsHandler: assignments.New(d),
		groupsHandler:      groups.New(d),
		explainHandler:     explain.New(d),
	}
	// W1.43 (Q-W1.05-10): sendInvitations of an import invites through the access module — the assignments handler
	// the server holds when the command runs, the one with the letters (main.go sets WithInvitationMail after this).
	s.Inviter = importInviter{s: s}
	return s
}

// importInviter is importer.Inviter over assignments.Handler.InviteCards (W1.43): the two modules do not import each
// other, cmd/api converts their invitees.
type importInviter struct{ s *accessServer }

func (a importInviter) InviteCards(ctx context.Context, tc tenantctx.TenantContext, fn func(tx pgx.Tx) ([]importer.Invitee, error), complete func(tx pgx.Tx) error) (int, error) {
	return a.s.InviteCards(ctx, tc, func(tx pgx.Tx) ([]assignments.Invitee, error) {
		in, err := fn(tx)
		out := make([]assignments.Invitee, 0, len(in))
		for _, v := range in {
			out = append(out, assignments.Invitee{Person: v.Person, Email: v.Email, Unit: v.Unit, Line: v.Line})
		}
		return out, err
	}, complete)
}

// sessionAuthTime is when the account of the request authenticated at its provider (IssuedAt for the dev provider).
func sessionAuthTime(ctx context.Context) (time.Time, bool) {
	s, ok := session.FromContext(ctx)
	return s.AuthTime, ok
}

// accessImplemented are the operations of the tag Access that have a server (W1.05, W1.06, W1.43); an owner adds its
// own together with the embedded server. Every operation of the tag has one since W1.43 (updateMember).
var accessImplemented = map[string]bool{
	"listOrgUnits": true, "getOrgUnit": true, "createOrgUnit": true, "updateOrgUnit": true, "previewOrgUnitMove": true,
	"listMembers": true, "getMember": true, "createMember": true,
	"listWorkProfiles": true, "createWorkProfile": true, "updateWorkProfile": true,
	"createPeopleImport": true, "getPeopleImport": true, "commitPeopleImport": true,
	// W1.06: the access model.
	"listRoles": true, "getRole": true, "createRole": true, "updateRole": true, "deleteRole": true,
	"listAssignments": true, "createAssignment": true, "revokeAssignment": true,
	"listGroups": true, "getGroup": true, "createGroup": true, "updateGroup": true, "deleteGroup": true,
	"setGroupMembers": true, "listOwners": true, "transferOwnership": true, "revokeOwnership": true, "explainAccess": true,
	"inviteMember": true, // W1.06 (Q-W1.03-5): the card and the invitation of W1.03, accepted by authhttp of W1.03
	"updateMember": true, // W1.43 (Q-W1.05-11): suspension, restoration, the last owner, seats, sessions
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
