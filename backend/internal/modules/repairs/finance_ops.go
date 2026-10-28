package repairs

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// PayrollOffer is a proposal of a payout to the crew that the cash desks (W5.31) show to the cashier. The key is the key
// of idempotency of the proposal; nothing moves until the cashier posts it.
type PayrollOffer struct {
	Key         string
	Title       string
	AmountMinor int64
	SourceKind  string
	SourceID    uuid.UUID
	SourceLabel string
}

// PayrollOffers hands a payout to the proposals of the cash desks in the transaction of the payout: a failed hand
// over rolls the payout back.
type PayrollOffers interface {
	OfferPayroll(ctx context.Context, tx pgx.Tx, o PayrollOffer) error
}

// Texts of the finance, the crew and the subcontractors (the prototype: «Финансы», «Оплата бригады», «Подрядчики»).
const (
	textActSignWait    = "Начисление откроется после подписания акта заказчиком."
	textActNotFound    = "Акт не найден."
	textActNoAmount    = "У акта нет суммы: начислять не с чего."
	textNoCrew         = "В бригаде объекта нет работников."
	textPayoutPick     = "Отметьте начисления к выплате."
	textAccrualUnknown = "Начисления нет в организации."
	textPayoutState    = "К выплате принимаются только начисленные суммы."
	textNeedAccrue     = "Нужно право «Начислять оплату бригаде»."
	textNeedPay        = "Нужно право «Выплачивать бригаде»."
	textNeedSubs       = "Нужно право «Управлять подрядчиками»."
	textSubNotFound    = "Подрядчик не найден."
	textUntilRequired  = "Укажите срок доступа."
	textUntilPast      = "Срок доступа не может быть в прошлом."
	textPayoutLabel    = "Оплата бригады"

	evCrewAccrued   = "crew.accrued"
	evCrewPayout    = "crew.payout_proposed"
	evSubAccess     = "subcontractor.access_set"
	topicAccrued    = "repairs.crew_accrual.created.v1"
	topicPaid       = "repairs.crew_accrual.paid.v1"
	topicSubGranted = "repairs.subcontractor.access_granted.v1"
	topicSubRevoked = "repairs.subcontractor.access_revoked.v1"
	payoutSource    = "repair_payout"
)

// crewSharePct is the share of the sum of an act that goes to the crew (Q-W6.15-1).
func (s *Service) crewSharePct() int {
	if s.CrewSharePct > 0 {
		return s.CrewSharePct
	}
	return defaultCrewSharePct
}

// grow appends a zero element to the slice and returns a pointer to it: the way to fill the anonymous element types of
// the generated contract without naming them.
func grow[E any](s *[]E) *E {
	var zero E
	*s = append(*s, zero)
	return &(*s)[len(*s)-1]
}

// nonNil is a slice of the type of s that is not nil: a list of the contract is `[]`, not `null`.
func nonNil[E any](_ []E) []E { return []E{} }

// Documents answers listRepairDocuments: the documents of an object, the sums only for those who read the finance.
func (s *Service) Documents(ctx context.Context, tc tenantctx.TenantContext, project uuid.UUID) (rapi.RepairDocumentList, error) {
	out := rapi.RepairDocumentList{Items: []rapi.RepairDocument{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		p, err := r.visibleProject(ctx, project, false)
		if err != nil {
			return err
		}
		finance, err := r.can(ctx, p, actFinance)
		if err != nil {
			return err
		}
		return r.collect(ctx, "documents", `select `+docCols+` from repairs.documents where project_id = $1 order by created_at, id`, []any{p.id}, func(rows pgx.Rows) error {
			var d docRow
			if err := d.scan(rows); err != nil {
				return err
			}
			out.Items = append(out.Items, docOut(&d, finance))
			return nil
		})
	})
	return out, err
}

// ProjectFinance answers getProjectFinance. Received is the paid invoices; expenses are the materials issued to the
// object, the crew accrued and the paid part of the subcontractors; the plan of the margin is the contract less the
// materials, the whole crew (the pending too) and the contracts of the subcontractors (Q-W6.15-8).
func (s *Service) ProjectFinance(ctx context.Context, tc tenantctx.TenantContext, project uuid.UUID) (rapi.ProjectFinance, error) {
	var out rapi.ProjectFinance
	err := s.run(ctx, tc, false, func(r *req) error {
		p, err := r.visibleProject(ctx, project, false)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actFinance, textNeedFinance); err != nil {
			return err
		}
		out, err = r.projectFinance(ctx, p)
		return err
	})
	return out, err
}

// movement is a line of the movement of the money of an object (the kind and the signed sum).
type movement struct {
	at     time.Time
	kind   string
	text   string
	amount int64
}

// sums are what the finance of an object adds up: the sums of the kinds and the movements behind them.
type financeSums struct {
	received, supply, crewFact, crewAll, subPaid, subPlan int64
	moves                                                 []movement
}

func (r *req) projectFinance(ctx context.Context, p *projectRow) (rapi.ProjectFinance, error) {
	contract := int64(0)
	if p.budget != nil {
		contract = *p.budget
	}
	out := rapi.ProjectFinance{ProjectId: p.id, Contract: moneyOut(contract)}
	out.Movements = nonNil(out.Movements)
	var m financeSums
	for _, step := range []func(context.Context, uuid.UUID, *financeSums) error{r.paidInvoices, r.supplyCosts, r.crewCosts, r.subcontractorSums} {
		if err := step(ctx, p.id, &m); err != nil {
			return out, err
		}
	}
	if err := r.tx.QueryRow(ctx, `select max(version) from repairs.estimates where project_id = $1 and state = 'approved'`, p.id).Scan(&out.EstimateVersion); err != nil {
		return out, store("estimate version", err)
	}
	out.Received = moneyOut(m.received)
	out.Expenses = moneyOut(m.supply + m.crewFact + m.subPaid)
	out.MarginPlan = deltaOut(contract - m.supply - m.crewAll - m.subPlan)
	slices.SortStableFunc(m.moves, func(a, b movement) int { return b.at.Compare(a.at) })
	for _, mv := range m.moves {
		row := grow(&out.Movements)
		row.Amount, row.At, row.Kind, row.Text = deltaOut(mv.amount), mv.at, rapi.ProjectFinanceMovementsKind(mv.kind), mv.text
	}
	return out, nil
}

// collect runs a query and calls fn for each of its rows.
func (r *req) collect(ctx context.Context, what, sql string, args []any, fn func(pgx.Rows) error) error {
	rows, err := r.tx.Query(ctx, sql, args...)
	if err != nil {
		return store(what, err)
	}
	defer rows.Close()
	for rows.Next() {
		if err := fn(rows); err != nil {
			return store(what, err)
		}
	}
	return store(what, rows.Err())
}

func (r *req) paidInvoices(ctx context.Context, project uuid.UUID, m *financeSums) error {
	return r.collect(ctx, "received", `select title, amount_minor, coalesce(signed_at, sent_at, created_at) from repairs.documents
		where project_id = $1 and kind = 'invoice' and state = 'paid' and amount_minor is not null`, []any{project}, func(rows pgx.Rows) error {
		mv := movement{kind: moveCodePayment}
		if err := rows.Scan(&mv.text, &mv.amount, &mv.at); err != nil {
			return err
		}
		m.received += mv.amount
		m.moves = append(m.moves, mv)
		return nil
	})
}

func (r *req) supplyCosts(ctx context.Context, project uuid.UUID, m *financeSums) error {
	return r.collect(ctx, "supply expenses", `select number, cost_minor, updated_at from repairs.supply_requests
		where project_id = $1 and state in ('issued', 'bought', 'used') and cost_minor > 0`, []any{project}, func(rows pgx.Rows) error {
		var number string
		mv := movement{kind: moveCodeExpense}
		if err := rows.Scan(&number, &mv.amount, &mv.at); err != nil {
			return err
		}
		m.supply += mv.amount
		mv.text, mv.amount = "Материалы по заявке "+number, -mv.amount
		m.moves = append(m.moves, mv)
		return nil
	})
}

func (r *req) crewCosts(ctx context.Context, project uuid.UUID, m *financeSums) error {
	return r.collect(ctx, "crew expenses", `select w.display_name, a.amount_minor, a.state, a.created_at from repairs.crew_accruals a
		join repairs.workers w on w.id = a.worker_id where a.project_id = $1`, []any{project}, func(rows pgx.Rows) error {
		var (
			name, state string
			sum         int64
			at          time.Time
		)
		if err := rows.Scan(&name, &sum, &state, &at); err != nil {
			return err
		}
		m.crewAll += sum
		if state != accrualPending {
			m.crewFact += sum
			m.moves = append(m.moves, movement{at: at, kind: moveCodeAccrual, text: textPayoutLabel + ": " + name, amount: -sum})
		}
		return nil
	})
}

func (r *req) subcontractorSums(ctx context.Context, project uuid.UUID, m *financeSums) error {
	err := r.tx.QueryRow(ctx, `select coalesce(sum(paid_minor), 0)::bigint, coalesce(sum(contract_minor), 0)::bigint from repairs.subcontractors where project_id = $1`,
		project).Scan(&m.subPaid, &m.subPlan)
	return store("subcontractors", err)
}

// accrualCols are the columns of a crew accrual with the name and the trade of the worker.
const accrualCols = `a.id, a.project_id, a.worker_id, w.display_name, w.trade, a.amount_minor, a.state, a.self_employed, a.act_id, a.work`

func scanAccrual(row interface{ Scan(...any) error }) (rapi.CrewAccrual, error) {
	var (
		a   rapi.CrewAccrual
		sum int64
	)
	err := row.Scan(&a.Id, &a.ProjectId, &a.WorkerId, &a.WorkerName, &a.Role, &sum, &a.State, &a.SelfEmployed, &a.ActId, &a.Work)
	a.Amount = moneyOut(sum)
	return a, err
}

func (r *req) accruals(ctx context.Context, where string, args ...any) ([]rapi.CrewAccrual, error) {
	out := []rapi.CrewAccrual{}
	err := r.collect(ctx, "accruals", `select `+accrualCols+` from repairs.crew_accruals a join repairs.workers w on w.id = a.worker_id where `+where+
		` order by a.created_at, a.id`, args, func(rows pgx.Rows) error {
		a, err := scanAccrual(rows)
		out = append(out, a)
		return err
	})
	return out, err
}

// CrewAccruals answers listCrewAccruals.
func (s *Service) CrewAccruals(ctx context.Context, tc tenantctx.TenantContext, project uuid.UUID) (rapi.CrewAccrualList, error) {
	var out rapi.CrewAccrualList
	err := s.run(ctx, tc, false, func(r *req) error {
		p, err := r.visibleProject(ctx, project, false)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actFinance, textNeedFinance); err != nil {
			return err
		}
		out.Items, err = r.accruals(ctx, `a.project_id = $1`, p.id)
		return err
	})
	return out, err
}

// crewShare is what one worker of the object gets from the pool of an act.
type crewShare struct {
	id     uuid.UUID
	marks  int
	works  []string
	amount int64
}

// AccrueByAct answers accrueByAct: by a signed act of the client the crew of the object is accrued (Q-W6.15-1). The
// accruals of an act are made once: asking again returns them.
func (s *Service) AccrueByAct(ctx context.Context, tc tenantctx.TenantContext, act uuid.UUID) (rapi.CrewAccrualList, error) {
	var out rapi.CrewAccrualList
	err := s.run(ctx, tc, true, func(r *req) error {
		d, p, err := r.actToAccrue(ctx, act)
		if err != nil {
			return err
		}
		shares, err := r.crewShares(ctx, p.id, *d.amount, s.crewSharePct())
		if err != nil {
			return err
		}
		fresh := 0
		for _, c := range shares {
			ok, err := r.accrue(ctx, p.id, d.id, c)
			if err != nil {
				return err
			}
			if ok {
				fresh++
			}
		}
		if fresh > 0 {
			if err := r.event(ctx, p.id, evCrewAccrued, "начислена оплата бригаде по акту: "+truncate(d.title, 200)); err != nil {
				return err
			}
		}
		out.Items, err = r.accruals(ctx, `a.act_id = $1`, d.id)
		return err
	})
	return out, err
}

// actToAccrue reads and locks the act and its object and requires everything the accrual needs: the act of the object
// the member sees, his right, the signature of the client and a sum.
func (r *req) actToAccrue(ctx context.Context, act uuid.UUID) (*docRow, *projectRow, error) {
	d, err := r.document(ctx, act, true)
	if err != nil {
		return nil, nil, err
	}
	if d == nil || d.kind != docAct {
		return nil, nil, notFound(textActNotFound)
	}
	p, err := r.visibleProject(ctx, d.project, true)
	if err != nil {
		return nil, nil, err
	}
	if err := r.need(ctx, p, actCrewAccrue, textNeedAccrue); err != nil {
		return nil, nil, err
	}
	if d.state != stateSigned && d.state != statePaid {
		text := textActSignWait
		if d.act != nil {
			text = "Начисление откроется после подписания акта № " + strconv.Itoa(*d.act) + " заказчиком."
		}
		return nil, nil, conflict(reasonActNotSigned, text)
	}
	if d.amount == nil || *d.amount <= 0 {
		return nil, nil, invalid("documentId", textActNoAmount, "no_amount")
	}
	return d, p, nil
}

// accrue writes the accrual of a worker by the act once; false — it was there (or nothing is due).
func (r *req) accrue(ctx context.Context, project, act uuid.UUID, c crewShare) (bool, error) {
	if c.amount <= 0 {
		return false, nil
	}
	var id uuid.UUID
	err := r.tx.QueryRow(ctx, `insert into repairs.crew_accruals (project_id, worker_id, act_id, work, amount_minor, state, created_at, updated_at)
		values ($1, $2, $3, nullif($4, ''), $5, 'accrued', $6, $6) on conflict (act_id, worker_id) do nothing returning id`,
		project, c.id, act, truncate(strings.Join(c.works, ", "), 300), c.amount, r.now).Scan(&id)
	if noRows(err) {
		return false, nil
	}
	if err != nil {
		return false, store("accrue", err)
	}
	return true, r.publishProject(ctx, topicAccrued, project, map[string]any{"accrualId": id, "actId": act, "workerId": c.id, "amountMinor": c.amount})
}

// crewShares divides the pool of an act between the active crew of the object by their accepted marks.
func (r *req) crewShares(ctx context.Context, project uuid.UUID, amount int64, pct int) ([]crewShare, error) {
	pool, ok := crewPool(amount, pct)
	if !ok {
		return nil, invalid("documentId", textActNoAmount, "no_amount")
	}
	rows, err := r.tx.Query(ctx, `select id from repairs.workers where project_id = $1 and status = 'active' order by created_at, id`, project)
	if err != nil {
		return nil, store("crew", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, store("crew", err)
	}
	if len(ids) == 0 {
		return nil, invalid("documentId", textNoCrew, "no_crew")
	}
	shares := make([]crewShare, len(ids))
	at := map[uuid.UUID]int{}
	for i, id := range ids {
		shares[i].id, at[id] = id, i
	}
	if err := r.countMarks(ctx, project, shares, at); err != nil {
		return nil, err
	}
	weights := make([]int, len(shares))
	for i := range shares {
		weights[i] = shares[i].marks
		slices.Sort(shares[i].works)
	}
	for i, a := range splitPool(pool, weights) {
		shares[i].amount = a
	}
	return shares, nil
}

// countMarks counts the accepted marks of each worker of the crew and collects the works they were on.
func (r *req) countMarks(ctx context.Context, project uuid.UUID, shares []crewShare, at map[uuid.UUID]int) error {
	return r.collect(ctx, "marks of the crew", `select g.crew_worker_ids, coalesce(array_agg(distinct wk.name) filter (where wk.name is not null), '{}')
		from repairs.work_logs g left join repairs.work_log_lines l on l.work_log_id = g.id left join repairs.works wk on wk.id = l.work_id
		where g.project_id = $1 and g.status = 'accepted' group by g.id, g.crew_worker_ids`, []any{project}, func(rows pgx.Rows) error {
		var (
			crew  []uuid.UUID
			works []string
		)
		if err := rows.Scan(&crew, &works); err != nil {
			return err
		}
		for _, w := range crew {
			if i, ok := at[w]; ok {
				shares[i].marks++
				shares[i].works = appendNew(shares[i].works, works)
			}
		}
		return nil
	})
}

// appendNew adds to dst the names it does not hold yet.
func appendNew(dst, names []string) []string {
	for _, name := range names {
		if !slices.Contains(dst, name) {
			dst = append(dst, name)
		}
	}
	return dst
}

// payItem is an accrual asked for payout.
type payItem struct {
	project uuid.UUID
	state   string
	amount  int64
}

// PayoutAccruals answers payoutAccruals: the accrued items go to the cash desks as one proposal of a payment; the
// cashier posts it (Q-W4.00-repair-12, no integration with «Мой налог»).
func (s *Service) PayoutAccruals(ctx context.Context, tc tenantctx.TenantContext, asked []uuid.UUID) (rapi.PayoutResult, error) {
	var out rapi.PayoutResult
	err := s.run(ctx, tc, true, func(r *req) error {
		ids := uniqueIDs(asked)
		if len(ids) == 0 {
			return invalid("accrualIds", textPayoutPick, "required")
		}
		found, err := r.payItems(ctx, ids)
		if err != nil {
			return err
		}
		total, projects, err := payTotals(ids, found)
		if err != nil {
			return err
		}
		names, err := r.payoutAccess(ctx, projects)
		if err != nil {
			return err
		}
		for _, id := range ids {
			if found[id].state != accrualAccrued {
				return conflict("", textPayoutState)
			}
		}
		proposal, err := s.propose(ctx, r, ids, total, names)
		if err != nil {
			return err
		}
		for _, pid := range projects {
			if err := r.event(ctx, pid, evCrewPayout, "выплата бригаде отправлена в кассу на проведение"); err != nil {
				return err
			}
		}
		out.ProposalId = proposal
		out.Accruals, err = r.accruals(ctx, `a.cash_proposal_id = $1`, proposal)
		return err
	})
	return out, err
}

// payTotals is the sum of the accruals asked and the objects they are of; an id the organization does not have is a 422
// on its place in the request.
func payTotals(ids []uuid.UUID, found map[uuid.UUID]payItem) (int64, []uuid.UUID, error) {
	var total int64
	var projects []uuid.UUID
	for i, id := range ids {
		it, ok := found[id]
		if !ok {
			return 0, nil, invalid("accrualIds["+strconv.Itoa(i)+"]", textAccrualUnknown, "unknown")
		}
		total += it.amount
		if !slices.Contains(projects, it.project) {
			projects = append(projects, it.project)
		}
	}
	if total <= 0 {
		return 0, nil, invalid("accrualIds", textPayoutPick, "required")
	}
	return total, projects, nil
}

// payItems reads and locks the accruals asked for payout.
func (r *req) payItems(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]payItem, error) {
	found := map[uuid.UUID]payItem{}
	err := r.collect(ctx, "accruals to pay", `select id, project_id, state, amount_minor from repairs.crew_accruals where id = any($1) order by id for update`,
		[]any{ids}, func(rows pgx.Rows) error {
			var (
				id uuid.UUID
				it payItem
			)
			if err := rows.Scan(&id, &it.project, &it.state, &it.amount); err != nil {
				return err
			}
			found[id] = it
			return nil
		})
	return found, err
}

// payoutAccess requires the right to pay on each object of the accruals (a hidden object is 404) and returns the names.
func (r *req) payoutAccess(ctx context.Context, projects []uuid.UUID) ([]string, error) {
	names := make([]string, 0, len(projects))
	for _, pid := range projects {
		p, err := r.visibleProject(ctx, pid, true)
		if err != nil {
			return nil, err
		}
		if err := r.need(ctx, p, actCrewPay, textNeedPay); err != nil {
			return nil, err
		}
		names = append(names, p.name)
	}
	return names, nil
}

// propose hands the payout to the cash desks and marks the accruals proposed.
func (s *Service) propose(ctx context.Context, r *req, ids []uuid.UUID, total int64, names []string) (uuid.UUID, error) {
	if s.Offers == nil {
		return uuid.Nil, problem.New(problem.CodeDependencyUnavailable, "")
	}
	proposal := uuid.New()
	if err := s.Offers.OfferPayroll(ctx, r.tx, PayrollOffer{Key: "payroll:" + proposal.String(), Title: payoutTitle(len(ids), total), AmountMinor: total,
		SourceKind: payoutSource, SourceID: proposal, SourceLabel: truncate(strings.Join(names, ", "), 200)}); err != nil {
		return uuid.Nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if _, err := r.tx.Exec(ctx, `update repairs.crew_accruals set state = 'proposed', cash_proposal_id = $2, updated_at = $3 where id = any($1)`, ids, proposal, r.now); err != nil {
		return uuid.Nil, store("propose accruals", err)
	}
	return proposal, nil
}

// MarkPaid is the posting of the proposal of a payout by the cashier: its accruals become paid (once; the second call
// finds nothing). The consumer of the event of the cash desks calls it for the tenant of the proposal.
func (s *Service) MarkPaid(ctx context.Context, tenantID, proposal uuid.UUID) (int, error) {
	var n int
	err := s.run(ctx, tenantctx.TenantContext{TenantID: tenantID}, true, func(r *req) error {
		type paid struct {
			id, project, worker uuid.UUID
			amount              int64
		}
		var done []paid
		if err := r.collect(ctx, "mark paid", `update repairs.crew_accruals set state = 'paid', updated_at = $2 where cash_proposal_id = $1 and state = 'proposed'
			returning id, project_id, worker_id, amount_minor`, []any{proposal, r.now}, func(rows pgx.Rows) error {
			var p paid
			if err := rows.Scan(&p.id, &p.project, &p.worker, &p.amount); err != nil {
				return err
			}
			done = append(done, p)
			return nil
		}); err != nil {
			return err
		}
		for _, p := range done {
			if err := r.publishProject(ctx, topicPaid, p.project, map[string]any{"accrualId": p.id, "workerId": p.worker, "amountMinor": p.amount, "proposalId": proposal}); err != nil {
				return err
			}
		}
		n = len(done)
		return nil
	})
	return n, err
}

// subCols are the columns of a subcontractor.
const subCols = `id, name, scope, active, member_id, access_until, contract_minor, paid_minor`

func scanSub(row interface{ Scan(...any) error }) (rapi.Subcontractor, error) {
	var (
		s              rapi.Subcontractor
		until          *time.Time
		contract, paid *int64
	)
	if err := row.Scan(&s.Id, &s.Name, &s.Scope, &s.Active, &s.MemberId, &until, &contract, &paid); err != nil {
		return s, err
	}
	if until != nil {
		alloc(&s.AccessUntil).Time = *until
	}
	if contract != nil {
		s.Contract = new(moneyOut(*contract))
	}
	if paid != nil {
		s.Paid = new(moneyOut(*paid))
	}
	return s, nil
}

// Subcontractors answers listSubcontractors.
func (s *Service) Subcontractors(ctx context.Context, tc tenantctx.TenantContext, project uuid.UUID) (rapi.SubcontractorList, error) {
	out := rapi.SubcontractorList{Items: []rapi.Subcontractor{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		p, err := r.visibleProject(ctx, project, false)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actSubs, textNeedSubs); err != nil {
			return err
		}
		return r.collect(ctx, "subcontractors", `select `+subCols+` from repairs.subcontractors where project_id = $1 order by created_at, id`, []any{p.id}, func(rows pgx.Rows) error {
			sub, err := scanSub(rows)
			out.Items = append(out.Items, sub)
			return err
		})
	})
	return out, err
}

// SetSubcontractorAccess answers setSubcontractorAccess: the access to one object until a date, or closed. The role
// «Подрядчик» of the member is issued by the consumer of the event of the bus (Q-W6.15-4).
func (s *Service) SetSubcontractorAccess(ctx context.Context, tc tenantctx.TenantContext, project, id uuid.UUID, b rapi.SubcontractorAccessSet) (rapi.Subcontractor, error) {
	var out rapi.Subcontractor
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.visibleProject(ctx, project, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actSubs, textNeedSubs); err != nil {
			return err
		}
		if p.status == statusHandedOver {
			return conflict(reasonHandedOver, textHandedOverEdit)
		}
		sub, err := scanSub(r.tx.QueryRow(ctx, `select `+subCols+` from repairs.subcontractors where id = $1 and project_id = $2 for update`, id, p.id))
		if noRows(err) {
			return notFound(textSubNotFound)
		}
		if err != nil {
			return store("subcontractor", err)
		}
		if err := r.setAccess(ctx, p.id, sub, b); err != nil {
			return err
		}
		out, err = scanSub(r.tx.QueryRow(ctx, `select `+subCols+` from repairs.subcontractors where id = $1`, id))
		return store("subcontractor", err)
	})
	return out, err
}

// setAccess opens the access until a date (required, not in the past) or closes it, then writes the event of the bus and
// the line of the feed.
func (r *req) setAccess(ctx context.Context, project uuid.UUID, sub rapi.Subcontractor, b rapi.SubcontractorAccessSet) error {
	topic, text := topicSubRevoked, "доступ подрядчика закрыт: "+sub.Name
	payload := map[string]any{"subcontractorId": sub.Id, "memberId": sub.MemberId}
	if b.Active {
		if b.Until == nil {
			return invalid("until", textUntilRequired, "required")
		}
		if b.Until.Before(r.now.Truncate(24 * time.Hour)) {
			return invalid("until", textUntilPast, "past")
		}
		topic, text = topicSubGranted, "доступ подрядчика открыт до "+b.Until.Format("02.01.2006")+": "+sub.Name
		payload["until"] = b.Until.Format(time.DateOnly)
		if _, err := r.tx.Exec(ctx, `update repairs.subcontractors set active = true, access_until = $2::date where id = $1`, sub.Id, b.Until.Time); err != nil {
			return store("open access", err)
		}
	} else if _, err := r.tx.Exec(ctx, `update repairs.subcontractors set active = false where id = $1`, sub.Id); err != nil {
		return store("close access", err)
	}
	if err := r.publishProject(ctx, topic, project, payload); err != nil {
		return err
	}
	return r.event(ctx, project, evSubAccess, truncate(text, 300))
}

// uniqueIDs drops the repeats and keeps the order the client asked in (the index of a refusal names its place).
func uniqueIDs(ids []uuid.UUID) []uuid.UUID {
	seen := make(map[uuid.UUID]bool, len(ids))
	out := make([]uuid.UUID, 0, len(ids))
	for _, id := range ids {
		if !seen[id] {
			seen[id] = true
			out = append(out, id)
		}
	}
	return out
}
