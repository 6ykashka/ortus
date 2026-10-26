package cash

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// transfer is a row of cash.transfers.
type transfer struct {
	ID, From, To    uuid.UUID
	Amount          int64
	Currency        string
	Note            *string
	Purpose, Status string
	SentBy          uuid.UUID
	SentAt          time.Time
	DecidedBy       *uuid.UUID
	DecidedAt       *time.Time
	Reason          *string
	Out, In, Back   *uuid.UUID
	Revision        int64
}

const transferCols = `t.id, t.from_account_id, t.to_account_id, t.amount_minor, t.currency, t.note, t.purpose, t.status, t.sent_by,
       t.sent_at, t.decided_by, t.decided_at, t.reason, t.out_operation_id, t.in_operation_id, t.back_operation_id, t.revision`

func scanTransfer(row pgx.Row) (transfer, error) {
	var t transfer
	err := row.Scan(&t.ID, &t.From, &t.To, &t.Amount, &t.Currency, &t.Note, &t.Purpose, &t.Status, &t.SentBy, &t.SentAt,
		&t.DecidedBy, &t.DecidedAt, &t.Reason, &t.Out, &t.In, &t.Back, &t.Revision)
	t.Currency = trimCurrency(t.Currency)
	return t, err
}

func (t transfer) dto() cashapi.CashTransfer {
	out := cashapi.CashTransfer{Id: t.ID, FromAccountId: t.From, ToAccountId: t.To, Amount: moneyOf(t.Amount, t.Currency), Note: t.Note,
		Purpose: cashapi.CashTransferPurpose(t.Purpose), Status: cashapi.CashTransferStatus(t.Status), SentByMemberId: t.SentBy,
		SentAt: t.SentAt.UTC(), DecidedByMemberId: t.DecidedBy, Reason: t.Reason, OutOperationId: t.Out, InOperationId: t.In,
		BackOperationId: t.Back, Revision: t.Revision}
	if t.DecidedAt != nil {
		d := t.DecidedAt.UTC()
		out.DecidedAt = &d
	}
	return out
}

func loadTransfer(ctx context.Context, q Querier, id uuid.UUID, lock bool) (transfer, error) {
	sql := `select ` + transferCols + ` from cash.transfers t where t.id = $1`
	if lock {
		sql += lockUpdate
	}
	t, err := scanTransfer(q.QueryRow(ctx, sql, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return transfer{}, problem.New(problem.CodeNotFound, "Перемещение не найдено")
	}
	if err != nil {
		return transfer{}, fmt.Errorf("cash: transfer: %w", err)
	}
	return t, nil
}

const (
	catTransfer     = "transfer"
	purposeTransfer = "transfer"
	purposeHandover = "shift_handover"
	purposeIssue    = "advance_issue"
	purposeReturn   = "advance_return"
)

// newTransfer sends money from one account to another «in transit»: the row of the transfer and the operation
// «move_out» that takes the money out of the sender at once; the receiver is credited when it accepts. The account of
// the sender never goes below zero (insufficient_funds).
func (s *Service) newTransfer(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, from, to account, amount int64, note, purpose string, sentBy uuid.UUID, shift *uuid.UUID) (transfer, error) {
	var id uuid.UUID
	var n *string
	if note != "" {
		n = &note
	}
	if err := tx.QueryRow(ctx, `insert into cash.transfers (from_account_id, to_account_id, amount_minor, currency, note, purpose, sent_by, sent_at)
	 values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`, from.ID, to.ID, amount, from.Currency, n, purpose, sentBy, s.now()).Scan(&id); err != nil {
		return transfer{}, fmt.Errorf("cash: insert transfer: %w", err)
	}
	cat := catTransfer
	out, err := s.write(ctx, tx, tc, opSpec{Target: from, Point: from, Type: typeMoveOut, Direction: dirOut, Category: catAdjustment, CategoryID: &cat,
		Amount: amount, Method: "cash", Basis: join("", &note) + " → «" + to.Name + "»", OccurredAt: s.now(), CreatedBy: sentBy, Origin: "manual",
		TransferID: &id, ShiftID: shift})
	if err != nil {
		return transfer{}, err
	}
	if _, err := tx.Exec(ctx, `update cash.transfers set out_operation_id = $2 where id = $1`, id, out.Id); err != nil {
		return transfer{}, fmt.Errorf("cash: transfer: %w", err)
	}
	t, err := loadTransfer(ctx, tx, id, false)
	if err != nil {
		return transfer{}, err
	}
	if err := record(ctx, tx, tc, "cash.transfer.send", targetTransfer, id, from.Unit, "", map[string]any{
		"fromAccountId": from.ID, "toAccountId": to.ID, "amountMinor": amount, "currency": from.Currency, "purpose": purpose}); err != nil {
		return transfer{}, err
	}
	err = publish(ctx, tx, "cash.transfer.sent.v1", targetTransfer, id, map[string]any{"transferId": id, "fromAccountId": from.ID,
		"toAccountId": to.ID, "amountMinor": amount, "currency": from.Currency, "purpose": purpose, "unitId": to.Unit,
		"holderMemberId": to.Holder})
	return t, err
}

// CreateTransfer sends money to another account «in transit» (createCashTransfer): cash.transfer over the sender; the
// sender is a drawer or a safe, the receiver a drawer, a safe or a bank account (an advance is topped up by an issue).
func (s *Service) CreateTransfer(ctx context.Context, tc tenantctx.TenantContext, b *cashapi.CashTransferCreate) (cashapi.CashTransfer, error) {
	if b == nil {
		return cashapi.CashTransfer{}, problem.New(problem.CodeMalformedRequest, "")
	}
	amount, err := checkAmount(b.Amount)
	if err != nil {
		return cashapi.CashTransfer{}, err
	}
	var out cashapi.CashTransfer
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		var err error
		if out, err = s.createTransferTx(ctx, tx, tc, b, amount); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusCreated, etag(out.Revision), out)
	})
	return out, err
}

func (s *Service) createTransferTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, b *cashapi.CashTransferCreate, amount int64) (cashapi.CashTransfer, error) {
	ev := s.evaluator(tx)
	from, err := loadAccount(ctx, tx, b.FromAccountId)
	if err != nil {
		return cashapi.CashTransfer{}, err
	}
	if err := s.permit(ctx, ev, tc, from, actionTransfer); err != nil {
		return cashapi.CashTransfer{}, err
	}
	to, err := loadAccount(ctx, tx, b.ToAccountId)
	if err != nil {
		return cashapi.CashTransfer{}, err
	}
	if ok, err := s.visible(ctx, ev, tc, to); err != nil {
		return cashapi.CashTransfer{}, err
	} else if !ok {
		return cashapi.CashTransfer{}, problem.New(problem.CodeNotFound, textAccountNotFound)
	}
	if err := checkTransferKinds(from, to); err != nil {
		return cashapi.CashTransfer{}, err
	}
	t, err := s.newTransfer(ctx, tx, tc, from, to, amount, transferNote(b.Note, to), purposeTransfer, tc.PersonID, nil)
	return t.dto(), err
}

// checkTransferKinds: cash moves between a drawer, a safe and a bank account; an advance is topped up by an issue.
func checkTransferKinds(from, to account) error {
	switch {
	case from.ID == to.ID:
		return invalid("Выберите другую кассу")
	case (from.Kind != kindDrawer && from.Kind != kindSafe) || (to.Kind != kindDrawer && to.Kind != kindSafe && to.Kind != kindBank):
		return invalid("Перемещают наличные между кассой, сейфом и счётом. Подотчёт — через «Выдать под отчёт»")
	}
	return nil
}

// transferNote is the note of a transfer: the given one, else by the kind of the receiver.
func transferNote(given *string, to account) string {
	if given != nil {
		if n := strings.TrimSpace(*given); n != "" {
			return n
		}
	}
	switch to.Kind {
	case kindSafe:
		return "Сдача выручки"
	case kindBank:
		return "Инкассация"
	}
	return "Перемещение"
}

// Decision is a decision on a transfer, a receipt or a request.
type Decision struct {
	Accept bool
	Reason *string
}

// DecideTransfer accepts or rejects a transfer in transit (decideCashTransfer): the receiver decides — the holder of an
// advance or a role with cash.transfer over the receiving account. Acceptance credits the receiver, rejection returns
// the money to the sender with a reason (a reverse «move_in»).
func (s *Service) DecideTransfer(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, d Decision) (cashapi.CashTransfer, error) { //nolint:dupl // the decision protocol of a receipt, a request and a transfer has one shape: revision, state, not the author
	var reason string
	if !d.Accept {
		r, err := reasonOf(d.Reason, "Укажите причину, почему не принимаете")
		if err != nil {
			return cashapi.CashTransfer{}, err
		}
		reason = r
	}
	var out cashapi.CashTransfer
	err := s.inTx(ctx, tc, func(tx pgx.Tx) error {
		var err error
		if out, err = s.decideTransferTx(ctx, tx, tc, id, ifMatch, d.Accept, reason); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

func (s *Service) decideTransferTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, accept bool, reason string) (cashapi.CashTransfer, error) {
	t, err := loadTransfer(ctx, tx, id, true)
	if err != nil {
		return cashapi.CashTransfer{}, err
	}
	from, err := loadAccount(ctx, tx, t.From)
	if err != nil {
		return cashapi.CashTransfer{}, err
	}
	to, err := loadAccount(ctx, tx, t.To)
	if err != nil {
		return cashapi.CashTransfer{}, err
	}
	if err := s.permitReceiver(ctx, tx, tc, to); err != nil {
		return cashapi.CashTransfer{}, err
	}
	if err := checkRevision(ifMatch, t.Revision); err != nil {
		return cashapi.CashTransfer{}, err
	}
	if t.Status != statusTransit {
		return cashapi.CashTransfer{}, problem.New(codeInvalidTransition, "Перемещение уже принято или отклонено")
	}
	status, column, spec := s.settlement(t, from, to, tc, accept, reason)
	x, err := s.write(ctx, tx, tc, spec)
	if err != nil {
		return cashapi.CashTransfer{}, err
	}
	var rsn *string
	if reason != "" {
		rsn = &reason
	}
	if _, err := tx.Exec(ctx, `update cash.transfers set status = $2, decided_by = $3, decided_at = $4, reason = $5, `+column+` = $6,
	   revision = revision + 1 where id = $1`, id, status, tc.PersonID, spec.OccurredAt, rsn, x.Id); err != nil {
		return cashapi.CashTransfer{}, fmt.Errorf("cash: transfer: %w", err)
	}
	nt, err := loadTransfer(ctx, tx, id, false)
	if err != nil {
		return cashapi.CashTransfer{}, err
	}
	if err := record(ctx, tx, tc, "cash.transfer.decide", targetTransfer, id, to.Unit, reason, map[string]any{keyStatus: status}); err != nil {
		return cashapi.CashTransfer{}, err
	}
	err = publish(ctx, tx, "cash.transfer.decided.v1", targetTransfer, id, map[string]any{"transferId": id, keyStatus: status,
		"sentByMemberId": t.SentBy, keyAmount: t.Amount, keyCurrency: t.Currency})
	return nt.dto(), err
}

// permitReceiver checks the actor may decide on a transfer to the account: the holder takes his advance without a role,
// others need cash.transfer over it.
func (s *Service) permitReceiver(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, to account) error {
	if to.Kind == kindAdvance && to.isHolder(tc) {
		return nil
	}
	return s.permit(ctx, s.evaluator(tx), tc, to, actionTransfer)
}

// settlement is the journal row of a decision: acceptance credits the receiver (the money by cash, to a bank account by a
// transfer), rejection returns the money to the sender with the reason; it returns the new status and the column of the
// transfer that keeps the row.
func (s *Service) settlement(t transfer, from, to account, tc tenantctx.TenantContext, accept bool, reason string) (status, column string, spec opSpec) {
	cat := catTransfer
	spec = opSpec{Type: typeMoveIn, Direction: dirIn, Category: catAdjustment, CategoryID: &cat, Amount: t.Amount, OccurredAt: s.now(),
		CreatedBy: tc.PersonID, Origin: originManual, TransferID: &t.ID}
	if accept {
		spec.Target, spec.Point, spec.Method = to, to, methodCash
		if to.Kind == kindBank {
			spec.Method = methodTransfer
		}
		spec.Basis = join("", t.Note) + " ← «" + from.Name + "»"
		return statusDone, "in_operation_id", spec
	}
	spec.Target, spec.Point, spec.Method = from, from, methodCash
	spec.Basis = "Не принято в «" + to.Name + "»: " + reason
	return statusRejected, "back_operation_id", spec
}

// TransfersQuery filters the list of transfers.
type TransfersQuery struct {
	PageQuery
	Status    string
	AccountID uuid.UUID
}

// ListTransfers returns the transfers over the accounts the actor sees, newest first (listCashTransfers).
func (s *Service) ListTransfers(ctx context.Context, tc tenantctx.TenantContext, q TransfersQuery) (cashapi.CashTransferPage, error) {
	limit, at, after, err := q.page()
	if err != nil {
		return cashapi.CashTransferPage{}, err
	}
	var out cashapi.CashTransferPage
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		ev := s.evaluator(tx)
		pf, err := s.visibleSQL(ctx, ev, tc, "f", 5, true)
		if err != nil {
			return err
		}
		pt, err := s.visibleSQL(ctx, ev, tc, "d", 5+len(pf.Args), true)
		if err != nil {
			return err
		}
		var acc any
		if q.AccountID != uuid.Nil {
			acc = q.AccountID
		}
		args := append(append([]any{nilStr(q.Status), acc, at, after, limit + 1}, pf.Args...), pt.Args...)
		rows, err := tx.Query(ctx, `select `+transferCols+` from cash.transfers t
		 join cash.accounts f on f.id = t.from_account_id join cash.accounts d on d.id = t.to_account_id
		 where ($1::text is null or t.status = $1) and ($2::uuid is null or t.from_account_id = $2 or t.to_account_id = $2)
		   and ($3::timestamptz is null or (t.sent_at, t.id) < ($3::timestamptz, $4::uuid))
		   and (`+pf.SQL+` or `+pt.SQL+`) order by t.sent_at desc, t.id desc limit $5`, args...)
		if err != nil {
			return fmt.Errorf("cash: transfers: %w", err)
		}
		list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (transfer, error) { return scanTransfer(r) })
		if err != nil {
			return fmt.Errorf("cash: transfers: %w", err)
		}
		out = cashapi.CashTransferPage{Items: []cashapi.CashTransfer{}}
		for i, t := range list {
			if i == limit {
				next := encodeCursor(list[limit-1].SentAt, list[limit-1].ID)
				out.NextCursor = &next
				break
			}
			out.Items = append(out.Items, t.dto())
		}
		return nil
	})
	return out, err
}
