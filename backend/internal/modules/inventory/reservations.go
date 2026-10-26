package inventory

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	api "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const (
	textReservationAbsent = "Резерв не найден."
	textReservationTaken  = "Для этого объекта на складе уже есть действующий резерв."
	textReservationInert  = "Резерв уже не действует."
	textStatus            = "Статус резерва — действует, использован или снят."
	textItemTwice         = "Позиция указана дважды."
)

const reservationSelect = `select r.id, r.warehouse_id, r.source_module, r.source_type, r.source_id, r.status, r.expires_at, r.created_at, r.revision
  from inventory.reservations r`

// loadReservations reads reservations with their lines, in the order of ids.
func loadReservations(ctx context.Context, tx pgx.Tx, ids []uuid.UUID) ([]api.InventoryReservation, error) {
	if len(ids) == 0 {
		return []api.InventoryReservation{}, nil
	}
	byID := map[uuid.UUID]*api.InventoryReservation{}
	rows, err := tx.Query(ctx, reservationSelect+` where r.id = any($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("inventory: reservations: %w", err)
	}
	for rows.Next() {
		var (
			r      api.InventoryReservation
			status string
		)
		if err := rows.Scan(&r.Id, &r.WarehouseId, &r.Source.ModuleKey, &r.Source.EntityType, &r.Source.EntityId, &status, &r.ExpiresAt, &r.CreatedAt, &r.Revision); err != nil {
			rows.Close()
			return nil, fmt.Errorf("inventory: reservations: %w", err)
		}
		r.Status, r.CreatedAt, r.Lines = api.InventoryReservationStatus(status), r.CreatedAt.UTC(), []api.InventoryReservationLine{}
		byID[r.Id] = &r
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("inventory: reservations: %w", err)
	}
	lrows, err := tx.Query(ctx, `select reservation_id, item_id, trim_scale(quantity)::text from inventory.reservation_lines
		 where reservation_id = any($1) order by reservation_id, line_no`, ids)
	if err != nil {
		return nil, fmt.Errorf("inventory: reservation lines: %w", err)
	}
	defer lrows.Close()
	for lrows.Next() {
		var (
			rid uuid.UUID
			l   api.InventoryReservationLine
		)
		if err := lrows.Scan(&rid, &l.ItemId, &l.Quantity); err != nil {
			return nil, fmt.Errorf("inventory: reservation lines: %w", err)
		}
		byID[rid].Lines = append(byID[rid].Lines, l)
	}
	if err := lrows.Err(); err != nil {
		return nil, fmt.Errorf("inventory: reservation lines: %w", err)
	}
	out := make([]api.InventoryReservation, 0, len(ids))
	for _, id := range ids {
		if r := byID[id]; r != nil {
			out = append(out, *r)
		}
	}
	return out, nil
}

// parseReservation checks the body of createInventoryReservation: the source, the warehouse, the lines with their
// quantities and the items (each once).
func parseReservation(b api.InventoryReservationCreate) (*source, []Qty, []uuid.UUID, error) {
	src, err := parseSource(&b.Source)
	if err != nil {
		return nil, nil, nil, err
	}
	if b.WarehouseId == uuid.Nil {
		return nil, nil, nil, invalid(keyWarehouse, textWarehouseNotFound)
	}
	if len(b.Lines) == 0 || len(b.Lines) > maxLines {
		return nil, nil, nil, invalid("lines", textLines)
	}
	qty := make([]Qty, len(b.Lines))
	var ids []uuid.UUID
	for i, l := range b.Lines {
		q, err := ParseQuantity(l.Quantity)
		if err != nil || q == 0 {
			return nil, nil, nil, invalid(fmt.Sprintf("lines[%d].quantity", i), textQuantity)
		}
		if slices.Contains(ids, l.ItemId) {
			return nil, nil, nil, invalid(fmt.Sprintf("lines[%d].itemId", i), textItemTwice)
		}
		qty[i], ids = q, append(ids, l.ItemId)
	}
	return src, qty, ids, nil
}

// CreateReservation reserves stock for a source object (createInventoryReservation): inventory.movements.post over
// the warehouse, one active reservation per source and warehouse, every line within what is available (on hand
// minus reserved, expired lots out). It holds quantity without a movement.
func (s *Service) CreateReservation(ctx context.Context, tc tenantctx.TenantContext, b api.InventoryReservationCreate) (api.InventoryReservation, error) {
	src, qty, ids, err := parseReservation(b)
	if err != nil {
		return api.InventoryReservation{}, err
	}
	var out api.InventoryReservation
	err = s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		whs, err := lockWarehouses(ctx, tx, b.WarehouseId)
		if err != nil {
			return err
		}
		if err := permitWarehouse(ctx, ev, tc, whs[b.WarehouseId], actMovementsPost); err != nil {
			return err
		}
		if err := checkReserve(ctx, tx, b, src, ids); err != nil {
			return err
		}
		id, err := insertReservation(ctx, ledger{tx: tx, today: dateOf(s.now())}, tc, b, src, qty)
		if err != nil {
			return err
		}
		got, err := loadReservations(ctx, tx, []uuid.UUID{id})
		if err != nil {
			return err
		}
		out = got[0]
		if err := recordAudit(ctx, tx, tc, "inventory.reservation.create", targetReservation, id, whs[b.WarehouseId].unit,
			map[string]any{keyWarehouse: b.WarehouseId, "lines": len(b.Lines),
				"source": map[string]any{"moduleKey": src.module, "entityType": src.kind, "entityId": src.id}}); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusCreated, "", out)
	})
	return out, err
}

// checkReserve checks the items of a reservation (known, not archived) and that the source has no active reservation
// in the warehouse yet.
func checkReserve(ctx context.Context, tx pgx.Tx, b api.InventoryReservationCreate, src *source, ids []uuid.UUID) error {
	items, err := loadItems(ctx, tx, ids)
	if err != nil {
		return err
	}
	for i, l := range b.Lines {
		if it, ok := items[l.ItemId]; !ok || it.archived {
			return invalid(fmt.Sprintf("lines[%d].itemId", i), textItemNotFound)
		}
	}
	var taken bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from inventory.reservations where source_module = $1 and source_type = $2
		 and source_id = $3 and warehouse_id = $4 and status = 'active')`, src.module, src.kind, src.id, b.WarehouseId).Scan(&taken); err != nil {
		return fmt.Errorf("inventory: reservation source: %w", err)
	}
	if taken {
		return conflict("", textReservationTaken)
	}
	return nil
}

// insertReservation writes the reservation and its lines and holds the quantities on the stock (FEFO).
func insertReservation(ctx context.Context, x ledger, tc tenantctx.TenantContext, b api.InventoryReservationCreate, src *source, qty []Qty) (uuid.UUID, error) {
	var id uuid.UUID
	err := x.tx.QueryRow(ctx, `insert into inventory.reservations (warehouse_id, source_module, source_type, source_id, expires_at, created_by)
		 values ($1, $2, $3, $4, $5, $6) returning id`, b.WarehouseId, src.module, src.kind, src.id, b.ExpiresAt, tc.PersonID).Scan(&id)
	if isUnique(err) {
		return uuid.Nil, conflict("", textReservationTaken)
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("inventory: insert reservation: %w", err)
	}
	for i, l := range b.Lines {
		if _, err := x.tx.Exec(ctx, `insert into inventory.reservation_lines (reservation_id, line_no, item_id, quantity) values ($1, $2, $3, $4`+micro+`)`,
			id, i+1, l.ItemId, int64(qty[i])); err != nil {
			return uuid.Nil, fmt.Errorf("inventory: insert reservation line: %w", err)
		}
		if err := x.reserveStock(ctx, b.WarehouseId, l.ItemId, qty[i]); err != nil {
			return uuid.Nil, err
		}
	}
	return id, nil
}

// consumeReservation turns the active reservation of the source in the warehouse into consumed and gives its
// quantity back to the stock, so the issue of the source can take it. No reservation is nothing to do.
func consumeReservation(ctx context.Context, x ledger, wh uuid.UUID, src source) error {
	var id uuid.UUID
	err := x.tx.QueryRow(ctx, `select id from inventory.reservations where source_module = $1 and source_type = $2 and source_id = $3
		 and warehouse_id = $4 and status = 'active' for update`, src.module, src.kind, src.id, wh).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inventory: reservation of the source: %w", err)
	}
	return closeReservation(ctx, x, wh, id, "consumed")
}

// closeReservation gives the lines of the reservation back and sets its final status.
func closeReservation(ctx context.Context, x ledger, wh, id uuid.UUID, status string) error {
	rows, err := x.tx.Query(ctx, `select item_id, (quantity * 1000000)::bigint from inventory.reservation_lines where reservation_id = $1 order by line_no`, id)
	if err != nil {
		return fmt.Errorf("inventory: reservation lines: %w", err)
	}
	type held struct {
		item uuid.UUID
		qty  Qty
	}
	var list []held
	for rows.Next() {
		var h held
		if err := rows.Scan(&h.item, &h.qty); err != nil {
			rows.Close()
			return fmt.Errorf("inventory: reservation lines: %w", err)
		}
		list = append(list, h)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("inventory: reservation lines: %w", err)
	}
	for _, h := range list {
		if err := x.unreserve(ctx, wh, h.item, h.qty); err != nil {
			return err
		}
	}
	if _, err := x.tx.Exec(ctx, `update inventory.reservations set status = $2, revision = revision + 1 where id = $1`, id, status); err != nil {
		return fmt.Errorf("inventory: close reservation: %w", err)
	}
	return nil
}

// ReleaseReservation releases an active reservation (releaseInventoryReservation); a reservation that is not active
// is 409 invalid_transition, reason reservation_not_active.
func (s *Service) ReleaseReservation(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (api.InventoryReservation, error) {
	var out api.InventoryReservation
	err := s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		var wh uuid.UUID
		err := tx.QueryRow(ctx, `select warehouse_id from inventory.reservations where id = $1`, id).Scan(&wh)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New(problem.CodeNotFound, textReservationAbsent)
		}
		if err != nil {
			return fmt.Errorf("inventory: reservation: %w", err)
		}
		whs, err := lockWarehouses(ctx, tx, wh)
		if err != nil {
			return err
		}
		if err := permitWarehouse(ctx, ev, tc, whs[wh], actMovementsPost); err != nil {
			if problem.Is(err, problem.CodeNotFound) {
				return problem.New(problem.CodeNotFound, textReservationAbsent)
			}
			return err
		}
		var status string
		if err := tx.QueryRow(ctx, `select status from inventory.reservations where id = $1 for update`, id).Scan(&status); err != nil {
			return fmt.Errorf("inventory: reservation: %w", err)
		}
		if status != "active" {
			return conflict(ReasonReservationNotActive, textReservationInert)
		}
		if err := closeReservation(ctx, ledger{tx: tx, today: dateOf(s.now())}, wh, id, "released"); err != nil {
			return err
		}
		got, err := loadReservations(ctx, tx, []uuid.UUID{id})
		if err != nil {
			return err
		}
		out = got[0]
		if err := recordAudit(ctx, tx, tc, "inventory.reservation.release", targetReservation, id, whs[wh].unit, map[string]any{keyWarehouse: wh}); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, "", out)
	})
	return out, err
}

// ListReservations lists the reservations of the warehouses the subject reads (inventory.movements.read), newest
// first, optionally of a warehouse and of a status.
func (s *Service) ListReservations(ctx context.Context, tc tenantctx.TenantContext, q ReservationQuery) (api.InventoryReservationPage, error) {
	limit, err := limitOf(q.PageQuery)
	if err != nil {
		return api.InventoryReservationPage{}, err
	}
	off, err := decodeCursor(q.Cursor)
	if err != nil {
		return api.InventoryReservationPage{}, err
	}
	if q.Status != "" && !slices.Contains([]string{"active", "consumed", "released"}, q.Status) {
		return api.InventoryReservationPage{}, problem.New(problem.CodeMalformedRequest, textStatus)
	}
	page := api.InventoryReservationPage{Items: []api.InventoryReservation{}}
	err = s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		whs, err := visibleWarehouses(ctx, tx, ev, tc, actMovementsRead)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `select r.id from inventory.reservations r
			 where r.warehouse_id = any($1) and ($2::uuid is null or r.warehouse_id = $2) and ($3 = '' or r.status = $3)
			 order by r.created_at desc, r.id desc offset $4 limit $5`, whs, q.WarehouseID, q.Status, off, limit+1)
		if err != nil {
			return fmt.Errorf("inventory: reservations: %w", err)
		}
		var ids []uuid.UUID
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return fmt.Errorf("inventory: reservations: %w", err)
			}
			ids = append(ids, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("inventory: reservations: %w", err)
		}
		ids, page.NextCursor = paged(ids, off, limit)
		page.Items, err = loadReservations(ctx, tx, ids)
		return err
	})
	return page, err
}
