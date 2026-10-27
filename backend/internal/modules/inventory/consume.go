package inventory

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	api "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// actConsume is the purpose-limited right to issue materials for an object of a module (the visit of SPA, AC-07): not
// the general right to post movements.
const actConsume = "inventory.consume"

// ConsumeLine is a quantity of an item to issue, in the base unit of the item.
type ConsumeLine struct {
	Item uuid.UUID
	Qty  Qty
}

// Consumption is the issue of materials for an object of another module (a visit of SPA, W5.20) in the transaction of
// that module: one movement of kind issue with the source, lots in FEFO order.
type Consumption struct {
	Warehouse uuid.UUID
	// Source is the object the stock is issued for: its movement consumes its active reservation.
	SourceModule, SourceType string
	SourceID                 uuid.UUID
	Lines                    []ConsumeLine
	// Corrected: the quantities differ from the norm; the right to change the consumption is checked as well.
	Corrected bool
}

// permitConsume checks a right over the warehouse the way the consumer sees it: a member who may only consume there
// sees the warehouse for that, a warehouse outside every grant is as missing (404).
func permitConsume(ctx context.Context, ev Authorizer, tc tenantctx.TenantContext, w warehouse, action string) error {
	err := ev.Permit(ctx, tc, action, authz.Resource{Unit: w.unit, Objects: map[string]uuid.UUID{kindWarehouse: w.id}, ReadAction: actConsume})
	if problem.Is(err, problem.CodeNotFound) {
		return problem.New(problem.CodeNotFound, textWarehouseNotFound)
	}
	return err
}

// consumeReq validates a consumption and builds the movement of the issue.
func consumeReq(c Consumption) (movementReq, error) {
	src, err := parseSource(&api.ObjectRef{ModuleKey: c.SourceModule, EntityType: c.SourceType, EntityId: c.SourceID})
	if err != nil {
		return movementReq{}, err
	}
	if len(c.Lines) == 0 || len(c.Lines) > maxLines {
		return movementReq{}, invalid("lines", textLines)
	}
	req := movementReq{kind: kindIssue, wh: c.Warehouse, src: src}
	for i, l := range c.Lines {
		if l.Qty <= 0 {
			return movementReq{}, invalid(fmt.Sprintf("lines[%d].quantity", i), textQuantity)
		}
		req.lines = append(req.lines, lineReq{item: l.Item, qty: l.Qty})
	}
	return req, nil
}

// permitConsumption checks the rights over the warehouse of a consumption: inventory.consume, and the right to change
// the consumption when the quantities differ from the norm.
func permitConsumption(ctx context.Context, ev Authorizer, tc tenantctx.TenantContext, w warehouse, corrected bool) error {
	if err := permitConsume(ctx, ev, tc, w, actConsume); err != nil {
		return err
	}
	if corrected {
		return permitConsume(ctx, ev, tc, w, actConsumptionChange)
	}
	return nil
}

// Consume issues the lines of c from the warehouse in the open transaction tx (the caller commits or rolls back, and
// stores the idempotent outcome): the warehouse is locked, the right inventory.consume over it is checked (and
// inventory.consumption.override for corrected quantities), the stock never goes below zero, lots go in FEFO order and
// an expired lot is not issued; a shortage is a *RefusalError with the reason insufficient_stock or lot_expired and
// changes nothing. The id of the movement is returned; the movement carries the source of the consumer.
func (s *Service) Consume(ctx context.Context, tx pgx.Tx, ev Authorizer, tc tenantctx.TenantContext, c Consumption) (uuid.UUID, error) {
	req, err := consumeReq(c)
	if err != nil {
		return uuid.Nil, err
	}
	whs, err := lockWarehouses(ctx, tx, c.Warehouse)
	if err != nil {
		return uuid.Nil, err
	}
	w := whs[c.Warehouse]
	if err := permitConsumption(ctx, ev, tc, w, c.Corrected); err != nil {
		return uuid.Nil, err
	}
	items, err := itemsOf(ctx, tx, req, original{})
	if err != nil {
		return uuid.Nil, err
	}
	x := ledger{tx: tx, today: dateOf(s.now())}
	if err := consumeReservation(ctx, x, req.wh, *req.src); err != nil {
		return uuid.Nil, err
	}
	recs, err := apply(ctx, x, req, original{}, items)
	if err != nil {
		return uuid.Nil, err
	}
	id, err := insertMovement(ctx, tx, tc, req, recs)
	if err != nil {
		return uuid.Nil, err
	}
	moved, err := loadMovements(ctx, tx, []uuid.UUID{id})
	if err != nil {
		return uuid.Nil, err
	}
	if err := publishMovement(ctx, tx, tc, w.unit, req, moved[0]); err != nil {
		return uuid.Nil, err
	}
	return id, nil
}
