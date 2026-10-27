//go:build integration

package inventory_test

import (
	"testing"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	"github.com/ortus/ortus-crm/backend/internal/modules/inventory" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// consume runs Consume in a transaction of its own, as the completion of a visit of SPA does inside its own.
func consume(t *testing.T, tc tenantctx.TenantContext, c inventory.Consumption) (uuid.UUID, error) {
	t.Helper()
	pool, err := e.svc.Pools.For(t.Context(), tc.TenantID)
	if err != nil {
		t.Fatal(err)
	}
	tx, err := pool.Begin(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(t.Context()) }()
	id, err := e.svc.Consume(t.Context(), tx, e.svc.Authz, tc, c)
	if err != nil {
		return uuid.Nil, err
	}
	return id, tx.Commit(t.Context())
}

func consumption(wh api.Warehouse, src uuid.UUID, lines ...inventory.ConsumeLine) inventory.Consumption {
	return inventory.Consumption{Warehouse: wh.Id, SourceModule: "spa", SourceType: "appointment", SourceID: src, Lines: lines}
}

func qtyOf(t *testing.T, s string) inventory.Qty {
	t.Helper()
	q, err := inventory.ParseQuantity(s)
	if err != nil {
		t.Fatal(err)
	}
	return q
}

// The consumption of another module issues in FEFO order as one movement with the source, in the transaction of the
// caller: a rollback of the caller undoes it, a shortage of the second line undoes the first.
func TestConsumeForSource(t *testing.T) { //nolint:gocyclo // one scenario of one warehouse
	t.Parallel()
	own := owner(t)
	wh, oil, cream := warehouse(t, own, unit("msk1")), item(t, own, true), item(t, own, true)
	receive(t, own, wh, oil, "10", "2026-12-01")
	receive(t, own, wh, oil, "10", "2026-11-01")
	receive(t, own, wh, cream, "1", "")
	src := uuid.New()

	id, err := consume(t, own, consumption(wh, src, inventory.ConsumeLine{Item: oil.Id, Qty: qtyOf(t, "15")}))
	if err != nil || id == uuid.Nil {
		t.Fatalf("consume: %v %v", id, err)
	}
	wantStock(t, balance(t, own, wh, oil), "5", "0", "5")
	var got *api.InventoryMovement
	for _, m := range must(e.svc.ListMovements(t.Context(), own, inventory.PageQuery{Limit: 200})).Items {
		if m.Id == id {
			got = &m
		}
	}
	if got == nil || got.Kind != api.InventoryMovementKindIssue || got.WarehouseId != wh.Id || got.Source == nil ||
		got.Source.ModuleKey != "spa" || got.Source.EntityId != src || len(got.Lines) != 2 ||
		got.Lines[0].Quantity != "10" || got.Lines[1].Quantity != "5" { // 10 of the lot expiring 1 Nov, then 5 of the lot of 1 Dec
		t.Fatalf("movement: %+v", got)
	}

	// The second line is short: the first one is not issued.
	_, err = consume(t, own, consumption(wh, uuid.New(), inventory.ConsumeLine{Item: oil.Id, Qty: qtyOf(t, "1")},
		inventory.ConsumeLine{Item: cream.Id, Qty: qtyOf(t, "2")}))
	wantFailure(t, err, "invalid_transition", inventory.ReasonInsufficientStock)
	wantStock(t, balance(t, own, wh, oil), "5", "0", "5")

	// An empty consumption is refused; so is an unknown warehouse.
	_, err = consume(t, own, consumption(wh, uuid.New()))
	wantFailure(t, err, "validation_failed", "")
	_, err = consume(t, own, inventory.Consumption{Warehouse: uuid.New(), SourceModule: "spa", SourceType: "appointment", SourceID: uuid.New(),
		Lines: []inventory.ConsumeLine{{Item: oil.Id, Qty: 1}}})
	wantProblem(t, err, "not_found")

	// The caller's rollback undoes the issue.
	pool := must(e.svc.Pools.For(t.Context(), own.TenantID))
	tx := must(pool.Begin(t.Context()))
	must(e.svc.Consume(t.Context(), tx, e.svc.Authz, own, consumption(wh, uuid.New(), inventory.ConsumeLine{Item: oil.Id, Qty: qtyOf(t, "1")})))
	if err := tx.Rollback(t.Context()); err != nil {
		t.Fatal(err)
	}
	wantStock(t, balance(t, own, wh, oil), "5", "0", "5")
}

// The consumption right alone (a practitioner) issues from the warehouse of the grant and nowhere else; the corrected
// quantities need the extra right.
func TestConsumeRights(t *testing.T) {
	t.Parallel()
	own := owner(t)
	w1, w2, it := warehouse(t, own, unit("msk1")), warehouse(t, own, unit("msk1")), item(t, own, false)
	receive(t, own, w1, it, "10", "")
	receive(t, own, w2, it, "10", "")
	grantWarehouse(t, "a.manager-msk2", w1, "inventory.consume")
	mem := as(t, "a.manager-msk2", "a")

	if _, err := consume(t, mem, consumption(w1, uuid.New(), inventory.ConsumeLine{Item: it.Id, Qty: qtyOf(t, "2")})); err != nil {
		t.Fatal(err)
	}
	_, err := consume(t, mem, consumption(w2, uuid.New(), inventory.ConsumeLine{Item: it.Id, Qty: qtyOf(t, "2")}))
	wantProblem(t, err, "not_found")
	c := consumption(w1, uuid.New(), inventory.ConsumeLine{Item: it.Id, Qty: qtyOf(t, "2")})
	c.Corrected = true
	_, err = consume(t, mem, c)
	wantProblem(t, err, "forbidden_action")
}
