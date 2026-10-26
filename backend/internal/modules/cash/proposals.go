package cash

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Offer is a proposal of a module to the cash desks: money that should move (a visit paid, an expense of a trip accepted,
// a payment of a customer). The key «kind:source» is the key of idempotency: an offer repeated is dropped, a proposal
// posted or dismissed is never offered again. A proposal moves no money until a person posts it.
type Offer struct {
	Key              string
	Kind             string // visit | expense | payroll | refund | purchase | invoice
	Title            string
	Amount           int64
	Direction        string // in | out
	DefaultAccountID *uuid.UUID
	CategoryID       *string
	SourceKind       string
	SourceID         uuid.UUID
	SourceLabel      *string
	Parts            []cashapi.CashProposalPart
}

// Execer is a pool, a connection or a transaction.
type Execer interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
}

var proposalKinds = map[string]bool{"visit": true, "expense": true, "payroll": true, typeRefund: true, "purchase": true, "invoice": true}

// Offer records a proposal of a module (the input port of the proposals): modules and the worker call it in their
// transaction; it reports whether the proposal is new.
func (s *Service) Offer(ctx context.Context, db Execer, o Offer) (bool, error) {
	switch {
	case !validProposalKey(o.Key), !proposalKinds[o.Kind], !kindRE.MatchString(o.SourceKind), o.SourceID == uuid.Nil,
		o.Amount <= 0, o.Direction != dirIn && o.Direction != dirOut, len(o.Title) == 0 || len(o.Title) > 300:
		return false, invalid("Предложение кассе указано неверно")
	}
	parts := o.Parts
	if parts == nil {
		parts = []cashapi.CashProposalPart{}
	}
	raw, err := json.Marshal(parts)
	if err != nil {
		return false, fmt.Errorf("cash: parts: %w", err)
	}
	tag, err := db.Exec(ctx, `insert into cash.proposals (key, kind, title, amount_minor, direction, default_account_id, category_id,
	        source_kind, source_id, source_label, parts, created_at)
	      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) on conflict (key) do nothing`,
		o.Key, o.Kind, o.Title, o.Amount, o.Direction, o.DefaultAccountID, o.CategoryID, o.SourceKind, o.SourceID, o.SourceLabel, raw, s.now())
	if err != nil {
		return false, fmt.Errorf("cash: offer: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// OfferInTenant records a proposal in the tenant DB (for a consumer of events of the worker).
func (s *Service) OfferInTenant(ctx context.Context, tenantID uuid.UUID, o Offer) (bool, error) {
	pool, err := s.Pools.For(ctx, tenantID)
	if err != nil {
		return false, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return s.Offer(ctx, pool, o)
}

// proposalRow is a row of cash.proposals.
type proposalRow struct {
	Key, Kind, Title string
	Amount           int64
	Currency         string
	Direction        string
	DefaultAccount   *uuid.UUID
	CategoryID       *string
	SourceKind       string
	SourceID         uuid.UUID
	SourceLabel      *string
	Parts            []byte
	Status           string
	GroupID          *uuid.UUID
	CreatedAt        time.Time
}

const proposalCols = `p.key, p.kind, p.title, p.amount_minor, p.currency, p.direction, p.default_account_id, p.category_id, p.source_kind,
       p.source_id, p.source_label, p.parts, p.status, p.group_id, p.created_at`

func scanProposal(row pgx.Row) (proposalRow, error) {
	var p proposalRow
	err := row.Scan(&p.Key, &p.Kind, &p.Title, &p.Amount, &p.Currency, &p.Direction, &p.DefaultAccount, &p.CategoryID, &p.SourceKind,
		&p.SourceID, &p.SourceLabel, &p.Parts, &p.Status, &p.GroupID, &p.CreatedAt)
	p.Currency = trimCurrency(p.Currency)
	return p, err
}

func loadProposal(ctx context.Context, q Querier, key string, lock bool) (proposalRow, error) {
	sql := `select ` + proposalCols + ` from cash.proposals p where p.key = $1`
	if lock {
		sql += lockUpdate
	}
	p, err := scanProposal(q.QueryRow(ctx, sql, key))
	if errors.Is(err, pgx.ErrNoRows) {
		return proposalRow{}, problem.New(problem.CodeNotFound, "Предложение не найдено")
	}
	if err != nil {
		return proposalRow{}, fmt.Errorf("cash: proposal: %w", err)
	}
	return p, nil
}

// dto is CashProposal with the operations the proposal produced and its dismissal.
func (p proposalRow) dto(ctx context.Context, q Querier) (cashapi.CashProposal, error) {
	out := cashapi.CashProposal{Amount: moneyOf(p.Amount, p.Currency), CategoryId: p.CategoryID, CreatedAt: p.CreatedAt.UTC(),
		DefaultAccountId: p.DefaultAccount, Direction: cashapi.CashProposalDirection(p.Direction), Key: p.Key,
		Kind: cashapi.CashProposalKind(p.Kind), Status: cashapi.CashProposalStatus(p.Status), Title: p.Title,
		Source: cashapi.CashSourceRef{Key: p.Key, Kind: p.SourceKind, Id: p.SourceID, Label: p.SourceLabel}}
	var parts []cashapi.CashProposalPart
	if err := json.Unmarshal(p.Parts, &parts); err != nil {
		return out, fmt.Errorf("cash: parts: %w", err)
	}
	if len(parts) > 0 {
		out.Parts = &parts
	}
	rows, err := q.Query(ctx, `select o.id from cash.operations o
	 where o.source_key = $1 or o.id in (select operation_id from cash.operation_links where source_key = $1) order by o.number`, p.Key)
	if err != nil {
		return out, fmt.Errorf("cash: proposal operations: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return out, fmt.Errorf("cash: proposal operations: %w", err)
	}
	if len(ids) > 0 {
		out.OperationIds = &ids
	}
	if p.Status == "dismissed" {
		var d cashapi.CashProposalDismissal
		err := q.QueryRow(ctx, `select reason, dismissed_by, dismissed_at from cash.proposal_dismissals where proposal_key = $1`, p.Key).
			Scan(&d.Reason, &d.ByMemberId, &d.At)
		if err != nil {
			return out, fmt.Errorf("cash: dismissal: %w", err)
		}
		d.At = d.At.UTC()
		out.Dismissal = &d
	}
	return out, nil
}

// ProposalsQuery filters the list of proposals.
type ProposalsQuery struct {
	PageQuery
	Status string
}

// ListProposals returns the proposals for the cash desks the actor sees, open ones by default (listCashProposals). A
// proposal that waits for an approval is hidden; the financial block («выплаты бригаде», payroll) needs
// cash.payroll.post.
func (s *Service) ListProposals(ctx context.Context, tc tenantctx.TenantContext, q ProposalsQuery) (cashapi.CashProposalPage, error) {
	limit, err := q.size()
	if err != nil {
		return cashapi.CashProposalPage{}, err
	}
	var at, afterKey any
	if q.Cursor != "" {
		c, err := decodeKeyCursor(q.Cursor)
		if err != nil {
			return cashapi.CashProposalPage{}, err
		}
		at, afterKey = c.At, c.Key
	}
	status := q.Status
	if status == "" {
		status = statusOpen
	}
	var out cashapi.CashProposalPage
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		ev := s.evaluator(tx)
		read, err := s.visibleSQL(ctx, ev, tc, "a", 4, false)
		if err != nil {
			return err
		}
		cols := authz.Columns{Unit: "a.org_unit_id", Objects: map[string]string{authz.KindAccount: areaOf("a")}}
		pay, err := ev.ScopeQuery(ctx, tc, actionPayroll, cols, 4+len(read.Args))
		if err != nil {
			return err
		}
		none, err := ev.ScopeQuery(ctx, tc, actionRead, authz.Columns{}, 4+len(read.Args)+len(pay.Args))
		if err != nil {
			return err
		}
		args := append(append(append([]any{status, at, afterKey, limit + 1}, read.Args...), pay.Args...), none.Args...)
		rows, err := tx.Query(ctx, `select `+proposalCols+` from cash.proposals p left join cash.accounts a on a.id = p.default_account_id
		 where p.status = $1 and ($2::timestamptz is null or (p.created_at, p.key) < ($2::timestamptz, $3::text))
		   and ((a.id is not null and `+read.SQL+`) or (a.id is null and `+none.SQL+`))
		   and (p.kind <> 'payroll' or `+pay.SQL+`)
		   and not exists (select 1 from cash.approval_requests r where r.status = 'pending' and r.payload->'proposal'->>'key' = p.key)
		 order by p.created_at desc, p.key desc limit $4`, args...)
		if err != nil {
			return fmt.Errorf("cash: proposals: %w", err)
		}
		list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (proposalRow, error) { return scanProposal(r) })
		if err != nil {
			return fmt.Errorf("cash: proposals: %w", err)
		}
		out = cashapi.CashProposalPage{Items: []cashapi.CashProposal{}}
		for i, p := range list {
			if i == limit {
				next := encodeKeyCursor(list[limit-1].CreatedAt, list[limit-1].Key)
				out.NextCursor = &next
				break
			}
			dto, err := p.dto(ctx, tx)
			if err != nil {
				return err
			}
			out.Items = append(out.Items, dto)
		}
		return nil
	})
	return out, err
}

// DismissProposal removes a proposal from the inbox with a reason (dismissCashProposal): cash.proposals.post over the
// account of the proposal; the reason stays with the author and the time.
func (s *Service) DismissProposal(ctx context.Context, tc tenantctx.TenantContext, key string, reasonIn *string) (cashapi.CashProposal, error) {
	if !validProposalKey(key) {
		return cashapi.CashProposal{}, problem.New(problem.CodeNotFound, "Предложение не найдено")
	}
	reason, err := reasonOf(reasonIn, "Укажите, почему не проводите")
	if err != nil {
		return cashapi.CashProposal{}, err
	}
	var out cashapi.CashProposal
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		ev := s.evaluator(tx)
		p, err := loadProposal(ctx, tx, key, true)
		if err != nil {
			return err
		}
		var unit *uuid.UUID
		if p.DefaultAccount != nil {
			a, err := loadAccount(ctx, tx, *p.DefaultAccount)
			if err != nil {
				return err
			}
			if err := s.permit(ctx, ev, tc, a, actionProposals); err != nil {
				return err
			}
			unit = a.Unit
		} else if err := ev.Permit(ctx, tc, actionProposals, authz.Resource{}); err != nil {
			return err
		}
		if p.Status != statusOpen {
			return problem.New(codeInvalidTransition, "Предложение уже проведено или отклонено")
		}
		at := s.now()
		if _, err := tx.Exec(ctx, `insert into cash.proposal_dismissals (proposal_key, reason, dismissed_by, dismissed_at) values ($1, $2, $3, $4)`,
			key, reason, tc.PersonID, at); err != nil {
			return fmt.Errorf("cash: dismissal: %w", err)
		}
		if _, err := tx.Exec(ctx, `update cash.proposals set status = 'dismissed' where key = $1`, key); err != nil {
			return fmt.Errorf("cash: proposal: %w", err)
		}
		if err := record(ctx, tx, tc, "cash.proposal.dismiss", targetProposal, uuid.NewSHA1(uuid.NameSpaceURL, []byte(key)), unit, reason,
			map[string]any{"key": key}); err != nil {
			return err
		}
		p.Status = "dismissed"
		if out, err = p.dto(ctx, tx); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, "", out)
	})
	return out, err
}

// PostProposal posts a proposal as one operation or, for a payment in parts, several of one group (postCashProposal): the
// whole or nothing, one source once (duplicate_source). Above the limit of the role an expense or a refund becomes an
// approval request (the second result).
func (s *Service) PostProposal(ctx context.Context, tc tenantctx.TenantContext, key string, b *cashapi.CashProposalPost) (*cashapi.CashProposalPostResult, *cashapi.CashApprovalRequest, error) {
	if b == nil || !validProposalKey(key) {
		return nil, nil, problem.New(problem.CodeMalformedRequest, "")
	}
	if b.Basis != nil && len(*b.Basis) > 500 {
		return nil, nil, invalid("Основание — не длиннее 500 знаков")
	}
	pay := proposalPay{Key: key, AccountID: b.AccountId, Basis: b.Basis, Parts: b.Parts, Receipt: b.Receipt}
	var (
		res *cashapi.CashProposalPostResult
		req *cashapi.CashApprovalRequest
	)
	err := s.inTx(ctx, tc, func(tx pgx.Tx) error {
		var err error
		if res, req, err = s.postProposalTx(ctx, tx, tc, pay); err != nil {
			return err
		}
		if req != nil {
			return complete(ctx, tx, http.StatusAccepted, etag(req.Revision), *req)
		}
		return complete(ctx, tx, http.StatusCreated, "", *res)
	})
	return res, req, err
}

func (s *Service) postProposalTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, pay proposalPay) (*cashapi.CashProposalPostResult, *cashapi.CashApprovalRequest, error) {
	p, err := loadProposal(ctx, tx, pay.Key, true)
	if err != nil {
		return nil, nil, err
	}
	a, err := loadAccount(ctx, tx, pay.AccountID)
	if err != nil {
		return nil, nil, err
	}
	if err := s.proposalPostable(ctx, tx, tc, p, a); err != nil {
		return nil, nil, err
	}
	if p.Direction == dirOut {
		if req, err := s.proposalRequest(ctx, tx, tc, p, a, pay); err != nil || req != nil {
			return nil, req, err
		}
	}
	ops, err := s.postProposal(ctx, tx, tc, p, a, pay, tc.PersonID, nil)
	if err != nil {
		return nil, nil, err
	}
	if p, err = loadProposal(ctx, tx, pay.Key, false); err != nil {
		return nil, nil, err
	}
	dto, err := p.dto(ctx, tx)
	if err != nil {
		return nil, nil, err
	}
	out := cashapi.CashProposalPostResult{Proposal: dto, Operations: make([]cashapi.CashOperation, 0, len(ops))}
	for _, o := range ops {
		out.Operations = append(out.Operations, o.CashOperation)
	}
	return &out, nil, nil
}

// proposalPostable checks that the actor may post the proposal to the account now: the right (a refund — cash.refund, the
// financial block — cash.payroll.post too), not into an advance, open, of the account of the proposal, not waiting.
func (s *Service) proposalPostable(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, p proposalRow, a account) error {
	ev := s.evaluator(tx)
	action := actionProposals
	if p.Kind == "refund" {
		action = actionRefund
	}
	if err := s.permit(ctx, ev, tc, a, action); err != nil {
		return err
	}
	if p.Kind == "payroll" {
		if err := s.permit(ctx, ev, tc, a, actionPayroll); err != nil {
			return err
		}
	}
	switch {
	case a.Kind == kindAdvance:
		return problem.New(problem.CodeForbiddenAction, "Подотчёт пополняется выдачей из кассы")
	case p.Status != statusOpen:
		return problem.New(codeInvalidTransition, "Предложение уже проведено, отклонено или недоступно")
	case p.DefaultAccount != nil && *p.DefaultAccount != a.ID:
		return invalid("Предложение относится к другой кассе")
	}
	if waits, err := exists(ctx, tx, `select 1 from cash.approval_requests where status = 'pending' and payload->'proposal'->>'key' = $1`, p.Key); err != nil {
		return err
	} else if waits {
		return problem.New(codeInvalidTransition, "Предложение уже ждёт согласования")
	}
	return nil
}

// proposalRequest records the approval request of an expense or a refund above the limit of the role; nil — within it.
func (s *Service) proposalRequest(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, p proposalRow, a account, pay proposalPay) (*cashapi.CashApprovalRequest, error) {
	kind := typeOut
	if p.Kind == "refund" {
		kind = typeRefund
	}
	lim, err := s.limitsFor(ctx, tx, tc, a.ID)
	if err != nil {
		return nil, err
	}
	l := lim.of(kind)
	if !overLimit(l, p.Amount) {
		return nil, nil
	}
	if _, err := checkReceipt(a.KktMode == kktManual, kind, pay.Receipt); err != nil {
		return nil, err
	}
	method := defaultMethod(a.Kind)
	r, err := s.request(ctx, tx, tc, a, requestSpec{Type: kind, Amount: p.Amount, Method: &method, CategoryID: p.CategoryID, Basis: p.Title,
		Source: &srcRef{Key: p.Key, Kind: p.SourceKind, ID: p.SourceID, Label: p.SourceLabel}, Limit: *l, Payload: payload{Proposal: &pay}})
	return &r, err
}

// postProposal posts a proposal in the name of createdBy (approvedBy is the approver of a request): it claims the source
// first (a second claim is duplicate_source), writes the operations of one group and marks the proposal posted.
func (s *Service) postProposal(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, p proposalRow, a account, pay proposalPay, createdBy uuid.UUID, approvedBy *uuid.UUID) ([]opRow, error) {
	group := uuid.New()
	if err := claimSource(ctx, tx, p.Key, group, createdBy); err != nil {
		return nil, err
	}
	basis := p.Title
	if pay.Basis != nil && len(*pay.Basis) >= 3 {
		basis = *pay.Basis
	}
	base := opSpec{Direction: p.Direction, CategoryID: p.CategoryID, Basis: basis, OccurredAt: s.now(), CreatedBy: createdBy, ApprovedBy: approvedBy,
		Origin: "proposal", NeedShift: true, Source: &srcRef{Key: p.Key, Kind: p.SourceKind, ID: p.SourceID, Label: p.SourceLabel}}
	var ops []opRow
	var err error
	if p.Direction == dirIn {
		ops, err = s.postIncome(ctx, tx, tc, base, p, a, pay, group)
	} else {
		ops, err = s.postExpense(ctx, tx, tc, base, p, a, pay)
	}
	if err != nil {
		return nil, err
	}
	if _, err := tx.Exec(ctx, `update cash.proposals set status = 'posted', posted_at = $2, posted_by = $3, group_id = $4 where key = $1`,
		p.Key, s.now(), createdBy, group); err != nil {
		return nil, fmt.Errorf("cash: proposal: %w", err)
	}
	return ops, nil
}

// postIncome writes the parts of a payment: each part to the account its way of payment leads to, one group for all of them
// and one receipt of the KKT (the number of a fiscal document is unique) on the first.
func (s *Service) postIncome(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, base opSpec, p proposalRow, a account, pay proposalPay, group uuid.UUID) ([]opRow, error) {
	parts := pay.Parts
	if len(parts) == 0 { // the whole sum in the first way of the account
		parts = []cashapi.CashProposalPostPart{{Amount: moneyOf(p.Amount, p.Currency), Method: cashapi.CashProposalPostPartMethod(defaultMethod(a.Kind))}}
	}
	if _, err := checkParts(parts, p.Amount); err != nil {
		return nil, err
	}
	base.Type, base.Category = typeIn, catServicePayment
	if len(parts) > 1 {
		base.GroupID = &group
	}
	var ops []opRow
	for i, part := range parts {
		sp, err := s.partSpec(ctx, tx, base, a, part)
		if err != nil {
			return nil, err
		}
		rc, err := checkReceipt(sp.Point.KktMode == kktManual, typeIn, pay.Receipt)
		if err != nil {
			return nil, err
		}
		if i == 0 {
			sp.Receipt = rc
		}
		x, err := s.write(ctx, tx, tc, sp)
		if err != nil {
			return nil, err
		}
		ops = append(ops, x)
	}
	return ops, nil
}

// partSpec is the operation of one part of a payment: the account its way of payment leads to.
func (s *Service) partSpec(ctx context.Context, tx pgx.Tx, base opSpec, a account, part cashapi.CashProposalPostPart) (opSpec, error) {
	amount, _ := checkAmount(part.Amount) // checked by checkParts
	t, err := target(ctx, tx, a, string(part.Method))
	if err != nil {
		return base, err
	}
	point, err := pointOf(ctx, tx, t)
	if err != nil {
		return base, err
	}
	base.Target, base.Point, base.Method, base.Amount = t, point, string(part.Method), amount
	return base, nil
}

// postExpense writes the expense or the refund of a proposal as one operation.
func (s *Service) postExpense(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, base opSpec, p proposalRow, a account, pay proposalPay) ([]opRow, error) {
	point, err := pointOf(ctx, tx, a)
	if err != nil {
		return nil, err
	}
	base.Target, base.Point, base.Method, base.Amount = a, point, defaultMethod(a.Kind), p.Amount
	base.Type, base.Category = typeOut, catExpense
	if p.Kind == "refund" {
		base.Type, base.Category = typeRefund, catRefund
	}
	if base.Receipt, err = checkReceipt(point.KktMode == kktManual, base.Type, pay.Receipt); err != nil {
		return nil, err
	}
	x, err := s.write(ctx, tx, tc, base)
	return []opRow{x}, err
}

// keyCursor is the keyset position after the last proposal of a page (the key is a text).
type keyCursor struct {
	At  time.Time `json:"t"`
	Key string    `json:"k"`
}

func encodeKeyCursor(at time.Time, key string) string {
	b, _ := json.Marshal(keyCursor{At: at.UTC(), Key: key}) // plain fields always marshal
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeKeyCursor(raw string) (keyCursor, error) {
	var c keyCursor
	b, err := base64.RawURLEncoding.DecodeString(raw)
	if err == nil {
		err = json.Unmarshal(b, &c)
	}
	if err != nil || !validProposalKey(c.Key) {
		return keyCursor{}, problem.New(problem.CodeMalformedRequest, "Курсор не подходит к запросу.")
	}
	return c, nil
}
