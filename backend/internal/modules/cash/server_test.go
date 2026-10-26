package cash

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

var testNow = time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)

func second[T any](_ T, err error) error { return err }

// TestServerWithoutTenant: without a tenant context every operation answers like a missing tenant (404).
func TestServerWithoutTenant(t *testing.T) {
	t.Parallel()
	h := Server{S: &Service{}}
	ctx := context.Background()
	for name, err := range map[string]error{
		"ListCashAccounts":          second(h.ListCashAccounts(ctx, cashapi.ListCashAccountsRequestObject{})),
		"CreateCashAccount":         second(h.CreateCashAccount(ctx, cashapi.CreateCashAccountRequestObject{})),
		"PreviewCashAccountAccess":  second(h.PreviewCashAccountAccess(ctx, cashapi.PreviewCashAccountAccessRequestObject{})),
		"IssueCashAdvance":          second(h.IssueCashAdvance(ctx, cashapi.IssueCashAdvanceRequestObject{})),
		"ReturnCashAdvance":         second(h.ReturnCashAdvance(ctx, cashapi.ReturnCashAdvanceRequestObject{})),
		"SubmitAdvanceReceipt":      second(h.SubmitAdvanceReceipt(ctx, cashapi.SubmitAdvanceReceiptRequestObject{})),
		"OpenCashShift":             second(h.OpenCashShift(ctx, cashapi.OpenCashShiftRequestObject{})),
		"ListCashApprovalRequests":  second(h.ListCashApprovalRequests(ctx, cashapi.ListCashApprovalRequestsRequestObject{})),
		"DecideCashApprovalRequest": second(h.DecideCashApprovalRequest(ctx, cashapi.DecideCashApprovalRequestRequestObject{})),
		"ListCashCategories":        second(h.ListCashCategories(ctx, cashapi.ListCashCategoriesRequestObject{})),
		"FindCashDuplicates":        second(h.FindCashDuplicates(ctx, cashapi.FindCashDuplicatesRequestObject{})),
		"ListCashOperations":        second(h.ListCashOperations(ctx, cashapi.ListCashOperationsRequestObject{})),
		"PostCashOperation":         second(h.PostCashOperation(ctx, cashapi.PostCashOperationRequestObject{})),
		"ReverseCashOperation":      second(h.ReverseCashOperation(ctx, cashapi.ReverseCashOperationRequestObject{})),
		"LinkCashOperationSource":   second(h.LinkCashOperationSource(ctx, cashapi.LinkCashOperationSourceRequestObject{})),
		"ListCashProposals":         second(h.ListCashProposals(ctx, cashapi.ListCashProposalsRequestObject{})),
		"DismissCashProposal":       second(h.DismissCashProposal(ctx, cashapi.DismissCashProposalRequestObject{})),
		"PostCashProposal":          second(h.PostCashProposal(ctx, cashapi.PostCashProposalRequestObject{})),
		"ListAdvanceReceipts":       second(h.ListAdvanceReceipts(ctx, cashapi.ListAdvanceReceiptsRequestObject{})),
		"DecideAdvanceReceipt":      second(h.DecideAdvanceReceipt(ctx, cashapi.DecideAdvanceReceiptRequestObject{})),
		"ListCashShifts":            second(h.ListCashShifts(ctx, cashapi.ListCashShiftsRequestObject{})),
		"CloseCashShift":            second(h.CloseCashShift(ctx, cashapi.CloseCashShiftRequestObject{})),
		"ReviewCashShift":           second(h.ReviewCashShift(ctx, cashapi.ReviewCashShiftRequestObject{})),
		"ListCashTransfers":         second(h.ListCashTransfers(ctx, cashapi.ListCashTransfersRequestObject{})),
		"CreateCashTransfer":        second(h.CreateCashTransfer(ctx, cashapi.CreateCashTransferRequestObject{})),
		"DecideCashTransfer":        second(h.DecideCashTransfer(ctx, cashapi.DecideCashTransferRequestObject{})),
	} {
		if !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s: %v, want not_found", name, err)
		}
	}
}

// TestServerRejectsRequests: a write without a body, a decision that is neither of the two and a limit outside 1…200 are
// 400 before the service (and so before the database).
func TestServerRejectsRequests(t *testing.T) {
	t.Parallel()
	h := Server{S: &Service{}}
	ctx := tenantctx.WithTenant(context.Background(), tenantctx.TenantContext{TenantID: uuid.New()})
	zero, big := 0, 201
	for name, err := range map[string]error{
		"ReverseCashOperation": second(h.ReverseCashOperation(ctx, cashapi.ReverseCashOperationRequestObject{})),
		"LinkSource":           second(h.LinkCashOperationSource(ctx, cashapi.LinkCashOperationSourceRequestObject{})),
		"Dismiss":              second(h.DismissCashProposal(ctx, cashapi.DismissCashProposalRequestObject{})),
		"DecideRequest":        second(h.DecideCashApprovalRequest(ctx, cashapi.DecideCashApprovalRequestRequestObject{})),
		"DecideRequest bad": second(h.DecideCashApprovalRequest(ctx, cashapi.DecideCashApprovalRequestRequestObject{
			Body: &cashapi.CashApprovalDecision{Decision: "maybe"}})),
		"DecideReceipt":     second(h.DecideAdvanceReceipt(ctx, cashapi.DecideAdvanceReceiptRequestObject{})),
		"DecideTransfer":    second(h.DecideCashTransfer(ctx, cashapi.DecideCashTransferRequestObject{})),
		"CreateAccount":     second(h.CreateCashAccount(ctx, cashapi.CreateCashAccountRequestObject{})),
		"PostOperation":     second(h.PostCashOperation(ctx, cashapi.PostCashOperationRequestObject{})),
		"OpenShift":         second(h.OpenCashShift(ctx, cashapi.OpenCashShiftRequestObject{})),
		"CloseShift":        second(h.CloseCashShift(ctx, cashapi.CloseCashShiftRequestObject{})),
		"ReviewShift":       second(h.ReviewCashShift(ctx, cashapi.ReviewCashShiftRequestObject{})),
		"Transfer":          second(h.CreateCashTransfer(ctx, cashapi.CreateCashTransferRequestObject{})),
		"IssueAdvance":      second(h.IssueCashAdvance(ctx, cashapi.IssueCashAdvanceRequestObject{})),
		"ReturnAdvance":     second(h.ReturnCashAdvance(ctx, cashapi.ReturnCashAdvanceRequestObject{})),
		"SubmitReceipt":     second(h.SubmitAdvanceReceipt(ctx, cashapi.SubmitAdvanceReceiptRequestObject{})),
		"PostProposal":      second(h.PostCashProposal(ctx, cashapi.PostCashProposalRequestObject{ProposalKey: "ap:1"})),
		"List accounts 0":   second(h.ListCashAccounts(ctx, cashapi.ListCashAccountsRequestObject{Params: cashapi.ListCashAccountsParams{Limit: &zero}})),
		"List accounts 201": second(h.ListCashAccounts(ctx, cashapi.ListCashAccountsRequestObject{Params: cashapi.ListCashAccountsParams{Limit: &big}})),
		"List operations 0": second(h.ListCashOperations(ctx, cashapi.ListCashOperationsRequestObject{Params: cashapi.ListCashOperationsParams{Limit: &zero}})),
		"List shifts 201":   second(h.ListCashShifts(ctx, cashapi.ListCashShiftsRequestObject{Params: cashapi.ListCashShiftsParams{Limit: &big}})),
		"List proposals 0":  second(h.ListCashProposals(ctx, cashapi.ListCashProposalsRequestObject{Params: cashapi.ListCashProposalsParams{Limit: &zero}})),
		"Bad cursor": second(h.ListCashTransfers(ctx, cashapi.ListCashTransfersRequestObject{Params: cashapi.ListCashTransfersParams{
			Cursor: new("not-a-cursor")}})),
	} {
		if !problem.Is(err, problem.CodeMalformedRequest) {
			t.Errorf("%s: %v, want malformed_request", name, err)
		}
	}
}

// TestValidateAccount: what a kind of account has and has not — a drawer has shifts, the KKT, the float and the tolerance;
// an advance its holder, the limit in hand and the default categories; a terminal its drawer and the settlement; a safe
// and a bank account none of them.
func TestValidateAccount(t *testing.T) { //nolint:gocyclo // a table of the checks of the kinds of accounts
	t.Parallel()
	unit, holder, drawer := uuid.New(), uuid.New(), uuid.New()
	mode, kkt := cashapi.CashAccountCreateShiftModeBlind, cashapi.CashAccountCreateKktModeManual
	m := func(v int) *cashapi.Money { return &cashapi.Money{AmountMinor: v, Currency: "RUB"} }
	base := func(kind cashapi.CashAccountCreateKind) cashapi.CashAccountCreate {
		return cashapi.CashAccountCreate{Name: "  Касса  ", Kind: kind, Currency: "RUB", OrgUnitId: &unit, ShiftMode: &mode, KktMode: &kkt,
			FloatAmount: m(500000), Tolerance: m(10000), BalanceLimit: m(9000000), AdvanceLimit: m(300000), HolderMemberId: &holder,
			DrawerAccountId: &drawer, SettleDays: new(1), FeeBasisPoints: new(180)}
	}
	b := base("cash_drawer")
	in, err := validateAccount(&b)
	if err != nil || in.Name != "Касса" || in.ShiftMode != "blind" || in.KktMode != "manual" || in.Float == nil || *in.Float != 500000 || in.Holder != nil ||
		in.Drawer != nil || in.Advance != nil || in.SettleDays != nil {
		t.Fatalf("drawer %+v, %v", in, err)
	}
	b = base("advance")
	in, err = validateAccount(&b)
	if err != nil || in.Holder == nil || in.Advance == nil || *in.Advance != 300000 || in.ShiftMode != "none" || in.KktMode != "none" || in.Float != nil ||
		len(in.Categories) != 4 || in.Categories[0] != "fuel" {
		t.Fatalf("advance %+v, %v", in, err)
	}
	b = base("acquiring")
	in, err = validateAccount(&b)
	if err != nil || in.Drawer == nil || in.SettleDays == nil || in.Fee == nil || in.Holder != nil || in.Float != nil || in.ShiftMode != "none" {
		t.Fatalf("terminal %+v, %v", in, err)
	}
	for _, kind := range []cashapi.CashAccountCreateKind{"safe", "bank", "virtual"} {
		b = base(kind)
		in, err = validateAccount(&b)
		if err != nil || in.Holder != nil || in.Drawer != nil || in.Float != nil || in.Advance != nil || in.ShiftMode != "none" || in.SettleDays != nil {
			t.Fatalf("%s %+v, %v", kind, in, err)
		}
	}
	bad := map[string]func(*cashapi.CashAccountCreate){
		"advance without a holder": func(b *cashapi.CashAccountCreate) { b.Kind, b.HolderMemberId = "advance", nil },
		"terminal without drawer":  func(b *cashapi.CashAccountCreate) { b.Kind, b.DrawerAccountId = "acquiring", nil },
		"one letter":               func(b *cashapi.CashAccountCreate) { b.Name = "К" },
		"a name of spaces":         func(b *cashapi.CashAccountCreate) { b.Name = "    " },
		"dollars":                  func(b *cashapi.CashAccountCreate) { b.Currency = "USD" },
		"negative float":           func(b *cashapi.CashAccountCreate) { b.FloatAmount = m(-1) },
		"limit in dollars":         func(b *cashapi.CashAccountCreate) { b.BalanceLimit = &cashapi.Money{AmountMinor: 1, Currency: "USD"} },
		"settlement 40 days":       func(b *cashapi.CashAccountCreate) { b.Kind, b.SettleDays = "acquiring", new(40) },
		"fee above 100 %":          func(b *cashapi.CashAccountCreate) { b.Kind, b.FeeBasisPoints = "acquiring", new(10001) },
	}
	for name, mutate := range bad {
		b := base("cash_drawer")
		mutate(&b)
		if _, err := validateAccount(&b); err == nil {
			t.Errorf("%s: want error", name)
		}
	}
	if _, err := validateAccount(nil); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("no body: %v", err)
	}
}

// TestValidateManual: the body of postCashOperation is checked before the database: the amount, the kind, the basis, the
// refund against its payment, the related object and the source.
func TestValidateManual(t *testing.T) { //nolint:gocyclo // a table of the checks of a manual operation
	t.Parallel()
	s := &Service{Now: nil}
	ok := cashapi.CashOperationCreate{AccountId: uuid.New(), Amount: rub(150000), Basis: new("Абонемент № 215"), Category: "service_payment", Direction: "in"}
	m, err := s.validateManual(&ok)
	if err != nil || m.Type != "in" || m.Amount != 150000 || m.Basis != "Абонемент № 215" || m.Occurred.IsZero() || m.action() != actionPost || m.limitKind() != "" {
		t.Fatalf("receipt %+v, %v", m, err)
	}
	refund := ok
	refund.Category, refund.Direction = "refund", "out"
	if _, err := s.validateManual(&refund); err == nil {
		t.Error("a refund without a payment")
	}
	id := uuid.New()
	refund.RefundsOperationId = &id
	if m, err = s.validateManual(&refund); err != nil || m.action() != actionRefund || m.limitKind() != "refund" || m.Refunds == nil {
		t.Fatalf("refund %+v, %v", m, err)
	}
	opening := ok
	opening.Type, opening.Category = new(cashapi.CashOperationCreateType("opening")), "opening_balance"
	if m, err = s.validateManual(&opening); err != nil || m.action() != actionManage {
		t.Fatalf("opening %+v, %v", m, err)
	}
	bads := map[string]func(*cashapi.CashOperationCreate){
		"no amount":       func(b *cashapi.CashOperationCreate) { b.Amount = rub(0) },
		"no basis":        func(b *cashapi.CashOperationCreate) { b.Basis = nil },
		"wrong direction": func(b *cashapi.CashOperationCreate) { b.Direction = "out" },
		"bad related": func(b *cashapi.CashOperationCreate) {
			b.RelatedObject = &cashapi.ObjectRef{ModuleKey: "SPA", EntityType: "visit", EntityId: uuid.New()}
		},
		"bad source": func(b *cashapi.CashOperationCreate) {
			b.Source = &cashapi.CashSourceRef{Key: "x", Kind: "spa", Id: uuid.New()}
		},
		"source no id": func(b *cashapi.CashOperationCreate) { b.Source = &cashapi.CashSourceRef{Key: "ap:1", Kind: "spa"} },
	}
	for name, mutate := range bads {
		b := ok
		mutate(&b)
		if _, err := s.validateManual(&b); err == nil {
			t.Errorf("%s: want error", name)
		}
	}
	good := ok
	good.RelatedObject = &cashapi.ObjectRef{ModuleKey: "spa", EntityType: "visit", EntityId: uuid.New()}
	good.Source = &cashapi.CashSourceRef{Key: "ap:1", Kind: "spa", Id: uuid.New()}
	if m, err = s.validateManual(&good); err != nil || m.Source == nil || m.Related == nil {
		t.Fatalf("related and source %+v, %v", m, err)
	}
	if _, err := s.validateManual(nil); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("no body: %v", err)
	}
}

// TestPaging: the page size is 1…200 (0 means the default), a cursor is an opaque keyset position.
func TestPaging(t *testing.T) {
	t.Parallel()
	if n, err := (PageQuery{}).size(); err != nil || n != defaultPageLimit {
		t.Errorf("default %d, %v", n, err)
	}
	for _, v := range []int{-1, 201} {
		if _, err := (PageQuery{Limit: v}).size(); err == nil {
			t.Errorf("limit %d: want error", v)
		}
	}
	id := uuid.New()
	at := (PageQuery{Cursor: encodeCursor(testNow, id)})
	_, pos, after, err := at.page()
	if err != nil || after != id || pos == nil {
		t.Fatalf("cursor %v %v %v", pos, after, err)
	}
	if _, _, _, err := (PageQuery{Cursor: "x"}).page(); err == nil {
		t.Error("a bad cursor")
	}
	c, err := decodeKeyCursor(encodeKeyCursor(testNow, "ap:1"))
	if err != nil || c.Key != "ap:1" {
		t.Fatalf("key cursor %+v, %v", c, err)
	}
	if _, err := decodeKeyCursor(encodeCursor(testNow, id)); err == nil {
		t.Error("a cursor of another list")
	}
}

// TestRequestDTO: the stored payload of an approval request reads back with its source key.
func TestRequestDTO(t *testing.T) {
	t.Parallel()
	kind, id := "spa", uuid.New()
	r := requestRow{ID: uuid.New(), Currency: "RUB", Amount: 5000, Status: "pending", Type: "out", SourceKind: &kind, SourceID: &id,
		Payload: payload{SourceKey: "ap:1"}, Limit: new(int64(100))}
	d := r.dto()
	if d.Source == nil || d.Source.Key != "ap:1" || d.Limit == nil || d.Limit.AmountMinor != 100 || d.Amount.AmountMinor != 5000 || d.Method != nil {
		t.Fatalf("dto %+v", d)
	}
	r.Payload.SourceKey = ""
	if r.dto().Source != nil {
		t.Error("a source without its key")
	}
}

// TestConflicts: the pairs of duties one person holds together.
func TestConflicts(t *testing.T) {
	t.Parallel()
	if got := conflictsOf(map[string]bool{actionPost: true, actionApprove: true, actionShift: true, actionReconcile: true}); len(got) != 2 {
		t.Errorf("conflicts %v", got)
	}
	if got := conflictsOf(map[string]bool{actionPost: true, actionReconcile: true}); len(got) != 0 {
		t.Errorf("conflicts %v", got)
	}
}

// TestFormatRub: rub() of the prototype — thousands by non-breaking spaces, kopecks only when there are some.
func TestFormatRub(t *testing.T) {
	t.Parallel()
	cases := map[int64]string{0: "0 ₽", 100: "1 ₽", 150: "1,5 ₽", 1234567: "12 345,67 ₽", -34000: "−340 ₽", 100000000: "1 000 000 ₽"}
	for in, want := range cases {
		if got := formatRub(in); got != want {
			t.Errorf("formatRub(%d) = %q, want %q", in, got, want)
		}
	}
}
