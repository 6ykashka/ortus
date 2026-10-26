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
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const dayLayout = "2006-01-02"

// issueNote is the note of the transfer that tops up an advance: the holder and the date of the report.
func issueNote(holder, due string) string {
	return "Выдача под отчёт · " + holder + " · отчитаться до " + due
}

// checkAdvanceRoom checks the limit of money in hand of an advance.
func checkAdvanceRoom(a account, amount int64) error {
	if a.AdvanceLimit != nil && a.Balance+amount > *a.AdvanceLimit {
		return invalid("Лимит на руках у сотрудника — " + formatRub(*a.AdvanceLimit))
	}
	return nil
}

func holderName(ctx context.Context, q Querier, a account) (string, error) {
	if a.Holder == nil {
		return "—", nil
	}
	var name string
	err := q.QueryRow(ctx, `select full_name from people.person_profiles where id = $1`, *a.Holder).Scan(&name)
	if err != nil {
		return "", fmt.Errorf("cash: holder: %w", err)
	}
	return name, nil
}

// issueResult is the answer of an issue: the transfer «in transit» or the approval request above the limit of the role.
type issueResult struct {
	transfer *cashapi.CashTransfer
	request  *cashapi.CashApprovalRequest
}

// IssueAdvance gives money under report to the holder of an advance account (issueCashAdvance): cash.advance.issue over
// the advance and the source, not to oneself; the source must have the money (insufficient_funds), the limit in hand is
// kept. Above the limit of the role the issue becomes an approval request (the second result); otherwise the money goes
// «in transit» until the holder confirms the receipt.
func (s *Service) IssueAdvance(ctx context.Context, tc tenantctx.TenantContext, accountID uuid.UUID, b *cashapi.CashAdvanceIssue) (*cashapi.CashTransfer, *cashapi.CashApprovalRequest, error) {
	if b == nil {
		return nil, nil, problem.New(problem.CodeMalformedRequest, "")
	}
	amount, err := checkAmount(b.Amount)
	if err != nil {
		return nil, nil, err
	}
	due := b.DueDate.Format(dayLayout)
	if b.DueDate.IsZero() || due < s.now().Format(dayLayout) {
		return nil, nil, invalid("Срок отчёта — не раньше сегодняшнего дня")
	}
	var res issueResult
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		var err error
		if res, err = s.issueTx(ctx, tx, tc, accountID, b, amount, due); err != nil {
			return err
		}
		if res.request != nil {
			return complete(ctx, tx, http.StatusAccepted, etag(res.request.Revision), *res.request)
		}
		return complete(ctx, tx, http.StatusCreated, etag(res.transfer.Revision), *res.transfer)
	})
	return res.transfer, res.request, err
}

func (s *Service) issueTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, accountID uuid.UUID, b *cashapi.CashAdvanceIssue, amount int64, due string) (issueResult, error) {
	ev := s.evaluator(tx)
	adv, err := loadAccount(ctx, tx, accountID)
	if err != nil {
		return issueResult{}, err
	}
	if err := s.permit(ctx, ev, tc, adv, actionIssue); err != nil {
		return issueResult{}, err
	}
	switch {
	case adv.Kind != kindAdvance:
		return issueResult{}, invalid("Выберите подотчёт сотрудника")
	case adv.isHolder(tc):
		return issueResult{}, problem.New(codeSelfApproval, "Себе под отчёт выдаёт другой сотрудник")
	}
	src, err := s.issueSource(ctx, tx, ev, tc, b.SourceAccountId, amount)
	if err != nil {
		return issueResult{}, err
	}
	if err := checkAdvanceRoom(adv, amount); err != nil {
		return issueResult{}, err
	}
	holder, err := holderName(ctx, tx, adv)
	if err != nil {
		return issueResult{}, err
	}
	lim, err := s.limitsFor(ctx, tx, tc, adv.ID)
	if err != nil {
		return issueResult{}, err
	}
	if l := lim.of("issue"); overLimit(l, amount) {
		method, cat := methodCash, catTransfer
		r, err := s.request(ctx, tx, tc, adv, requestSpec{Type: "issue", Amount: amount, Method: &method, CategoryID: &cat,
			Basis: "Выдача под отчёт · " + holder, Limit: *l,
			Payload: payload{Issue: &issuePay{SourceAccountID: src.ID, Due: due, Note: b.Note, Holder: holder}}})
		return issueResult{request: &r}, err
	}
	t, err := s.newTransfer(ctx, tx, tc, src, adv, amount, issueNote(holder, due), purposeIssue, tc.PersonID, nil)
	dto := t.dto()
	return issueResult{transfer: &dto}, err
}

// issueSource loads the account an advance is topped up from and checks the actor may issue from it and that it has the money.
func (s *Service) issueSource(ctx context.Context, tx pgx.Tx, ev Authorizer, tc tenantctx.TenantContext, id uuid.UUID, amount int64) (account, error) {
	src, err := loadAccount(ctx, tx, id)
	if err != nil {
		return account{}, err
	}
	if err := s.permit(ctx, ev, tc, src, actionIssue); err != nil {
		return account{}, err
	}
	switch {
	case src.Kind != kindDrawer && src.Kind != kindSafe:
		return account{}, invalid("Подотчёт пополняется из кассы или сейфа")
	case src.Balance < amount:
		return account{}, problem.New(codeInsufficient, "В «"+src.Name+"» нет столько наличных")
	}
	return src, nil
}

// ReturnAdvance sends the unspent rest of an advance back «in transit» (returnCashAdvance): only the holder, not more than
// he has in hand; by default to the account the advance is topped up from.
func (s *Service) ReturnAdvance(ctx context.Context, tc tenantctx.TenantContext, accountID uuid.UUID, b *cashapi.CashAdvanceReturn) (cashapi.CashTransfer, error) {
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
		if out, err = s.returnTx(ctx, tx, tc, accountID, b.TargetAccountId, amount); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusCreated, etag(out.Revision), out)
	})
	return out, err
}

func (s *Service) returnTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, accountID uuid.UUID, to *uuid.UUID, amount int64) (cashapi.CashTransfer, error) {
	adv, err := loadAccount(ctx, tx, accountID)
	if err != nil {
		return cashapi.CashTransfer{}, err
	}
	if err := s.permit(ctx, s.evaluator(tx), tc, adv, actionSelf); err != nil {
		return cashapi.CashTransfer{}, err
	}
	switch {
	case adv.Kind != kindAdvance || !adv.isHolder(tc):
		return cashapi.CashTransfer{}, problem.New(problem.CodeForbiddenAction, "Остаток возвращает держатель подотчёта")
	case amount > adv.Balance:
		return cashapi.CashTransfer{}, invalid("На руках меньше: " + formatRub(adv.Balance))
	}
	if to == nil {
		to = adv.Drawer
	}
	if to == nil {
		return cashapi.CashTransfer{}, invalid("Укажите кассу, в которую возвращаете остаток")
	}
	target, err := loadAccount(ctx, tx, *to)
	if err != nil {
		return cashapi.CashTransfer{}, err
	}
	if target.Kind != kindDrawer && target.Kind != kindSafe {
		return cashapi.CashTransfer{}, invalid("Остаток возвращают в кассу или сейф")
	}
	holder, err := holderName(ctx, tx, adv)
	if err != nil {
		return cashapi.CashTransfer{}, err
	}
	t, err := s.newTransfer(ctx, tx, tc, adv, target, amount, "Возврат остатка подотчёта · "+holder, purposeReturn, tc.PersonID, nil)
	return t.dto(), err
}

// receipt is a row of cash.advance_receipts.
type receipt struct {
	ID, Account uuid.UUID
	Amount      int64
	Currency    string
	CategoryID  string
	LinkKind    *string
	LinkID      *uuid.UUID
	LinkLabel   *string
	Note, Qr    *string
	FileID      uuid.UUID
	Status      string
	Reason      *string
	Operation   *uuid.UUID
	SubmittedBy uuid.UUID
	SubmittedAt time.Time
	DecidedBy   *uuid.UUID
	DecidedAt   *time.Time
	RedoOf      *uuid.UUID
	Revision    int64
}

const receiptCols = `r.id, r.account_id, r.amount_minor, r.currency, r.category_id, r.link_kind, r.link_id, r.link_label, r.note, r.qr, r.file_id,
       r.status, r.reason, r.operation_id, r.submitted_by, r.submitted_at, r.decided_by, r.decided_at, r.redo_of_receipt_id, r.revision`

func scanReceipt(row pgx.Row) (receipt, error) { //nolint:dupl // one row scan per table: the columns differ
	var r receipt
	err := row.Scan(&r.ID, &r.Account, &r.Amount, &r.Currency, &r.CategoryID, &r.LinkKind, &r.LinkID, &r.LinkLabel, &r.Note, &r.Qr, &r.FileID,
		&r.Status, &r.Reason, &r.Operation, &r.SubmittedBy, &r.SubmittedAt, &r.DecidedBy, &r.DecidedAt, &r.RedoOf, &r.Revision)
	r.Currency = trimCurrency(r.Currency)
	return r, err
}

func (r receipt) dto() cashapi.AdvanceReceipt {
	out := cashapi.AdvanceReceipt{Id: r.ID, AccountId: r.Account, Amount: moneyOf(r.Amount, r.Currency), CategoryId: r.CategoryID, FileId: r.FileID,
		Note: r.Note, Qr: r.Qr, Status: cashapi.AdvanceReceiptStatus(r.Status), Reason: r.Reason, OperationId: r.Operation,
		SubmittedAt: r.SubmittedAt.UTC(), SubmittedByMemberId: r.SubmittedBy, DecidedByMemberId: r.DecidedBy, RedoOfReceiptId: r.RedoOf,
		Revision: r.Revision}
	if r.DecidedAt != nil {
		d := r.DecidedAt.UTC()
		out.DecidedAt = &d
	}
	if r.LinkKind != nil && r.LinkID != nil {
		out.Link = &cashapi.CashSourceRef{Key: *r.LinkKind + ":" + r.LinkID.String(), Kind: *r.LinkKind, Id: *r.LinkID, Label: r.LinkLabel}
	}
	return out
}

func loadReceipt(ctx context.Context, q Querier, id uuid.UUID, lock bool) (receipt, error) {
	sql := `select ` + receiptCols + ` from cash.advance_receipts r where r.id = $1`
	if lock {
		sql += lockUpdate
	}
	r, err := scanReceipt(q.QueryRow(ctx, sql, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return receipt{}, problem.New(problem.CodeNotFound, "Чек не найден")
	}
	if err != nil {
		return receipt{}, fmt.Errorf("cash: receipt: %w", err)
	}
	return r, nil
}

// receiptIn is a checked body of submitAdvanceReceipt.
type receiptIn struct {
	amount     int64
	categoryID string
	fileID     uuid.UUID
	note, qr   *string
	linkKind   *string
	linkID     *uuid.UUID
	linkLabel  *string
	redoOf     *uuid.UUID
}

func parseReceipt(b *cashapi.AdvanceReceiptCreate) (receiptIn, error) {
	if b == nil {
		return receiptIn{}, problem.New(problem.CodeMalformedRequest, "")
	}
	amount, err := checkAmount(b.Amount)
	if err != nil {
		return receiptIn{}, err
	}
	switch {
	case strings.TrimSpace(b.CategoryId) == "":
		return receiptIn{}, invalid("Выберите статью")
	case (b.Note != nil && utf8.RuneCountInString(*b.Note) > 500) || (b.Qr != nil && utf8.RuneCountInString(*b.Qr) > 500):
		return receiptIn{}, invalid("Заметка и QR — не длиннее 500 знаков")
	}
	in := receiptIn{amount: amount, categoryID: b.CategoryId, fileID: b.FileId, note: b.Note, qr: b.Qr, redoOf: b.RedoOfReceiptId}
	if l := b.Link; l != nil {
		if !kindRE.MatchString(l.Kind) || l.Id == uuid.Nil || (l.Label != nil && len(*l.Label) > 200) {
			return receiptIn{}, invalid("«К чему относится» указано неверно")
		}
		in.linkKind, in.linkID, in.linkLabel = &l.Kind, &l.Id, l.Label
	}
	return in, nil
}

// SubmitReceipt sends a receipt of an advance report for review (submitAdvanceReceipt): only the holder of the advance;
// the photo is a ready file the holder uploaded, used once; a rejected receipt is re-taken with redoOfReceiptId.
func (s *Service) SubmitReceipt(ctx context.Context, tc tenantctx.TenantContext, accountID uuid.UUID, b *cashapi.AdvanceReceiptCreate) (cashapi.AdvanceReceipt, error) {
	in, err := parseReceipt(b)
	if err != nil {
		return cashapi.AdvanceReceipt{}, err
	}
	var out cashapi.AdvanceReceipt
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		var err error
		if out, err = s.submitTx(ctx, tx, tc, accountID, in); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusCreated, etag(out.Revision), out)
	})
	return out, err
}

func (s *Service) submitTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, accountID uuid.UUID, in receiptIn) (cashapi.AdvanceReceipt, error) {
	adv, err := loadAccount(ctx, tx, accountID)
	if err != nil {
		return cashapi.AdvanceReceipt{}, err
	}
	if err := s.permit(ctx, s.evaluator(tx), tc, adv, actionSelf); err != nil {
		return cashapi.AdvanceReceipt{}, err
	}
	if adv.Kind != kindAdvance || !adv.isHolder(tc) {
		return cashapi.AdvanceReceipt{}, problem.New(problem.CodeForbiddenAction, "Чек добавляет держатель подотчёта")
	}
	if err := checkReceiptRefs(ctx, tx, tc, adv, in); err != nil {
		return cashapi.AdvanceReceipt{}, err
	}
	var id uuid.UUID
	if err := tx.QueryRow(ctx, `insert into cash.advance_receipts (account_id, amount_minor, currency, category_id, link_kind, link_id, link_label,
	        note, file_id, qr, submitted_by, submitted_at, redo_of_receipt_id)
	      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`, adv.ID, in.amount, adv.Currency, in.categoryID, in.linkKind,
		in.linkID, in.linkLabel, in.note, in.fileID, in.qr, tc.PersonID, s.now(), in.redoOf).Scan(&id); err != nil {
		return cashapi.AdvanceReceipt{}, fmt.Errorf("cash: insert receipt: %w", err)
	}
	r, err := loadReceipt(ctx, tx, id, false)
	if err != nil {
		return cashapi.AdvanceReceipt{}, err
	}
	if err := record(ctx, tx, tc, "cash.advance_receipt.submit", targetReceipt, id, adv.Unit, "", map[string]any{keyAccount: adv.ID,
		keyAmount: in.amount, keyCurrency: adv.Currency, "categoryId": in.categoryID}); err != nil {
		return cashapi.AdvanceReceipt{}, err
	}
	err = publish(ctx, tx, "cash.advance_receipt.submitted.v1", targetReceipt, id, map[string]any{"receiptId": id, keyAccount: adv.ID,
		keyAmount: in.amount, keyCurrency: adv.Currency, keyUnit: adv.Unit, "submittedByMemberId": tc.PersonID})
	return r.dto(), err
}

// checkReceiptRefs checks what a receipt refers to: the category of the advance, the photo and the receipt it re-takes.
func checkReceiptRefs(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, adv account, in receiptIn) error {
	var group string
	err := tx.QueryRow(ctx, `select group_name from cash.categories where id = $1`, in.categoryID).Scan(&group)
	switch {
	case errors.Is(err, pgx.ErrNoRows) || (err == nil && group != "expense"):
		return invalid("Статья не найдена")
	case err != nil:
		return fmt.Errorf("cash: category: %w", err)
	case len(adv.CategoryIDs) > 0 && !slices.Contains(adv.CategoryIDs, in.categoryID):
		return invalid("Эта статья не входит в подотчёт сотрудника")
	}
	if err := checkReceiptFile(ctx, tx, tc, in.fileID); err != nil {
		return err
	}
	if in.redoOf == nil {
		return nil
	}
	old, err := loadReceipt(ctx, tx, *in.redoOf, false)
	if err != nil || old.Account != adv.ID || old.Status != statusRejected {
		return invalid("Переснять можно только отклонённый чек этого подотчёта")
	}
	return nil
}

// checkReceiptFile checks the photo of a receipt: a file of the Files module that is ready, uploaded by the holder and not
// attached to another receipt.
func checkReceiptFile(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, id uuid.UUID) error {
	var state string
	var by *uuid.UUID
	var used bool
	err := tx.QueryRow(ctx, `select o.state, o.uploaded_by, exists (select 1 from cash.advance_receipts r where r.file_id = o.id)
	  from files.objects o where o.id = $1`, id).Scan(&state, &by, &used)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return invalid("Сфотографируйте чек")
	case err != nil:
		return fmt.Errorf("cash: receipt file: %w", err)
	case by == nil || *by != tc.PersonID:
		return invalid("Фото чека загружено другим сотрудником")
	case used:
		return invalid("Это фото уже приложено к другому чеку")
	case state != "ready":
		return problem.New("photo_not_ready", "Фото чека ещё не загружено")
	}
	return nil
}

// DecideReceipt accepts or rejects a receipt (decideAdvanceReceipt): cash.advance.issue over the advance, not the holder
// himself. Acceptance writes the expense of the advance; a rejection needs a reason the holder sees.
func (s *Service) DecideReceipt(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, d Decision) (cashapi.AdvanceReceipt, error) { //nolint:dupl // the decision protocol of a receipt, a request and a transfer has one shape: revision, state, not the author
	var reason string
	if !d.Accept {
		r, err := reasonOf(d.Reason, "Укажите, что не так с чеком")
		if err != nil {
			return cashapi.AdvanceReceipt{}, err
		}
		reason = r
	}
	var out cashapi.AdvanceReceipt
	err := s.inTx(ctx, tc, func(tx pgx.Tx) error {
		var err error
		if out, err = s.decideReceiptTx(ctx, tx, tc, id, ifMatch, d.Accept, reason); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

func (s *Service) decideReceiptTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, accept bool, reason string) (cashapi.AdvanceReceipt, error) {
	r, err := loadReceipt(ctx, tx, id, true)
	if err != nil {
		return cashapi.AdvanceReceipt{}, err
	}
	adv, err := loadAccount(ctx, tx, r.Account)
	if err != nil {
		return cashapi.AdvanceReceipt{}, err
	}
	if err := s.permit(ctx, s.evaluator(tx), tc, adv, actionIssue); err != nil {
		return cashapi.AdvanceReceipt{}, err
	}
	if err := checkRevision(ifMatch, r.Revision); err != nil {
		return cashapi.AdvanceReceipt{}, err
	}
	switch {
	case r.Status != statusReview:
		return cashapi.AdvanceReceipt{}, problem.New(codeInvalidTransition, "Чек уже проверен")
	case r.SubmittedBy == tc.PersonID || adv.isHolder(tc):
		return cashapi.AdvanceReceipt{}, problem.New(codeSelfApproval, "Свой чек проверяет другой сотрудник")
	}
	status, rsn, opID := statusRejected, &reason, (*uuid.UUID)(nil)
	if accept {
		status, rsn = statusAccepted, nil
		if opID, err = s.acceptReceipt(ctx, tx, tc, adv, r); err != nil {
			return cashapi.AdvanceReceipt{}, err
		}
	}
	if _, err := tx.Exec(ctx, `update cash.advance_receipts set status = $2, reason = $3, operation_id = $4, decided_by = $5, decided_at = $6,
	   revision = revision + 1 where id = $1`, id, status, rsn, opID, tc.PersonID, s.now()); err != nil {
		return cashapi.AdvanceReceipt{}, fmt.Errorf("cash: receipt: %w", err)
	}
	nr, err := loadReceipt(ctx, tx, id, false)
	if err != nil {
		return cashapi.AdvanceReceipt{}, err
	}
	if err := record(ctx, tx, tc, "cash.advance_receipt.decide", targetReceipt, id, adv.Unit, reason, map[string]any{keyStatus: status}); err != nil {
		return cashapi.AdvanceReceipt{}, err
	}
	err = publish(ctx, tx, "cash.advance_receipt.decided.v1", targetReceipt, id, map[string]any{"receiptId": id, keyStatus: status,
		"submittedByMemberId": r.SubmittedBy, keyAmount: r.Amount, keyCurrency: r.Currency})
	return nr.dto(), err
}

// acceptReceipt writes the expense of the advance a receipt reports.
func (s *Service) acceptReceipt(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, adv account, r receipt) (*uuid.UUID, error) {
	var title string
	if err := tx.QueryRow(ctx, `select title from cash.categories where id = $1`, r.CategoryID).Scan(&title); err != nil {
		return nil, fmt.Errorf("cash: category: %w", err)
	}
	label, cat := "Чек", r.CategoryID
	x, err := s.write(ctx, tx, tc, opSpec{Target: adv, Point: adv, Type: typeOut, Direction: dirOut, Category: catExpense, CategoryID: &cat,
		Amount: r.Amount, Method: methodCash, Basis: "Чек · " + title + join(" · ", r.LinkLabel) + join(" · ", r.Note), OccurredAt: s.now(),
		CreatedBy: tc.PersonID, Origin: originManual, Source: &srcRef{Key: "receipt:" + r.ID.String(), Kind: "receipt", ID: r.ID, Label: &label},
		Receipt: receiptData{Seller: &r.SubmittedBy, FileID: &r.FileID}})
	return &x.Id, err
}

// ReceiptsQuery filters the list of receipts.
type ReceiptsQuery struct {
	PageQuery
	AccountID uuid.UUID
	Status    string
}

// ListReceipts returns the receipts of the advances the actor sees, newest first (listAdvanceReceipts): the holder reads
// his own, a role with cash.read the ones of its area.
func (s *Service) ListReceipts(ctx context.Context, tc tenantctx.TenantContext, q ReceiptsQuery) (cashapi.AdvanceReceiptPage, error) {
	limit, at, after, err := q.page()
	if err != nil {
		return cashapi.AdvanceReceiptPage{}, err
	}
	var out cashapi.AdvanceReceiptPage
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		pred, err := s.visibleSQL(ctx, s.evaluator(tx), tc, "a", 5, true)
		if err != nil {
			return err
		}
		args := append([]any{nilID(q.AccountID), nilStr(q.Status), at, after, limit + 1}, pred.Args...)
		rows, err := tx.Query(ctx, `select `+receiptCols+` from cash.advance_receipts r join cash.accounts a on a.id = r.account_id
		 where ($1::uuid is null or r.account_id = $1) and ($2::text is null or r.status = $2)
		   and ($3::timestamptz is null or (r.submitted_at, r.id) < ($3::timestamptz, $4::uuid))
		   and `+pred.SQL+` order by r.submitted_at desc, r.id desc limit $5`, args...)
		if err != nil {
			return fmt.Errorf("cash: receipts: %w", err)
		}
		list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (receipt, error) { return scanReceipt(r) })
		if err != nil {
			return fmt.Errorf("cash: receipts: %w", err)
		}
		out = cashapi.AdvanceReceiptPage{Items: []cashapi.AdvanceReceipt{}}
		for i, r := range list {
			if i == limit {
				next := encodeCursor(list[limit-1].SubmittedAt, list[limit-1].ID)
				out.NextCursor = &next
				break
			}
			out.Items = append(out.Items, r.dto())
		}
		return nil
	})
	return out, err
}
