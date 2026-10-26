//go:build integration

package inventory_test

import (
	"testing"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	"github.com/ortus/ortus-crm/backend/internal/modules/inventory" //nolint:depguard // the package under test
)

func reserve(wh api.Warehouse, src uuid.UUID, lines ...api.InventoryReservationLine) api.InventoryReservationCreate {
	return api.InventoryReservationCreate{WarehouseId: wh.Id, Lines: lines,
		Source: api.ObjectRef{ModuleKey: "spa", EntityType: "appointment", EntityId: src}}
}

func rline(it api.InventoryItem, qty string) api.InventoryReservationLine {
	return api.InventoryReservationLine{ItemId: it.Id, Quantity: qty}
}

// A reservation holds quantity without a movement: available falls, onHand stays; more than available is refused;
// releasing returns the quantity, once.
func TestReserveAndRelease(t *testing.T) {
	t.Parallel()
	ctx, tc := t.Context(), owner(t)
	wh, it := warehouse(t, tc, unit("msk1")), item(t, tc, true)
	receive(t, tc, wh, it, "30", "2026-11-01")
	receive(t, tc, wh, it, "50", "")

	src := uuid.New()
	r := must(e.svc.CreateReservation(ctx, tc, reserve(wh, src, rline(it, "60"))))
	if r.Status != api.InventoryReservationStatusActive || r.Revision != 1 || len(r.Lines) != 1 || r.Lines[0].Quantity != "60" ||
		r.Source.EntityId != src || r.WarehouseId != wh.Id {
		t.Fatalf("reservation %+v", r)
	}
	wantStock(t, balance(t, tc, wh, it), "80", "60", "20")

	_, err := e.svc.CreateReservation(ctx, tc, reserve(wh, uuid.New(), rline(it, "21")))
	wantFailure(t, err, "invalid_transition", inventory.ReasonInsufficientStock)
	_, err = e.svc.CreateReservation(ctx, tc, reserve(wh, src, rline(it, "1")))
	wantFailure(t, err, "invalid_transition", "") // one active reservation of a source in a warehouse
	// An issue by another source cannot take the reserved quantity.
	_, err = post(t, tc, issue(wh, line(it, "21")))
	wantFailure(t, err, "invalid_transition", inventory.ReasonInsufficientStock)
	must(post(t, tc, issue(wh, line(it, "20"))))

	rel := must(e.svc.ReleaseReservation(ctx, tc, r.Id))
	if rel.Status != api.InventoryReservationStatusReleased || rel.Revision != 2 {
		t.Fatalf("released %+v", rel)
	}
	wantStock(t, balance(t, tc, wh, it), "60", "0", "60")
	_, err = e.svc.ReleaseReservation(ctx, tc, r.Id)
	wantFailure(t, err, "invalid_transition", inventory.ReasonReservationNotActive)
	_, err = e.svc.ReleaseReservation(ctx, tc, uuid.New())
	wantProblem(t, err, "not_found")

	active := string(api.ListInventoryReservationsParamsStatusActive)
	page := must(e.svc.ListReservations(ctx, tc, inventory.ReservationQuery{WarehouseID: &wh.Id, Status: active}))
	if len(page.Items) != 0 {
		t.Fatalf("active: %+v", page.Items)
	}
	page = must(e.svc.ListReservations(ctx, tc, inventory.ReservationQuery{WarehouseID: &wh.Id}))
	if len(page.Items) != 1 || page.Items[0].Id != r.Id {
		t.Fatalf("all: %+v", page.Items)
	}
	_, err = e.svc.ListReservations(ctx, tc, inventory.ReservationQuery{Status: "lost"})
	wantProblem(t, err, "malformed_request")
}

// An issue by the source of an active reservation consumes it: the reserved quantity is available to that issue.
func TestIssueConsumesReservation(t *testing.T) {
	t.Parallel()
	ctx, tc := t.Context(), owner(t)
	wh, it, other := warehouse(t, tc, unit("msk1")), item(t, tc, false), item(t, tc, false)
	receive(t, tc, wh, it, "10", "")
	receive(t, tc, wh, other, "10", "")
	src := uuid.New()
	r := must(e.svc.CreateReservation(ctx, tc, reserve(wh, src, rline(it, "10"), rline(other, "2"))))
	wantStock(t, balance(t, tc, wh, it), "10", "10", "0")

	got := must(post(t, tc, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindIssue, WarehouseId: wh.Id,
		Source: &api.ObjectRef{ModuleKey: "spa", EntityType: "appointment", EntityId: src}, Lines: []api.InventoryMovementLine{line(it, "9")}}))
	if got.Source == nil || got.Source.EntityId != src {
		t.Fatalf("movement %+v", got)
	}
	wantStock(t, balance(t, tc, wh, it), "1", "0", "1")      // the reservation is consumed whole, not only the issued part
	wantStock(t, balance(t, tc, wh, other), "10", "0", "10") // the other line of the reservation returns too
	page := must(e.svc.ListReservations(ctx, tc, inventory.ReservationQuery{WarehouseID: &wh.Id, Status: "consumed"}))
	if len(page.Items) != 1 || page.Items[0].Id != r.Id || page.Items[0].Status != api.InventoryReservationStatusConsumed {
		t.Fatalf("consumed: %+v", page.Items)
	}
	_, err := e.svc.ReleaseReservation(ctx, tc, r.Id)
	wantFailure(t, err, "invalid_transition", inventory.ReasonReservationNotActive)
}

func TestReservationValidation(t *testing.T) {
	t.Parallel()
	ctx, tc := t.Context(), owner(t)
	wh, it := warehouse(t, tc, unit("msk1")), item(t, tc, false)
	receive(t, tc, wh, it, "5", "")
	for name, b := range map[string]api.InventoryReservationCreate{
		"no lines":        reserve(wh, uuid.New()),
		"zero":            reserve(wh, uuid.New(), rline(it, "0")),
		"unknown item":    reserve(wh, uuid.New(), api.InventoryReservationLine{ItemId: uuid.New(), Quantity: "1"}),
		"same item twice": reserve(wh, uuid.New(), rline(it, "1"), rline(it, "1")),
		"bad module": {WarehouseId: wh.Id, Lines: []api.InventoryReservationLine{rline(it, "1")},
			Source: api.ObjectRef{ModuleKey: "Bad Key", EntityType: "appointment", EntityId: uuid.New()}},
	} {
		_, err := e.svc.CreateReservation(ctx, tc, b)
		if err == nil {
			t.Errorf("%s: no error", name)
			continue
		}
		wantFailure(t, err, "validation_failed", "")
	}
	_, err := e.svc.CreateReservation(ctx, tc, api.InventoryReservationCreate{WarehouseId: uuid.New(), Lines: []api.InventoryReservationLine{rline(it, "1")},
		Source: api.ObjectRef{ModuleKey: "spa", EntityType: "appointment", EntityId: uuid.New()}})
	wantProblem(t, err, "not_found")
}
