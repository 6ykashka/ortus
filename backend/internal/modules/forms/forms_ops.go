package forms

import (
	"context"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Limits of the names (D-24 комплекта, Q-W4.00-forms-7, Q-W4.05-25): checked trimmed before the insert.
const (
	nameMin      = 3
	nameMax      = 200
	groupNameMin = 2
	groupNameMax = 80
)

// ListQuery is the filter of listForms.
type ListQuery struct {
	Q       *string
	OwnerMe bool
	Status  *string
	Group   *uuid.UUID
	Cursor  *string
	Limit   *int
}

// Forms answers listForms: the forms the member sees, the latest change first.
func (s *Service) Forms(ctx context.Context, tc tenantctx.TenantContext, q ListQuery) (fapi.FormPage, error) {
	out := fapi.FormPage{Items: []fapi.Form{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		fs, err := r.allForms(ctx)
		if err != nil {
			return err
		}
		var items []*formRow
		for _, f := range fs {
			ok, err := r.visible(ctx, f)
			if err != nil {
				return err
			}
			if ok && q.match(f, r.me()) {
				items = append(items, f)
			}
		}
		ids := make([]uuid.UUID, 0, len(items))
		for _, f := range items {
			ids = append(ids, f.id)
		}
		from, to, next, err := paginate(ids, q.Cursor, q.Limit)
		if err != nil {
			return err
		}
		for _, f := range items[from:to] {
			if err := r.counts(ctx, f); err != nil {
				return err
			}
			dto, err := r.formDTO(ctx, f)
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

// match reports whether f passes the filters of q for the member me.
func (q ListQuery) match(f *formRow, me uuid.UUID) bool {
	if q.Q != nil && !strings.Contains(strings.ToLower(f.name), strings.ToLower(strings.TrimSpace(*q.Q))) {
		return false
	}
	if q.OwnerMe && f.owner != me {
		return false
	}
	if q.Status != nil {
		want := *q.Status
		if want == "open" {
			want = statusPublished
		}
		if f.status != want {
			return false
		}
	}
	return q.Group == nil || (f.group != nil && *f.group == *q.Group)
}

// Form answers getForm.
func (s *Service) Form(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (fapi.Form, error) {
	var out fapi.Form
	err := s.runOn(ctx, tc, false, id, func(r *req) error {
		f, err := r.visibleForm(ctx, id, false)
		if err != nil {
			return err
		}
		out, err = r.formOut(ctx, f)
		return err
	})
	return out, err
}

// formOut is the answer of an operation on f: its counts and the form.
func (r *req) formOut(ctx context.Context, f *formRow) (fapi.Form, error) {
	if err := r.counts(ctx, f); err != nil {
		return fapi.Form{}, err
	}
	return r.formDTO(ctx, f)
}

// checkName trims a name of a form: 3–200 characters (text — the text of the operation).
func checkName(name, text string) (string, error) {
	n := strings.TrimSpace(name)
	if c := utf8.RuneCountInString(n); c < nameMin || c > nameMax {
		return "", invalid("name", text)
	}
	return n, nil
}

// nameTaken reports whether another form has the name (without regard to case).
func (r *req) nameTaken(ctx context.Context, name string, except uuid.UUID) (bool, error) {
	var taken bool
	err := r.tx.QueryRow(ctx, `select exists (select 1 from forms.forms where lower(btrim(name)) = lower(btrim($1)) and id <> $2)`,
		name, except).Scan(&taken)
	return taken, store("name", err)
}

// unitOf checks the area of a form: an org unit of the tenant (422 «Область не найдена»).
func (r *req) unitOf(ctx context.Context, id *uuid.UUID) (*uuid.UUID, error) {
	if id == nil {
		return nil, nil
	}
	var ok bool
	if err := r.tx.QueryRow(ctx, `select exists (select 1 from org.units where id = $1 and archived_at is null)`, *id).Scan(&ok); err != nil {
		return nil, store("unit", err)
	}
	if !ok {
		return nil, invalid("orgUnitId", textUnitMissing)
	}
	return new(*id), nil
}

// groupOf checks the group of a form (422 «Группа не найдена»).
func (r *req) groupOf(ctx context.Context, id *uuid.UUID) (*uuid.UUID, error) {
	if id == nil {
		return nil, nil
	}
	var ok bool
	if err := r.tx.QueryRow(ctx, `select exists (select 1 from forms.groups where id = $1)`, *id).Scan(&ok); err != nil {
		return nil, store("group", err)
	}
	if !ok {
		return nil, invalid("groupId", textGroupMissing)
	}
	return new(*id), nil
}

// CreateForm answers createForm: a draft without versions — empty, from a template, a copy or a definition.
func (s *Service) CreateForm(ctx context.Context, tc tenantctx.TenantContext, b fapi.FormCreate) (fapi.Form, error) {
	var out fapi.Form
	err := s.run(ctx, tc, true, func(r *req) error {
		f, tpl, err := r.newForm(ctx, b)
		if err != nil {
			return err
		}
		if err := r.insertForm(ctx, f); err != nil {
			if unique(err) {
				return invalid("name", "Форма «"+f.name+"» уже есть — измените название", "taken")
			}
			return store("insert form", err)
		}
		title := "Создан черновик формы «" + f.name + "»"
		if tpl != "" {
			title += " из шаблона «" + tpl + "»"
		}
		if err := r.event(ctx, evFormCreated, f.id, nil, title); err != nil {
			return err
		}
		if err := r.flushNotices(ctx); err != nil {
			return err
		}
		out, err = r.formOut(ctx, f)
		return err
	})
	return out, err
}

// newForm checks the body of createForm in the order of the prototype and returns the form and the name of its
// template ("" — none).
func (r *req) newForm(ctx context.Context, b fapi.FormCreate) (*formRow, string, error) {
	unit, err := r.creation(ctx, b)
	if err != nil {
		return nil, "", err
	}
	name, err := checkName(b.Name, textNameShortNew)
	if err != nil {
		return nil, "", err
	}
	if taken, err := r.nameTaken(ctx, name, uuid.Nil); err != nil || taken {
		if err == nil {
			err = invalid("name", "Форма «"+name+"» уже есть — измените название", "taken")
		}
		return nil, "", err
	}
	me := r.me()
	f := &formRow{id: uuid.New(), name: name, unit: unit, owner: me, status: statusDraft, set: defaultSettings(), revision: 1,
		createdAt: r.now, updated: r.now, draft: emptyDef(), draftRev: 1, draftSavedAt: new(r.now)}
	if me != uuid.Nil {
		f.draftSavedBy = new(me)
	}
	if f.group, err = r.groupOf(ctx, b.GroupId); err != nil {
		return nil, "", err
	}
	tpl, err := r.source(ctx, f, b)
	return f, tpl, err
}

// creation checks the sources of createForm (at most one) and the area of the new form: forms.create there.
func (r *req) creation(ctx context.Context, b fapi.FormCreate) (*uuid.UUID, error) {
	sources := 0
	for _, has := range []bool{b.TemplateId != nil, b.SourceFormId != nil, b.Definition != nil} {
		if has {
			sources++
		}
	}
	if sources > 1 {
		return nil, invalid("body", textSource)
	}
	unit, err := r.unitOf(ctx, b.OrgUnitId)
	if err != nil {
		return nil, err
	}
	if ok, err := r.canIn(ctx, unit, actCreate); err != nil || !ok {
		if err == nil {
			err = forbidden(need[actCreate])
		}
		return nil, err
	}
	return unit, nil
}

// source fills the draft, the settings, the module and the group of f from its source: a template (403
// module_not_installed when its module is not active), a form the member sees or a definition.
func (r *req) source(ctx context.Context, f *formRow, b fapi.FormCreate) (string, error) {
	switch {
	case b.TemplateId != nil:
		return r.fromTemplate(ctx, f, *b.TemplateId)
	case b.SourceFormId != nil:
		return "", r.fromForm(ctx, f, *b.SourceFormId, b.GroupId == nil)
	case b.Definition != nil:
		if errs := structureErrors(*b.Definition); len(errs) > 0 {
			return "", invalidAll(errs, "")
		}
		f.draft = cloneDef(*b.Definition)
	}
	return "", nil
}

// fromTemplate fills f from the template id; its module must be active.
func (r *req) fromTemplate(ctx context.Context, f *formRow, id string) (string, error) {
	t, ok := templateByID(id)
	if !ok {
		return "", invalid("templateId", textTplNotFound)
	}
	if t.module != "" {
		on, err := r.moduleActive(ctx, t.module)
		if err != nil {
			return "", err
		}
		if !on {
			return "", problemModule(t.module)
		}
		f.module = new(t.module)
	}
	f.draft, f.set, f.template = t.definition(), t.settings(), new(t.id)
	return t.name, nil
}

// fromForm fills f as a copy of the form id the member sees: its draft, settings, module (and group, keepGroup).
func (r *req) fromForm(ctx context.Context, f *formRow, id uuid.UUID, keepGroup bool) error {
	src, err := r.form(ctx, id, false)
	if err != nil {
		return err
	}
	visible := false
	if src != nil {
		if visible, err = r.visible(ctx, src); err != nil {
			return err
		}
	}
	if !visible {
		return invalid("sourceFormId", textFormNotFound)
	}
	f.draft, f.set, f.module = cloneDef(src.draft), src.set, src.module
	f.set.extra.Shortened = nil
	if keepGroup {
		f.group = src.group
	}
	return nil
}

// moduleLabels are the names of the industry modules of the templates (catalog_data.go of modulesreg).
var moduleLabels = map[string]string{moduleFleet: "Логистика", moduleRepairs: "Ремонт и стройка", moduleSpa: "Салон и SPA"}

// problemModule is 403 module_not_installed «Модуль «…» не подключён: шаблон недоступен» (api.js:591).
func problemModule(module string) error {
	name := moduleLabels[module]
	if name == "" {
		name = module
	}
	return problem.New(codeModule, "Модуль «"+name+"» не подключён: шаблон недоступен")
}

// unique reports whether err is a violation of a unique index.
func unique(err error) bool {
	pe, ok := errors.AsType[*pgconn.PgError](err)
	return ok && pe.Code == "23505"
}

// Templates answers listFormTemplates.
func (s *Service) Templates(ctx context.Context, tc tenantctx.TenantContext) (fapi.FormTemplateList, error) {
	var out fapi.FormTemplateList
	err := s.run(ctx, tc, false, func(r *req) error {
		active := map[string]bool{}
		for _, m := range []string{moduleFleet, moduleRepairs, moduleSpa} {
			on, err := r.moduleActive(ctx, m)
			if err != nil {
				return err
			}
			active[m] = on
		}
		out = templateList(func(m string) bool { return active[m] })
		return nil
	})
	return out, err
}
