package inventory

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Texts of the refusals of the ledger.
const (
	textInsufficient = "На складе недостаточно материала."
	textLotExpired   = "Срок годности партии истёк."
	textLotNotFound  = "Партия не найдена на складе."
	textLotGiven     = "Партия и срок годности — только у позиции с учётом партий."
	textLotExpiry    = "У существующей партии срок не указывают."
)

// ledger changes the balances of one command inside its transaction. The warehouses of the command are locked, so
// the balance rows are read and written by one command at a time.
type ledger struct {
	tx    pgx.Tx
	today time.Time // the date of the application clock: a lot is good through its expiry date
}

func dateOf(t time.Time) time.Time {
	y, m, d := t.UTC().Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// nullable is the argument of a lot id: uuid.Nil is no lot (null).
func nullable(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

func idOf(p *uuid.UUID) uuid.UUID {
	if p == nil {
		return uuid.Nil
	}
	return *p
}

// micro converts a quantity to the argument of the SQL below: «$n::bigint / 1000000.0» is the exact numeric(18, 6).
const micro = "::bigint / 1000000.0"

// itemInfo is what a command needs of an item.
type itemInfo struct {
	id        uuid.UUID
	trackLots bool
	archived  bool
}

// loadItems reads the items by id; one missing is nil in the result.
func loadItems(ctx context.Context, tx pgx.Tx, ids []uuid.UUID) (map[uuid.UUID]itemInfo, error) {
	rows, err := tx.Query(ctx, `select id, track_lots, archived from inventory.items where id = any($1) for share`, ids)
	if err != nil {
		return nil, fmt.Errorf("inventory: items: %w", err)
	}
	defer rows.Close()
	out := map[uuid.UUID]itemInfo{}
	for rows.Next() {
		var it itemInfo
		if err := rows.Scan(&it.id, &it.trackLots, &it.archived); err != nil {
			return nil, fmt.Errorf("inventory: items: %w", err)
		}
		out[it.id] = it
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("inventory: items: %w", err)
	}
	return out, nil
}

// lots returns the stock of the item in the warehouse that may be taken (on hand minus reserved, above zero).
func (l ledger) lots(ctx context.Context, wh, item uuid.UUID) ([]Lot, error) {
	return l.lotsWhere(ctx, wh, item, "", nil)
}

// lotsWhere is lots of the lots matching cond over lt (the lots table, left joined) with args from $3.
func (l ledger) lotsWhere(ctx context.Context, wh, item uuid.UUID, cond string, args []any) ([]Lot, error) {
	q := `select b.lot_id, lt.expires_on, coalesce(lt.received_at, 'epoch'::timestamptz), ((b.on_hand - b.reserved) * 1000000)::bigint
	  from inventory.balances b left join inventory.lots lt on lt.id = b.lot_id
	 where b.warehouse_id = $1 and b.item_id = $2 and b.on_hand - b.reserved > 0`
	if cond != "" {
		q += " and " + cond
	}
	rows, err := l.tx.Query(ctx, q+` for update of b`, append([]any{wh, item}, args...)...)
	if err != nil {
		return nil, fmt.Errorf("inventory: lots: %w", err)
	}
	defer rows.Close()
	var out []Lot
	for rows.Next() {
		var (
			id *uuid.UUID
			x  Lot
		)
		if err := rows.Scan(&id, &x.ExpiresOn, &x.ReceivedAt, &x.Available); err != nil {
			return nil, fmt.Errorf("inventory: lots: %w", err)
		}
		x.ID = idOf(id)
		out = append(out, x)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("inventory: lots: %w", err)
	}
	return out, nil
}

// add puts q on the balance of the lot (a new row when there is none).
func (l ledger) add(ctx context.Context, wh, item, lot uuid.UUID, q Qty) error {
	_, err := l.tx.Exec(ctx, `insert into inventory.balances (warehouse_id, item_id, lot_id, on_hand) values ($1, $2, $3::uuid, $4`+micro+`)
		on conflict (warehouse_id, item_id, coalesce(lot_id, '00000000-0000-0000-0000-000000000000'::uuid))
		do update set on_hand = inventory.balances.on_hand + excluded.on_hand`, wh, item, nullable(lot), int64(q))
	if err != nil {
		return fmt.Errorf("inventory: add stock: %w", err)
	}
	return nil
}

// sub takes q from the balance of the lot; what is reserved stays (the row guards it as well: reserved <= on_hand).
func (l ledger) sub(ctx context.Context, wh, item, lot uuid.UUID, q Qty) error {
	tag, err := l.tx.Exec(ctx, `update inventory.balances set on_hand = on_hand - ($4`+micro+`)
		 where warehouse_id = $1 and item_id = $2 and lot_id is not distinct from $3::uuid and on_hand - reserved >= ($4`+micro+`)`,
		wh, item, nullable(lot), int64(q))
	if err != nil {
		return fmt.Errorf("inventory: take stock: %w", err)
	}
	if tag.RowsAffected() != 1 {
		return conflict(ReasonInsufficientStock, textInsufficient)
	}
	return nil
}

// refusal is the 409 of an allocation error.
func refusal(err error) error {
	switch {
	case errors.Is(err, ErrLotExpired):
		return conflict(ReasonLotExpired, textLotExpired)
	case errors.Is(err, ErrInsufficient):
		return conflict(ReasonInsufficientStock, textInsufficient)
	}
	return err
}

// issueFEFO takes q of the item in FEFO order and returns what it took with the expiry of the lots. allowExpired
// takes expired lots as well (a write-off, a reversal); they go first, as the earliest.
func (l ledger) issueFEFO(ctx context.Context, wh, item uuid.UUID, q Qty, allowExpired bool) ([]Take, map[uuid.UUID]*time.Time, error) {
	lots, err := l.lots(ctx, wh, item)
	if err != nil {
		return nil, nil, err
	}
	return l.take(ctx, wh, item, lots, q, allowExpired)
}

func (l ledger) take(ctx context.Context, wh, item uuid.UUID, lots []Lot, q Qty, allowExpired bool) ([]Take, map[uuid.UUID]*time.Time, error) {
	today := l.today
	if allowExpired {
		today = time.Time{}
	}
	takes, err := AllocateFEFO(lots, today, q)
	if err != nil {
		return nil, nil, refusal(err)
	}
	exp := map[uuid.UUID]*time.Time{}
	for _, x := range lots {
		exp[x.ID] = x.ExpiresOn
	}
	for i := range takes {
		takes[i].Item = item
		if err := l.sub(ctx, wh, item, takes[i].LotID, takes[i].Qty); err != nil {
			return nil, nil, err
		}
	}
	return takes, exp, nil
}

// issueLot takes q from one lot named by the caller.
func (l ledger) issueLot(ctx context.Context, wh, item, lot uuid.UUID, q Qty, allowExpired bool, field string) (*time.Time, error) {
	var (
		expires   *time.Time
		available Qty
	)
	err := l.tx.QueryRow(ctx, `select lt.expires_on, ((b.on_hand - b.reserved) * 1000000)::bigint
		  from inventory.balances b join inventory.lots lt on lt.id = b.lot_id
		 where b.warehouse_id = $1 and b.item_id = $2 and b.lot_id = $3 for update of b`, wh, item, lot).Scan(&expires, &available)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil, invalid(field, textLotNotFound)
	case err != nil:
		return nil, fmt.Errorf("inventory: lot: %w", err)
	case !allowExpired && expires != nil && expires.Before(l.today):
		return nil, conflict(ReasonLotExpired, textLotExpired)
	case available < q:
		return nil, conflict(ReasonInsufficientStock, textInsufficient)
	}
	return expires, l.sub(ctx, wh, item, lot, q)
}

// receive puts q of an item into the warehouse: a new lot for an item with lots (with the expiry of the line) or an
// existing lot of the warehouse named by the line; the item without lots has no lot and no expiry. It returns the
// lot and its expiry.
func (l ledger) receive(ctx context.Context, wh uuid.UUID, it itemInfo, lot uuid.UUID, expires *time.Time, q Qty, field string) (uuid.UUID, *time.Time, error) {
	if !it.trackLots {
		if lot != uuid.Nil {
			return uuid.Nil, nil, invalid(field+".lotId", textLotGiven)
		}
		if expires != nil {
			return uuid.Nil, nil, invalid(field+".expiresOn", textLotGiven)
		}
		return uuid.Nil, nil, l.add(ctx, wh, it.id, uuid.Nil, q)
	}
	if lot != uuid.Nil {
		if expires != nil {
			return uuid.Nil, nil, invalid(field+".expiresOn", textLotExpiry)
		}
		err := l.tx.QueryRow(ctx, `select expires_on from inventory.lots where id = $1 and item_id = $2 and warehouse_id = $3`,
			lot, it.id, wh).Scan(&expires)
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, nil, invalid(field+".lotId", textLotNotFound)
		}
		if err != nil {
			return uuid.Nil, nil, fmt.Errorf("inventory: lot: %w", err)
		}
		return lot, expires, l.add(ctx, wh, it.id, lot, q)
	}
	if err := l.tx.QueryRow(ctx, `insert into inventory.lots (item_id, warehouse_id, expires_on) values ($1, $2, $3) returning id`,
		it.id, wh, expires).Scan(&lot); err != nil {
		return uuid.Nil, nil, fmt.Errorf("inventory: insert lot: %w", err)
	}
	return lot, expires, l.add(ctx, wh, it.id, lot, q)
}

// lotTwin is the lot of the target warehouse that matches a lot of the source: the same code and expiry (created
// when there is none), so a transferred lot keeps its date.
func (l ledger) lotTwin(ctx context.Context, target, item, lot uuid.UUID) (uuid.UUID, error) {
	if lot == uuid.Nil {
		return uuid.Nil, nil
	}
	var (
		code    *string
		expires *time.Time
	)
	if err := l.tx.QueryRow(ctx, `select lot_code, expires_on from inventory.lots where id = $1`, lot).Scan(&code, &expires); err != nil {
		return uuid.Nil, fmt.Errorf("inventory: lot: %w", err)
	}
	var twin uuid.UUID
	err := l.tx.QueryRow(ctx, `select id from inventory.lots where warehouse_id = $1 and item_id = $2
		 and lot_code is not distinct from $3 and expires_on is not distinct from $4::date order by received_at, id limit 1`,
		target, item, code, expires).Scan(&twin)
	if errors.Is(err, pgx.ErrNoRows) {
		err = l.tx.QueryRow(ctx, `insert into inventory.lots (item_id, warehouse_id, lot_code, expires_on) values ($1, $2, $3, $4) returning id`,
			item, target, code, expires).Scan(&twin)
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("inventory: lot twin: %w", err)
	}
	return twin, nil
}

// twins returns the stock of the target warehouse in the lots that match the source lot (the reversal of a transfer
// takes back exactly what the transfer put there).
func (l ledger) twins(ctx context.Context, target, item, lot uuid.UUID) ([]Lot, error) {
	if lot == uuid.Nil {
		all, err := l.lots(ctx, target, item)
		if err != nil {
			return nil, err
		}
		var out []Lot
		for _, x := range all {
			if x.ID == uuid.Nil {
				out = append(out, x)
			}
		}
		return out, nil
	}
	return l.lotsWhere(ctx, target, item, `lt.lot_code is not distinct from (select lot_code from inventory.lots where id = $3)
		and lt.expires_on is not distinct from (select expires_on from inventory.lots where id = $3)`, []any{lot})
}

// reserveStock holds q of the item for a reservation: on the lots that can be taken, in FEFO order.
func (l ledger) reserveStock(ctx context.Context, wh, item uuid.UUID, q Qty) error {
	lots, err := l.lots(ctx, wh, item)
	if err != nil {
		return err
	}
	takes, err := AllocateFEFO(lots, l.today, q)
	if err != nil {
		return refusal(err)
	}
	for _, t := range takes {
		if _, err := l.tx.Exec(ctx, `update inventory.balances set reserved = reserved + ($4`+micro+`)
			 where warehouse_id = $1 and item_id = $2 and lot_id is not distinct from $3::uuid`, wh, item, nullable(t.LotID), int64(t.Qty)); err != nil {
			return fmt.Errorf("inventory: reserve: %w", err)
		}
	}
	return nil
}

// unreserve gives q of the item back from the reservations: the reserved quantity of the item is the sum of its
// active reservations, so it is taken from the lots that hold some, the latest expiry first.
func (l ledger) unreserve(ctx context.Context, wh, item uuid.UUID, q Qty) error {
	rows, err := l.tx.Query(ctx, `select b.lot_id, (b.reserved * 1000000)::bigint
		  from inventory.balances b left join inventory.lots lt on lt.id = b.lot_id
		 where b.warehouse_id = $1 and b.item_id = $2 and b.reserved > 0
		 order by lt.expires_on desc nulls first, b.lot_id for update of b`, wh, item)
	if err != nil {
		return fmt.Errorf("inventory: reserved: %w", err)
	}
	type held struct {
		lot uuid.UUID
		qty Qty
	}
	var list []held
	for rows.Next() {
		var (
			id *uuid.UUID
			h  held
		)
		if err := rows.Scan(&id, &h.qty); err != nil {
			rows.Close()
			return fmt.Errorf("inventory: reserved: %w", err)
		}
		h.lot = idOf(id)
		list = append(list, h)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return fmt.Errorf("inventory: reserved: %w", err)
	}
	left := q
	for _, h := range list {
		n := min(h.qty, left)
		if n == 0 {
			continue
		}
		if _, err := l.tx.Exec(ctx, `update inventory.balances set reserved = reserved - ($4`+micro+`)
			 where warehouse_id = $1 and item_id = $2 and lot_id is not distinct from $3::uuid`, wh, item, nullable(h.lot), int64(n)); err != nil {
			return fmt.Errorf("inventory: unreserve: %w", err)
		}
		left -= n
	}
	if left != 0 {
		return fmt.Errorf("inventory: reserved quantity of the item is %s short of the reservation", left)
	}
	return nil
}
