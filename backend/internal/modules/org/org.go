// Package org is the organization structure of a tenant (W1.05, S1-08): regions, companies, branches and teams
// (org.units), their transitive closure (org.unit_closure) and the impact of moving a unit on access. A unit grant
// with descendants covers the subtree of its unit, so a move changes who reaches the moved subtree: the preview
// (previewOrgUnitMove) lists it before the move, the move (updateOrgUnit) rebuilds the closure in its transaction,
// raises policy_version and writes the audit.
//
// Reads go through scopeddb (scopeQuery of org_units.read or org_units.manage over the unit itself); commands
// authorize with the evaluator first (W1.04). A unit the actor cannot see answers like a missing one (AC-01).
package org

import (
	"context"
	"errors"
	"strings"
	"time"
	"unicode/utf8"

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
	actionRead   = "org_units.read"
	actionManage = "org_units.manage"
	actionPeople = "members.read"
)

// targetUnit is the target type of the audit rows of a unit.
const targetUnit = "org.unit"

// defaultTimeZone is the zone of a unit at the top level (a child takes the zone of its parent).
const defaultTimeZone = "Europe/Moscow"

// maxName is the length limit of a unit name (OrgUnitCreate.name).
const maxName = 150

// Texts of the answers (no reference screen: company-structure is no-reference, B-6) — the texts of the mock
// (MSW access/units.ts, access/people.ts) and of the contract examples where they have one.
const (
	textUnknownUnit   = "Подразделение не найдено."              // previewOrgUnitMove (people.ts)
	textUnknownParent = "Родительское подразделение не найдено." // createOrgUnit, updateOrgUnit (units.ts)
	textNameRequired  = "Укажите название (до 150 символов)."
	textNameTaken     = "Подразделение с таким названием уже есть."
	textParentArchive = "Родительское подразделение в архиве."
	textCycle         = "Подразделение нельзя перенести внутрь самого себя." // updateOrgUnit, 409 (units.ts)
	textCyclePreview  = "Нельзя перенести подразделение внутрь самого себя." // previewOrgUnitMove, 422 (example)
	textBusy          = "В подразделении есть участники или действующие подразделения."
)

// units are the columns the scope predicate filters org.units on: a unit is in its own scope.
var units = authz.Columns{Unit: "u.id"}

// people are the columns of person profiles: the home unit, and the person itself for the scope self.
var people = authz.Columns{Unit: "p.home_unit_id", Persons: []string{"p.id"}}

// Server implements the operations of the organization structure of the tag Access.
type Server struct {
	Pools kit.Pools
	Authz kit.Authorizer
	Now   func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
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

// unitRow is a row of org.units.
type unitRow struct {
	ID       uuid.UUID
	Parent   *uuid.UUID
	Name     string
	Kind     string
	Archived bool
	Revision int64
}

const unitSelect = `select u.id, u.parent_id, u.name, u.kind, u.archived_at is not null, u.revision from org.units u`

func scanUnit(row pgx.Row) (unitRow, error) {
	var u unitRow
	err := row.Scan(&u.ID, &u.Parent, &u.Name, &u.Kind, &u.Archived, &u.Revision)
	return u, err
}

func (u unitRow) dto() accessapi.OrgUnit {
	status := accessapi.OrgUnitStatusActive
	if u.Archived {
		status = accessapi.OrgUnitStatusArchived
	}
	return accessapi.OrgUnit{
		Id: u.ID, ParentId: u.Parent, Name: u.Name, Kind: accessapi.OrgUnitKind(u.Kind), Status: status, Revision: u.Revision,
	}
}

// cleanName trims a unit name and checks its length.
func cleanName(name string) (string, error) {
	n := strings.TrimSpace(name)
	if n == "" || utf8.RuneCountInString(n) > maxName {
		return "", kit.Invalid(textNameRequired)
	}
	return n, nil
}

// validKind reports whether kind is a kind of the contract and of org.units.
func validKind(kind string) bool {
	switch accessapi.OrgUnitKind(kind) {
	case accessapi.OrgUnitKindRegion, accessapi.OrgUnitKindCompany, accessapi.OrgUnitKindBranch, accessapi.OrgUnitKindTeam:
		return true
	}
	return false
}

// mayManageParent checks org_units.manage over a parent (nil — the top level: over the whole tenant). The parent
// is checked as a place, not as an object to show: a denial is 403 forbidden_action.
func (s *Server) mayManageParent(ctx context.Context, tc tenantctx.TenantContext, parent *uuid.UUID) error {
	r := authz.Resource{}
	if parent != nil {
		r.Unit = *parent
	}
	err := s.Authz.Permit(ctx, tc, actionManage, r)
	if problem.Is(err, problem.CodeNotFound) {
		return problem.New(problem.CodeForbiddenAction, "")
	}
	return err
}

// visibleUnit returns the unit id if the actor sees it (org_units.read); unknown and invisible units are the same
// 422 validation_failed with the text unknown (AC-01: no difference between a missing and a hidden unit).
func (s *Server) visibleUnit(ctx context.Context, c *scopeddb.Conn, id uuid.UUID, unknown string) (unitRow, error) {
	var u unitRow
	err := c.One(ctx, actionRead, units, func(r pgx.Row) error {
		var err error
		u, err = scanUnit(r)
		return err
	}, unitSelect+` where u.id = $1 and {{scope}}`, id)
	if problem.Is(err, problem.CodeNotFound) {
		return unitRow{}, kit.Invalid(unknown)
	}
	return u, err
}

// hideParents clears the parent of the units whose parent the actor cannot see (org_units.read): an invisible unit
// is not disclosed, not even by its id (AC-01); such a unit is a root of the tree the actor sees.
func hideParents(ctx context.Context, c *scopeddb.Conn, us []unitRow) error {
	var parents []uuid.UUID
	for _, u := range us {
		if u.Parent != nil {
			parents = append(parents, *u.Parent)
		}
	}
	if len(parents) == 0 {
		return nil
	}
	rows, err := c.Query(ctx, actionRead, units, `select u.id from org.units u where u.id = any($1) and {{scope}}`, parents)
	if err != nil {
		return err
	}
	seen, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return err
	}
	visible := make(map[uuid.UUID]bool, len(seen))
	for _, id := range seen {
		visible[id] = true
	}
	for i := range us {
		if us[i].Parent != nil && !visible[*us[i].Parent] {
			us[i].Parent = nil
		}
	}
	return nil
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

// treeKey is the advisory lock of the tree of a tenant (one tenant — one database).
const treeKey = "org.units:tree"

// lockTree serializes the changes of the closure: a move takes the lock of the tree exclusively before it locks its
// unit, a new unit takes it shared before anything else. Two moves never check the cycle on stale closures (A under
// a descendant of B while B moves under a descendant of A), and a unit created under a moving subtree never keeps
// the old ancestors.
func lockTree(ctx context.Context, tx pgx.Tx, exclusive bool) error {
	q := `select pg_advisory_xact_lock_shared(hashtextextended($1, 0))`
	if exclusive {
		q = `select pg_advisory_xact_lock(hashtextextended($1, 0))`
	}
	_, err := tx.Exec(ctx, q, treeKey)
	return err
}

// lockParent serializes changes among the children of a parent (a unique name among siblings has no index).
func lockParent(ctx context.Context, tx pgx.Tx, parent *uuid.UUID) error {
	key := "org.units:top"
	if parent != nil {
		key = "org.units:" + parent.String()
	}
	_, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, key)
	return err
}

// nameTaken reports whether an active sibling under parent has the name (case-insensitive), except unit self.
func nameTaken(ctx context.Context, tx pgx.Tx, parent *uuid.UUID, name string, self uuid.UUID) (bool, error) {
	var taken bool
	err := tx.QueryRow(ctx, `select exists (select 1 from org.units
		where parent_id is not distinct from $1 and archived_at is null and lower(name) = lower($2) and id <> $3)`,
		parent, name, self).Scan(&taken)
	return taken, err
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
