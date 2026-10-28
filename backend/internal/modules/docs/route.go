package docs

import (
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Codes and texts of the route (documents.md §2.2, the prototype).
const (
	codeSeparation = "separation_of_duties_conflict"

	textNotOnRoute    = "Документ не на маршруте"
	textOnRoute       = "Документ уже на маршруте"
	textPDFAnoRoute   = "PDF/A-копию не отправляют на согласование"
	textAckNotAsked   = "Ознакомление не запрошено"
	textAckOthers     = "Ознакомление запрошено у других сотрудников"
	textAckByMember   = "Ознакомление подтверждает сам сотрудник"
	textSignByCode    = "Утверждение — подписью (ПЭП): сначала запросите подтверждение"
	textNeedFixes     = "Сначала внесите правки: согласуют новую версию"
	textWriteWhat     = "Напишите, что доработать"
	textRouteAuthor   = "Отправить снова может автор маршрута"
	textCancelAuthor  = "Отменить маршрут может автор или владелец бизнеса"
	textAckCloseRight = "Завершить ознакомление может автор маршрута или владелец бизнеса"
	textAckNotNow     = "Ознакомление не идёт"
	textNoProject     = "Нет права создавать задачи в проекте"
	textVersionRoute  = "На согласование"
	textVersionFixed  = "После доработки"
	defaultDevice     = "компьютер"
)

// separation is a 409 separation_of_duties_conflict: the author approves or signs the own document.
func separation(detail string) error { return problem.New(codeSeparation, detail) }

func transition(detail string) error { return problem.New(codeTransition, detail) }

// routePlan is a checked start of a route: the steps with their members, the rules and the project of the task.
type routePlan struct {
	steps   []*routeStep
	rules   routeRules
	project uuid.UUID
}

// planRoute checks the steps and the rules of a start in the order of the prototype and returns the plan.
func (r *req) planRoute(d *document, b dapi.DocRouteStart) (routePlan, error) {
	p := routePlan{rules: routeRules{Lock: true, NotAuthor: true, CommentOnBack: true}}
	if b.Rules != nil {
		if b.Rules.NotAuthor != nil {
			p.rules.NotAuthor = *b.Rules.NotAuthor
		}
		if b.Rules.CommentOnBack != nil {
			p.rules.CommentOnBack = *b.Rules.CommentOnBack
		}
		if b.Rules.Escalate != nil {
			p.rules.Escalate = *b.Rules.Escalate
		}
	}
	if b.ProjectId != nil {
		p.project = *b.ProjectId
	}
	switch n := len(b.Steps); {
	case n == 0:
		return p, invalid("steps", "Добавьте хотя бы один шаг", "required")
	case n > stepsMax:
		return p, invalid("steps", "В маршруте не больше шести шагов", "max")
	}
	for i, in := range b.Steps {
		s, err := r.planStep(d, i, in, p.rules)
		if err != nil {
			return p, err
		}
		p.steps = append(p.steps, s)
	}
	return p, nil
}

// planStep checks a step of a start.
func (r *req) planStep(d *document, i int, in dapi.DocRouteStepInput, rules routeRules) (*routeStep, error) {
	kind := string(in.Kind)
	s := &routeStep{pos: i, kind: kind, name: stepName(kind), mode: modeAll, days: min(max(int(in.Days), 1), daysMax), status: stepStatusWait}
	if in.Name != nil {
		if n := strings.TrimSpace(*in.Name); n != "" {
			s.name = clip(n, 200)
		}
	}
	prefix := fmt.Sprintf("Шаг %d «%s»: ", i+1, stepName(kind))
	switch kind {
	case stepApprove:
		return s, r.planApprove(s, in, prefix, rules)
	case stepSign:
		return s, r.planSign(d, s, in, prefix, rules)
	case stepAck:
		return s, planAck(s, in, prefix)
	case stepExternal:
		return s, planExternal(s, in, prefix)
	}
	return nil, invalid("steps", "Неизвестный шаг")
}

// planAck checks the audience of a step «Ознакомить».
func planAck(s *routeStep, in dapi.DocRouteStepInput, prefix string) error {
	aud := []dapi.DocShareEntry{}
	if in.Audience != nil {
		aud = *in.Audience
	}
	if len(aud) == 0 {
		return invalid("steps", prefix+"добавьте роль, группу или сотрудников", "required")
	}
	for _, e := range aud {
		if _, ok := audienceEntry(e); !ok {
			return invalid("steps", prefix+"адресат указан неверно")
		}
	}
	s.audience, _ = json.Marshal(aud)
	return nil
}

// planExternal checks the customer of a step «Подпись заказчика».
func planExternal(s *routeStep, in dapi.DocRouteStepInput, prefix string) error {
	name := ""
	if in.ExternalName != nil {
		name = strings.TrimSpace(*in.ExternalName)
	}
	if name == "" {
		return invalid("steps", prefix+"укажите заказчика", "required")
	}
	s.ext.name = clip(name, 200)
	if in.ExternalPhone != nil {
		s.ext.phone = phoneDigits(*in.ExternalPhone)
	}
	return nil
}

// planApprove checks the approvers of a step «Согласовать».
func (r *req) planApprove(s *routeStep, in dapi.DocRouteStepInput, prefix string, rules routeRules) error {
	if in.Mode != nil {
		if m := string(*in.Mode); m == modeSeq || m == modeAny {
			s.mode = m
		}
	}
	if in.WhoMemberIds != nil {
		for _, id := range *in.WhoMemberIds {
			if !slices.Contains(s.who, id) {
				s.who = append(s.who, id)
			}
		}
	}
	if len(s.who) == 0 {
		return invalid("steps", prefix+"добавьте согласующих", "required")
	}
	for _, id := range s.who {
		if err := r.liveMember(id, prefix); err != nil {
			return err
		}
		if rules.NotAuthor && id == r.me.id {
			return separation(prefix + "автор не согласует свой документ. Уберите себя или выключите правило")
		}
	}
	return nil
}

// planSign checks the signer of a step «Утвердить»: a member who may sign in the area of the document.
func (r *req) planSign(d *document, s *routeStep, in dapi.DocRouteStepInput, prefix string, rules routeRules) error {
	if in.WhoMemberIds == nil || len(*in.WhoMemberIds) == 0 {
		return invalid("steps", prefix+"выберите, кто утверждает", "required")
	}
	id := (*in.WhoMemberIds)[0]
	if err := r.liveMember(id, prefix); err != nil {
		return err
	}
	if rules.NotAuthor && id == r.me.id {
		return separation(prefix + "автор не утверждает свой документ. Выберите другого утверждающего или выключите правило")
	}
	if !r.w.rightsFor(r.w.member[id], d).sign {
		return invalid("steps", prefix+r.w.names[id]+" не может утверждать: нет права «Документы · Утверждать» в области документа")
	}
	s.who = []uuid.UUID{id}
	return nil
}

// liveMember checks that id is an employee of the organization who is not blocked.
func (r *req) liveMember(id uuid.UUID, prefix string) error {
	m := r.w.member[id]
	switch {
	case m == nil:
		return invalid("steps", prefix+"сотрудник не найден")
	case m.status == memberBlocked:
		return invalid("steps", prefix+m.name+" заблокирован")
	}
	return nil
}

// audienceEntry is the entry of an audience of an acknowledgement; false — the entry names nobody.
func audienceEntry(e dapi.DocShareEntry) (entry, bool) {
	out := entry{who: string(e.Who)}
	if e.RefId != nil {
		out.ref = *e.RefId
	}
	if e.OrgUnitId != nil {
		out.unit = *e.OrgUnitId
	}
	if e.Object != nil {
		out.obj = e.Object.EntityId
	}
	switch out.who {
	case whoAll:
		return out, true
	case whoMember, whoGroup, whoRole:
		return out, out.ref != uuid.Nil
	case whoRelation:
		return out, out.obj != uuid.Nil
	}
	return out, false
}

// addressees are the members an acknowledgement is asked of: the audience of the step without the author of the route
// and the blocked (activate of the prototype).
func (r *req) addressees(s *routeStep, author uuid.UUID) []uuid.UUID {
	var entries []entry
	for _, e := range decodeList[dapi.DocShareEntry](s.audience) {
		if x, ok := audienceEntry(e); ok {
			entries = append(entries, x)
		}
	}
	var out []uuid.UUID
	for _, m := range r.w.members {
		if m.status == memberBlocked || m.id == author {
			continue
		}
		if slices.ContainsFunc(entries, func(e entry) bool { return r.w.entryHas(m, e) }) {
			out = append(out, m.id)
		}
	}
	return out
}

// workDue is the term of a step days working days from today, as the moment the date column keeps.
func (r *req) workDue(days int) time.Time {
	d := addWorkdays(r.w.today, days)
	return time.Date(d.Year(), d.Month(), d.Day(), 12, 0, 0, 0, moscow)
}

// consequences are the texts of «Что произойдёт» of a start (the right panel of the dialog).
func (r *req) consequences(d *document, p routePlan) []string {
	out := []string{fmt.Sprintf("Версия v%d закрывается для правки на время маршрута", d.version)}
	where := "в проекте «ДОК · Документы · маршруты»"
	if p.project != uuid.Nil {
		where = "в выбранном проекте"
	}
	out = append(out, "Создаётся задача «Согласовать: "+clip(d.title, 120)+"» "+where+"; решения принимаются в «Документах»")
	for _, s := range p.steps {
		prefix := fmt.Sprintf("Шаг %d «%s»: ", s.pos+1, s.name)
		switch s.kind {
		case stepApprove:
			out = append(out, prefix+r.namesOf(s.who)+" получат уведомление"+r.tempNote(d, s.who))
		case stepSign:
			out = append(out, prefix+r.namesOf(s.who)+" подписывает повторным подтверждением входа (ПЭП)")
		case stepAck:
			n := len(r.addressees(s, r.me.id))
			out = append(out, prefix+fmt.Sprintf("ознакомятся: %d; им откроется «Читает» утверждённой версии, версия, время и устройство сохранятся", n))
		case stepExternal:
			out = append(out, prefix+"заказчик «"+s.ext.name+"» подписывает по коду из SMS; без канала доставки шаг ждёт ссылку")
		}
	}
	out = append(out, "Автору придут уведомления о решениях и о завершении маршрута")
	if len(out) > 20 {
		out = out[:20]
	}
	return out
}

// namesOf is the names of members for a text.
func (r *req) namesOf(ids []uuid.UUID) string {
	names := make([]string, 0, len(ids))
	for _, id := range ids {
		names = append(names, r.w.names[id])
	}
	return strings.Join(names, ", ")
}

// tempNote tells who of members gets «Комментирует» for the time of the step.
func (r *req) tempNote(d *document, ids []uuid.UUID) string {
	var need []uuid.UUID
	for _, id := range ids {
		if m := r.w.member[id]; m != nil && r.w.accessToDoc(m, d).level < levelComment {
			need = append(need, id)
		}
	}
	if len(need) == 0 {
		return ""
	}
	return "; " + r.namesOf(need) + " получат «Комментирует» на время шага"
}

// StartRoute sends a document to a route (startDocRoute — docRouteStart): the version «На согласование» is closed for
// editing, the mirror task and the temporary accesses are made, the first step starts. dryRun answers «Что
// произойдёт» and changes nothing.
func (s *Service) StartRoute(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b dapi.DocRouteStart) (dapi.DocRouteStartResult, error) {
	var out dapi.DocRouteStartResult
	err := s.runOn(ctx, tc, true, onDoc(id), func(r *req) error {
		d, rt, err := r.doc(id)
		if err != nil {
			return err
		}
		if err := r.mayStart(d, rt); err != nil {
			return err
		}
		plan, err := r.planRoute(d, b)
		if err != nil {
			return err
		}
		if err := r.mayCreateTask(ctx, plan.project); err != nil {
			return err
		}
		out.Consequences = r.consequences(d, plan)
		if b.DryRun != nil && *b.DryRun {
			return nil
		}
		if _, err := r.startRoute(ctx, d, plan); err != nil {
			return err
		}
		if b.SaveAsFolderTemplate != nil && *b.SaveAsFolderTemplate {
			if err := r.saveRouteTemplate(ctx, d, plan, b); err != nil {
				return err
			}
		}
		route, err := r.routeDTO(ctx, d)
		if err != nil {
			return err
		}
		out.Applied, out.Route = true, route
		return nil
	})
	return out, err
}

// mayStart checks that the member may send d to a route and that d may go.
func (r *req) mayStart(d *document, rt rights) error {
	switch {
	case !rt.editL:
		return forbidden(textNeedEdit)
	case d.route != nil && (d.route.status == routeActive || d.route.status == routeReturned):
		return transition(textOnRoute)
	case d.status == statusArchived:
		return transition("Документ в архиве")
	case d.pdfa:
		return failed(textPDFAnoRoute)
	case d.status == statusSigned:
		return locked(textLocked)
	}
	return nil
}

// mayCreateTask checks that the author may create tasks in the project of the route (the system project is open).
func (r *req) mayCreateTask(ctx context.Context, project uuid.UUID) error {
	if project == uuid.Nil || r.s.Tasks == nil {
		return nil
	}
	ok, err := r.s.Tasks.MayCreate(ctx, r.tx, r.tc.TenantID, r.me.id, r.me.owner, project)
	if err != nil {
		return fmt.Errorf("docs: may create task: %w", err)
	}
	if !ok {
		return forbidden(textNoProject)
	}
	return nil
}

// startRoute writes the route of a plan, makes its task and starts the first step.
func (r *req) startRoute(ctx context.Context, d *document, p routePlan) (*routeData, error) {
	if _, err := r.tx.Exec(ctx, `update docs.versions set name = $3 where document_id = $1 and number = $2 and name is null`, d.id, d.version, textVersionRoute); err != nil {
		return nil, fmt.Errorf("docs: name version: %w", err)
	}
	rd := &routeData{id: r.s.newID(), doc: d.id, version: d.version, startedBy: r.me.id, startedAt: r.now, status: routeActive,
		project: p.project, rules: p.rules, steps: p.steps}
	if err := r.insertRoute(ctx, rd); err != nil {
		return nil, err
	}
	if err := r.saveDoc(ctx, d, statusInRoute, nil); err != nil {
		return nil, err
	}
	d.lock = true
	d.route = &routeBrief{id: rd.id, status: routeActive, version: rd.version, started: r.me.id}
	if err := r.makeTask(ctx, d, rd); err != nil {
		return nil, err
	}
	var steps []string
	for _, s := range rd.steps {
		steps = append(steps, s.name)
	}
	if err := r.record(ctx, "docs.route.start", d.id, fmt.Sprintf("Отправлен на согласование: v%d · %s", rd.version, strings.Join(steps, " → ")), false, nil); err != nil {
		return nil, err
	}
	if _, err := r.publish(ctx, "docs.route.started", aggDocument, d.id, map[string]any{keyRouteID: rd.id, keyVersion: rd.version, "steps": len(rd.steps)}); err != nil {
		return nil, err
	}
	return rd, r.activate(ctx, d, rd, 0)
}

// makeTask makes the mirror task of a route in the module «Задачи» (Q-W4.00-documents-3) and keeps its id.
func (r *req) makeTask(ctx context.Context, d *document, rd *routeData) error {
	if r.s.Tasks == nil {
		return nil
	}
	var names []string
	for _, s := range rd.steps {
		names = append(names, s.name)
	}
	t := RouteTask{Project: rd.project, Author: r.me.id, AuthorOwner: r.me.owner, AuthorName: r.me.name, Document: d.id, Route: rd.id,
		Title: "Согласовать: " + d.title, State: r.taskState(d, rd),
		Description: fmt.Sprintf("Маршрут документа «%s» v%d: %s. Решения принимаются в «Документах», статус задачи меняет маршрут.", d.title, rd.version, strings.Join(names, " → "))}
	res, err := r.s.Tasks.CreateRouteTask(ctx, r.tx, r.tc.TenantID, t)
	switch {
	case err != nil:
		return fmt.Errorf("docs: route task: %w", err)
	case res.Refused != "" && res.Forbidden:
		return forbidden(res.Refused)
	case res.Refused != "":
		return failed(res.Refused)
	}
	rd.task = res.ID
	if rd.project == uuid.Nil {
		rd.project = res.Project
	}
	return r.saveRoute(ctx, rd)
}

// taskState is what the route tells its task (syncTask): who waits at the step, the status of the route.
func (r *req) taskState(d *document, rd *routeData) RouteTaskState {
	st := RouteTaskState{Status: rd.status, Title: d.title, Version: rd.version, Step: rd.current + 1, Steps: len(rd.steps), Actor: r.actorID()}
	s := rd.step()
	if s == nil {
		return st
	}
	st.StepName, st.Due = s.name, s.due
	if rd.status != routeActive {
		if rd.status == routeReturned {
			st.Assignee = rd.startedBy
		}
		return st
	}
	st.Waiting = s.waiting()
	for _, id := range st.Waiting {
		st.WaitingNames = append(st.WaitingNames, r.w.names[id])
	}
	switch {
	case s.externalWaiting():
		st.WaitingNames = append(st.WaitingNames, s.ext.name+" · заказчик")
		st.Assignee = rd.startedBy
	case len(st.Waiting) > 0:
		st.Assignee = st.Waiting[0]
	}
	return st
}

// syncTask moves the mirror task after the route; note is a system comment of the task.
func (r *req) syncTask(ctx context.Context, d *document, rd *routeData, note string) error {
	if r.s.Tasks == nil || rd.task == uuid.Nil {
		return nil
	}
	if err := r.s.Tasks.SyncRouteTask(ctx, r.tx, r.tc.TenantID, rd.task, r.taskState(d, rd), note); err != nil {
		return fmt.Errorf("docs: sync route task: %w", err)
	}
	return nil
}

// activate starts step i (activate of the prototype): the term, the temporary accesses, the addressees of an
// acknowledgement, the notices of those who wait; an acknowledgement nobody is asked of is over at once.
func (r *req) activate(ctx context.Context, d *document, rd *routeData, i int) error {
	s := rd.steps[i]
	rd.current, s.status = i, stepStatusActive
	due := r.workDue(s.days)
	s.due = &due
	if err := r.grantForStep(ctx, d, rd, s); err != nil {
		return err
	}
	if err := r.saveStep(ctx, rd, s); err != nil {
		return err
	}
	if err := r.saveRoute(ctx, rd); err != nil {
		return err
	}
	if s.kind == stepAck && len(s.who) == 0 {
		return r.advance(ctx, d, rd)
	}
	if err := r.askStep(ctx, d, rd, s); err != nil {
		return err
	}
	return r.syncTask(ctx, d, rd, "")
}

// grantForStep gives the temporary accesses a step needs: «Комментирует» to an approver who cannot open the document, «Читает»
// of the approved version to an addressee of an acknowledgement (resolved here, kept).
func (r *req) grantForStep(ctx context.Context, d *document, rd *routeData, s *routeStep) error {
	switch s.kind {
	case stepApprove:
		for _, id := range s.who {
			if m := r.w.member[id]; m != nil && r.w.accessToDoc(m, d).level < levelComment {
				if err := r.grantTemp(ctx, d, id, levelComment, "Согласующий на время шага «"+s.name+"»", 0, false); err != nil {
					return err
				}
			}
		}
	case stepAck:
		s.who = r.addressees(s, rd.startedBy)
		for _, id := range s.who {
			if m := r.w.member[id]; m != nil && r.w.accessToDoc(m, d).level < levelView {
				if err := r.grantTemp(ctx, d, id, levelView, "Ознакомление с утверждённой v"+strconv.Itoa(rd.version), rd.version, true); err != nil {
					return err
				}
			}
		}
	}
	return nil
}

// askStep notifies those who the step waits for (the texts of the prototype).
func (r *req) askStep(ctx context.Context, d *document, rd *routeData, s *routeStep) error {
	wait := s.waiting()
	if len(wait) == 0 {
		return nil
	}
	if s.kind == stepApprove && s.mode == modeSeq {
		wait = wait[:1]
	}
	until := ""
	if s.due != nil {
		until = " до " + s.due.In(moscow).Format("02.01.2006")
	}
	title := fmt.Sprintf("Согласуйте «%s» v%d%s", d.title, rd.version, until)
	kind := "docs.route.approve"
	switch s.kind {
	case stepAck:
		title, kind = fmt.Sprintf("Ознакомьтесь с «%s» v%d%s", d.title, rd.version, until), "docs.route.ack"
	case stepSign:
		title, kind = fmt.Sprintf("Утвердите «%s» v%d: подпись повторным подтверждением входа", d.title, rd.version), "docs.route.sign"
	}
	typ := "docs.route.step.started"
	if s.kind == stepAck {
		typ = "docs.ack.requested"
	}
	ev, err := r.publish(ctx, typ, aggDocument, d.id, map[string]any{keyRouteID: rd.id, keyStep: s.pos, "kind": s.kind, "members": wait})
	if err != nil {
		return err
	}
	return r.notify(ctx, kind, title, d.id, ev, wait)
}

// advance finishes the current step (advance of the prototype): the temporary accesses of the step are taken back, a
// signature approves the document and freezes its fields, the next step starts or the route ends.
func (r *req) advance(ctx context.Context, d *document, rd *routeData) error {
	s := rd.step()
	s.status = stepStatusDone
	if err := r.saveStep(ctx, rd, s); err != nil {
		return err
	}
	if err := r.revokeTemps(ctx, d); err != nil {
		return err
	}
	if s.kind == stepSign || s.kind == stepExternal {
		if err := r.approve(ctx, d, rd, s); err != nil {
			return err
		}
	}
	if rd.current+1 < len(rd.steps) {
		if _, err := r.publish(ctx, "docs.route.step.done", aggDocument, d.id, map[string]any{keyRouteID: rd.id, keyStep: s.pos}); err != nil {
			return err
		}
		return r.activate(ctx, d, rd, rd.current+1)
	}
	return r.finishRoute(ctx, d, rd, s)
}

// finishRoute ends a route whose last step is done: a document that only went through approvals is agreed, the author
// is told, the task closes.
func (r *req) finishRoute(ctx context.Context, d *document, rd *routeData, s *routeStep) error {
	rd.status = routeDone
	if err := r.saveRoute(ctx, rd); err != nil {
		return err
	}
	status := d.status
	if status == statusInRoute {
		status = statusAgreed
	}
	if err := r.saveDoc(ctx, d, status, nil); err != nil {
		return err
	}
	d.lock = false
	if err := r.record(ctx, "docs.route.done", d.id, "Маршрут завершён", false, nil); err != nil {
		return err
	}
	ev, err := r.publish(ctx, "docs.route.step.done", aggDocument, d.id, map[string]any{keyRouteID: rd.id, keyStep: s.pos, "done": true})
	if err != nil {
		return err
	}
	if err := r.notify(ctx, "docs.route.done", "Маршрут «"+d.title+"» завершён", d.id, ev, []uuid.UUID{rd.startedBy}); err != nil {
		return err
	}
	return r.syncTask(ctx, d, rd, "Маршрут завершён")
}

// approve is the end of a signature: the status becomes approved (the customer — signed), the fields of the CRM freeze
// as they are, the PDF/A copy with the approval sheet is queued.
func (r *req) approve(ctx context.Context, d *document, rd *routeData, s *routeStep) error {
	status, event := statusApproved, "docs.document.approved"
	if s.kind == stepExternal {
		status, event = statusSigned, "docs.document.signed"
	}
	frozen := map[string]any{}
	for _, f := range decodeList[map[string]any](d.fields) {
		if k, ok := f["k"].(string); ok {
			frozen[k] = f["v"]
		}
	}
	raw, _ := json.Marshal(frozen)
	if err := r.saveDoc(ctx, d, status, raw); err != nil {
		return err
	}
	op := opToPDF
	if d.kind == kindPDF {
		op = opPDFA
	}
	if err := r.queueJob(ctx, op, []uuid.UUID{d.id}, "PDF/A · подписанная копия v"+strconv.Itoa(rd.version), map[string]any{
		"route": rd.id, keyVersion: rd.version, "approvalSheet": r.sheet(rd)}); err != nil {
		return err
	}
	if _, err := r.publish(ctx, event, aggDocument, d.id, map[string]any{keyRouteID: rd.id, keyVersion: rd.version}); err != nil {
		return err
	}
	if s.kind == stepSign {
		return r.record(ctx, "docs.route.sign", d.id, "Утверждён: "+r.namesOf(s.who)+" · ПЭП", true, nil)
	}
	return r.record(ctx, "docs.route.sign", d.id, "Подписан заказчиком: "+s.ext.name, true, nil)
}

// sheet are the rows of the approval sheet of a route (routeSheet of the prototype): step, who, result, when.
func (r *req) sheet(rd *routeData) []map[string]any {
	var rows []map[string]any
	for _, s := range rd.steps {
		name := fmt.Sprintf("%d · %s", s.pos+1, s.name)
		switch s.kind {
		case stepAck:
			rows = append(rows, map[string]any{keyStep: name, "who": strconv.Itoa(len(s.who)) + " сотр.", "result": fmt.Sprintf("%d из %d", len(s.acked), len(s.who))})
		case stepExternal:
			res := "ждёт"
			var at any
			if d := s.agreedDecision(); d != nil {
				res, at = "Подписал(а) · код из SMS", d.at
			}
			rows = append(rows, map[string]any{keyStep: name, "who": s.ext.name, "result": res, "at": at})
		default:
			for _, id := range s.who {
				res, at := "ждёт", any(nil)
				if d := s.lastDecision(id); d != nil {
					res, at = decisionText(s.kind, *d), d.at
				}
				rows = append(rows, map[string]any{keyStep: name, "who": r.w.names[id], "result": res, "at": at})
			}
		}
	}
	return rows
}

func decisionText(kind string, d decision) string {
	switch {
	case d.kind == decisionBack:
		return "Вернул(а) на доработку"
	case kind == stepSign:
		return "Утвердил(а) · ПЭП"
	}
	return "Согласовал(а)"
}

func (s *routeStep) lastDecision(member uuid.UUID) *decision {
	for i := len(s.decisions) - 1; i >= 0; i-- {
		if s.decisions[i].member == member {
			return &s.decisions[i]
		}
	}
	return nil
}

func (s *routeStep) agreedDecision() *decision {
	for i := range s.decisions {
		if s.decisions[i].kind == decisionOK {
			return &s.decisions[i]
		}
	}
	return nil
}

// saveRouteTemplate keeps the route as the template of the folder of the document (needs docs.templates.manage; for
// a member without the right the flag does nothing — the dialog does not show it).
func (r *req) saveRouteTemplate(ctx context.Context, d *document, p routePlan, b dapi.DocRouteStart) error {
	if !r.me.owner && !r.w.hasVerb(r.me, d, "docs.templates.manage") {
		return nil
	}
	f := r.w.folders[d.folder]
	if f == nil {
		return nil
	}
	steps, _ := json.Marshal(b.Steps)
	rules, _ := json.Marshal(routeRules{Lock: true, NotAuthor: p.rules.NotAuthor, CommentOnBack: p.rules.CommentOnBack, Escalate: p.rules.Escalate})
	if _, err := r.tx.Exec(ctx, `insert into docs.route_templates (folder_id, name, project_id, steps, rules) values ($1, $2, $3, $4, $5)
		on conflict (folder_id) do update set name = excluded.name, project_id = excluded.project_id, steps = excluded.steps,
		rules = excluded.rules, revision = docs.route_templates.revision + 1`,
		f.id, "Шаблон папки «"+f.name+"»", nullID(p.project), steps, rules); err != nil {
		return fmt.Errorf("docs: route template: %w", err)
	}
	return nil
}
