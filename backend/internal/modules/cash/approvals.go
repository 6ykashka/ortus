package cash

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// payload is the request an approval request runs in the name of its author when it is approved (tenant 0042
// cash.approval_requests.payload): a manual operation, a proposal to post or an advance to issue.
type payload struct {
	SourceKey string                       `json:"sourceKey,omitempty"`
	Op        *cashapi.CashOperationCreate `json:"op,omitempty"`
	Proposal  *proposalPay                 `json:"proposal,omitempty"`
	Issue     *issuePay                    `json:"issue,omitempty"`
}

type proposalPay struct {
	Key       string                         `json:"key"`
	AccountID uuid.UUID                      `json:"accountId"`
	Basis     *string                        `json:"basis,omitempty"`
	Parts     []cashapi.CashProposalPostPart `json:"parts"`
	Receipt   *cashapi.CashReceipt           `json:"receipt,omitempty"`
}

type issuePay struct {
	SourceAccountID uuid.UUID `json:"sourceAccountId"`
	Due             string    `json:"due"`
	Note            *string   `json:"note,omitempty"`
	Holder          string    `json:"holder"`
}

// requestSpec is an approval request to record.
type requestSpec struct {
	Type       string
	Amount     int64
	Method     *string
	CategoryID *string
	Basis      string
	Source     *srcRef
	Limit      int64
	Payload    payload
}

// request records the approval request of a command above the limit of the role of its author and tells those who may
// approve it (the event `cash.approval.requested.v1`).
func (s *Service) request(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, a account, sp requestSpec) (cashapi.CashApprovalRequest, error) {
	if sp.Source != nil {
		sp.Payload.SourceKey = sp.Source.Key
	}
	raw, err := json.Marshal(sp.Payload)
	if err != nil {
		return cashapi.CashApprovalRequest{}, fmt.Errorf("cash: payload: %w", err)
	}
	var skind *string
	var sid *uuid.UUID
	var slabel *string
	if sp.Source != nil {
		skind, sid, slabel = &sp.Source.Kind, &sp.Source.ID, sp.Source.Label
	}
	var id uuid.UUID
	if err := tx.QueryRow(ctx, `insert into cash.approval_requests (account_id, type, amount_minor, currency, method, category_id, basis,
	        source_kind, source_id, source_label, payload, limit_minor, requested_by, requested_at)
	      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) returning id`,
		a.ID, sp.Type, sp.Amount, a.Currency, sp.Method, sp.CategoryID, sp.Basis, skind, sid, slabel, raw, sp.Limit, tc.PersonID,
		s.now()).Scan(&id); err != nil {
		return cashapi.CashApprovalRequest{}, fmt.Errorf("cash: insert request: %w", err)
	}
	r, err := readRequest(ctx, tx, id, false)
	if err != nil {
		return cashapi.CashApprovalRequest{}, err
	}
	if err := record(ctx, tx, tc, "cash.approval.request", targetApproval, id, a.Unit, "", map[string]any{
		"type": sp.Type, keyAmount: sp.Amount, keyCurrency: a.Currency, keyAccount: a.ID, "limitMinor": sp.Limit}); err != nil {
		return cashapi.CashApprovalRequest{}, err
	}
	err = publish(ctx, tx, "cash.approval.requested.v1", targetApproval, id, map[string]any{keyRequest: id, keyAccount: a.ID,
		"type": sp.Type, keyAmount: sp.Amount, keyCurrency: a.Currency, keyUnit: a.Unit, "requestedByMemberId": tc.PersonID})
	return r.dto(), err
}

// requestRow is a row of cash.approval_requests.
type requestRow struct {
	ID, Account uuid.UUID
	Type        string
	Amount      int64
	Currency    string
	Method      *string
	Basis       *string
	CategoryID  *string
	SourceKind  *string
	SourceID    *uuid.UUID
	SourceLabel *string
	Payload     payload
	Limit       *int64
	Status      string
	RequestedBy uuid.UUID
	RequestedAt time.Time
	DecidedBy   *uuid.UUID
	DecidedAt   *time.Time
	Reason      *string
	Operation   *uuid.UUID
	Transfer    *uuid.UUID
	Revision    int64
}

const requestCols = `r.id, r.account_id, r.type, r.amount_minor, r.currency, r.method, r.basis, r.category_id, r.source_kind, r.source_id,
       r.source_label, r.payload, r.limit_minor, r.status, r.requested_by, r.requested_at, r.decided_by, r.decided_at, r.reason,
       r.operation_id, r.transfer_id, r.revision`

func scanRequest(row pgx.Row) (requestRow, error) {
	var (
		r   requestRow
		raw []byte
	)
	err := row.Scan(&r.ID, &r.Account, &r.Type, &r.Amount, &r.Currency, &r.Method, &r.Basis, &r.CategoryID, &r.SourceKind, &r.SourceID,
		&r.SourceLabel, &raw, &r.Limit, &r.Status, &r.RequestedBy, &r.RequestedAt, &r.DecidedBy, &r.DecidedAt, &r.Reason, &r.Operation,
		&r.Transfer, &r.Revision)
	if err != nil {
		return requestRow{}, err
	}
	r.Currency = trimCurrency(r.Currency)
	if err := json.Unmarshal(raw, &r.Payload); err != nil {
		return requestRow{}, fmt.Errorf("payload: %w", err)
	}
	return r, nil
}

func readRequest(ctx context.Context, q Querier, id uuid.UUID, lock bool) (requestRow, error) {
	sql := `select ` + requestCols + ` from cash.approval_requests r where r.id = $1`
	if lock {
		sql += lockUpdate
	}
	r, err := scanRequest(q.QueryRow(ctx, sql, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return requestRow{}, problem.New(problem.CodeNotFound, "Заявка не найдена")
	}
	if err != nil {
		return requestRow{}, fmt.Errorf("cash: request: %w", err)
	}
	return r, nil
}

func (r requestRow) dto() cashapi.CashApprovalRequest {
	out := cashapi.CashApprovalRequest{Id: r.ID, AccountId: r.Account, Amount: moneyOf(r.Amount, r.Currency), Basis: r.Basis,
		CategoryId: r.CategoryID, Limit: moneyPtr(r.Limit, r.Currency), OperationId: r.Operation, Reason: r.Reason,
		RequestedAt: r.RequestedAt.UTC(), RequestedByMemberId: r.RequestedBy, Revision: r.Revision,
		Status: cashapi.CashApprovalRequestStatus(r.Status), TransferId: r.Transfer, Type: cashapi.CashApprovalRequestType(r.Type),
		DecidedByMemberId: r.DecidedBy}
	if r.Method != nil {
		m := cashapi.CashApprovalRequestMethod(*r.Method)
		out.Method = &m
	}
	if r.DecidedAt != nil {
		d := r.DecidedAt.UTC()
		out.DecidedAt = &d
	}
	if r.SourceKind != nil && r.SourceID != nil && r.Payload.SourceKey != "" {
		out.Source = &cashapi.CashSourceRef{Key: r.Payload.SourceKey, Kind: *r.SourceKind, Id: *r.SourceID, Label: r.SourceLabel}
	}
	return out
}

// RequestsQuery filters the list of approval requests.
type RequestsQuery struct {
	PageQuery
	Status string
}

// ListRequests returns the approval requests of the accounts the actor sees, newest first (listCashApprovalRequests).
func (s *Service) ListRequests(ctx context.Context, tc tenantctx.TenantContext, q RequestsQuery) (cashapi.CashApprovalRequestPage, error) {
	limit, at, after, err := q.page()
	if err != nil {
		return cashapi.CashApprovalRequestPage{}, err
	}
	var out cashapi.CashApprovalRequestPage
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		pred, err := s.visibleSQL(ctx, s.evaluator(tx), tc, "a", 4, false)
		if err != nil {
			return err
		}
		args := append([]any{nilStr(q.Status), at, after, limit + 1}, pred.Args...)
		rows, err := tx.Query(ctx, `select `+requestCols+` from cash.approval_requests r join cash.accounts a on a.id = r.account_id
		 where ($1::text is null or r.status = $1)
		   and ($2::timestamptz is null or (r.requested_at, r.id) < ($2::timestamptz, $3::uuid))
		   and `+pred.SQL+` order by r.requested_at desc, r.id desc limit $4`, args...)
		if err != nil {
			return fmt.Errorf("cash: requests: %w", err)
		}
		list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (requestRow, error) { return scanRequest(r) })
		if err != nil {
			return fmt.Errorf("cash: requests: %w", err)
		}
		out = cashapi.CashApprovalRequestPage{Items: []cashapi.CashApprovalRequest{}}
		for i, r := range list {
			if i == limit {
				next := encodeCursor(list[limit-1].RequestedAt, list[limit-1].ID)
				out.NextCursor = &next
				break
			}
			out.Items = append(out.Items, r.dto())
		}
		return nil
	})
	return out, err
}

// DecideRequest approves or rejects an approval request (decideCashApprovalRequest): cash.approve over the account and
// not the author. Approval runs the request in the name of its author with the mark of the approver; the balance and the
// shift are checked again, so a request that cannot be paid any more is 409 and stays pending.
func (s *Service) DecideRequest(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, d Decision) (cashapi.CashApprovalRequest, error) { //nolint:dupl // the decision protocol of a receipt, a request and a transfer has one shape: revision, state, not the author
	var reason string
	if !d.Accept {
		r, err := reasonOf(d.Reason, "Укажите причину отказа")
		if err != nil {
			return cashapi.CashApprovalRequest{}, err
		}
		reason = r
	}
	var out cashapi.CashApprovalRequest
	err := s.inTx(ctx, tc, func(tx pgx.Tx) error {
		var err error
		if out, err = s.decideRequestTx(ctx, tx, tc, id, ifMatch, d.Accept, reason); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

func (s *Service) decideRequestTx(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, accept bool, reason string) (cashapi.CashApprovalRequest, error) {
	r, err := readRequest(ctx, tx, id, true)
	if err != nil {
		return cashapi.CashApprovalRequest{}, err
	}
	a, err := loadAccount(ctx, tx, r.Account)
	if err != nil {
		return cashapi.CashApprovalRequest{}, err
	}
	if err := s.permit(ctx, s.evaluator(tx), tc, a, actionApprove); err != nil {
		return cashapi.CashApprovalRequest{}, err
	}
	if err := checkRevision(ifMatch, r.Revision); err != nil {
		return cashapi.CashApprovalRequest{}, err
	}
	switch {
	case r.Status != statusPending:
		return cashapi.CashApprovalRequest{}, problem.New(codeInvalidTransition, "Заявка уже решена")
	case r.RequestedBy == tc.PersonID:
		return cashapi.CashApprovalRequest{}, problem.New(codeSelfApproval, "Свою заявку согласует другой сотрудник")
	}
	status, rsn := statusApproved, (*string)(nil)
	var op, tr *uuid.UUID
	if accept {
		if op, tr, err = s.runApproved(ctx, tx, tc, r, a); err != nil {
			return cashapi.CashApprovalRequest{}, err
		}
	} else {
		status, rsn = statusRejected, &reason
	}
	if _, err := tx.Exec(ctx, `update cash.approval_requests set status = $2, decided_by = $3, decided_at = $4, reason = $5,
	   operation_id = $6, transfer_id = $7, revision = revision + 1 where id = $1`, id, status, tc.PersonID, s.now(), rsn, op, tr); err != nil {
		return cashapi.CashApprovalRequest{}, fmt.Errorf("cash: request: %w", err)
	}
	nr, err := readRequest(ctx, tx, id, false)
	if err != nil {
		return cashapi.CashApprovalRequest{}, err
	}
	if err := record(ctx, tx, tc, "cash.approval.decide", targetApproval, id, a.Unit, reason, map[string]any{keyStatus: status}); err != nil {
		return cashapi.CashApprovalRequest{}, err
	}
	err = publish(ctx, tx, "cash.approval.decided.v1", targetApproval, id, map[string]any{keyRequest: id, keyStatus: status,
		"requestedByMemberId": r.RequestedBy, keyAmount: r.Amount, keyCurrency: r.Currency})
	return nr.dto(), err
}

// runApproved runs an approved request in the name of its author, approved by the actor.
func (s *Service) runApproved(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, r requestRow, a account) (op, tr *uuid.UUID, err error) {
	me := tc.PersonID
	switch {
	case r.Payload.Op != nil:
		m, err := s.validateManual(r.Payload.Op)
		if err != nil {
			return nil, nil, err
		}
		sp, err := s.resolve(ctx, tx, a, m, r.RequestedBy)
		if err != nil {
			return nil, nil, err
		}
		sp.ApprovedBy = &me
		x, err := s.write(ctx, tx, tc, sp)
		if err != nil {
			return nil, nil, err
		}
		return &x.Id, nil, nil
	case r.Payload.Proposal != nil:
		pp := r.Payload.Proposal
		p, err := loadProposal(ctx, tx, pp.Key, true)
		if err != nil {
			return nil, nil, err
		}
		if p.Status != "open" {
			return nil, nil, problem.New(codeInvalidTransition, "Предложение уже проведено, отклонено или недоступно")
		}
		ops, err := s.postProposal(ctx, tx, tc, p, a, *pp, r.RequestedBy, &me)
		if err != nil {
			return nil, nil, err
		}
		return &ops[0].Id, nil, nil
	case r.Payload.Issue != nil:
		ip := r.Payload.Issue
		from, err := loadAccount(ctx, tx, ip.SourceAccountID)
		if err != nil {
			return nil, nil, err
		}
		if err := checkAdvanceRoom(a, r.Amount); err != nil {
			return nil, nil, err
		}
		t, err := s.newTransfer(ctx, tx, tc, from, a, r.Amount, issueNote(ip.Holder, ip.Due), purposeIssue, r.RequestedBy, nil)
		if err != nil {
			return nil, nil, err
		}
		return nil, &t.ID, nil
	}
	return nil, nil, problem.New(codeInvalidTransition, "Заявка не содержит действия")
}
