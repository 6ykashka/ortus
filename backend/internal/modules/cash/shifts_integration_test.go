//go:build integration

package cash_test

import (
	"testing"

	"github.com/google/uuid"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/modules/cash" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func fiscal(fd, kkt string) *cashapi.CashReceipt {
	return &cashapi.CashReceipt{FdNumber: &fd, KktShift: &kkt}
}

func sale(t *testing.T, e env, tc tenantctx.TenantContext, acc uuid.UUID, method cashapi.CashOperationCreateMethod, minor int, rc *cashapi.CashReceipt) *cashapi.CashOperation {
	t.Helper()
	op, req, err := e.svc.PostOperation(t.Context(), tc, &cashapi.CashOperationCreate{AccountId: acc, Amount: money(minor), Basis: new("Оплата визита"),
		Category: "service_payment", Direction: "in", OccurredAt: e.now, Method: &method, Receipt: rc})
	return wantPosted(t, op, req, err)
}

func closeBody(counted int, z *cashapi.CashShiftZ, term *cashapi.CashShiftTerminal, toSafe bool) *cashapi.CashShiftClose {
	return &cashapi.CashShiftClose{Counted: money(counted), Z: z, Terminal: term, ToSafe: &toSafe}
}

func zr(no string, cashMinor, cardMinor int) *cashapi.CashShiftZ {
	return &cashapi.CashShiftZ{Number: no, Cash: money(cashMinor), Card: money(cardMinor)}
}

// TestShiftFlow walks the shifts of a drawer with a KKT and a terminal: a payment needs an open shift, the float at the
// opening is counted (a mismatch is corrected and reported), a shift closes within the tolerance by itself, above it waits
// for a second person who recounts or accepts, the attempts of closing stay, the takings go to the safe «in transit».
func TestShiftFlow(t *testing.T) { //nolint:gocyclo // one scenario of the shifts of a drawer
	t.Parallel()
	e := newEnv(t)
	owner := e.tc(t, "a.owner", "a")
	drawer := newAccount(t, "cash_drawer", unique("Ящик смены"), unit("msk3"), "shift_mode, kkt_mode, tolerance_minor, float_minor", "blind", "manual", 10000, 500000)
	term := newAccount(t, "acquiring", unique("Терминал смены"), unit("msk3"), "drawer_account_id", drawer)
	safe := newAccount(t, "safe", unique("Сейф смены"), unit("msk3"), "")
	role(t, "a.manager-msk1", cashier, "account", drawer)
	role(t, "a.two-roles", manager, "account", drawer)
	role(t, "a.manager-msk2", manager, "account", drawer)
	cashierTC := e.tc(t, "a.manager-msk1", "a")
	m1 := e.tc(t, "a.two-roles", "a")
	reviewer := e.tc(t, "a.manager-msk2", "a")

	opening, req, err := e.svc.PostOperation(t.Context(), owner, &cashapi.CashOperationCreate{AccountId: drawer, Amount: money(500000), Basis: new("Начальный остаток"),
		Category: "opening_balance", Direction: "in", Type: new(cashapi.CashOperationCreateType("opening")), OccurredAt: e.now})
	wantPosted(t, opening, req, err)

	// a payment needs an open shift
	_, _, err = e.svc.PostOperation(t.Context(), cashierTC, &cashapi.CashOperationCreate{AccountId: drawer, Amount: money(100000), Basis: new("Оплата"),
		Category: "service_payment", Direction: "in", OccurredAt: e.now, Receipt: fiscal("900", "1")})
	wantProblem(t, err, "shift_closed")

	// shift 1: the float does not match the balance
	sh1, err := e.svc.OpenShift(t.Context(), cashierTC, drawer, &cashapi.CashShiftOpen{CountedFloat: money(480000)})
	if err != nil {
		t.Fatal(err)
	}
	if sh1.Number != 1 || sh1.Status != "open" || sh1.OpeningFloat.AmountMinor != 480000 || sh1.OpeningDiff != nil || sh1.Revision < 1 {
		t.Fatalf("shift 1 for the cashier (blind): %+v", sh1)
	}
	if balance(t, drawer) != 480000 || scalar[int](t, dbs["a"], `select count(*) from cash.operations where shift_id = $1 and type = 'adjust'`, sh1.Id) != 1 {
		t.Fatalf("the float was not corrected: balance %d", balance(t, drawer))
	}
	_, err = e.svc.OpenShift(t.Context(), cashierTC, drawer, &cashapi.CashShiftOpen{CountedFloat: money(480000)})
	wantProblem(t, err, "invalid_transition")
	sale(t, e, cashierTC, drawer, "cash", 300000, fiscal("1", "1"))
	sale(t, e, cashierTC, drawer, "card", 120000, fiscal("2", "1"))
	if balance(t, drawer) != 780000 || balance(t, term) != 120000 {
		t.Fatalf("balances %d %d", balance(t, drawer), balance(t, term))
	}
	// the Z report is required with a KKT
	_, err = e.svc.CloseShift(t.Context(), cashierTC, sh1.Id, etagOf(sh1.Revision), closeBody(780000, nil, nil, false))
	wantProblem(t, err, "validation_failed")
	_, err = e.svc.CloseShift(t.Context(), cashierTC, sh1.Id, "", closeBody(780000, zr("Z-1", 300000, 120000), nil, false))
	wantProblem(t, err, "revision_required")
	_, err = e.svc.CloseShift(t.Context(), cashierTC, sh1.Id, `"99"`, closeBody(780000, zr("Z-1", 300000, 120000), nil, false))
	wantProblem(t, err, "revision_mismatch")
	closed1, err := e.svc.CloseShift(t.Context(), cashierTC, sh1.Id, etagOf(sh1.Revision), closeBody(780000, zr("Z-1", 300000, 120000),
		&cashapi.CashShiftTerminal{Card: money(120000), Sbp: money(0)}, false))
	if err != nil {
		t.Fatal(err)
	}
	if closed1.Status != "closed" || closed1.Decision == nil || closed1.Decision.Kind != "auto" || closed1.Decision.Reason != "Без расхождений" ||
		closed1.Expected != nil || closed1.Diff != nil || len(closed1.Attempts) != 1 || closed1.Z == nil || closed1.Z.Number != "Z-1" {
		t.Fatalf("closed shift 1 (blind for the cashier): %+v", closed1)
	}
	_, err = e.svc.CloseShift(t.Context(), cashierTC, sh1.Id, etagOf(closed1.Revision), closeBody(780000, zr("Z-1", 0, 0), nil, false))
	wantProblem(t, err, "invalid_transition")

	// shift 2: above the tolerance — a second person decides
	sh2, err := e.svc.OpenShift(t.Context(), m1, drawer, &cashapi.CashShiftOpen{CountedFloat: money(780000)})
	if err != nil || sh2.Number != 2 || sh2.OpeningDiff != nil {
		t.Fatalf("shift 2 %+v, %v", sh2, err)
	}
	sale(t, e, m1, drawer, "cash", 100000, fiscal("3", "2"))
	rev2, err := e.svc.CloseShift(t.Context(), m1, sh2.Id, etagOf(sh2.Revision), closeBody(860000, zr("Z-2", 100000, 0), nil, false))
	if err != nil {
		t.Fatal(err)
	}
	if rev2.Status != "review" || rev2.Decision != nil || rev2.Expected == nil || rev2.Expected.Cash.AmountMinor != 880000 || rev2.Expected.RevCash.AmountMinor != 100000 ||
		rev2.Diff == nil || rev2.Diff.Cash.AmountMinor != -20000 || rev2.Diff.KktCash.AmountMinor != 0 {
		t.Fatalf("shift 2 waits for a decision with the sums for the manager: %+v", rev2)
	}
	review := func(tc tenantctx.TenantContext, sh cashapi.CashShift, d cashapi.CashShiftReviewDecision, reason string) (cashapi.CashShift, error) {
		return e.svc.ReviewShift(t.Context(), tc, sh.Id, etagOf(sh.Revision), &cashapi.CashShiftReview{Decision: d, Reason: reason})
	}
	_, err = review(m1, rev2, "accept", "Недостача сотрудника")
	wantProblem(t, err, "self_approval")
	_, err = review(cashierTC, rev2, "accept", "Недостача сотрудника")
	wantProblem(t, err, "forbidden_action")
	_, err = review(reviewer, rev2, "accept", "")
	wantProblem(t, err, "validation_failed")
	again, err := review(reviewer, rev2, "recount", "Пересчитайте, не сходится с Z")
	if err != nil {
		t.Fatal(err)
	}
	if again.Status != "open" || again.Counted != nil || again.Z != nil || again.Expected != nil || len(again.Attempts) != 1 ||
		again.Attempts[0].RecountReason == nil || again.Attempts[0].Counted.AmountMinor != 860000 {
		t.Fatalf("returned to a recount (the attempt is kept): %+v", again)
	}
	rev2b, err := e.svc.CloseShift(t.Context(), m1, sh2.Id, etagOf(again.Revision), closeBody(860000, zr("Z-2", 100000, 0), nil, false))
	if err != nil || rev2b.Status != "review" || len(rev2b.Attempts) != 2 {
		t.Fatalf("second attempt %+v, %v", rev2b, err)
	}
	acc2, err := review(reviewer, rev2b, "accept", "Недостача сотрудника")
	if err != nil {
		t.Fatal(err)
	}
	if acc2.Status != "closed" || acc2.Decision == nil || acc2.Decision.Kind != "accepted" || acc2.Decision.OperationId == nil || acc2.Decision.ByMemberId == nil ||
		*acc2.Decision.ByMemberId != reviewer.PersonID || balance(t, drawer) != 860000 {
		t.Fatalf("accepted shift %+v, balance %d", acc2, balance(t, drawer))
	}
	_, err = review(reviewer, acc2, "accept", "Ещё раз")
	wantProblem(t, err, "invalid_transition")

	// shift 3: the takings above the float go to the safe «in transit»
	sh3, err := e.svc.OpenShift(t.Context(), m1, drawer, &cashapi.CashShiftOpen{CountedFloat: money(860000)})
	if err != nil {
		t.Fatal(err)
	}
	c3, err := e.svc.CloseShift(t.Context(), m1, sh3.Id, etagOf(sh3.Revision), closeBody(860000, zr("Z-3", 0, 0), nil, true))
	if err != nil || c3.Status != "closed" || c3.ToSafeTransferId == nil {
		t.Fatalf("shift 3 %+v, %v", c3, err)
	}
	if balance(t, drawer) != 500000 || balance(t, safe) != 0 {
		t.Fatalf("takings in transit: drawer %d, safe %d", balance(t, drawer), balance(t, safe))
	}
	tr := scalar[string](t, dbs["a"], `select status || ':' || purpose || ':' || to_account_id::text from cash.transfers where id = $1`, *c3.ToSafeTransferId)
	if tr != "transit:shift_handover:"+safe.String() {
		t.Fatalf("transfer %s", tr)
	}

	// the lists
	list, err := e.svc.ListShifts(t.Context(), owner, cash.ShiftsQuery{AccountID: drawer})
	if err != nil || len(list.Items) != 3 {
		t.Fatalf("shifts %+v, %v", list, err)
	}
	var sum int64 // numbers 1, 2 and 3 (the order of one instant is by id)
	for _, s := range list.Items {
		sum += s.Number
	}
	if sum != 6 {
		t.Fatalf("shift numbers %d", sum)
	}
	onlyReview, err := e.svc.ListShifts(t.Context(), owner, cash.ShiftsQuery{AccountID: drawer, Status: "review"})
	if err != nil || len(onlyReview.Items) != 0 {
		t.Fatalf("review shifts %+v, %v", onlyReview, err)
	}
	ops, err := e.svc.ListOperations(t.Context(), owner, cash.OperationsQuery{ShiftID: sh1.Id})
	if err != nil || len(ops.Items) != 3 { // the correction of the float, a cash and a card payment
		t.Fatalf("operations of shift 1 %d, %v", len(ops.Items), err)
	}
	// the cashier lists the shifts blind: no sums
	mine, err := e.svc.ListShifts(t.Context(), cashierTC, cash.ShiftsQuery{AccountID: drawer})
	if err != nil || len(mine.Items) != 3 {
		t.Fatalf("shifts of the cashier %+v, %v", mine, err)
	}
	for _, s := range mine.Items {
		if s.Expected != nil || s.Diff != nil || s.OpeningDiff != nil {
			t.Errorf("sums leak to the cashier: %+v", s)
		}
	}
	if n := scalar[int](t, dbs["a"], `select count(*) from cash.shift_close_attempts where shift_id = $1`, sh2.Id); n != 2 {
		t.Errorf("attempts of the shift: %d", n)
	}
}

func etagOf(rev int64) string { return `"rev-` + itoa(rev) + `"` }

func itoa(v int64) string {
	if v == 0 {
		return "0"
	}
	var b []byte
	for ; v > 0; v /= 10 {
		b = append([]byte{byte('0' + v%10)}, b...)
	}
	return string(b)
}
