//go:build integration

package cash_test

import (
	"testing"

	"github.com/google/uuid"
	openapi_types "github.com/oapi-codegen/runtime/types" //nolint:depguard // integration test: the date type of the generated contract

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/modules/cash" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func decideTransfer(t *testing.T, e env, tc tenantctx.TenantContext, tr cashapi.CashTransfer, d cashapi.CashTransferDecisionDecision, reason *string) (cashapi.CashTransfer, error) {
	t.Helper()
	return e.svc.DecideTransfer(t.Context(), tc, tr.Id, etagOf(tr.Revision), cash.Decision{Accept: d == "accept", Reason: reason})
}

func sendTransfer(t *testing.T, e env, tc tenantctx.TenantContext, from, to uuid.UUID, minor int) (cashapi.CashTransfer, error) {
	t.Helper()
	return e.svc.CreateTransfer(t.Context(), tc, &cashapi.CashTransferCreate{FromAccountId: from, ToAccountId: to, Amount: money(minor), Note: new("Сдача выручки")})
}

// TestTransfers: a transfer takes the money out of the sender at once and credits the receiver when it accepts; a
// rejection returns it with a reason; only the receiver decides; the sender never goes below zero.
func TestTransfers(t *testing.T) { //nolint:gocyclo // one scenario of a transfer over shared accounts
	t.Parallel()
	e := newEnv(t)
	drawer := newAccount(t, "cash_drawer", unique("Ящик перемещение"), unit("msk1"), "balance_minor", 500000)
	safe := newAccount(t, "safe", unique("Сейф перемещение"), unit("msk1"), "")
	adv := newAccount(t, "advance", unique("Подотчёт перемещение"), unit("msk1"), "holder_id", person("a.driver-msk1"))
	role(t, "a.two-roles", manager, "account", drawer)
	role(t, "a.manager-msk2", manager, "account", safe)
	role(t, "a.manager-msk1", cashier, "account", drawer)
	sender := e.tc(t, "a.two-roles", "a")
	receiver := e.tc(t, "a.manager-msk2", "a")
	outsider := e.tc(t, "a.manager-msk1", "a")
	role(t, "a.two-roles", manager, "account", safe) // the sender sees the safe

	tr, err := sendTransfer(t, e, sender, drawer, safe, 200000)
	if err != nil || tr.Status != "transit" || tr.Purpose != "transfer" || tr.OutOperationId == nil || tr.InOperationId != nil {
		t.Fatalf("transfer %+v, %v", tr, err)
	}
	if balance(t, drawer) != 300000 || balance(t, safe) != 0 {
		t.Fatalf("balances %d %d: the money is in transit", balance(t, drawer), balance(t, safe))
	}
	n := scalar[int](t, dbs["a"], `select count(*) from cash.transfers where from_account_id = $1`, drawer)
	_, err = sendTransfer(t, e, sender, drawer, safe, 900000)
	wantProblem(t, err, "insufficient_funds")
	if scalar[int](t, dbs["a"], `select count(*) from cash.transfers where from_account_id = $1`, drawer) != n || balance(t, drawer) != 300000 {
		t.Fatal("a refused transfer left a trace")
	}
	for name, c := range map[string]struct{ from, to uuid.UUID }{"себе": {drawer, drawer}, "в подотчёт": {drawer, adv}, "из подотчёта": {adv, drawer}} {
		if _, err := sendTransfer(t, e, sender, c.from, c.to, 1000); err == nil {
			t.Errorf("%s: want error", name)
		}
	}
	// the sender without the right over the receiver, an outsider: the receiver decides
	_, err = decideTransfer(t, e, outsider, tr, "accept", nil)
	wantProblem(t, err, "not_found")
	_, err = e.svc.DecideTransfer(t.Context(), receiver, tr.Id, "", cash.Decision{Accept: true})
	wantProblem(t, err, "revision_required")
	done, err := decideTransfer(t, e, receiver, tr, "accept", nil)
	if err != nil || done.Status != "done" || done.InOperationId == nil || done.DecidedByMemberId == nil || balance(t, safe) != 200000 || done.Revision != tr.Revision+1 {
		t.Fatalf("accepted %+v, %v, safe %d", done, err, balance(t, safe))
	}
	_, err = decideTransfer(t, e, receiver, done, "accept", nil)
	wantProblem(t, err, "invalid_transition")

	// a rejection needs a reason and returns the money
	tr2, err := sendTransfer(t, e, sender, drawer, safe, 100000)
	if err != nil {
		t.Fatal(err)
	}
	_, err = decideTransfer(t, e, receiver, tr2, "reject", nil)
	wantProblem(t, err, "validation_failed")
	rej, err := decideTransfer(t, e, receiver, tr2, "reject", new("Не сошлась сумма"))
	if err != nil || rej.Status != "rejected" || rej.BackOperationId == nil || rej.Reason == nil || balance(t, drawer) != 300000 || balance(t, safe) != 200000 {
		t.Fatalf("rejected %+v, %v, drawer %d", rej, err, balance(t, drawer))
	}
	list, err := e.svc.ListTransfers(t.Context(), sender, cash.TransfersQuery{AccountID: drawer})
	if err != nil || len(list.Items) < 2 {
		t.Fatalf("list %+v, %v", list, err)
	}
	if tr3, err := sendTransfer(t, e, sender, drawer, safe, 1000); err != nil {
		t.Fatal(err)
	} else if l, err := e.svc.ListTransfers(t.Context(), sender, cash.TransfersQuery{Status: "transit", AccountID: drawer}); err != nil || len(l.Items) != 1 || l.Items[0].Id != tr3.Id {
		t.Fatalf("transit %+v, %v", l, err)
	}
}

func today(e env, plusDays int) openapi_types.Date {
	return openapi_types.Date{Time: e.now.AddDate(0, 0, plusDays)}
}

func receiptFile(t *testing.T, acc, by uuid.UUID, state string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	exec(t, dbs["a"], `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime, bytes, uploaded_by, ready_at)
	     values ($1::uuid, 'files/'||$1::text, $2::text, 'expense_receipt', 'cash.account', $3, 'image/jpeg', 2048, $4,
	             case when $2::text = 'ready' then now() end)`, id, state, acc, by)
	return id
}

// TestAdvance: an advance is topped up from a drawer «in transit» until its holder confirms; the holder reports with
// receipts that another person accepts (an expense of the advance) or rejects (re-taken); he returns the rest.
func TestAdvance(t *testing.T) { //nolint:gocyclo // one scenario of an advance over shared accounts
	t.Parallel()
	e := newEnv(t)
	holder := person("a.driver-msk1")
	src := newAccount(t, "cash_drawer", unique("Ящик подотчёт"), unit("msk1"), "balance_minor", 1000000)
	adv := newAccount(t, "advance", unique("Подотчёт"), unit("msk1"), "holder_id, drawer_account_id, advance_limit_minor", holder, src, 300000)
	role(t, "a.two-roles", manager, "account", src)
	role(t, "a.two-roles", manager, "account", adv)
	role(t, "a.driver-msk1", holderRo, "self", nil)
	issuer := e.tc(t, "a.two-roles", "a")
	hd := e.tc(t, "a.driver-msk1", "a")

	issue := func(minor int, due openapi_types.Date) (*cashapi.CashTransfer, *cashapi.CashApprovalRequest, error) {
		return e.svc.IssueAdvance(t.Context(), issuer, adv, &cashapi.CashAdvanceIssue{Amount: money(minor), DueDate: due, SourceAccountId: src})
	}
	if _, _, err := issue(400000, today(e, 5)); err == nil {
		t.Error("above the limit in hand")
	} else {
		wantProblem(t, err, "validation_failed")
	}
	if _, _, err := issue(100000, today(e, -1)); err == nil {
		t.Error("a due date in the past")
	}
	if _, _, err := issue(5000000, today(e, 5)); err == nil {
		t.Error("the source has no such money")
	} else {
		wantProblem(t, err, "insufficient_funds")
	}
	tr, req, err := issue(200000, today(e, 5))
	if err != nil || req != nil || tr == nil || tr.Status != "transit" || tr.Purpose != "advance_issue" || tr.Note == nil {
		t.Fatalf("issue %+v %v %v", tr, req, err)
	}
	if balance(t, src) != 800000 || balance(t, adv) != 0 {
		t.Fatalf("balances %d %d", balance(t, src), balance(t, adv))
	}
	// the holder confirms the receipt
	got, err := decideTransfer(t, e, hd, *tr, "accept", nil)
	if err != nil || got.Status != "done" || balance(t, adv) != 200000 {
		t.Fatalf("confirmed %+v, %v, advance %d", got, err, balance(t, adv))
	}
	// the holder is not the issuer of his own advance
	if _, _, err := e.svc.IssueAdvance(t.Context(), hd, adv, &cashapi.CashAdvanceIssue{Amount: money(1000), DueDate: today(e, 5), SourceAccountId: src}); err == nil {
		t.Error("the holder issues to himself")
	}

	// receipts
	file := receiptFile(t, adv, holder, "ready")
	submit := func(tc tenantctx.TenantContext, file uuid.UUID, redo *uuid.UUID) (cashapi.AdvanceReceipt, error) {
		return e.svc.SubmitReceipt(t.Context(), tc, adv, &cashapi.AdvanceReceiptCreate{Amount: money(126000), CategoryId: "fuel", FileId: file, Note: new("Заправка"),
			Link: &cashapi.CashSourceRef{Key: "trip:x", Kind: "trip", Id: uuid.New(), Label: new("Рейс Р-208")}, RedoOfReceiptId: redo})
	}
	if _, err := submit(issuer, file, nil); err == nil {
		t.Error("only the holder reports")
	}
	rc, err := submit(hd, file, nil)
	if err != nil || rc.Status != "review" || rc.SubmittedByMemberId != holder || rc.Link == nil {
		t.Fatalf("receipt %+v, %v", rc, err)
	}
	if _, err := submit(hd, file, nil); err == nil {
		t.Error("the photo is used once")
	}
	if _, err := submit(hd, receiptFile(t, adv, holder, "scanning"), nil); err == nil {
		t.Error("the photo is not ready")
	} else {
		wantProblem(t, err, "photo_not_ready")
	}
	if _, err := submit(hd, receiptFile(t, adv, person("a.owner"), "ready"), nil); err == nil {
		t.Error("the photo of another person")
	}
	dec := func(tc tenantctx.TenantContext, r cashapi.AdvanceReceipt, accept bool, reason *string) (cashapi.AdvanceReceipt, error) {
		return e.svc.DecideReceipt(t.Context(), tc, r.Id, etagOf(r.Revision), cash.Decision{Accept: accept, Reason: reason})
	}
	_, err = dec(hd, rc, true, nil)
	wantProblem(t, err, "forbidden_action") // the holder has no cash.advance.issue: he does not review (a holder with it — self_approval)
	acc, err := dec(issuer, rc, true, nil)
	if err != nil || acc.Status != "accepted" || acc.OperationId == nil || balance(t, adv) != 74000 {
		t.Fatalf("accepted %+v, %v, advance %d", acc, err, balance(t, adv))
	}
	_, err = dec(issuer, acc, true, nil)
	wantProblem(t, err, "invalid_transition")

	// a rejected receipt is re-taken
	rc2, err := submit(hd, receiptFile(t, adv, holder, "ready"), nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = dec(issuer, rc2, false, nil)
	wantProblem(t, err, "validation_failed")
	rej, err := dec(issuer, rc2, false, new("Не видно сумму"))
	if err != nil || rej.Status != "rejected" || rej.Reason == nil || balance(t, adv) != 74000 {
		t.Fatalf("rejected %+v, %v", rej, err)
	}
	redo, err := submit(hd, receiptFile(t, adv, holder, "ready"), &rej.Id)
	if err != nil || redo.RedoOfReceiptId == nil || *redo.RedoOfReceiptId != rej.Id {
		t.Fatalf("redo %+v, %v", redo, err)
	}
	if _, err := submit(hd, receiptFile(t, adv, holder, "ready"), &acc.Id); err == nil {
		t.Error("an accepted receipt is not re-taken")
	}
	mine, err := e.svc.ListReceipts(t.Context(), hd, cash.ReceiptsQuery{AccountID: adv})
	if err != nil || len(mine.Items) != 3 {
		t.Fatalf("receipts of the holder %+v, %v", mine, err)
	}
	review, err := e.svc.ListReceipts(t.Context(), issuer, cash.ReceiptsQuery{Status: "review", AccountID: adv})
	if err != nil || len(review.Items) != 1 || review.Items[0].Id != redo.Id {
		t.Fatalf("receipts on review %+v, %v", review, err)
	}

	// the rest goes back «in transit» to the account the advance is topped up from
	ret := func(tc tenantctx.TenantContext, minor int) (cashapi.CashTransfer, error) {
		return e.svc.ReturnAdvance(t.Context(), tc, adv, &cashapi.CashAdvanceReturn{Amount: money(minor)})
	}
	if _, err := ret(hd, 80000); err == nil {
		t.Error("more than in hand")
	}
	if _, err := ret(issuer, 1000); err == nil {
		t.Error("only the holder returns")
	}
	back, err := ret(hd, 50000)
	if err != nil || back.Purpose != "advance_return" || back.ToAccountId != src || balance(t, adv) != 24000 || balance(t, src) != 800000 {
		t.Fatalf("return %+v, %v, advance %d", back, err, balance(t, adv))
	}
	taken, err := decideTransfer(t, e, issuer, back, "accept", nil)
	if err != nil || taken.Status != "done" || balance(t, src) != 850000 {
		t.Fatalf("taken back %+v, %v, source %d", taken, err, balance(t, src))
	}
}

// TestApprovalRequests: above the limit of the role an operation becomes a request that another person approves (the
// operation is posted in the name of its author with the mark of the approver) or rejects; a request that cannot be paid any
// more stays pending.
func TestApprovalRequests(t *testing.T) { //nolint:gocyclo // one scenario of the limits of a role over shared accounts
	t.Parallel()
	e := newEnv(t)
	owner := e.tc(t, "a.owner", "a")
	acc := newAccount(t, "cash_drawer", unique("Ящик заявки"), unit("msk2"), "balance_minor", 1000000)
	adv := newAccount(t, "advance", unique("Подотчёт заявки"), unit("msk2"), "holder_id, drawer_account_id", person("a.driver-earnings"), acc)
	role(t, "a.manager-msk2", append([]string{"cash.approve", "cash.advance.issue"}, cashier...), "account", acc)
	role(t, "a.manager-msk2", []string{"cash.advance.issue"}, "account", adv)
	role(t, "a.manager-msk2", []string{"cash.refund"}, "account", acc)
	requester := e.tc(t, "a.manager-msk2", "a")
	out, refund, adv5 := int64(100000), int64(0), int64(50000)
	e.svc.Limits = fakeLimits{requester.PersonID: {Out: &out, Refund: &refund, Advance: &adv5}}

	// within the limit — posted at once
	op, req, err := post(t, e, requester, acc, "out", "expense", 100000, "Закупка воды")
	wantPosted(t, op, req, err)
	// above — a request, nothing moves
	op, req, err = post(t, e, requester, acc, "out", "expense", 150000, "Мелкий ремонт")
	if err != nil || op != nil || req == nil || req.Status != "pending" || req.Type != "out" || req.Limit == nil || req.Limit.AmountMinor != 100000 ||
		req.RequestedByMemberId != requester.PersonID || req.Basis == nil {
		t.Fatalf("request %+v %+v %v", op, req, err)
	}
	if balance(t, acc) != 900000 {
		t.Fatalf("a request moved the money: %d", balance(t, acc))
	}
	decide := func(tc tenantctx.TenantContext, r *cashapi.CashApprovalRequest, accept bool, reason *string) (cashapi.CashApprovalRequest, error) {
		return e.svc.DecideRequest(t.Context(), tc, r.Id, etagOf(r.Revision), cash.Decision{Accept: accept, Reason: reason})
	}
	_, err = decide(requester, req, true, nil)
	wantProblem(t, err, "self_approval")
	list, err := e.svc.ListRequests(t.Context(), requester, cash.RequestsQuery{Status: "pending"})
	if err != nil || len(list.Items) == 0 {
		t.Fatalf("pending requests %+v, %v", list, err)
	}
	ok, err := decide(owner, req, true, nil)
	if err != nil || ok.Status != "approved" || ok.OperationId == nil || ok.DecidedByMemberId == nil || balance(t, acc) != 750000 {
		t.Fatalf("approved %+v, %v, balance %d", ok, err, balance(t, acc))
	}
	if by := scalar[string](t, dbs["a"], `select created_by::text || ':' || approved_by::text from cash.operations where id = $1`, *ok.OperationId); by != requester.PersonID.String()+":"+owner.PersonID.String() {
		t.Fatalf("author and approver %s", by)
	}
	_, err = decide(owner, &ok, true, nil)
	wantProblem(t, err, "invalid_transition")

	// a rejection needs a reason, the operation is not posted
	_, req, err = post(t, e, requester, acc, "out", "expense", 120000, "Не нужно")
	if err != nil || req == nil {
		t.Fatalf("request %v %v", req, err)
	}
	_, err = decide(owner, req, false, nil)
	wantProblem(t, err, "validation_failed")
	no, err := decide(owner, req, false, new("Слишком дорого"))
	if err != nil || no.Status != "rejected" || no.OperationId != nil || balance(t, acc) != 750000 {
		t.Fatalf("rejected %+v, %v", no, err)
	}

	// the money is gone before the approval: 409, the request stays pending
	_, req, err = post(t, e, requester, acc, "out", "expense", 700000, "Большая закупка")
	if err != nil || req == nil {
		t.Fatalf("request %v %v", req, err)
	}
	setBalance(t, acc, 10000)
	_, err = decide(owner, req, true, nil)
	wantProblem(t, err, "insufficient_funds")
	if st := scalar[string](t, dbs["a"], `select status from cash.approval_requests where id = $1`, req.Id); st != "pending" {
		t.Fatalf("status %s", st)
	}
	setBalance(t, acc, 1000000)

	// a refund with the limit 0 always goes through a request
	pay := wantPostedOp(t, e, owner, acc, 80000)
	_, req, err = e.svc.PostOperation(t.Context(), requester, &cashapi.CashOperationCreate{AccountId: acc, Amount: money(1000), Basis: new("Отмена визита"),
		Category: "refund", Direction: "out", OccurredAt: e.now, RefundsOperationId: &pay.Id})
	if err != nil || req == nil || req.Type != "refund" {
		t.Fatalf("refund request %v %v", req, err)
	}
	// an issue above the limit of the role: a request; the approval sends the money in the name of the author
	tr, req, err := e.svc.IssueAdvance(t.Context(), requester, adv, &cashapi.CashAdvanceIssue{Amount: money(80000), DueDate: today(e, 3), SourceAccountId: acc})
	if err != nil || tr != nil || req == nil || req.Type != "issue" {
		t.Fatalf("issue request %v %v %v", tr, req, err)
	}
	before := balance(t, acc)
	ok, err = decide(owner, req, true, nil)
	if err != nil || ok.TransferId == nil || balance(t, acc) != before-80000 {
		t.Fatalf("issue approved %+v, %v, balance %d", ok, err, balance(t, acc))
	}
	if by := scalar[string](t, dbs["a"], `select sent_by::text from cash.transfers where id = $1`, *ok.TransferId); by != requester.PersonID.String() {
		t.Fatalf("sent by %s", by)
	}
}

// TestProposals: a module offers money to move, a person posts it (a payment in parts of one group), dismisses it with a
// reason or links an operation entered by hand; one source is posted once.
func TestProposals(t *testing.T) { //nolint:gocyclo // one scenario of the proposals over shared accounts
	t.Parallel()
	e := newEnv(t)
	owner := e.tc(t, "a.owner", "a")
	drawer := newAccount(t, "cash_drawer", unique("Ящик предложения"), unit("msk1"), "balance_minor", 400000)
	term := newAccount(t, "acquiring", unique("Терминал предложения"), unit("msk1"), "drawer_account_id", drawer)
	role(t, "a.manager-msk1", cashier, "account", drawer)
	cs := e.tc(t, "a.manager-msk1", "a")
	other := e.tc(t, "a.driver-msk2", "a")
	ctx := t.Context()

	offer := func(kind, dir string, minor int64, cat string) cash.Offer {
		key := "ap:" + uuid.NewString()
		if kind == "expense" {
			key = "tx:" + uuid.NewString()
		}
		return cash.Offer{Key: key, Kind: kind, Title: "Предложение " + kind, Amount: minor, Direction: dir, DefaultAccountID: &drawer, CategoryID: &cat,
			SourceKind: "spa", SourceID: uuid.New(), SourceLabel: new("Визит 13:00"),
			Parts: []cashapi.CashProposalPart{{Label: "Абонемент", Amount: money(int(minor))}}}
	}
	p1 := offer("visit", "in", 320000, "revenue-spa")
	if created, err := e.svc.OfferInTenant(ctx, ref("tenant:a"), p1); err != nil || !created {
		t.Fatalf("offer %v %v", created, err)
	}
	if created, err := e.svc.OfferInTenant(ctx, ref("tenant:a"), p1); err != nil || created {
		t.Fatalf("a repeated offer %v %v", created, err)
	}
	if _, err := e.svc.OfferInTenant(ctx, ref("tenant:a"), cash.Offer{Key: "BAD", Kind: "visit"}); err == nil {
		t.Error("a bad offer")
	}
	keys := func(tc tenantctx.TenantContext, status string) map[string]cashapi.CashProposal {
		page, err := e.svc.ListProposals(ctx, tc, cash.ProposalsQuery{Status: status})
		if err != nil {
			t.Fatal(err)
		}
		m := map[string]cashapi.CashProposal{}
		for _, p := range page.Items {
			m[p.Key] = p
		}
		return m
	}
	if _, ok := keys(owner, "")[p1.Key]; !ok {
		t.Fatal("the owner does not see the proposal")
	}
	if got := keys(cs, "")[p1.Key]; got.Key == "" || got.Parts == nil || got.Source.Kind != "spa" || got.Amount.AmountMinor != 320000 {
		t.Fatalf("the cashier sees %+v", got)
	}
	if _, ok := keys(other, "")[p1.Key]; ok {
		t.Error("a person without a role sees the proposal")
	}

	post := func(tc tenantctx.TenantContext, key string, parts ...cashapi.CashProposalPostPart) (*cashapi.CashProposalPostResult, *cashapi.CashApprovalRequest, error) {
		return e.svc.PostProposal(ctx, tc, key, &cashapi.CashProposalPost{AccountId: drawer, Parts: parts})
	}
	// parts that do not add up post nothing — not even the claim of the source
	_, _, err := post(cs, p1.Key, cashapi.CashProposalPostPart{Amount: money(100000), Method: "cash"})
	wantProblem(t, err, "validation_failed")
	if scalar[int](t, dbs["a"], `select count(*) from cash.source_claims where source_key = $1`, p1.Key) != 0 {
		t.Fatal("a failed post left a claim")
	}
	res, req, err := post(cs, p1.Key, cashapi.CashProposalPostPart{Amount: money(200000), Method: "cash"}, cashapi.CashProposalPostPart{Amount: money(120000), Method: "card"})
	if err != nil || req != nil || res == nil || len(res.Operations) != 2 || res.Proposal.Status != "posted" || res.Proposal.OperationIds == nil || len(*res.Proposal.OperationIds) != 2 {
		t.Fatalf("posted %+v %v %v", res, req, err)
	}
	g0, g1 := res.Operations[0].GroupId, res.Operations[1].GroupId
	if g0 == nil || g1 == nil || *g0 != *g1 || res.Operations[0].Origin != "proposal" || res.Operations[0].Source == nil || res.Operations[0].Source.Key != p1.Key {
		t.Fatalf("one group, origin and source: %+v", res.Operations)
	}
	if balance(t, drawer) != 600000 || balance(t, term) != 120000 {
		t.Fatalf("drawer %d, terminal %d", balance(t, drawer), balance(t, term))
	}
	_, _, err = post(cs, p1.Key, cashapi.CashProposalPostPart{Amount: money(320000), Method: "cash"})
	wantProblem(t, err, "invalid_transition")
	if _, ok := keys(owner, "")[p1.Key]; ok {
		t.Error("a posted proposal is still open")
	}
	if _, ok := keys(owner, "posted")[p1.Key]; !ok {
		t.Error("a posted proposal is not listed as posted")
	}

	// dismissal with a reason
	p2 := offer("expense", "out", 50000, "fuel")
	if _, err := e.svc.OfferInTenant(ctx, ref("tenant:a"), p2); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.DismissProposal(ctx, cs, p2.Key, nil); err == nil {
		t.Error("a reason is required")
	}
	d, err := e.svc.DismissProposal(ctx, cs, p2.Key, new("Расход уже внесён вручную"))
	if err != nil || d.Status != "dismissed" || d.Dismissal == nil || d.Dismissal.ByMemberId != cs.PersonID {
		t.Fatalf("dismissed %+v, %v", d, err)
	}
	_, err = e.svc.DismissProposal(ctx, cs, p2.Key, new("Ещё раз"))
	wantProblem(t, err, "invalid_transition")
	_, _, err = post(cs, p2.Key)
	wantProblem(t, err, "invalid_transition")

	// an expense posts as one operation; above the limit it waits for the approval and leaves the inbox
	p3 := offer("expense", "out", 50000, "fuel")
	p4 := offer("expense", "out", 60000, "parking")
	for _, p := range []cash.Offer{p3, p4} {
		if _, err := e.svc.OfferInTenant(ctx, ref("tenant:a"), p); err != nil {
			t.Fatal(err)
		}
	}
	res, req, err = post(cs, p3.Key)
	if err != nil || req != nil || len(res.Operations) != 1 || res.Operations[0].Direction != "out" || balance(t, drawer) != 550000 {
		t.Fatalf("expense %+v %v %v", res, req, err)
	}
	lim := int64(10000)
	e.svc.Limits = fakeLimits{cs.PersonID: {Out: &lim}}
	res, req, err = post(cs, p4.Key)
	if err != nil || res != nil || req == nil || req.Source == nil || req.Source.Key != p4.Key {
		t.Fatalf("over the limit %+v %v %v", res, req, err)
	}
	if _, ok := keys(owner, "")[p4.Key]; ok {
		t.Error("a proposal that waits for an approval stays in the inbox")
	}
	_, _, err = post(cs, p4.Key)
	wantProblem(t, err, "invalid_transition")
	ok, err := e.svc.DecideRequest(ctx, owner, req.Id, etagOf(req.Revision), cash.Decision{Accept: true})
	if err != nil || ok.Status != "approved" || balance(t, drawer) != 490000 {
		t.Fatalf("approved %+v %v, drawer %d", ok, err, balance(t, drawer))
	}
	if st := scalar[string](t, dbs["a"], `select status from cash.proposals where key = $1`, p4.Key); st != "posted" {
		t.Fatalf("proposal %s", st)
	}
	e.svc.Limits = nil

	// the financial block needs cash.payroll.post
	p5 := offer("payroll", "out", 10000, "payroll-crew")
	if _, err := e.svc.OfferInTenant(ctx, ref("tenant:a"), p5); err != nil {
		t.Fatal(err)
	}
	if _, ok := keys(cs, "")[p5.Key]; ok {
		t.Error("the cashier sees the financial block")
	}
	if _, ok := keys(owner, "")[p5.Key]; !ok {
		t.Error("the owner does not see the financial block")
	}
	_, _, err = post(cs, p5.Key)
	wantProblem(t, err, "forbidden_action")

	// a manual operation linked to the proposal closes it
	manual := wantPostedOp(t, e, owner, drawer, 77000)
	p6 := offer("visit", "in", 77000, "revenue-spa")
	if _, err := e.svc.OfferInTenant(ctx, ref("tenant:a"), p6); err != nil {
		t.Fatal(err)
	}
	if _, err := e.svc.LinkSource(ctx, owner, manual.Id, cashapi.CashSourceRef{Key: p6.Key, Kind: "spa", Id: p6.SourceID}); err != nil {
		t.Fatal(err)
	}
	if st := scalar[string](t, dbs["a"], `select status from cash.proposals where key = $1`, p6.Key); st != "posted" {
		t.Fatalf("linked proposal %s", st)
	}
	_, _, err = post(cs, p6.Key)
	wantProblem(t, err, "invalid_transition")
}

// TestTenantIsolation: the cash of tenant A does not exist for tenant B (AC-02): lists are empty, ids answer 404.
func TestTenantIsolation(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.tc(t, "a.owner", "a")
	bOwner := e.tc(t, "b.owner", "b")
	acc := newAccount(t, "cash_drawer", unique("Ящик изоляция"), unit("msk1"), "balance_minor", 100000)
	op := wantPostedOp(t, e, owner, acc, 1000)

	page, err := e.svc.ListAccounts(t.Context(), bOwner, cash.AccountsQuery{})
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range page.Items {
		if a.Id == acc {
			t.Fatal("tenant B lists an account of tenant A")
		}
	}
	_, _, err = post(t, e, bOwner, acc, "in", "service_payment", 1000, "Чужая касса")
	wantProblem(t, err, "not_found")
	_, err = e.svc.ReverseOperation(t.Context(), bOwner, op.Id, new("Чужая операция"))
	wantProblem(t, err, "not_found")
	_, err = e.svc.OpenShift(t.Context(), bOwner, acc, &cashapi.CashShiftOpen{CountedFloat: money(0)})
	wantProblem(t, err, "not_found")
	ops, err := e.svc.ListOperations(t.Context(), bOwner, cash.OperationsQuery{AccountID: acc})
	if err != nil || len(ops.Items) != 0 {
		t.Fatalf("operations of A in B: %v %v", ops, err)
	}
}
