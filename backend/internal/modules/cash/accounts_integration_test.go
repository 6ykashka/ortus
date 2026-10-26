//go:build integration

package cash_test

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/modules/cash" //nolint:depguard // the package under test
)

// TestCreateAccount: the owner creates the five kinds; the name is unique; an advance needs its holder and is topped up
// from the drawer of its unit, a terminal needs a drawer; a member without cash.accounts.manage is refused.
func TestCreateAccount(t *testing.T) { //nolint:gocyclo // one scenario of the kinds of accounts over a shared tenant
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	owner := e.tc(t, "a.owner", "a")
	msk1 := ref("unit:a.msk4") // a unit of this test only: the drawer of the unit an advance is topped up from is the first one

	drawer, err := e.svc.CreateAccount(ctx, owner, &cashapi.CashAccountCreate{Name: unique("Касса"), Kind: "cash_drawer", Currency: "RUB", OrgUnitId: &msk1,
		ShiftMode: new(cashapi.CashAccountCreateShiftMode("blind")), KktMode: new(cashapi.CashAccountCreateKktMode("manual")),
		FloatAmount: new(money(500000)), Tolerance: new(money(10000)), BalanceLimit: new(money(10000000))})
	if err != nil {
		t.Fatal(err)
	}
	if drawer.ShiftMode != "blind" || drawer.KktMode != "manual" || drawer.Balance == nil || drawer.Balance.AmountMinor != 0 ||
		drawer.FloatAmount == nil || drawer.FloatAmount.AmountMinor != 500000 || drawer.My.Via != "owner" || drawer.Revision != 1 {
		t.Fatalf("drawer %+v", drawer)
	}
	if !slices.Contains(drawer.My.Rights, "cash.accounts.manage") {
		t.Errorf("rights of the owner %v", drawer.My.Rights)
	}

	term, err := e.svc.CreateAccount(ctx, owner, &cashapi.CashAccountCreate{Name: unique("Терминал"), Kind: "acquiring", Currency: "RUB", OrgUnitId: &msk1,
		DrawerAccountId: &drawer.Id, SettleDays: new(1), FeeBasisPoints: new(180)})
	if err != nil || term.DrawerAccountId == nil || *term.DrawerAccountId != drawer.Id || term.ShiftMode != "none" {
		t.Fatalf("terminal %+v, %v", term, err)
	}
	holder := person("a.driver-msk1")
	adv, err := e.svc.CreateAccount(ctx, owner, &cashapi.CashAccountCreate{Name: unique("Подотчёт"), Kind: "advance", Currency: "RUB", OrgUnitId: &msk1,
		HolderMemberId: &holder, AdvanceLimit: new(money(3000000))})
	if err != nil || adv.HolderMemberId == nil || *adv.HolderMemberId != holder || adv.DrawerAccountId == nil || *adv.DrawerAccountId != drawer.Id ||
		adv.CategoryIds == nil || len(*adv.CategoryIds) != 4 {
		t.Fatalf("advance %+v, %v", adv, err)
	}
	if safe, err := e.svc.CreateAccount(ctx, owner, &cashapi.CashAccountCreate{Name: unique("Сейф"), Kind: "safe", Currency: "RUB"}); err != nil || safe.OrgUnitId != nil {
		t.Fatalf("safe %+v, %v", safe, err)
	}

	bad := map[string]*cashapi.CashAccountCreate{
		"то же название":         {Name: drawer.Name, Kind: "safe", Currency: "RUB"},
		"подотчёт без держателя": {Name: unique("Без держателя"), Kind: "advance", Currency: "RUB", OrgUnitId: &msk1},
		"терминал без кассы":     {Name: unique("Терминал без кассы"), Kind: "acquiring", Currency: "RUB", OrgUnitId: &msk1},
		"терминал к сейфу":       {Name: unique("Терминал к сейфу"), Kind: "acquiring", Currency: "RUB", DrawerAccountId: &adv.Id},
		"короткое название":      {Name: "К", Kind: "safe", Currency: "RUB"},
		"доллары":                {Name: unique("USD"), Kind: "safe", Currency: "USD"},
		"нет подразделения":      {Name: unique("Нигде"), Kind: "safe", Currency: "RUB", OrgUnitId: new(uuid.New())},
	}
	for name, b := range bad {
		if _, err := e.svc.CreateAccount(ctx, owner, b); err == nil {
			t.Errorf("%s: want error", name)
		} else {
			wantProblem(t, err, "validation_failed")
		}
	}

	// a member needs cash.accounts.manage over the unit
	role(t, "a.project-approver", cashier, "unit", msk1)
	mgr := e.tc(t, "a.project-approver", "a")
	_, err = e.svc.CreateAccount(ctx, mgr, &cashapi.CashAccountCreate{Name: unique("Чужая"), Kind: "safe", Currency: "RUB", OrgUnitId: &msk1})
	wantProblem(t, err, "forbidden_action")
}

// TestListAccounts: a role sees the accounts of its area; the balance is shown only with cash.balance.read; a terminal lies
// in the area of its drawer; the holder of an advance sees it through the scope «self»; the owner sees all.
func TestListAccounts(t *testing.T) { //nolint:gocyclo // one scenario of the areas of roles over a shared tenant
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	owner := e.tc(t, "a.owner", "a")
	drawer := newAccount(t, "cash_drawer", unique("Ящик L"), unit("msk1"), "balance_minor", 120000)
	terminal := newAccount(t, "acquiring", unique("Терминал L"), unit("msk2"), "drawer_account_id", drawer)
	other := newAccount(t, "cash_drawer", unique("Ящик чужой"), unit("smr2"), "")
	holder := person("a.driver-msk2")
	adv := newAccount(t, "advance", unique("Подотчёт L"), unit("msk1"), "holder_id, drawer_account_id, balance_minor", holder, drawer, 77000)

	// a role on the drawer itself (account scope) and nothing else
	role(t, "a.manager-msk2", cashier, "account", drawer)
	member := e.tc(t, "a.manager-msk2", "a")
	page, err := e.svc.ListAccounts(ctx, member, cash.AccountsQuery{})
	if err != nil {
		t.Fatal(err)
	}
	got := map[uuid.UUID]cashapi.CashAccount{}
	for _, a := range page.Items {
		got[a.Id] = a
	}
	if _, ok := got[drawer]; !ok {
		t.Fatalf("the drawer of the role is missing: %v", ids(page))
	}
	if _, ok := got[terminal]; !ok {
		t.Errorf("the terminal lies in the area of its drawer: %v", ids(page))
	}
	if _, ok := got[other]; ok {
		t.Error("an account outside the area is listed")
	}
	if _, ok := got[adv]; ok {
		t.Error("an advance of another unit area is listed")
	}
	if got[drawer].Balance != nil || got[drawer].My.Via != "role" || slices.Contains(got[drawer].My.Rights, "cash.balance.read") {
		t.Errorf("balance without cash.balance.read: %+v", got[drawer])
	}

	// the same role with the right to see the balance
	role(t, "a.manager-msk2", []string{"cash.balance.read"}, "account", drawer)
	page, err = e.svc.ListAccounts(ctx, member, cash.AccountsQuery{})
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range page.Items {
		if a.Id == drawer && (a.Balance == nil || a.Balance.AmountMinor != 120000) {
			t.Errorf("balance with cash.balance.read: %+v", a.Balance)
		}
	}

	// the holder reads his own advance through «self» and its balance
	role(t, "a.driver-msk2", holderRo, "self", nil)
	hd := e.tc(t, "a.driver-msk2", "a")
	page, err = e.svc.ListAccounts(ctx, hd, cash.AccountsQuery{})
	if err != nil || len(page.Items) != 1 || page.Items[0].Id != adv {
		t.Fatalf("holder sees %v, %v", ids(page), err)
	}
	a := page.Items[0]
	if a.My.Via != "self" || a.My.IsHolder == nil || !*a.My.IsHolder || a.Balance == nil || a.Balance.AmountMinor != 77000 {
		t.Errorf("holder view %+v", a)
	}

	// the owner sees every account, a kind and a unit filter narrow the list
	all, err := e.svc.ListAccounts(ctx, owner, cash.AccountsQuery{})
	if err != nil || !slices.Contains(ids(all), drawer) || !slices.Contains(ids(all), other) {
		t.Fatalf("owner sees %v, %v", ids(all), err)
	}
	for _, a := range all.Items {
		if a.My.Via != "owner" || !slices.Contains(a.My.Rights, "cash.accounts.manage") || a.Balance == nil {
			t.Fatalf("the owner holds every right over %s: %+v", a.Name, a.My)
		}
	}
	q := cash.AccountsQuery{}
	q.Kind = "acquiring"
	onlyTerms, err := e.svc.ListAccounts(ctx, owner, q)
	if err != nil {
		t.Fatal(err)
	}
	for _, a := range onlyTerms.Items {
		if a.Kind != "acquiring" {
			t.Errorf("kind filter: %s", a.Kind)
		}
	}
	// paging: a page of one carries a cursor
	q = cash.AccountsQuery{}
	q.Limit = 1
	p1, err := e.svc.ListAccounts(ctx, owner, q)
	if err != nil || len(p1.Items) != 1 || p1.NextCursor == nil {
		t.Fatalf("page %v %v", p1, err)
	}
	q.Cursor = *p1.NextCursor
	if p2, err := e.svc.ListAccounts(ctx, owner, q); err != nil || len(p2.Items) == 0 || p2.Items[0].Id == p1.Items[0].Id {
		t.Fatalf("second page %v %v", p2, err)
	}
}

// TestPreviewAccess: who would get access to a drawer of Москва-1: the roles that cover its unit, with their rights, and
// the pairs of duties that conflict.
func TestPreviewAccess(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.tc(t, "a.owner", "a")
	role(t, "a.two-roles", append(slices.Clone(cashier), "cash.approve", "cash.reconcile"), "unit", ref("unit:a.msk1"))
	out, err := e.svc.PreviewAccess(t.Context(), owner, cash.AccessQuery{Kind: "cash_drawer", Unit: ref("unit:a.msk1")})
	if err != nil {
		t.Fatal(err)
	}
	var found *cashapi.CashAccessPerson
	for i, p := range out.Items {
		if p.MemberId == person("a.two-roles") {
			found = &out.Items[i]
		}
	}
	if found == nil || found.Via != "role" || !slices.Contains(found.Rights, "cash.post") || len(found.Conflicts) < 2 {
		t.Fatalf("preview %+v", out.Items)
	}
	role(t, "a.region-msk", cashier, "unit", ref("unit:a.msk"))
	mgr := e.tc(t, "a.region-msk", "a")
	_, err = e.svc.PreviewAccess(t.Context(), mgr, cash.AccessQuery{Kind: "cash_drawer", Unit: ref("unit:a.msk1")})
	wantProblem(t, err, "forbidden_action")
}
