//go:build integration

package inventory_test

import (
	"testing"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	"github.com/ortus/ortus-crm/backend/internal/modules/inventory" //nolint:depguard // the package under test
)

// grantWarehouse gives the member a role with the actions over one warehouse (scope kind warehouse, PD-53).
func grantWarehouse(t *testing.T, member string, wh api.Warehouse, actions ...string) {
	t.Helper()
	role, by := uuid.New(), ref("person:a.owner@a")
	superExec(t, `insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, role, "Кладовщик "+sfx())
	superExec(t, `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`, role, actions, by)
	superExec(t, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version, scope_kind, scope_ref,
		include_descendants, valid, granted_by) values ('person', $1, $2, 1, 'warehouse', $3, false,
		tstzrange('2026-01-01 00:00Z', null), $4)`, ref("person:"+member+"@a"), role, wh.Id, by)
}

// The scope «warehouse»: a storekeeper of one warehouse posts and reads there only; another warehouse is as missing
// (404), a correction needs the extra right, and the lists hold only what the grant reaches.
func TestWarehouseScope(t *testing.T) {
	t.Parallel()
	ctx, own := t.Context(), owner(t)
	w1, w2, it := warehouse(t, own, unit("msk1")), warehouse(t, own, unit("msk2")), item(t, own, false)
	receive(t, own, w2, it, "9", "")
	grantWarehouse(t, "a.manager-msk2", w1, "inventory.items.read", "inventory.movements.read", "inventory.movements.post")
	mem := as(t, "a.manager-msk2", "a")

	receive(t, mem, w1, it, "5", "")
	must(post(t, mem, issue(w1, line(it, "2"))))
	wantStock(t, balance(t, mem, w1, it), "3", "0", "3")

	_, err := post(t, mem, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindReceipt, WarehouseId: w2.Id, Lines: []api.InventoryMovementLine{line(it, "1")}})
	wantProblem(t, err, "not_found")
	_, err = post(t, mem, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindTransfer, WarehouseId: w1.Id, TargetWarehouseId: &w2.Id,
		Lines: []api.InventoryMovementLine{line(it, "1")}})
	wantProblem(t, err, "not_found") // both warehouses are checked
	_, err = e.svc.CreateReservation(ctx, mem, reserve(w2, uuid.New(), rline(it, "1")))
	wantProblem(t, err, "not_found")
	_, err = post(t, mem, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindAdjustment, WarehouseId: w1.Id, Reason: new("пересчёт"),
		AdjustmentDirection: new(api.Increase), Lines: []api.InventoryMovementLine{line(it, "1")}})
	wantProblem(t, err, "forbidden_action") // visible, but the correction needs inventory.consumption.override
	_, err = e.svc.CreateWarehouse(ctx, mem, api.WarehouseCreate{Name: "Свой " + sfx(), OrgUnitId: unit("msk1")})
	wantProblem(t, err, "not_found") // no inventory.warehouses.manage at all: the unit is not visible to the member

	whs := must(e.svc.ListWarehouses(ctx, mem, inventory.PageQuery{Limit: 200}))
	if len(whs.Items) != 1 || whs.Items[0].Id != w1.Id {
		t.Fatalf("warehouses of the member: %+v", whs.Items)
	}
	bals := must(e.svc.ListBalances(ctx, mem, inventory.BalanceQuery{}))
	for _, b := range bals.Items {
		if b.WarehouseId != w1.Id {
			t.Fatalf("a balance of another warehouse: %+v", b)
		}
	}
	mv := must(e.svc.ListMovements(ctx, mem, inventory.PageQuery{Limit: 200}))
	for _, m := range mv.Items {
		if m.WarehouseId != w1.Id {
			t.Fatalf("a movement of another warehouse: %+v", m)
		}
	}
	items := must(e.svc.ListItems(ctx, mem, inventory.PageQuery{Limit: 200}))
	found := false
	for _, x := range items.Items {
		found = found || x.Id == it.Id
	}
	if !found {
		t.Fatalf("the items of the unit of the warehouse are not visible: %+v", items.Items)
	}
	// The balance of w2 is not reachable through the filter either.
	if b := must(e.svc.ListBalances(ctx, mem, inventory.BalanceQuery{WarehouseID: &w2.Id})); len(b.Items) != 0 {
		t.Fatalf("filter on a foreign warehouse: %+v", b.Items)
	}
}

// A member without any inventory grant sees empty lists.
func TestNoGrant(t *testing.T) {
	t.Parallel()
	ctx, own := t.Context(), owner(t)
	warehouse(t, own, unit("msk1"))
	mem := as(t, "a.driver-msk1", "a")
	if page := must(e.svc.ListWarehouses(ctx, mem, inventory.PageQuery{})); len(page.Items) != 0 {
		t.Fatalf("warehouses: %+v", page.Items)
	}
}
