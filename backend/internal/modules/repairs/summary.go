package repairs

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

// viewer is what the member may do on one object: the flags the summary and the queue of decisions follow (the prototype
// view() and repairSum).
type viewer struct {
	foreman, finance, reviewer, estimator, supplier, manager bool
}

// viewerOf reads the flags of the member on p.
func (r *req) viewerOf(ctx context.Context, p *projectRow) (viewer, error) {
	var v viewer
	var err error
	office, err := r.office(ctx, p)
	if err != nil {
		return v, err
	}
	v.foreman = p.isForeman(r.me()) && !office
	for _, c := range []struct {
		dst    *bool
		action string
	}{{&v.finance, actFinance}, {&v.reviewer, actReview}, {&v.supplier, actSupply}, {&v.manager, actManage}} {
		if *c.dst, err = r.can(ctx, p, c.action); err != nil {
			return v, err
		}
	}
	est, err := r.can(ctx, p, actEstimates)
	v.estimator = est && v.finance
	return v, err
}

func decision(kind, text, label string, tab rapi.RepairDecisionTab, ref *uuid.UUID) rapi.RepairDecision {
	d := rapi.RepairDecision{Kind: rapi.RepairDecisionKind(kind), Text: text, Tab: tab}
	if label != "" {
		d.ActionLabel = new(label)
	}
	d.RefId = ref
	return d
}

// decisions is the queue «Требует решения» of an object (decisionsOf of the prototype port; the schedule slip comes
// from the schedule, W6.14): the same list feeds the card, the list and «Главная».
func decisions(p *projectRow, f *facts, v viewer) []rapi.RepairDecision {
	if p.status == statusDraft {
		return draftDecisions(f.estimates[p.id], v)
	}
	out := []rapi.RepairDecision{}
	if p.foreman == nil && p.status == statusActive && v.manager {
		out = append(out, decision("no_foreman", "Не назначен прораб", "Назначить прораба", rapi.RepairDecisionTabOverview, nil))
	}
	out = append(out, markDecisions(p, f, v)...)
	out = append(out, scheduleDecisions(p, f)...)
	if v.finance {
		out = append(out, documentDecisions(f.docs[p.id])...)
	}
	if n := f.supply[p.id]; n > 0 && v.supplier {
		out = append(out, decision("supply_pending", fmt.Sprintf("Заявки на материалы ждут решения снабжения: %d", n), "Решить в снабжении", rapi.RepairDecisionTabSupply, nil))
	}
	if v.finance {
		for _, e := range f.estimates[p.id] {
			if e.state == "sent" {
				out = append(out, decision("estimate_with_client", fmt.Sprintf("Смета v%d: у заказчика", e.version), "Открыть смету", rapi.RepairDecisionTabEstimate, nil))
				break
			}
		}
	}
	if v.estimator {
		out = append(out, changeDecisions(f.changes[p.id])...)
	}
	return out
}

// scheduleDecisions are the decisions of the schedule: the hand over slips past the term, a stage has no executor.
func scheduleDecisions(p *projectRow, f *facts) []rapi.RepairDecision {
	out := []rapi.RepairDecision{}
	if sf := f.sched[p.id]; sf != nil && sf.delay > 0 {
		out = append(out, decision("schedule_slip", "Сдача сдвигается на "+sf.fin.Format("02.01"), "Открыть график", rapi.RepairDecisionTabSchedule, nil))
	}
	if idle := f.idle[p.id]; len(idle) > 0 {
		out = append(out, decision("stage_no_executor", "Не назначен исполнитель: "+strings.Join(idle, ", "), "Открыть график", rapi.RepairDecisionTabSchedule, nil))
	}
	return out
}

// draftDecisions is the queue of a draft: the state of its estimate, for those who read the finance.
func draftDecisions(est []estFact, v viewer) []rapi.RepairDecision {
	out := []rapi.RepairDecision{}
	if !v.finance {
		return out
	}
	open := func(kind, text, label string) {
		out = append(out, decision(kind, text, label, rapi.RepairDecisionTabEstimate, nil))
	}
	switch {
	case len(est) == 0:
		open("estimate_missing", "Смета не собрана", "Собрать смету")
	case est[len(est)-1].state == statusDraft:
		open("estimate_draft", "Черновик сметы не отправлен заказчику", "Открыть смету")
	case est[len(est)-1].state == "sent":
		open("estimate_sent", "Смета у заказчика на согласовании", "Открыть смету")
	case est[len(est)-1].state == "approved":
		open("estimate_approved", "Смета согласована: следующий шаг — договор", "Открыть смету")
	}
	return out
}

// markDecisions are the marks on acceptance (for the reviewer with the work and the volume, for the foreman with the
// number) and the mark the foreman has not sent today.
func markDecisions(p *projectRow, f *facts, v viewer) []rapi.RepairDecision {
	out := []rapi.RepairDecision{}
	for _, l := range f.pending[p.id] {
		ref := l.id
		switch {
		case v.reviewer:
			out = append(out, decision("work_log_pending", fmt.Sprintf("%s: %s %s", orWork(l.work), l.qty, unitRu(l.unit)), "Принять объём", rapi.RepairDecisionTabWorks, &ref))
		case v.foreman:
			out = append(out, decision("work_log_pending", "Отметка "+l.number+" ждёт приёмки", "", rapi.RepairDecisionTabWorks, &ref))
		}
	}
	if v.foreman && p.status == statusActive && !f.today[p.id] {
		out = append(out, decision("work_log_missing", "Отметка за сегодня не отправлена", "Отметить работу", rapi.RepairDecisionTabWorks, nil))
	}
	return out
}

// documentDecisions are the documents that wait for the signature of the client and the acts ready to be sent.
func documentDecisions(docs []docFact) []rapi.RepairDecision {
	out := []rapi.RepairDecision{}
	for _, d := range docs {
		ref := d.id
		switch {
		case d.state == "sms" || d.state == "wait":
			out = append(out, decision("document_wait_signature", d.title+": ждёт подписи заказчика", "Открыть документы", rapi.RepairDecisionTabDocs, &ref))
		case d.state == statusDraft && d.kind == "act":
			out = append(out, decision("document_ready", d.title+": готов к отправке", "Открыть документы", rapi.RepairDecisionTabDocs, &ref))
		}
	}
	return out
}

// changeDecisions are the change orders that wait for an estimate or sit in an agreement.
func changeDecisions(changes []changeFact) []rapi.RepairDecision {
	out := []rapi.RepairDecision{}
	for _, c := range changes {
		ref := c.id
		switch c.status {
		case "proposed":
			out = append(out, decision("change_order_new", fmt.Sprintf("Допработа ДР-%d ждёт оценки: %s", c.seq, c.title), "Оценить в смете", rapi.RepairDecisionTabEstimate, &ref))
		case "priced":
			out = append(out, decision("change_order_priced", fmt.Sprintf("Допработа ДР-%d в черновике допсоглашения", c.seq), "Открыть смету", rapi.RepairDecisionTabEstimate, &ref))
		case "sent":
			out = append(out, decision("change_order_sent", fmt.Sprintf("Допработа ДР-%d в допсоглашении у заказчика", c.seq), "Открыть смету", rapi.RepairDecisionTabEstimate, &ref))
		}
	}
	return out
}
func orWork(s string) string {
	if s == "" {
		return "Работа"
	}
	return s
}

// readiness is the readiness of p by the accepted volumes and the signed acts (a handed over object is ready).
func readiness(p *projectRow, f *facts) rapi.RepairReadiness {
	if p.status == statusHandedOver {
		return rapi.RepairReadiness{AcceptedPct: 100, PendingPct: 0, ClientPct: 100}
	}
	var plan, fact, pending milli
	for _, w := range f.works[p.id] {
		plan += w.plan
		fact += w.fact
		pending += w.pending
	}
	acts, signed := 0, 0
	for _, d := range f.docs[p.id] {
		if d.kind == "act" {
			acts++
			if d.state == "signed" || d.state == "paid" {
				signed++
			}
		}
	}
	return readinessOf(plan, fact, pending, acts, signed)
}

// alloc sets *p to a new T and returns it.
func alloc[T any](p **T) *T {
	*p = new(T)
	return *p
}

// projectDTO is the object as the member sees it: the sums and the phone of the client only with the finance right.
func (r *req) projectDTO(p *projectRow, f *facts, v viewer, todo []rapi.RepairDecision) (rapi.RepairProject, error) {
	access := []rapi.RepairAccessItem{}
	if len(p.access) > 0 {
		if err := json.Unmarshal(p.access, &access); err != nil {
			return rapi.RepairProject{}, store("access", err)
		}
	}
	workers := []rapi.Worker{}
	for _, w := range f.crew[p.id] {
		workers = append(workers, workerDTO(w))
	}
	dto := rapi.RepairProject{
		Id: p.id, OrgUnitId: p.unit, Name: p.name, Address: p.address, Status: rapi.RepairProjectStatus(p.status),
		ForemanMemberId: p.foreman, Workers: workers, Revision: p.revision, Kind: p.kind, Stage: p.stage, Rooms: p.rooms,
		ContractNo: p.contractNo, ClientName: p.clientName, Access: access, Measured: f.measured[p.id],
		TemplateId: p.template, LeadTaskId: p.leadTask, Readiness: readiness(p, f), TodoCount: len(todo),
	}
	if p.area != nil {
		dto.AreaM2 = new(p.area.String())
	}
	setDates(&dto, p, f.sched[p.id])
	if len(todo) > 0 {
		dto.TodoTop = &todo[0]
	}
	if v.finance {
		dto.ClientPhone = p.clientPhone
		if p.budget != nil {
			dto.Budget = &rapi.Money{AmountMinor: int(*p.budget), Currency: p.currency}
		}
	}
	return dto, nil
}

// setDates writes the dates of p into dto; the forecast is the one of the schedule (W6.14), without a schedule — the term.
func setDates(dto *rapi.RepairProject, p *projectRow, sf *schedFact) {
	if p.startOn != nil {
		alloc(&dto.StartOn).Time = *p.startOn
	}
	if p.dueOn != nil {
		alloc(&dto.DueOn).Time = *p.dueOn
		alloc(&dto.ForecastDueOn).Time = *p.dueOn
	}
	if sf != nil {
		alloc(&dto.ForecastDueOn).Time = sf.fin
	}
	if p.handedOverOn != nil {
		alloc(&dto.HandedOverOn).Time = *p.handedOverOn
	}
	if p.warrantyUntil != nil {
		alloc(&dto.WarrantyUntil).Time = *p.warrantyUntil
	}
}

func workerDTO(w crewRow) rapi.Worker {
	return rapi.Worker{Id: w.id, DisplayName: w.name, Trade: w.trade, Status: rapi.WorkerStatus(w.status)}
}

// summarize builds the DTO of p with its queue of decisions.
func (r *req) summarize(ctx context.Context, p *projectRow, f *facts) (rapi.RepairProject, []rapi.RepairDecision, viewer, error) {
	v, err := r.viewerOf(ctx, p)
	if err != nil {
		return rapi.RepairProject{}, nil, v, err
	}
	todo := decisions(p, f, v)
	dto, err := r.projectDTO(p, f, v, todo)
	return dto, todo, v, err
}

// projectOut is the answer of a command on p: the object re-read as the member sees it.
func (r *req) projectOut(ctx context.Context, id uuid.UUID) (rapi.RepairProject, error) {
	p, err := r.project(ctx, id, false)
	if err != nil || p == nil {
		return rapi.RepairProject{}, err
	}
	f, err := r.loadFacts(ctx, []uuid.UUID{p.id})
	if err != nil {
		return rapi.RepairProject{}, err
	}
	dto, _, _, err := r.summarize(ctx, p, f)
	return dto, err
}
