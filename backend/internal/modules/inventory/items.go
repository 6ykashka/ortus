package inventory

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	api "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const (
	textSkuRequired = "Укажите артикул."
	textSkuLong     = "Артикул — не длиннее 64 символов."
	textSkuTaken    = "Позиция с таким артикулом в подразделении уже есть."
	textUnitKind    = "Единица измерения — мл, г, шт., л или кг."
	textMinLevel    = "Минимальный остаток — число от 0 с точностью до шести знаков."
	textNothing     = "Нечего менять."
	textStale       = "Данные изменились. Обновите страницу и повторите."
)

var baseUnits = []string{"ml", "g", "piece", "litre", "kg"}

// itemColumns: the unit of the item; a grant on a warehouse reaches the items of the unit of that warehouse (the
// storekeeper sees what his warehouse may hold).
var itemColumns = authz.Columns{
	Unit:  "i.org_unit_id",
	Paths: map[string]string{kindWarehouse: `array(select w.id from inventory.warehouses w where w.org_unit_id = i.org_unit_id)`},
}

const itemSelect = `select i.id, i.name, i.sku, i.base_unit, i.track_lots, trim_scale(i.min_level)::text, i.org_unit_id, i.revision
  from inventory.items i`

func scanItem(row pgx.Row) (api.InventoryItem, error) {
	var (
		it   api.InventoryItem
		unit string
	)
	if err := row.Scan(&it.Id, &it.Name, &it.Sku, &unit, &it.TrackLots, &it.MinLevel, &it.OrgUnitId, &it.Revision); err != nil {
		return api.InventoryItem{}, err
	}
	it.BaseUnit = api.InventoryItemBaseUnit(unit)
	return it, nil
}

// validateItem checks the body of createInventoryItem and returns the clean name and sku.
func validateItem(b api.InventoryItemCreate) (name, sku string, err error) {
	if name, err = cleanName(b.Name); err != nil {
		return "", "", err
	}
	sku = strings.TrimSpace(b.Sku)
	switch {
	case sku == "":
		return "", "", invalid("sku", textSkuRequired)
	case utf8.RuneCountInString(sku) > 64:
		return "", "", invalid("sku", textSkuLong)
	case !slices.Contains(baseUnits, string(b.BaseUnit)):
		return "", "", invalid("baseUnit", textUnitKind)
	}
	return name, sku, nil
}

// CreateItem creates a stock item of an org unit with its exact base unit (createInventoryItem).
func (s *Service) CreateItem(ctx context.Context, tc tenantctx.TenantContext, b api.InventoryItemCreate) (api.InventoryItem, error) {
	name, sku, err := validateItem(b)
	if err != nil {
		return api.InventoryItem{}, err
	}
	var out api.InventoryItem
	err = s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		if err := ev.Permit(ctx, tc, actItemsManage, authz.Resource{Unit: b.OrgUnitId, ReadAction: actItemsRead}); err != nil {
			return err
		}
		if ok, err := unitExists(ctx, tx, b.OrgUnitId); err != nil {
			return err
		} else if !ok {
			return invalid("orgUnitId", textUnitNotFound)
		}
		var taken bool
		if err := tx.QueryRow(ctx, `select exists (select 1 from inventory.items where org_unit_id = $1 and lower(sku) = lower($2))`,
			b.OrgUnitId, sku).Scan(&taken); err != nil {
			return fmt.Errorf("inventory: sku: %w", err)
		}
		if taken {
			return conflict("", textSkuTaken)
		}
		var id uuid.UUID
		err := tx.QueryRow(ctx, `insert into inventory.items (org_unit_id, name, sku, base_unit, track_lots) values ($1, $2, $3, $4, $5) returning id`,
			b.OrgUnitId, name, sku, string(b.BaseUnit), b.TrackLots).Scan(&id)
		if isUnique(err) {
			return conflict("", textSkuTaken)
		}
		if err != nil {
			return fmt.Errorf("inventory: insert item: %w", err)
		}
		if out, err = scanItem(tx.QueryRow(ctx, itemSelect+` where i.id = $1`, id)); err != nil {
			return fmt.Errorf("inventory: read back item: %w", err)
		}
		if err := recordAudit(ctx, tx, tc, "inventory.item.create", targetItem, id, b.OrgUnitId,
			map[string]any{"sku": sku, "baseUnit": string(b.BaseUnit), "trackLots": b.TrackLots}); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusCreated, etag(out.Revision), out)
	})
	return out, err
}

// ListItems lists the allowed (not archived) stock items the subject reads, oldest first.
func (s *Service) ListItems(ctx context.Context, tc tenantctx.TenantContext, q PageQuery) (api.InventoryItemPage, error) {
	limit, err := limitOf(q)
	if err != nil {
		return api.InventoryItemPage{}, err
	}
	off, err := decodeCursor(q.Cursor)
	if err != nil {
		return api.InventoryItemPage{}, err
	}
	page := api.InventoryItemPage{Items: []api.InventoryItem{}}
	err = s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		pred, err := ev.ScopeQuery(ctx, tc, actItemsRead, itemColumns, 2)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, itemSelect+` where not i.archived and (`+pred.SQL+`) order by i.created_at, i.id offset $1 limit $2`,
			append([]any{off, limit + 1}, pred.Args...)...)
		if err != nil {
			return fmt.Errorf("inventory: items: %w", err)
		}
		defer rows.Close()
		var all []api.InventoryItem
		for rows.Next() {
			it, err := scanItem(rows)
			if err != nil {
				return fmt.Errorf("inventory: items: %w", err)
			}
			all = append(all, it)
		}
		if err := rows.Err(); err != nil {
			return fmt.Errorf("inventory: items: %w", err)
		}
		if page.Items, page.NextCursor = paged(all, off, limit); page.Items == nil {
			page.Items = []api.InventoryItem{}
		}
		return nil
	})
	return page, err
}

// revisionOf reads the revision of an If-Match: «rev-<n>» with or without quotes.
func revisionOf(ifMatch string) (int64, bool) {
	v := strings.TrimSpace(ifMatch)
	v = strings.TrimPrefix(v, "W/")
	v = strings.Trim(v, `"`)
	n, ok := strings.CutPrefix(v, "rev-")
	if !ok {
		return 0, false
	}
	rev, err := strconv.ParseInt(n, 10, 64)
	return rev, err == nil && rev > 0
}

// validatePatch checks the body of updateInventoryItem: something to change, a clean name, a minimum level.
func validatePatch(p api.InventoryItemPatch) (name, minLevel *string, err error) {
	if p.Name == nil && p.MinLevel == nil && p.Archived == nil {
		return nil, nil, invalid("body", textNothing)
	}
	if p.Name != nil {
		n, err := cleanName(*p.Name)
		if err != nil {
			return nil, nil, err
		}
		name = &n
	}
	if p.MinLevel != nil {
		q, err := ParseQuantity(*p.MinLevel)
		if err != nil {
			return nil, nil, invalid("minLevel", textMinLevel)
		}
		m := q.String()
		minLevel = &m
	}
	return name, minLevel, nil
}

// checkRevision compares the If-Match with the revision of the item: none — 428, another — 412.
func checkRevision(ifMatch string, revision int64) error {
	want, ok := revisionOf(ifMatch)
	switch {
	case strings.TrimSpace(ifMatch) == "":
		return problem.New(codeRevisionRequired, "")
	case !ok || want != revision:
		return problem.New(codeRevisionMismatch, textStale)
	}
	return nil
}

// patchDiff is what a patch changed, for the audit row.
func patchDiff(name, minLevel *string, archived *bool) map[string]any {
	diff := map[string]any{}
	if name != nil {
		diff["name"] = *name
	}
	if minLevel != nil {
		diff["minLevel"] = *minLevel
	}
	if archived != nil {
		diff["archived"] = *archived
	}
	return diff
}

// UpdateItem edits the name, the minimum level or the archive flag of an item (updateInventoryItem) under If-Match:
// the revision of the item. The sku and the base unit are not in the patch — they never change.
func (s *Service) UpdateItem(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, p api.InventoryItemPatch) (api.InventoryItem, error) {
	name, minLevel, err := validatePatch(p)
	if err != nil {
		return api.InventoryItem{}, err
	}
	var out api.InventoryItem
	err = s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		var unit uuid.UUID
		var revision int64
		err := tx.QueryRow(ctx, `select org_unit_id, revision from inventory.items where id = $1 for update`, id).Scan(&unit, &revision)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New(problem.CodeNotFound, textItemNotFound)
		}
		if err != nil {
			return fmt.Errorf("inventory: item: %w", err)
		}
		err = ev.Permit(ctx, tc, actItemsManage, authz.Resource{Unit: unit, ReadAction: actItemsRead})
		if problem.Is(err, problem.CodeNotFound) {
			return problem.New(problem.CodeNotFound, textItemNotFound)
		}
		if err != nil {
			return err
		}
		if err := checkRevision(ifMatch, revision); err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `update inventory.items set name = coalesce($2, name), min_level = coalesce($3::numeric, min_level),
			archived = coalesce($4, archived), revision = revision + 1 where id = $1`, id, name, minLevel, p.Archived); err != nil {
			return fmt.Errorf("inventory: update item: %w", err)
		}
		if out, err = scanItem(tx.QueryRow(ctx, itemSelect+` where i.id = $1`, id)); err != nil {
			return fmt.Errorf("inventory: read back item: %w", err)
		}
		if err := recordAudit(ctx, tx, tc, "inventory.item.update", targetItem, id, unit, patchDiff(name, minLevel, p.Archived)); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}
