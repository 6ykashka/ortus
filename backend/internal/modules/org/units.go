package org

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// listSQL pages the units the actor sees by (name, id); $1, $2 — the keyset position or null, $3 — the page size.
const listSQL = unitSelect + `
 where {{scope}} and ($1::text is null or (u.name, u.id) > ($1::text, $2::uuid))
 order by u.name, u.id
 limit $3`

// ListOrgUnits implements accessapi.StrictServerInterface: the units in the scope of org_units.read.
func (s *Server) ListOrgUnits(ctx context.Context, req accessapi.ListOrgUnitsRequestObject) (accessapi.ListOrgUnitsResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	limit, err := kit.PageLimit(req.Params.Limit)
	if err != nil {
		return nil, err
	}
	var afterName, afterID *string
	if req.Params.Cursor != nil {
		keys, err := kit.DecodeCursor(*req.Params.Cursor, 2)
		if err != nil {
			return nil, err
		}
		if _, err := uuid.Parse(keys[1]); err != nil {
			return nil, problem.Wrap(problem.CodeMalformedRequest, err)
		}
		afterName, afterID = &keys[0], &keys[1]
	}
	c, err := s.conn(ctx, tc)
	if err != nil {
		return nil, err
	}
	rows, err := c.Query(ctx, actionRead, units, listSQL, afterName, afterID, limit+1)
	if err != nil {
		return nil, dbError(err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (unitRow, error) { return scanUnit(r) })
	if err != nil {
		return nil, dbError(err)
	}
	if err := hideParents(ctx, c, list); err != nil {
		return nil, dbError(err)
	}
	page := accessapi.OrgUnitPage{Items: make([]accessapi.OrgUnit, 0, min(len(list), limit))}
	for i, u := range list {
		if i == limit {
			last := list[limit-1]
			next := kit.EncodeCursor(last.Name, last.ID.String())
			page.NextCursor = &next
			break
		}
		page.Items = append(page.Items, u.dto())
	}
	return accessapi.ListOrgUnits200JSONResponse{
		Body: page, Headers: accessapi.ListOrgUnits200ResponseHeaders{CacheControl: noStore(), XRequestId: rid(ctx)},
	}, nil
}

// GetOrgUnit implements accessapi.StrictServerInterface: a unit in the scope of org_units.read, else 404.
func (s *Server) GetOrgUnit(ctx context.Context, req accessapi.GetOrgUnitRequestObject) (accessapi.GetOrgUnitResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	c, err := s.conn(ctx, tc)
	if err != nil {
		return nil, err
	}
	var u unitRow
	err = c.One(ctx, actionRead, units, func(r pgx.Row) error {
		var err error
		u, err = scanUnit(r)
		return err
	}, unitSelect+` where u.id = $1 and {{scope}}`, req.OrgUnitId)
	if err != nil {
		return nil, dbError(err)
	}
	one := []unitRow{u}
	if err := hideParents(ctx, c, one); err != nil {
		return nil, dbError(err)
	}
	u = one[0]
	tag := kit.ETag(u.Revision)
	return accessapi.GetOrgUnit200JSONResponse{
		Body: u.dto(), Headers: accessapi.GetOrgUnit200ResponseHeaders{CacheControl: noStore(), ETag: &tag, XRequestId: rid(ctx)},
	}, nil
}

// CreateOrgUnit implements accessapi.StrictServerInterface: a unit under a parent the actor manages (the top level
// needs org_units.manage over the whole tenant). The zone is the parent's; the closure gets the unit and its
// ancestors.
func (s *Server) CreateOrgUnit(ctx context.Context, req accessapi.CreateOrgUnitRequestObject) (accessapi.CreateOrgUnitResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil || !validKind(string(req.Body.Kind)) {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	name, err := cleanName(req.Body.Name)
	if err != nil {
		return nil, err
	}
	parent := req.Body.ParentId
	if parent != nil {
		c, err := s.conn(ctx, tc)
		if err != nil {
			return nil, err
		}
		if _, err := s.visibleUnit(ctx, c, *parent, textUnknownParent); err != nil {
			return nil, dbError(err)
		}
	}
	if err := s.mayManageParent(ctx, tc, parent); err != nil {
		return nil, err
	}
	var u unitRow
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		var err error
		if u, err = insertUnit(ctx, tx, parent, name, string(req.Body.Kind)); err != nil {
			return err
		}
		if err := kit.Audit(ctx, tx, audit.Event{
			Action: "org.unit.create", TargetType: targetUnit, TargetID: u.ID, UnitID: u.ID,
			Diff: map[string]any{"name": u.Name, "kind": u.Kind, "parentId": u.Parent},
		}); err != nil {
			return err
		}
		return kit.Complete(ctx, tx, http.StatusCreated, kit.ETag(u.Revision), u.dto())
	})
	if err != nil {
		return nil, dbError(err)
	}
	tag, replayed := kit.ETag(u.Revision), false
	return accessapi.CreateOrgUnit201JSONResponse{
		Body: u.dto(),
		Headers: accessapi.CreateOrgUnit201ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}

// insertUnit adds a unit and its closure rows in tx.
func insertUnit(ctx context.Context, tx pgx.Tx, parent *uuid.UUID, name, kind string) (unitRow, error) {
	if err := lockTree(ctx, tx, false); err != nil {
		return unitRow{}, err
	}
	if err := lockParent(ctx, tx, parent); err != nil {
		return unitRow{}, err
	}
	zone := defaultTimeZone
	if parent != nil {
		var archived bool
		err := tx.QueryRow(ctx, `select time_zone, archived_at is not null from org.units where id = $1 for share`, *parent).
			Scan(&zone, &archived)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return unitRow{}, kit.Invalid(textUnknownParent)
		case err != nil:
			return unitRow{}, err
		case archived:
			return unitRow{}, kit.Invalid(textParentArchive)
		}
	}
	taken, err := nameTaken(ctx, tx, parent, name, uuid.Nil)
	if err != nil {
		return unitRow{}, err
	}
	if taken {
		return unitRow{}, kit.Invalid(textNameTaken)
	}
	u, err := scanUnit(tx.QueryRow(ctx, `insert into org.units (parent_id, kind, name, time_zone) values ($1, $2, $3, $4)
		returning id, parent_id, name, kind, archived_at is not null, revision`, parent, kind, name, zone))
	if err != nil {
		return unitRow{}, err
	}
	_, err = tx.Exec(ctx, `insert into org.unit_closure (ancestor_id, descendant_id, depth)
		select $1::uuid, $1::uuid, 0
		union all
		select ancestor_id, $1::uuid, depth + 1 from org.unit_closure where descendant_id = $2`, u.ID, parent)
	return u, err
}

// UpdateOrgUnit implements accessapi.StrictServerInterface: rename, move, archive or restore a unit the actor
// manages, by If-Match. A move needs org_units.manage over the old and the new parent (a new parent the actor cannot
// see is the same 422 as an unknown one), rebuilds the closure of the subtree and raises policy_version; archiving a
// unit with people or active children is 409; a restore needs a free name and an active parent. The answer hides a
// parent the actor cannot see, as getOrgUnit does.
//
// OrgUnitPatch.parentId null and absent decode the same (generated pointer): null does not move to the top level.
func (s *Server) UpdateOrgUnit(ctx context.Context, req accessapi.UpdateOrgUnitRequestObject) (accessapi.UpdateOrgUnitResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	patch := *req.Body
	if patch.Name != nil {
		name, err := cleanName(*patch.Name)
		if err != nil {
			return nil, err
		}
		patch.Name = &name
	}
	if err := s.Authz.Permit(ctx, tc, actionManage, authz.Resource{Unit: req.OrgUnitId, ReadAction: actionRead}); err != nil {
		return nil, err
	}
	c, err := s.conn(ctx, tc)
	if err != nil {
		return nil, err
	}
	if patch.ParentId != nil {
		if _, err := s.visibleUnit(ctx, c, *patch.ParentId, textUnknownParent); err != nil {
			return nil, dbError(err)
		}
	}
	var u unitRow
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		var err error
		if u, err = s.applyPatch(ctx, tc, tx, req.OrgUnitId, req.Params.IfMatch, patch); err != nil {
			return err
		}
		// The visibility of the parent does not depend on this transaction: the ancestors of a parent never change
		// with a move of its child (a cycle is refused).
		one := []unitRow{u}
		if err := hideParents(ctx, c, one); err != nil {
			return err
		}
		u = one[0]
		return kit.Complete(ctx, tx, http.StatusOK, kit.ETag(u.Revision), u.dto())
	})
	if err != nil {
		return nil, dbError(err)
	}
	tag, replayed := kit.ETag(u.Revision), false
	return accessapi.UpdateOrgUnit200JSONResponse{
		Body: u.dto(),
		Headers: accessapi.UpdateOrgUnit200ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}
