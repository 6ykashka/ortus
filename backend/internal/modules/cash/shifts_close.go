package cash

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// zOf checks the Z report: the number and the sums.
func zOf(z *cashapi.CashShiftZ, required bool) (*zTotals, error) {
	const text = "Перепишите итоги Z-отчёта: номер, наличными и безналичными. Если ККТ не работала — укажите 0"
	if z == nil {
		if required {
			return nil, invalid(text)
		}
		return nil, nil
	}
	num := strings.TrimSpace(z.Number)
	cash, err1 := nonNegative(z.Cash)
	card, err2 := nonNegative(z.Card)
	if num == "" || utf8.RuneCountInString(num) > 20 || err1 != nil || err2 != nil {
		return nil, invalid(text)
	}
	return &zTotals{Number: num, Cash: cash, Card: card}, nil
}

// closeReq is a checked body of closeCashShift.
type closeReq struct {
	counted int64
	kept    map[string]int // the notes that have pieces
	coins   int64
	zIn     *cashapi.CashShiftZ
	term    *termTotals
	toSafe  bool
}

// parseClose checks the body of closeCashShift without the database: the count by denominations agrees with the counted
// sum, the terminal totals are sums.
func parseClose(b *cashapi.CashShiftClose) (closeReq, error) {
	if b == nil {
		return closeReq{}, problem.New(problem.CodeMalformedRequest, "")
	}
	counted, err := nonNegative(b.Counted)
	if err != nil {
		return closeReq{}, invalid("Укажите посчитанную сумму")
	}
	var coins cashapi.Money
	if b.Coins != nil {
		coins = *b.Coins
	}
	var counts map[string]int
	if b.Counts != nil {
		counts = *b.Counts
	}
	total, kept, err := countCash(counts, coins)
	if err != nil {
		return closeReq{}, err
	}
	if (len(counts) > 0 || coins.AmountMinor > 0) && total != counted {
		return closeReq{}, invalid("Пересчёт по номиналам не сходится с посчитанной суммой")
	}
	r := closeReq{counted: counted, kept: kept, coins: int64(coins.AmountMinor), zIn: b.Z, toSafe: b.ToSafe != nil && *b.ToSafe}
	if b.Terminal != nil {
		card, err1 := nonNegative(b.Terminal.Card)
		sbp, err2 := nonNegative(b.Terminal.Sbp)
		if err1 != nil || err2 != nil {
			return closeReq{}, invalid("Итоги терминала — суммы не меньше нуля")
		}
		r.term = &termTotals{Card: card, Sbp: sbp}
	}
	return r, nil
}

// CloseShift closes a shift (closeCashShift): the count by denominations, the Z report of the KKT and the totals of the
// terminal are reconciled with the journal. A difference within the tolerance of the drawer closes the shift with an
// automatic correction, a larger one leaves it to review; the attempt is kept either way. Handing the revenue over puts the
// takings above the float into the nearest safe «in transit».
func (s *Service) CloseShift(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b *cashapi.CashShiftClose) (cashapi.CashShift, error) {
	r, err := parseClose(b)
	if err != nil {
		return cashapi.CashShift{}, err
	}
	var out cashapi.CashShift
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		var err error
		if out, err = s.closeTx(ctx, tx, tc, id, ifMatch, r); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

func (s *Service) closeTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, r closeReq) (cashapi.CashShift, error) {
	ev := s.evaluator(tx)
	h, err := loadShift(ctx, tx, id, true)
	if err != nil {
		return cashapi.CashShift{}, err
	}
	a, err := loadAccount(ctx, tx, h.Account)
	if err != nil {
		return cashapi.CashShift{}, err
	}
	if err := s.permit(ctx, ev, tc, a, actionShift); err != nil {
		return cashapi.CashShift{}, err
	}
	if err := checkRevision(ifMatch, h.Revision); err != nil {
		return cashapi.CashShift{}, err
	}
	if h.Status != statusOpen {
		return cashapi.CashShift{}, problem.New(codeInvalidTransition, "Смена уже закрыта")
	}
	m, z, term, err := s.reconcile(ctx, tx, h, &a, r)
	if err != nil {
		return cashapi.CashShift{}, err
	}
	if err := s.storeClose(ctx, tx, tc, h, a, r, m, z, term); err != nil {
		return cashapi.CashShift{}, err
	}
	if r.toSafe {
		if err := s.handOver(ctx, tx, tc, ev, a, h, r.counted); err != nil {
			return cashapi.CashShift{}, err
		}
	}
	return s.finishClose(ctx, tx, tc, ev, id, a, h, m)
}

// reconcile checks the Z report against the KKT of the drawer and reconciles the count with the journal of the shift;
// it locks the drawer (the shift row is locked before it) and returns its balance in a.
func (s *Service) reconcile(ctx context.Context, tx pgx.Tx, h shift, a *account, r closeReq) (closeResult, *zTotals, *termTotals, error) {
	z, err := zOf(r.zIn, a.KktMode == kktManual)
	if err != nil {
		return closeResult{}, nil, nil, err
	}
	if a.KktMode != kktManual {
		z = nil
	}
	if err := tx.QueryRow(ctx, `select balance_minor from cash.accounts where id = $1 for update`, a.ID).Scan(&a.Balance); err != nil {
		return closeResult{}, nil, nil, fmt.Errorf("cash: balance: %w", err)
	}
	termAcc, hasTerm, err := terminalOf(ctx, tx, *a)
	if err != nil {
		return closeResult{}, nil, nil, err
	}
	term, termID := r.term, uuid.Nil
	if hasTerm {
		termID = termAcc.ID
	} else {
		term = nil
	}
	f, err := shiftFactsOf(ctx, tx, h.ID, a.ID, termID, a.Balance)
	if err != nil {
		return closeResult{}, nil, nil, err
	}
	var tol int64
	if a.Tolerance != nil {
		tol = *a.Tolerance
	}
	return closeMath(f, closeInput{Counted: r.counted, Z: z, Term: term, Tolerance: tol}), z, term, nil
}

// shiftFactsOf sums the live receipts and refunds of a shift: cash of the drawer and the card and SBP of its terminal.
func shiftFactsOf(ctx context.Context, tx pgx.Tx, shiftID, drawer, terminal uuid.UUID, balance int64) (shiftFacts, error) {
	f := shiftFacts{Balance: balance}
	err := tx.QueryRow(ctx, `
	select coalesce(sum(case when o.account_id = $2 and o.method = 'cash' then case o.type when 'in' then o.amount_minor else -o.amount_minor end else 0 end), 0),
	       coalesce(sum(case when o.account_id = $3 and o.method in ('card', 'sbp') then case o.type when 'in' then o.amount_minor else -o.amount_minor end else 0 end), 0),
	       coalesce(sum(case when o.account_id = $3 and o.method = 'card' then case o.type when 'in' then o.amount_minor else -o.amount_minor end else 0 end), 0),
	       coalesce(sum(case when o.account_id = $3 and o.method = 'sbp' then case o.type when 'in' then o.amount_minor else -o.amount_minor end else 0 end), 0)
	  from cash.operations o
	 where o.shift_id = $1 and o.type in ('in', 'refund')
	   and not exists (select 1 from cash.operations s where s.reverses_operation_id = o.id)`, shiftID, drawer, terminal).
		Scan(&f.RevCash, &f.RevCard, &f.Card, &f.Sbp)
	if err != nil {
		return shiftFacts{}, fmt.Errorf("cash: shift facts: %w", err)
	}
	return f, nil
}

// storeClose keeps the attempt of closing, closes the shift or leaves it to review and writes the automatic correction.
func (s *Service) storeClose(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, h shift, a account, r closeReq, m closeResult, z *zTotals, term *termTotals) error {
	expected := mustJSON(expectedJSON{Cash: m.Expected.Cash, RevCash: m.Expected.RevCash, RevCard: m.Expected.RevCard, Card: m.Expected.Card, Sbp: m.Expected.Sbp})
	diff := mustJSON(diffJSON{Cash: m.DiffCash, KktCash: m.KktCash, KktCard: m.KktCard, Term: m.Term})
	counts := mustJSON(r.kept)
	var zraw, traw any
	var zn *string
	var zc, zk, tcard, tsbp *int64
	if z != nil {
		zraw, zn, zc, zk = zJSON{Number: z.Number, Cash: z.Cash, Card: z.Card}, &z.Number, &z.Cash, &z.Card
	}
	if term != nil {
		traw, tcard, tsbp = termJSON{Card: term.Card, Sbp: term.Sbp}, &term.Card, &term.Sbp
	}
	var coins *int64
	if r.coins > 0 {
		coins = &r.coins
	}
	at := s.now()
	if _, err := tx.Exec(ctx, `insert into cash.shift_close_attempts (shift_id, closed_at, closed_by, counted_minor, counts, z, terminal, diff)
	 values ($1, $2, $3, $4, $5, $6, $7, $8)`, h.ID, at, tc.PersonID, r.counted, counts, jsonOrNil(zraw), jsonOrNil(traw), diff); err != nil {
		return fmt.Errorf("cash: attempt: %w", err)
	}
	if _, err := tx.Exec(ctx, `update cash.shifts set status = $2, closed_at = $3, closed_by = $4, counted_minor = $5, counts = $6, coins_minor = $7,
	   z_number = $8, z_cash_minor = $9, z_card_minor = $10, term_card_minor = $11, term_sbp_minor = $12, expected = $13, diff = $14,
	   revision = revision + 1 where id = $1`, h.ID, m.Status, at, tc.PersonID, r.counted, counts, coins, zn, zc, zk, tcard, tsbp,
		expected, diff); err != nil {
		return fmt.Errorf("cash: shift: %w", err)
	}
	if m.Status != statusClosed {
		return nil
	}
	return s.autoDecision(ctx, tx, tc, h, a, m, at)
}

// autoDecision records the automatic decision of a shift closed within the tolerance, with the correction of the balance.
func (s *Service) autoDecision(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, h shift, a account, m closeResult, at time.Time) error {
	var opID *uuid.UUID
	if m.Adjust != 0 {
		op, err := s.adjust(ctx, tx, tc, a, m.Adjust, lossWord(m.Adjust)+" при пересчёте · смена "+strconv.FormatInt(h.Number, 10), h.ID)
		if err != nil {
			return err
		}
		opID = &op.Id
	}
	if _, err := tx.Exec(ctx, `update cash.shifts set decision_kind = 'auto', decision_at = $2, decision_reason = $3, decision_operation_id = $4 where id = $1`,
		h.ID, at, m.Reason, opID); err != nil {
		return fmt.Errorf("cash: shift: %w", err)
	}
	return nil
}

// finishClose reads the closed shift back, records the audit row and the event and builds the answer.
func (s *Service) finishClose(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, ev Authorizer, id uuid.UUID, a account, h shift, m closeResult) (cashapi.CashShift, error) {
	h2, err := loadShift(ctx, tx, id, false)
	if err != nil {
		return cashapi.CashShift{}, err
	}
	if err := record(ctx, tx, tc, "cash.shift.close", targetShift, id, a.Unit, "", map[string]any{keyAccount: a.ID, keyStatus: m.Status,
		"countedMinor": h2.Counted, keyDiff: m.DiffCash}); err != nil {
		return cashapi.CashShift{}, err
	}
	if err := publish(ctx, tx, "cash.shift.closed.v1", targetShift, id, map[string]any{keyShift: id, keyAccount: a.ID, keyNumber: h.Number,
		keyStatus: m.Status, keyDiff: m.DiffCash, keyCurrency: a.Currency, keyUnit: a.Unit, "closedByMemberId": tc.PersonID}); err != nil {
		return cashapi.CashShift{}, err
	}
	sums, err := s.sumsVisible(ctx, ev, tc, a)
	if err != nil {
		return cashapi.CashShift{}, err
	}
	return s.shiftDTO(ctx, tx, h2, a.Currency, sums)
}

// handOver sends the takings of a closing shift — what is counted above the float of the next shift — to the nearest safe
// (the safe of the unit, then of its ancestors, then of the tenant) «in transit»; no safe — nothing to hand over.
func (s *Service) handOver(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, ev Authorizer, a account, h shift, counted int64) error {
	if err := s.permit(ctx, ev, tc, a, actionTransfer); err != nil {
		return err
	}
	var float int64
	if a.Float != nil {
		float = *a.Float
	}
	keep, err := keepFloat(nil, float, counted)
	if err != nil {
		return err
	}
	safe, ok, err := nearestSafe(ctx, tx, a)
	if err != nil || !ok {
		return err
	}
	var balance int64
	if err := tx.QueryRow(ctx, `select balance_minor from cash.accounts where id = $1`, a.ID).Scan(&balance); err != nil {
		return fmt.Errorf("cash: balance: %w", err)
	}
	amount := min(counted-keep, balance)
	if amount <= 0 {
		return nil
	}
	t, err := s.newTransfer(ctx, tx, tc, a, safe, amount, "Выручка · смена "+strconv.FormatInt(h.Number, 10), purposeHandover, tc.PersonID, &h.ID)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update cash.shifts set to_safe_transfer_id = $2 where id = $1`, h.ID, t.ID); err != nil {
		return fmt.Errorf("cash: shift: %w", err)
	}
	return nil
}

// nearestSafe finds the safe of the unit of a drawer, else of the nearest ancestor, else of the tenant.
func nearestSafe(ctx context.Context, tx pgx.Tx, a account) (account, bool, error) {
	var id uuid.UUID
	err := tx.QueryRow(ctx, `select s.id from cash.accounts s
	  left join org.unit_closure c on c.ancestor_id = s.org_unit_id and c.descendant_id = $1
	 where s.kind = 'safe' and (s.org_unit_id is null or c.ancestor_id is not null)
	 order by (s.org_unit_id is null), c.depth nulls last, s.created_at limit 1`, a.Unit).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return account{}, false, nil
	}
	if err != nil {
		return account{}, false, fmt.Errorf("cash: safe: %w", err)
	}
	safe, err := loadAccount(ctx, tx, id)
	return safe, err == nil, err
}

// ReviewShift decides on a shift that waits for it (reviewCashShift): cash.reconcile and cash.balance.read over the
// drawer, not the one who closed it. «Принять» writes the correction and closes the shift; «Вернуть на пересчёт» opens
// it again and keeps the attempt of closing with the reason (Q-W4.00-cash-4).
func (s *Service) ReviewShift(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b *cashapi.CashShiftReview) (cashapi.CashShift, error) {
	if b == nil {
		return cashapi.CashShift{}, problem.New(problem.CodeMalformedRequest, "")
	}
	if b.Decision != cashapi.CashShiftReviewDecisionAccept && b.Decision != cashapi.CashShiftReviewDecisionRecount {
		return cashapi.CashShift{}, invalid("Решение — принять расхождение или вернуть на пересчёт")
	}
	reason, err := reasonOf(&b.Reason, "Укажите причину решения")
	if err != nil {
		return cashapi.CashShift{}, err
	}
	var out cashapi.CashShift
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		var err error
		if out, err = s.reviewTx(ctx, tx, tc, id, ifMatch, b.Decision, reason); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

func (s *Service) reviewTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, d cashapi.CashShiftReviewDecision, reason string) (cashapi.CashShift, error) {
	h, a, err := s.reviewable(ctx, tx, tc, id, ifMatch)
	if err != nil {
		return cashapi.CashShift{}, err
	}
	var attempt uuid.UUID
	if err := tx.QueryRow(ctx, `select a.id from cash.shift_close_attempts a where a.shift_id = $1
	 and not exists (select 1 from cash.shift_reviews r where r.attempt_id = a.id) order by a.closed_at desc, a.id desc limit 1`, id).Scan(&attempt); err != nil {
		return cashapi.CashShift{}, fmt.Errorf("cash: attempt: %w", err)
	}
	if _, err := tx.Exec(ctx, `insert into cash.shift_reviews (shift_id, attempt_id, decision, reason, decided_by, decided_at) values ($1, $2, $3, $4, $5, $6)`,
		id, attempt, string(d), reason, tc.PersonID, s.now()); err != nil {
		return cashapi.CashShift{}, fmt.Errorf("cash: review: %w", err)
	}
	if d == cashapi.CashShiftReviewDecisionRecount {
		err = recountShift(ctx, tx, h, a)
	} else {
		err = s.acceptShift(ctx, tx, tc, h, a, reason)
	}
	if err != nil {
		return cashapi.CashShift{}, err
	}
	h2, err := loadShift(ctx, tx, id, false)
	if err != nil {
		return cashapi.CashShift{}, err
	}
	if err := record(ctx, tx, tc, "cash.shift.review", targetShift, id, a.Unit, reason, map[string]any{"decision": string(d)}); err != nil {
		return cashapi.CashShift{}, err
	}
	return s.shiftDTO(ctx, tx, h2, a.Currency, true)
}

// reviewable loads the shift and its drawer and checks the actor may decide on it now.
func (s *Service) reviewable(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string) (shift, account, error) {
	ev := s.evaluator(tx)
	h, err := loadShift(ctx, tx, id, true)
	if err != nil {
		return shift{}, account{}, err
	}
	a, err := loadAccount(ctx, tx, h.Account)
	if err != nil {
		return shift{}, account{}, err
	}
	if err := s.permit(ctx, ev, tc, a, actionReconcile); err != nil {
		return shift{}, account{}, err
	}
	if sums, err := s.sumsVisible(ctx, ev, tc, a); err != nil {
		return shift{}, account{}, err
	} else if !sums {
		return shift{}, account{}, problem.New(problem.CodeForbiddenAction, "Нужно право видеть остаток и ожидаемую сумму")
	}
	if err := checkRevision(ifMatch, h.Revision); err != nil {
		return shift{}, account{}, err
	}
	switch {
	case h.Status != statusReview:
		return shift{}, account{}, problem.New(codeInvalidTransition, "Смена уже решена")
	case h.ClosedBy != nil && *h.ClosedBy == tc.PersonID:
		return shift{}, account{}, problem.New(codeSelfApproval, "Кто закрывал смену, тот не принимает её расхождение")
	}
	return h, a, nil
}

// recountShift opens the shift again; the attempt of closing stays in its table (PD-60).
func recountShift(ctx context.Context, tx pgx.Tx, h shift, a account) error {
	if _, err := tx.Exec(ctx, `update cash.shifts set status = 'open', closed_at = null, closed_by = null, counted_minor = null,
	   counts = '{}', coins_minor = null, z_number = null, z_cash_minor = null, z_card_minor = null, term_card_minor = null,
	   term_sbp_minor = null, expected = null, diff = null, revision = revision + 1 where id = $1`, h.ID); err != nil {
		return fmt.Errorf("cash: shift: %w", err)
	}
	return publish(ctx, tx, "cash.shift.recount_requested.v1", targetShift, h.ID, map[string]any{keyShift: h.ID, keyAccount: a.ID,
		keyNumber: h.Number, "closedByMemberId": h.ClosedBy, keyUnit: a.Unit})
}

// acceptShift accepts the difference: the correction of the balance, the decision and the close.
func (s *Service) acceptShift(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, h shift, a account, reason string) error {
	var d diffJSON
	if len(h.Diff) > 0 {
		if err := json.Unmarshal(h.Diff, &d); err != nil {
			return fmt.Errorf("cash: shift diff: %w", err)
		}
	}
	if err := tx.QueryRow(ctx, `select balance_minor from cash.accounts where id = $1 for update`, a.ID).Scan(&a.Balance); err != nil {
		return fmt.Errorf("cash: balance: %w", err)
	}
	var opID *uuid.UUID
	if d.Cash != 0 {
		op, err := s.adjust(ctx, tx, tc, a, d.Cash, lossWord(d.Cash)+" · смена "+strconv.FormatInt(h.Number, 10)+": "+reason, h.ID)
		if err != nil {
			return err
		}
		opID = &op.Id
	}
	if _, err := tx.Exec(ctx, `update cash.shifts set status = 'closed', decision_kind = 'accepted', decision_by = $2, decision_at = $3,
	   decision_reason = $4, decision_operation_id = $5, revision = revision + 1 where id = $1`, h.ID, tc.PersonID, s.now(), reason, opID); err != nil {
		return fmt.Errorf("cash: shift: %w", err)
	}
	return publish(ctx, tx, "cash.shift.diff_accepted.v1", targetShift, h.ID, map[string]any{keyShift: h.ID, keyAccount: a.ID,
		keyNumber: h.Number, keyDiff: d.Cash, keyCurrency: a.Currency, "closedByMemberId": h.ClosedBy, keyUnit: a.Unit})
}
