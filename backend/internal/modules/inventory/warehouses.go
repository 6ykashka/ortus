package inventory

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	api "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the answers (B-6: no screen in the prototype; plain Russian of the module).
const (
	textWarehouseNotFound = "Склад не найден."
	textItemNotFound      = "Позиция не найдена."
	textUnitNotFound      = "Подразделение не найдено."
	textNameRequired      = "Укажите название."
	textNameLong          = "Название — не длиннее 150 символов."
	textWarehouseTaken    = "Склад с таким названием в подразделении уже есть."
	textCodeLong          = "Код — не длиннее 32 символов."
)

// Audit targets of the module.
const (
	targetWarehouse   = "inventory.warehouse"
	targetItem        = "inventory.item"
	targetMovement    = "inventory.movement"
	targetReservation = "inventory.reservation"
)

// warehouseColumns are the columns of the scope predicate over inventory.warehouses w: the unit of the warehouse
// and the warehouse itself (scope kinds unit and warehouse).
var warehouseColumns = authz.Columns{Unit: "w.org_unit_id", Objects: map[string]string{kindWarehouse: "w.id"}}

func tenant(ctx context.Context) (tenantctx.TenantContext, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return tenantctx.TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	return tc, nil
}

// isUnique reports whether err is a violation of a unique index.
func isUnique(err error) bool {
	pe, ok := errors.AsType[*pgconn.PgError](err)
	return ok && pe.Code == "23505"
}

func recordAudit(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, action, target string, id, unit uuid.UUID, diff map[string]any) error {
	err := audit.Record(ctx, tx, audit.Event{ActorKind: audit.ActorPerson, ActorID: tc.PersonID, Action: action, TargetType: target,
		TargetID: id, UnitID: unit, Result: audit.OK, RequestID: requestID(ctx), Diff: diff})
	if err != nil {
		return fmt.Errorf("inventory: audit: %w", err)
	}
	return nil
}

// unitExists reports whether the org unit is there.
func unitExists(ctx context.Context, tx pgx.Tx, id uuid.UUID) (bool, error) {
	var ok bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from org.units where id = $1)`, id).Scan(&ok); err != nil {
		return false, fmt.Errorf("inventory: unit: %w", err)
	}
	return ok, nil
}

func cleanName(name string) (string, error) {
	n := strings.TrimSpace(name)
	switch {
	case n == "":
		return "", invalid("name", textNameRequired)
	case utf8.RuneCountInString(n) > 150:
		return "", invalid("name", textNameLong)
	}
	return n, nil
}

// CreateWarehouse creates a warehouse of an org unit (createWarehouse): inventory.warehouses.manage over the unit, a
// name unique within the unit.
func (s *Service) CreateWarehouse(ctx context.Context, tc tenantctx.TenantContext, b api.WarehouseCreate) (api.Warehouse, error) {
	name, err := cleanName(b.Name)
	if err != nil {
		return api.Warehouse{}, err
	}
	var code *string
	if b.Code != nil {
		c := strings.TrimSpace(*b.Code)
		if utf8.RuneCountInString(c) > 32 {
			return api.Warehouse{}, invalid("code", textCodeLong)
		}
		if c != "" {
			code = &c
		}
	}
	var out api.Warehouse
	err = s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		if err := ev.Permit(ctx, tc, actWarehousesManage, authz.Resource{Unit: b.OrgUnitId, ReadAction: actItemsRead}); err != nil {
			return err
		}
		if ok, err := unitExists(ctx, tx, b.OrgUnitId); err != nil {
			return err
		} else if !ok {
			return invalid("orgUnitId", textUnitNotFound)
		}
		var taken bool
		if err := tx.QueryRow(ctx, `select exists (select 1 from inventory.warehouses where org_unit_id = $1 and lower(btrim(name)) = lower($2))`,
			b.OrgUnitId, name).Scan(&taken); err != nil {
			return fmt.Errorf("inventory: warehouse name: %w", err)
		}
		if taken {
			return conflict("", textWarehouseTaken)
		}
		out = api.Warehouse{Name: name, Code: code, OrgUnitId: b.OrgUnitId, Revision: 1}
		err := tx.QueryRow(ctx, `insert into inventory.warehouses (org_unit_id, name, code) values ($1, $2, $3) returning id`,
			b.OrgUnitId, name, code).Scan(&out.Id)
		if isUnique(err) {
			return conflict("", textWarehouseTaken)
		}
		if err != nil {
			return fmt.Errorf("inventory: insert warehouse: %w", err)
		}
		if err := recordAudit(ctx, tx, tc, "inventory.warehouse.create", targetWarehouse, out.Id, b.OrgUnitId,
			map[string]any{"name": name, "orgUnitId": b.OrgUnitId}); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusCreated, "", out)
	})
	return out, err
}

// ListWarehouses lists the warehouses the subject reads (inventory.items.read in the scope of the unit or of the
// warehouse), oldest first.
func (s *Service) ListWarehouses(ctx context.Context, tc tenantctx.TenantContext, q PageQuery) (api.WarehousePage, error) {
	limit, err := limitOf(q)
	if err != nil {
		return api.WarehousePage{}, err
	}
	off, err := decodeCursor(q.Cursor)
	if err != nil {
		return api.WarehousePage{}, err
	}
	page := api.WarehousePage{Items: []api.Warehouse{}}
	err = s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		pred, err := ev.ScopeQuery(ctx, tc, actItemsRead, warehouseColumns, 2)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `select w.id, w.name, w.code, w.org_unit_id, w.archived, w.revision from inventory.warehouses w
			 where (`+pred.SQL+`) order by w.created_at, w.id offset $1 limit $2`, append([]any{off, limit + 1}, pred.Args...)...)
		if err != nil {
			return fmt.Errorf("inventory: warehouses: %w", err)
		}
		defer rows.Close()
		var all []api.Warehouse
		for rows.Next() {
			var w api.Warehouse
			if err := rows.Scan(&w.Id, &w.Name, &w.Code, &w.OrgUnitId, &w.Archived, &w.Revision); err != nil {
				return fmt.Errorf("inventory: warehouses: %w", err)
			}
			all = append(all, w)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("inventory: warehouses: %w", err)
		}
		page.Items, page.NextCursor = paged(all, off, limit)
		if page.Items == nil {
			page.Items = []api.Warehouse{}
		}
		return nil
	})
	return page, err
}

// warehouse is a locked warehouse of a command.
type warehouse struct {
	id, unit uuid.UUID
	archived bool
}

// lockWarehouses reads and locks the warehouses (ids in order: commands over the same pair never wait for each other
// crosswise); a missing one is 404.
func lockWarehouses(ctx context.Context, tx pgx.Tx, ids ...uuid.UUID) (map[uuid.UUID]warehouse, error) {
	uniq := map[uuid.UUID]bool{}
	var list []uuid.UUID
	for _, id := range ids {
		if id != uuid.Nil && !uniq[id] {
			uniq[id] = true
			list = append(list, id)
		}
	}
	rows, err := tx.Query(ctx, `select id, org_unit_id, archived from inventory.warehouses where id = any($1) order by id for update`, list)
	if err != nil {
		return nil, fmt.Errorf("inventory: lock warehouses: %w", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]warehouse{}
	for rows.Next() {
		var w warehouse
		if err := rows.Scan(&w.id, &w.unit, &w.archived); err != nil {
			return nil, fmt.Errorf("inventory: lock warehouses: %w", err)
		}
		out[w.id] = w
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("inventory: lock warehouses: %w", err)
	}
	if len(out) != len(list) {
		return nil, problem.New(problem.CodeNotFound, textWarehouseNotFound)
	}
	return out, nil
}

// permitWarehouse checks action of the subject on the warehouse: a warehouse out of the scope is 404, one seen
// without the right — 403.
func permitWarehouse(ctx context.Context, ev Authorizer, tc tenantctx.TenantContext, w warehouse, action string) error {
	err := ev.Permit(ctx, tc, action, authz.Resource{Unit: w.unit, Objects: map[string]uuid.UUID{kindWarehouse: w.id}, ReadAction: actMovementsRead})
	if problem.Is(err, problem.CodeNotFound) {
		return problem.New(problem.CodeNotFound, textWarehouseNotFound)
	}
	return err
}
