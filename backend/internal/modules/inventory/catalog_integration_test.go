//go:build integration

package inventory_test

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	"github.com/ortus/ortus-crm/backend/internal/modules/inventory" //nolint:depguard // the package under test
)

// A warehouse belongs to an org unit (D-20): a name is unique within the unit, the unit must exist.
func TestWarehouses(t *testing.T) {
	t.Parallel()
	ctx, tc := t.Context(), owner(t)
	name := "Основной " + sfx()
	code := "M1"
	w := must(e.svc.CreateWarehouse(ctx, tc, api.WarehouseCreate{Name: "  " + name + "  ", Code: &code, OrgUnitId: unit("msk1")}))
	if w.Name != name || w.OrgUnitId != unit("msk1") || w.Revision != 1 || w.Archived || w.Code == nil || *w.Code != "M1" || w.Id == uuid.Nil {
		t.Fatalf("warehouse %+v", w)
	}
	_, err := e.svc.CreateWarehouse(ctx, tc, api.WarehouseCreate{Name: strings.ToUpper(name), OrgUnitId: unit("msk1")})
	wantFailure(t, err, "invalid_transition", "")
	if _, err := e.svc.CreateWarehouse(ctx, tc, api.WarehouseCreate{Name: name, OrgUnitId: unit("msk2")}); err != nil {
		t.Fatalf("the same name in another unit: %v", err)
	}
	_, err = e.svc.CreateWarehouse(ctx, tc, api.WarehouseCreate{Name: "  ", OrgUnitId: unit("msk1")})
	wantFailure(t, err, "validation_failed", "")
	_, err = e.svc.CreateWarehouse(ctx, tc, api.WarehouseCreate{Name: "Без подразделения " + sfx(), OrgUnitId: uuid.New()})
	wantFailure(t, err, "validation_failed", "")

	page := must(e.svc.ListWarehouses(ctx, tc, inventory.PageQuery{Limit: 200}))
	found := false
	for _, x := range page.Items {
		found = found || x.Id == w.Id
	}
	if !found {
		t.Fatalf("the warehouse is not in the list: %+v", page.Items)
	}
	// Tenant B sees nothing of tenant A (AC-02): its own database.
	if other := must(e.svc.ListWarehouses(ctx, as(t, "b.owner", "b"), inventory.PageQuery{})); len(other.Items) != 0 {
		t.Fatalf("tenant B lists %+v", other.Items)
	}
}

func TestWarehousePaging(t *testing.T) {
	t.Parallel()
	ctx, tc := t.Context(), owner(t)
	for range 3 {
		warehouse(t, tc, unit("msk2"))
	}
	first := must(e.svc.ListWarehouses(ctx, tc, inventory.PageQuery{Limit: 2}))
	if len(first.Items) != 2 || first.NextCursor == nil {
		t.Fatalf("first page %+v", first)
	}
	second := must(e.svc.ListWarehouses(ctx, tc, inventory.PageQuery{Limit: 2, Cursor: *first.NextCursor}))
	if len(second.Items) == 0 || second.Items[0].Id == first.Items[0].Id || second.Items[0].Id == first.Items[1].Id {
		t.Fatalf("second page repeats the first: %+v", second)
	}
	_, err := e.svc.ListWarehouses(ctx, tc, inventory.PageQuery{Cursor: "not-a-cursor"})
	wantProblem(t, err, "malformed_request")
	_, err = e.svc.ListWarehouses(ctx, tc, inventory.PageQuery{Limit: 201})
	wantProblem(t, err, "malformed_request")
}

// An item has an exact base unit and a unique sku within the unit; the patch edits name, minimum level and archive with
// If-Match; archived items leave the list of allowed definitions.
func TestItems(t *testing.T) {
	t.Parallel()
	ctx, tc := t.Context(), owner(t)
	sku := "ITEM-" + sfx()
	it := must(e.svc.CreateItem(ctx, tc, api.InventoryItemCreate{Name: "Крем", Sku: sku, BaseUnit: api.InventoryItemCreateBaseUnitG, TrackLots: true, OrgUnitId: unit("msk1")}))
	if it.Sku != sku || it.BaseUnit != api.InventoryItemBaseUnitG || !it.TrackLots || it.Revision != 1 || it.MinLevel != nil {
		t.Fatalf("item %+v", it)
	}
	_, err := e.svc.CreateItem(ctx, tc, api.InventoryItemCreate{Name: "Другой", Sku: strings.ToLower(sku), BaseUnit: api.InventoryItemCreateBaseUnitG, OrgUnitId: unit("msk1")})
	wantFailure(t, err, "invalid_transition", "")
	_, err = e.svc.CreateItem(ctx, tc, api.InventoryItemCreate{Name: "", Sku: "X-" + sfx(), BaseUnit: api.InventoryItemCreateBaseUnitG, OrgUnitId: unit("msk1")})
	wantFailure(t, err, "validation_failed", "")
	_, err = e.svc.CreateItem(ctx, tc, api.InventoryItemCreate{Name: "Кг", Sku: "X-" + sfx(), BaseUnit: "bucket", OrgUnitId: unit("msk1")})
	wantFailure(t, err, "validation_failed", "")
}

// The patch edits the name and the minimum level under If-Match, then archives: archived items leave the list.
func TestUpdateItem(t *testing.T) {
	t.Parallel()
	ctx, tc := t.Context(), owner(t)
	it := item(t, tc, true)
	minLevel, name := "2.5", "Крем питательный"
	_, err := e.svc.UpdateItem(ctx, tc, it.Id, "", api.InventoryItemPatch{MinLevel: &minLevel})
	wantProblem(t, err, "revision_required")
	_, err = e.svc.UpdateItem(ctx, tc, it.Id, `"rev-9"`, api.InventoryItemPatch{MinLevel: &minLevel})
	wantProblem(t, err, "revision_mismatch")
	_, err = e.svc.UpdateItem(ctx, tc, it.Id, `"rev-1"`, api.InventoryItemPatch{})
	wantFailure(t, err, "validation_failed", "")
	bad := "-1"
	_, err = e.svc.UpdateItem(ctx, tc, it.Id, `"rev-1"`, api.InventoryItemPatch{MinLevel: &bad})
	wantFailure(t, err, "validation_failed", "")
	_, err = e.svc.UpdateItem(ctx, tc, uuid.New(), `"rev-1"`, api.InventoryItemPatch{MinLevel: &minLevel})
	wantProblem(t, err, "not_found")

	up := must(e.svc.UpdateItem(ctx, tc, it.Id, `"rev-1"`, api.InventoryItemPatch{MinLevel: &minLevel, Name: &name}))
	if up.Revision != 2 || up.MinLevel == nil || *up.MinLevel != "2.5" || up.Name != name {
		t.Fatalf("updated %+v", up)
	}
	_, err = e.svc.UpdateItem(ctx, tc, it.Id, `"rev-1"`, api.InventoryItemPatch{MinLevel: &minLevel})
	wantProblem(t, err, "revision_mismatch")

	listed := func() bool {
		page := must(e.svc.ListItems(ctx, tc, inventory.PageQuery{Limit: 200}))
		for _, x := range page.Items {
			if x.Id == it.Id {
				return true
			}
		}
		return false
	}
	if !listed() {
		t.Fatal("the item is not listed")
	}
	yes := true
	must(e.svc.UpdateItem(ctx, tc, it.Id, `"rev-2"`, api.InventoryItemPatch{Archived: &yes}))
	if listed() {
		t.Fatal("an archived item is listed")
	}
}

// The minimum level makes belowMinimum of the balance true (D-20).
func TestBelowMinimum(t *testing.T) {
	t.Parallel()
	ctx, tc := t.Context(), owner(t)
	wh, it := warehouse(t, tc, unit("msk1")), item(t, tc, false)
	minLevel := "10"
	must(e.svc.UpdateItem(ctx, tc, it.Id, `"rev-1"`, api.InventoryItemPatch{MinLevel: &minLevel}))
	receive(t, tc, wh, it, "8", "")
	b := balance(t, tc, wh, it)
	if !b.BelowMinimum || b.MinLevel == nil || *b.MinLevel != "10" {
		t.Fatalf("balance %+v: 8 on hand under the minimum 10", b)
	}
	receive(t, tc, wh, it, "2", "")
	if b = balance(t, tc, wh, it); b.BelowMinimum {
		t.Fatalf("balance %+v: 10 on hand is not under 10", b)
	}
	yes := true
	page := must(e.svc.ListBalances(ctx, tc, inventory.BalanceQuery{WarehouseID: &wh.Id, BelowMinimum: &yes}))
	if len(page.Items) != 0 {
		t.Fatalf("below minimum: %+v", page.Items)
	}
}
