package cash

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// account is a row of cash.accounts.
type account struct {
	ID           uuid.UUID
	Unit         *uuid.UUID
	Name         string
	Currency     string
	Kind         string
	ShiftMode    string
	KktMode      string
	BalanceLimit *int64
	Float        *int64
	Tolerance    *int64
	Responsible  *uuid.UUID
	Holder       *uuid.UUID
	AdvanceLimit *int64
	Drawer       *uuid.UUID
	SettleDays   *int
	Fee          *int
	CategoryIDs  []string
	Balance      int64
	Revision     int64
	CreatedAt    time.Time
}

const accountCols = `a.id, a.org_unit_id, a.name, a.currency, a.kind, a.shift_mode, a.kkt_mode, a.balance_limit_minor,
       a.float_minor, a.tolerance_minor, a.responsible_id, a.holder_id, a.advance_limit_minor, a.drawer_account_id,
       a.settle_days, a.fee_basis_points, a.category_ids, a.balance_minor, a.revision, a.created_at`

func scanAccount(row pgx.Row) (account, error) { //nolint:dupl // one row scan per table: the columns differ
	var a account
	err := row.Scan(&a.ID, &a.Unit, &a.Name, &a.Currency, &a.Kind, &a.ShiftMode, &a.KktMode, &a.BalanceLimit, &a.Float,
		&a.Tolerance, &a.Responsible, &a.Holder, &a.AdvanceLimit, &a.Drawer, &a.SettleDays, &a.Fee, &a.CategoryIDs,
		&a.Balance, &a.Revision, &a.CreatedAt)
	a.Currency = trimCurrency(a.Currency)
	return a, err
}

// loadAccount reads account id; a missing one is 404.
func loadAccount(ctx context.Context, q Querier, id uuid.UUID) (account, error) {
	a, err := scanAccount(q.QueryRow(ctx, `select `+accountCols+` from cash.accounts a where a.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return account{}, problem.New(problem.CodeNotFound, textAccountNotFound)
	}
	if err != nil {
		return account{}, fmt.Errorf("cash: account: %w", err)
	}
	return a, nil
}

// area is the account whose area the account lies in: a terminal in the area of its drawer, others in their own.
func (a account) area() uuid.UUID {
	if a.Kind == kindAcquiring && a.Drawer != nil {
		return *a.Drawer
	}
	return a.ID
}

// resource is the account as an object of the evaluator: the unit, the area as the object of the scope «account» and the
// holder as the owner for the scope «self».
func (a account) resource() authz.Resource {
	r := authz.Resource{Objects: map[string]uuid.UUID{authz.KindAccount: a.area()}, ReadAction: actionRead}
	if a.Unit != nil {
		r.Unit = *a.Unit
	}
	if a.Holder != nil {
		r.Persons = []uuid.UUID{*a.Holder}
	}
	return r
}

func (a account) isHolder(tc tenantctx.TenantContext) bool {
	return a.Holder != nil && tc.PersonID != uuid.Nil && *a.Holder == tc.PersonID
}

// permit checks action of the actor over a: an account the actor does not see is 404, a visible one without the right
// 403; the holder of an advance sees it through cash.advance.self.
func (s *Service) permit(ctx context.Context, ev Authorizer, tc tenantctx.TenantContext, a account, action string) error {
	err := ev.Permit(ctx, tc, action, a.resource())
	if err == nil || !problem.Is(err, problem.CodeNotFound) {
		return err
	}
	if a.isHolder(tc) && ev.Permit(ctx, tc, actionSelf, a.resource()) == nil {
		return problem.New(problem.CodeForbiddenAction, "")
	}
	return err
}

// allowed reports whether the actor may apply action to a; only a failure of the check is an error.
func allowed(ctx context.Context, ev Authorizer, tc tenantctx.TenantContext, a account, action string) (bool, error) {
	err := ev.Permit(ctx, tc, action, a.resource())
	switch {
	case err == nil:
		return true, nil
	case problem.Is(err, problem.CodeForbiddenAction), problem.Is(err, problem.CodeNotFound), problem.Is(err, authz.CodeFunctionBlocked):
		return false, nil
	}
	return false, err
}

// visible reports whether the actor sees a: cash.read over it or the advance the actor holds.
func (s *Service) visible(ctx context.Context, ev Authorizer, tc tenantctx.TenantContext, a account) (bool, error) {
	ok, err := allowed(ctx, ev, tc, a, actionRead)
	if ok || err != nil || !a.isHolder(tc) {
		return ok, err
	}
	return allowed(ctx, ev, tc, a, actionSelf)
}

// areaSQL is the SQL of account.area for the alias a.
const areaSQL = `case when %[1]s.kind = 'acquiring' then coalesce(%[1]s.drawer_account_id, %[1]s.id) else %[1]s.id end`

func areaOf(alias string) string { return fmt.Sprintf(areaSQL, alias) }

// visibleSQL is the predicate of the accounts the actor sees (cash.read or cash.advance.self over the alias), with
// placeholders after argStart.
func (s *Service) visibleSQL(ctx context.Context, ev Authorizer, tc tenantctx.TenantContext, alias string, argStart int, withSelf bool) (authz.Predicate, error) {
	cols := authz.Columns{Unit: alias + ".org_unit_id", Objects: map[string]string{authz.KindAccount: areaOf(alias)},
		Persons: []string{alias + ".holder_id"}}
	p1, err := ev.ScopeQuery(ctx, tc, actionRead, cols, argStart)
	if err != nil || !withSelf {
		return p1, err
	}
	p2, err := ev.ScopeQuery(ctx, tc, actionSelf, cols, argStart+len(p1.Args))
	if err != nil {
		return authz.Predicate{}, err
	}
	return authz.Predicate{SQL: "(" + p1.SQL + " or " + p2.SQL + ")", Args: append(slices.Clone(p1.Args), p2.Args...)}, nil
}

func (s *Service) limitsFor(ctx context.Context, q Querier, tc tenantctx.TenantContext, accountID uuid.UUID) (Limits, error) {
	if tc.Owner {
		return Limits{}, nil
	}
	return s.limits().Limits(ctx, q, Who{Person: tc.PersonID, Owner: tc.Owner}, accountID)
}

func moneyOf(minor int64, currency string) cashapi.Money {
	return cashapi.Money{AmountMinor: int(minor), Currency: currency}
}

func moneyPtr(minor *int64, currency string) *cashapi.Money {
	if minor == nil {
		return nil
	}
	m := moneyOf(*minor, currency)
	return &m
}

func signedOf(minor int64, currency string) cashapi.SignedMoney {
	return cashapi.SignedMoney{AmountMinor: int(minor), Currency: currency}
}

func signedPtr(minor *int64, currency string) *cashapi.SignedMoney {
	if minor == nil {
		return nil
	}
	m := signedOf(*minor, currency)
	return &m
}

func limitsDTO(l Limits) cashapi.CashLimits {
	return cashapi.CashLimits{OutMinor: l.Out, RefundMinor: l.Refund, AdvanceMinor: l.Advance}
}

// rightsOf lists the actions of the module the actor holds over a.
func rightsOf(ctx context.Context, ev Authorizer, tc tenantctx.TenantContext, a account) ([]string, error) {
	out := []string{}
	for _, act := range accountActions {
		ok, err := allowed(ctx, ev, tc, a, act)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, act)
		}
	}
	return out, nil
}

// rightsBatch lists the actions the actor holds over each of the accounts in one statement: the predicate of every action
// (ScopeQuery) is evaluated by the database over the rows of the page instead of one check per account and action.
func (s *Service) rightsBatch(ctx context.Context, tx pgx.Tx, ev Authorizer, tc tenantctx.TenantContext, list []account) (map[uuid.UUID][]string, error) {
	out := make(map[uuid.UUID][]string, len(list))
	if len(list) == 0 {
		return out, nil
	}
	ids := make([]uuid.UUID, 0, len(list))
	for _, a := range list {
		ids = append(ids, a.ID)
	}
	cols := authz.Columns{Unit: "a.org_unit_id", Objects: map[string]string{authz.KindAccount: areaOf("a")}, Persons: []string{"a.holder_id"}}
	args := []any{ids}
	exprs := make([]string, 0, len(accountActions))
	for _, act := range accountActions {
		p, err := ev.ScopeQuery(ctx, tc, act, cols, len(args))
		if err != nil {
			return nil, err
		}
		exprs = append(exprs, "case when "+p.SQL+" then '"+act+"' end") // act is one of the constants of accountActions
		args = append(args, p.Args...)
	}
	rows, err := tx.Query(ctx, `select a.id, array_remove(array[`+strings.Join(exprs, ", ")+`], null) from cash.accounts a
	 where a.id = any($1)`, args...)
	if err != nil {
		return nil, fmt.Errorf("cash: rights: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		var rights []string
		if err := rows.Scan(&id, &rights); err != nil {
			return nil, fmt.Errorf("cash: rights: %w", err)
		}
		out[id] = rights
	}
	return out, rows.Err()
}

// viaOf is the way the actor reaches an account: the owner, the own advance only, or a role.
func viaOf(tc tenantctx.TenantContext, a account, rights []string) cashapi.CashAccountMyVia {
	switch {
	case tc.Owner:
		return cashapi.CashAccountMyViaOwner
	case a.isHolder(tc) && !slices.ContainsFunc(rights, func(r string) bool { return r != actionSelf && r != actionBalance }):
		return cashapi.CashAccountMyViaSelf
	}
	return cashapi.CashAccountMyViaRole
}

// accountDTO is CashAccount for the actor: the balance only with cash.balance.read (or the advance of the holder).
func (s *Service) accountDTO(ctx context.Context, q Querier, tc tenantctx.TenantContext, a account, rights []string) (cashapi.CashAccount, error) {
	lim, err := s.limitsFor(ctx, q, tc, a.ID)
	if err != nil {
		return cashapi.CashAccount{}, err
	}
	out := cashapi.CashAccount{
		Id: a.ID, OrgUnitId: a.Unit, Name: a.Name, Currency: a.Currency, Kind: cashapi.CashAccountKind(a.Kind),
		ShiftMode: cashapi.CashAccountShiftMode(a.ShiftMode), KktMode: cashapi.CashAccountKktMode(a.KktMode),
		BalanceLimit: moneyPtr(a.BalanceLimit, a.Currency), FloatAmount: moneyPtr(a.Float, a.Currency),
		Tolerance: moneyPtr(a.Tolerance, a.Currency), AdvanceLimit: moneyPtr(a.AdvanceLimit, a.Currency),
		ResponsibleMemberId: a.Responsible, HolderMemberId: a.Holder, DrawerAccountId: a.Drawer,
		SettleDays: a.SettleDays, FeeBasisPoints: a.Fee, Revision: a.Revision,
		My: cashapi.CashAccountMy{Via: viaOf(tc, a, rights), Rights: rights, Limits: limitsDTO(lim)},
	}
	if len(a.CategoryIDs) > 0 {
		out.CategoryIds = &a.CategoryIDs
	}
	if a.isHolder(tc) {
		out.My.IsHolder = new(true)
	}
	if tc.Owner || a.isHolder(tc) || slices.Contains(rights, actionBalance) {
		b := signedOf(a.Balance, a.Currency)
		out.Balance = &b
	}
	if a.Kind == kindDrawer {
		var id uuid.UUID
		err := q.QueryRow(ctx, `select id from cash.shifts where account_id = $1 and status = 'open'`, a.ID).Scan(&id)
		switch {
		case err == nil:
			out.OpenShiftId = &id
		case !errors.Is(err, pgx.ErrNoRows):
			return cashapi.CashAccount{}, fmt.Errorf("cash: open shift: %w", err)
		}
	}
	return out, nil
}

// AccountsQuery filters the list of accounts.
type AccountsQuery struct {
	PageQuery
	Kind      string
	OrgUnitID uuid.UUID
}

// ListAccounts returns the accounts the actor sees (listCashAccounts): cash.read over them or the advance the actor
// holds; the balance only with cash.balance.read.
func (s *Service) ListAccounts(ctx context.Context, tc tenantctx.TenantContext, q AccountsQuery) (cashapi.CashAccountPage, error) {
	limit, at, after, err := q.page()
	if err != nil {
		return cashapi.CashAccountPage{}, err
	}
	var out cashapi.CashAccountPage
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		ev := s.evaluator(tx)
		pred, err := s.visibleSQL(ctx, ev, tc, "a", 5, true)
		if err != nil {
			return err
		}
		var unit any
		if q.OrgUnitID != uuid.Nil {
			unit = q.OrgUnitID
		}
		args := append([]any{nilStr(q.Kind), unit, at, after, limit + 1}, pred.Args...)
		rows, err := tx.Query(ctx, `select `+accountCols+` from cash.accounts a
		 where ($1::text is null or a.kind = $1) and ($2::uuid is null or a.org_unit_id = $2)
		   and ($3::timestamptz is null or (a.created_at, a.id) > ($3::timestamptz, $4::uuid))
		   and `+pred.SQL+` order by a.created_at, a.id limit $5`, args...)
		if err != nil {
			return fmt.Errorf("cash: accounts: %w", err)
		}
		accounts, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (account, error) { return scanAccount(r) })
		if err != nil {
			return fmt.Errorf("cash: accounts: %w", err)
		}
		rights, err := s.rightsBatch(ctx, tx, ev, tc, accounts[:min(limit, len(accounts))])
		if err != nil {
			return err
		}
		out = cashapi.CashAccountPage{Items: []cashapi.CashAccount{}}
		for i, a := range accounts {
			if i == limit {
				next := encodeCursor(accounts[limit-1].CreatedAt, accounts[limit-1].ID)
				out.NextCursor = &next
				break
			}
			dto, err := s.accountDTO(ctx, tx, tc, a, rights[a.ID])
			if err != nil {
				return err
			}
			out.Items = append(out.Items, dto)
		}
		return nil
	})
	return out, err
}

func nilStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// accountIn is a validated body of createCashAccount.
type accountIn struct {
	Kind, Name, ShiftMode, KktMode, Currency string
	Unit, Holder, Responsible, Drawer        *uuid.UUID
	BalanceLimit, Float, Tolerance, Advance  *int64
	SettleDays, Fee                          *int
	Categories                               []string
}

const (
	maxName = 150
	// advanceDefault are the categories an advance takes by default: «Топливо, Мойка, Парковка, Мелкий ремонт»
	// (cash.js `CATS.out.slice(0, 4)`).
	advanceDefault = "fuel,wash,parking,repair-small"
)

func limitMinor(m *cashapi.Money) (*int64, error) {
	if m == nil {
		return nil, nil
	}
	if m.AmountMinor < 0 || m.AmountMinor > maxMinor {
		return nil, invalid("Лимит — от нуля до предельной суммы")
	}
	if m.Currency != currencyRUB {
		return nil, invalid(textCurrency)
	}
	v := int64(m.AmountMinor)
	return &v, nil
}

// validateAccount checks the body of createCashAccount and drops what its kind does not have: shifts, the KKT, the float
// and the tolerance are of a drawer, the holder and the limit on hands of an advance, the settlement of a terminal.
func validateAccount(b *cashapi.CashAccountCreate) (accountIn, error) {
	if b == nil {
		return accountIn{}, problem.New(problem.CodeMalformedRequest, "")
	}
	in := accountIn{Kind: string(b.Kind), Name: strings.TrimSpace(b.Name), Currency: b.Currency, Unit: b.OrgUnitId,
		Holder: b.HolderMemberId, Responsible: b.ResponsibleMemberId, Drawer: b.DrawerAccountId, ShiftMode: modeNone, KktMode: modeNone}
	if n := utf8.RuneCountInString(in.Name); n < 2 || n > maxName {
		return in, invalid("Укажите название кассы — от 2 до 150 знаков")
	}
	if in.Currency != currencyRUB {
		return in, invalid(textCurrency)
	}
	if err := readLimits(&in, b); err != nil {
		return in, err
	}
	if err := applyKind(&in, b); err != nil {
		return in, err
	}
	if in.SettleDays != nil && (*in.SettleDays < 0 || *in.SettleDays > 30) || in.Fee != nil && (*in.Fee < 0 || *in.Fee > 10000) {
		return in, invalid("Зачисление — до 30 дней, комиссия — до 100 %")
	}
	return in, nil
}

// readLimits reads the limits of the body: of the balance, the float, the tolerance and the money in hand.
func readLimits(in *accountIn, b *cashapi.CashAccountCreate) error {
	for _, l := range []struct {
		src *cashapi.Money
		dst **int64
	}{{b.BalanceLimit, &in.BalanceLimit}, {b.FloatAmount, &in.Float}, {b.Tolerance, &in.Tolerance}, {b.AdvanceLimit, &in.Advance}} {
		v, err := limitMinor(l.src)
		if err != nil {
			return err
		}
		*l.dst = v
	}
	return nil
}

// applyKind keeps in the account what its kind has.
func applyKind(in *accountIn, b *cashapi.CashAccountCreate) error {
	switch in.Kind {
	case kindDrawer:
		if b.ShiftMode != nil {
			in.ShiftMode = string(*b.ShiftMode)
		}
		if b.KktMode != nil {
			in.KktMode = string(*b.KktMode)
		}
		in.Drawer, in.Holder, in.Advance = nil, nil, nil
	case kindAdvance:
		if in.Holder == nil {
			return invalid("Выберите сотрудника")
		}
		in.Float, in.Tolerance = nil, nil
		in.Categories = defaultAdvanceCategories()
		if b.CategoryIds != nil && len(*b.CategoryIds) > 0 {
			in.Categories = *b.CategoryIds
		}
	case kindAcquiring:
		if in.Drawer == nil {
			return invalid("Выберите кассу точки: терминал привязан к кассе")
		}
		in.Holder, in.Float, in.Tolerance, in.Advance = nil, nil, nil, nil
		in.SettleDays, in.Fee = b.SettleDays, b.FeeBasisPoints
	default:
		in.Holder, in.Drawer, in.Float, in.Tolerance, in.Advance = nil, nil, nil, nil, nil
	}
	return nil
}

func defaultAdvanceCategories() []string { return strings.Split(advanceDefault, ",") }

// CreateAccount creates a zero-balance account (createCashAccount): cash.accounts.manage in the unit of the account (a
// tenant-wide account — a tenant grant only); the name is unique; an advance has its holder and the account it is
// topped up from (the drawer of the unit, else a safe); a terminal is bound to a drawer.
func (s *Service) CreateAccount(ctx context.Context, tc tenantctx.TenantContext, b *cashapi.CashAccountCreate) (cashapi.CashAccount, error) {
	in, err := validateAccount(b)
	if err != nil {
		return cashapi.CashAccount{}, err
	}
	var out cashapi.CashAccount
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		var err error
		out, err = s.createAccountTx(ctx, tx, tc, in)
		if err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusCreated, etag(out.Revision), out)
	})
	return out, err
}

func (s *Service) createAccountTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, in accountIn) (cashapi.CashAccount, error) {
	ev := s.evaluator(tx)
	res := authz.Resource{ReadAction: actionRead}
	if in.Unit != nil {
		res.Unit = *in.Unit
	}
	if err := ev.Permit(ctx, tc, actionManage, res); err != nil {
		return cashapi.CashAccount{}, err
	}
	if err := s.checkRefs(ctx, tx, &in); err != nil {
		return cashapi.CashAccount{}, err
	}
	id, err := insertAccount(ctx, tx, tc, in)
	if err != nil {
		return cashapi.CashAccount{}, err
	}
	a, err := loadAccount(ctx, tx, id)
	if err != nil {
		return cashapi.CashAccount{}, err
	}
	if err := record(ctx, tx, tc, "cash.account.create", targetAccount, id, in.Unit, "",
		map[string]any{"kind": in.Kind, "name": in.Name}); err != nil {
		return cashapi.CashAccount{}, err
	}
	rights, err := rightsOf(ctx, ev, tc, a)
	if err != nil {
		return cashapi.CashAccount{}, err
	}
	return s.accountDTO(ctx, tx, tc, a, rights)
}

func insertAccount(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, in accountIn) (uuid.UUID, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `insert into cash.accounts (org_unit_id, name, currency, kind, shift_mode, kkt_mode, balance_limit_minor,
	        float_minor, tolerance_minor, responsible_id, holder_id, advance_limit_minor, drawer_account_id, settle_days,
	        fee_basis_points, category_ids, created_by)
	      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) returning id`,
		in.Unit, in.Name, in.Currency, in.Kind, in.ShiftMode, in.KktMode, in.BalanceLimit, in.Float, in.Tolerance,
		in.Responsible, in.Holder, in.Advance, in.Drawer, in.SettleDays, in.Fee, nonNil(in.Categories), nilID(tc.PersonID)).Scan(&id)
	if code, cons := pgCode(err); code == "23505" && cons == "accounts_name_idx" {
		return uuid.Nil, invalid("Касса с таким названием уже есть")
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("cash: insert account: %w", err)
	}
	return id, nil
}

func nonNil(v []string) []string {
	if v == nil {
		return []string{}
	}
	return v
}

func nilID(id uuid.UUID) *uuid.UUID {
	if id == uuid.Nil {
		return nil
	}
	return &id
}

// exists reports whether the query finds a row.
func exists(ctx context.Context, q Querier, sql string, args ...any) (bool, error) {
	var ok bool
	if err := q.QueryRow(ctx, `select exists (`+sql+`)`, args...).Scan(&ok); err != nil {
		return false, fmt.Errorf("cash: lookup: %w", err)
	}
	return ok, nil
}

// checkRefs checks what the new account refers to and fills the source of an advance.
func (s *Service) checkRefs(ctx context.Context, tx pgx.Tx, in *accountIn) error {
	if in.Unit != nil {
		if ok, err := exists(ctx, tx, `select 1 from org.units where id = $1 and archived_at is null`, *in.Unit); err != nil {
			return err
		} else if !ok {
			return invalid("Подразделение не найдено")
		}
	}
	for _, p := range []*uuid.UUID{in.Holder, in.Responsible} {
		if p == nil {
			continue
		}
		if ok, err := exists(ctx, tx, `select 1 from people.person_profiles where id = $1 and archived_at is null`, *p); err != nil {
			return err
		} else if !ok {
			return invalid("Сотрудник не найден")
		}
	}
	if in.Kind == kindAcquiring {
		if d, err := loadAccount(ctx, tx, *in.Drawer); err != nil || d.Kind != kindDrawer {
			return invalid("Терминал привязывается к наличной кассе точки")
		}
	}
	if in.Kind == kindAdvance {
		if err := s.advanceSource(ctx, tx, in); err != nil {
			return err
		}
	}
	return checkCategories(ctx, tx, in.Categories)
}

func checkCategories(ctx context.Context, tx pgx.Tx, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	var n int
	if err := tx.QueryRow(ctx, `select count(*) from cash.categories where id = any($1) and group_name = 'expense'`, ids).Scan(&n); err != nil {
		return fmt.Errorf("cash: categories: %w", err)
	}
	if n != len(ids) {
		return invalid("Статья подотчёта не найдена")
	}
	return nil
}

// advanceSource picks the account an advance is topped up from when none is given: the drawer of its unit, else a safe.
func (s *Service) advanceSource(ctx context.Context, tx pgx.Tx, in *accountIn) error {
	if in.Drawer != nil {
		d, err := loadAccount(ctx, tx, *in.Drawer)
		if err != nil || (d.Kind != kindDrawer && d.Kind != kindSafe) {
			return invalid("Подотчёт пополняется из кассы или сейфа")
		}
		return nil
	}
	var id uuid.UUID
	err := tx.QueryRow(ctx, `select id from cash.accounts
	 where (kind = 'cash_drawer' and org_unit_id is not distinct from $1) or kind = 'safe'
	 order by (kind = 'cash_drawer' and org_unit_id is not distinct from $1) desc, created_at limit 1`, in.Unit).Scan(&id)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil // the source is chosen at the issue
	case err != nil:
		return fmt.Errorf("cash: advance source: %w", err)
	}
	in.Drawer = &id
	return nil
}

// AccessQuery is the draft of an account whose access is previewed.
type AccessQuery struct {
	Kind   string
	Unit   uuid.UUID
	Holder uuid.UUID
}

// accessPerson collects the rights one person would get.
type accessPerson struct {
	name     string
	rights   map[string]bool
	onlySelf bool
}

// PreviewAccess lists who would get access to an account being created (previewCashAccountAccess): the people whose
// roles cover the unit (the tenant, the unit or its ancestors with the subtree) and the holder of an advance through
// the scope «self», with their rights and limits and the pairs of duties that conflict.
func (s *Service) PreviewAccess(ctx context.Context, tc tenantctx.TenantContext, q AccessQuery) (cashapi.CashAccessPreview, error) {
	out := cashapi.CashAccessPreview{Items: []cashapi.CashAccessPerson{}}
	err := s.inTx(ctx, tc, func(tx pgx.Tx) error {
		res := authz.Resource{ReadAction: actionRead}
		if q.Unit != uuid.Nil {
			res.Unit = q.Unit
		}
		if err := s.evaluator(tx).Permit(ctx, tc, actionManage, res); err != nil {
			return err
		}
		people, order, err := s.accessRows(ctx, tx, q)
		if err != nil {
			return err
		}
		for _, id := range order {
			item, err := s.accessItem(ctx, tx, id, people[id])
			if err != nil {
				return err
			}
			out.Items = append(out.Items, item)
		}
		return nil
	})
	return out, err
}

// accessRows reads the active role assignments that cover the unit (or give the holder his «self»), by person.
func (s *Service) accessRows(ctx context.Context, tx pgx.Tx, q AccessQuery) (map[uuid.UUID]*accessPerson, []uuid.UUID, error) {
	var unit, holder any
	if q.Unit != uuid.Nil {
		unit = q.Unit
	}
	if q.Holder != uuid.Nil {
		holder = q.Holder
	}
	rows, err := tx.Query(ctx, `
	select p.id, p.full_name, ra.scope_kind, rv.actions
	  from access.role_assignments ra
	  join access.roles r on r.id = ra.role_id and r.archived_at is null
	  join access.role_versions rv on rv.role_id = ra.role_id and rv.version = ra.role_version
	  join people.person_profiles p on p.id = ra.principal_id and p.archived_at is null
	 where ra.principal_kind = 'person' and ra.state = 'active' and ra.valid @> $1::timestamptz
	   and rv.actions && $2::text[]
	   and (ra.scope_kind = 'tenant'
	        or (ra.scope_kind = 'unit' and $3::uuid is not null and (ra.scope_ref = $3::uuid
	             or (ra.include_descendants and ra.scope_ref in (select ancestor_id from org.unit_closure where descendant_id = $3::uuid))))
	        or (ra.scope_kind = 'self' and p.id = $4::uuid))
	 order by p.full_name, p.id`, s.now(), accountActions, unit, holder)
	if err != nil {
		return nil, nil, fmt.Errorf("cash: access preview: %w", err)
	}
	defer rows.Close()
	people := map[uuid.UUID]*accessPerson{}
	var order []uuid.UUID
	for rows.Next() {
		var (
			id      uuid.UUID
			name    string
			scope   string
			actions []string
		)
		if err := rows.Scan(&id, &name, &scope, &actions); err != nil {
			return nil, nil, fmt.Errorf("cash: access preview: %w", err)
		}
		p := people[id]
		if p == nil {
			p = &accessPerson{name: name, rights: map[string]bool{}, onlySelf: true}
			people[id] = p
			order = append(order, id)
		}
		p.add(scope, actions)
	}
	return people, order, rows.Err()
}

// add takes the actions of a role of the scope: the right of an own advance only through «self».
func (p *accessPerson) add(scope string, actions []string) {
	if scope != "self" {
		p.onlySelf = false
	}
	for _, a := range actions {
		if slices.Contains(accountActions, a) && (a != actionSelf || scope == "self") {
			p.rights[a] = true
		}
	}
}

func (s *Service) accessItem(ctx context.Context, tx pgx.Tx, id uuid.UUID, p *accessPerson) (cashapi.CashAccessPerson, error) {
	rights := []string{}
	for _, a := range accountActions {
		if p.rights[a] {
			rights = append(rights, a)
		}
	}
	lim, err := s.limits().Limits(ctx, tx, Who{Person: id}, uuid.Nil)
	if err != nil {
		return cashapi.CashAccessPerson{}, err
	}
	via := cashapi.CashAccessPersonViaRole
	if p.onlySelf {
		via = cashapi.CashAccessPersonViaSelf
	}
	return cashapi.CashAccessPerson{MemberId: id, Name: p.name, Via: via, Rights: rights, Limits: limitsDTO(lim), Conflicts: conflictsOf(p.rights)}, nil
}

// conflictsOf names the pairs of duties one person holds together («вносит + согласует», «закрывает + принимает
// расхождение»; макет 1b).
func conflictsOf(rights map[string]bool) []string {
	out := []string{}
	if rights[actionPost] && rights[actionApprove] {
		out = append(out, "Вносит операции и согласует заявки: разделите обязанности")
	}
	if rights[actionShift] && rights[actionReconcile] {
		out = append(out, "Закрывает смены и принимает расхождение: разделите обязанности")
	}
	return out
}
