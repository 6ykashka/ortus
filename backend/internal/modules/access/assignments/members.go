package assignments

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit" //nolint:depguard // the shared kit of the access module (W1.06)
	orgkit "github.com/ortus/ortus-crm/backend/internal/modules/org/kit"         //nolint:depguard // W1.05: the work functions of the contract and the revision of a person (W1.43)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Actions and texts of updateMember (W1.43): the mock (frontend/packages/adapter/src/msw/access/members.ts) where it
// has them, createMember of W1.05 for the unit, otherwise new (decisionsNeeded of W1.43).
const (
	actionManage          = "members.manage"
	actionUnitsRead       = "org_units.read"
	targetMember          = "access.member"
	membershipActive      = "active"
	membershipSuspended   = "suspended"
	membershipInvited     = "invited"
	membershipEnded       = "ended"
	detailNothingToChange = "Укажите, что изменить."
	detailOneUnit         = "Выберите одно подразделение: у сотрудника одно домашнее подразделение."
	detailUnknownUnit     = "Подразделение не найдено."
	detailUnitArchived    = "Подразделение в архиве."
	detailUnknownFunction = "Неизвестная функция."
	detailNotAccepted     = "Участник ещё не принял приглашение."
	detailEnded           = "Участие сотрудника завершено."
	detailNoAccount       = "У сотрудника нет аккаунта: приостанавливать нечего."
	detailSuspendSelf     = "Нельзя приостановить себя."
	detailSuspendLast     = "Нельзя приостановить последнего владельца"
	detailFunctionOverlap = "У сотрудника уже есть функция «%s» в этот период."
	pgExclusionViolation  = "23P01"
)

// functionLabels are the names of the work functions in texts (the mock, people.ts).
var functionLabels = map[string]string{
	"driver": "Водитель", "practitioner": "Специалист", "foreman": "Прораб", "manager": "Менеджер",
}

// memberPatch is a validated MemberPatch: "" — the status stays, uuid.Nil — the unit stays, nil — the functions stay.
type memberPatch struct {
	status    string
	unit      uuid.UUID
	functions []string // people.work_profiles.function, sorted
}

func parseMemberPatch(b *accessapi.MemberPatch) (memberPatch, error) {
	if b == nil {
		return memberPatch{}, problem.New(problem.CodeMalformedRequest, "")
	}
	var p memberPatch
	if b.Status == nil && b.OrgUnitIds == nil && b.WorkProfiles == nil {
		return p, kit.Validation(detailNothingToChange)
	}
	if b.Status != nil {
		if !b.Status.Valid() {
			return p, problem.New(problem.CodeMalformedRequest, "status")
		}
		p.status = string(*b.Status)
	}
	if b.OrgUnitIds != nil {
		if len(*b.OrgUnitIds) != 1 {
			return p, kit.Validation(detailOneUnit)
		}
		p.unit = (*b.OrgUnitIds)[0]
	}
	if b.WorkProfiles != nil {
		p.functions = []string{}
		for _, f := range *b.WorkProfiles {
			db, ok := orgkit.FunctionToDB(string(f))
			if !ok {
				return p, kit.Validation(detailUnknownFunction)
			}
			p.functions = append(p.functions, db)
		}
		slices.Sort(p.functions)
		p.functions = slices.Compact(p.functions)
	}
	return p, nil
}

// memberRow is a person of the tenant DB with its membership of the control DB (locked).
type memberRow struct {
	id         uuid.UUID
	home       uuid.UUID
	name       string
	email      *string
	revision   int64
	membership *uuid.UUID
	status     string // membership_status; "" — a card without an account
	account    uuid.UUID
	owner      bool // an active owner binding
}

// apiStatus is Member.status: a card without an account is active, an ended membership is shown suspended (W1.05).
func (m memberRow) apiStatus() accessapi.MemberStatus {
	switch m.status {
	case membershipInvited:
		return accessapi.MemberStatusInvited
	case membershipSuspended, membershipEnded:
		return accessapi.MemberStatusSuspended
	}
	return accessapi.MemberStatusActive
}

// loadMember reads the person id (locked by InControlPeopleTx) and locks its membership: 404 without a live person.
func loadMember(ctx context.Context, tx, ctl pgx.Tx, tenant, id uuid.UUID) (memberRow, error) {
	m := memberRow{id: id}
	err := tx.QueryRow(ctx, `select home_unit_id, full_name, email, revision, membership_id from people.person_profiles
		where id = $1 and archived_at is null`, id).Scan(&m.home, &m.name, &m.email, &m.revision, &m.membership)
	switch {
	case kit.NoRows(err):
		return m, kit.NotFound()
	case err != nil:
		return m, kit.Store("person", err)
	case m.membership == nil:
		return m, nil
	}
	err = ctl.QueryRow(ctx, `select m.status::text, m.account_id,
		       exists (select 1 from owner_bindings ob where ob.membership_id = m.id and ob.revoked_at is null)
		  from memberships m where m.id = $1 and m.tenant_id = $2 for update`, *m.membership, tenant).Scan(&m.status, &m.account, &m.owner)
	switch {
	case kit.NoRows(err): // the profile names a membership the control DB does not have: a card
		m.membership = nil
		return m, nil
	case err != nil:
		return m, kit.Store("membership", err)
	}
	return m, nil
}

// memberChange is what an updateMember changed.
type memberChange struct {
	status   string // the new membership status, "" — unchanged
	moved    bool
	added    []string
	ended    []string
	sessions int64 // sessions revoked
}

func (c memberChange) any() bool {
	return c.status != "" || c.moved || len(c.added) > 0 || len(c.ended) > 0
}

// rights reports whether the change changes the rights of the person: its membership or its work functions.
func (c memberChange) rights() bool { return c.status != "" || len(c.added) > 0 || len(c.ended) > 0 }

func (c memberChange) action() string {
	switch c.status {
	case membershipSuspended:
		return "access.member.suspend"
	case membershipActive:
		return "access.member.restore"
	}
	return "access.member.update"
}

// UpdateMember implements accessapi.StrictServerInterface (W1.43, Q-W1.05-11): suspends or restores the membership of
// a person, moves the person to another unit, sets its work functions — by If-Match of the person, within
// members.manage of the actor. Under the lock of the business (control DB), then of the person, then of the policy
// (kit.InControlPeopleTx): the last active owner is never suspended (409 last_owner_required, 02-architecture §4), an
// owner is managed by owners only (403), a restoration takes a seat of the plan (409 seats_exhausted). A suspension
// closes the business to the member at once (tenantctx.Resolve answers 404 to an inactive membership), raises the
// policy version (context.changed, capability caches) and revokes the BFF sessions of an account that has no other
// active membership.
func (h *Handler) UpdateMember(ctx context.Context, req accessapi.UpdateMemberRequestObject) (accessapi.UpdateMemberResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	p, err := parseMemberPatch(req.Body)
	if err != nil {
		return nil, err
	}
	var out accessapi.Member
	err = h.d.InControlPeopleTx(ctx, tc, []uuid.UUID{req.MemberId}, func(tx, ctl pgx.Tx) (kit.Undo, error) {
		ev, err := kit.Within(ctx, h.d.Evaluator, tc, tx)
		if err != nil {
			return nil, err
		}
		m, err := loadMember(ctx, tx, ctl, tc.TenantID, req.MemberId)
		if err != nil {
			return nil, err
		}
		if err := ev.Permit(ctx, tc, actionManage, authz.Resource{Unit: m.home, Persons: []uuid.UUID{m.id}, ReadAction: actionMembers}); err != nil {
			return nil, err
		}
		if m.owner && !tc.Owner { // «Администратор не может снять владельца» (02-architecture §4)
			return nil, kit.Forbidden()
		}
		if err := orgkit.CheckRevision(req.Params.IfMatch, m.revision); err != nil {
			return nil, err
		}
		var undo kit.Undo
		out, undo, err = h.changeMember(ctx, tx, ctl, ev, tc, &m, p)
		return undo, err
	})
	if err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	tag, replayed := kit.ETag(out.Revision), false
	return accessapi.UpdateMember200JSONResponse{Body: out, Headers: accessapi.UpdateMember200ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// changeMember applies p to the locked person m in tx (tenant) and ctl (control): status, unit, functions, then the
// revision, the policy version, the audit and the outcome.
func (h *Handler) changeMember(ctx context.Context, tx, ctl pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext, m *memberRow, p memberPatch) (accessapi.Member, kit.Undo, error) {
	now := h.d.Clock()
	var c memberChange
	undo, err := setStatus(ctx, ctl, tc, m, p.status, &c)
	if err != nil {
		return accessapi.Member{}, nil, err
	}
	if c.moved, err = moveMember(ctx, tx, ev, tc, m, p.unit); err != nil {
		return accessapi.Member{}, nil, err
	}
	if p.functions != nil {
		if c.added, c.ended, err = h.setFunctions(ctx, tx, m, p.functions, now); err != nil {
			return accessapi.Member{}, nil, err
		}
	}
	if c.any() {
		if err := tx.QueryRow(ctx, `update people.person_profiles set revision = revision + 1 where id = $1 returning revision`,
			m.id).Scan(&m.revision); err != nil {
			return accessapi.Member{}, nil, kit.Store("person revision", err)
		}
		if err := h.recordMember(ctx, tx, tc, *m, c); err != nil {
			return accessapi.Member{}, nil, err
		}
	}
	out, err := memberAPI(ctx, tx, *m, now)
	if err != nil {
		return accessapi.Member{}, nil, err
	}
	if err := kit.Complete(ctx, tx, http.StatusOK, kit.ETag(out.Revision), out); err != nil {
		return accessapi.Member{}, nil, err
	}
	return out, undo, nil
}

// setStatus changes the membership of m to want ("" — no change) in ctl and returns the compensation of the control DB.
func setStatus(ctx context.Context, ctl pgx.Tx, tc tenantctx.TenantContext, m *memberRow, want string, c *memberChange) (kit.Undo, error) {
	if change, err := transition(*m, want); err != nil || !change {
		return nil, err
	}
	if want == membershipSuspended {
		if err := mayBeSuspended(ctx, ctl, tc, *m); err != nil {
			return nil, err
		}
	} else if err := freeSeats(ctx, ctl, tc.TenantID, 1); err != nil {
		return nil, err
	}
	before := m.status
	if _, err := ctl.Exec(ctx, `update memberships set status = $2::membership_status, revision = revision + 1 where id = $1`,
		*m.membership, want); err != nil {
		return nil, kit.Store("membership", err)
	}
	var revoked [][]byte
	if want == membershipSuspended {
		var err error
		if revoked, err = revokeSessions(ctx, ctl, m.account, *m.membership); err != nil {
			return nil, err
		}
	}
	m.status, c.status, c.sessions = want, want, int64(len(revoked))
	membership := *m.membership
	return func(ctx context.Context, ctl pgx.Tx) error {
		if _, err := ctl.Exec(ctx, `update memberships set status = $2::membership_status, revision = revision + 1 where id = $1`,
			membership, before); err != nil {
			return err
		}
		_, err := ctl.Exec(ctx, `update auth_sessions set revoked_at = null where id_hash = any($1) and logout_key is null`, revoked)
		return err
	}, nil
}

// transition reports whether the membership of m changes to want ("" — no change): a card without an account, an
// invited and an ended membership never change (409 invalid_transition).
func transition(m memberRow, want string) (bool, error) {
	if want == "" || string(m.apiStatus()) == want && m.status != membershipEnded {
		return false, nil
	}
	switch m.status {
	case "":
		return false, kit.Conflict(kit.CodeInvalidTransition, detailNoAccount)
	case membershipInvited:
		return false, kit.Conflict(kit.CodeInvalidTransition, detailNotAccepted)
	case membershipEnded:
		return false, kit.Conflict(kit.CodeInvalidTransition, detailEnded)
	}
	return true, nil
}

// mayBeSuspended refuses the suspension of the last active owner (409 last_owner_required) and of the actor itself
// (409 invalid_transition). The tenant row is locked: owner changes and suspensions of the business go one by one.
func mayBeSuspended(ctx context.Context, ctl pgx.Tx, tc tenantctx.TenantContext, m memberRow) error {
	if m.owner {
		var others int
		if err := ctl.QueryRow(ctx, `select count(*) from owner_bindings ob join memberships ms on ms.id = ob.membership_id
			where ob.tenant_id = $1 and ob.revoked_at is null and ms.status = 'active' and ms.id <> $2`,
			tc.TenantID, *m.membership).Scan(&others); err != nil {
			return kit.Store("owners", err)
		}
		if others == 0 {
			return kit.Conflict(kit.CodeLastOwner, detailSuspendLast)
		}
	}
	if m.id == tc.PersonID {
		return kit.Conflict(kit.CodeInvalidTransition, detailSuspendSelf)
	}
	return nil
}

// revokeSessions ends the live BFF sessions of an account suspended in a business, unless the account works in
// another business (an active membership) or is an active platform operator: its sessions serve those too, and the
// suspended business is closed to it anyway (tenantctx.Resolve). It returns the hashes of the revoked sessions.
func revokeSessions(ctx context.Context, ctl pgx.Tx, account, membership uuid.UUID) ([][]byte, error) {
	rows, err := ctl.Query(ctx, `update auth_sessions s set revoked_at = now()
		 where s.account_id = $1 and s.revoked_at is null
		   and not exists (select 1 from memberships m where m.account_id = $1 and m.status = 'active' and m.id <> $2)
		   and not exists (select 1 from platform_operators o where o.account_id = $1 and o.status = 'active')
		returning s.id_hash`, account, membership)
	if err != nil {
		return nil, kit.Store("sessions", err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[[]byte])
	return out, kit.Store("sessions", err)
}

// moveMember sets the home unit of m to unit (uuid.Nil — no move): an unknown unit and a unit the actor does not see
// are the same 422, a visible unit without members.manage is 403, an archived unit is 422 (createMember of W1.05).
func moveMember(ctx context.Context, tx pgx.Tx, ev *authz.Evaluator, tc tenantctx.TenantContext, m *memberRow, unit uuid.UUID) (bool, error) {
	if unit == uuid.Nil || unit == m.home {
		return false, nil
	}
	var archived bool
	err := tx.QueryRow(ctx, `select archived_at is not null from org.units where id = $1`, unit).Scan(&archived)
	switch {
	case kit.NoRows(err):
		return false, kit.Validation(detailUnknownUnit)
	case err != nil:
		return false, kit.Store("unit", err)
	}
	err = ev.Permit(ctx, tc, actionManage, authz.Resource{Unit: unit, ReadAction: actionUnitsRead})
	switch {
	case problem.Is(err, problem.CodeNotFound):
		return false, kit.Validation(detailUnknownUnit)
	case err != nil:
		return false, err
	case archived:
		return false, kit.Validation(detailUnitArchived)
	}
	if _, err := tx.Exec(ctx, `update people.person_profiles set home_unit_id = $2 where id = $1`, m.id, unit); err != nil {
		return false, kit.Store("move person", err)
	}
	m.home = unit
	return true, nil
}

// activeFunction is a work function of a person active at a moment.
type activeFunction struct {
	ID       uuid.UUID
	Function string
	From     time.Time
}

// setFunctions makes want the work functions of m active at now: a function not in want ends now (a period that
// starts now is deleted), a new one starts now, open-ended. The driver function of an owner or of a person with an
// earnings grant is 409 (D-10, as createWorkProfile of W1.05). It returns the functions added and ended.
func (h *Handler) setFunctions(ctx context.Context, tx pgx.Tx, m *memberRow, want []string, now time.Time) (added, ended []string, err error) {
	rows, err := tx.Query(ctx, `select id, function, lower(valid) from people.work_profiles
		where person_id = $1 and valid @> $2::timestamptz order by function, id`, m.id, now)
	if err != nil {
		return nil, nil, kit.Store("work functions", err)
	}
	current, err := pgx.CollectRows(rows, pgx.RowToStructByPos[activeFunction])
	if err != nil {
		return nil, nil, kit.Store("work functions", err)
	}
	have := map[string]bool{}
	for _, f := range current {
		have[f.Function] = true
		if slices.Contains(want, f.Function) {
			continue
		}
		if err := endFunction(ctx, tx, f, now); err != nil {
			return nil, nil, err
		}
		ended = append(ended, f.Function)
	}
	for _, fn := range want {
		if have[fn] {
			continue
		}
		if err := h.startFunction(ctx, tx, *m, fn, now); err != nil {
			return nil, nil, err
		}
		added = append(added, fn)
	}
	return added, slices.Compact(ended), nil
}

func endFunction(ctx context.Context, tx pgx.Tx, f activeFunction, now time.Time) error {
	var err error
	if f.From.Before(now) {
		_, err = tx.Exec(ctx, `update people.work_profiles set valid = tstzrange(lower(valid), $2::timestamptz) where id = $1`, f.ID, now)
	} else {
		_, err = tx.Exec(ctx, `delete from people.work_profiles where id = $1`, f.ID)
	}
	return kit.Store("end work function", err)
}

func (h *Handler) startFunction(ctx context.Context, tx pgx.Tx, m memberRow, fn string, now time.Time) error {
	if fn == orgkit.FunctionDriver {
		conflict := m.owner // an owner holds every action, the earnings included (W1.05, Q-W1.06-15)
		if !conflict {
			var err error
			if conflict, err = kit.EarningsConflict(ctx, tx, []uuid.UUID{m.id}, kit.ClosedByDriver(h.d.Evaluator.Policy), now, nil); err != nil {
				return err
			}
		}
		if conflict {
			return kit.Conflict(kit.CodeSeparationOfDuties, kit.DetailDriverGetsEarnings)
		}
	}
	_, err := tx.Exec(ctx, `insert into people.work_profiles (person_id, function, unit_id, valid)
		values ($1, $2, $3, tstzrange($4::timestamptz, null))`, m.id, fn, m.home, now)
	if pe, ok := errors.AsType[*pgconn.PgError](err); ok && pe.Code == pgExclusionViolation {
		api, _ := orgkit.FunctionFromDB(fn)
		return kit.Conflict(kit.CodeInvalidTransition, fmt.Sprintf(detailFunctionOverlap, functionLabels[api]))
	}
	return kit.Store("start work function", err)
}

// recordMember raises the policy version when the rights of the person change and records the audit.
func (h *Handler) recordMember(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, m memberRow, c memberChange) error {
	if c.rights() {
		if _, err := kit.BumpPolicy(ctx, tx, tc.TenantID, []uuid.UUID{m.id}, c.action()); err != nil {
			return err
		}
	}
	diff := map[string]any{}
	if c.status != "" {
		diff["status"] = c.status
		diff["sessionsRevoked"] = c.sessions
	}
	if c.moved {
		diff["orgUnitId"] = m.home
	}
	if len(c.added) > 0 || len(c.ended) > 0 {
		diff["workProfilesAdded"], diff["workProfilesEnded"] = c.added, c.ended
	}
	return kit.Audit(ctx, tx, kit.Change{Action: c.action(), TargetType: targetMember, TargetID: m.id, UnitID: m.home, Diff: diff})
}

// memberAPI is the Member of the contract for m with its work functions active at now (getMember of W1.05).
func memberAPI(ctx context.Context, tx pgx.Tx, m memberRow, now time.Time) (accessapi.Member, error) {
	rows, err := tx.Query(ctx, `select distinct function from people.work_profiles where person_id = $1 and valid @> $2::timestamptz
		order by 1`, m.id, now)
	if err != nil {
		return accessapi.Member{}, kit.Store("work functions", err)
	}
	fns, err := pgx.CollectRows(rows, pgx.RowTo[string])
	if err != nil {
		return accessapi.Member{}, kit.Store("work functions", err)
	}
	out := accessapi.Member{Id: m.id, DisplayName: m.name, Status: m.apiStatus(), OrgUnitIds: []uuid.UUID{m.home},
		Revision: m.revision, WorkProfiles: []accessapi.MemberWorkProfiles{}}
	if m.email != nil && *m.email != "" {
		orgkit.SetString(&out.Email, *m.email)
	}
	if m.membership != nil {
		account := m.account
		out.UserId = &account
	}
	for _, f := range fns {
		if api, ok := orgkit.FunctionFromDB(f); ok {
			out.WorkProfiles = append(out.WorkProfiles, accessapi.MemberWorkProfiles(api))
		}
	}
	return out, nil
}
