package forms

import (
	"context"
	"slices"
	"strings"

	"github.com/google/uuid"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Responses answers listFormResponses: the responses the member reads, the latest first.
func (s *Service) Responses(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, cursor *string, limit *int) (fapi.FormResponsePage, error) {
	out := fapi.FormResponsePage{Items: []fapi.FormResponse{}}
	err := s.runOn(ctx, tc, false, id, func(r *req) error {
		f, err := r.visibleForm(ctx, id, false)
		if err != nil {
			return err
		}
		rs, err := r.responses(ctx, f.id)
		if err != nil {
			return err
		}
		vs, err := r.visibleResponses(ctx, f, rs)
		if err != nil {
			return err
		}
		ids := make([]uuid.UUID, 0, len(vs))
		for _, x := range vs {
			ids = append(ids, x.id)
		}
		from, to, next, err := paginate(ids, cursor, limit)
		if err != nil {
			return err
		}
		v, err := r.view(ctx, f, vs[from:to])
		if err != nil {
			return err
		}
		for _, x := range vs[from:to] {
			dto, err := r.responseDTO(ctx, f, x, v)
			if err != nil {
				return err
			}
			out.Items = append(out.Items, dto)
		}
		out.NextCursor = next
		return nil
	})
	return out, err
}

// visibleResponse is the response id of f the member reads, 404 «Ответ не найден» otherwise.
func (r *req) visibleResponse(ctx context.Context, f *formRow, id uuid.UUID, lock bool) (*responseRow, error) {
	x, err := r.response(ctx, f.id, id, lock)
	if err != nil {
		return nil, err
	}
	if x == nil {
		return nil, notFound(textRespNotFound)
	}
	ok, err := r.sees(ctx, f, x)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, notFound(textRespNotFound)
	}
	return x, nil
}

// Response answers getFormResponse.
func (s *Service) Response(ctx context.Context, tc tenantctx.TenantContext, form, id uuid.UUID) (fapi.FormResponse, error) {
	var out fapi.FormResponse
	err := s.runOn(ctx, tc, false, form, func(r *req) error {
		f, err := r.visibleForm(ctx, form, false)
		if err != nil {
			return err
		}
		x, err := r.visibleResponse(ctx, f, id, false)
		if err != nil {
			return err
		}
		out, err = r.responseOut(ctx, f, x)
		return err
	})
	return out, err
}

// responseOut is the answer of an operation on the response x of f.
func (r *req) responseOut(ctx context.Context, f *formRow, x *responseRow) (fapi.FormResponse, error) {
	v, err := r.view(ctx, f, []*responseRow{x})
	if err != nil {
		return fapi.FormResponse{}, err
	}
	return r.responseDTO(ctx, f, x, v)
}

// responsesView is what the journals of responses show: the rules that exist, the pages the member sees, the
// numbers of the tasks.
type responsesView struct {
	rules map[uuid.UUID]bool
	nodes map[uuid.UUID]KBNode
	tasks map[uuid.UUID]string
}

// view reads what the journals of rs need.
func (r *req) view(ctx context.Context, f *formRow, rs []*responseRow) (responsesView, error) {
	v := responsesView{rules: map[uuid.UUID]bool{}, nodes: map[uuid.UUID]KBNode{}, tasks: map[uuid.UUID]string{}}
	rules, err := r.rules(ctx, f.id)
	if err != nil {
		return v, err
	}
	for _, x := range rules {
		v.rules[x.id] = true
	}
	nodes, tasks := journalObjects(rs)
	if len(nodes) > 0 && r.s.Knowledge != nil {
		if v.nodes, err = r.s.Knowledge.Nodes(ctx, r.tx, r.tc.TenantID, Viewer{Member: r.me(), Owner: r.tc.Owner}, nodes); err != nil {
			return v, dependency(err)
		}
	}
	if len(tasks) > 0 && r.s.Tasks != nil {
		if v.tasks, err = r.s.Tasks.Keys(ctx, r.tx, r.tc.TenantID, tasks); err != nil {
			return v, dependency(err)
		}
	}
	return v, nil
}

// journalObjects are the pages and the tasks the journals of rs name, each once.
func journalObjects(rs []*responseRow) (nodes, tasks []uuid.UUID) {
	add := func(list []uuid.UUID, id *uuid.UUID) []uuid.UUID {
		if id == nil || slices.Contains(list, *id) {
			return list
		}
		return append(list, *id)
	}
	for _, x := range rs {
		for _, a := range x.actions {
			nodes, tasks = add(nodes, a.node), add(tasks, a.task)
		}
	}
	return nodes, tasks
}

// responseDTO is the response x of f as the member sees it.
func (r *req) responseDTO(ctx context.Context, f *formRow, x *responseRow, v responsesView) (fapi.FormResponse, error) {
	author, err := r.memberRef(ctx, x.author)
	if err != nil {
		return fapi.FormResponse{}, err
	}
	review, err := r.mayReview(ctx, f, x, actRespReview)
	if err != nil {
		return fapi.FormResponse{}, err
	}
	assign, err := r.mayReview(ctx, f, x, actRespAssign)
	if err != nil {
		return fapi.FormResponse{}, err
	}
	out := fapi.FormResponse{Id: x.id, FormId: f.id, VersionId: f.versionIDs[x.version], SubmittedAt: x.submittedAt,
		Answers: toAPI(x.answers), ReviewStatus: fapi.FormResponseReviewStatus(x.review), Revision: x.revision,
		Number: numberOf(x.number), VersionNumber: x.version, Author: author, Channel: fapi.FormResponseChannel(x.channel),
		My: fapi.FormResponseMy{Review: review, Assign: assign}, Actions: []fapi.FormResponseAction{}, Subject: x.subject,
		Score: x.score, AssigneeMemberId: x.assignee, ReviewComment: x.comment}
	if len(x.linkKeys) > 0 {
		out.LinkParamKeys = new(slices.Clone(x.linkKeys))
	}
	for _, a := range x.actions {
		out.Actions = append(out.Actions, actionDTO(a, v))
	}
	return out, nil
}

// actionDTO is a line of the journal: «Повторить» for a failure of a rule that still exists, the page the member sees,
// the task.
func actionDTO(a actionRow, v responsesView) fapi.FormResponseAction {
	out := fapi.FormResponseAction{RuleId: a.rule, RuleVersion: a.version, Kind: fapi.FormRuleKind(a.kind), Ok: a.ok, At: a.at,
		Retryable: !a.ok && v.rules[a.rule], Text: a.text, Error: a.err, TaskId: a.task}
	if a.node != nil {
		if n, ok := v.nodes[*a.node]; ok && n.Visible {
			out.Node = &fapi.KnowledgeNodeRef{Id: n.ID, Title: n.Title}
		}
	}
	if a.task != nil {
		if k, ok := v.tasks[*a.task]; ok {
			out.TaskKey = new(k)
		}
	}
	return out
}

// Review answers reviewFormResponse: «Принять» / «Отклонить», the comment and the assignee — each field by its right
// (Q-W4.05-16); an accepted response runs the rules «После принятия ответа».
func (s *Service) Review(ctx context.Context, tc tenantctx.TenantContext, form, id uuid.UUID, ifMatch string, b fapi.ResponseReviewPatch, nulls Nulls) (fapi.FormResponse, error) {
	var out fapi.FormResponse
	err := s.runOn(ctx, tc, true, form, func(r *req) error {
		f, err := r.visibleForm(ctx, form, false)
		if err != nil {
			return err
		}
		x, err := r.visibleResponse(ctx, f, id, true)
		if err != nil {
			return err
		}
		if err := checkRev(ifMatch, x.revision, textResponseChanged); err != nil {
			return err
		}
		assign := b.AssigneeMemberId != nil || nulls["assigneeMemberId"]
		if !assign && b.ReviewStatus == nil && b.ReviewComment == nil {
			return invalid("body", textReviewEmpty)
		}
		if err := r.reviewRights(ctx, f, x, assign, b); err != nil {
			return err
		}
		was := x.review
		if err := r.applyReview(ctx, x, assign, b); err != nil {
			return err
		}
		if err := r.accepted(ctx, f, x, was); err != nil {
			return err
		}
		if err := r.flushNotices(ctx); err != nil {
			return err
		}
		out, err = r.responseOut(ctx, f, x)
		return err
	})
	return out, err
}

// accepted publishes the acceptance of x (its status was before the review) and runs the rules «После принятия».
func (r *req) accepted(ctx context.Context, f *formRow, x *responseRow, was string) error {
	if was == reviewAccepted || x.review != reviewAccepted {
		return nil
	}
	if _, err := r.publish(ctx, evAccepted, aggResponse, x.id, map[string]any{keyFormID: f.id, keyResponseID: x.id}); err != nil {
		return store("event", err)
	}
	return r.runRules(ctx, f, x)
}

// textReviewEmpty is an empty body of reviewFormResponse (no-reference).
const textReviewEmpty = "Укажите, что изменить: статус, комментарий или ответственного"

// reviewRights requires the right of every field of the body.
func (r *req) reviewRights(ctx context.Context, f *formRow, x *responseRow, assign bool, b fapi.ResponseReviewPatch) error {
	if assign {
		ok, err := r.mayReview(ctx, f, x, actRespAssign)
		if err != nil || !ok {
			if err == nil {
				err = forbidden(need[actRespAssign])
			}
			return err
		}
	}
	if b.ReviewStatus != nil || b.ReviewComment != nil {
		ok, err := r.mayReview(ctx, f, x, actRespReview)
		if err != nil || !ok {
			if err == nil {
				err = forbidden(need[actRespReview])
			}
			return err
		}
	}
	return nil
}

// applyReview writes the fields of the body to x and raises its revision.
func (r *req) applyReview(ctx context.Context, x *responseRow, assign bool, b fapi.ResponseReviewPatch) error {
	if assign {
		who, err := r.assignee(ctx, b.AssigneeMemberId)
		if err != nil {
			return err
		}
		x.assignee = who
	}
	if b.ReviewComment != nil {
		x.comment = new(clip(*b.ReviewComment, 5000))
	}
	if b.ReviewStatus != nil {
		x.review = string(*b.ReviewStatus)
	}
	x.revision++
	_, err := r.tx.Exec(ctx, `update forms.responses set review_status = $2, assignee_id = $3, review_comment = $4, revision = $5
		where id = $1`, x.id, x.review, x.assignee, x.comment, x.revision)
	return store("review", err)
}

// assignee is the assignee of a response: a member that is not archived (nil — none).
func (r *req) assignee(ctx context.Context, id *uuid.UUID) (*uuid.UUID, error) {
	if id == nil {
		return nil, nil
	}
	var known bool
	if err := r.tx.QueryRow(ctx, `select exists (select 1 from people.person_profiles where id = $1 and archived_at is null)`,
		*id).Scan(&known); err != nil {
		return nil, store("assignee", err)
	}
	if !known {
		return nil, invalid("assigneeMemberId", textMemberGone)
	}
	return new(*id), nil
}

// Retry answers retryFormResponseAction: the rule (a task or the knowledge base) for one response — a done action
// answers its result; a failure again — 422 «Не выполнено: …».
func (s *Service) Retry(ctx context.Context, tc tenantctx.TenantContext, form, id, ruleID uuid.UUID) (fapi.FormResponseAction, error) {
	var out fapi.FormResponseAction
	err := s.runOn(ctx, tc, true, form, func(r *req) error {
		f, err := r.visibleForm(ctx, form, false)
		if err != nil {
			return err
		}
		if err := r.need(ctx, f, actManage); err != nil {
			return err
		}
		x, err := r.visibleResponse(ctx, f, id, false)
		if err != nil {
			return err
		}
		rule, err := r.rule(ctx, f.id, ruleID, false)
		if err != nil {
			return err
		}
		if rule == nil {
			if slices.ContainsFunc(x.actions, func(a actionRow) bool { return a.rule == ruleID }) {
				return conflict(reasonRuleDeleted, textRuleDeleted)
			}
			return notFound(textRuleNotFound)
		}
		if rule.kind == kindEmail || rule.kind == kindHTTP {
			return notFound(textRuleNotFound)
		}
		a, err := r.runRule(ctx, f, x, rule)
		if err != nil {
			return err
		}
		if !a.ok {
			return invalid("ruleId", "Не выполнено: "+deref(a.err))
		}
		if err := r.flushNotices(ctx); err != nil {
			return err
		}
		v, err := r.view(ctx, f, []*responseRow{x})
		if err != nil {
			return err
		}
		out = actionDTO(a, v)
		return nil
	})
	return out, err
}

// Backfill answers backfillFormRule: the responses that fit the enabled rule «в БЗ» and were not written, by number.
func (s *Service) Backfill(ctx context.Context, tc tenantctx.TenantContext, form, ruleID uuid.UUID) (fapi.FormRuleBackfillResult, error) {
	var out fapi.FormRuleBackfillResult
	err := s.runOn(ctx, tc, true, form, func(r *req) error {
		f, err := r.visibleForm(ctx, form, false)
		if err != nil {
			return err
		}
		if err := r.need(ctx, f, actManage); err != nil {
			return err
		}
		rule, err := r.rule(ctx, f.id, ruleID, false)
		if err != nil {
			return err
		}
		if rule == nil || rule.kind != kindKB {
			return notFound(textRuleNotFound)
		}
		if !rule.enabled {
			return conflict(reasonRuleDisabled, textRuleDisabled)
		}
		if out, err = r.backfill(ctx, f, rule); err != nil {
			return err
		}
		return r.flushNotices(ctx)
	})
	return out, err
}

// backfill runs rule for the responses of f that fit it and were not written, by number.
func (r *req) backfill(ctx context.Context, f *formRow, rule *ruleRow) (fapi.FormRuleBackfillResult, error) {
	var out fapi.FormRuleBackfillResult
	rs, err := r.responses(ctx, f.id)
	if err != nil {
		return out, err
	}
	slices.SortFunc(rs, func(a, b *responseRow) int { return a.number - b.number })
	for _, x := range rs {
		if !fits(rule, x) || slices.ContainsFunc(x.actions, func(a actionRow) bool { return a.rule == rule.id && a.ok }) {
			continue
		}
		a, err := r.runRule(ctx, f, x, rule)
		if err != nil {
			return out, err
		}
		if a.ok {
			out.Added++
		} else {
			out.Failed++
			out.Error = a.err
		}
	}
	return out, nil
}

// Summary answers getFormResponseSummary over the responses the member reads.
func (s *Service) Summary(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (fapi.FormResponseSummary, error) {
	var out fapi.FormResponseSummary
	err := s.runOn(ctx, tc, false, id, func(r *req) error {
		f, cols, vs, err := r.readable(ctx, id)
		if err != nil {
			return err
		}
		rows := make([]answers, 0, len(vs))
		for _, x := range vs {
			rows = append(rows, answersOf(x.answers))
		}
		out = summaryOf(f.id, cols, rows)
		return nil
	})
	return out, err
}

// readable is the form id the member sees, the questions of all its versions and the responses he reads.
func (r *req) readable(ctx context.Context, id uuid.UUID) (*formRow, []question, []*responseRow, error) {
	f, err := r.visibleForm(ctx, id, false)
	if err != nil {
		return nil, nil, nil, err
	}
	versions, err := r.versions(ctx, f.id)
	if err != nil {
		return nil, nil, nil, err
	}
	defs := make([]def, 0, len(versions))
	for _, v := range versions {
		defs = append(defs, v.def)
	}
	rs, err := r.responses(ctx, f.id)
	if err != nil {
		return nil, nil, nil, err
	}
	vs, err := r.visibleResponses(ctx, f, rs)
	return f, columnsOf(defs), vs, err
}

// exportMax is the limit of the rows of the export.
const exportMax = 100_000

// Export answers exportFormResponses: the CSV of the responses the member reads and the audit line (no content).
func (s *Service) Export(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (fapi.FormResponsesExport, error) {
	var out fapi.FormResponsesExport
	err := s.runOn(ctx, tc, true, id, func(r *req) error {
		f, cols, vs, err := r.readable(ctx, id)
		if err != nil {
			return err
		}
		if len(vs) == 0 {
			return conflict(reasonNoResponses, textNoResponses)
		}
		vs = vs[:min(len(vs), exportMax)]
		rows := make([]csvRow, 0, len(vs))
		for _, x := range vs {
			author := textGuest
			if x.author != nil {
				if author, err = r.nameOf(ctx, x.author); err != nil {
					return err
				}
			}
			object := ""
			if x.subject != nil {
				object = x.subject.Label
			}
			rows = append(rows, csvRow{number: numberOf(x.number), at: x.submittedAt, author: author, object: object,
				version: x.version, status: x.review, vals: answersOf(x.answers)})
		}
		if err := r.record(ctx, auditExport, aggForm, f.id, map[string]any{keyFormID: f.id, "rowCount": len(rows)}); err != nil {
			return err
		}
		out = fapi.FormResponsesExport{FormId: f.id, FileName: fileName(f.name), ContentType: fapi.TextcsvCharsetUtf8,
			Content: csvOf(cols, rows), RowCount: len(rows), GeneratedAt: r.now}
		return nil
	})
	return out, err
}

// fileName is «{форма}.csv» without the characters a file name may not carry.
func fileName(name string) string {
	clean := strings.Map(func(c rune) rune {
		if strings.ContainsRune(`\/:*?"<>|`, c) || c < ' ' {
			return '_'
		}
		return c
	}, name)
	return clip(clean, 250) + ".csv"
}

// optionsMax is the limit of the choices of a CRM question (Q-W4.00-forms-23).
const optionsMax = 50

// Options answers listFormFieldOptions: the choices of a CRM question of the acting version by the rights of the
// respondent.
func (s *Service) Options(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, key string, q *string) (fapi.FormFieldOptionList, error) {
	out := fapi.FormFieldOptionList{Items: []fapi.FormFieldOption{}}
	err := s.runOn(ctx, tc, false, id, func(r *req) error {
		f, err := r.visibleForm(ctx, id, false)
		if err != nil {
			return err
		}
		var x *question
		if f.current != nil {
			v, err := r.version(ctx, f.id, *f.current)
			if err != nil {
				return err
			}
			for i := range v.def.Fields {
				if v.def.Fields[i].Key == key {
					x = &v.def.Fields[i]
				}
			}
		}
		if x == nil || !crmType(x.Type) {
			return notFound(textQuestionGone)
		}
		all, err := r.optionsOf(ctx, *x, strings.TrimSpace(deref(q)))
		if err != nil {
			return err
		}
		slices.SortStableFunc(all, func(a, b fapi.FormFieldOption) int { return strings.Compare(a.Label, b.Label) })
		out.Truncated = len(all) > optionsMax
		out.Items = append(out.Items, all[:min(len(all), optionsMax)]...)
		return nil
	})
	return out, err
}

// optionsOf are the choices of x containing text: active members, units of the level, CRM objects through the port.
func (r *req) optionsOf(ctx context.Context, x question, text string) ([]fapi.FormFieldOption, error) {
	if x.Type == fapi.FormQuestionTypePerson {
		return r.people(ctx, text)
	}
	if x.Type == fapi.FormQuestionTypeUnit {
		return r.units(ctx, x, text)
	}
	kind := fapi.FormQuestionRefKindVehicle
	if x.RefKind != nil {
		kind = *x.RefKind
	}
	if r.s.Objects == nil {
		return nil, nil
	}
	out, err := r.s.Objects.Options(ctx, r.tc, string(kind), text)
	return out, dependency(err)
}

// people are the active members of the organization whose name contains text.
func (r *req) people(ctx context.Context, text string) ([]fapi.FormFieldOption, error) {
	rows, err := r.tx.Query(ctx, `select id, full_name from people.person_profiles where archived_at is null`)
	if err != nil {
		return nil, store("people", err)
	}
	type person struct {
		id   uuid.UUID
		name string
	}
	var ps []person
	for rows.Next() {
		var p person
		if err := rows.Scan(&p.id, &p.name); err != nil {
			rows.Close()
			return nil, store("people", err)
		}
		ps = append(ps, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, store("people", err)
	}
	out := []fapi.FormFieldOption{}
	for _, p := range ps {
		if _, active, err := r.activeMember(ctx, p.id); err != nil || !active {
			if err != nil {
				return nil, err
			}
			continue
		}
		if text != "" && !strings.Contains(strings.ToLower(p.name), strings.ToLower(text)) {
			continue
		}
		out = append(out, fapi.FormFieldOption{Ref: fapi.ObjectRef{ModuleKey: moduleCore, EntityType: entityMember, EntityId: p.id},
			Label: p.name})
	}
	return out, nil
}
