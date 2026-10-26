package cash

import (
	"context"
	"encoding/json"
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

// shift is a row of cash.shifts.
type shift struct {
	ID, Account    uuid.UUID
	Number         int64
	Status         string
	OpenedAt       time.Time
	OpenedBy       uuid.UUID
	OpeningFloat   int64
	OpeningDiff    *int64
	ClosedAt       *time.Time
	ClosedBy       *uuid.UUID
	Counted        *int64
	Counts         []byte
	Coins          *int64
	ZNumber        *string
	ZCash, ZCard   *int64
	TermCard       *int64
	TermSbp        *int64
	Expected, Diff []byte
	DecisionKind   *string
	DecisionBy     *uuid.UUID
	DecisionAt     *time.Time
	DecisionReason *string
	DecisionOp     *uuid.UUID
	ToSafe         *uuid.UUID
	Revision       int64
}

const shiftCols = `h.id, h.account_id, h.number, h.status, h.opened_at, h.opened_by, h.opening_float_minor, h.opening_diff_minor, h.closed_at,
       h.closed_by, h.counted_minor, h.counts, h.coins_minor, h.z_number, h.z_cash_minor, h.z_card_minor, h.term_card_minor,
       h.term_sbp_minor, h.expected, h.diff, h.decision_kind, h.decision_by, h.decision_at, h.decision_reason, h.decision_operation_id,
       h.to_safe_transfer_id, h.revision`

func scanShift(row pgx.Row) (shift, error) {
	var h shift
	err := row.Scan(&h.ID, &h.Account, &h.Number, &h.Status, &h.OpenedAt, &h.OpenedBy, &h.OpeningFloat, &h.OpeningDiff, &h.ClosedAt,
		&h.ClosedBy, &h.Counted, &h.Counts, &h.Coins, &h.ZNumber, &h.ZCash, &h.ZCard, &h.TermCard, &h.TermSbp, &h.Expected, &h.Diff,
		&h.DecisionKind, &h.DecisionBy, &h.DecisionAt, &h.DecisionReason, &h.DecisionOp, &h.ToSafe, &h.Revision)
	return h, err
}

func loadShift(ctx context.Context, q Querier, id uuid.UUID, lock bool) (shift, error) {
	sql := `select ` + shiftCols + ` from cash.shifts h where h.id = $1`
	if lock {
		sql += lockUpdate
	}
	h, err := scanShift(q.QueryRow(ctx, sql, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return shift{}, problem.New(problem.CodeNotFound, "Смена не найдена")
	}
	if err != nil {
		return shift{}, fmt.Errorf("cash: shift: %w", err)
	}
	return h, nil
}

// expectedJSON and diffJSON are the sums of a closed shift as they are stored (kopecks).
type expectedJSON struct {
	Cash    int64 `json:"cash"`
	RevCash int64 `json:"revCash"`
	RevCard int64 `json:"revCard"`
	Card    int64 `json:"card"`
	Sbp     int64 `json:"sbp"`
}

type diffJSON struct {
	Cash    int64 `json:"cash"`
	KktCash int64 `json:"kktCash"`
	KktCard int64 `json:"kktCard"`
	Term    int64 `json:"term"`
}

type zJSON struct {
	Number string `json:"number"`
	Cash   int64  `json:"cash"`
	Card   int64  `json:"card"`
}

type termJSON struct {
	Card int64 `json:"card"`
	Sbp  int64 `json:"sbp"`
}

func diffDTO(raw []byte, cur string) *cashapi.CashShiftDiff {
	var d diffJSON
	if len(raw) == 0 || json.Unmarshal(raw, &d) != nil {
		return nil
	}
	return &cashapi.CashShiftDiff{Cash: signedOf(d.Cash, cur), KktCash: signedOf(d.KktCash, cur), KktCard: signedOf(d.KktCard, cur), Term: signedOf(d.Term, cur)}
}

func zDTO(raw []byte, cur string) *cashapi.CashShiftZ {
	var z zJSON
	if len(raw) == 0 || json.Unmarshal(raw, &z) != nil {
		return nil
	}
	return &cashapi.CashShiftZ{Number: z.Number, Cash: moneyOf(z.Cash, cur), Card: moneyOf(z.Card, cur)}
}

func termDTO(raw []byte, cur string) *cashapi.CashShiftTerminal {
	var t termJSON
	if len(raw) == 0 || json.Unmarshal(raw, &t) != nil {
		return nil
	}
	return &cashapi.CashShiftTerminal{Card: moneyOf(t.Card, cur), Sbp: moneyOf(t.Sbp, cur)}
}

func countsDTO(raw []byte) *map[string]int {
	var c map[string]int
	if len(raw) == 0 || json.Unmarshal(raw, &c) != nil || len(c) == 0 {
		return nil
	}
	return &c
}

// shiftDTO is CashShift for the actor: the sums to be expected and the differences only with cash.balance.read (a shift
// is closed blind); attempts of closing stay with the recount reason of their decision.
func (s *Service) shiftDTO(ctx context.Context, q Querier, h shift, cur string, sums bool) (cashapi.CashShift, error) {
	out := cashapi.CashShift{Id: h.ID, AccountId: h.Account, Number: h.Number, Status: cashapi.CashShiftStatus(h.Status),
		OpenedAt: h.OpenedAt.UTC(), OpenedByMemberId: h.OpenedBy, OpeningFloat: moneyOf(h.OpeningFloat, cur), ClosedByMemberId: h.ClosedBy,
		Coins: moneyPtr(h.Coins, cur), Counted: moneyPtr(h.Counted, cur), ToSafeTransferId: h.ToSafe, Revision: h.Revision,
		Attempts: []cashapi.CashShiftCloseAttempt{}, Counts: countsDTO(h.Counts), Z: zDTO(h.zRaw(), cur), Terminal: termDTO(h.termRaw(), cur),
		Decision: h.decision()}
	if h.ClosedAt != nil {
		t := h.ClosedAt.UTC()
		out.ClosedAt = &t
	}
	if sums {
		out.OpeningDiff = signedPtr(h.OpeningDiff, cur)
		out.Diff = diffDTO(h.Diff, cur)
		out.Expected = expectedDTO(h.Expected, cur)
	}
	var err error
	out.Attempts, err = shiftAttempts(ctx, q, h.ID, cur, sums)
	return out, err
}

// zRaw and termRaw are the Z report and the terminal totals of the shift as stored JSON (nil — not entered).
func (h shift) zRaw() []byte {
	if h.ZNumber == nil || h.ZCash == nil || h.ZCard == nil {
		return nil
	}
	return mustJSON(zJSON{Number: *h.ZNumber, Cash: *h.ZCash, Card: *h.ZCard})
}

func (h shift) termRaw() []byte {
	if h.TermCard == nil || h.TermSbp == nil {
		return nil
	}
	return mustJSON(termJSON{Card: *h.TermCard, Sbp: *h.TermSbp})
}

// decision is the decision on the difference of a closed shift, nil while there is none.
func (h shift) decision() *cashapi.CashShiftDecision {
	if h.DecisionKind == nil || h.DecisionAt == nil {
		return nil
	}
	d := cashapi.CashShiftDecision{At: h.DecisionAt.UTC(), ByMemberId: h.DecisionBy, Kind: cashapi.CashShiftDecisionKind(*h.DecisionKind),
		OperationId: h.DecisionOp}
	if h.DecisionReason != nil {
		d.Reason = *h.DecisionReason
	}
	return &d
}

func expectedDTO(raw []byte, cur string) *cashapi.CashShiftExpected {
	var e expectedJSON
	if len(raw) == 0 || json.Unmarshal(raw, &e) != nil {
		return nil
	}
	return &cashapi.CashShiftExpected{Cash: signedOf(e.Cash, cur), RevCash: signedOf(e.RevCash, cur), RevCard: signedOf(e.RevCard, cur),
		Card: signedOf(e.Card, cur), Sbp: signedOf(e.Sbp, cur)}
}

// shiftAttempts reads the attempts of closing of a shift with the recount reason of their decision.
func shiftAttempts(ctx context.Context, q Querier, id uuid.UUID, cur string, sums bool) ([]cashapi.CashShiftCloseAttempt, error) {
	rows, err := q.Query(ctx, `select a.closed_at, a.closed_by, a.counted_minor, a.counts, a.z, a.terminal, a.diff, r.reason
	  from cash.shift_close_attempts a left join cash.shift_reviews r on r.attempt_id = a.id and r.decision = 'recount'
	 where a.shift_id = $1 order by a.closed_at, a.id`, id)
	if err != nil {
		return nil, fmt.Errorf("cash: attempts: %w", err)
	}
	defer rows.Close()
	out := []cashapi.CashShiftCloseAttempt{}
	for rows.Next() {
		var (
			at                  time.Time
			by                  uuid.UUID
			counted             int64
			counts, z, tm, diff []byte
			reason              *string
		)
		if err := rows.Scan(&at, &by, &counted, &counts, &z, &tm, &diff, &reason); err != nil {
			return nil, fmt.Errorf("cash: attempts: %w", err)
		}
		a := cashapi.CashShiftCloseAttempt{ClosedAt: at.UTC(), ClosedByMemberId: by, Counted: moneyOf(counted, cur), RecountReason: reason,
			Z: zDTO(z, cur), Terminal: termDTO(tm, cur), Counts: countsDTO(counts)}
		if sums {
			a.Diff = diffDTO(diff, cur)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// sumsVisible reports whether the actor sees the sums to be expected of the shifts of a: cash.balance.read over it.
func (s *Service) sumsVisible(ctx context.Context, ev Authorizer, tc tenantctx.TenantContext, a account) (bool, error) {
	if tc.Owner {
		return true, nil
	}
	return allowed(ctx, ev, tc, a, actionBalance)
}

func nonNegative(m cashapi.Money) (int64, error) {
	if m.AmountMinor < 0 || m.AmountMinor > maxMinor {
		return 0, problem.New(codeAmount, textAmount)
	}
	if m.AmountMinor > 0 && m.Currency != currencyRUB {
		return 0, invalid(textCurrency)
	}
	return int64(m.AmountMinor), nil
}

// OpenShift opens a shift with the count of the float (openCashShift): a drawer with shifts, one open shift at a time;
// a float that does not match the balance is adjusted by a row of the journal and reported (the event
// `cash.shift.opened_with_diff.v1`).
func (s *Service) OpenShift(ctx context.Context, tc tenantctx.TenantContext, accountID uuid.UUID, b *cashapi.CashShiftOpen) (cashapi.CashShift, error) {
	if b == nil {
		return cashapi.CashShift{}, problem.New(problem.CodeMalformedRequest, "")
	}
	counted, err := nonNegative(b.CountedFloat)
	if err != nil {
		return cashapi.CashShift{}, invalid("Укажите размен: сколько наличных в ящике")
	}
	var out cashapi.CashShift
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		var err error
		if out, err = s.openShiftTx(ctx, tx, tc, accountID, counted); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusCreated, etag(out.Revision), out)
	})
	return out, err
}

func (s *Service) openShiftTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, accountID uuid.UUID, counted int64) (cashapi.CashShift, error) {
	ev := s.evaluator(tx)
	a, err := loadAccount(ctx, tx, accountID)
	if err != nil {
		return cashapi.CashShift{}, err
	}
	if err := s.permit(ctx, ev, tc, a, actionShift); err != nil {
		return cashapi.CashShift{}, err
	}
	if a.Kind != kindDrawer || a.ShiftMode == modeNone {
		return cashapi.CashShift{}, invalid("Касса работает без смен")
	}
	id, number, err := startShift(ctx, tx, tc, a, s.now(), counted)
	if err != nil {
		return cashapi.CashShift{}, err
	}
	if err := s.reconcileFloat(ctx, tx, tc, a, id, number, counted); err != nil {
		return cashapi.CashShift{}, err
	}
	h, err := loadShift(ctx, tx, id, false)
	if err != nil {
		return cashapi.CashShift{}, err
	}
	if err := record(ctx, tx, tc, "cash.shift.open", targetShift, id, a.Unit, "", map[string]any{keyAccount: a.ID, keyNumber: number,
		"floatMinor": counted}); err != nil {
		return cashapi.CashShift{}, err
	}
	sums, err := s.sumsVisible(ctx, ev, tc, a)
	if err != nil {
		return cashapi.CashShift{}, err
	}
	return s.shiftDTO(ctx, tx, h, a.Currency, sums)
}

// startShift inserts the next shift of a drawer; the openings of one drawer go one by one, a second open shift is refused.
func startShift(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, a account, now time.Time, counted int64) (id uuid.UUID, number int64, err error) {
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('cash.shift:' || $1::text, 0))`, a.ID); err != nil {
		return uuid.Nil, 0, fmt.Errorf("cash: lock: %w", err)
	}
	open, err := openShiftID(ctx, tx, a.ID, false)
	if err != nil {
		return uuid.Nil, 0, err
	}
	if open != nil {
		return uuid.Nil, 0, problem.New(codeInvalidTransition, "Смена уже открыта")
	}
	err = tx.QueryRow(ctx, `insert into cash.shifts (account_id, number, status, opened_at, opened_by, opening_float_minor)
	 values ($1, (select coalesce(max(number), 0) + 1 from cash.shifts where account_id = $1), 'open', $2, $3, $4) returning id, number`,
		a.ID, now, tc.PersonID, counted).Scan(&id, &number)
	if err != nil {
		return uuid.Nil, 0, fmt.Errorf("cash: insert shift: %w", err)
	}
	return id, number, nil
}

// reconcileFloat corrects the balance of the drawer when the float counted at the opening does not match it, and reports it.
func (s *Service) reconcileFloat(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, a account, id uuid.UUID, number, counted int64) error {
	var balance int64
	if err := tx.QueryRow(ctx, `select balance_minor from cash.accounts where id = $1 for update`, a.ID).Scan(&balance); err != nil {
		return fmt.Errorf("cash: balance: %w", err)
	}
	diff := openingDiff(counted, balance)
	if diff == 0 {
		return nil
	}
	a.Balance = balance
	op, err := s.adjust(ctx, tx, tc, a, diff, "Расхождение при открытии смены "+strconv.FormatInt(number, 10), id)
	if err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `update cash.shifts set opening_diff_minor = $2 where id = $1`, id, diff); err != nil {
		return fmt.Errorf("cash: shift: %w", err)
	}
	return publish(ctx, tx, "cash.shift.opened_with_diff.v1", targetShift, id, map[string]any{keyShift: id, keyAccount: a.ID,
		keyNumber: number, keyDiff: diff, keyCurrency: a.Currency, "operationId": op.Id, keyUnit: a.Unit})
}

// adjust writes the correction of the balance of a drawer by diff (positive — a surplus) into its journal.
func (s *Service) adjust(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, a account, diff int64, basis string, shiftID uuid.UUID) (opRow, error) {
	dir, amount := dirIn, diff
	if diff < 0 {
		dir, amount = dirOut, -diff
	}
	cat := catAdjustment
	return s.write(ctx, tx, tc, opSpec{Target: a, Point: a, Type: typeAdjust, Direction: dir, Category: catAdjustment, CategoryID: &cat,
		Amount: amount, Method: methodCash, Basis: basis, OccurredAt: s.now(), CreatedBy: tc.PersonID, Origin: originManual, ShiftID: &shiftID})
}

func lossWord(diff int64) string {
	if diff < 0 {
		return "Недостача"
	}
	return "Излишек"
}

func mustJSON(v any) []byte {
	b, err := json.Marshal(v)
	if err != nil { // plain structs and maps always marshal
		panic(err)
	}
	return b
}

func jsonOrNil(v any) any {
	if v == nil {
		return nil
	}
	return mustJSON(v)
}

// ShiftsQuery filters the list of shifts.
type ShiftsQuery struct {
	PageQuery
	AccountID uuid.UUID
	Status    string
}

// ListShifts returns the shifts of the accounts the actor sees, newest first (listCashShifts); the sums to be expected
// only with cash.balance.read.
func (s *Service) ListShifts(ctx context.Context, tc tenantctx.TenantContext, q ShiftsQuery) (cashapi.CashShiftPage, error) {
	limit, at, after, err := q.page()
	if err != nil {
		return cashapi.CashShiftPage{}, err
	}
	var out cashapi.CashShiftPage
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		ev := s.evaluator(tx)
		pred, err := s.visibleSQL(ctx, ev, tc, "a", 5, false)
		if err != nil {
			return err
		}
		args := append([]any{nilID(q.AccountID), nilStr(q.Status), at, after, limit + 1}, pred.Args...)
		rows, err := tx.Query(ctx, `select `+shiftCols+` from cash.shifts h join cash.accounts a on a.id = h.account_id
		 where ($1::uuid is null or h.account_id = $1) and ($2::text is null or h.status = $2)
		   and ($3::timestamptz is null or (h.opened_at, h.id) < ($3::timestamptz, $4::uuid))
		   and `+pred.SQL+` order by h.opened_at desc, h.id desc limit $5`, args...)
		if err != nil {
			return fmt.Errorf("cash: shifts: %w", err)
		}
		list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (shift, error) { return scanShift(r) })
		if err != nil {
			return fmt.Errorf("cash: shifts: %w", err)
		}
		out, err = s.shiftPage(ctx, tx, ev, tc, list, limit)
		return err
	})
	return out, err
}

// shiftPage turns the rows of a list into a page: the sums are shown by the right over the account of each shift.
func (s *Service) shiftPage(ctx context.Context, tx pgx.Tx, ev Authorizer, tc tenantctx.TenantContext, list []shift, limit int) (cashapi.CashShiftPage, error) {
	out := cashapi.CashShiftPage{Items: []cashapi.CashShift{}}
	cache := map[uuid.UUID]account{}
	visible := map[uuid.UUID]bool{}
	for i, h := range list {
		if i == limit {
			next := encodeCursor(list[limit-1].OpenedAt, list[limit-1].ID)
			out.NextCursor = &next
			break
		}
		a, ok := cache[h.Account]
		if !ok {
			var err error
			if a, err = loadAccount(ctx, tx, h.Account); err != nil {
				return out, err
			}
			cache[h.Account] = a
			if visible[h.Account], err = s.sumsVisible(ctx, ev, tc, a); err != nil {
				return out, err
			}
		}
		dto, err := s.shiftDTO(ctx, tx, h, a.Currency, visible[h.Account])
		if err != nil {
			return out, err
		}
		out.Items = append(out.Items, dto)
	}
	return out, nil
}
