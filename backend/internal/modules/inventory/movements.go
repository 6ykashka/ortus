package inventory

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	api "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const (
	textLines          = "Добавьте хотя бы одну позицию (не больше 100)."
	textQuantity       = "Количество — число больше нуля с точностью до шести знаков."
	textKind           = "Вид движения — приход, расход, перемещение, корректировка или сторно."
	textTarget         = "Для перемещения укажите другой склад."
	textTargetOnly     = "Склад назначения — только у перемещения."
	textDirection      = "Для корректировки укажите направление: увеличение или уменьшение."
	textDirectionOnly  = "Направление — только у корректировки."
	textReason         = "Укажите причину."
	textReasonLong     = "Причина — не длиннее 2000 символов."
	textReverses       = "Укажите движение, которое исправляется."
	textReversesOnly   = "Исправляемое движение — только у сторно."
	textSource         = "Источник указан неверно."
	textMovementAbsent = "Движение не найдено."
	textReversed       = "Движение уже исправлено."
	textReversalOfRev  = "Сторно не исправляют."
	textReversalLines  = "Позиции сторно должны совпадать с исправляемым движением."
	textReversalWh     = "Сторно проводится по складу исправляемого движения."
	textArchivedItem   = "Позиция в архиве."
	maxLines           = 100
)

var (
	moduleRE = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,49}$`)
	typeRE   = regexp.MustCompile(`^[a-z][a-z0-9_]{1,49}$`)
)

// source is the object a movement or a reservation is made for (an appointment of spa, a purchase of repairs).
type source struct {
	module, kind string
	id           uuid.UUID
}

func parseSource(ref *api.ObjectRef) (*source, error) {
	if ref == nil {
		return nil, nil
	}
	if !moduleRE.MatchString(ref.ModuleKey) || !typeRE.MatchString(ref.EntityType) || ref.EntityId == uuid.Nil {
		return nil, invalid("source", textSource)
	}
	return &source{module: ref.ModuleKey, kind: ref.EntityType, id: ref.EntityId}, nil
}

// lineReq is a line of the request: the item, a lot named by the caller, the expiry of a received lot, the quantity.
type lineReq struct {
	item    uuid.UUID
	lot     uuid.UUID
	expires *time.Time
	qty     Qty
}

// movementReq is a validated request of postInventoryMovement.
type movementReq struct {
	kind     string
	wh       uuid.UUID
	target   uuid.UUID
	dir      string
	reason   string
	reverses uuid.UUID
	src      *source
	lines    []lineReq
}

func (r movementReq) corrects() bool { return r.kind == kindAdjustment || r.kind == kindReversal }

func parseMovement(b api.InventoryMovementCreate) (movementReq, error) {
	r := movementReq{kind: string(b.Kind), wh: b.WarehouseId}
	if !slices.Contains([]string{kindReceipt, kindIssue, kindTransfer, kindAdjustment, kindReversal}, r.kind) {
		return r, invalid("kind", textKind)
	}
	if b.WarehouseId == uuid.Nil {
		return r, invalid(keyWarehouse, textWarehouseNotFound)
	}
	if b.TargetWarehouseId != nil {
		r.target = *b.TargetWarehouseId
	}
	switch {
	case r.kind == kindTransfer && (r.target == uuid.Nil || r.target == r.wh):
		return r, invalid("targetWarehouseId", textTarget)
	case r.kind != kindTransfer && r.target != uuid.Nil:
		return r, invalid("targetWarehouseId", textTargetOnly)
	}
	if err := parseCorrection(&r, b); err != nil {
		return r, err
	}
	var err error
	if r.src, err = parseSource(b.Source); err != nil {
		return r, err
	}
	r.lines, err = parseLines(r.kind, b.Lines)
	return r, err
}

// parseCorrection reads the fields of adjustments and reversals: the direction, the reason, the corrected movement.
func parseCorrection(r *movementReq, b api.InventoryMovementCreate) error {
	if b.AdjustmentDirection != nil {
		r.dir = string(*b.AdjustmentDirection)
	}
	switch {
	case r.kind == kindAdjustment && !slices.Contains([]string{dirIncrease, dirDecrease}, r.dir):
		return invalid("adjustmentDirection", textDirection)
	case r.kind != kindAdjustment && r.dir != "":
		return invalid("adjustmentDirection", textDirectionOnly)
	}
	if b.Reason != nil {
		r.reason = strings.TrimSpace(*b.Reason)
	}
	switch {
	case r.corrects() && r.reason == "":
		return invalid("reason", textReason)
	case utf8.RuneCountInString(r.reason) > 2000:
		return invalid("reason", textReasonLong)
	}
	return parseReverses(r, b.ReversesMovementId)
}

// parseReverses reads the corrected movement: required by a reversal, forbidden to the other kinds.
func parseReverses(r *movementReq, id *uuid.UUID) error {
	if id != nil {
		r.reverses = *id
	}
	switch {
	case r.kind == kindReversal && r.reverses == uuid.Nil:
		return invalid("reversesMovementId", textReverses)
	case r.kind != kindReversal && r.reverses != uuid.Nil:
		return invalid("reversesMovementId", textReversesOnly)
	}
	return nil
}

// parseLines reads the lines of a request (a reversal may have none: they come from the corrected movement).
func parseLines(kind string, in []api.InventoryMovementLine) ([]lineReq, error) {
	if len(in) > maxLines || (len(in) == 0 && kind != kindReversal) {
		return nil, invalid("lines", textLines)
	}
	var out []lineReq
	for i, l := range in {
		q, err := ParseQuantity(l.Quantity)
		if err != nil || q == 0 {
			return nil, invalid(fmt.Sprintf("lines[%d].quantity", i), textQuantity)
		}
		out = append(out, lineReq{item: l.ItemId, lot: idOf(l.LotId), expires: dateField(l.ExpiresOn), qty: q})
	}
	return out, nil
}

// recLine is a line of the movement as it is recorded: the lot and the expiry that were really touched.
type recLine struct {
	item    uuid.UUID
	lot     uuid.UUID
	qty     Qty
	expires *time.Time
}

// original is the movement a reversal corrects.
type original struct {
	kind   string
	wh     uuid.UUID
	target uuid.UUID
	dir    string
	lines  []recLine
}

func loadOriginal(ctx context.Context, tx pgx.Tx, id uuid.UUID) (original, error) {
	var (
		o      original
		target *uuid.UUID
		dir    *string
	)
	err := tx.QueryRow(ctx, `select kind, warehouse_id, target_warehouse_id, adjustment_direction from inventory.movements where id = $1`, id).
		Scan(&o.kind, &o.wh, &target, &dir)
	if errors.Is(err, pgx.ErrNoRows) {
		return o, problem.New(problem.CodeNotFound, textMovementAbsent)
	}
	if err != nil {
		return o, fmt.Errorf("inventory: original: %w", err)
	}
	o.target = idOf(target)
	if dir != nil {
		o.dir = *dir
	}
	rows, err := tx.Query(ctx, `select item_id, lot_id, (quantity * 1000000)::bigint, expires_on from inventory.movement_lines
		 where movement_id = $1 order by line_no`, id)
	if err != nil {
		return o, fmt.Errorf("inventory: original lines: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			l   recLine
			lot *uuid.UUID
		)
		if err := rows.Scan(&l.item, &lot, &l.qty, &l.expires); err != nil {
			return o, fmt.Errorf("inventory: original lines: %w", err)
		}
		l.lot = idOf(lot)
		o.lines = append(o.lines, l)
	}
	return o, rows.Err()
}

// prepare reads the movement a reversal corrects, locks the warehouses of the command, checks the rights over each of
// them (a correction needs the extra right) and refuses a movement that was reversed already.
func prepare(ctx context.Context, tx pgx.Tx, ev Authorizer, tc tenantctx.TenantContext, req *movementReq) (original, map[uuid.UUID]warehouse, error) {
	var orig original
	if req.kind == kindReversal {
		var err error
		if orig, err = loadOriginal(ctx, tx, req.reverses); err != nil {
			return orig, nil, err
		}
		if err := checkReversal(req, orig); err != nil {
			return orig, nil, err
		}
		req.target = orig.target // the warehouses to lock and to check; not a field of the reversal itself
	}
	whs, err := lockWarehouses(ctx, tx, req.wh, req.target)
	if err != nil {
		return orig, nil, err
	}
	for _, w := range whs {
		if err := permitWarehouse(ctx, ev, tc, w, actMovementsPost); err != nil {
			return orig, nil, err
		}
		if req.corrects() {
			if err := permitWarehouse(ctx, ev, tc, w, actConsumptionChange); err != nil {
				return orig, nil, err
			}
		}
	}
	if req.kind == kindReversal {
		var done bool
		if err := tx.QueryRow(ctx, `select exists (select 1 from inventory.movements where reverses_movement_id = $1)`, req.reverses).Scan(&done); err != nil {
			return orig, nil, fmt.Errorf("inventory: reversed: %w", err)
		}
		if done {
			return orig, nil, conflict("", textReversed)
		}
	}
	return orig, whs, nil
}

// PostMovement posts a receipt, an issue, a transfer, an adjustment or a reversal in one transaction
// (postInventoryMovement): the stock never goes below zero, an issue without a lot takes lots in FEFO order, an
// expired lot is not issued, the movement of a source consumes its active reservation, a mistake is corrected by a
// reversal (once). The warehouses are locked in id order, so commands over them go one by one.
func (s *Service) PostMovement(ctx context.Context, tc tenantctx.TenantContext, b api.InventoryMovementCreate) (api.InventoryMovement, error) {
	req, err := parseMovement(b)
	if err != nil {
		return api.InventoryMovement{}, err
	}
	var out api.InventoryMovement
	err = s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		orig, whs, err := prepare(ctx, tx, ev, tc, &req)
		if err != nil {
			return err
		}
		items, err := itemsOf(ctx, tx, req, orig)
		if err != nil {
			return err
		}
		x := ledger{tx: tx, today: dateOf(s.now())}
		if req.kind == kindIssue && req.src != nil { // the reserved quantity is available to the issue of its source
			if err := consumeReservation(ctx, x, req.wh, *req.src); err != nil {
				return err
			}
		}
		recs, err := apply(ctx, x, req, orig, items)
		if err != nil {
			return err
		}
		id, err := insertMovement(ctx, tx, tc, req, recs)
		if err != nil {
			return err
		}
		moved, err := loadMovements(ctx, tx, []uuid.UUID{id})
		if err != nil {
			return err
		}
		out = moved[0]
		if err := publishMovement(ctx, tx, tc, whs[req.wh].unit, req, out); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusCreated, "", out)
	})
	return out, err
}

// checkReversal checks the request of a reversal against the movement it corrects.
func checkReversal(req *movementReq, o original) error {
	switch {
	case o.kind == kindReversal:
		return conflict("", textReversalOfRev)
	case req.wh != o.wh:
		return invalid("warehouseId", textReversalWh)
	}
	if len(req.lines) > 0 {
		var want, got []Take
		for _, l := range o.lines {
			want = append(want, Take{Item: l.item, Qty: l.qty})
		}
		for _, l := range req.lines {
			got = append(got, Take{Item: l.item, Qty: l.qty})
		}
		w, g := Totals(want), Totals(got)
		if len(w) != len(g) {
			return invalid("lines", textReversalLines)
		}
		for item, q := range w {
			if g[item] != q {
				return invalid("lines", textReversalLines)
			}
		}
	}
	return nil
}

// itemsOf loads the items of the request (or of the corrected movement) and refuses an unknown one; an archived item
// is not received (issues drain what is left).
func itemsOf(ctx context.Context, tx pgx.Tx, req movementReq, o original) (map[uuid.UUID]itemInfo, error) {
	var ids []uuid.UUID
	for _, l := range req.lines {
		ids = append(ids, l.item)
	}
	for _, l := range o.lines {
		ids = append(ids, l.item)
	}
	items, err := loadItems(ctx, tx, ids)
	if err != nil {
		return nil, err
	}
	receives := req.kind == kindReceipt || req.kind == kindTransfer || (req.kind == kindAdjustment && req.dir == dirIncrease)
	for i, l := range req.lines {
		it, ok := items[l.item]
		switch {
		case !ok:
			return nil, invalid(fmt.Sprintf("lines[%d].itemId", i), textItemNotFound)
		case it.archived && receives:
			return nil, invalid(fmt.Sprintf("lines[%d].itemId", i), textArchivedItem)
		}
	}
	return items, nil
}

// apply changes the balances by the request and returns the lines to record.
func apply(ctx context.Context, x ledger, req movementReq, o original, items map[uuid.UUID]itemInfo) ([]recLine, error) {
	if req.kind == kindReversal {
		return applyReversal(ctx, x, o)
	}
	var recs []recLine
	for i, l := range req.lines {
		field := fmt.Sprintf("lines[%d]", i)
		it := items[l.item]
		incoming := req.kind == kindReceipt || (req.kind == kindAdjustment && req.dir == dirIncrease)
		if incoming {
			lot, exp, err := x.receive(ctx, req.wh, it, l.lot, l.expires, l.qty, field)
			if err != nil {
				return nil, err
			}
			recs = append(recs, recLine{item: l.item, lot: lot, qty: l.qty, expires: exp})
			continue
		}
		if l.expires != nil {
			return nil, invalid(field+".expiresOn", textLotExpiry)
		}
		takes, exp, err := outgoing(ctx, x, req, l, field)
		if err != nil {
			return nil, err
		}
		for _, t := range takes {
			if req.kind == kindTransfer {
				twin, err := x.lotTwin(ctx, req.target, l.item, t.LotID)
				if err != nil {
					return nil, err
				}
				if err := x.add(ctx, req.target, l.item, twin, t.Qty); err != nil {
					return nil, err
				}
			}
			recs = append(recs, recLine{item: l.item, lot: t.LotID, qty: t.Qty, expires: exp[t.LotID]})
		}
	}
	return recs, nil
}

// outgoing takes a line out of the warehouse: the lot named by the caller or FEFO; a write-off (adjustment) may take
// expired lots, an issue and a transfer may not.
func outgoing(ctx context.Context, x ledger, req movementReq, l lineReq, field string) ([]Take, map[uuid.UUID]*time.Time, error) {
	allowExpired := req.kind == kindAdjustment
	if l.lot == uuid.Nil {
		return x.issueFEFO(ctx, req.wh, l.item, l.qty, allowExpired)
	}
	exp, err := x.issueLot(ctx, req.wh, l.item, l.lot, l.qty, allowExpired, field+".lotId")
	if err != nil {
		return nil, nil, err
	}
	return []Take{{Item: l.item, LotID: l.lot, Qty: l.qty}}, map[uuid.UUID]*time.Time{l.lot: exp}, nil
}

// removeExact takes q from the lot a movement put the stock in (no lot: the item without lots).
func removeExact(ctx context.Context, x ledger, wh, item, lot uuid.UUID, q Qty) error {
	if lot == uuid.Nil {
		return x.sub(ctx, wh, item, lot, q)
	}
	_, err := x.issueLot(ctx, wh, item, lot, q, true, "lines")
	return err
}

// applyReversal does the opposite of the corrected movement on the same lots.
func applyReversal(ctx context.Context, x ledger, o original) ([]recLine, error) {
	for _, l := range o.lines {
		var err error
		switch {
		case o.kind == kindReceipt, o.kind == kindAdjustment && o.dir == dirIncrease:
			err = removeExact(ctx, x, o.wh, l.item, l.lot, l.qty)
		case o.kind == kindIssue, o.kind == kindAdjustment && o.dir == dirDecrease:
			err = x.add(ctx, o.wh, l.item, l.lot, l.qty)
		case o.kind == kindTransfer:
			var lots []Lot
			if lots, err = x.twins(ctx, o.target, l.item, l.lot); err == nil {
				if _, _, err = x.take(ctx, o.target, l.item, lots, l.qty, true); err == nil {
					err = x.add(ctx, o.wh, l.item, l.lot, l.qty)
				}
			}
		default:
			err = fmt.Errorf("inventory: reversal of %q", o.kind)
		}
		if err != nil {
			return nil, err
		}
	}
	return o.lines, nil
}

func insertMovement(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, req movementReq, recs []recLine) (uuid.UUID, error) {
	var module, kind, dir any
	var sid, reverses, target any
	if req.src != nil {
		module, kind, sid = req.src.module, req.src.kind, req.src.id
	}
	if req.dir != "" {
		dir = req.dir
	}
	if req.kind == kindTransfer {
		target = req.target
	}
	if req.reverses != uuid.Nil {
		reverses = req.reverses
	}
	var reason any
	if req.reason != "" {
		reason = req.reason
	}
	var id uuid.UUID
	err := tx.QueryRow(ctx, `insert into inventory.movements (kind, warehouse_id, target_warehouse_id, adjustment_direction, source_module,
		   source_type, source_id, reverses_movement_id, reason, posted_by)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
		req.kind, req.wh, target, dir, module, kind, sid, reverses, reason, tc.PersonID).Scan(&id)
	if isUnique(err) {
		return uuid.Nil, conflict("", textReversed)
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("inventory: insert movement: %w", err)
	}
	for i, r := range recs {
		if _, err := tx.Exec(ctx, `insert into inventory.movement_lines (movement_id, line_no, item_id, lot_id, quantity, expires_on)
			values ($1, $2, $3, $4::uuid, $5`+micro+`, $6::date)`, id, i+1, r.item, nullable(r.lot), int64(r.qty), r.expires); err != nil {
			return uuid.Nil, fmt.Errorf("inventory: insert movement line: %w", err)
		}
	}
	return id, nil
}

func publishMovement(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, unit uuid.UUID, req movementReq, m api.InventoryMovement) error {
	lines := make([]map[string]any, 0, len(m.Lines))
	for _, l := range m.Lines {
		lines = append(lines, map[string]any{"itemId": l.ItemId, "quantity": l.Quantity})
	}
	payload := map[string]any{"movementId": m.Id, "kind": string(m.Kind), keyWarehouse: m.WarehouseId, "unitId": unit, "lines": lines}
	diff := map[string]any{"kind": string(m.Kind), keyWarehouse: m.WarehouseId, "lines": len(m.Lines)}
	if req.src != nil {
		payload["source"] = map[string]any{"moduleKey": req.src.module, "entityType": req.src.kind, "entityId": req.src.id}
		diff["source"] = payload["source"]
	}
	if err := recordAudit(ctx, tx, tc, "inventory.movement.post", targetMovement, m.Id, unit, diff); err != nil {
		return err
	}
	if _, err := events.Publish(ctx, tx, events.Event{Type: "inventory.movement.posted.v1", Aggregate: targetMovement, AggregateID: m.Id, Payload: payload}); err != nil {
		return fmt.Errorf("inventory: event: %w", err)
	}
	return nil
}

// loadMovements reads movements with their lines, in the order of ids.
func loadMovements(ctx context.Context, tx pgx.Tx, ids []uuid.UUID) ([]api.InventoryMovement, error) {
	if len(ids) == 0 {
		return []api.InventoryMovement{}, nil
	}
	byID, err := readMovements(ctx, tx, ids)
	if err != nil {
		return nil, err
	}
	if err := readMovementLines(ctx, tx, ids, byID); err != nil {
		return nil, err
	}
	out := make([]api.InventoryMovement, 0, len(ids))
	for _, id := range ids {
		if m := byID[id]; m != nil {
			out = append(out, *m)
		}
	}
	return out, nil
}

func readMovements(ctx context.Context, tx pgx.Tx, ids []uuid.UUID) (map[uuid.UUID]*api.InventoryMovement, error) {
	rows, err := tx.Query(ctx, `select id, kind, warehouse_id, target_warehouse_id, source_module, source_type, source_id, posted_at
		  from inventory.movements where id = any($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("inventory: movements: %w", err)
	}
	defer rows.Close()
	byID := map[uuid.UUID]*api.InventoryMovement{}
	for rows.Next() {
		var (
			m             api.InventoryMovement
			kind          string
			module, stype *string
			sid           *uuid.UUID
			postedAt      time.Time
		)
		if err := rows.Scan(&m.Id, &kind, &m.WarehouseId, &m.TargetWarehouseId, &module, &stype, &sid, &postedAt); err != nil {
			return nil, fmt.Errorf("inventory: movements: %w", err)
		}
		m.Kind, m.PostedAt, m.Lines = api.InventoryMovementKind(kind), postedAt.UTC(), []api.InventoryMovementLine{}
		if module != nil && stype != nil && sid != nil {
			m.Source = &api.ObjectRef{ModuleKey: *module, EntityType: *stype, EntityId: *sid}
		}
		byID[m.Id] = &m
	}
	return byID, rows.Err()
}

func readMovementLines(ctx context.Context, tx pgx.Tx, ids []uuid.UUID, byID map[uuid.UUID]*api.InventoryMovement) error {
	rows, err := tx.Query(ctx, `select movement_id, item_id, lot_id, trim_scale(quantity)::text, expires_on from inventory.movement_lines
		 where movement_id = any($1) order by movement_id, line_no`, ids)
	if err != nil {
		return fmt.Errorf("inventory: movement lines: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			mid     uuid.UUID
			l       api.InventoryMovementLine
			expires *time.Time
		)
		if err := rows.Scan(&mid, &l.ItemId, &l.LotId, &l.Quantity, &expires); err != nil {
			return fmt.Errorf("inventory: movement lines: %w", err)
		}
		if expires != nil {
			alloc(&l.ExpiresOn).Time = *expires
		}
		byID[mid].Lines = append(byID[mid].Lines, l)
	}
	return rows.Err()
}

// visibleWarehouses returns the ids of the warehouses the subject reads under action.
func visibleWarehouses(ctx context.Context, tx pgx.Tx, ev Authorizer, tc tenantctx.TenantContext, action string) ([]uuid.UUID, error) {
	pred, err := ev.ScopeQuery(ctx, tc, action, warehouseColumns, 0)
	if err != nil {
		return nil, err
	}
	rows, err := tx.Query(ctx, `select w.id from inventory.warehouses w where (`+pred.SQL+`)`, pred.Args...)
	if err != nil {
		return nil, fmt.Errorf("inventory: visible warehouses: %w", err)
	}
	defer rows.Close()
	ids := []uuid.UUID{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("inventory: visible warehouses: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// ListMovements lists the movements of the warehouses the subject reads (inventory.movements.read; a transfer is
// visible from both ends), newest first.
func (s *Service) ListMovements(ctx context.Context, tc tenantctx.TenantContext, q PageQuery) (api.InventoryMovementPage, error) {
	limit, err := limitOf(q)
	if err != nil {
		return api.InventoryMovementPage{}, err
	}
	off, err := decodeCursor(q.Cursor)
	if err != nil {
		return api.InventoryMovementPage{}, err
	}
	page := api.InventoryMovementPage{Items: []api.InventoryMovement{}}
	err = s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		whs, err := visibleWarehouses(ctx, tx, ev, tc, actMovementsRead)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, `select m.id from inventory.movements m
			 where m.warehouse_id = any($1) or m.target_warehouse_id = any($1)
			 order by m.posted_at desc, m.id desc offset $2 limit $3`, whs, off, limit+1)
		if err != nil {
			return fmt.Errorf("inventory: movements: %w", err)
		}
		var ids []uuid.UUID
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return fmt.Errorf("inventory: movements: %w", err)
			}
			ids = append(ids, id)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return fmt.Errorf("inventory: movements: %w", err)
		}
		ids, page.NextCursor = paged(ids, off, limit)
		if page.Items, err = loadMovements(ctx, tx, ids); err != nil {
			return err
		}
		return nil
	})
	return page, err
}
