//go:build integration

package repairs

import (
	"testing"
	"time"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

// actDoc writes an act of an object (the acts are written by the seeds and the later steps, not by an operation of the tag).
func actDoc(t *testing.T, projectID uuid.UUID, state string, amount *int64) uuid.UUID {
	t.Helper()
	id := uuid.New()
	var signed, hash, expires any
	switch state {
	case "signed", "paid":
		signed = clock()
	case "sms":
		hash, expires = signHash([]byte("key-of-the-suites"), id, "111111"), clock().Add(10*time.Minute)
	}
	if _, err := superA.Exec(t.Context(), `insert into repairs.documents (id, project_id, kind, title, state, act_no, amount_minor, signed_at, sign_code_hash, sign_code_expires_at)
		values ($1, $2, 'act', 'Акт № 1', $3, 1, $4, $5, $6, $7)`, id, projectID, state, amount, signed, hash, expires); err != nil {
		t.Fatal(err)
	}
	return id
}

// invoiceDoc writes an invoice of an object.
func invoiceDoc(t *testing.T, projectID uuid.UUID, state string, amount int64) {
	t.Helper()
	var signed any
	if state == "paid" {
		signed = clock()
	}
	if _, err := superA.Exec(t.Context(), `insert into repairs.documents (project_id, kind, title, state, amount_minor, signed_at, sent_at)
		values ($1, 'invoice', 'Счёт на аванс', $2, $3, $4, $5)`, projectID, state, amount, signed, clock()); err != nil {
		t.Fatal(err)
	}
}

// acceptedMark writes an accepted mark of the crew on a work of the object.
func acceptedMark(t *testing.T, projectID, workID uuid.UUID, crewIDs ...uuid.UUID) {
	t.Helper()
	id := uuid.New()
	if _, err := superA.Exec(t.Context(), `insert into repairs.work_logs (id, number, project_id, submitted_by, work_date, time_zone, status, crew_worker_ids,
		evidence_file_ids, reviewed_by, reviewed_at) values ($1, $2, $3, $4, '2026-10-12', 'Europe/Moscow', 'accepted', $5, $6, $4, now())`,
		id, "T-"+id.String()[:8], projectID, person("a.owner"), crewIDs, []uuid.UUID{photos[0]}); err != nil {
		t.Fatal(err)
	}
	if _, err := superA.Exec(t.Context(), `insert into repairs.work_log_lines (work_log_id, line_no, work_id, quantity, unit) values ($1, 1, $2, 5, 'm2')`, id, workID); err != nil {
		t.Fatal(err)
	}
}

func rubles(v int64) *int64 { return new(v) }

func TestListRepairDocuments(t *testing.T) {
	t.Parallel()
	ctx, s := t.Context(), service()
	id := project(t, "Документы/объект", seedOpts{})
	actDoc(t, id, "signed", rubles(500_000))
	invoiceDoc(t, id, "paid", 300_000)

	got := must(s.Documents(ctx, as(t, "a.region-msk"), id)).of(t)
	if len(got.Items) != 2 {
		t.Fatalf("documents: %+v", got)
	}
	for _, d := range got.Items {
		if d.Amount == nil || d.ProjectId != id {
			t.Errorf("the office reads the amount of %+v", d)
		}
	}
	// without repairs.finance.read the amounts are not given
	desk := must(s.Documents(ctx, as(t, "ab.member"), id)).of(t)
	if len(desk.Items) != 2 || desk.Items[0].Amount != nil || desk.Items[1].Amount != nil {
		t.Errorf("the desk without finance: %+v", desk)
	}
	// the foreman of another object and a missing object are as if absent
	_, err := s.Documents(ctx, as(t, "a.manager-msk1"), id)
	wantCode(t, err, "not_found", "")
	_, err = s.Documents(ctx, as(t, "a.region-msk"), uuid.New())
	wantCode(t, err, "not_found", "")
}

func TestProjectFinance(t *testing.T) { //nolint:gocyclo // one operation: the sums, the movements and each refusal in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Финансы/объект", seedOpts{})
	if _, err := superA.Exec(ctx, `update repairs.projects set budget_minor = 1000000 where id = $1`, id); err != nil {
		t.Fatal(err)
	}
	invoiceDoc(t, id, "paid", 300_000)
	invoiceDoc(t, id, "wait", 200_000) // not paid yet: not received
	price := catalogItem(t, "Финансы/материал", "piece", "material", 60_000)
	if _, err := superA.Exec(ctx, `insert into repairs.supply_requests (number, project_id, price_item_id, quantity, need_by, state, cost_minor, warehouse_id, created_by)
		values ($1, $2, $3, 2, '2999-01-01', 'issued', 120000, gen_random_uuid(), $4), ($5, $2, $3, 1, '2999-01-01', 'request', null, null::uuid, $4)`,
		"З-F"+uuid.NewString()[:6], id, price, person("a.owner"), "З-G"+uuid.NewString()[:6]); err != nil {
		t.Fatal(err)
	}
	w := crew(t, id, "Иван Петров")
	if _, err := superA.Exec(ctx, `insert into repairs.crew_accruals (project_id, worker_id, act_id, amount_minor, state)
		values ($1, $2, $3, 50000, 'accrued')`, id, w, actDoc(t, id, "signed", rubles(500_000))); err != nil {
		t.Fatal(err)
	}
	if _, err := superA.Exec(ctx, `insert into repairs.subcontractors (project_id, name, scope, contract_minor, paid_minor) values ($1, 'ООО Электрик', 'Электрика', 80000, 20000)`, id); err != nil {
		t.Fatal(err)
	}

	got := must(s.ProjectFinance(ctx, office, id)).of(t)
	if got.ProjectId != id || got.Contract.AmountMinor != 1_000_000 || got.Received.AmountMinor != 300_000 {
		t.Fatalf("finance: %+v", got)
	}
	// expenses: the materials issued (120 000), the crew accrued (50 000), the subcontractors paid (20 000)
	if got.Expenses.AmountMinor != 190_000 {
		t.Errorf("expenses %d, want 190000", got.Expenses.AmountMinor)
	}
	// the plan of the margin: the contract less the materials, the whole crew and the contracts of the subcontractors
	if got.MarginPlan.AmountMinor != 1_000_000-120_000-50_000-80_000 {
		t.Errorf("margin plan %d", got.MarginPlan.AmountMinor)
	}
	kinds := map[string]int64{}
	for _, m := range got.Movements {
		kinds[string(m.Kind)] += m.Amount.AmountMinor
	}
	if len(got.Movements) != 3 || kinds["payment"] != 300_000 || kinds["expense"] != -120_000 || kinds["accrual"] != -50_000 {
		t.Errorf("movements: %+v", got.Movements)
	}
	for i := 1; i < len(got.Movements); i++ {
		if got.Movements[i].At.After(got.Movements[i-1].At) {
			t.Errorf("movements are not newest first: %+v", got.Movements)
		}
	}

	// the right: without finance.read - 403; the foreman, the desk; a missing object - 404
	_, err := s.ProjectFinance(ctx, as(t, "ab.member"), id)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.ProjectFinance(ctx, office, uuid.New())
	wantCode(t, err, "not_found", "")
	_, err = s.ProjectFinance(ctx, as(t, "a.manager-msk1"), id)
	wantCode(t, err, "not_found", "")

	// an object without data: zeroes, not an error
	empty := project(t, "Финансы/пусто", seedOpts{})
	z := must(s.ProjectFinance(ctx, office, empty)).of(t)
	if z.Contract.AmountMinor != 0 || z.Received.AmountMinor != 0 || z.Expenses.AmountMinor != 0 || len(z.Movements) != 0 {
		t.Errorf("empty object: %+v", z)
	}
}

func TestAccrueByAct(t *testing.T) { //nolint:gocyclo // one operation: its successes and each refusal in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Начисление/объект", seedOpts{})
	ivan, anna := crew(t, id, "Иван Петров"), crew(t, id, "Анна Сидорова")
	paint := work(t, id, "Покраска стен", "m2", "50", "10")
	floor := work(t, id, "Стяжка пола", "m2", "20", "5")
	acceptedMark(t, id, paint, ivan, anna)
	acceptedMark(t, id, floor, ivan)
	act := actDoc(t, id, "signed", rubles(1_000_000))

	got := must(s.AccrueByAct(ctx, office, act)).of(t)
	if len(got.Items) != 2 {
		t.Fatalf("accruals: %+v", got)
	}
	// 40 % of 1 000 000 = 400 000 by the marks: Иван 2 of 3, Анна 1 of 3, the kopeck to the first
	byName := map[string]rapi.CrewAccrual{}
	for _, a := range got.Items {
		byName[a.WorkerName] = a
		if a.State != rapi.CrewAccrualStateAccrued || a.ActId == nil || *a.ActId != act || a.ProjectId != id || a.Role != "Маляр" {
			t.Errorf("accrual: %+v", a)
		}
	}
	if byName["Иван Петров"].Amount.AmountMinor != 266_667 || byName["Анна Сидорова"].Amount.AmountMinor != 133_333 {
		t.Errorf("amounts: %+v", got.Items)
	}
	if w := byName["Иван Петров"].Work; w == nil || (*w != "Покраска стен, Стяжка пола" && *w != "Стяжка пола, Покраска стен") {
		t.Errorf("the works of the worker: %v", w)
	}
	if n := count(t, `select count(*) from outbox.events where type = 'repairs.crew_accrual.created.v1' and aggregate_id = $1`, id); n != 2 {
		t.Errorf("events %d, want 2", n)
	}
	if n := count(t, `select count(*) from repairs.project_events where project_id = $1 and kind = 'crew.accrued'`, id); n != 1 {
		t.Errorf("feed rows %d, want 1", n)
	}

	// the same act again: the same accruals, nothing is doubled
	again := must(s.AccrueByAct(ctx, office, act)).of(t)
	if len(again.Items) != 2 || count(t, `select count(*) from repairs.crew_accruals where act_id = $1`, act) != 2 {
		t.Errorf("repeat: %+v", again)
	}
	if n := count(t, `select count(*) from outbox.events where type = 'repairs.crew_accrual.created.v1' and aggregate_id = $1`, id); n != 2 {
		t.Errorf("events after the repeat %d, want 2", n)
	}

	// the list of the object
	list := must(s.CrewAccruals(ctx, office, id)).of(t)
	if len(list.Items) != 2 {
		t.Errorf("list: %+v", list)
	}

	// before the signature
	for _, st := range []string{"draft", "wait", "sms"} {
		_, err := s.AccrueByAct(ctx, office, actDoc(t, id, st, rubles(100)))
		wantReason(t, err, "repair_act_not_signed")
	}
	// the act without a sum, a document that is not an act, a missing one
	_, err := s.AccrueByAct(ctx, office, actDoc(t, id, "signed", nil))
	wantField(t, err, "documentId", "")
	_, err = s.AccrueByAct(ctx, office, document(t, id, "contract", "signed"))
	wantCode(t, err, "not_found", "")
	_, err = s.AccrueByAct(ctx, office, uuid.New())
	wantCode(t, err, "not_found", "")
	// a crew of nobody
	bare := project(t, "Начисление/без бригады", seedOpts{})
	_, err = s.AccrueByAct(ctx, office, actDoc(t, bare, "signed", rubles(1000)))
	wantField(t, err, "documentId", "")
	// the right repairs.crew.accrue and the visibility of the object
	_, err = s.AccrueByAct(ctx, as(t, "ab.member"), act)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.AccrueByAct(ctx, as(t, "a.manager-msk1"), act)
	wantCode(t, err, "not_found", "")
	_, err = s.CrewAccruals(ctx, as(t, "ab.member"), id)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.CrewAccruals(ctx, office, uuid.New())
	wantCode(t, err, "not_found", "")
}

func TestAccrueWithoutMarksSplitsEqually(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Начисление/поровну", seedOpts{})
	crew(t, id, "Первый")
	crew(t, id, "Второй")
	crew(t, id, "Третий")
	got := must(s.AccrueByAct(ctx, office, actDoc(t, id, "signed", rubles(1_000)))).of(t) // 40 % = 400 kopecks
	var sum int
	for _, a := range got.Items {
		sum += a.Amount.AmountMinor
	}
	if len(got.Items) != 3 || sum != 400 {
		t.Errorf("equal split: %+v (sum %d)", got.Items, sum)
	}
}

func TestPayoutAccruals(t *testing.T) { //nolint:gocyclo // one operation: its successes and each refusal in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Выплата/объект", seedOpts{})
	crew(t, id, "Иван Петров")
	crew(t, id, "Анна Сидорова")
	acc := must(s.AccrueByAct(ctx, office, actDoc(t, id, "signed", rubles(1_000_000)))).of(t)
	ids := []uuid.UUID{acc.Items[0].Id, acc.Items[1].Id}

	got := must(s.PayoutAccruals(ctx, office, ids)).of(t)
	if got.ProposalId == uuid.Nil || len(got.Accruals) != 2 {
		t.Fatalf("payout: %+v", got)
	}
	for _, a := range got.Accruals {
		if a.State != rapi.CrewAccrualStateProposed {
			t.Errorf("accrual after the payout: %+v", a)
		}
	}
	// the cash desks hold one proposal for the whole sum: the payroll, money out
	var kind, dir, key string
	var amount int64
	if err := superA.QueryRow(ctx, `select kind, direction, amount_minor, key from cash.proposals where source_id = $1`, got.ProposalId).Scan(&kind, &dir, &amount, &key); err != nil {
		t.Fatalf("the proposal of the cash desks: %v", err)
	}
	if kind != "payroll" || dir != "out" || amount != 400_000 || key != "payroll:"+got.ProposalId.String() {
		t.Errorf("proposal: %s %s %d %s", kind, dir, amount, key)
	}
	if n := count(t, `select count(*) from repairs.crew_accruals where cash_proposal_id = $1 and state = 'proposed'`, got.ProposalId); n != 2 {
		t.Errorf("accruals bound to the proposal: %d", n)
	}

	// proposed accruals are not offered again; an unknown id is a 422 on the item; the right of each object
	_, err := s.PayoutAccruals(ctx, office, ids[:1])
	wantCode(t, err, "invalid_transition", "")
	_, err = s.PayoutAccruals(ctx, office, []uuid.UUID{uuid.New()})
	wantField(t, err, "accrualIds[0]", "")
	_, err = s.PayoutAccruals(ctx, office, nil)
	wantField(t, err, "accrualIds", "")

	other := project(t, "Выплата/второй", seedOpts{})
	crew(t, other, "Пётр")
	two := must(s.AccrueByAct(ctx, office, actDoc(t, other, "signed", rubles(10_000)))).of(t)
	_, err = s.PayoutAccruals(ctx, as(t, "ab.member"), []uuid.UUID{two.Items[0].Id})
	wantCode(t, err, "forbidden_action", "")
	_, err = s.PayoutAccruals(ctx, as(t, "a.manager-msk1"), []uuid.UUID{two.Items[0].Id})
	wantCode(t, err, "not_found", "")
	if st := scalarString(t, `select state from repairs.crew_accruals where id = $1`, two.Items[0].Id); st != "accrued" {
		t.Errorf("a refused payout changed the accrual to %s", st)
	}

	// the payment is posted by the cashier: the accruals become paid once, with an event
	n := must(s.MarkPaid(ctx, ref("tenant:a"), got.ProposalId)).of(t)
	if n != 2 || count(t, `select count(*) from repairs.crew_accruals where cash_proposal_id = $1 and state = 'paid'`, got.ProposalId) != 2 {
		t.Errorf("marked paid: %d", n)
	}
	if c := count(t, `select count(*) from outbox.events where type = 'repairs.crew_accrual.paid.v1' and aggregate_id = $1`, id); c != 2 {
		t.Errorf("paid events %d, want 2", c)
	}
	if again := must(s.MarkPaid(ctx, ref("tenant:a"), got.ProposalId)).of(t); again != 0 {
		t.Errorf("the second posting marked %d", again)
	}
	_, err = s.PayoutAccruals(ctx, office, ids[:1])
	wantCode(t, err, "invalid_transition", "")

	// without the port of the cash desks the payout is not accepted and nothing is kept
	down := service()
	down.Offers = nil
	_, err = down.PayoutAccruals(ctx, office, []uuid.UUID{two.Items[0].Id})
	wantCode(t, err, "dependency_unavailable", "")
	if st := scalarString(t, `select state from repairs.crew_accruals where id = $1`, two.Items[0].Id); st != "accrued" {
		t.Errorf("after a payout without the cash desks: %s", st)
	}
}

func scalarString(t *testing.T, sql string, args ...any) string {
	t.Helper()
	var s string
	if err := superA.QueryRow(t.Context(), sql, args...).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestSubcontractorAccess(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Подрядчик/объект", seedOpts{})
	var sub uuid.UUID
	if err := superA.QueryRow(ctx, `insert into repairs.subcontractors (project_id, name, scope, contract_minor, paid_minor)
		values ($1, 'ООО Электрик', 'Электрика', 80000, 20000) returning id`, id).Scan(&sub); err != nil {
		t.Fatal(err)
	}
	list := must(s.Subcontractors(ctx, office, id)).of(t)
	if len(list.Items) != 1 || list.Items[0].Active || list.Items[0].Contract == nil || list.Items[0].Contract.AmountMinor != 80000 {
		t.Fatalf("list: %+v", list)
	}

	until := accessUntil(20)
	opened := must(s.SetSubcontractorAccess(ctx, office, id, sub, until)).of(t)
	if !opened.Active || opened.AccessUntil == nil || opened.AccessUntil.Format("2006-01-02") != until.Until.Format("2006-01-02") {
		t.Fatalf("opened: %+v", opened)
	}
	if n := count(t, `select count(*) from outbox.events where type = 'repairs.subcontractor.access_granted.v1' and aggregate_id = $1`, id); n != 1 {
		t.Errorf("granted events %d", n)
	}
	closed := must(s.SetSubcontractorAccess(ctx, office, id, sub, rapi.SubcontractorAccessSet{Active: false})).of(t)
	if closed.Active {
		t.Fatalf("closed: %+v", closed)
	}
	if n := count(t, `select count(*) from outbox.events where type = 'repairs.subcontractor.access_revoked.v1' and aggregate_id = $1`, id); n != 1 {
		t.Errorf("revoked events %d", n)
	}

	// the term is required and not in the past
	_, err := s.SetSubcontractorAccess(ctx, office, id, sub, rapi.SubcontractorAccessSet{Active: true})
	wantField(t, err, "until", "")
	past := accessUntil(-2)
	_, err = s.SetSubcontractorAccess(ctx, office, id, sub, past)
	wantField(t, err, "until", "")
	// a subcontractor of another object, a missing one, the right, the closed object
	other := project(t, "Подрядчик/другой", seedOpts{})
	_, err = s.SetSubcontractorAccess(ctx, office, other, sub, until)
	wantCode(t, err, "not_found", "")
	_, err = s.SetSubcontractorAccess(ctx, office, id, uuid.New(), until)
	wantCode(t, err, "not_found", "")
	_, err = s.SetSubcontractorAccess(ctx, as(t, "ab.member"), id, sub, until)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.Subcontractors(ctx, as(t, "ab.member"), id)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.Subcontractors(ctx, as(t, "a.manager-msk1"), id)
	wantCode(t, err, "not_found", "")
	done := project(t, "Подрядчик/сдан", seedOpts{status: "handed_over"})
	var doneSub uuid.UUID
	if err := superA.QueryRow(ctx, `insert into repairs.subcontractors (project_id, name) values ($1, 'ООО Сдано') returning id`, done).Scan(&doneSub); err != nil {
		t.Fatal(err)
	}
	_, err = s.SetSubcontractorAccess(ctx, office, done, doneSub, until)
	wantReason(t, err, "project_handed_over")
}

// accessUntil opens the access for the days from today (the date of the contract is built in the module, which may not import its type).
func accessUntil(days int) rapi.SubcontractorAccessSet {
	set := rapi.SubcontractorAccessSet{Active: true}
	alloc(&set.Until).Time = clock().AddDate(0, 0, days)
	return set
}
