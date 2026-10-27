//go:build integration

package spa_test

import (
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	invapi "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	api "github.com/ortus/ortus-crm/backend/internal/api/spa"
	"github.com/ortus/ortus-crm/backend/internal/modules/spa" //nolint:depguard // the package under test
)

// salon is a service with a recipe (25 ml of oil, 10 g of cream kept in kilograms), a room, a warehouse of the unit and
// a booked visit that has not happened yet.
type salon struct {
	svc        api.SpaService
	oil, cream invapi.InventoryItem
	wh         invapi.Warehouse
	a          api.Appointment
	d          time.Time
}

func newSalon(t *testing.T, stock bool) salon {
	t.Helper()
	own := owner(t)
	s := salon{d: day(), wh: warehouse(t, own),
		oil: material(t, own, invapi.InventoryItemCreateBaseUnitMl), cream: material(t, own, invapi.InventoryItemCreateBaseUnitKg)}
	if stock {
		receive(t, own, s.wh, s.oil, "100")
		receive(t, own, s.wh, s.cream, "1")
	}
	s.svc = treatment(t, own, nil, recipeLine(s.oil, "25", api.Ml), recipeLine(s.cream, "10", api.G))
	s.a = book(t, own, booking(s.svc, person("a.driver-msk1"), resource(t, "room", unit("msk1")), nil, clock(s.d, 10, 0)))
	return s
}

func performedAt(s salon) api.AppointmentPerformance {
	return api.AppointmentPerformance{PerformedAt: clock(s.d, 11, 0)}
}

// The fact of the treatment is stored apart from the accounting: the visit moves to performed_pending_posting, the
// stock is untouched and the cash desk is not asked; a repeat creates no second fact.
func TestPerformanceIsTheFactOnly(t *testing.T) {
	t.Parallel()
	ctx, own := t.Context(), owner(t)
	s := newSalon(t, true)

	_, err := e.svc.RecordPerformance(ctx, own, s.a.Id, "", performedAt(s))
	wantProblem(t, err, "revision_required")
	_, err = e.svc.RecordPerformance(ctx, own, s.a.Id, tag(s.a), api.AppointmentPerformance{PerformedAt: clock(s.d, 9, 0)})
	wantRefusal(t, err, "validation_failed", "", "performedAt") // before the visit began
	_, err = e.svc.RecordPerformance(ctx, own, s.a.Id, tag(s.a), api.AppointmentPerformance{PerformedAt: clock(s.d, 11, 0).AddDate(1, 0, 0)})
	wantRefusal(t, err, "validation_failed", "", "performedAt") // in the future

	p := must(e.svc.RecordPerformance(ctx, own, s.a.Id, tag(s.a), performedAt(s)))
	if p.Status != api.AppointmentStatusPerformedPendingPosting || p.PerformedAt == nil || !p.PerformedAt.Equal(clock(s.d, 11, 0)) || p.Revision != 2 {
		t.Fatalf("performed: %+v", p)
	}
	if got := onHand(t, own, s.wh, s.oil); got != "100" {
		t.Fatalf("the fact moved the stock: %s", got)
	}
	if len(e.offers.of(s.a.Id)) != 0 {
		t.Fatal("the fact asked the cash desk for money")
	}
	again := must(e.svc.RecordPerformance(ctx, own, s.a.Id, tag(p), api.AppointmentPerformance{PerformedAt: clock(s.d, 11, 30)}))
	if again.Revision != 2 || !again.PerformedAt.Equal(clock(s.d, 11, 0)) {
		t.Fatalf("a repeat made a second fact: %+v", again)
	}

	pending := must(e.svc.ListAppointments(ctx, own, spa.AppointmentQuery{Status: "performed_pending_posting", PageQuery: spa.PageQuery{Limit: 200}}))
	found := false
	for _, a := range pending.Items {
		found = found || a.Id == s.a.Id
	}
	if !found {
		t.Fatalf("the unfinished accounting is not listed: %+v", pending.Items)
	}

	// A cancelled visit cannot be performed, and a visit cannot be completed before its performance.
	c := newSalon(t, true)
	_, err = e.svc.Complete(ctx, own, c.a.Id, tag(c.a), api.AppointmentComplete{WarehouseId: c.wh.Id, Overrides: []api.ConsumptionOverride{}})
	wantRefusal(t, err, "invalid_transition", spa.ReasonNotInStatus, "")
	x := must(e.svc.Cancel(ctx, own, c.a.Id, tag(c.a), api.AppointmentCancel{Reason: "x"}))
	_, err = e.svc.RecordPerformance(ctx, own, c.a.Id, tag(x), performedAt(c))
	wantRefusal(t, err, "invalid_transition", spa.ReasonNotInStatus, "")
}

func (s *salon) performed(t *testing.T) {
	t.Helper()
	s.a = must(e.svc.RecordPerformance(t.Context(), owner(t), s.a.Id, tag(s.a), performedAt(*s)))
}

func noOverrides(wh invapi.Warehouse) api.AppointmentComplete {
	return api.AppointmentComplete{WarehouseId: wh.Id, Overrides: []api.ConsumptionOverride{}}
}

// The completion issues the recipe of the booked revision once: in the units of the items (10 g of cream is 0.01 kg),
// as one movement of the visit, and asks the cash desk for the price of the visit; a repeat issues nothing more.
func TestCompletionConsumesOnce(t *testing.T) { //nolint:gocyclo // one scenario of one visit
	t.Parallel()
	ctx, own := t.Context(), owner(t)
	s := newSalon(t, true)
	s.performed(t)

	// The service is edited after the booking: the visit keeps its snapshot (the old recipe and the old price).
	must(e.svc.UpdateService(ctx, own, s.svc.Id, `"rev-1"`, api.SpaServicePatch{
		Price: &api.Money{AmountMinor: 999900, Currency: "RUB"}, Recipe: &[]api.ConsumptionRecipeLine{recipeLine(s.oil, "99", api.Ml)}}))

	done := must(e.svc.Complete(ctx, own, s.a.Id, tag(s.a), noOverrides(s.wh)))
	if done.Appointment.Status != api.AppointmentStatusCompleted || done.Appointment.Revision != 3 || len(done.InventoryMovementIds) != 1 {
		t.Fatalf("completion: %+v", done)
	}
	if got := onHand(t, own, s.wh, s.oil); got != "75" {
		t.Fatalf("oil on hand %s, want 75 (100 − 25 by the snapshot)", got)
	}
	if got := onHand(t, own, s.wh, s.cream); got != "0.99" {
		t.Fatalf("cream on hand %s, want 0.99 kg", got)
	}
	if n := superInt(t, `select count(*) from inventory.movements where source_module = 'spa' and source_type = 'appointment' and source_id = $1`, s.a.Id); n != 1 {
		t.Fatalf("movements of the visit: %d", n)
	}
	offered := e.offers.of(s.a.Id)
	if len(offered) != 1 || offered[0].AmountMinor != 450000 {
		t.Fatalf("the cash desk was offered %+v, want the price of the snapshot 4500.00", offered)
	}

	// A repeat (a retry after a lost answer, a second click): the same answer, no second issue, no second offer.
	again := must(e.svc.Complete(ctx, own, s.a.Id, tag(done.Appointment), noOverrides(s.wh)))
	if again.Appointment.Revision != 3 || len(again.InventoryMovementIds) != 1 || again.InventoryMovementIds[0] != done.InventoryMovementIds[0] {
		t.Fatalf("repeat: %+v", again)
	}
	if got := onHand(t, own, s.wh, s.oil); got != "75" {
		t.Fatalf("the repeat issued again: %s", got)
	}
	if len(e.offers.of(s.a.Id)) != 1 {
		t.Fatal("the repeat asked the cash desk again")
	}
	if n := superInt(t, `select count(*) from spa.completions where appointment_id = $1`, s.a.Id); n != 1 {
		t.Fatalf("completions: %d", n)
	}
}

// Ten parallel completions of one visit issue the recipe exactly once (AC-07).
func TestCompletionParallelOnce(t *testing.T) {
	t.Parallel()
	own := owner(t)
	s := newSalon(t, true)
	s.performed(t)

	var wg sync.WaitGroup
	for range 10 {
		wg.Go(func() {
			if _, err := e.svc.Complete(t.Context(), own, s.a.Id, tag(s.a), noOverrides(s.wh)); err != nil {
				if f, ok := asRefusal(err); !ok || f.Code != "invalid_transition" {
					t.Errorf("unexpected error: %v", err)
				}
			}
		})
	}
	wg.Wait()
	if got := onHand(t, own, s.wh, s.oil); got != "75" {
		t.Fatalf("oil on hand %s, want 75: the recipe was issued %s times", got, got)
	}
	if n := superInt(t, `select count(*) from inventory.movements where source_id = $1`, s.a.Id); n != 1 {
		t.Fatalf("movements of the visit: %d", n)
	}
}

// A shortage does not lose the fact: the visit stays performed_pending_posting, nothing is issued (no negative stock), and
// after the stock is corrected the same command completes it once.
func TestCompletionShortageKeepsTheFact(t *testing.T) {
	t.Parallel()
	ctx, own := t.Context(), owner(t)
	s := newSalon(t, false)
	receive(t, own, s.wh, s.oil, "10") // 25 ml are needed
	receive(t, own, s.wh, s.cream, "1")
	s.performed(t)

	_, err := e.svc.Complete(ctx, own, s.a.Id, tag(s.a), noOverrides(s.wh))
	wantRefusal(t, err, "invalid_transition", spa.ReasonInsufficientStock, "")
	got := must(e.svc.GetAppointment(ctx, own, s.a.Id))
	if got.Status != api.AppointmentStatusPerformedPendingPosting || got.PerformedAt == nil || got.Revision != s.a.Revision {
		t.Fatalf("after the shortage: %+v", got)
	}
	if onHand(t, own, s.wh, s.oil) != "10" || onHand(t, own, s.wh, s.cream) != "1" {
		t.Fatal("a refused completion moved the stock (the cream line must roll back with the oil line)")
	}
	if n := superInt(t, `select count(*) from spa.completions where appointment_id = $1`, s.a.Id); n != 0 {
		t.Fatalf("completions after the shortage: %d", n)
	}
	if len(e.offers.of(s.a.Id)) != 0 {
		t.Fatal("the cash desk was offered a visit that is not completed")
	}

	receive(t, own, s.wh, s.oil, "50")
	done := must(e.svc.Complete(ctx, own, s.a.Id, tag(got), noOverrides(s.wh)))
	if done.Appointment.Status != api.AppointmentStatusCompleted || onHand(t, own, s.wh, s.oil) != "35" {
		t.Fatalf("retry: %+v, oil %s", done.Appointment, onHand(t, own, s.wh, s.oil))
	}
}

// A practitioner with the purpose-limited grant (the visit and the consumption from one warehouse) completes his own
// visit, but cannot change the quantities without the extra right; the owner changes them with a reason that is kept.
func TestCompletionOverrideAndPractitionerGrant(t *testing.T) {
	t.Parallel()
	ctx, own := t.Context(), owner(t)
	s := newSalon(t, true)
	s.performed(t)
	grant(t, "a.driver-msk1", "self", nil, "spa.appointments.read", "spa.appointments.complete")
	grant(t, "a.driver-msk1", "warehouse", &s.wh.Id, "inventory.consume")
	me := as(t, "a.driver-msk1", "a")

	spent := []api.ConsumptionOverride{{ItemId: s.oil.Id, ActualQuantity: "30", Reason: "густая кожа"}}
	_, err := e.svc.Complete(ctx, me, s.a.Id, tag(s.a), api.AppointmentComplete{WarehouseId: s.wh.Id, Overrides: spent})
	wantProblem(t, err, "forbidden_action")
	_, err = e.svc.Complete(ctx, me, s.a.Id, tag(s.a), api.AppointmentComplete{WarehouseId: warehouse(t, own).Id, Overrides: []api.ConsumptionOverride{}})
	wantProblem(t, err, "not_found") // a warehouse outside the grant is as missing
	if onHand(t, own, s.wh, s.oil) != "100" {
		t.Fatal("a refused completion moved the stock")
	}

	done := must(e.svc.Complete(ctx, own, s.a.Id, tag(s.a), api.AppointmentComplete{WarehouseId: s.wh.Id, Overrides: spent,
		FinalPrice: &api.Money{AmountMinor: 400000, Currency: "RUB"}, Note: new("скидка постоянному клиенту")}))
	if onHand(t, own, s.wh, s.oil) != "70" || onHand(t, own, s.wh, s.cream) != "0.99" {
		t.Fatalf("on hand: oil %s cream %s, want 70 and 0.99", onHand(t, own, s.wh, s.oil), onHand(t, own, s.wh, s.cream))
	}
	if done.Appointment.FinalPrice == nil || done.Appointment.FinalPrice.AmountMinor != 400000 {
		t.Fatalf("final price: %+v", done.Appointment.FinalPrice)
	}
	if o := e.offers.of(s.a.Id); len(o) != 1 || o[0].AmountMinor != 400000 {
		t.Fatalf("offered %+v, want the price by the fact 4000.00", o)
	}
	if n := superInt(t, `select jsonb_array_length(overrides) from spa.completions where appointment_id = $1`, s.a.Id); n != 1 {
		t.Fatalf("overrides kept: %d", n)
	}

	// The practitioner completes his own visit by the norm.
	c := newSalon(t, false)
	receive(t, own, c.wh, c.oil, "100")
	receive(t, own, c.wh, c.cream, "1")
	c.performed(t)
	grant(t, "a.driver-msk1", "warehouse", &c.wh.Id, "inventory.consume")
	if got := must(e.svc.Complete(ctx, me, c.a.Id, tag(c.a), noOverrides(c.wh))); got.Appointment.Status != api.AppointmentStatusCompleted {
		t.Fatalf("by the practitioner: %+v", got.Appointment)
	}
}

func TestCompletionRefusals(t *testing.T) {
	t.Parallel()
	ctx, own := t.Context(), owner(t)
	s := newSalon(t, true)
	s.performed(t)
	other := material(t, own, invapi.InventoryItemCreateBaseUnitMl)

	_, err := e.svc.Complete(ctx, own, s.a.Id, "", noOverrides(s.wh))
	wantProblem(t, err, "revision_required")
	_, err = e.svc.Complete(ctx, own, s.a.Id, tag(s.a), api.AppointmentComplete{WarehouseId: s.wh.Id,
		Overrides: []api.ConsumptionOverride{{ItemId: other.Id, ActualQuantity: "1", Reason: "r"}}})
	wantRefusal(t, err, "validation_failed", "", "overrides[0].itemId")
	_, err = e.svc.Complete(ctx, own, s.a.Id, tag(s.a), api.AppointmentComplete{WarehouseId: uuid.New(), Overrides: []api.ConsumptionOverride{}})
	wantProblem(t, err, "not_found")
	_, err = e.svc.Complete(ctx, own, s.a.Id, `"rev-1"`, noOverrides(s.wh))
	wantProblem(t, err, "revision_mismatch")
	_, err = e.svc.Complete(ctx, as(t, "b.owner", "b"), s.a.Id, tag(s.a), noOverrides(s.wh))
	wantProblem(t, err, "not_found")
	if onHand(t, own, s.wh, s.oil) != "100" {
		t.Fatal("a refused completion moved the stock")
	}
}

// A visit with an empty recipe completes without a movement.
func TestCompletionWithoutRecipe(t *testing.T) {
	t.Parallel()
	ctx, own, d := t.Context(), owner(t), day()
	svc := treatment(t, own, nil)
	a := book(t, own, booking(svc, person("a.driver-msk1"), resource(t, "room", unit("msk1")), nil, clock(d, 10, 0)))
	a = must(e.svc.RecordPerformance(ctx, own, a.Id, tag(a), api.AppointmentPerformance{PerformedAt: clock(d, 11, 0)}))
	done := must(e.svc.Complete(ctx, own, a.Id, tag(a), noOverrides(warehouse(t, own))))
	if done.Appointment.Status != api.AppointmentStatusCompleted || len(done.InventoryMovementIds) != 0 {
		t.Fatalf("completion: %+v", done)
	}
}
