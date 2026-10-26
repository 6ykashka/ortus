//go:build integration

package inventory_test

import (
	"errors"
	"slices"
	"sync"
	"testing"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/inventory"
	"github.com/ortus/ortus-crm/backend/internal/modules/inventory" //nolint:depguard // the package under test
)

func issue(wh api.Warehouse, lines ...api.InventoryMovementLine) api.InventoryMovementCreate {
	return api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindIssue, WarehouseId: wh.Id, Lines: lines}
}

func lotsOf(b api.InventoryBalance) []string {
	out := make([]string, 0, len(b.Lots))
	for _, l := range b.Lots {
		exp := "-"
		if l.ExpiresOn != nil {
			exp = l.ExpiresOn.Format("2006-01-02")
		}
		out = append(out, exp+"="+l.OnHand)
	}
	return out
}

func wantLots(t *testing.T, b api.InventoryBalance, want ...string) {
	t.Helper()
	if got := lotsOf(b); !slices.Equal(got, want) {
		t.Fatalf("lots %v, want %v", got, want)
	}
}

// D-20 FEFO: an issue without lotId takes lots by expiry, the earliest first, lots without expiry last; an expired lot
// is not issued; more than available is refused whole.
func TestIssueFEFO(t *testing.T) {
	t.Parallel()
	tc := owner(t)
	wh, it := warehouse(t, tc, unit("msk1")), item(t, tc, true)
	receive(t, tc, wh, it, "100", "")
	lotA := receive(t, tc, wh, it, "30", "2026-11-01")
	receive(t, tc, wh, it, "50", "2027-01-10")
	expired := receive(t, tc, wh, it, "20", "2026-09-30") // the clock of the tests is 2026-10-01

	if len(lotA.Lines) != 1 || lotA.Lines[0].LotId == nil || lotA.Kind != api.InventoryMovementKindReceipt || lotA.WarehouseId != wh.Id {
		t.Fatalf("receipt %+v", lotA)
	}
	b := balance(t, tc, wh, it)
	wantStock(t, b, "200", "0", "200")
	wantLots(t, b, "2026-09-30=20", "2026-11-01=30", "2027-01-10=50", "-=100")

	m := must(post(t, tc, issue(wh, line(it, "70"))))
	if m.Kind != api.InventoryMovementKindIssue || len(m.Lines) != 2 || m.Lines[0].Quantity != "30" || m.Lines[1].Quantity != "40" ||
		*m.Lines[0].LotId != *lotA.Lines[0].LotId {
		t.Fatalf("issue %+v: want 30 of the earliest lot and 40 of the next", m.Lines)
	}
	b = balance(t, tc, wh, it)
	wantStock(t, b, "130", "0", "130")
	wantLots(t, b, "2026-09-30=20", "2027-01-10=10", "-=100")

	_, err := post(t, tc, issue(wh, line(it, "111"))) // 110 good stock, the rest only in the expired lot
	wantFailure(t, err, "invalid_transition", inventory.ReasonLotExpired)
	_, err = post(t, tc, issue(wh, line(it, "131")))
	wantFailure(t, err, "invalid_transition", inventory.ReasonInsufficientStock)
	wantStock(t, balance(t, tc, wh, it), "130", "0", "130") // refused whole

	l := line(it, "1")
	l.LotId = expired.Lines[0].LotId
	_, err = post(t, tc, issue(wh, l))
	wantFailure(t, err, "invalid_transition", inventory.ReasonLotExpired)

	must(post(t, tc, issue(wh, line(it, "110"))))
	wantLots(t, balance(t, tc, wh, it), "2026-09-30=20")

	// An expired lot is written off by an adjustment with a reason.
	must(post(t, tc, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindAdjustment, WarehouseId: wh.Id,
		AdjustmentDirection: new(api.Decrease), Reason: new("Списание просрочки"),
		Lines: []api.InventoryMovementLine{{ItemId: it.Id, Quantity: "20", LotId: expired.Lines[0].LotId}}}))
	wantStock(t, balance(t, tc, wh, it), "0", "0", "0")
}

func TestStockWithoutLots(t *testing.T) {
	t.Parallel()
	tc := owner(t)
	wh, it := warehouse(t, tc, unit("msk1")), item(t, tc, false)
	r := receive(t, tc, wh, it, "12.5", "")
	if r.Lines[0].LotId != nil {
		t.Fatalf("an item without lots has a lot: %+v", r.Lines)
	}
	receive(t, tc, wh, it, "0.000001", "")
	wantStock(t, balance(t, tc, wh, it), "12.500001", "0", "12.500001")
	_, err := post(t, tc, issue(wh, line(it, "13")))
	wantFailure(t, err, "invalid_transition", inventory.ReasonInsufficientStock)
	must(post(t, tc, issue(wh, line(it, "12.500001"))))
	wantStock(t, balance(t, tc, wh, it), "0", "0", "0")

	l := expiring(line(it, "1"), "2027-01-01")
	_, err = post(t, tc, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindReceipt, WarehouseId: wh.Id, Lines: []api.InventoryMovementLine{l}})
	wantFailure(t, err, "validation_failed", "") // an expiry belongs to an item with lots
}

func TestMovementValidation(t *testing.T) {
	t.Parallel()
	tc := owner(t)
	wh, it := warehouse(t, tc, unit("msk1")), item(t, tc, false)
	for name, b := range map[string]api.InventoryMovementCreate{
		"no lines":      {Kind: api.InventoryMovementCreateKindReceipt, WarehouseId: wh.Id},
		"zero":          {Kind: api.InventoryMovementCreateKindReceipt, WarehouseId: wh.Id, Lines: []api.InventoryMovementLine{line(it, "0")}},
		"bad quantity":  {Kind: api.InventoryMovementCreateKindReceipt, WarehouseId: wh.Id, Lines: []api.InventoryMovementLine{line(it, "1e3")}},
		"unknown item":  {Kind: api.InventoryMovementCreateKindReceipt, WarehouseId: wh.Id, Lines: []api.InventoryMovementLine{{ItemId: uuid.New(), Quantity: "1"}}},
		"unknown kind":  {Kind: "burn", WarehouseId: wh.Id, Lines: []api.InventoryMovementLine{line(it, "1")}},
		"transfer none": {Kind: api.InventoryMovementCreateKindTransfer, WarehouseId: wh.Id, Lines: []api.InventoryMovementLine{line(it, "1")}},
		"transfer self": {Kind: api.InventoryMovementCreateKindTransfer, WarehouseId: wh.Id, TargetWarehouseId: &wh.Id, Lines: []api.InventoryMovementLine{line(it, "1")}},
		"target on receipt": {Kind: api.InventoryMovementCreateKindReceipt, WarehouseId: wh.Id, TargetWarehouseId: &wh.Id,
			Lines: []api.InventoryMovementLine{line(it, "1")}},
		"adjustment without direction": {Kind: api.InventoryMovementCreateKindAdjustment, WarehouseId: wh.Id, Reason: new("пересчёт"),
			Lines: []api.InventoryMovementLine{line(it, "1")}},
		"adjustment without reason": {Kind: api.InventoryMovementCreateKindAdjustment, WarehouseId: wh.Id,
			AdjustmentDirection: new(api.Increase), Lines: []api.InventoryMovementLine{line(it, "1")}},
		"reversal without original": {Kind: api.InventoryMovementCreateKindReversal, WarehouseId: wh.Id, Reason: new("ошибка"),
			Lines: []api.InventoryMovementLine{line(it, "1")}},
	} {
		_, err := post(t, tc, b)
		if _, ok := errors.AsType[*inventory.RefusalError](err); !ok {
			t.Errorf("%s: error %v, want a failure", name, err)
			continue
		}
		wantFailure(t, err, "validation_failed", "")
	}
	_, err := post(t, tc, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindReceipt, WarehouseId: uuid.New(), Lines: []api.InventoryMovementLine{line(it, "1")}})
	wantProblem(t, err, "not_found")
}

// A transfer moves lots with their expiry to the other warehouse; the reversal returns them and is possible once.
func TestTransferAndReversal(t *testing.T) {
	t.Parallel()
	tc := owner(t)
	from, to, it := warehouse(t, tc, unit("msk1")), warehouse(t, tc, unit("msk2")), item(t, tc, true)
	receive(t, tc, from, it, "30", "2026-11-01")
	receive(t, tc, from, it, "10", "")

	m := must(post(t, tc, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindTransfer, WarehouseId: from.Id,
		TargetWarehouseId: &to.Id, Lines: []api.InventoryMovementLine{line(it, "35")}}))
	if m.Kind != api.InventoryMovementKindTransfer || m.TargetWarehouseId == nil || *m.TargetWarehouseId != to.Id {
		t.Fatalf("transfer %+v", m)
	}
	wantLots(t, balance(t, tc, from, it), "-=5")
	wantLots(t, balance(t, tc, to, it), "2026-11-01=30", "-=5")

	_, err := post(t, tc, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindTransfer, WarehouseId: from.Id,
		TargetWarehouseId: &to.Id, Lines: []api.InventoryMovementLine{line(it, "6")}})
	wantFailure(t, err, "invalid_transition", inventory.ReasonInsufficientStock)

	rev := api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindReversal, WarehouseId: from.Id, ReversesMovementId: &m.Id}
	_, err = post(t, tc, rev)
	wantFailure(t, err, "validation_failed", "") // a reversal needs a reason
	rev.Reason = new("Перепутали склад")
	r := must(post(t, tc, rev))
	if r.Kind != api.InventoryMovementKindReversal || r.WarehouseId != from.Id {
		t.Fatalf("reversal %+v", r)
	}
	wantLots(t, balance(t, tc, from, it), "2026-11-01=30", "-=10")
	wantStock(t, balance(t, tc, to, it), "0", "0", "0")

	_, err = post(t, tc, rev)
	wantFailure(t, err, "invalid_transition", "") // once
	_, err = post(t, tc, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindReversal, WarehouseId: from.Id,
		ReversesMovementId: &r.Id, Reason: new("ещё раз")})
	wantFailure(t, err, "invalid_transition", "") // a reversal is not reversed

	bad := rev
	bad.ReversesMovementId, bad.WarehouseId = &m.Id, to.Id
	_, err = post(t, tc, bad)
	wantFailure(t, err, "validation_failed", "") // the warehouse of the original
}

func TestReversalOfReceiptAndIssue(t *testing.T) {
	t.Parallel()
	tc := owner(t)
	wh, it := warehouse(t, tc, unit("msk1")), item(t, tc, false)
	r := receive(t, tc, wh, it, "10", "")
	i := must(post(t, tc, issue(wh, line(it, "4"))))

	_, err := post(t, tc, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindReversal, WarehouseId: wh.Id, ReversesMovementId: &r.Id, Reason: new("ошибочный приход")})
	wantFailure(t, err, "invalid_transition", inventory.ReasonInsufficientStock) // 4 were issued: 6 left of 10

	must(post(t, tc, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindReversal, WarehouseId: wh.Id, ReversesMovementId: &i.Id, Reason: new("возврат")}))
	wantStock(t, balance(t, tc, wh, it), "10", "0", "10")
	must(post(t, tc, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindReversal, WarehouseId: wh.Id, ReversesMovementId: &r.Id, Reason: new("ошибочный приход")}))
	wantStock(t, balance(t, tc, wh, it), "0", "0", "0")
	_, err = post(t, tc, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindReversal, WarehouseId: wh.Id, ReversesMovementId: new(uuid.New()), Reason: new("нет такого")})
	wantProblem(t, err, "not_found")
}

func TestAdjustment(t *testing.T) {
	t.Parallel()
	tc := owner(t)
	wh, it := warehouse(t, tc, unit("msk1")), item(t, tc, false)
	adj := func(dir api.InventoryMovementCreateAdjustmentDirection, qty string) (api.InventoryMovement, error) {
		return post(t, tc, api.InventoryMovementCreate{Kind: api.InventoryMovementCreateKindAdjustment, WarehouseId: wh.Id,
			AdjustmentDirection: &dir, Reason: new("Пересчёт"), Lines: []api.InventoryMovementLine{line(it, qty)}})
	}
	must(adj(api.Increase, "7"))
	wantStock(t, balance(t, tc, wh, it), "7", "0", "7")
	must(adj(api.Decrease, "2"))
	wantStock(t, balance(t, tc, wh, it), "5", "0", "5")
	_, err := adj(api.Decrease, "6")
	wantFailure(t, err, "invalid_transition", inventory.ReasonInsufficientStock)
}

// The ledger lists movements newest first, with their lines.
func TestListMovements(t *testing.T) {
	t.Parallel()
	tc := owner(t)
	wh, it := warehouse(t, tc, unit("msk1")), item(t, tc, false)
	first := receive(t, tc, wh, it, "3", "")
	second := must(post(t, tc, issue(wh, line(it, "1"))))
	page := must(e.svc.ListMovements(t.Context(), tc, inventory.PageQuery{Limit: 200}))
	pos := map[uuid.UUID]int{}
	for i, x := range page.Items {
		pos[x.Id] = i + 1
		if x.Id == second.Id && (len(x.Lines) != 1 || x.Lines[0].Quantity != "1" || x.Kind != api.InventoryMovementKindIssue) {
			t.Fatalf("movement %+v", x)
		}
	}
	if pos[first.Id] == 0 || pos[second.Id] == 0 || pos[second.Id] > pos[first.Id] {
		t.Fatalf("positions %v: the newest first", pos)
	}
}

// Two issues at once cannot take the same stock (the warehouse is locked for the command).
func TestConcurrentIssues(t *testing.T) {
	t.Parallel()
	tc := owner(t)
	wh, it := warehouse(t, tc, unit("msk1")), item(t, tc, true)
	receive(t, tc, wh, it, "100", "2027-01-01")
	var wg sync.WaitGroup
	errs := make([]error, 6)
	for i := range errs {
		wg.Go(func() {
			_, errs[i] = e.svc.PostMovement(t.Context(), tc, issue(wh, line(it, "40")))
		})
	}
	wg.Wait()
	ok := 0
	for _, err := range errs {
		if err == nil {
			ok++
		}
	}
	if ok != 2 {
		t.Fatalf("%d issues of 40 succeeded out of 100 on hand: %v", ok, errs)
	}
	wantStock(t, balance(t, tc, wh, it), "20", "0", "20")
}
