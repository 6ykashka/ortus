// Package people is the people of a tenant (W1.05, S1-09): person profiles with or without an account
// (people.person_profiles, BUILD-03) and their work functions with a period (people.work_profiles, AUTH-05).
//
// Member.id of the contract is people.person_profiles.id, as in the mock (MSW) and the Go seed. A card without an
// account has no membership in the control DB, takes no seat and sends no invitation (Q-W1.00-5). Reads go through
// scopeddb with the scope of members.read over the home unit (and the person itself for the scope self); commands
// authorize the person with the evaluator first and write in one transaction with the audit and the stored
// outcome. A person the actor cannot see answers like a missing one (AC-01).
package people

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Actions of the catalog (api/permissions.yaml).
const (
	actionRead      = "members.read"
	actionManage    = "members.manage"
	actionUnitsRead = "org_units.read"
)

// Audit target types.
const (
	targetPerson  = "people.person"
	targetProfile = "people.work_profile"
)

// maxName is the length limit of MemberCreate.displayName.
const maxName = 150

// Texts of the answers (member-card is no-reference, B-6; texts of the mock where it has them).
const (
	textUnknownUnit  = "Подразделение не найдено."
	textUnitArchived = "Подразделение в архиве."
	textOneUnit      = "Выберите одно подразделение: у сотрудника одно домашнее подразделение."
	textBadEmail     = "Проверьте адрес почты."
	textSoD          = "Функция «Водитель» несовместима с правом на начисления (правило MVP)."
	textEnded        = "Период функции уже закончился."
	textUnknownFn    = "Неизвестная функция."
)

// labels are the names of the work functions in texts (the mock, people.ts).
var labels = map[string]string{
	"driver": "Водитель", "practitioner": "Специалист", "foreman": "Прораб", "manager": "Менеджер",
}

// persons are the columns the scope predicate filters person profiles on.
var persons = authz.Columns{Unit: "p.home_unit_id", Persons: []string{"p.id"}}

// Server implements the people operations of the tag Access.
type Server struct {
	Pools     kit.Pools
	Authz     kit.Authorizer
	Directory kit.Directory    // memberships of the control DB; nil: every person is shown as a card
	Now       func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
	// Invitations are the pending invitations of the control DB (W1.52); nil: those of the control DB of a
	// kit.ControlDirectory, else none.
	Invitations Invitations
}

func (s *Server) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}

func (s *Server) conn(ctx context.Context, tc tenantctx.TenantContext) (*scopeddb.Conn, error) {
	c, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return c, nil
}

func (s *Server) memberships(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]kit.Membership, error) {
	if s.Directory == nil || len(ids) == 0 {
		return map[uuid.UUID]kit.Membership{}, nil
	}
	ms, err := s.Directory.Memberships(ctx, tenantID, ids)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return ms, nil
}

// invitationReader is the reader of the pending invitations: Invitations, else the control DB of a
// kit.ControlDirectory (cmd/api and the tests wire the people with it), else none — every person without a
// membership is a card.
func (s *Server) invitationReader() Invitations {
	if s.Invitations != nil {
		return s.Invitations
	}
	if d, ok := s.Directory.(kit.ControlDirectory); ok && d.DB != nil {
		return ControlInvitations{DB: d.DB}
	}
	return nil
}

// pending returns the persons of ids with a pending invitation (W1.52).
func (s *Server) pending(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]time.Time, error) {
	r := s.invitationReader()
	if r == nil || len(ids) == 0 {
		return map[uuid.UUID]time.Time{}, nil
	}
	out, err := r.Pending(ctx, tenantID, ids)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return out, nil
}

// isOwner reports whether the membership of a person has an active owner binding.
func (s *Server) isOwner(ctx context.Context, tenantID uuid.UUID, membership *uuid.UUID) (bool, error) {
	if membership == nil {
		return false, nil
	}
	ms, err := s.memberships(ctx, tenantID, []uuid.UUID{*membership})
	if err != nil {
		return false, err
	}
	return ms[*membership].Owner, nil
}

// person is a row of people.person_profiles with the functions active at the moment of the read.
type person struct {
	ID         uuid.UUID
	Membership *uuid.UUID
	Name       string
	Email      *string
	Home       uuid.UUID
	Revision   int64
	Functions  []string // people.work_profiles.function
}

func scanPerson(row pgx.Row) (person, error) {
	var p person
	err := row.Scan(&p.ID, &p.Membership, &p.Name, &p.Email, &p.Home, &p.Revision, &p.Functions)
	return p, err
}

// Statuses of a membership of the control DB (membership_status).
const (
	membershipInvited   = "invited"
	membershipSuspended = "suspended"
	membershipEnded     = "ended"
)

// awaitsInvitation reports whether a pending invitation decides the status of a person with membership m: a person
// without a live membership (none — the card of inviteMember — or an ended one) is invited while its invitation is
// pending (W1.52). An active or suspended membership has no pending invitation (invitations.Issue refuses it), an
// invited one is invited anyway.
func awaitsInvitation(m *kit.Membership) bool { return m == nil || m.Status == membershipEnded }

// dto is the Member of the contract; m is the membership of the person (nil for a card without an account), invited —
// whether the person has a pending invitation (W1.52). A card without a membership is invited while its invitation is
// pending and a card without an account (active, no userId) otherwise: once the invitation expired or was revoked
// (Q-W1.00-5). The account (userId) comes from the membership only: an invitation has none before the acceptance.
func (p person) dto(m *kit.Membership, invited bool) accessapi.Member {
	out := accessapi.Member{
		Id: p.ID, DisplayName: p.Name, Status: accessapi.MemberStatusActive, OrgUnitIds: []uuid.UUID{p.Home},
		Revision: p.Revision, WorkProfiles: []accessapi.MemberWorkProfiles{},
	}
	if p.Email != nil && *p.Email != "" {
		kit.SetString(&out.Email, *p.Email)
	}
	if m != nil {
		account := m.AccountID
		out.UserId = &account
		switch m.Status {
		case membershipInvited:
			out.Status = accessapi.MemberStatusInvited
		case membershipSuspended, membershipEnded:
			out.Status = accessapi.MemberStatusSuspended
		}
	}
	if invited && awaitsInvitation(m) {
		out.Status = accessapi.MemberStatusInvited
	}
	for _, f := range p.Functions {
		if api, ok := kit.FunctionFromDB(f); ok {
			out.WorkProfiles = append(out.WorkProfiles, accessapi.MemberWorkProfiles(api))
		}
	}
	return out
}

// target is a person a command acts on: its home unit, the zone of that unit and its membership.
type target struct {
	ID         uuid.UUID
	Home       uuid.UUID
	Zone       *time.Location
	Membership *uuid.UUID
}

// manageable returns the person id if the actor has members.manage over it: 404 when the actor does not see the
// person (or it does not exist), 403 when it sees the person without the right.
func (s *Server) manageable(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (target, error) {
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return target{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	t := target{ID: id}
	var zone string
	err = pool.QueryRow(ctx, `select p.home_unit_id, u.time_zone, p.membership_id
		  from people.person_profiles p join org.units u on u.id = p.home_unit_id
		 where p.id = $1 and p.archived_at is null`, id).Scan(&t.Home, &zone, &t.Membership)
	if errors.Is(err, pgx.ErrNoRows) {
		return target{}, problem.New(problem.CodeNotFound, "")
	}
	if err != nil {
		return target{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if t.Zone, err = time.LoadLocation(zone); err != nil {
		return target{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	r := authz.Resource{Unit: t.Home, Persons: []uuid.UUID{id}, ReadAction: actionRead}
	if err := s.Authz.Permit(ctx, tc, actionManage, r); err != nil {
		return target{}, err
	}
	return t, nil
}

// rid returns the X-Request-Id of the response.
func rid(ctx context.Context) *string {
	id := requestid.FromContext(ctx)
	return &id
}

func noStore() *string {
	v := kit.NoStore
	return &v
}

// dbError keeps Problem errors and hides everything else behind dependency_unavailable.
func dbError(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}
