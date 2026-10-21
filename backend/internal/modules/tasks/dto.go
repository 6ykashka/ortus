package tasks

import (
	"context"
	"slices"
	"strconv"
	"strings"

	"github.com/google/uuid"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// etag is the strong ETag of a revision (as MSW: «"rev-N"»).
func etag(revision int64) string { return `"rev-` + strconv.FormatInt(revision, 10) + `"` }

// Texts of a stale If-Match (the examples revision_mismatch of the contract).
const (
	staleTask = "Задачу уже изменили. Обновите и повторите."
	staleRule = "Правило уже изменили. Обновите и повторите."
)

// checkRevision compares If-Match with the current revision: missing — 428 revision_required; anything but its ETag —
// 412 revision_mismatch with text.
func checkRevision(ifMatch string, current int64, text string) error {
	switch v := strings.TrimSpace(ifMatch); {
	case v == "":
		return problem.New(codeRevRequired, "")
	case v != etag(current):
		return problem.New(codeRevMismatch, text)
	}
	return nil
}

// ---------------------------------------------------------------------------------------------------------------------
// Projects.

// projectTasks are the live tasks of p.
func (r *request) projectTasks(ctx context.Context, p *project) ([]*task, error) {
	rows, err := r.tx.Query(ctx, `select `+taskCols+` from tasks.tasks t where t.project_id = $1 and t.deleted_at is null
		order by t.created_at desc, t.number desc`, p.ID)
	if err != nil {
		return nil, store("project tasks", err)
	}
	out, err := collectTasks(rows)
	return out, store("project tasks", err)
}

func (r *request) projectDTO(ctx context.Context, p *project) (tasksapi.Project, error) {
	out := tasksapi.Project{
		Id: p.ID, Name: p.Name, OrgUnitId: p.Unit, Key: p.Key, Status: tasksapi.ProjectStatusActive, WorkflowKey: p.WorkflowKey,
		Revision: p.Revision, Flow: new(tasksapi.ProjectFlow(p.Flow)), OwnerMemberId: new(p.Owner),
		OwnerDisplayName: new(r.nameOf(ctx, &p.Owner)), CreatedAt: new(p.CreatedAt.UTC()),
	}
	if !p.funnel() && p.Access != "" {
		out.Access = new(tasksapi.TaskProjectAccessLevel(p.Access))
	}
	if !p.funnel() {
		cur, err := r.current(ctx, p)
		if err != nil {
			return out, err
		}
		if cur != nil {
			d, err := r.draftOf(ctx, p)
			if err != nil {
				return out, err
			}
			out.Workflow = &tasksapi.TaskProjectWorkflowSummary{Version: cur.Number, HasDraft: d != nil, Revision: new(p.WorkflowRevision)}
		}
	}
	members, err := r.membersOf(ctx, p)
	if err != nil {
		return out, err
	}
	n := 0
	for _, m := range members {
		if m.Source != tasksapi.TaskProjectMemberSourceSystem {
			n++
		}
	}
	open, err := r.openCount(ctx, p)
	if err != nil {
		return out, err
	}
	out.Counts = &tasksapi.TaskProjectCounts{Members: n, Open: open}
	a, err := r.access(ctx, p)
	if err != nil {
		return out, err
	}
	if a != nil {
		out.MyAccess = &tasksapi.TaskProjectMyAccess{Actions: slices.Clone(a.Actions), RoleId: a.RoleID, RoleName: a.RoleName,
			Source: tasksapi.TaskProjectMyAccessSource(a.Source), Via: a.Via}
	}
	return out, nil
}

// openCount is «Открыто»: the tasks of p the requesting member sees that are not finished.
func (r *request) openCount(ctx context.Context, p *project) (int, error) {
	ts, err := r.projectTasks(ctx, p)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, t := range ts {
		ok, err := r.canTask(ctx, p, t, actRead)
		if err != nil {
			return 0, err
		}
		if !ok {
			continue
		}
		d, err := r.done(ctx, p, t)
		if err != nil {
			return 0, err
		}
		if !d {
			n++
		}
	}
	return n, nil
}

// membersOf are the rows of «Участники»: the active members with access to p, by name (only active ones — the
// prototype «Задачи и проекты.dc.html»:360, :441; W4.03 return 1).
func (r *request) membersOf(ctx context.Context, p *project) ([]tasksapi.TaskProjectMember, error) {
	sc, err := r.scene(ctx, p)
	if err != nil {
		return nil, err
	}
	ids := make([]uuid.UUID, 0, len(sc.people))
	for id, m := range sc.people {
		if m.Active {
			ids = append(ids, id)
		}
	}
	slices.SortFunc(ids, func(a, b uuid.UUID) int { return compareNames(sc, a, b) })
	out := []tasksapi.TaskProjectMember{}
	for _, id := range ids {
		m := sc.people[id]
		a := projAccess(p, m, sc.path, sc.names)
		if a == nil {
			continue
		}
		row := tasksapi.TaskProjectMember{
			MemberId: id, DisplayName: m.Name, MemberStatus: new(tasksapi.TaskProjectMemberMemberStatusActive),
			RoleId: a.RoleID, RoleName: a.RoleName, Source: tasksapi.TaskProjectMemberSource(a.Source), Via: a.Via,
			Actions: slices.Clone(a.Actions), AssignmentId: a.Assignment, Editable: a.Source == srcAssigned,
		}
		if m.Driver {
			row.FunctionNotes = &[]string{"финансы скрыты"}
		}
		out = append(out, row)
	}
	return out, nil
}

// ---------------------------------------------------------------------------------------------------------------------
// Workflow.

func (r *request) workflowDTO(ctx context.Context, p *project) (tasksapi.TaskWorkflow, error) {
	cur, err := r.current(ctx, p)
	if err != nil {
		return tasksapi.TaskWorkflow{}, err
	}
	if cur == nil {
		return tasksapi.TaskWorkflow{}, notFound(textNoWorkflow)
	}
	out := tasksapi.TaskWorkflow{
		ProjectId: p.ID, Version: cur.Number, Statuses: slices.Clone(cur.Statuses), Transitions: slices.Clone(cur.Transitions),
		Fixed: p.funnel(), PublishedAt: new(cur.PublishedAt.UTC()), PublishedByMemberId: cur.PublishedBy, Revision: p.WorkflowRevision,
	}
	if p.funnel() {
		out.Revision = 1
		return out, nil
	}
	a, err := r.access(ctx, p)
	if err != nil {
		return out, err
	}
	if !a.has(actWorkflowManage) {
		return out, nil
	}
	d, err := r.draftOf(ctx, p)
	if err != nil || d == nil {
		return out, err
	}
	out.Draft = &tasksapi.TaskWorkflowDraft{Statuses: d.Statuses, Transitions: nonNil(d.Transitions), UpdatedAt: new(d.UpdatedAt.UTC()),
		UpdatedByMemberId: d.UpdatedBy}
	return out, nil
}

// ---------------------------------------------------------------------------------------------------------------------
// Tasks.

// approvalHere is the transition by approval from the status of t in its version.
func approvalHere(v *version, t *task) (tasksapi.TaskWorkflowTransition, bool) {
	if v == nil {
		return tasksapi.TaskWorkflowTransition{}, false
	}
	for _, tr := range v.Transitions {
		if tr.Approval != nil && fromHere(tr, t.StatusID) {
			return tr, true
		}
	}
	return tasksapi.TaskWorkflowTransition{}, false
}

// roundOf is the round of approval of t for tr: the open one of the transition, else a round being opened now
// (the approvers of «нужны все» as they are now; not stored).
func (r *request) roundOf(ctx context.Context, p *project, t *task, tr tasksapi.TaskWorkflowTransition) (*round, error) {
	rd, err := r.openRound(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	if rd != nil && rd.TransitionKey == tr.Key {
		return rd, nil
	}
	v := 1
	if t.WorkflowVersion != nil {
		v = *t.WorkflowVersion
	}
	fresh := &round{TransitionKey: tr.Key, Version: v, Mode: string(tr.Approval.Mode)}
	if fresh.Mode == string(tasksapi.TaskWorkflowApprovalModeAll) {
		sc, err := r.scene(ctx, p)
		if err != nil {
			return nil, err
		}
		fresh.Approvers = sc.approvers(t, tr)
	}
	return fresh, nil
}

func (r *request) approvalDTO(ctx context.Context, p *project, t *task, v *version, kids []kid) (*tasksapi.TaskApprovalState, error) {
	tr, ok := approvalHere(v, t)
	if !ok || p.funnel() {
		return nil, nil
	}
	rd, err := r.roundOf(ctx, p, t, tr)
	if err != nil {
		return nil, err
	}
	sc, err := r.scene(ctx, p)
	if err != nil {
		return nil, err
	}
	ids := rd.Approvers
	if rd.Mode != string(tasksapi.TaskWorkflowApprovalModeAll) {
		ids = sc.approvers(t, tr)
		for _, vt := range rd.Votes {
			if !slices.Contains(ids, vt.Member) {
				ids = append(ids, vt.Member)
			}
		}
	}
	out := &tasksapi.TaskApprovalState{TransitionKey: tr.Key, TransitionName: tr.Name, Mode: tasksapi.TaskApprovalStateMode(rd.Mode),
		WorkflowVersion: rd.Version, Approvers: []tasksapi.TaskApprover{}}
	for _, id := range ids {
		a := tasksapi.TaskApprover{MemberId: id, DisplayName: sc.name(id), State: tasksapi.Waiting}
		for _, vt := range rd.Votes {
			if vt.Member == id {
				a.State, a.DecidedAt = tasksapi.Approved, new(vt.At.UTC())
			}
		}
		out.Approvers = append(out.Approvers, a)
	}
	out.CanApprove = sc.check(t, tr, r.tc.PersonID, rd, kids).ok
	out.CanReject = sc.rejectCheck(t, tr, r.tc.PersonID, rd, kids).ok
	return out, nil
}

func (r *request) parentDTO(ctx context.Context, t *task) (*tasksapi.TaskParentRef, error) {
	if t.Parent == nil {
		return nil, nil
	}
	par, err := r.task(ctx, *t.Parent, false)
	if err != nil {
		return nil, err
	}
	if par == nil || par.Deleted {
		out := &tasksapi.TaskParentRef{State: tasksapi.Deleted, TaskId: t.Parent}
		if par != nil {
			if pp, err := r.project(ctx, par.Project); err == nil && pp != nil {
				out.Key = new(keyOf(par, pp))
			}
		}
		return out, nil
	}
	vis, err := r.visible(ctx, par)
	if err != nil {
		return nil, err
	}
	if !vis {
		return &tasksapi.TaskParentRef{State: tasksapi.Hidden}, nil // the id of an invisible task is not given
	}
	pp, err := r.project(ctx, par.Project)
	if err != nil {
		return nil, err
	}
	out := &tasksapi.TaskParentRef{State: tasksapi.Visible, TaskId: &par.ID, Key: new(keyOf(par, pp)), Title: new(par.Title)}
	if s, ok, err := r.statusOf(ctx, pp, par); err != nil {
		return nil, err
	} else if ok {
		out.StatusCategory = new(s.Category)
	}
	return out, nil
}

// taskDTO is the task as the requesting member sees it: the fields of the board card, and with full the whole card
// (the checklist, the files, the transitions with their reasons).
func (r *request) taskDTO(ctx context.Context, p *project, t *task, full bool) (tasksapi.Task, error) {
	out := tasksapi.Task{
		Id: t.ID, ProjectId: t.Project, Title: t.Title, DescriptionMarkdown: new(t.Description), Status: t.StatusID,
		RelatedObjects: nonNil(t.Related), CustomFields: []tasksapi.FieldEntry{}, Revision: t.Revision, Key: new(keyOf(t, p)),
		Priority: new(tasksapi.TaskPriority(t.Priority)), Labels: new(slices.Clone(t.Labels)), DueAt: t.DueAt,
		WorkflowVersion: t.WorkflowVersion, CreatedAt: new(t.CreatedAt.UTC()), UpdatedAt: new(t.UpdatedAt.UTC()), DocRoute: t.DocRoute,
	}
	v, err := r.versionOf(ctx, p, t)
	if err != nil {
		return out, err
	}
	out.StatusName, out.StatusCategory = new(t.StatusID), new(tasksapi.Progress)
	if s, ok, err := r.statusOf(ctx, p, t); err != nil {
		return out, err
	} else if ok {
		out.StatusName, out.StatusCategory = new(s.Name), new(s.Category)
	}
	if t.Assignee != nil {
		out.AssigneeMemberId, out.AssigneeDisplayName = t.Assignee, new(r.nameOf(ctx, t.Assignee))
	}
	if t.Author != nil {
		out.AuthorMemberId, out.AuthorDisplayName = t.Author, new(r.nameOf(ctx, t.Author))
	}
	kids, err := r.hierarchyDTO(ctx, t, &out)
	if err != nil {
		return out, err
	}
	if out.Approval, err = r.approvalDTO(ctx, p, t, v, kids); err != nil || !full {
		return out, err
	}
	return out, r.cardDTO(ctx, p, t, v, kids, &out)
}

// hierarchyDTO fills «Состоит из» and «Входит в» of out and returns the subtasks of t.
func (r *request) hierarchyDTO(ctx context.Context, t *task, out *tasksapi.Task) ([]kid, error) {
	kids, err := r.kids(ctx, t)
	if err != nil {
		return nil, err
	}
	sum := tasksapi.TaskChildrenSummary{Total: len(kids)}
	for _, k := range kids {
		switch {
		case !k.Visible:
			sum.Hidden++
		case k.Done:
			sum.Done++
		}
	}
	out.Children = &sum
	if out.Parent, err = r.parentDTO(ctx, t); err != nil {
		return nil, err
	}
	if t.Parent != nil && (out.Parent == nil || out.Parent.State != tasksapi.Hidden) {
		out.ParentTaskId = t.Parent
	}
	return kids, nil
}

// cardDTO fills the fields of the whole card: the checklist, the files and the transitions (none on a document
// route or without a workflow).
func (r *request) cardDTO(ctx context.Context, p *project, t *task, v *version, kids []kid, out *tasksapi.Task) error {
	out.Checklist = new(nonNil(t.Checklist))
	files, err := r.files(ctx, t.ID)
	if err != nil {
		return err
	}
	list := make([]tasksapi.TaskAttachment, 0, len(files))
	for _, f := range files {
		list = append(list, tasksapi.TaskAttachment{FileId: f.File, Name: f.Name, SizeBytes: f.Size, ContentType: f.Type,
			UploadedByMemberId: f.By, UploadedByDisplayName: f.ByName, AttachedAt: f.Attached.UTC()})
	}
	out.Files = &list
	if t.DocRoute != nil || v == nil {
		return nil
	}
	opts, err := r.transitionOptions(ctx, p, t, v, kids)
	if err != nil {
		return err
	}
	out.AvailableTransitions = &opts
	return nil
}

// transitionOptions are the transitions from the status of t with whether the requesting member may run them now.
func (r *request) transitionOptions(ctx context.Context, p *project, t *task, v *version, kids []kid) ([]tasksapi.TaskTransitionOption, error) {
	sc, err := r.scene(ctx, p)
	if err != nil {
		return nil, err
	}
	rd, err := r.openRound(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	w := workflow{Statuses: v.Statuses}
	out := []tasksapi.TaskTransitionOption{}
	for _, tr := range v.Transitions {
		if !fromHere(tr, t.StatusID) {
			continue
		}
		c := sc.check(t, tr, r.tc.PersonID, rd, kids)
		to, ok := w.status(tr.To)
		name := tr.To
		if ok {
			name = to.Name
		}
		o := tasksapi.TaskTransitionOption{Key: tr.Key, Name: tr.Name, ToStatusId: tr.To, ToStatusName: name,
			Approval: tr.Approval != nil, CommentRequired: tr.CommentRequired, Allowed: c.ok}
		if !c.ok {
			reason := c.reason
			if reason == "" {
				reason = codeForbidden
			}
			o.Reason, o.ReasonText = new(reason), new(c.text)
		}
		out = append(out, o)
	}
	return out, nil
}

// ---------------------------------------------------------------------------------------------------------------------
// History and automation.

func (r *request) historyDTO(ctx context.Context, h historyRow) tasksapi.TaskHistoryEntry {
	out := tasksapi.TaskHistoryEntry{Id: h.ID, At: h.At.UTC(), Kind: tasksapi.TaskHistoryEntryKind(h.Kind), Text: h.Text,
		TransitionKey: h.TransitionKey, ActorMemberId: h.Actor}
	switch {
	case h.Actor != nil:
		out.ActorDisplayName = r.nameOf(ctx, h.Actor)
	case h.Label != nil && *h.Label == actorProcess:
		out.ActorDisplayName = labelProcess
	case h.Label != nil && *h.Label == actorAutomation:
		out.ActorDisplayName = labelAutomation
	default:
		out.ActorDisplayName = labelSystem
	}
	return out
}

func automationDTO(a *automation) tasksapi.TaskAutomation {
	out := tasksapi.TaskAutomation{
		Id: a.ID, ProjectId: a.Project, Name: a.Name, Trigger: tasksapi.TaskAutomationTrigger{Kind: tasksapi.TaskAutomationTriggerKind(a.Trigger),
			StatusId: a.TriggerTo},
		Action:  tasksapi.TaskAutomationAction{Kind: tasksapi.TaskAutomationActionKind(a.ActionKind), MemberId: a.ActionWho, Text: a.ActionText},
		Enabled: a.Enabled, Version: a.Version, AuthorMemberId: a.Author, AuthorDisplayName: a.AuthorLabel, RunCount: a.RunCount,
		Revision: a.Revision, CreatedAt: new(a.CreatedAt.UTC()), UpdatedAt: new(a.UpdatedAt.UTC()),
	}
	if out.AuthorDisplayName == "" {
		out.AuthorDisplayName = unknownName
	}
	if a.ActionPrio != nil {
		out.Action.Priority = new(tasksapi.TaskPriority(*a.ActionPrio))
	}
	if a.CondPrio != nil {
		out.Condition = &tasksapi.TaskAutomationCondition{Priority: new(tasksapi.TaskPriority(*a.CondPrio))}
	}
	return out
}
