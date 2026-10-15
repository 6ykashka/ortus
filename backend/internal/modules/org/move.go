package org

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// maxAffected is the length limit of OrgUnitMovePreview.affectedPeople.
const maxAffected = 50

// movePerson is a person an assignment reaches (directly or through a group); Visible — within members.read of
// the actor.
type movePerson struct {
	ID      uuid.UUID
	Name    string
	Visible bool
}

// moveAssignment is an active assignment with descendants on Unit and the people it reaches.
type moveAssignment struct {
	ID, RoleID, Unit uuid.UUID
	People           []movePerson
}

// moveImpact is what a move changes: assignments that stop and start covering the subtree, the people listed
// (visible ones, at most maxAffected entries) and the number of distinct people not listed.
type moveImpact struct {
	Losing, Gaining int64
	People          []accessapi.OrgUnitMoveImpact
	Hidden          int64
}

// impactOf computes the impact of a move. before — the old parent and its ancestors, after — the new parent and
// its ancestors (nil: the top level). An assignment on an old ancestor that is not a new one stops covering the
// subtree (loses), and the other way round (gains); assignments inside the subtree move with it and are never in
// before or after. Totals count only assignments that reach at least one visible person (Q-W1.00-15): the number
// of assignments of hidden people is not disclosed, they are counted in Hidden as people, once each.
func impactOf(before, after []uuid.UUID, as []moveAssignment) moveImpact {
	inBefore, inAfter := setOf(before), setOf(after)
	out := moveImpact{}
	var entries []accessapi.OrgUnitMoveImpact
	hidden := map[uuid.UUID]bool{}
	sides := []struct {
		change   accessapi.OrgUnitMoveImpactChange
		from, to map[uuid.UUID]bool
		total    *int64
	}{
		{accessapi.Loses, inBefore, inAfter, &out.Losing},
		{accessapi.Gains, inAfter, inBefore, &out.Gaining},
	}
	for _, side := range sides {
		for _, a := range as {
			if !side.from[a.Unit] || side.to[a.Unit] {
				continue
			}
			counted := false
			for _, p := range a.People {
				if !p.Visible {
					hidden[p.ID] = true
					continue
				}
				counted = true
				entries = append(entries, accessapi.OrgUnitMoveImpact{
					MemberId: p.ID, DisplayName: p.Name, Change: side.change, RoleId: a.RoleID, AssignmentId: a.ID,
				})
			}
			if counted {
				*side.total++
			}
		}
	}
	n := min(len(entries), maxAffected)
	out.People = append([]accessapi.OrgUnitMoveImpact{}, entries[:n]...)
	shown := map[uuid.UUID]bool{}
	for _, e := range out.People {
		shown[e.MemberId] = true
	}
	for _, e := range entries[n:] {
		if !shown[e.MemberId] {
			hidden[e.MemberId] = true
		}
	}
	out.Hidden = int64(len(hidden))
	return out
}

func setOf(ids []uuid.UUID) map[uuid.UUID]bool {
	out := make(map[uuid.UUID]bool, len(ids))
	for _, id := range ids {
		out[id] = true
	}
	return out
}

// querier is a pool or a transaction.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// ancestorsOf returns unit and its ancestors (nil for the top level).
func ancestorsOf(ctx context.Context, q querier, unit *uuid.UUID) ([]uuid.UUID, error) {
	if unit == nil {
		return nil, nil
	}
	rows, err := q.Query(ctx, `select ancestor_id from org.unit_closure where descendant_id = $1 order by depth`, *unit)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
}

// inSubtree reports whether unit lies in the subtree of root (root included).
func inSubtree(ctx context.Context, q querier, root, unit uuid.UUID) (bool, error) {
	var in bool
	err := q.QueryRow(ctx, `select exists (select 1 from org.unit_closure where ancestor_id = $1 and descendant_id = $2)`,
		root, unit).Scan(&in)
	return in, err
}

// assignmentsSQL: active, not expired at $2 assignments with descendants on the units $1, of live roles and groups,
// with the people they reach (a group — its members); a group without members gives one row without a person.
const assignmentsSQL = `
select ra.id, ra.role_id, ra.scope_ref, p.id, p.full_name
  from access.role_assignments ra
  join access.roles r on r.id = ra.role_id and r.archived_at is null
  left join lateral (
        select pp.id, pp.full_name from people.person_profiles pp
         where pp.archived_at is null
           and ((ra.principal_kind = 'person' and pp.id = ra.principal_id)
             or (ra.principal_kind = 'group'
                 and pp.id in (select gm.person_id from access.group_members gm where gm.group_id = ra.principal_id)))
       ) p on true
 where ra.state = 'active' and ra.scope_kind = 'unit' and ra.include_descendants
   and ra.scope_ref = any($1) and (upper(ra.valid) is null or upper(ra.valid) > $2)
   and not exists (select 1 from access.groups g
                    where ra.principal_kind = 'group' and g.id = ra.principal_id and g.archived_at is not null)
 order by ra.created_at, ra.id, p.full_name, p.id`

// loadAssignments reads the assignments on units with the people they reach; every person is visible until
// marked otherwise.
func loadAssignments(ctx context.Context, q querier, units []uuid.UUID, now time.Time) ([]moveAssignment, error) {
	if len(units) == 0 {
		return nil, nil
	}
	rows, err := q.Query(ctx, assignmentsSQL, units, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []moveAssignment
	for rows.Next() {
		var (
			a      moveAssignment
			person *uuid.UUID
			name   *string
		)
		if err := rows.Scan(&a.ID, &a.RoleID, &a.Unit, &person, &name); err != nil {
			return nil, err
		}
		if len(out) == 0 || out[len(out)-1].ID != a.ID {
			out = append(out, a)
		}
		if person != nil && name != nil {
			last := &out[len(out)-1]
			last.People = append(last.People, movePerson{ID: *person, Name: *name, Visible: true})
		}
	}
	return out, rows.Err()
}

// markVisible keeps Visible only for the people the actor sees with members.read.
func markVisible(ctx context.Context, c *scopeddb.Conn, as []moveAssignment) error {
	var ids []uuid.UUID
	for _, a := range as {
		for _, p := range a.People {
			ids = append(ids, p.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := c.Query(ctx, actionPeople, people,
		`select p.id from people.person_profiles p where p.id = any($1) and {{scope}}`, ids)
	if err != nil {
		return err
	}
	seen, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return err
	}
	visible := setOf(seen)
	for i := range as {
		for j := range as[i].People {
			as[i].People[j].Visible = visible[as[i].People[j].ID]
		}
	}
	return nil
}

// impactAt reads both ancestor chains and the assignments on them and computes the impact of moving the subtree
// from oldParent to newParent.
func impactAt(ctx context.Context, q querier, oldParent, newParent *uuid.UUID, now time.Time) ([]uuid.UUID, []uuid.UUID, []moveAssignment, error) {
	before, err := ancestorsOf(ctx, q, oldParent)
	if err != nil {
		return nil, nil, nil, err
	}
	after, err := ancestorsOf(ctx, q, newParent)
	if err != nil {
		return nil, nil, nil, err
	}
	as, err := loadAssignments(ctx, q, append(append([]uuid.UUID{}, before...), after...), now)
	return before, after, as, err
}

// PreviewOrgUnitMove implements accessapi.StrictServerInterface: the read-only impact of moving a unit under
// parentId (absent — the top level). The actor manages the moved unit (else 404) and both parents (else 403); a
// parent the actor cannot see is the same 422 as an unknown one; a cycle is 422.
func (s *Server) PreviewOrgUnitMove(ctx context.Context, req accessapi.PreviewOrgUnitMoveRequestObject) (accessapi.PreviewOrgUnitMoveResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	c, err := s.conn(ctx, tc)
	if err != nil {
		return nil, err
	}
	var unit unitRow
	if err := c.One(ctx, actionManage, units, func(r pgx.Row) error {
		var err error
		unit, err = scanUnit(r)
		return err
	}, unitSelect+` where u.id = $1 and {{scope}}`, req.OrgUnitId); err != nil {
		return nil, dbError(err)
	}
	parent := req.Params.ParentId
	if parent != nil {
		if _, err := s.visibleUnit(ctx, c, *parent, textUnknownUnit); err != nil {
			return nil, dbError(err)
		}
	}
	if err := s.mayManageParent(ctx, tc, unit.Parent); err != nil {
		return nil, err
	}
	if err := s.mayManageParent(ctx, tc, parent); err != nil {
		return nil, err
	}
	body, err := s.preview(ctx, tc, c, unit, parent)
	if err != nil {
		return nil, dbError(err)
	}
	return accessapi.PreviewOrgUnitMove200JSONResponse{
		Body: body, Headers: accessapi.PreviewOrgUnitMove200ResponseHeaders{CacheControl: noStore(), XRequestId: rid(ctx)},
	}, nil
}

func (s *Server) preview(ctx context.Context, tc tenantctx.TenantContext, c *scopeddb.Conn, unit unitRow, parent *uuid.UUID) (accessapi.OrgUnitMovePreview, error) {
	var out accessapi.OrgUnitMovePreview
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return out, err
	}
	if parent != nil {
		cycle, err := inSubtree(ctx, pool, unit.ID, *parent)
		if err != nil {
			return out, err
		}
		if cycle {
			return out, kit.Invalid(textCyclePreview)
		}
	}
	before, after, as, err := impactAt(ctx, pool, unit.Parent, parent, s.now())
	if err != nil {
		return out, err
	}
	if err := markVisible(ctx, c, as); err != nil {
		return out, err
	}
	imp := impactOf(before, after, as)
	out = accessapi.OrgUnitMovePreview{
		OrgUnitId: unit.ID, FromParentId: unit.Parent, ToParentId: parent,
		AssignmentsLosingScope: imp.Losing, AssignmentsGainingScope: imp.Gaining,
		AffectedPeople: imp.People, HiddenCount: imp.Hidden,
	}
	if err := pool.QueryRow(ctx, `select count(*) from org.unit_closure where ancestor_id = $1 and depth > 0`, unit.ID).
		Scan(&out.DescendantUnitCount); err != nil {
		return out, err
	}
	// People with their home in the subtree, among those the actor sees (no count of hidden people).
	err = c.QueryRow(ctx, actionPeople, people, `select count(*) from people.person_profiles p
		where p.archived_at is null
		  and p.home_unit_id in (select descendant_id from org.unit_closure where ancestor_id = $1)
		  and {{scope}}`, unit.ID).Scan(&out.MemberCount)
	return out, err
}

// applyPatch changes the unit id in tx by If-Match: a move, a rename, an archive or a restore. A move takes the
// lock of the tree before the lock of its unit (lockTree).
func (s *Server) applyPatch(ctx context.Context, tc tenantctx.TenantContext, tx pgx.Tx, id uuid.UUID, ifMatch string, patch accessapi.OrgUnitPatch) (unitRow, error) {
	if patch.ParentId != nil {
		if err := lockTree(ctx, tx, true); err != nil {
			return unitRow{}, err
		}
	}
	cur, err := scanUnit(tx.QueryRow(ctx, unitSelect+` where u.id = $1 for update`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return unitRow{}, problem.New(problem.CodeNotFound, "")
	}
	if err != nil {
		return unitRow{}, err
	}
	if err := kit.CheckRevision(ifMatch, cur.Revision); err != nil {
		return unitRow{}, err
	}
	next, err := s.plan(ctx, tc, tx, cur, patch)
	if err != nil {
		return unitRow{}, err
	}
	u, err := scanUnit(tx.QueryRow(ctx, `update org.units
		set parent_id = $2, name = $3,
		    archived_at = case when $4 then coalesce(archived_at, $5) end,
		    revision = revision + 1
		where id = $1
		returning id, parent_id, name, kind, archived_at is not null, revision`,
		cur.ID, next.Parent, next.Name, next.Archived, s.now()))
	if err != nil {
		return unitRow{}, err
	}
	return u, auditPatch(ctx, tx, cur, u)
}

// plan checks the patch against the locked unit cur and returns its next state; a move is applied to the closure.
func (s *Server) plan(ctx context.Context, tc tenantctx.TenantContext, tx pgx.Tx, cur unitRow, patch accessapi.OrgUnitPatch) (unitRow, error) {
	next := cur
	moved := patch.ParentId != nil && (cur.Parent == nil || *cur.Parent != *patch.ParentId)
	if moved {
		if err := s.move(ctx, tc, tx, cur, *patch.ParentId); err != nil {
			return unitRow{}, err
		}
		next.Parent = patch.ParentId
	}
	if patch.Name != nil {
		next.Name = *patch.Name
	}
	if patch.Status != nil {
		next.Archived = *patch.Status == accessapi.OrgUnitPatchStatusArchived
	}
	return next, checkNext(ctx, tx, cur, next, moved)
}

// checkNext checks the next state of the unit cur: a free name after a move, a rename or a restore; a restore
// follows the rules of a new unit (an active parent — a move has checked its new one); an archive needs an idle unit.
func checkNext(ctx context.Context, tx pgx.Tx, cur, next unitRow, moved bool) error {
	restored := cur.Archived && !next.Archived
	if restored && !moved {
		if err := activeParent(ctx, tx, next.Parent); err != nil {
			return err
		}
	}
	if moved || restored || next.Name != cur.Name {
		if err := checkName(ctx, tx, next); err != nil {
			return err
		}
	}
	if next.Archived && !cur.Archived {
		return checkIdle(ctx, tx, cur.ID)
	}
	return nil
}

// activeParent locks the parent in tx against an archive and refuses an archived one (nil: the top level).
func activeParent(ctx context.Context, tx pgx.Tx, parent *uuid.UUID) error {
	if parent == nil {
		return nil
	}
	var archived bool
	if err := tx.QueryRow(ctx, `select archived_at is not null from org.units where id = $1 for share`, *parent).Scan(&archived); err != nil {
		return err
	}
	if archived {
		return kit.Invalid(textParentArchive)
	}
	return nil
}

// checkName refuses the name of an active sibling of u under its (new) parent.
func checkName(ctx context.Context, tx pgx.Tx, u unitRow) error {
	if err := lockParent(ctx, tx, u.Parent); err != nil {
		return err
	}
	taken, err := nameTaken(ctx, tx, u.Parent, u.Name, u.ID)
	if err != nil {
		return err
	}
	if taken {
		return kit.Invalid(textNameTaken)
	}
	return nil
}

// auditPatch writes one audit row per change of the unit (the move is audited by move with its impact).
func auditPatch(ctx context.Context, tx pgx.Tx, before, after unitRow) error {
	if after.Name != before.Name {
		if err := kit.Audit(ctx, tx, audit.Event{Action: "org.unit.rename", TargetType: targetUnit, TargetID: after.ID,
			UnitID: after.ID, Diff: map[string]any{"from": before.Name, "to": after.Name}}); err != nil {
			return err
		}
	}
	if after.Archived != before.Archived {
		action := "org.unit.archive"
		if !after.Archived {
			action = "org.unit.restore"
		}
		return kit.Audit(ctx, tx, audit.Event{Action: action, TargetType: targetUnit, TargetID: after.ID, UnitID: after.ID})
	}
	return nil
}

// checkIdle refuses to archive a unit with active children or people with their home in it.
func checkIdle(ctx context.Context, tx pgx.Tx, id uuid.UUID) error {
	var busy bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from org.units where parent_id = $1 and archived_at is null)
		or exists (select 1 from people.person_profiles where home_unit_id = $1 and archived_at is null)`, id).Scan(&busy); err != nil {
		return err
	}
	if busy {
		return kit.Conflict(textBusy)
	}
	return nil
}

// move puts the subtree of cur under parent in tx: org_units.manage over both parents, no cycle, the closure of
// the subtree rebuilt, policy_version raised and the impact audited.
func (s *Server) move(ctx context.Context, tc tenantctx.TenantContext, tx pgx.Tx, cur unitRow, parent uuid.UUID) error {
	if err := s.mayManageParent(ctx, tc, cur.Parent); err != nil {
		return err
	}
	var archived bool
	err := tx.QueryRow(ctx, `select archived_at is not null from org.units where id = $1 for share`, parent).Scan(&archived)
	switch {
	case errors.Is(err, pgx.ErrNoRows): // deleted after the check of visibility in UpdateOrgUnit
		return kit.Invalid(textUnknownParent)
	case err != nil:
		return err
	case archived:
		return kit.Invalid(textParentArchive)
	}
	if err := s.mayManageParent(ctx, tc, &parent); err != nil {
		return err
	}
	cycle, err := inSubtree(ctx, tx, cur.ID, parent)
	if err != nil {
		return err
	}
	if cycle {
		return kit.Conflict(textCycle)
	}
	before, after, as, err := impactAt(ctx, tx, cur.Parent, &parent, s.now())
	if err != nil {
		return err
	}
	imp := impactOf(before, after, as) // every person counts in the audit
	if _, err := tx.Exec(ctx, `delete from org.unit_closure c
		where c.descendant_id in (select descendant_id from org.unit_closure where ancestor_id = $1)
		  and c.ancestor_id not in (select descendant_id from org.unit_closure where ancestor_id = $1)`, cur.ID); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `insert into org.unit_closure (ancestor_id, descendant_id, depth)
		select a.ancestor_id, d.descendant_id, a.depth + d.depth + 1
		  from org.unit_closure a cross join org.unit_closure d
		 where a.descendant_id = $2 and d.ancestor_id = $1`, cur.ID, parent); err != nil {
		return err
	}
	if err := kit.BumpPolicy(ctx, tx); err != nil {
		return err
	}
	return kit.Audit(ctx, tx, audit.Event{
		Action: "org.unit.move", TargetType: targetUnit, TargetID: cur.ID, UnitID: cur.ID,
		Diff: map[string]any{
			"fromParentId": cur.Parent, "toParentId": parent,
			"assignmentsLosingScope": imp.Losing, "assignmentsGainingScope": imp.Gaining,
		},
	})
}
