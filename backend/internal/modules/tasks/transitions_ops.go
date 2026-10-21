package tasks

import (
	"context"
	"net/http"
	"slices"
	"strings"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W4.11: shared command helpers of the modules (Audit, Complete; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the transitions (api.js:703–728 of the prototype, MSW tasks/index.ts).
const (
	textRemoved      = "Переход удалён из процесса"
	textNotHere      = "Переход недоступен из текущего статуса"
	textNotWaiting   = "Задача не ждёт этого согласования"
	textNoApproval   = "Согласование не найдено"
	textWhatToRework = "Напишите, что доработать"
	textDocRoute     = "Статус задачи меняется маршрутом документа — решения в «Документах»"
	commentMax       = 5000
	outcomeApproved  = "approved"
	outcomeRejected  = "rejected"
	outcomeCancelled = "cancelled"
)

// Transition runs a transition of the workflow or records a vote (transitionTask, runTransition of the prototype):
// 403 without the right, 409 with a reason for an unmet condition, a vote of «нужны все» keeps the status until every
// approver of the round has voted (Q-W4.00-tasks-9).
func (s *Service) Transition(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b tasksapi.TaskTransition) (tasksapi.Task, error) {
	var out tasksapi.Task
	err := s.run(ctx, tc, true, func(r *request) error {
		t, p, err := r.visibleTask(ctx, id, true)
		if err != nil {
			return err
		}
		if err := checkRevision(ifMatch, t.Revision, staleTask); err != nil {
			return err
		}
		if t.DocRoute != nil {
			return conflict(reasonDocRoute, textDocRoute)
		}
		v, err := r.versionOf(ctx, p, t)
		if err != nil {
			return err
		}
		tr, ok := transitionIn(v, b.TransitionKey)
		if !ok {
			return invalid("transitionKey", "removed", textRemoved)
		}
		if !fromHere(tr, t.StatusID) {
			return conflict(reasonNotIn, textNotHere)
		}
		sc, err := r.allowed(ctx, p, t, tr)
		if err != nil {
			return err
		}
		txt, err := transitionComment(tr, b.Comment)
		if err != nil {
			return err
		}
		if tr.Approval == nil {
			if err := r.moveTo(ctx, p, t, tr, txt, r.meActor()); err != nil {
				return err
			}
			return r.finish(ctx, p, t, &out, evTransitioned)
		}
		moved, err := r.approve(ctx, sc, p, t, tr, txt)
		switch {
		case err != nil:
			return err
		case !moved:
			return r.finish(ctx, p, t, &out, "") // a vote of «нужны все»: the status stays
		}
		return r.finish(ctx, p, t, &out, evApproved)
	})
	return out, err
}

// transitionIn is the transition key of the version v (false — none or no version).
func transitionIn(v *version, key string) (tasksapi.TaskWorkflowTransition, bool) {
	if v == nil {
		return tasksapi.TaskWorkflowTransition{}, false
	}
	w := workflow{Transitions: v.Transitions}
	return w.transition(key)
}

// allowed requires trCheck of the requesting member for tr on t and returns the scene of p.
func (r *request) allowed(ctx context.Context, p *project, t *task, tr tasksapi.TaskWorkflowTransition) (*scene, error) {
	sc, err := r.scene(ctx, p)
	if err != nil {
		return nil, err
	}
	rd, err := r.openRound(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	kids, err := r.kids(ctx, t)
	if err != nil {
		return nil, err
	}
	if c := sc.check(t, tr, r.tc.PersonID, rd, kids); !c.ok {
		return nil, c.err()
	}
	return sc, nil
}

// transitionComment is the trimmed comment of a transition: at most 5000 characters, required by «Комментарий».
func transitionComment(tr tasksapi.TaskWorkflowTransition, comment *string) (string, error) {
	txt := ""
	if comment != nil {
		txt = trimmed(*comment)
	}
	switch {
	case runes(txt) > commentMax:
		return "", invalid("comment", "length", textLength)
	case tr.CommentRequired && txt == "":
		return "", invalid("comment", "required", "Для перехода «"+tr.Name+"» нужен комментарий")
	}
	return txt, nil
}

// approve records the vote of the requesting member for tr; moved is true when the task moves (the last vote of
// «нужны все» or «достаточно одного»), else the history names who is awaited.
func (r *request) approve(ctx context.Context, sc *scene, p *project, t *task, tr tasksapi.TaskWorkflowTransition, txt string) (bool, error) {
	waiting, err := r.vote(ctx, p, t, tr, txt)
	if err != nil {
		return false, err
	}
	if len(waiting) == 0 {
		return true, r.moveTo(ctx, p, t, tr, txt, r.meActor())
	}
	names := make([]string, 0, len(waiting))
	for _, w := range waiting {
		names = append(names, sc.name(w))
	}
	line := "Согласовал(а)"
	if txt != "" {
		line += ": " + txt
	}
	_, err = r.log(ctx, t.ID, "approval_vote", line+". Ждём: "+strings.Join(names, ", "), r.meActor(), tr.Key)
	return false, err
}

// finish saves t with a new revision, publishes event ("" — none) and answers the whole card.
func (r *request) finish(ctx context.Context, p *project, t *task, out *tasksapi.Task, event string) error {
	if err := r.saveTask(ctx, t); err != nil {
		return err
	}
	if event != "" {
		if _, err := r.publish(ctx, event, aggTask, t.ID, map[string]any{keyTaskID: t.ID, keyProjectID: p.ID, "statusId": t.StatusID}); err != nil {
			return err
		}
	}
	dto, err := r.taskDTO(ctx, p, t, true)
	if err != nil {
		return err
	}
	*out = dto
	return kit.Complete(ctx, r.tx, http.StatusOK, etag(out.Revision), dto)
}

// vote records the approval of the requesting member in the round of tr (opened now if the task has none) and
// returns the approvers of «нужны все» still waiting (none — the task moves).
func (r *request) vote(ctx context.Context, p *project, t *task, tr tasksapi.TaskWorkflowTransition, comment string) ([]uuid.UUID, error) {
	rd, err := r.roundOf(ctx, p, t, tr)
	if err != nil {
		return nil, err
	}
	if rd.ID == uuid.Nil {
		if err := r.insertRound(ctx, t.ID, rd); err != nil {
			return nil, err
		}
	}
	var note *string
	if comment != "" {
		note = &comment
	}
	if _, err := r.tx.Exec(ctx, `insert into tasks.approval_votes (round_id, member_id, decision, decided_at, comment)
		values ($1, $2, 'approve', $3, $4) on conflict do nothing`, rd.ID, r.tc.PersonID, r.now, note); err != nil {
		return nil, store("vote", err)
	}
	rd.Votes = append(rd.Votes, vote{Member: r.tc.PersonID, At: r.now})
	if rd.Mode != string(tasksapi.TaskWorkflowApprovalModeAll) {
		return nil, nil
	}
	var waiting []uuid.UUID
	for _, a := range rd.Approvers {
		if !rd.voted(a) {
			waiting = append(waiting, a)
		}
	}
	return waiting, nil
}

// moveTo is moveTo of the prototype: the status of tr, the line of the history, «на автора», the rules «перешла в
// статус» and the round of approval of the new status.
func (r *request) moveTo(ctx context.Context, p *project, t *task, tr tasksapi.TaskWorkflowTransition, txt string, who actor) error {
	v, err := r.versionOf(ctx, p, t)
	if err != nil {
		return err
	}
	w := workflow{Statuses: v.Statuses}
	to, ok := w.status(tr.To)
	if !ok {
		return invalid("transitionKey", "removed", textRemoved)
	}
	from := t.StatusID
	if st, ok := w.status(t.StatusID); ok {
		from = st.Name
	}
	rd, err := r.openRound(ctx, t.ID)
	if err != nil {
		return err
	}
	outcome := outcomeCancelled
	if tr.Approval != nil {
		outcome = outcomeApproved
	}
	if err := r.closeRound(ctx, rd, outcome); err != nil {
		return err
	}
	t.StatusID = to.Id
	line := tr.Name + ": " + from + " → " + to.Name
	if txt != "" {
		line += ". " + txt
	}
	if _, err := r.log(ctx, t.ID, "transition", line, who, tr.Key); err != nil {
		return err
	}
	if tr.AssignAuthor && t.Author != nil {
		author := *t.Author
		t.Assignee = &author
		if _, err := r.log(ctx, t.ID, "assignment", "Назначено на автора: "+r.nameOf(ctx, t.Author), actor{label: actorProcess}, ""); err != nil {
			return err
		}
	}
	if err := r.autoFire(ctx, p, t, string(tasksapi.TaskAutomationTriggerKindStatusEntered), to.Id); err != nil {
		return err
	}
	return r.syncRound(ctx, p, t)
}

// syncRound keeps the round of approval of t with its status: a status a transition by approval starts from has an open
// round of that transition (the approvers of «нужны все» fixed now, the version of the task remembered —
// Q-W4.00-tasks-9); any other status has none.
func (r *request) syncRound(ctx context.Context, p *project, t *task) error {
	if p.funnel() {
		return nil
	}
	rd, err := r.openRound(ctx, t.ID)
	if err != nil {
		return err
	}
	v, err := r.versionOf(ctx, p, t)
	if err != nil {
		return err
	}
	tr, ok := approvalHere(v, t)
	if rd != nil && ok && rd.TransitionKey == tr.Key {
		return nil
	}
	if err := r.closeRound(ctx, rd, outcomeCancelled); err != nil {
		return err
	}
	if !ok {
		return nil
	}
	fresh := &round{TransitionKey: tr.Key, Version: 1, Mode: string(tr.Approval.Mode)}
	if t.WorkflowVersion != nil {
		fresh.Version = *t.WorkflowVersion
	}
	if fresh.Mode == string(tasksapi.TaskWorkflowApprovalModeAll) {
		sc, err := r.scene(ctx, p)
		if err != nil {
			return err
		}
		fresh.Approvers = sc.approvers(t, tr)
	}
	return r.insertRound(ctx, t.ID, fresh)
}

// Reject returns a task waiting for approval for rework (rejectTaskApproval, «Вернуть на доработку»): only the right,
// «не автор» and the status count (Q-W4.00-tasks-8, PD-60); the comment is required.
func (s *Service) Reject(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, key, ifMatch string, b tasksapi.TaskApprovalRejection) (tasksapi.Task, error) {
	var out tasksapi.Task
	err := s.run(ctx, tc, true, func(r *request) error {
		t, p, err := r.visibleTask(ctx, id, true)
		if err != nil {
			return err
		}
		if err := checkRevision(ifMatch, t.Revision, staleTask); err != nil {
			return err
		}
		v, err := r.versionOf(ctx, p, t)
		if err != nil {
			return err
		}
		tr, ok := transitionIn(v, key)
		if !ok || tr.Approval == nil {
			return notFound(textNoApproval)
		}
		if !fromHere(tr, t.StatusID) {
			return conflict(reasonNotIn, textNotWaiting)
		}
		if t.DocRoute != nil {
			return conflict(reasonDocRoute, textDocRoute)
		}
		sc, err := r.scene(ctx, p)
		if err != nil {
			return err
		}
		rd, err := r.openRound(ctx, t.ID)
		if err != nil {
			return err
		}
		if c := sc.rejectCheck(t, tr, r.tc.PersonID, rd, nil); !c.ok {
			return c.err()
		}
		txt, err := reworkComment(b.Comment)
		if err != nil {
			return err
		}
		if err := r.rejectTo(ctx, p, t, v, tr, rd, txt); err != nil {
			return err
		}
		return r.finish(ctx, p, t, &out, evRejected)
	})
	return out, err
}

// reworkComment is the required comment of «Вернуть на доработку» (at most 5000 characters).
func reworkComment(comment string) (string, error) {
	txt := trimmed(comment)
	switch {
	case txt == "":
		return "", invalid("comment", "required", textWhatToRework)
	case runes(txt) > commentMax:
		return "", invalid("comment", "length", textLength)
	}
	return txt, nil
}

// rejectTo moves t back to the status rejectTo of tr with the comment, closes the round as rejected (the vote kept)
// and runs the rules «перешла в статус».
func (r *request) rejectTo(ctx context.Context, p *project, t *task, v *version, tr tasksapi.TaskWorkflowTransition, rd *round, txt string) error {
	w := workflow{Statuses: v.Statuses}
	back, ok := w.status(tr.Approval.RejectTo)
	if !ok {
		if len(v.Statuses) == 0 {
			return invalid("transitionKey", "removed", textRemoved)
		}
		back = v.Statuses[0]
	}
	from := t.StatusID
	if st, ok := w.status(t.StatusID); ok {
		from = st.Name
	}
	if rd != nil {
		if _, err := r.tx.Exec(ctx, `insert into tasks.approval_votes (round_id, member_id, decision, decided_at, comment)
			values ($1, $2, 'reject', $3, $4) on conflict (round_id, member_id) do update set decision = 'reject',
			decided_at = excluded.decided_at, comment = excluded.comment`, rd.ID, r.tc.PersonID, r.now, txt); err != nil {
			return store("reject vote", err)
		}
	}
	if err := r.closeRound(ctx, rd, outcomeRejected); err != nil {
		return err
	}
	t.StatusID = back.Id
	if _, err := r.log(ctx, t.ID, "approval_rejected", "Вернул(а) на доработку ("+from+" → "+back.Name+"): "+txt, r.meActor(), tr.Key); err != nil {
		return err
	}
	if err := r.autoFire(ctx, p, t, string(tasksapi.TaskAutomationTriggerKindStatusEntered), back.Id); err != nil {
		return err
	}
	return r.syncRound(ctx, p, t)
}

// containsID reports whether ids holds id.
func containsID(ids []uuid.UUID, id uuid.UUID) bool { return slices.Contains(ids, id) }
