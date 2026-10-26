package inventory

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	api "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// ListBalances lists the balances of the items in the warehouses the subject reads (inventory.items.read in the
// scope of the unit or of the warehouse): onHand, reserved, available per item and warehouse, the lots in FEFO order
// (the earliest expiry first, lots without expiry last) and belowMinimum against the minimum level of the item.
func (s *Service) ListBalances(ctx context.Context, tc tenantctx.TenantContext, q BalanceQuery) (api.InventoryBalancePage, error) {
	limit, err := limitOf(q.PageQuery)
	if err != nil {
		return api.InventoryBalancePage{}, err
	}
	off, err := decodeCursor(q.Cursor)
	if err != nil {
		return api.InventoryBalancePage{}, err
	}
	page := api.InventoryBalancePage{Items: []api.InventoryBalance{}}
	err = s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		whs, err := visibleWarehouses(ctx, tx, ev, tc, actItemsRead)
		if err != nil {
			return err
		}
		below := q.BelowMinimum != nil && *q.BelowMinimum
		rows, err := tx.Query(ctx, `select b.warehouse_id, b.item_id, trim_scale(sum(b.on_hand))::text, trim_scale(sum(b.reserved))::text,
			       trim_scale(sum(b.on_hand - b.reserved))::text, trim_scale(i.min_level)::text,
			       i.min_level is not null and sum(b.on_hand) < i.min_level
			  from inventory.balances b join inventory.items i on i.id = b.item_id
			 where b.warehouse_id = any($1) and ($2::uuid is null or b.warehouse_id = $2) and ($3::uuid is null or b.item_id = $3)
			 group by b.warehouse_id, b.item_id, i.min_level
			having (not $4 or (i.min_level is not null and sum(b.on_hand) < i.min_level))
			 order by b.warehouse_id, b.item_id offset $5 limit $6`, whs, q.WarehouseID, q.ItemID, below, off, limit+1)
		if err != nil {
			return fmt.Errorf("inventory: balances: %w", err)
		}
		var all []api.InventoryBalance
		for rows.Next() {
			b := api.InventoryBalance{Lots: []api.InventoryLotBalance{}}
			if err := rows.Scan(&b.WarehouseId, &b.ItemId, &b.OnHand, &b.Reserved, &b.Available, &b.MinLevel, &b.BelowMinimum); err != nil {
				rows.Close()
				return fmt.Errorf("inventory: balances: %w", err)
			}
			all = append(all, b)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("inventory: balances: %w", err)
		}
		all, page.NextCursor = paged(all, off, limit)
		if err := fillLots(ctx, tx, all); err != nil {
			return err
		}
		if all != nil {
			page.Items = all
		}
		return nil
	})
	return page, err
}

// fillLots adds the lots with stock to the balances of a page, in FEFO order.
func fillLots(ctx context.Context, tx pgx.Tx, bs []api.InventoryBalance) error {
	if len(bs) == 0 {
		return nil
	}
	whs, items := make([]uuid.UUID, len(bs)), make([]uuid.UUID, len(bs))
	at := map[[2]uuid.UUID]int{}
	for i, b := range bs {
		whs[i], items[i] = b.WarehouseId, b.ItemId
		at[[2]uuid.UUID{b.WarehouseId, b.ItemId}] = i
	}
	rows, err := tx.Query(ctx, `select b.warehouse_id, b.item_id, b.lot_id, lt.expires_on, trim_scale(b.on_hand)::text
		  from inventory.balances b left join inventory.lots lt on lt.id = b.lot_id
		 where (b.warehouse_id, b.item_id) in (select * from unnest($1::uuid[], $2::uuid[])) and b.on_hand > 0
		 order by lt.expires_on nulls last, lt.received_at nulls last, b.lot_id`, whs, items)
	if err != nil {
		return fmt.Errorf("inventory: balance lots: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			wh, item uuid.UUID
			l        api.InventoryLotBalance
			expires  *time.Time
		)
		if err := rows.Scan(&wh, &item, &l.LotId, &expires, &l.OnHand); err != nil {
			return fmt.Errorf("inventory: balance lots: %w", err)
		}
		if expires != nil {
			alloc(&l.ExpiresOn).Time = *expires
		}
		i := at[[2]uuid.UUID{wh, item}]
		bs[i].Lots = append(bs[i].Lots, l)
	}
	return rows.Err()
}
