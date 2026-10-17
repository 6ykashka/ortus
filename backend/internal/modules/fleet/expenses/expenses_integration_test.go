//go:build integration

package expenses_test

import (
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/expenses" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// TestCreateExpense: the driver records an expense of his started trip (S2-08): the six categories of the answer of
// 17.10 to D-12, «прочее» with a comment, fuel with litres; the expense waits for the manager (pending).
func TestCreateExpense(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	drv := e.tc(t, "a.driver-msk1", "a")
	tr := seedTrip(t, "msk1", person("a.driver-msk1"), "rework")
	b := wash(t, tr)
	got, err := e.svc.Create(ctx, drv, tr.ID, b)
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	expect(t, "Create", got, got.TripId == tr.ID, got.Kind == "wash", got.Amount == b.Amount,
		got.OccurredAt.Equal(time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC)), slices.Equal(got.ReceiptFileIds, b.ReceiptFileIds),
		got.ReviewState == fleetapi.TripExpenseReviewStatePending, got.Revision == 1, got.Quantity == nil, got.Comment == nil)
	d := dbs["a"]
	expect(t, "audit rows", nil, scalar[int](t, d, `select count(*) from audit.events where action = 'fleet.expense.create'
	   and target_id = $1`, got.Id) == 1)
	expect(t, "outbox rows", nil, scalar[int](t, d, `select count(*) from outbox.events where type = 'fleet.expense.claimed.v1'
	   and aggregate_id = $1`, got.Id) == 1)
	expect(t, "claimed by", nil, scalar[uuid.UUID](t, d, `select claimed_by from fleet.expenses where id = $1`, got.Id) == person("a.driver-msk1"))
	moreKinds(t, e, tr, got)
}

// moreKinds records fuel with litres, «прочее» with a comment and tire service after first and reads them back by
// pages.
func moreKinds(t *testing.T, e env, tr trip, first fleetapi.TripExpense) {
	t.Helper()
	ctx := t.Context()
	drv := e.tc(t, "a.driver-msk1", "a")
	fuel := wash(t, tr)
	fuel.Kind, fuel.Quantity = "fuel", new("40.50")
	f, err := e.svc.Create(ctx, drv, tr.ID, fuel)
	if err != nil {
		t.Fatalf("fuel: %v", err)
	}
	expect(t, "fuel", f, f.Kind == "fuel", f.Quantity != nil && *f.Quantity == "40.5")
	other := wash(t, tr)
	other.Kind, other.Comment = "other", new("Замена лампы фары")
	o, err := e.svc.Create(ctx, drv, tr.ID, other)
	if err != nil {
		t.Fatalf("other: %v", err)
	}
	expect(t, "other", o, o.Comment != nil && *o.Comment == "Замена лампы фары")
	tire := wash(t, tr)
	tire.Kind = "tire_service"
	if _, err := e.svc.Create(ctx, drv, tr.ID, tire); err != nil {
		t.Fatalf("tire_service: %v", err)
	}

	page, err := e.svc.List(ctx, drv, tr.ID, expenses.PageQuery{Limit: 2})
	if err != nil || page.NextCursor == nil {
		t.Fatalf("List page 1 = %+v, %v", page, err)
	}
	expect(t, "List page 1", page, len(page.Items) == 2 && page.Items[0].Id == first.Id)
	page, err = e.svc.List(ctx, drv, tr.ID, expenses.PageQuery{Limit: 2, Cursor: *page.NextCursor})
	if err != nil {
		t.Fatalf("List page 2: %v", err)
	}
	expect(t, "List page 2", page, len(page.Items) == 2 && page.Items[0].Id == o.Id, page.NextCursor == nil)
	one, err := e.svc.Get(ctx, e.tc(t, "a.manager-msk1", "a"), tr.ID, f.Id)
	if err != nil {
		t.Fatalf("Get by the manager: %v", err)
	}
	expect(t, "Get by the manager", one, one.Id == f.Id)
}

// TestCreateExpenseRefusals: what createTripExpense refuses (the texts of the mock W2.00 and of W2.40).
func TestCreateExpenseRefusals(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	drv := e.tc(t, "a.driver-msk1", "a")
	tr := seedTrip(t, "msk1", person("a.driver-msk1"), "rework")

	other := wash(t, tr)
	other.Kind = "other"
	_, err := e.svc.Create(ctx, drv, tr.ID, other)
	wantProblem(t, err, "validation_failed", "Для категории «Прочее» добавьте комментарий")
	zero := wash(t, tr)
	zero.Amount.AmountMinor = 0
	_, err = e.svc.Create(ctx, drv, tr.ID, zero)
	wantProblem(t, err, "amount_invalid", "Сумма должна быть больше нуля")

	pending := wash(t, tr)
	pending.ReceiptFileIds = []uuid.UUID{receipt(t, tr.ID, "expense_receipt", "scanning")}
	_, err = e.svc.Create(ctx, drv, tr.ID, pending)
	wantProblem(t, err, "photo_not_ready", "Фото чека ещё не загружено")
	photo := wash(t, tr)
	photo.ReceiptFileIds = []uuid.UUID{receipt(t, tr.ID, "inspection", "ready")}
	_, err = e.svc.Create(ctx, drv, tr.ID, photo)
	wantProblem(t, err, "validation_failed", "Чек не относится к этому рейсу.")
	elsewhere := seedTrip(t, "msk1", person("a.driver-msk1"), "rework")
	foreign := wash(t, elsewhere)
	_, err = e.svc.Create(ctx, drv, tr.ID, foreign)
	wantProblem(t, err, "validation_failed", "Чек не относится к этому рейсу.")
	twice := wash(t, tr)
	if _, err := e.svc.Create(ctx, drv, tr.ID, twice); err != nil {
		t.Fatalf("Create: %v", err)
	}
	_, err = e.svc.Create(ctx, drv, tr.ID, twice)
	wantProblem(t, err, "validation_failed", "Чек уже прикреплён к другому расходу.")

	_, err = e.svc.Create(ctx, e.tc(t, "a.manager-msk1", "a"), tr.ID, wash(t, tr))
	wantProblem(t, err, problem.CodeForbiddenAction, "")
	_, err = e.svc.Create(ctx, e.tc(t, "a.driver-msk2", "a"), tr.ID, wash(t, tr))
	wantProblem(t, err, problem.CodeNotFound, "Рейс не найден.")
	_, err = e.svc.Create(ctx, e.tc(t, "b.owner", "b"), tr.ID, wash(t, tr))
	wantProblem(t, err, problem.CodeNotFound, "Рейс не найден.")
	_, err = e.svc.Create(ctx, drv, uuid.New(), wash(t, tr))
	wantProblem(t, err, problem.CodeNotFound, "Рейс не найден.")

	for _, state := range []string{"submitted", "accepted"} {
		closed := seedTrip(t, "msk1", person("a.driver-msk1"), state)
		_, err = e.svc.Create(ctx, drv, closed.ID, wash(t, closed))
		wantProblem(t, err, "invalid_transition", "Расходы добавляются в рейсе и при сдаче.")
	}
}

// TestExpenseReads: the expenses of a trip are read with the trip (fleet.expenses.read over its unit or as its
// driver); a foreign, an invisible and a missing expense are one 404.
func TestExpenseReads(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	tr := seedTrip(t, "msk1", person("a.driver-msk1"), "rework")
	x, err := e.svc.Create(ctx, e.tc(t, "a.driver-msk1", "a"), tr.ID, wash(t, tr))
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	for _, c := range []struct {
		actor, tenant string
		trip, id      uuid.UUID
		detail        string
	}{
		{"a.manager-msk2", "a", tr.ID, x.Id, "Рейс не найден."},
		{"a.driver-msk2", "a", tr.ID, x.Id, "Рейс не найден."},
		{"b.owner", "b", tr.ID, x.Id, "Рейс не найден."},
		{"a.owner", "a", tr.ID, uuid.New(), "Расход не найден."},
		{"a.owner", "a", uuid.New(), x.Id, "Рейс не найден."},
	} {
		_, err := e.svc.Get(ctx, e.tc(t, c.actor, c.tenant), c.trip, c.id)
		wantProblem(t, err, problem.CodeNotFound, c.detail)
	}
	other := seedTrip(t, "msk1", person("a.driver-msk1"), "rework")
	_, err = e.svc.Get(ctx, e.tc(t, "a.owner", "a"), other.ID, x.Id)
	wantProblem(t, err, problem.CodeNotFound, "Расход не найден.")
	_, err = e.svc.List(ctx, e.tc(t, "a.manager-msk2", "a"), tr.ID, expenses.PageQuery{})
	wantProblem(t, err, problem.CodeNotFound, "Рейс не найден.")
	page, err := e.svc.List(ctx, e.tc(t, "a.region-msk", "a"), tr.ID, expenses.PageQuery{})
	if err != nil || len(page.Items) != 1 || page.Items[0].Id != x.Id {
		t.Fatalf("List by the region = %+v, %v", page, err)
	}
	_, err = e.svc.List(ctx, e.tc(t, "a.owner", "a"), tr.ID, expenses.PageQuery{Cursor: "garbage"})
	wantProblem(t, err, problem.CodeMalformedRequest, "")
}

// TestCreateExpenseOnRoute: an expense on the route — the trip is on_route.
func TestCreateExpenseOnRoute(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	tr := seedTrip(t, "msk2", person("a.driver-msk2"), "on_route")
	if _, err := e.svc.Create(t.Context(), e.tc(t, "a.driver-msk2", "a"), tr.ID, wash(t, tr)); err != nil {
		t.Fatalf("Create on the route: %v", err)
	}
}
