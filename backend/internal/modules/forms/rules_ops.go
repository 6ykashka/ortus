package forms

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Rules answers listFormRules: the rules of the form in the order of creation.
func (s *Service) Rules(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (fapi.FormRuleList, error) {
	out := fapi.FormRuleList{Items: []fapi.FormRule{}}
	err := s.runOn(ctx, tc, false, id, func(r *req) error {
		f, err := r.visibleForm(ctx, id, false)
		if err != nil {
			return err
		}
		rules, err := r.rules(ctx, f.id)
		if err != nil {
			return err
		}
		rs, err := r.responses(ctx, f.id)
		if err != nil {
			return err
		}
		for _, x := range rules {
			dto, err := r.ruleDTO(ctx, f, x, rs)
			if err != nil {
				return err
			}
			out.Items = append(out.Items, dto)
		}
		return nil
	})
	return out, err
}

// ruleDTO is a rule of f as the member sees it: counters over the responses rs; the address of a letter and the URL of
// a request only with forms.manage (Q-W4.05-18); the page of the knowledge base — when he sees it.
func (r *req) ruleDTO(ctx context.Context, f *formRow, x *ruleRow, rs []*responseRow) (fapi.FormRule, error) {
	author, err := r.memberRef(ctx, &x.author)
	if err != nil {
		return fapi.FormRule{}, err
	}
	out := fapi.FormRule{Id: x.id, FormId: f.id, Kind: fapi.FormRuleKind(x.kind), Enabled: x.enabled, Version: x.version,
		Trigger: fapi.FormRuleTrigger(x.trigger), Condition: fapi.FormRuleCondition{FieldKey: x.condField, Value: x.condVal},
		Author: author, CreatedAt: x.createdAt, UpdatedAt: x.updated, Revision: x.revision, Task: x.config.Task, Notify: x.config.Notify}
	out.DoneCount, out.FailedCount, out.PendingBackfillCount = ruleCounts(x, rs)
	manage, err := r.can(ctx, f, actManage)
	if err != nil {
		return out, err
	}
	if manage {
		out.Email, out.Http = x.config.Email, x.config.HTTP
	}
	if x.config.KB != nil {
		kb, err := r.kbDTO(ctx, *x.config.KB)
		if err != nil {
			return out, err
		}
		out.Kb = &kb
	}
	return out, nil
}

// ruleCounts are the counters of rule x over the responses rs: done, failed, waiting for «Перенести».
func ruleCounts(x *ruleRow, rs []*responseRow) (done, failed, pending int) {
	for _, resp := range rs {
		i := slices.IndexFunc(resp.actions, func(a actionRow) bool { return a.rule == x.id })
		switch {
		case i >= 0 && resp.actions[i].ok:
			done++
		case i >= 0:
			failed++
		}
		if x.kind == kindKB && fits(x, resp) && (i < 0 || !resp.actions[i].ok) {
			pending++
		}
	}
	return done, failed, pending
}

// kbDTO is FormRuleKb with the page and the table as the member sees them.
func (r *req) kbDTO(ctx context.Context, in fapi.FormRuleKbInput) (fapi.FormRuleKb, error) {
	out := fapi.FormRuleKb{NodeId: in.NodeId, Mode: fapi.FormRuleKbMode(in.Mode), TableId: in.TableId, Head: in.Head,
		Position: fapi.FormRuleKbPosition(in.Position), Fields: in.Fields, ShowLink: in.ShowLink,
		AllEmployeesConfirmed: in.AllEmployeesConfirmed}
	if out.Fields == nil {
		out.Fields = []fapi.FormRuleKbField{}
	}
	n, ok, err := r.node(ctx, in.NodeId)
	if err != nil || !ok || !n.Visible {
		return out, err
	}
	out.Node = &fapi.KnowledgeNodeRef{Id: n.ID, Title: n.Title}
	if in.TableId != nil {
		for _, t := range n.Tables {
			if t.ID == *in.TableId {
				out.TableTitle = new(t.Title)
			}
		}
	}
	return out, nil
}

// node is a node of the knowledge base as the member sees it.
func (r *req) node(ctx context.Context, id uuid.UUID) (KBNode, bool, error) {
	if r.s.Knowledge == nil {
		return KBNode{}, false, nil
	}
	ns, err := r.s.Knowledge.Nodes(ctx, r.tx, r.tc.TenantID, Viewer{Member: r.me(), Owner: r.tc.Owner}, []uuid.UUID{id})
	if err != nil {
		return KBNode{}, false, dependency(err)
	}
	n, ok := ns[id]
	return n, ok, nil
}

// ruleInput is a rule being checked: its kind, trigger, condition and the objects of the kinds sent.
type ruleInput struct {
	kind      string
	trigger   string
	condition fapi.FormRuleCondition
	config    ruleConfig
}

// Texts of the editor of an action (dc:645–678) and of the scenario server (no-reference).
const (
	textOtherKind   = "Настройки другого вида действия"
	textConfigure   = "Настройте действие"
	textCondition   = "Укажите вопрос и ответ условия"
	textTaskTitle   = "Укажите название задачи"
	textTaskProject = "Нет права создавать задачи в проекте"
	textAssignee    = "Выберите исполнителя"
	textNotifyWho   = "Выберите, кого уведомить"
	textEmail       = "Укажите адрес почты"
	textHTTP        = "Адрес запроса должен начинаться с https://"
	textKBPublic    = "Публичная форма: в Базу знаний попадают только принятые ответы, чтобы туда не попал спам."
	textKBPage      = "Выберите страницу Базы знаний"
	textKBTable     = "Выберите таблицу"
	textKBColumns   = "Укажите данные хотя бы для одного столбца"
	textKBWhat      = "Выберите, что записать"
	textKBName      = "У поля нет названия"
	textKBNames     = "Названия полей повторяются"
	textKBConfirm   = "Подтвердите, что записи увидят все сотрудники с доступом к странице"
)

// objects are the objects of the kinds a rule input carries.
func (c ruleConfig) objects() map[string]bool {
	return map[string]bool{kindTask: c.Task != nil, kindNotify: c.Notify != nil, kindEmail: c.Email != nil, kindHTTP: c.HTTP != nil,
		kindKB: c.KB != nil}
}

// checkRule checks a rule of f in the order of the scenario server: the object of its kind only, the condition on a
// question of choice or «Да / нет» of the draft or the acting version, the settings of the kind.
func (r *req) checkRule(ctx context.Context, f *formRow, x ruleInput) error {
	objs := x.config.objects()
	for _, k := range []string{kindTask, kindNotify, kindEmail, kindHTTP, kindKB} {
		if k != x.kind && objs[k] {
			return invalid(k, textOtherKind)
		}
	}
	if !objs[x.kind] {
		return invalid(x.kind, textConfigure)
	}
	if err := r.checkCondition(ctx, f, x.condition); err != nil {
		return err
	}
	return r.checkKind(ctx, f, x)
}

// checkKind checks the settings of the kind of x.
func (r *req) checkKind(ctx context.Context, f *formRow, x ruleInput) error {
	switch x.kind {
	case kindTask:
		return r.checkTask(ctx, *x.config.Task)
	case kindNotify:
		if _, active, err := r.activeMember(ctx, x.config.Notify.MemberId); err != nil || !active {
			if err == nil {
				err = invalid("notify.memberId", textNotifyWho)
			}
			return err
		}
	case kindEmail:
		if to := strings.TrimSpace(string(x.config.Email.To)); to == "" || !emailRE.MatchString(to) {
			return invalid("email.to", textEmail)
		}
	case kindHTTP:
		if !strings.HasPrefix(x.config.HTTP.Url, "https://") || utf8.RuneCountInString(x.config.HTTP.Url) > 2000 {
			return invalid("http.url", textHTTP)
		}
	case kindKB:
		return r.checkKB(ctx, f, x.trigger, *x.config.KB)
	}
	return nil
}

// checkCondition checks «Только если»: both or neither, a question of choice or «Да / нет».
func (r *req) checkCondition(ctx context.Context, f *formRow, c fapi.FormRuleCondition) error {
	if (c.FieldKey == nil) != (c.Value == nil) {
		return invalid("condition", textCondition)
	}
	if c.FieldKey == nil {
		return nil
	}
	if utf8.RuneCountInString(*c.Value) > 64 {
		return invalid("condition.value", textCondition)
	}
	defs := []def{f.draft}
	if f.current != nil {
		v, err := r.version(ctx, f.id, *f.current)
		if err != nil {
			return err
		}
		if v != nil {
			defs = append(defs, v.def)
		}
	}
	for _, d := range defs {
		for _, q := range d.Fields {
			if q.Key == *c.FieldKey && (optionType(q.Type) || q.Type == fapi.FormQuestionTypeBool) {
				return nil
			}
		}
	}
	return invalid("condition.fieldKey", textQuestionGone)
}

// checkTask checks «Создать задачу»: the title, the project where the member may create tasks, an active assignee.
func (r *req) checkTask(ctx context.Context, t fapi.FormRuleTask) error {
	if strings.TrimSpace(t.Title) == "" {
		return invalid("task.title", textTaskTitle)
	}
	ok := false
	if r.s.Tasks != nil {
		var err error
		if ok, err = r.s.Tasks.MayCreate(ctx, r.tx, r.tc.TenantID, r.me(), r.tc.Owner, t.ProjectId); err != nil {
			return dependency(err)
		}
	}
	if !ok {
		return invalid("task.projectId", textTaskProject)
	}
	if _, active, err := r.activeMember(ctx, t.AssigneeMemberId); err != nil || !active {
		if err == nil {
			err = invalid("task.assigneeMemberId", textAssignee)
		}
		return err
	}
	return nil
}

// checkKB checks «Сохранить в Базу знаний»: accepted responses of a public form only, a page the member sees, a table
// of it with a column to fill or a field to record, named fields without repeats, the confirmation of a page every
// employee sees.
func (r *req) checkKB(ctx context.Context, f *formRow, trigger string, kb fapi.FormRuleKbInput) error {
	if f.set.access == accessPublic && trigger == triggerSubmitted {
		return invalid("trigger", textKBPublic)
	}
	n, ok, err := r.node(ctx, kb.NodeId)
	if err != nil {
		return err
	}
	if !ok || !n.Visible {
		return invalid("kb.nodeId", textKBPage)
	}
	if err := kbTarget(n, kb); err != nil {
		return err
	}
	if err := kbNames(kb.Fields); err != nil {
		return err
	}
	if n.AllEmployees && !kb.AllEmployeesConfirmed {
		return invalid("kb.allEmployeesConfirmed", textKBConfirm)
	}
	return nil
}

// kbTarget checks the table of a row (of the page n, with a column to fill) or the fields of a record.
func kbTarget(n KBNode, kb fapi.FormRuleKbInput) error {
	if kb.Mode != fapi.FormRuleKbInputModeTable {
		if !slices.ContainsFunc(kb.Fields, func(x fapi.FormRuleKbField) bool { return x.Source != "" }) {
			return invalid("kb.fields", textKBWhat)
		}
		return nil
	}
	if kb.TableId == nil || !slices.ContainsFunc(n.Tables, func(t KBTable) bool { return t.ID == *kb.TableId }) {
		return invalid("kb.tableId", textKBTable)
	}
	if !slices.ContainsFunc(kb.Fields, func(x fapi.FormRuleKbField) bool { return x.ColumnId != nil && x.Source != "" }) {
		return invalid("kb.fields", textKBColumns)
	}
	return nil
}

// kbNames checks that every field is named and no name repeats (case and spaces aside).
func kbNames(fields []fapi.FormRuleKbField) error {
	seen := map[string]bool{}
	for _, x := range fields {
		name := strings.ToLower(strings.TrimSpace(x.Name))
		if name == "" {
			return invalid("kb.fields", textKBName)
		}
		if seen[name] {
			return invalid("kb.fields", textKBNames)
		}
		seen[name] = true
	}
	return nil
}

// CreateRule answers createFormRule: the author is the requesting member — the action runs on his behalf.
func (s *Service) CreateRule(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b fapi.FormRuleCreate) (fapi.FormRule, error) {
	var out fapi.FormRule
	err := s.runOn(ctx, tc, true, id, func(r *req) error {
		f, err := r.visibleForm(ctx, id, false)
		if err != nil {
			return err
		}
		if err := r.need(ctx, f, actManage); err != nil {
			return err
		}
		in := ruleInput{kind: string(b.Kind), trigger: string(b.Trigger), config: ruleConfig{Task: b.Task, Notify: b.Notify,
			Email: b.Email, HTTP: b.Http, KB: b.Kb}}
		if b.Condition != nil {
			in.condition = *b.Condition
		}
		if err := r.checkRule(ctx, f, in); err != nil {
			return err
		}
		x := &ruleRow{id: uuid.New(), form: f.id, kind: in.kind, enabled: deref(b.Enabled) || b.Enabled == nil, version: 1,
			trigger: in.trigger, condField: in.condition.FieldKey, condVal: in.condition.Value, config: in.config, author: r.me(),
			revision: 1, createdAt: r.now, updated: r.now}
		if err := r.insertRule(ctx, x); err != nil {
			return err
		}
		rs, err := r.responses(ctx, f.id)
		if err != nil {
			return err
		}
		out, err = r.ruleDTO(ctx, f, x, rs)
		return err
	})
	return out, err
}

func (r *req) insertRule(ctx context.Context, x *ruleRow) error {
	raw, err := json.Marshal(x.config)
	if err != nil {
		return err
	}
	_, err = r.tx.Exec(ctx, `insert into forms.rules (id, form_id, kind, enabled, version, trigger, condition_field, condition_value,
		config, author_id, revision, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11, $12, $12)`,
		x.id, x.form, x.kind, x.enabled, x.version, x.trigger, x.condField, x.condVal, string(raw), x.author, x.revision, x.createdAt)
	return store("insert rule", err)
}

// UpdateRule answers updateFormRule: «Включено» keeps the version; «Изменить» raises it and makes the requesting
// member the author; the kind does not change.
func (s *Service) UpdateRule(ctx context.Context, tc tenantctx.TenantContext, form, id uuid.UUID, ifMatch string, b fapi.FormRulePatch) (fapi.FormRule, error) {
	var out fapi.FormRule
	err := s.runOn(ctx, tc, true, form, func(r *req) error {
		f, err := r.visibleForm(ctx, form, false)
		if err != nil {
			return err
		}
		if err := r.need(ctx, f, actManage); err != nil {
			return err
		}
		x, err := r.rule(ctx, f.id, id, true)
		if err != nil {
			return err
		}
		if x == nil {
			return notFound(textRuleNotFound)
		}
		if err := checkRev(ifMatch, x.revision, textRuleChanged); err != nil {
			return err
		}
		if b.Enabled != nil {
			x.enabled = *b.Enabled
		}
		if edited(b) {
			if err := r.editRule(ctx, f, x, b); err != nil {
				return err
			}
		}
		x.revision++
		x.updated = r.now
		raw, err := json.Marshal(x.config)
		if err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update forms.rules set enabled = $2, version = $3, trigger = $4, condition_field = $5,
			condition_value = $6, config = $7::jsonb, author_id = $8, revision = $9, updated_at = $10 where id = $1`,
			x.id, x.enabled, x.version, x.trigger, x.condField, x.condVal, string(raw), x.author, x.revision, x.updated); err != nil {
			return store("update rule", err)
		}
		rs, err := r.responses(ctx, f.id)
		if err != nil {
			return err
		}
		out, err = r.ruleDTO(ctx, f, x, rs)
		return err
	})
	return out, err
}

// edited reports whether a patch changes the action (anything but «Включено»).
func edited(b fapi.FormRulePatch) bool {
	return b.Trigger != nil || b.Condition != nil || b.Task != nil || b.Notify != nil || b.Email != nil || b.Http != nil || b.Kb != nil
}

// editRule applies «Изменить» to x: the merged rule is checked, the version raised, the author — the member.
func (r *req) editRule(ctx context.Context, f *formRow, x *ruleRow, b fapi.FormRulePatch) error {
	next := ruleInput{kind: x.kind, trigger: x.trigger, condition: fapi.FormRuleCondition{FieldKey: x.condField, Value: x.condVal},
		config: x.config}
	if b.Trigger != nil {
		next.trigger = string(*b.Trigger)
	}
	if b.Condition != nil {
		next.condition = *b.Condition
	}
	for _, o := range []struct {
		set  bool
		into func()
	}{
		{b.Task != nil, func() { next.config.Task = b.Task }}, {b.Notify != nil, func() { next.config.Notify = b.Notify }},
		{b.Email != nil, func() { next.config.Email = b.Email }}, {b.Http != nil, func() { next.config.HTTP = b.Http }},
		{b.Kb != nil, func() { next.config.KB = b.Kb }},
	} {
		if o.set {
			o.into()
		}
	}
	if err := r.checkRule(ctx, f, next); err != nil {
		return err
	}
	x.trigger, x.condField, x.condVal, x.config = next.trigger, next.condition.FieldKey, next.condition.Value, next.config
	x.version++
	x.author = r.me()
	return nil
}

// DeleteRule answers deleteFormRule: the journal of the responses keeps its lines.
func (s *Service) DeleteRule(ctx context.Context, tc tenantctx.TenantContext, form, id uuid.UUID, ifMatch string) error {
	return s.runOn(ctx, tc, true, form, func(r *req) error {
		f, err := r.visibleForm(ctx, form, false)
		if err != nil {
			return err
		}
		if err := r.need(ctx, f, actManage); err != nil {
			return err
		}
		x, err := r.rule(ctx, f.id, id, true)
		if err != nil {
			return err
		}
		if x == nil {
			return notFound(textRuleNotFound)
		}
		if err := checkRev(ifMatch, x.revision, textRuleChanged); err != nil {
			return err
		}
		_, err = r.tx.Exec(ctx, `delete from forms.rules where id = $1`, x.id)
		return store("delete rule", err)
	})
}
