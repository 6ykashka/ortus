package cash

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// manual is a checked body of postCashOperation.
type manual struct {
	Type, Direction, Category string
	Amount                    int64
	Basis                     string
	Occurred                  time.Time
	Method                    string
	CategoryID                *string
	Refunds                   *uuid.UUID
	Receipt                   *cashapi.CashReceipt
	Related                   *cashapi.ObjectRef
	Source                    *srcRef
}

func (m manual) action() string {
	switch m.Type {
	case typeRefund:
		return actionRefund
	case typeOpening:
		return actionManage
	}
	return actionPost
}

// limitKind is the kind of limit of a role the operation falls under; "" — none.
func (m manual) limitKind() string {
	if m.Type == typeOut || m.Type == typeRefund {
		return m.Type
	}
	return ""
}

// validateManual checks the body of postCashOperation without the database.
func (s *Service) validateManual(b *cashapi.CashOperationCreate) (manual, error) {
	if b == nil {
		return manual{}, problem.New(problem.CodeMalformedRequest, "")
	}
	amount, err := checkAmount(b.Amount)
	if err != nil {
		return manual{}, err
	}
	typ, dir, cat, err := operationKind(*b)
	if err != nil {
		return manual{}, err
	}
	basis, err := checkBasis(b.Basis)
	if err != nil {
		return manual{}, err
	}
	m := manual{Type: typ, Direction: dir, Category: cat, Amount: amount, Basis: basis, Occurred: b.OccurredAt.UTC(),
		CategoryID: b.CategoryId, Receipt: b.Receipt, Related: b.RelatedObject}
	if m.Occurred.IsZero() {
		m.Occurred = s.now()
	}
	if err := m.readOptional(b); err != nil {
		return manual{}, err
	}
	return m, nil
}

// readOptional takes the optional fields of the body: the way of payment, the payment a refund is bound to, the related
// object and the source.
func (m *manual) readOptional(b *cashapi.CashOperationCreate) error {
	if b.Method != nil {
		m.Method = string(*b.Method)
	}
	if b.RefundsOperationId != nil {
		m.Refunds = b.RefundsOperationId
	}
	if m.Type == typeRefund && m.Refunds == nil {
		return invalid("Возврат проводится по оплате — выберите операцию прихода")
	}
	if r := b.RelatedObject; r != nil && (!moduleRE.MatchString(r.ModuleKey) || !kindRE.MatchString(r.EntityType) || r.EntityId == uuid.Nil) {
		return invalid("Связанный объект указан неверно")
	}
	var err error
	m.Source, err = sourceOf(b.Source)
	return err
}

// resolve applies the rules that need the database to a checked body over account a (no access checks: the approval of
// a request runs it again in the name of its author): the way of payment and the account the money goes to, the open
// shift, the refund against the payment, the receipt of the KKT, the opening balance.
func (s *Service) resolve(ctx context.Context, tx pgx.Tx, a account, m manual, createdBy uuid.UUID) (opSpec, error) {
	sp := opSpec{Type: m.Type, Direction: m.Direction, Category: m.Category, Amount: m.Amount, Basis: m.Basis, OccurredAt: m.Occurred,
		CreatedBy: createdBy, Origin: originManual, Related: m.Related, Source: m.Source, Refunds: m.Refunds,
		NeedShift: m.Type != typeOpening}
	if a.Kind == kindAdvance && m.Type != typeOpening {
		return sp, problem.New(problem.CodeForbiddenAction, "Подотчёт пополняется выдачей из кассы, расход отчитывается чеком сотрудника")
	}
	method := m.Method
	if method == "" {
		method = defaultMethod(a.Kind)
	}
	t, err := target(ctx, tx, a, method)
	if err != nil {
		return sp, err
	}
	point, err := pointOf(ctx, tx, t)
	if err != nil {
		return sp, err
	}
	sp.Target, sp.Point, sp.Method = t, point, method
	if err := s.resolveRules(ctx, tx, &sp, m); err != nil {
		return sp, err
	}
	sp.Receipt, err = checkReceipt(point.KktMode == kktManual, m.Type, m.Receipt)
	return sp, err
}

// resolveRules checks the category, the opening balance and the refund of a resolved operation.
func (s *Service) resolveRules(ctx context.Context, tx pgx.Tx, sp *opSpec, m manual) error {
	if m.CategoryID != nil {
		if err := checkCategory(ctx, tx, *m.CategoryID, m.Direction); err != nil {
			return err
		}
		sp.CategoryID = m.CategoryID
	}
	switch m.Type {
	case typeOpening:
		if ok, err := exists(ctx, tx, `select 1 from cash.operations where account_id = $1`, sp.Target.ID); err != nil {
			return err
		} else if ok {
			return invalid("Ввод остатка возможен, пока у кассы нет операций")
		}
		sp.NeedShift = false
	case typeRefund:
		return s.checkRefundOf(ctx, tx, sp.Point, *m.Refunds, m.Amount)
	}
	return nil
}

// checkRefundOf checks the refund against its payment: a receipt of the same point account, the refunds done and this
// one not above it.
func (s *Service) checkRefundOf(ctx context.Context, tx pgx.Tx, point account, paymentID uuid.UUID, amount int64) error {
	// the journal takes no row locks (insert only): the refunds of one payment go one by one under an advisory lock
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('cash.refund:' || $1::text, 0))`, paymentID); err != nil {
		return fmt.Errorf("cash: lock: %w", err)
	}
	var typ string
	var pay int64
	var pointID uuid.UUID
	err := tx.QueryRow(ctx, `select type, amount_minor, point_account_id from cash.operations where id = $1`, paymentID).Scan(&typ, &pay, &pointID)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && (typ != typeIn || pointID != point.ID)) {
		return invalid("Возврат проводится по оплате — выберите операцию прихода в этой кассе")
	}
	if err != nil {
		return fmt.Errorf("cash: payment: %w", err)
	}
	var done int64
	if err := tx.QueryRow(ctx, `select coalesce(sum(r.amount_minor), 0) from cash.operations r
	 where r.refunds_operation_id = $1 and r.type = 'refund'
	   and not exists (select 1 from cash.operations s where s.reverses_operation_id = r.id)`, paymentID).Scan(&done); err != nil {
		return fmt.Errorf("cash: refunds: %w", err)
	}
	return checkRefund(pay, done, amount)
}

// PostOperation records a receipt, an expense, a refund or the opening balance (postCashOperation). Above the limit of
// the role the operation becomes an approval request (the second result); a reversal goes to ReverseOperation.
func (s *Service) PostOperation(ctx context.Context, tc tenantctx.TenantContext, b *cashapi.CashOperationCreate) (*cashapi.CashOperation, *cashapi.CashApprovalRequest, error) {
	m, err := s.validateManual(b)
	if err != nil {
		return nil, nil, err
	}
	var (
		op  *cashapi.CashOperation
		req *cashapi.CashApprovalRequest
	)
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		var err error
		if op, req, err = s.postOperationTx(ctx, tx, tc, b, m); err != nil {
			return err
		}
		if req != nil {
			return complete(ctx, tx, http.StatusAccepted, etag(req.Revision), *req)
		}
		return complete(ctx, tx, http.StatusCreated, "", *op)
	})
	return op, req, err
}

func (s *Service) postOperationTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, b *cashapi.CashOperationCreate, m manual) (*cashapi.CashOperation, *cashapi.CashApprovalRequest, error) {
	a, err := loadAccount(ctx, tx, b.AccountId)
	if err != nil {
		return nil, nil, err
	}
	if err := s.permit(ctx, s.evaluator(tx), tc, a, m.action()); err != nil {
		return nil, nil, err
	}
	sp, err := s.resolve(ctx, tx, a, m, tc.PersonID)
	if err != nil {
		return nil, nil, err
	}
	if req, err := s.overLimitRequest(ctx, tx, tc, a, m, sp, b); err != nil || req != nil {
		return nil, req, err
	}
	x, err := s.write(ctx, tx, tc, sp)
	if err != nil {
		return nil, nil, err
	}
	return &x.CashOperation, nil, nil
}

// overLimitRequest records the approval request of an operation above the limit of the role of its author; nil — the
// operation is within the limit.
func (s *Service) overLimitRequest(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, a account, m manual, sp opSpec, b *cashapi.CashOperationCreate) (*cashapi.CashApprovalRequest, error) {
	kind := m.limitKind()
	if kind == "" {
		return nil, nil
	}
	lim, err := s.limitsFor(ctx, tx, tc, a.ID)
	if err != nil {
		return nil, err
	}
	l := lim.of(kind)
	if !overLimit(l, m.Amount) {
		return nil, nil
	}
	r, err := s.request(ctx, tx, tc, a, requestSpec{Type: kind, Amount: m.Amount, Method: &sp.Method, CategoryID: m.CategoryID,
		Basis: m.Basis, Source: m.Source, Limit: *l, Payload: payload{Op: b}})
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// ReverseOperation reverses an operation by a new row «storno» that points at it (reverseCashOperation): cash.reverse
// over its account; an operation is reversed once, a transfer is corrected by the reverse transfer; the owner reverses
// an own operation (marked own), others do not (Q-W4.00-cash-3).
func (s *Service) ReverseOperation(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, reasonIn *string) (cashapi.CashOperation, error) {
	reason, err := reasonOf(reasonIn, "Укажите причину исправления")
	if err != nil {
		return cashapi.CashOperation{}, err
	}
	var out cashapi.CashOperation
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		var err error
		if out, err = s.reverseTx(ctx, tx, tc, id, reason); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusCreated, "", out)
	})
	return out, err
}

func (s *Service) reverseTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, id uuid.UUID, reason string) (cashapi.CashOperation, error) {
	o, err := readOp(ctx, tx, id)
	if err != nil {
		return cashapi.CashOperation{}, err
	}
	a, err := loadAccount(ctx, tx, o.AccountID)
	if err != nil {
		return cashapi.CashOperation{}, err
	}
	if err := s.permit(ctx, s.evaluator(tx), tc, a, actionReverse); err != nil {
		return cashapi.CashOperation{}, err
	}
	own, err := reversible(o, tc)
	if err != nil {
		return cashapi.CashOperation{}, err
	}
	point, err := pointOf(ctx, tx, a)
	if err != nil {
		return cashapi.CashOperation{}, err
	}
	dir := dirIn
	if string(o.Direction) == dirIn {
		dir = dirOut
	}
	x, err := s.write(ctx, tx, tc, opSpec{Target: a, Point: point, Type: typeStorno, Direction: dir, Category: string(o.Category),
		CategoryID: o.CategoryId, Amount: int64(o.Amount.AmountMinor), Method: string(o.Method),
		Basis: "Сторно K-" + strconv.FormatInt(o.Number, 10) + ": " + reason, OccurredAt: s.now(), CreatedBy: tc.PersonID,
		Origin: originManual, Reverses: &id, Own: own})
	return x.CashOperation, err
}

// reversible checks that an operation may be reversed by the actor and tells whether it is his own.
func reversible(o opRow, tc tenantctx.TenantContext) (own bool, err error) {
	switch {
	case o.ReversedByOperationId != nil || o.TypeRaw == typeStorno:
		return false, problem.New(codeInvalidTransition, "Операция уже исправлена")
	case o.TypeRaw == typeMoveIn || o.TypeRaw == typeMoveOut:
		return false, invalid("Перемещение исправляется обратным перемещением")
	case o.Created == tc.PersonID && !tc.Owner:
		return false, problem.New(codeSelfApproval, "Свою операцию сторнирует второй сотрудник с правом «Проверять»")
	}
	return o.Created == tc.PersonID, nil
}

// LinkSource links an operation to the source of a proposal by a row of its own (linkCashOperationSource): the journal is
// not edited. A manual operation of the same amount in the account (or its terminal); one source is claimed once.
func (s *Service) LinkSource(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ref cashapi.CashSourceRef) (cashapi.CashOperationSourceLink, error) {
	src, err := sourceOf(&ref)
	if err != nil {
		return cashapi.CashOperationSourceLink{}, err
	}
	var out cashapi.CashOperationSourceLink
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		at, err := s.linkTx(ctx, tx, tc, id, src)
		if err != nil {
			return err
		}
		out = cashapi.CashOperationSourceLink{OperationId: id, Source: ref, LinkedAt: at, LinkedByMemberId: tc.PersonID}
		return complete(ctx, tx, http.StatusCreated, "", out)
	})
	return out, err
}

func (s *Service) linkTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, id uuid.UUID, src *srcRef) (time.Time, error) {
	o, err := readOp(ctx, tx, id)
	if err != nil {
		return time.Time{}, err
	}
	a, err := loadAccount(ctx, tx, o.AccountID)
	if err != nil {
		return time.Time{}, err
	}
	if err := s.permit(ctx, s.evaluator(tx), tc, a, actionPost); err != nil {
		return time.Time{}, err
	}
	if o.Source != nil || o.TypeRaw == typeStorno {
		return time.Time{}, problem.New(codeDuplicateSource, "Операция уже связана с источником")
	}
	proposed, err := checkLinkable(ctx, tx, o, a, src.Key)
	if err != nil {
		return time.Time{}, err
	}
	group := id
	if o.GroupId != nil {
		group = *o.GroupId
	}
	at := s.now()
	if err := claimSource(ctx, tx, src.Key, group, tc.PersonID); err != nil {
		return time.Time{}, err
	}
	if _, err := tx.Exec(ctx, `insert into cash.operation_links (operation_id, source_key, source_kind, source_id, source_label, linked_by, linked_at)
	 values ($1, $2, $3, $4, $5, $6, $7)`, id, src.Key, src.Kind, src.ID, src.Label, tc.PersonID, at); err != nil {
		if code, _ := pgCode(err); code == "23505" {
			return time.Time{}, problem.New(codeDuplicateSource, "Операция уже связана с источником")
		}
		return time.Time{}, fmt.Errorf("cash: link: %w", err)
	}
	if proposed {
		if _, err := tx.Exec(ctx, `update cash.proposals set status = 'posted', posted_at = $2, posted_by = $3, group_id = $4 where key = $1`,
			src.Key, at, tc.PersonID, group); err != nil {
			return time.Time{}, fmt.Errorf("cash: proposal: %w", err)
		}
	}
	return at, record(ctx, tx, tc, "cash.operation.link", targetOp, id, a.Unit, "", map[string]any{"sourceKey": src.Key})
}

// checkLinkable checks the proposal the operation is linked to (when the key is one of a proposal): open, the same amount
// and the same account.
func checkLinkable(ctx context.Context, tx pgx.Tx, o opRow, a account, key string) (proposed bool, err error) {
	var amount int64
	var status string
	var def *uuid.UUID
	err = tx.QueryRow(ctx, `select amount_minor, status, default_account_id from cash.proposals where key = $1 for update`, key).Scan(&amount, &status, &def)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return false, nil
	case err != nil:
		return false, fmt.Errorf("cash: proposal: %w", err)
	case status != statusOpen:
		return false, problem.New(codeInvalidTransition, "Предложение уже проведено, отклонено или недоступно")
	case amount != int64(o.Amount.AmountMinor) || (def != nil && *def != a.ID && *def != a.area()):
		return false, invalid("Связать можно ручную операцию на ту же сумму в этой кассе")
	}
	return true, nil
}

// claimSource claims the key of a source: one source is one operation or group (a second claim is duplicate_source).
func claimSource(ctx context.Context, tx pgx.Tx, key string, group, by uuid.UUID) error {
	if _, err := tx.Exec(ctx, `insert into cash.source_claims (source_key, group_id, claimed_by) values ($1, $2, $3)`, key, group, by); err != nil {
		if code, _ := pgCode(err); code == "23505" {
			return problem.New(codeDuplicateSource, "Источник уже проведён")
		}
		return fmt.Errorf("cash: claim: %w", err)
	}
	return nil
}

// DuplicatesQuery is the draft of an operation whose duplicates are searched.
type DuplicatesQuery struct {
	AccountID uuid.UUID
	Amount    int64
	Method    string
	Type      string
	At        time.Time
}

// FindDuplicates lists the operations that look like the one being entered (findCashDuplicates): the same point account,
// amount, way of payment and type within ten minutes (Q-W4.00-cash-6); reversed ones and storno rows do not count.
func (s *Service) FindDuplicates(ctx context.Context, tc tenantctx.TenantContext, q DuplicatesQuery) (cashapi.CashDuplicateList, error) {
	if q.AccountID == uuid.Nil || q.Amount <= 0 {
		return cashapi.CashDuplicateList{}, invalid("Укажите кассу и сумму")
	}
	if q.Type == "" {
		q.Type = typeIn
	}
	if q.Type != typeIn && q.Type != typeOut && q.Type != typeRefund {
		return cashapi.CashDuplicateList{}, invalid("Тип операции — приход, расход или возврат")
	}
	out := cashapi.CashDuplicateList{Items: []cashapi.CashOperation{}}
	err := s.inTx(ctx, tc, func(tx pgx.Tx) error {
		a, err := loadAccount(ctx, tx, q.AccountID)
		if err != nil {
			return err
		}
		if err := s.permit(ctx, s.evaluator(tx), tc, a, actionPost); err != nil {
			return err
		}
		list, err := s.duplicates(ctx, tx, a, q)
		if err != nil {
			return err
		}
		for _, x := range list {
			out.Items = append(out.Items, x.CashOperation)
		}
		return nil
	})
	return out, err
}

func (s *Service) duplicates(ctx context.Context, tx pgx.Tx, a account, q DuplicatesQuery) ([]opRow, error) {
	point, err := pointOf(ctx, tx, a)
	if err != nil {
		return nil, err
	}
	method := q.Method
	if method == "" {
		method = defaultMethod(a.Kind)
	}
	at := q.At
	if at.IsZero() {
		at = s.now()
	}
	from, to := duplicateWindow(at.UTC())
	rows, err := tx.Query(ctx, `select `+opCols+opFrom+`
	 where o.point_account_id = $1 and o.amount_minor = $2 and o.method = $3 and o.type = $4
	   and o.occurred_at between $5 and $6
	   and not exists (select 1 from cash.operations s where s.reverses_operation_id = o.id)
	 order by o.occurred_at desc, o.id`, point.ID, q.Amount, method, q.Type, from, to)
	if err != nil {
		return nil, fmt.Errorf("cash: duplicates: %w", err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (opRow, error) { return scanOp(r) })
	if err != nil {
		return nil, fmt.Errorf("cash: duplicates: %w", err)
	}
	return list, nil
}

// OperationsQuery filters the journal.
type OperationsQuery struct {
	PageQuery
	AccountID uuid.UUID
	Type      string
	ShiftID   uuid.UUID
}

// ListOperations returns the journal rows of the accounts the actor sees (listCashOperations), newest first.
func (s *Service) ListOperations(ctx context.Context, tc tenantctx.TenantContext, q OperationsQuery) (cashapi.CashOperationPage, error) {
	limit, at, after, err := q.page()
	if err != nil {
		return cashapi.CashOperationPage{}, err
	}
	var out cashapi.CashOperationPage
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		pred, err := s.visibleSQL(ctx, s.evaluator(tx), tc, "a", 6, true)
		if err != nil {
			return err
		}
		args := append([]any{nilID(q.AccountID), nilStr(q.Type), nilID(q.ShiftID), at, after, limit + 1}, pred.Args...)
		rows, err := tx.Query(ctx, `select `+opCols+opFrom+` join cash.accounts a on a.id = o.account_id
		 where ($1::uuid is null or o.account_id = $1 or o.point_account_id = $1) and ($2::text is null or o.type = $2)
		   and ($3::uuid is null or o.shift_id = $3)
		   and ($4::timestamptz is null or (o.posted_at, o.id) < ($4::timestamptz, $5::uuid))
		   and `+pred.SQL+` order by o.posted_at desc, o.id desc limit $6`, args...)
		if err != nil {
			return fmt.Errorf("cash: operations: %w", err)
		}
		list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (opRow, error) { return scanOp(r) })
		if err != nil {
			return fmt.Errorf("cash: operations: %w", err)
		}
		out = cashapi.CashOperationPage{Items: []cashapi.CashOperation{}}
		for i, x := range list {
			if i == limit {
				next := encodeCursor(list[limit-1].PostedAt, list[limit-1].Id)
				out.NextCursor = &next
				break
			}
			out.Items = append(out.Items, x.CashOperation)
		}
		return nil
	})
	return out, err
}
