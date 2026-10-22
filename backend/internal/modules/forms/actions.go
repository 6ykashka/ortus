package forms

import (
	"context"
	"strconv"
	"strings"

	"github.com/google/uuid"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Kinds of a rule (forms.rules.kind).
const (
	kindTask   = "task"
	kindNotify = "notify"
	kindEmail  = "email"
	kindHTTP   = "http"
	kindKB     = "kb"
)

// Triggers of a rule (forms.rules.trigger).
const (
	triggerSubmitted = "submitted"
	triggerAccepted  = "accepted"
)

// Texts of the journal of actions (the reference and msw/forms/no-reference.ts).
const (
	textPageGone    = "страница удалена из Базы знаний"
	textTasksOff    = "модуль «Задачи» недоступен"
	textRunning     = "выполняется"
	textNotifyGone  = "сотрудник не найден"
	vatAt           = "$at"
	vatAuthor       = "$author"
	vatObject       = "$object"
	vatID           = "$id"
	vatForm         = "$form"
	vatVer          = "$ver"
	formValMax      = 500
	journalTextMax  = 500
	journalErrorMax = 500
)

// fits reports whether rule runs for x (kbFits of the prototype): «После принятия ответа» — an accepted response;
// «Только если» — the answer to its question equals its value (the key of an option, true/false).
func fits(rule *ruleRow, x *responseRow) bool {
	if !rule.enabled {
		return false
	}
	if rule.trigger == triggerAccepted && x.review != reviewAccepted {
		return false
	}
	if rule.condField == nil {
		return true
	}
	vals := answersOf(x.answers)
	v, ok := vals[*rule.condField]
	if !ok {
		return false
	}
	return has(&v, deref(rule.condVal))
}

// runRules runs the enabled rules of f that fit x, once per «response × rule».
func (r *req) runRules(ctx context.Context, f *formRow, x *responseRow) error {
	rules, err := r.rules(ctx, f.id)
	if err != nil {
		return err
	}
	for _, rule := range rules {
		if !fits(rule, x) || rule.kind == kindEmail || rule.kind == kindHTTP {
			continue // letters and HTTP requests are not sent on the show (Q-W4.00-forms-15)
		}
		if _, err := r.runRule(ctx, f, x, rule); err != nil {
			return err
		}
	}
	return nil
}

// runRule runs rule for x in the transaction of the command under the lock of the row of the journal (response ×
// rule): the row is written first (a placeholder «выполняется» — ok false), then taken for update — a parallel retry or
// backfill waits for the lock and finds the done result; a done action is not repeated (Q-W4.05-27).
func (r *req) runRule(ctx context.Context, f *formRow, x *responseRow, rule *ruleRow) (actionRow, error) {
	if _, err := r.tx.Exec(ctx, `insert into forms.response_actions (response_id, rule_id, rule_version, kind, ok, at, error)
		values ($1, $2, $3, $4, false, $5, $6) on conflict (response_id, rule_id) do nothing`,
		x.id, rule.id, rule.version, rule.kind, r.now, textRunning); err != nil {
		return actionRow{}, store("journal", err)
	}
	var done actionRow
	err := r.tx.QueryRow(ctx, `select rule_id, rule_version, kind, ok, at, text, error, kb_node_id, task_id
		from forms.response_actions where response_id = $1 and rule_id = $2 for update`, x.id, rule.id).
		Scan(&done.rule, &done.version, &done.kind, &done.ok, &done.at, &done.text, &done.err, &done.node, &done.task)
	if err != nil {
		return actionRow{}, store("journal", err)
	}
	if done.ok {
		return done, nil
	}
	a, err := r.act(ctx, f, x, rule)
	if err != nil {
		return actionRow{}, err
	}
	if _, err := r.tx.Exec(ctx, `update forms.response_actions set rule_version = $3, kind = $4, ok = $5, at = $6, text = $7,
		error = $8, kb_node_id = $9, task_id = $10 where response_id = $1 and rule_id = $2`, x.id, rule.id, a.version, a.kind, a.ok,
		a.at, a.text, a.err, a.node, a.task); err != nil {
		return actionRow{}, store("journal", err)
	}
	x.actions = slices2(x.actions, a)
	if !a.ok {
		if err := r.actionFailed(ctx, f, x, rule, deref(a.err)); err != nil {
			return actionRow{}, err
		}
	}
	return a, nil
}

// slices2 replaces the line of the rule of a in the journal.
func slices2(list []actionRow, a actionRow) []actionRow {
	out := list[:0:0]
	for _, x := range list {
		if x.rule != a.rule {
			out = append(out, x)
		}
	}
	return append(out, a)
}

// act performs the action of rule for x: a task, a row or a record of the knowledge base, a notification.
func (r *req) act(ctx context.Context, f *formRow, x *responseRow, rule *ruleRow) (actionRow, error) {
	a := actionRow{rule: rule.id, version: rule.version, kind: rule.kind, at: r.now}
	var (
		text, refused string
		err           error
	)
	switch rule.kind {
	case kindTask:
		text, refused, err = r.actTask(ctx, f, x, rule, &a)
	case kindKB:
		text, refused, err = r.actKB(ctx, f, x, rule, &a)
	case kindNotify:
		text, refused, err = r.actNotify(ctx, f, x, rule)
	}
	if err != nil {
		return a, err
	}
	a.ok = refused == ""
	if a.ok {
		a.text = new(clip(text, journalTextMax))
	} else {
		a.err = new(clip(refused, journalErrorMax))
	}
	return a, nil
}

// author is the author of a rule as the ports check him: active, the owner of the business, his name.
func (r *req) author(ctx context.Context, rule *ruleRow) (Viewer, bool, string, error) {
	m, active, err := r.activeMember(ctx, rule.author)
	if err != nil {
		return Viewer{}, false, "", err
	}
	name, err := r.nameOf(ctx, &rule.author)
	return Viewer{Member: rule.author, Owner: m.Owner}, active, name, err
}

// actTask creates the task of the rule on behalf of its author (Q-W4.00-forms-13): the title and the assignee of the
// rule, the answers and the response in the description.
func (r *req) actTask(ctx context.Context, f *formRow, x *responseRow, rule *ruleRow, a *actionRow) (string, string, error) {
	spec := rule.config.Task
	if spec == nil || r.s.Tasks == nil {
		return "", textTasksOff, nil
	}
	who, active, name, err := r.author(ctx, rule)
	if err != nil {
		return "", "", err
	}
	if !active {
		return "", "у автора правила " + name + " нет права «Создавать» задачи", nil
	}
	desc, err := r.description(ctx, f, x)
	if err != nil {
		return "", "", err
	}
	res, err := r.s.Tasks.CreateFormTask(ctx, r.tx, r.tc.TenantID, FormTask{Project: spec.ProjectId, Author: who.Member,
		AuthorOwner: who.Owner, AuthorName: name, Assignee: spec.AssigneeMemberId, Title: spec.Title, Description: desc,
		Response: x.id, Origin: "Ответ " + numberOf(x.number) + " формы «" + f.name + "»"})
	if err != nil {
		return "", "", dependency(err)
	}
	if res.Refused != "" {
		return "", res.Refused, nil
	}
	a.task = new(res.ID)
	return "Задача " + res.Key + " «" + spec.Title + "» · " + res.Assigned + " · " + res.Status, "", nil
}

// description is the description of the task of a rule: «вопрос: ответ» of the version and «Ответ R-… формы «…»».
func (r *req) description(ctx context.Context, f *formRow, x *responseRow) (string, error) {
	v, err := r.version(ctx, f.id, x.version)
	if err != nil {
		return "", err
	}
	var lines []string
	vals := answersOf(x.answers)
	if v != nil {
		for _, q := range v.def.Fields {
			if q.Type == fapi.FormQuestionTypeStatement {
				continue
			}
			got, ok := vals[q.Key]
			if !ok {
				continue
			}
			if l := labelOf(&q, &got); l != "" {
				lines = append(lines, q.Label+": "+l)
			}
		}
	}
	lines = append(lines, "Ответ "+numberOf(x.number)+" формы «"+f.name+"»")
	return clip(strings.Join(lines, "\n"), 5000), nil
}

// actKB writes the row or the record of the rule on behalf of its author (kbRun of the domain W4.20 on the knowledge
// base of W4.31: PD-53, the access of the page).
func (r *req) actKB(ctx context.Context, f *formRow, x *responseRow, rule *ruleRow, a *actionRow) (string, string, error) {
	spec := rule.config.KB
	if spec == nil || r.s.Knowledge == nil {
		return "", textPageGone, nil
	}
	who, active, name, err := r.author(ctx, rule)
	if err != nil {
		return "", "", err
	}
	if !active {
		return "", "у автора правила " + name + " нет права «Создавать» в Базе знаний", nil
	}
	vars, fields, err := r.vars(ctx, f, x)
	if err != nil {
		return "", "", err
	}
	val := func(src string) string { return formVal(src, vars, fields, x) }
	rec := KBRecord{Author: who, AuthorName: name, Node: spec.NodeId, Bottom: spec.Position == fapi.FormRuleKbInputPositionBottom,
		Form: f.id, Response: numberOf(x.number), Version: x.version, At: r.now}
	if spec.Mode == fapi.FormRuleKbInputModeTable {
		rec.Table, rec.Cells = deref(spec.TableId), cellsOf(*spec, val)
	} else {
		rec.Head, rec.Lines = recordOf(*spec, val, numberOf(x.number))
	}
	res, err := r.s.Knowledge.Write(ctx, r.tx, r.tc.TenantID, rec)
	if err != nil {
		return "", "", dependency(err)
	}
	if res.Refused == "" {
		a.node = new(spec.NodeId)
	}
	return res.Text, res.Refused, nil
}

// cellsOf are the cells of a row: the columns with a source (the last source of a column wins).
func cellsOf(spec fapi.FormRuleKbInput, val func(string) string) map[uuid.UUID]string {
	out := map[uuid.UUID]string{}
	for _, fd := range spec.Fields {
		if fd.ColumnId != nil && fd.Source != "" {
			out[*fd.ColumnId] = val(fd.Source)
		}
	}
	return out
}

// recordOf is the head (its source, $object by default; the number of the response when empty) and the lines of a
// record — the fields with a value.
func recordOf(spec fapi.FormRuleKbInput, val func(string) string, number string) (string, []KBLine) {
	head := vatObject
	if spec.Head != nil && *spec.Head != "" {
		head = *spec.Head
	}
	h := clip(val(head), 200)
	if h == "" {
		h = number
	}
	var lines []KBLine
	for _, fd := range spec.Fields {
		if v := val(fd.Source); fd.Source != "" && v != "" {
			lines = append(lines, KBLine{Name: fd.Name, Value: v})
		}
	}
	return h, lines
}

// vars are the values FORM_VARS of x and the questions of its version.
func (r *req) vars(ctx context.Context, f *formRow, x *responseRow) (map[string]string, []question, error) {
	v, err := r.version(ctx, f.id, x.version)
	if err != nil {
		return nil, nil, err
	}
	author := textGuest
	if x.author != nil {
		if author, err = r.nameOf(ctx, x.author); err != nil {
			return nil, nil, err
		}
	}
	object := ""
	if x.subject != nil {
		object = x.subject.Label
	}
	vars := map[string]string{vatAt: x.submittedAt.In(moscow).Format("02.01 15:04"), vatAuthor: author, vatObject: object,
		vatID: numberOf(x.number), vatForm: f.name, vatVer: "v" + strconv.Itoa(x.version)}
	var fields []question
	if v != nil {
		fields = v.def.Fields
	}
	return vars, fields, nil
}

// formVal is the value of a cell or a line of the knowledge base (formVal of the domain W4.20): a variable of
// FORM_VARS or the label of the answer to a question; files stay in the response («… · файлы в ответе R-…»).
func formVal(src string, vars map[string]string, fields []question, x *responseRow) string {
	if v, ok := vars[src]; ok {
		return v
	}
	vals := answersOf(x.answers)
	got, ok := vals[src]
	if !ok {
		return ""
	}
	var q *question
	for i := range fields {
		if fields[i].Key == src {
			q = &fields[i]
		}
	}
	l := labelOf(q, &got)
	if l == "" {
		return ""
	}
	if q != nil && q.Type == fapi.FormQuestionTypePhoto {
		return l + " · файлы в ответе " + numberOf(x.number)
	}
	return clip(l, formValMax)
}

// actNotify notifies the member of the rule in the inbox («Уведомление в CRM → …»); a member no longer active is a
// refusal of the journal (return 1).
func (r *req) actNotify(ctx context.Context, f *formRow, x *responseRow, rule *ruleRow) (string, string, error) {
	spec := rule.config.Notify
	if spec == nil {
		return "", textNotifyGone, nil
	}
	if _, active, err := r.activeMember(ctx, spec.MemberId); err != nil || !active {
		return "", textNotifyGone, err
	}
	name, err := r.nameOf(ctx, &spec.MemberId)
	if err != nil {
		return "", "", err
	}
	r.events = append(r.events, pendingNotice{kind: evSubmitted, title: "Форма «" + f.name + "»: ответ " + numberOf(x.number),
		object: x.id, entity: entityResponse, event: uuid.New(), to: []uuid.UUID{spec.MemberId}})
	return "Уведомление в CRM → " + name, "", nil
}

// actionFailed publishes forms.action.failed.v1 and notifies the owners (api.js:116).
func (r *req) actionFailed(ctx context.Context, f *formRow, x *responseRow, rule *ruleRow, why string) error {
	id, err := r.publish(ctx, evActionFailed, aggResponse, x.id, map[string]any{keyFormID: f.id, keyResponseID: x.id,
		"ruleId": rule.id, "kind": rule.kind, "error": why})
	if err != nil {
		return store("event", err)
	}
	title := "Форма «" + f.name + "»: ответ " + numberOf(x.number) + " не сохранён в Базу знаний — " + why
	if rule.kind == kindTask {
		title = "Форма «" + f.name + "»: по ответу " + numberOf(x.number) + " задача не создана — " + why
	}
	r.events = append(r.events, pendingNotice{kind: evActionFailed, title: title, object: x.id, entity: entityResponse, event: id})
	return nil
}

// problemNonceUsed is 410 nonce_used of a nonce whose response was submitted.
func problemNonceUsed() error { return problem.New(codeNonceUsed, textNonceUsed) }
