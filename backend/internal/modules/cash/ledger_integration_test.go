//go:build integration

package cash_test

import (
	"testing"
	"time"

	"github.com/google/uuid"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/modules/cash" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func wantPosted(t *testing.T, op *cashapi.CashOperation, req *cashapi.CashApprovalRequest, err error) *cashapi.CashOperation {
	t.Helper()
	if err != nil || op == nil || req != nil {
		t.Fatalf("operation %v, request %v, error %v", op, req, err)
	}
	return op
}

// TestLedger: the journal moves the balance in one transaction, a physical account never goes below zero, the opening
// balance is the first operation, a refund is bound to its payment and bounded by it.
func TestLedger(t *testing.T) { //nolint:gocyclo // one scenario of the journal over one account
	t.Parallel()
	e := newEnv(t)
	owner := e.tc(t, "a.owner", "a")
	acc := newAccount(t, "cash_drawer", unique("Ящик журнал"), unit("msk1"), "")

	opening, req, err := e.svc.PostOperation(t.Context(), owner, &cashapi.CashOperationCreate{AccountId: acc, Amount: money(500000), Basis: new("Начальный остаток"),
		Category: "opening_balance", Direction: "in", Type: new(cashapi.CashOperationCreateType("opening")), OccurredAt: e.now})
	opening = wantPosted(t, opening, req, err)
	if opening.Type != "opening" || opening.Origin != "manual" || balance(t, acc) != 500000 {
		t.Fatalf("opening %+v, balance %d", opening, balance(t, acc))
	}
	_, _, err = e.svc.PostOperation(t.Context(), owner, &cashapi.CashOperationCreate{AccountId: acc, Amount: money(1000), Basis: new("Ещё раз"),
		Category: "opening_balance", Direction: "in", Type: new(cashapi.CashOperationCreateType("opening")), OccurredAt: e.now})
	wantProblem(t, err, "validation_failed")

	pay, req, err := post(t, e, owner, acc, "in", "service_payment", 150000, "Абонемент № 215")
	pay = wantPosted(t, pay, req, err)
	if balance(t, acc) != 650000 || pay.Method != "cash" || pay.Type != "in" || pay.ReversedByOperationId != nil {
		t.Fatalf("payment %+v, balance %d", pay, balance(t, acc))
	}
	_, _, err = post(t, e, owner, acc, "out", "expense", 700000, "Закупка")
	wantProblem(t, err, "insufficient_funds")
	if balance(t, acc) != 650000 {
		t.Fatalf("a refused expense moved the balance to %d", balance(t, acc))
	}
	exp, req, err := post(t, e, owner, acc, "out", "expense", 50000, "Вода для кабинетов")
	exp = wantPosted(t, exp, req, err)
	if balance(t, acc) != 600000 || exp.Direction != "out" {
		t.Fatalf("expense %+v, balance %d", exp, balance(t, acc))
	}
	for name, b := range map[string]*cashapi.CashOperationCreate{
		"нулевая сумма":      {AccountId: acc, Amount: money(0), Basis: new("Нуль"), Category: "expense", Direction: "out", OccurredAt: e.now},
		"короткое основание": {AccountId: acc, Amount: money(100), Basis: new("ab"), Category: "expense", Direction: "out", OccurredAt: e.now},
		"возврат без оплаты": {AccountId: acc, Amount: money(100), Basis: new("Возврат"), Category: "refund", Direction: "out", OccurredAt: e.now},
	} {
		if _, _, err := e.svc.PostOperation(t.Context(), owner, b); err == nil {
			t.Errorf("%s: want error", name)
		}
	}
	// a refund is bound to a payment of the same account and bounded by it
	refund := func(minor int) error {
		_, _, err := e.svc.PostOperation(t.Context(), owner, &cashapi.CashOperationCreate{AccountId: acc, Amount: money(minor), Basis: new("Отмена визита"),
			Category: "refund", Direction: "out", OccurredAt: e.now, RefundsOperationId: &pay.Id})
		return err
	}
	if err := refund(100000); err != nil {
		t.Fatal(err)
	}
	wantProblem(t, refund(60000), "validation_failed")
	if err := refund(50000); err != nil {
		t.Fatal(err)
	}
	if balance(t, acc) != 450000 {
		t.Fatalf("balance after refunds %d", balance(t, acc))
	}

	// the owner reverses his own operation (marked), a row «storno» points at it, the balance returns
	st, err := e.svc.ReverseOperation(t.Context(), owner, exp.Id, new("Ошибка ввода"))
	if err != nil {
		t.Fatal(err)
	}
	if st.Type != "storno" || st.ReversesOperationId == nil || *st.ReversesOperationId != exp.Id || st.Own == nil || !*st.Own || balance(t, acc) != 500000 {
		t.Fatalf("storno %+v, balance %d", st, balance(t, acc))
	}
	_, err = e.svc.ReverseOperation(t.Context(), owner, exp.Id, new("Ещё раз"))
	wantProblem(t, err, "invalid_transition")
	_, err = e.svc.ReverseOperation(t.Context(), owner, st.Id, new("Сторно сторно"))
	wantProblem(t, err, "invalid_transition")
	if _, err := e.svc.ReverseOperation(t.Context(), owner, exp.Id, nil); err == nil {
		t.Error("a reason is required")
	}
	// the journal row of the reversed operation reads back with its reversal
	page, err := e.svc.ListOperations(t.Context(), owner, cash.OperationsQuery{AccountID: acc})
	if err != nil {
		t.Fatal(err)
	}
	var seen bool
	for _, o := range page.Items {
		if o.Id == exp.Id {
			seen = o.ReversedByOperationId != nil && *o.ReversedByOperationId == st.Id
		}
	}
	if !seen {
		t.Errorf("the reversed operation does not point at its storno: %+v", page.Items)
	}
}

// TestReverseNeedsSecondPerson: a member does not reverse his own operation (self_approval), another one with cash.reverse
// does; without cash.reverse the answer is 403.
func TestReverseNeedsSecondPerson(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	acc := newAccount(t, "cash_drawer", unique("Ящик сторно"), unit("msk2"), "balance_minor", 1000000)
	role(t, "a.manager-msk2", manager, "account", acc)
	role(t, "a.two-roles", manager, "account", acc)
	a := e.tc(t, "a.manager-msk2", "a")
	b := e.tc(t, "a.two-roles", "a")
	op, req, err := post(t, e, a, acc, "out", "expense", 30000, "Хозрасходы")
	op = wantPosted(t, op, req, err)
	_, err = e.svc.ReverseOperation(t.Context(), a, op.Id, new("Ошибка"))
	wantProblem(t, err, "self_approval")
	st, err := e.svc.ReverseOperation(t.Context(), b, op.Id, new("Ошибка ввода"))
	if err != nil || st.Own != nil || balance(t, acc) != 1000000 {
		t.Fatalf("storno %+v %v, balance %d", st, err, balance(t, acc))
	}
	// a cashier without cash.reverse
	role(t, "a.manager-msk1", cashier, "account", acc)
	c := e.tc(t, "a.manager-msk1", "a")
	op2, req, err := post(t, e, c, acc, "in", "service_payment", 1000, "Оплата")
	op2 = wantPosted(t, op2, req, err)
	_, err = e.svc.ReverseOperation(t.Context(), c, op2.Id, new("Ошибка"))
	wantProblem(t, err, "forbidden_action")
}

// TestReceiptOfKKT: a receipt in a drawer with a KKT carries the number of the fiscal document with the shift of the KKT
// (or the mark «not printed» with a reason); the number is unique in the pair «drawer + shift of the KKT».
func TestReceiptOfKKT(t *testing.T) { //nolint:gocyclo // one scenario of the receipt of the KKT
	t.Parallel()
	e := newEnv(t)
	owner := e.tc(t, "a.owner", "a")
	acc := newAccount(t, "cash_drawer", unique("Ящик ККТ"), unit("msk1"), "kkt_mode", "manual")
	body := func(rc *cashapi.CashReceipt) *cashapi.CashOperationCreate {
		return &cashapi.CashOperationCreate{AccountId: acc, Amount: money(320000), Basis: new("Классический массаж"), Category: "service_payment", Direction: "in",
			OccurredAt: e.now, Receipt: rc}
	}
	if _, _, err := e.svc.PostOperation(t.Context(), owner, body(nil)); err == nil {
		t.Fatal("a payment without a receipt in a drawer with a KKT")
	} else {
		wantProblem(t, err, "validation_failed")
	}
	at := time.Date(2026, 10, 1, 13, 4, 0, 0, time.UTC)
	ok := &cashapi.CashReceipt{FdNumber: new("4520"), KktShift: new("118"), ReceiptAt: &at}
	op, req, err := e.svc.PostOperation(t.Context(), owner, body(ok))
	op = wantPosted(t, op, req, err)
	if op.Receipt == nil || op.Receipt.FdNumber == nil || *op.Receipt.FdNumber != "4520" || op.Receipt.ReceiptAt == nil || !op.Receipt.ReceiptAt.Equal(at) {
		t.Fatalf("receipt %+v", op.Receipt)
	}
	_, _, err = e.svc.PostOperation(t.Context(), owner, body(ok))
	wantProblem(t, err, "duplicate_receipt")
	if balance(t, acc) != 320000 {
		t.Fatalf("a refused duplicate moved the balance to %d", balance(t, acc))
	}
	// the same number in another shift of the KKT is another document
	other := &cashapi.CashReceipt{FdNumber: new("4520"), KktShift: new("119")}
	if op, req, err := e.svc.PostOperation(t.Context(), owner, body(other)); err != nil || op == nil || req != nil {
		t.Fatalf("another shift of the KKT: %v %v %v", op, req, err)
	}
	none := &cashapi.CashReceipt{None: new(true), Reason: new("ККТ не работала, чек пробьём позже")}
	op, req, err = e.svc.PostOperation(t.Context(), owner, body(none))
	op = wantPosted(t, op, req, err)
	if op.Receipt == nil || op.Receipt.None == nil || !*op.Receipt.None || op.Receipt.Reason == nil {
		t.Fatalf("receipt not printed %+v", op.Receipt)
	}
	// an expense needs no receipt of the KKT
	if op, req, err := e.svc.PostOperation(t.Context(), owner, &cashapi.CashOperationCreate{AccountId: acc, Amount: money(1000), Basis: new("Хозрасходы"),
		Category: "expense", Direction: "out", OccurredAt: e.now}); err != nil || op == nil || req != nil {
		t.Fatalf("expense %v %v %v", op, req, err)
	}
}

// TestTerminal: a card or SBP payment of a drawer goes to its terminal, a drawer without a terminal refuses it, cash is not
// taken by a terminal.
func TestTerminal(t *testing.T) { //nolint:gocyclo // one scenario of a drawer and its terminal
	t.Parallel()
	e := newEnv(t)
	owner := e.tc(t, "a.owner", "a")
	drawer := newAccount(t, "cash_drawer", unique("Ящик терминал"), unit("msk1"), "")
	lonely := newAccount(t, "cash_drawer", unique("Ящик без терминала"), unit("msk1"), "")
	term := newAccount(t, "acquiring", unique("Терминал"), unit("msk1"), "drawer_account_id", drawer)
	card := cashapi.CashOperationCreateMethod("card")
	cashM := cashapi.CashOperationCreateMethod("cash")
	b := func(acc uuid.UUID, m cashapi.CashOperationCreateMethod) *cashapi.CashOperationCreate {
		return &cashapi.CashOperationCreate{AccountId: acc, Amount: money(120000), Basis: new("Оплата картой"), Category: "service_payment", Direction: "in",
			OccurredAt: e.now, Method: &m}
	}
	op, req, err := e.svc.PostOperation(t.Context(), owner, b(drawer, card))
	op = wantPosted(t, op, req, err)
	if op.AccountId != term || balance(t, term) != 120000 || balance(t, drawer) != 0 {
		t.Fatalf("the card payment went to %s, terminal %d, drawer %d", op.AccountId, balance(t, term), balance(t, drawer))
	}
	// entering the terminal directly is the same
	if op, req, err := e.svc.PostOperation(t.Context(), owner, b(term, card)); err != nil || op == nil || req != nil || op.AccountId != term {
		t.Fatalf("terminal directly: %v %v %v", op, req, err)
	}
	for name, body := range map[string]*cashapi.CashOperationCreate{
		"нет терминала":       b(lonely, card),
		"наличные в терминал": b(term, cashM),
	} {
		if _, _, err := e.svc.PostOperation(t.Context(), owner, body); err == nil {
			t.Errorf("%s: want error", name)
		} else {
			wantProblem(t, err, "validation_failed")
		}
	}
	// the duplicate hint looks at the drawer and its terminal with the same amount, way and type
	dups, err := e.svc.FindDuplicates(t.Context(), owner, cash.DuplicatesQuery{AccountID: drawer, Amount: 120000, Method: "card", Type: "in", At: e.now})
	if err != nil || len(dups.Items) != 2 {
		t.Fatalf("duplicates %v, %v", dups, err)
	}
	if dups, err := e.svc.FindDuplicates(t.Context(), owner, cash.DuplicatesQuery{AccountID: drawer, Amount: 120000, Method: "card", Type: "in", At: e.now.Add(time.Hour)}); err != nil || len(dups.Items) != 0 {
		t.Fatalf("outside the window %v, %v", dups, err)
	}
	// an advance is not topped up by hand
	adv := newAccount(t, "advance", unique("Подотчёт ручной"), unit("msk1"), "holder_id", person("a.driver-msk1"))
	_, _, err = post(t, e, owner, adv, "in", "service_payment", 1000, "Руками")
	wantProblem(t, err, "forbidden_action")
}

// TestSourceLink: a manual operation is linked to a source by a row of its own, one source once; the journal row itself
// is not edited.
func TestSourceLink(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.tc(t, "a.owner", "a")
	acc := newAccount(t, "cash_drawer", unique("Ящик связь"), unit("msk1"), "")
	op1 := wantPostedOp(t, e, owner, acc, 320000)
	op2 := wantPostedOp(t, e, owner, acc, 320000)
	src := cashapi.CashSourceRef{Key: "ap:" + uuid.NewString(), Kind: "spa", Id: uuid.New(), Label: new("Визит 13:00")}

	link, err := e.svc.LinkSource(t.Context(), owner, op1.Id, src)
	if err != nil || link.OperationId != op1.Id || link.Source.Key != src.Key || link.LinkedByMemberId != person("a.owner") {
		t.Fatalf("link %+v, %v", link, err)
	}
	page, err := e.svc.ListOperations(t.Context(), owner, cash.OperationsQuery{AccountID: acc})
	if err != nil {
		t.Fatal(err)
	}
	for _, o := range page.Items {
		if o.Id == op1.Id && (o.Source == nil || o.Source.Key != src.Key) {
			t.Errorf("the linked operation reads without its source: %+v", o.Source)
		}
		if o.Id == op2.Id && o.Source != nil {
			t.Errorf("another operation got a source: %+v", o.Source)
		}
	}
	if n := scalar[int](t, dbs["a"], `select count(*) from cash.operations where id = $1 and source_key is not null`, op1.Id); n != 0 {
		t.Error("the journal row was edited")
	}
	_, err = e.svc.LinkSource(t.Context(), owner, op2.Id, src)
	wantProblem(t, err, "duplicate_source")
	_, err = e.svc.LinkSource(t.Context(), owner, op1.Id, cashapi.CashSourceRef{Key: "ap:" + uuid.NewString(), Kind: "spa", Id: uuid.New()})
	wantProblem(t, err, "duplicate_source")
	_, err = e.svc.LinkSource(t.Context(), owner, op2.Id, cashapi.CashSourceRef{Key: "BAD KEY", Kind: "spa", Id: uuid.New()})
	wantProblem(t, err, "validation_failed")
}

func wantPostedOp(t *testing.T, e env, tc tenantctx.TenantContext, acc uuid.UUID, minor int) *cashapi.CashOperation {
	t.Helper()
	op, req, err := post(t, e, tc, acc, "in", "service_payment", minor, "Ручная оплата")
	return wantPosted(t, op, req, err)
}
