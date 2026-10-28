package repairs

import (
	"context"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
)

// The warehouse side of the supply (D-19…D-22). The module «Склад» (W5.10) answers its own HTTP operations through its
// service, which opens a transaction of its own; the supply must change the stock and its own request in ONE transaction
// (0053: «движения пишет модуль „Склад" в той же транзакции»). The module imports nothing of another module (depguard),
// so the two things the supply needs — a reserve and an issue, and a receipt of a return — are written here in SQL over
// the tables of inventory.* under the rules of that module: the stock never goes below zero, reserved never exceeds
// on hand, the lots go in FEFO order, a movement is an INSERT with its source. Q-W6.13-2: the item of the warehouse is
// found by the name of the material of the price list.

// Names of the source of a movement and of a reservation of the supply.
const (
	srcModule = "repairs"
	srcSupply = "supply_request"
	srcStock  = "project_stock"
)

const microSQL = `::bigint::numeric / 1000000`

// whRow is a warehouse of the module «Склад».
type whRow struct {
	id, unit uuid.UUID
	archived bool
}

// warehouse reads (and locks) a warehouse; nil — there is none.
func (r *req) warehouse(ctx context.Context, id uuid.UUID) (*whRow, error) {
	w := &whRow{}
	if err := r.tx.QueryRow(ctx, `select id, org_unit_id, archived from inventory.warehouses where id = $1 for update`, id).Scan(&w.id, &w.unit, &w.archived); err != nil {
		if noRows(err) {
			return nil, nil
		}
		return nil, store("warehouse", err)
	}
	return w, nil
}

// canWarehouse reports whether the member holds action over the warehouse: the owner; the tenant; the unit of the warehouse
// (with the subtree above it); the warehouse itself.
func (r *req) canWarehouse(ctx context.Context, w *whRow, action string) (bool, error) {
	if r.tc.Owner {
		return true, nil
	}
	if err := r.subject(ctx); err != nil {
		return false, err
	}
	if !slices.ContainsFunc(r.grants, func(g authz.Grant) bool { return g.Has(action) }) {
		return false, nil
	}
	path, err := r.path(ctx, w.unit)
	if err != nil {
		return false, err
	}
	return slices.ContainsFunc(r.grants, func(g authz.Grant) bool {
		if !g.Has(action) {
			return false
		}
		switch g.Scope.Kind {
		case authz.KindTenant:
			return true
		case authz.KindUnit:
			return g.Scope.Ref == w.unit || (g.Scope.Descendants && slices.Contains(path, g.Scope.Ref))
		case authz.KindWarehouse:
			return g.Scope.Ref == w.id
		}
		return false
	}), nil
}

// postable requires the right to post movements over the warehouse: 404 as a missing warehouse when the member cannot even
// read its movements (the module «Склад» hides what it does not show), 403 otherwise.
func (r *req) postable(ctx context.Context, w *whRow) error {
	ok, err := r.canWarehouse(ctx, w, actMovementsPost)
	if err != nil || ok {
		return err
	}
	if seen, err := r.canWarehouse(ctx, w, actMovementsRead); err != nil || !seen {
		if err == nil {
			err = notFound(textWarehouseMissing)
		}
		return err
	}
	return forbidden(textNeedPost)
}

// stockItem finds the item of the warehouse that stands for a material of the price list: the same name, not archived.
func (r *req) stockItem(ctx context.Context, name string, w *whRow) (uuid.UUID, bool, error) {
	var id uuid.UUID
	err := r.tx.QueryRow(ctx, `select id from inventory.items where lower(btrim(name)) = lower(btrim($1)) and not archived
		order by (org_unit_id = $2) desc, created_at, id limit 1`, name, w.unit).Scan(&id)
	if noRows(err) {
		return uuid.Nil, false, nil
	}
	return id, err == nil, store("stock item", err)
}

// balanceRow is a balance of an item in a warehouse: one per lot.
type balanceRow struct {
	lot      *uuid.UUID
	expires  *time.Time
	onHand   int64 // millionths
	reserved int64
}

// balances reads the balances of the item in FEFO order (the earliest expiry first, no expiry last) and locks them.
func (r *req) balances(ctx context.Context, wh, item uuid.UUID) ([]balanceRow, error) {
	rows, err := r.tx.Query(ctx, `select b.lot_id, l.expires_on, (b.on_hand * 1000000)::bigint, (b.reserved * 1000000)::bigint
		from inventory.balances b left join inventory.lots l on l.id = b.lot_id where b.warehouse_id = $1 and b.item_id = $2
		order by l.expires_on nulls last, l.received_at nulls first, b.lot_id nulls first for update of b`, wh, item)
	if err != nil {
		return nil, store("balances", err)
	}
	defer rows.Close()
	var out []balanceRow
	for rows.Next() {
		var b balanceRow
		if err := rows.Scan(&b.lot, &b.expires, &b.onHand, &b.reserved); err != nil {
			return nil, store("balances", err)
		}
		out = append(out, b)
	}
	return out, store("balances", rows.Err())
}

func freeOf(bs []balanceRow) []int64 {
	out := make([]int64, len(bs))
	for i, b := range bs {
		out[i] = b.onHand - b.reserved
	}
	return out
}

func (r *req) addReserved(ctx context.Context, wh, item uuid.UUID, lot *uuid.UUID, delta int64) error {
	_, err := r.tx.Exec(ctx, `update inventory.balances set reserved = reserved + ($4`+microSQL+`) where warehouse_id = $1 and item_id = $2
		and lot_id is not distinct from $3::uuid`, wh, item, lot, delta)
	return store("reserve", err)
}

// reserveAt holds qty of the item in the warehouse for the request: the balances' reserved grows in FEFO order and an
// active reservation of the module «Склад» names the request as its source. false — the free stock is smaller.
func (r *req) reserveAt(ctx context.Context, wh, item, request uuid.UUID, qty milli) (bool, error) {
	bs, err := r.balances(ctx, wh, item)
	if err != nil {
		return false, err
	}
	take, ok := allocate(freeOf(bs), int64(qty.micro()))
	if !ok {
		return false, nil
	}
	for i, n := range take {
		if n == 0 {
			continue
		}
		if err := r.addReserved(ctx, wh, item, bs[i].lot, n); err != nil {
			return false, err
		}
	}
	var res uuid.UUID
	if err := r.tx.QueryRow(ctx, `insert into inventory.reservations (warehouse_id, source_module, source_type, source_id, created_by)
		values ($1, $2, $3, $4, $5) returning id`, wh, srcModule, srcSupply, request, r.me()).Scan(&res); err != nil {
		return false, store("reservation", err)
	}
	_, err = r.tx.Exec(ctx, `insert into inventory.reservation_lines (reservation_id, line_no, item_id, quantity) values ($1, 1, $2, $3`+microSQL+`)`,
		res, item, int64(qty.micro()))
	return true, store("reservation line", err)
}

// takenLot is what an issue took from one lot.
type takenLot struct {
	lot     *uuid.UUID
	expires *time.Time
	qty     int64
}

// issueAt releases the reservation of the request and takes qty of the item out of the warehouse in FEFO order, then
// posts the movement «issue» with the request as its source. It returns the id of the movement; false — the reservation
// is gone or the stock is smaller (the stock never goes below zero).
func (r *req) issueAt(ctx context.Context, w *whRow, item, request uuid.UUID, qty milli) (uuid.UUID, bool, error) {
	var res uuid.UUID
	err := r.tx.QueryRow(ctx, `select id from inventory.reservations where source_module = $1 and source_type = $2 and source_id = $3
		and warehouse_id = $4 and status = 'active' for update`, srcModule, srcSupply, request, w.id).Scan(&res)
	if noRows(err) {
		return uuid.Nil, false, nil
	}
	if err != nil {
		return uuid.Nil, false, store("reservation", err)
	}
	bs, err := r.balances(ctx, w.id, item)
	if err != nil {
		return uuid.Nil, false, err
	}
	taken, ok, err := r.takeOut(ctx, w.id, item, bs, int64(qty.micro()))
	if err != nil || !ok {
		return uuid.Nil, false, err
	}
	if _, err := r.tx.Exec(ctx, `update inventory.reservations set status = 'consumed', revision = revision + 1 where id = $1`, res); err != nil {
		return uuid.Nil, false, store("reservation", err)
	}
	id, err := r.postMovement(ctx, w, "issue", item, request, srcSupply, taken)
	return id, err == nil, err
}

// takeOut lifts the reserve of want over the balances and takes want out of their free stock, FEFO. false — it does not fit.
func (r *req) takeOut(ctx context.Context, wh, item uuid.UUID, bs []balanceRow, want int64) ([]takenLot, bool, error) {
	held := make([]int64, len(bs))
	for i, b := range bs {
		held[i] = b.reserved
	}
	release, ok := allocate(held, want)
	if !ok {
		return nil, false, nil
	}
	for i, n := range release {
		if n == 0 {
			continue
		}
		if err := r.addReserved(ctx, wh, item, bs[i].lot, -n); err != nil {
			return nil, false, err
		}
		bs[i].reserved -= n
	}
	take, ok := allocate(freeOf(bs), want)
	if !ok {
		return nil, false, nil
	}
	var taken []takenLot
	for i, n := range take {
		if n == 0 {
			continue
		}
		if _, err := r.tx.Exec(ctx, `update inventory.balances set on_hand = on_hand - ($4`+microSQL+`) where warehouse_id = $1 and item_id = $2
			and lot_id is not distinct from $3::uuid`, wh, item, bs[i].lot, n); err != nil {
			return nil, false, store("take", err)
		}
		taken = append(taken, takenLot{bs[i].lot, bs[i].expires, n})
	}
	return taken, true, nil
}

// receiveAt puts qty of the item into the warehouse (the return of the surplus of an object) and posts the movement
// «receipt» with the object as its source. An item that tracks lots gets a lot without an expiry.
func (r *req) receiveAt(ctx context.Context, w *whRow, item, project uuid.UUID, qty milli) (uuid.UUID, error) {
	lot, err := r.lotForReturn(ctx, w, item)
	if err != nil {
		return uuid.Nil, err
	}
	n := int64(qty.micro())
	if _, err := r.tx.Exec(ctx, `insert into inventory.balances (warehouse_id, item_id, lot_id, on_hand) values ($1, $2, $3::uuid, $4`+microSQL+`)
		on conflict (warehouse_id, item_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))
		do update set on_hand = inventory.balances.on_hand + excluded.on_hand`, w.id, item, lot, n); err != nil {
		return uuid.Nil, store("receive", err)
	}
	return r.postMovement(ctx, w, "receipt", item, project, srcStock, []takenLot{{lot, nil, n}})
}

// lotForReturn is the lot a returned item goes to: none for an item without lots, else the lot without a code and an expiry.
func (r *req) lotForReturn(ctx context.Context, w *whRow, item uuid.UUID) (*uuid.UUID, error) {
	var tracks bool
	if err := r.tx.QueryRow(ctx, `select track_lots from inventory.items where id = $1`, item).Scan(&tracks); err != nil {
		return nil, store("item", err)
	}
	if !tracks {
		return nil, nil
	}
	var id uuid.UUID
	err := r.tx.QueryRow(ctx, `select id from inventory.lots where warehouse_id = $1 and item_id = $2 and expires_on is null and lot_code is null
		order by received_at, id limit 1`, w.id, item).Scan(&id)
	if noRows(err) {
		err = r.tx.QueryRow(ctx, `insert into inventory.lots (item_id, warehouse_id, received_at) values ($1, $2, $3) returning id`, item, w.id, r.now).Scan(&id)
	}
	return &id, store("lot", err)
}

// postMovement writes the immutable movement and its lines and tells the outbox, as the module «Склад» does.
func (r *req) postMovement(ctx context.Context, w *whRow, kind string, item, source uuid.UUID, sourceType string, lines []takenLot) (uuid.UUID, error) {
	var id uuid.UUID
	if err := r.tx.QueryRow(ctx, `insert into inventory.movements (kind, warehouse_id, source_module, source_type, source_id, posted_at, posted_by)
		values ($1, $2, $3, $4, $5, $6, $7) returning id`, kind, w.id, srcModule, sourceType, source, r.now, r.me()).Scan(&id); err != nil {
		return uuid.Nil, store("movement", err)
	}
	payload := make([]map[string]any, 0, len(lines))
	for i, l := range lines {
		if _, err := r.tx.Exec(ctx, `insert into inventory.movement_lines (movement_id, line_no, item_id, lot_id, quantity, expires_on)
			values ($1, $2, $3, $4::uuid, $5`+microSQL+`, $6::date)`, id, i+1, item, l.lot, l.qty, l.expires); err != nil {
			return uuid.Nil, store("movement line", err)
		}
		payload = append(payload, map[string]any{"itemId": item, "quantity": micro(l.qty).String()})
	}
	_, err := events.Publish(ctx, r.tx, events.Event{Type: "inventory.movement.posted.v1", Aggregate: "inventory.movement", AggregateID: id, Payload: map[string]any{
		"movementId": id, "kind": kind, "warehouseId": w.id, "unitId": w.unit, "lines": payload,
		"source": map[string]any{"moduleKey": srcModule, "entityType": sourceType, "entityId": source}}})
	return id, store("movement event", err)
}

// String is the quantity of the module «Склад»: the decimals without trailing zeros.
func (m micro) String() string {
	s := strconv.FormatInt(int64(m)/1_000_000, 10)
	if f := int64(m) % 1_000_000; f != 0 {
		s += "." + strings.TrimRight(fmt.Sprintf("%06d", f), "0")
	}
	return s
}

// available lists the warehouses that hold free stock of the material of the request: the names of the tips «свободно».
func (r *req) available(ctx context.Context, name string) ([]availableRow, error) {
	rows, err := r.tx.Query(ctx, `select w.id, w.name, floor(sum(b.on_hand - b.reserved) * 1000)::bigint
		from inventory.items i join inventory.balances b on b.item_id = i.id join inventory.warehouses w on w.id = b.warehouse_id
		where lower(btrim(i.name)) = lower(btrim($1)) and not i.archived and not w.archived
		group by w.id, w.name having sum(b.on_hand - b.reserved) > 0 order by w.name, w.id`, name)
	if err != nil {
		return nil, store("available", err)
	}
	defer rows.Close()
	var out []availableRow
	for rows.Next() {
		var a availableRow
		var free int64
		if err := rows.Scan(&a.warehouse, &a.name, &free); err != nil {
			return nil, store("available", err)
		}
		if a.free = milli(free); a.free > 0 {
			out = append(out, a)
		}
	}
	return out, store("available", rows.Err())
}

type availableRow struct {
	warehouse uuid.UUID
	name      string
	free      milli
}
