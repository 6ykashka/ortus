//go:build integration

package spa_test

import (
	"testing"

	"github.com/google/uuid"

	invapi "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	api "github.com/ortus/ortus-crm/backend/internal/api/spa"
	"github.com/ortus/ortus-crm/backend/internal/modules/spa" //nolint:depguard // the package under test
)

// A service keeps its duration, buffers, price, equipment and recipe; an edit grows the revision under If-Match, the
// recipe is replaced whole, a stale or missing revision is refused (412, 428).
func TestServiceLifecycle(t *testing.T) { //nolint:gocyclo // one scenario of one service
	t.Parallel()
	ctx, own := t.Context(), owner(t)
	oil, cream := material(t, own, invapi.InventoryItemCreateBaseUnitMl), material(t, own, invapi.InventoryItemCreateBaseUnitKg)
	lamp := resource(t, "equipment", unit("msk1"))

	svc := treatment(t, own, []uuid.UUID{lamp}, recipeLine(oil, "25", api.Ml), recipeLine(cream, "10", api.G))
	if svc.Revision != 1 || svc.DurationMinutes != 60 || svc.BufferBeforeMinutes != 5 || svc.BufferAfterMinutes != 15 ||
		len(svc.Recipe) != 2 || len(svc.RequiredEquipmentIds) != 1 || svc.Price.AmountMinor != 450000 {
		t.Fatalf("service: %+v", svc)
	}
	got := must(e.svc.GetService(ctx, own, svc.Id))
	if got.Id != svc.Id || got.Recipe[0].Quantity != "25" || got.Recipe[1].Unit != api.G {
		t.Fatalf("read back: %+v", got)
	}

	_, err := e.svc.UpdateService(ctx, own, svc.Id, "", api.SpaServicePatch{BufferAfterMinutes: new(int64(20))})
	wantProblem(t, err, "revision_required")
	_, err = e.svc.UpdateService(ctx, own, svc.Id, `"rev-9"`, api.SpaServicePatch{BufferAfterMinutes: new(int64(20))})
	wantProblem(t, err, "revision_mismatch")
	_, err = e.svc.UpdateService(ctx, own, svc.Id, `"rev-1"`, api.SpaServicePatch{})
	wantRefusal(t, err, "validation_failed", "", "body")

	upd := must(e.svc.UpdateService(ctx, own, svc.Id, `"rev-1"`, api.SpaServicePatch{
		Price: &api.Money{AmountMinor: 500000, Currency: "RUB"}, BufferAfterMinutes: new(int64(20)),
		Recipe: &[]api.ConsumptionRecipeLine{recipeLine(oil, "30", api.Ml)}}))
	if upd.Revision != 2 || upd.Price.AmountMinor != 500000 || upd.BufferAfterMinutes != 20 || upd.BufferBeforeMinutes != 5 ||
		len(upd.Recipe) != 1 || upd.Recipe[0].Quantity != "30" || len(upd.RequiredEquipmentIds) != 1 {
		t.Fatalf("updated: %+v", upd)
	}
	if n := superInt(t, `select count(*) from spa.service_revisions where service_id = $1`, svc.Id); n != 2 {
		t.Fatalf("revisions kept: %d, want 2 (the snapshot of each)", n)
	}

	page := must(e.svc.ListServices(ctx, own, spa.PageQuery{Limit: 200}))
	found := false
	for _, s := range page.Items {
		found = found || (s.Id == svc.Id && s.Revision == 2)
	}
	if !found {
		t.Fatalf("the service is not listed: %+v", page.Items)
	}
}

func TestServiceRefusals(t *testing.T) {
	t.Parallel()
	ctx, own := t.Context(), owner(t)
	oil := material(t, own, invapi.InventoryItemCreateBaseUnitMl)
	base := api.SpaServiceCreate{OrgUnitId: unit("msk1"), Name: "Уход " + sfx(), DurationMinutes: 30, Price: money(100000),
		RequiredEquipmentIds: []uuid.UUID{}, Recipe: []api.ConsumptionRecipeLine{}}

	b := base
	b.Recipe = []api.ConsumptionRecipeLine{recipeLine(oil, "5", api.G)} // grams of a millilitre item: no coefficient
	_, err := e.svc.CreateService(ctx, own, b)
	wantRefusal(t, err, "validation_failed", "", "recipe[0].unit")

	b = base
	b.RequiredEquipmentIds = []uuid.UUID{uuid.New()}
	_, err = e.svc.CreateService(ctx, own, b)
	wantRefusal(t, err, "validation_failed", "", "requiredEquipmentIds[0]")

	b = base
	b.RequiredEquipmentIds = []uuid.UUID{resource(t, "room", unit("msk1"))} // a room is not equipment
	_, err = e.svc.CreateService(ctx, own, b)
	wantRefusal(t, err, "validation_failed", "", "requiredEquipmentIds[0]")

	b = base
	b.OrgUnitId = uuid.New()
	_, err = e.svc.CreateService(ctx, own, b)
	wantRefusal(t, err, "validation_failed", "", "orgUnitId")

	must(e.svc.CreateService(ctx, own, base))
	_, err = e.svc.CreateService(ctx, own, base)
	wantRefusal(t, err, "invalid_transition", "", "") // the name is taken in the unit

	b = base
	b.Name = ""
	_, err = e.svc.CreateService(ctx, own, b)
	wantRefusal(t, err, "validation_failed", "", "name")

	_, err = e.svc.GetService(ctx, own, uuid.New())
	wantProblem(t, err, "not_found")
}

// A member without the grant over the unit sees no services and cannot make one; another tenant never sees them.
func TestServiceScope(t *testing.T) {
	t.Parallel()
	ctx, own := t.Context(), owner(t)
	svc := treatment(t, own, nil)

	mem := as(t, "a.driver-msk1", "a")
	page := must(e.svc.ListServices(ctx, mem, spa.PageQuery{Limit: 200}))
	if len(page.Items) != 0 {
		t.Fatalf("services of a member without a grant: %+v", page.Items)
	}
	_, err := e.svc.GetService(ctx, mem, svc.Id)
	wantProblem(t, err, "not_found")

	b := as(t, "b.owner", "b")
	_, err = e.svc.GetService(ctx, b, svc.Id)
	wantProblem(t, err, "not_found")
	if page := must(e.svc.ListServices(ctx, b, spa.PageQuery{Limit: 200})); len(page.Items) != 0 {
		t.Fatalf("services of tenant B: %+v", page.Items)
	}
}
