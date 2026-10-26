//go:build integration

package cash_test

import (
	"context"
	"testing"

	"github.com/google/uuid"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/modules/cash" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

func withTenant(tc tenantctx.TenantContext) context.Context {
	return tenantctx.WithTenant(context.Background(), tc)
}

// TestCategories: the catalogue of the cash categories is read by a reader of some account, not by a stranger; a category
// of a manual operation is checked against the catalogue and the direction.
func TestCategories(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.tc(t, "a.owner", "a")
	list, err := e.svc.ListCategories(t.Context(), owner)
	if err != nil || len(list.Items) != 14 || list.Items[0].Id != "revenue-spa" || list.Items[0].Direction == nil || *list.Items[0].Direction != "in" {
		t.Fatalf("categories %+v, %v", list, err)
	}
	acc := newAccount(t, "cash_drawer", unique("Ящик статьи"), unit("msk2"), "balance_minor", 100000)
	role(t, "a.manager-msk1", cashier, "account", acc)
	if l, err := e.svc.ListCategories(t.Context(), e.tc(t, "a.manager-msk1", "a")); err != nil || len(l.Items) != 14 {
		t.Fatalf("the reader of an account: %+v, %v", l, err)
	}
	_, err = e.svc.ListCategories(t.Context(), e.tc(t, "a.project-lead", "a"))
	wantProblem(t, err, "forbidden_action")

	body := func(dir cashapi.CashOperationCreateDirection, cat cashapi.CashOperationCreateCategory, id string) *cashapi.CashOperationCreate {
		return &cashapi.CashOperationCreate{AccountId: acc, Amount: money(1000), Basis: new("Хозрасходы"), Category: cat, Direction: dir, OccurredAt: e.now, CategoryId: &id}
	}
	op, req, err := e.svc.PostOperation(t.Context(), owner, body("out", "expense", "household"))
	op = wantPosted(t, op, req, err)
	if op.CategoryId == nil || *op.CategoryId != "household" {
		t.Fatalf("category %+v", op.CategoryId)
	}
	for name, b := range map[string]*cashapi.CashOperationCreate{
		"статья прихода у расхода": body("out", "expense", "revenue-spa"),
		"нет такой статьи":         body("out", "expense", "nothing"),
	} {
		if _, _, err := e.svc.PostOperation(t.Context(), owner, b); err == nil {
			t.Errorf("%s: want error", name)
		} else {
			wantProblem(t, err, "validation_failed")
		}
	}
}

// TestServerHandlers: the strict server answers 201 for an operation, 202 above the limit of the role, 201 for a linked
// reversal; reads answer 200 with the headers of a private response.
func TestServerHandlers(t *testing.T) { //nolint:gocyclo // one scenario of the handlers over one account
	t.Parallel()
	e := newEnv(t)
	h := cash.Server{S: e.svc}
	owner := e.tc(t, "a.owner", "a")
	acc := newAccount(t, "cash_drawer", unique("Ящик сервер"), unit("msk2"), "balance_minor", 500000)
	role(t, "a.space-lead", cashier, "account", acc)
	limited := e.tc(t, "a.space-lead", "a")
	lim := int64(10000)
	e.svc.Limits = fakeLimits{limited.PersonID: {Out: &lim}}

	create := func(tc tenantctx.TenantContext, minor int, dir cashapi.CashOperationCreateDirection, cat cashapi.CashOperationCreateCategory, rev *uuid.UUID) (cashapi.PostCashOperationResponseObject, error) {
		return h.PostCashOperation(withTenant(tc), cashapi.PostCashOperationRequestObject{Body: &cashapi.CashOperationCreate{AccountId: acc, Amount: money(minor),
			Basis: new("Оплата услуги"), Category: cat, Direction: dir, OccurredAt: e.now, ReversesOperationId: rev}})
	}
	res, err := create(owner, 5000, "in", "service_payment", nil)
	in, ok := res.(cashapi.PostCashOperation201JSONResponse)
	if err != nil || !ok || in.Body.Amount.AmountMinor != 5000 || in.Headers.CacheControl == nil || *in.Headers.CacheControl != "private, no-store" {
		t.Fatalf("201: %#v, %v", res, err)
	}
	res, err = create(limited, 50000, "out", "expense", nil)
	if r, ok := res.(cashapi.PostCashOperation202JSONResponse); err != nil || !ok || r.Body.Status != "pending" || r.Headers.ETag == nil {
		t.Fatalf("202: %#v, %v", res, err)
	}
	res, err = create(owner, 0, "in", "service_payment", &in.Body.Id)
	if r, ok := res.(cashapi.PostCashOperation201JSONResponse); err != nil || !ok || r.Body.Type != "storno" {
		t.Fatalf("linked reversal: %#v, %v", res, err)
	}

	dups, err := h.FindCashDuplicates(withTenant(owner), cashapi.FindCashDuplicatesRequestObject{Params: cashapi.FindCashDuplicatesParams{
		AccountId: &acc, AmountMinor: new(5000), Type: new(cashapi.FindCashDuplicatesParamsType("in")), Method: new(cashapi.FindCashDuplicatesParamsMethod("cash")), At: &e.now}})
	if r, ok := dups.(cashapi.FindCashDuplicates200JSONResponse); err != nil || !ok || len(r.Body.Items) != 0 { // the payment is reversed
		t.Fatalf("duplicates: %#v, %v", dups, err)
	}
	ops, err := h.ListCashOperations(withTenant(owner), cashapi.ListCashOperationsRequestObject{Params: cashapi.ListCashOperationsParams{AccountId: &acc, Type: new(cashapi.ListCashOperationsParamsType("storno"))}})
	if r, ok := ops.(cashapi.ListCashOperations200JSONResponse); err != nil || !ok || len(r.Body.Items) != 1 {
		t.Fatalf("operations: %#v, %v", ops, err)
	}
	cats, err := h.ListCashCategories(withTenant(owner), cashapi.ListCashCategoriesRequestObject{})
	if r, ok := cats.(cashapi.ListCashCategories200JSONResponse); err != nil || !ok || len(r.Body.Items) != 14 {
		t.Fatalf("categories: %#v, %v", cats, err)
	}
	accs, err := h.ListCashAccounts(withTenant(owner), cashapi.ListCashAccountsRequestObject{Params: cashapi.ListCashAccountsParams{Limit: new(5)}})
	if r, ok := accs.(cashapi.ListCashAccounts200JSONResponse); err != nil || !ok || len(r.Body.Items) == 0 || len(r.Body.Items) > 5 {
		t.Fatalf("accounts: %#v, %v", accs, err)
	}
	prev, err := h.PreviewCashAccountAccess(withTenant(owner), cashapi.PreviewCashAccountAccessRequestObject{Params: cashapi.PreviewCashAccountAccessParams{
		Kind: new(cashapi.PreviewCashAccountAccessParamsKind("cash_drawer")), OrgUnitId: new(ref("unit:a.msk2"))}})
	if _, ok := prev.(cashapi.PreviewCashAccountAccess200JSONResponse); err != nil || !ok {
		t.Fatalf("preview: %#v, %v", prev, err)
	}
	// the decision of a request through the handler: 200 with the request
	reqs, err := h.ListCashApprovalRequests(withTenant(owner), cashapi.ListCashApprovalRequestsRequestObject{Params: cashapi.ListCashApprovalRequestsParams{
		Status: new(cashapi.ListCashApprovalRequestsParamsStatus("pending"))}})
	r, ok := reqs.(cashapi.ListCashApprovalRequests200JSONResponse)
	if err != nil || !ok || len(r.Body.Items) == 0 {
		t.Fatalf("requests: %#v, %v", reqs, err)
	}
	var mine cashapi.CashApprovalRequest
	for _, x := range r.Body.Items {
		if x.AccountId == acc {
			mine = x
		}
	}
	decided, err := h.DecideCashApprovalRequest(withTenant(owner), cashapi.DecideCashApprovalRequestRequestObject{ApprovalRequestId: mine.Id,
		Params: cashapi.DecideCashApprovalRequestParams{IfMatch: etagOf(mine.Revision)}, Body: &cashapi.CashApprovalDecision{Decision: "approve"}})
	if d, ok := decided.(cashapi.DecideCashApprovalRequest200JSONResponse); err != nil || !ok || d.Body.Status != "approved" {
		t.Fatalf("decision: %#v, %v", decided, err)
	}
}
