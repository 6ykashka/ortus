package cash

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"regexp"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// srcRef is the source of an operation: a record of a module (a visit, a trip, a receipt) under the key of its proposal.
type srcRef struct {
	Key   string
	Kind  string
	ID    uuid.UUID
	Label *string
}

var (
	kindRE   = regexp.MustCompile(`^[a-z][a-z0-9_]{1,49}$`)
	moduleRE = regexp.MustCompile(`^[a-z][a-z0-9_-]{1,49}$`)
)

// sourceOf checks and converts the source of a request.
func sourceOf(r *cashapi.CashSourceRef) (*srcRef, error) {
	if r == nil {
		return nil, nil
	}
	if !validProposalKey(r.Key) || !kindRE.MatchString(r.Kind) || r.Id == uuid.Nil || (r.Label != nil && len(*r.Label) > 200) {
		return nil, invalid("Источник операции указан неверно")
	}
	return &srcRef{Key: r.Key, Kind: r.Kind, ID: r.Id, Label: r.Label}, nil
}

// opSpec is an operation to write: the account whose balance changes (a terminal for a card), the point account (the
// drawer a terminal belongs to; the account itself otherwise) and the facts of the row.
type opSpec struct {
	Target, Point account
	Type          string
	Direction     string
	Category      string
	CategoryID    *string
	Amount        int64
	Method        string
	Basis         string
	OccurredAt    time.Time
	CreatedBy     uuid.UUID
	ApprovedBy    *uuid.UUID
	Origin        string
	Related       *cashapi.ObjectRef
	Reverses      *uuid.UUID
	Refunds       *uuid.UUID
	Own           bool
	NeedShift     bool // a receipt, an expense or a refund of a drawer with shifts needs an open shift
	GroupID       *uuid.UUID
	TransferID    *uuid.UUID
	Source        *srcRef
	Receipt       receiptData
	ShiftID       *uuid.UUID // explicit shift; nil: the open one of the drawer, if any
}

func (sp opSpec) relatedArgs() (module, kind *string, id *uuid.UUID) {
	if sp.Related == nil {
		return nil, nil, nil
	}
	return &sp.Related.ModuleKey, &sp.Related.EntityType, &sp.Related.EntityId
}

func (sp opSpec) sourceArgs() (key, kind *string, id *uuid.UUID, label *string) {
	if sp.Source == nil {
		return nil, nil, nil, nil
	}
	return &sp.Source.Key, &sp.Source.Kind, &sp.Source.ID, sp.Source.Label
}

func (sp opSpec) receiptArgs() (fd, kkt, reason, basis *string) {
	if sp.Receipt.Fd != "" {
		fd, kkt = &sp.Receipt.Fd, &sp.Receipt.KktShift
	}
	if sp.Receipt.Reason != "" {
		reason = &sp.Receipt.Reason
	}
	if sp.Basis != "" {
		basis = &sp.Basis
	}
	return fd, kkt, reason, basis
}

// openShiftID returns the open shift of a drawer; share locks it against a closing one (the shift row is locked before
// the account row everywhere: no deadlock).
func openShiftID(ctx context.Context, q Querier, drawer uuid.UUID, share bool) (*uuid.UUID, error) {
	sql := `select id from cash.shifts where account_id = $1 and status = 'open'`
	if share {
		sql += ` for share`
	}
	var id uuid.UUID
	err := q.QueryRow(ctx, sql, drawer).Scan(&id)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil, nil
	case err != nil:
		return nil, fmt.Errorf("cash: open shift: %w", err)
	}
	return &id, nil
}

// post writes one operation and moves the balance of its account in the same transaction (the only way money moves).
func (s *Service) post(ctx context.Context, tx pgx.Tx, sp opSpec) (uuid.UUID, int64, error) {
	shift, err := shiftOf(ctx, tx, sp)
	if err != nil {
		return uuid.Nil, 0, err
	}
	if err := checkFiscalDuplicate(ctx, tx, sp); err != nil {
		return uuid.Nil, 0, err
	}
	now := s.now()
	if err := moveBalance(ctx, tx, sp, now); err != nil {
		return uuid.Nil, 0, err
	}
	return insertOperation(ctx, tx, sp, shift, now)
}

// shiftOf returns the shift an operation belongs to: the explicit one or the open shift of the drawer; a drawer with
// shifts and none open refuses payments (shift_closed).
func shiftOf(ctx context.Context, tx pgx.Tx, sp opSpec) (*uuid.UUID, error) {
	d := sp.Point
	if sp.ShiftID != nil || d.Kind != kindDrawer || d.ShiftMode == modeNone {
		return sp.ShiftID, nil
	}
	id, err := openShiftID(ctx, tx, d.ID, true)
	if err != nil {
		return nil, err
	}
	if id == nil && sp.NeedShift {
		return nil, problem.New(codeShiftClosed, "Смена в «"+d.Name+"» закрыта — откройте смену, чтобы проводить оплаты")
	}
	return id, nil
}

// checkFiscalDuplicate refuses a fiscal document number already entered in the shift of the KKT of the point account.
func checkFiscalDuplicate(ctx context.Context, tx pgx.Tx, sp opSpec) error {
	if sp.Receipt.Fd == "" {
		return nil
	}
	var number int64
	var basis *string
	err := tx.QueryRow(ctx, `select number, basis from cash.operations
	 where point_account_id = $1 and kkt_shift = $2 and fd_number = $3`, sp.Point.ID, sp.Receipt.KktShift, sp.Receipt.Fd).Scan(&number, &basis)
	switch {
	case err == nil:
		return problem.New(codeDuplicateReceipt, "Чек № ФД "+sp.Receipt.Fd+" (смена ККТ "+sp.Receipt.KktShift+
			") уже внесён: K-"+strconv.FormatInt(number, 10)+join(" · ", basis))
	case !errors.Is(err, pgx.ErrNoRows):
		return fmt.Errorf("cash: receipt: %w", err)
	}
	return nil
}

func join(sep string, s *string) string {
	if s == nil || *s == "" {
		return ""
	}
	return sep + *s
}

// moveBalance changes the balance of the account by the direction and the amount; a physical account does not go below
// zero (the constraint of tenant 0040 → insufficient_funds).
func moveBalance(ctx context.Context, tx pgx.Tx, sp opSpec, now time.Time) error {
	delta := sp.Amount
	if sp.Direction == dirOut {
		delta = -delta
	}
	_, err := tx.Exec(ctx, `update cash.accounts set balance_minor = balance_minor + $2, revision = revision + 1, updated_at = $3
	 where id = $1`, sp.Target.ID, delta, now)
	if code, cons := pgCode(err); code == "23514" && cons == "accounts_physical_not_negative" {
		return problem.New(codeInsufficient, "В «"+sp.Target.Name+"» нет столько наличных: остаток ушёл бы в минус")
	}
	if err != nil {
		return fmt.Errorf("cash: balance: %w", err)
	}
	return nil
}

func insertOperation(ctx context.Context, tx pgx.Tx, sp opSpec, shift *uuid.UUID, now time.Time) (uuid.UUID, int64, error) {
	rel, relType, relID := sp.relatedArgs()
	skey, skind, sid, slabel := sp.sourceArgs()
	fd, kkt, reason, basis := sp.receiptArgs()
	var id uuid.UUID
	var number int64
	err := tx.QueryRow(ctx, `insert into cash.operations (account_id, point_account_id, type, direction, amount_minor, currency, category,
	        category_id, method, basis, occurred_at, posted_at, created_by, approved_by, origin, related_module, related_type, related_id,
	        reverses_operation_id, refunds_operation_id, own, shift_id, group_id, transfer_id, source_key, source_kind, source_id,
	        source_label, fd_number, kkt_shift, receipt_at, receipt_none, receipt_reason, seller_id, receipt_file_id)
	      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
	        $26, $27, $28, $29, $30, $31, $32, $33, $34, $35) returning id, number`,
		sp.Target.ID, sp.Point.ID, sp.Type, sp.Direction, sp.Amount, sp.Target.Currency, sp.Category, sp.CategoryID, sp.Method, basis,
		sp.OccurredAt, now, sp.CreatedBy, sp.ApprovedBy, sp.Origin, rel, relType, relID, sp.Reverses, sp.Refunds, sp.Own, shift,
		sp.GroupID, sp.TransferID, skey, skind, sid, slabel, fd, kkt, sp.Receipt.At, sp.Receipt.None, reason, sp.Receipt.Seller,
		sp.Receipt.FileID).Scan(&id, &number)
	if code, cons := pgCode(err); code == "23505" {
		switch cons {
		case "operations_reverses_idx":
			return uuid.Nil, 0, problem.New(codeInvalidTransition, "Операция уже исправлена")
		case "operations_receipt_idx":
			return uuid.Nil, 0, problem.New(codeDuplicateReceipt, "Чек с таким № ФД уже внесён")
		}
	}
	if err != nil {
		return uuid.Nil, 0, fmt.Errorf("cash: insert operation: %w", err)
	}
	return id, number, nil
}

// opRow is an operation as read back.
type opRow struct {
	cashapi.CashOperation
	Number    int64
	Point     uuid.UUID
	Refunds   *uuid.UUID
	Currency  string
	TypeRaw   string
	Created   uuid.UUID
	AccountID uuid.UUID
}

const opCols = `o.id, o.number, o.account_id, o.point_account_id, o.amount_minor, o.currency, o.approved_by, o.basis, o.category,
       o.category_id, o.created_by, o.direction, o.group_id, o.method, o.occurred_at, o.origin, o.own, o.posted_at, o.fd_number,
       o.kkt_shift, o.receipt_at, o.receipt_none, o.receipt_reason, o.seller_id, o.receipt_file_id, o.reconcile_status,
       o.related_module, o.related_type, o.related_id, (select r.id from cash.operations r where r.reverses_operation_id = o.id),
       o.reverses_operation_id, o.refunds_operation_id, o.shift_id, coalesce(o.source_key, l.source_key),
       coalesce(o.source_kind, l.source_kind), coalesce(o.source_id, l.source_id), coalesce(o.source_label, l.source_label),
       o.transfer_id, o.type`

const opFrom = ` from cash.operations o left join cash.operation_links l on l.operation_id = o.id`

// opScan holds the columns of a journal row before they become CashOperation.
type opScan struct {
	amount                                     int64
	method, origin, cat, dir, typ, recon, curr string
	occurred, posted                           time.Time
	own, none                                  bool
	fd, kkt, reason, rmod, rtype               *string
	skey, skind, slabel                        *string
	rat                                        *time.Time
	seller, file, rid, sid                     *uuid.UUID
}

func scanOp(row pgx.Row) (opRow, error) {
	var (
		x opRow
		c opScan
	)
	err := row.Scan(&x.Id, &x.Number, &x.AccountId, &x.Point, &c.amount, &c.curr, &x.ApprovedByMemberId, &x.Basis, &c.cat, &x.CategoryId,
		&x.CreatedByMemberId, &c.dir, &x.GroupId, &c.method, &c.occurred, &c.origin, &c.own, &c.posted, &c.fd, &c.kkt, &c.rat, &c.none,
		&c.reason, &c.seller, &c.file, &c.recon, &c.rmod, &c.rtype, &c.rid, &x.ReversedByOperationId, &x.ReversesOperationId, &x.Refunds,
		&x.ShiftId, &c.skey, &c.skind, &c.sid, &c.slabel, &x.TransferId, &c.typ)
	if err != nil {
		return opRow{}, err
	}
	c.fill(&x)
	return x, nil
}

// fill sets the DTO of x from the scanned columns.
func (c opScan) fill(x *opRow) {
	cur := trimCurrency(c.curr)
	x.Currency, x.TypeRaw, x.Created, x.AccountID = cur, c.typ, x.CreatedByMemberId, x.AccountId
	x.Amount = moneyOf(c.amount, cur)
	x.Direction, x.Category = cashapi.CashOperationDirection(c.dir), cashapi.CashOperationCategory(c.cat)
	x.Method, x.Origin, x.Type = cashapi.CashOperationMethod(c.method), cashapi.CashOperationOrigin(c.origin), cashapi.CashOperationType(c.typ)
	x.OccurredAt, x.PostedAt = c.occurred.UTC(), c.posted.UTC()
	rs := cashapi.CashOperationReconcileStatus(c.recon)
	x.ReconcileStatus = &rs
	if c.own {
		x.Own = new(true)
	}
	x.Receipt = c.receipt()
	if c.rmod != nil && c.rtype != nil && c.rid != nil {
		x.RelatedObject = &cashapi.ObjectRef{ModuleKey: *c.rmod, EntityType: *c.rtype, EntityId: *c.rid}
	}
	if c.skey != nil && c.skind != nil && c.sid != nil {
		x.Source = &cashapi.CashSourceRef{Key: *c.skey, Kind: *c.skind, Id: *c.sid, Label: c.slabel}
	}
}

func (c opScan) receipt() *cashapi.CashReceipt {
	if c.fd == nil && !c.none && c.seller == nil && c.file == nil {
		return nil
	}
	rc := cashapi.CashReceipt{FdNumber: c.fd, KktShift: c.kkt, Reason: c.reason, SellerMemberId: c.seller, FileId: c.file}
	if c.none {
		rc.None = new(true)
	}
	if c.rat != nil {
		t := c.rat.UTC()
		rc.ReceiptAt = &t
	}
	return &rc
}

// readOp reads operation id back through q.
func readOp(ctx context.Context, q Querier, id uuid.UUID) (opRow, error) {
	x, err := scanOp(q.QueryRow(ctx, `select `+opCols+opFrom+` where o.id = $1`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return opRow{}, problem.New(problem.CodeNotFound, textOpNotFound)
	}
	if err != nil {
		return opRow{}, fmt.Errorf("cash: operation: %w", err)
	}
	return x, nil
}

// write posts an operation and records it: the journal row, the audit row and the event `cash.operation.posted.v1`.
func (s *Service) write(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, sp opSpec) (opRow, error) {
	id, _, err := s.post(ctx, tx, sp)
	if err != nil {
		return opRow{}, err
	}
	x, err := readOp(ctx, tx, id)
	if err != nil {
		return opRow{}, err
	}
	diff := map[string]any{"type": x.TypeRaw, "direction": string(x.Direction), keyAmount: x.Amount.AmountMinor,
		keyCurrency: x.Currency, "method": string(x.Method), keyAccount: x.AccountId}
	if err := record(ctx, tx, tc, "cash.operation.post", targetOp, id, sp.Target.Unit, "", diff); err != nil {
		return opRow{}, err
	}
	payload := map[string]any{"operationId": id, keyUnit: sp.Target.Unit, keyNumber: x.Number}
	maps.Copy(payload, diff)
	if sp.GroupID != nil {
		payload["groupId"] = *sp.GroupID
	}
	if err := publish(ctx, tx, "cash.operation.posted.v1", targetOp, id, payload); err != nil {
		return opRow{}, err
	}
	return x, nil
}

// pointOf returns the point account of a: the drawer of a terminal, the account itself otherwise.
func pointOf(ctx context.Context, q Querier, a account) (account, error) {
	if a.Kind == kindAcquiring && a.Drawer != nil {
		return loadAccount(ctx, q, *a.Drawer)
	}
	return a, nil
}

// terminalOf returns the terminal of a drawer.
func terminalOf(ctx context.Context, q Querier, drawer account) (account, bool, error) {
	a, err := scanAccount(q.QueryRow(ctx, `select `+accountCols+` from cash.accounts a
	 where a.kind = 'acquiring' and a.drawer_account_id = $1 order by a.created_at limit 1`, drawer.ID))
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return account{}, false, nil
	case err != nil:
		return account{}, false, fmt.Errorf("cash: terminal: %w", err)
	}
	return a, true, nil
}

// target resolves the account the money of a way of payment goes to: a card or SBP payment of a drawer goes to its
// terminal, a terminal takes only those; the way must be taken by the kind.
func target(ctx context.Context, q Querier, a account, method string) (account, error) {
	t := a
	if (method == methodCard || method == methodSbp) && a.Kind == kindDrawer {
		term, ok, err := terminalOf(ctx, q, a)
		if err != nil {
			return account{}, err
		}
		if !ok {
			return account{}, invalid("У «" + a.Name + "» нет терминала: карта и СБП недоступны")
		}
		t = term
	}
	if !methodAllowed(t.Kind, method) {
		return account{}, invalid(textMethod)
	}
	return t, nil
}

// checkCategory checks that a category of the catalogue exists and fits the direction.
func checkCategory(ctx context.Context, q Querier, id, direction string) error {
	var dir *string
	err := q.QueryRow(ctx, `select direction from cash.categories where id = $1`, id).Scan(&dir)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return invalid("Статья не найдена")
	case err != nil:
		return fmt.Errorf("cash: category: %w", err)
	case dir != nil && *dir != direction:
		return invalid("Статья не подходит к направлению операции")
	}
	return nil
}
