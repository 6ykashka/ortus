package repairs

import (
	"context"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the templates (design/docs/19 «Шаблоны объекта и справочник расценок»).
const (
	textTemplateNotFound = "Шаблон не найден."
	textTemplateChanged  = "Шаблон уже изменили — обновите страницу"
	textTemplateName     = "Назовите шаблон."
	textLineVolume       = "Укажите количество или формулу из замера."
	textLineItem         = "Позиции нет в справочнике."
	textLineQty          = "Количество — число не больше трёх знаков после запятой."
	textLineCoef         = "Коэффициент — число больше нуля."
	textLineFormula      = "Неизвестная формула."
	textStageName        = "Назовите этап."
	textStageRate        = "Выработка должна быть больше нуля."
	textStagePause       = "Пауза — от −60 до 60 дней."
	textDocumentKind     = "Неизвестный документ."
	textChecklistItem    = "Пункт чек-листа — от 1 до 300 знаков."
	textWarranty         = "Гарантия — от 1 до 120 месяцев."
	textNoCurrent        = "Нет действующей версии сметы."
	partEstimate         = "estimate"
	partMaterial         = "material"
	defaultKind          = "ремонт"
)

var documentKinds = []string{docContract, docAgreement, docAct, docInvoice, docHandOver, docWarranty}

// tplRow is a template (repairs.templates) with the parts it keeps in its own columns.
type tplRow struct {
	id                        uuid.UUID
	name, kind, source        string
	copiedFrom, sourceProject *uuid.UUID
	documents, checklist      []string
	warranty                  int
	revision                  int64
	updatedAt                 time.Time
	used                      int
}

const tplCols = `t.id, t.name, t.kind, t.source, t.copied_from, t.source_project_id, t.documents, t.checklist, t.warranty_months, t.revision, t.updated_at,
	(select count(*) from repairs.projects p where p.template_id = t.id)::int`

func (t *tplRow) scan(row interface{ Scan(...any) error }) error {
	return row.Scan(&t.id, &t.name, &t.kind, &t.source, &t.copiedFrom, &t.sourceProject, &t.documents, &t.checklist, &t.warranty, &t.revision, &t.updatedAt, &t.used)
}

// tplLine is a line of a template (repairs.template_lines).
type tplLine struct {
	part, section string
	item          uuid.UUID
	qty           *milli
	formula       *string
	coef          *milli
}

// tplStage is a stage of the technology of the schedule (repairs.template_stages).
type tplStage struct {
	name     string
	rate     *milli
	pause    int
	sections []string
}

func (r *req) template(ctx context.Context, id uuid.UUID, lock bool) (*tplRow, error) {
	q := `select ` + tplCols + ` from repairs.templates t where t.id = $1`
	if lock {
		q += ` for update of t`
	}
	t := &tplRow{}
	if err := t.scan(r.tx.QueryRow(ctx, q, id)); err != nil {
		if noRows(err) {
			return nil, nil
		}
		return nil, store("template", err)
	}
	return t, nil
}

func (r *req) templateLines(ctx context.Context, id uuid.UUID) ([]tplLine, error) {
	rows, err := r.tx.Query(ctx, `select part, section, price_item_id, (quantity * 1000)::bigint, formula, (coef * 1000)::bigint
		from repairs.template_lines where template_id = $1 order by part, sort, id`, id)
	if err != nil {
		return nil, store("template lines", err)
	}
	defer rows.Close()
	var out []tplLine
	for rows.Next() {
		var (
			l         tplLine
			qty, coef *int64
		)
		if err := rows.Scan(&l.part, &l.section, &l.item, &qty, &l.formula, &coef); err != nil {
			return nil, store("template lines", err)
		}
		if qty != nil {
			l.qty = new(milli(*qty))
		}
		if coef != nil {
			l.coef = new(milli(*coef))
		}
		out = append(out, l)
	}
	return out, store("template lines", rows.Err())
}

func (r *req) templateStages(ctx context.Context, id uuid.UUID) ([]tplStage, error) {
	rows, err := r.tx.Query(ctx, `select name, (rate_per_day * 1000)::bigint, pause_days, sections from repairs.template_stages where template_id = $1 order by sort, id`, id)
	if err != nil {
		return nil, store("template stages", err)
	}
	defer rows.Close()
	var out []tplStage
	for rows.Next() {
		var (
			s    tplStage
			rate *int64
		)
		if err := rows.Scan(&s.name, &rate, &s.pause, &s.sections); err != nil {
			return nil, store("template stages", err)
		}
		if rate != nil {
			s.rate = new(milli(*rate))
		}
		out = append(out, s)
	}
	return out, store("template stages", rows.Err())
}

func tplLineOut(l tplLine) rapi.TemplateLine {
	out := rapi.TemplateLine{PriceItemId: l.item, Section: l.section}
	if l.qty != nil {
		out.Quantity = new(l.qty.String())
	}
	if l.formula != nil {
		out.Formula = new(rapi.TemplateLineFormula(*l.formula))
		if l.coef != nil {
			out.Coef = new(l.coef.String())
		}
	}
	return out
}

// templateOut is a template with its six parts.
func (r *req) templateOut(ctx context.Context, t *tplRow) (rapi.Template, error) {
	lines, err := r.templateLines(ctx, t.id)
	if err != nil {
		return rapi.Template{}, err
	}
	stages, err := r.templateStages(ctx, t.id)
	if err != nil {
		return rapi.Template{}, err
	}
	out := rapi.Template{Id: t.id, Name: t.name, Kind: t.kind, Source: rapi.TemplateSource(t.source), UsedByObjects: t.used, UpdatedAt: t.updatedAt,
		Lines: []rapi.TemplateLine{}, Stages: []rapi.TemplateStage{}, Documents: []rapi.RepairDocumentKind{}, Checklist: append([]string{}, t.checklist...),
		Materials: []rapi.TemplateLine{}, WarrantyMonths: t.warranty, Revision: t.revision, CopiedFromId: t.copiedFrom, SourceProjectId: t.sourceProject}
	for _, l := range lines {
		if l.part == partMaterial {
			out.Materials = append(out.Materials, tplLineOut(l))
		} else {
			out.Lines = append(out.Lines, tplLineOut(l))
		}
	}
	for _, s := range stages {
		st := rapi.TemplateStage{Name: s.name, PauseDays: new(s.pause)}
		if s.rate != nil {
			st.RatePerDay = new(s.rate.String())
		}
		if len(s.sections) > 0 {
			st.Sections = new(slices.Clone(s.sections))
		}
		out.Stages = append(out.Stages, st)
	}
	for _, d := range t.documents {
		out.Documents = append(out.Documents, rapi.RepairDocumentKind(d))
	}
	return out, nil
}

// Templates answers listTemplates: the templates of the organization, those of Ortus first. The first read of an
// organization that keeps the catalog copies the starter templates of Ortus into it.
func (s *Service) Templates(ctx context.Context, tc tenantctx.TenantContext) (rapi.TemplateList, error) {
	out := rapi.TemplateList{Items: []rapi.Template{}}
	if err := s.ensureStarter(ctx, tc); err != nil {
		return out, err
	}
	err := s.run(ctx, tc, false, func(r *req) error {
		if err := r.catalogRead(ctx); err != nil {
			return err
		}
		rows, err := r.tx.Query(ctx, `select `+tplCols+` from repairs.templates t order by t.source, lower(t.name), t.id`)
		if err != nil {
			return store("templates", err)
		}
		var all []*tplRow
		for rows.Next() {
			t := &tplRow{}
			if err := t.scan(rows); err != nil {
				rows.Close()
				return store("templates", err)
			}
			all = append(all, t)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return store("templates", err)
		}
		for _, t := range all {
			o, err := r.templateOut(ctx, t)
			if err != nil {
				return err
			}
			out.Items = append(out.Items, o)
		}
		return nil
	})
	return out, err
}

// Template answers getTemplate.
func (s *Service) Template(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (rapi.Template, error) {
	var out rapi.Template
	err := s.run(ctx, tc, false, func(r *req) error {
		if err := r.catalogRead(ctx); err != nil {
			return err
		}
		t, err := r.template(ctx, id, false)
		if err != nil {
			return err
		}
		if t == nil {
			return notFound(textTemplateNotFound)
		}
		out, err = r.templateOut(ctx, t)
		return err
	})
	return out, err
}

// checkTplLines checks the lines of a part of a template: an item of the price list, a section, a quantity or a formula
// with a coefficient (never both).
func (r *req) checkTplLines(ctx context.Context, field, part string, in []rapi.TemplateLine) ([]tplLine, error) {
	out := make([]tplLine, 0, len(in))
	for i, l := range in {
		var exists bool
		if err := r.tx.QueryRow(ctx, `select exists (select 1 from repairs.price_items where id = $1)`, l.PriceItemId).Scan(&exists); err != nil {
			return nil, store("price item", err)
		}
		if !exists {
			return nil, invalid(at(field, i, "priceItemId"), textLineItem, "unknown")
		}
		section := strings.TrimSpace(l.Section)
		if utf8.RuneCountInString(section) > 100 {
			return nil, invalid(at(field, i, "section"), "Раздел — не больше 100 знаков.", "max")
		}
		t := tplLine{part: part, section: section, item: l.PriceItemId}
		if err := volumeOf(&t, field, i, l); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, nil
}

// volumeOf reads the volume of a line of a template: a quantity or a formula with a coefficient, exactly one of them.
func volumeOf(t *tplLine, field string, i int, l rapi.TemplateLine) error {
	if (l.Quantity == nil) == (l.Formula == nil) {
		return invalid(at(field, i, ""), textLineVolume, "volume")
	}
	if l.Quantity != nil {
		q, ok := parseQty(*l.Quantity)
		switch {
		case !ok || q > maxQty:
			return invalid(at(field, i, "quantity"), textLineQty, "format")
		case l.Coef != nil:
			return invalid(at(field, i, "coef"), "Коэффициент нужен только к формуле.", "unexpected")
		}
		t.qty = &q
		return nil
	}
	if !slices.Contains(formulas, string(*l.Formula)) {
		return invalid(at(field, i, "formula"), textLineFormula, "unknown")
	}
	k := milli(1000)
	if l.Coef != nil {
		var ok bool
		if k, ok = parseQty(*l.Coef); !ok || k == 0 || k > 99_999_999 {
			return invalid(at(field, i, "coef"), textLineCoef, "positive")
		}
	}
	t.formula, t.coef = new(string(*l.Formula)), &k
	return nil
}
func checkStages(in []rapi.TemplateStage) ([]tplStage, error) {
	out := make([]tplStage, 0, len(in))
	for i, s := range in {
		name := strings.TrimSpace(s.Name)
		if n := utf8.RuneCountInString(name); n < 1 || n > 200 {
			return nil, invalid(at("stages", i, "name"), textStageName, "required")
		}
		st := tplStage{name: name, sections: []string{}}
		if s.RatePerDay != nil {
			v, ok := parseQty(*s.RatePerDay)
			if !ok || v == 0 || v > maxQty {
				return nil, invalid(at("stages", i, "ratePerDay"), textStageRate, "positive")
			}
			st.rate = &v
		}
		if s.PauseDays != nil {
			if *s.PauseDays < -60 || *s.PauseDays > 60 {
				return nil, invalid(at("stages", i, "pauseDays"), textStagePause, "range")
			}
			st.pause = *s.PauseDays
		}
		if s.Sections != nil {
			st.sections = slices.Clone(*s.Sections)
		}
		out = append(out, st)
	}
	return out, nil
}

// replaceLines writes the lines of a part of a template instead of the old ones.
func (r *req) replaceLines(ctx context.Context, id uuid.UUID, part string, lines []tplLine) error {
	if _, err := r.tx.Exec(ctx, `delete from repairs.template_lines where template_id = $1 and part = $2`, id, part); err != nil {
		return store("clear template lines", err)
	}
	return r.insertTplLines(ctx, id, lines)
}

func (r *req) insertTplLines(ctx context.Context, id uuid.UUID, lines []tplLine) error {
	for i, l := range lines {
		var qty, coef *int64
		if l.qty != nil {
			qty = new(int64(*l.qty))
		}
		if l.coef != nil {
			coef = new(int64(*l.coef))
		}
		if _, err := r.tx.Exec(ctx, `insert into repairs.template_lines (template_id, part, section, price_item_id, quantity, formula, coef, sort)
			values ($1, $2, $3, $4, $5::bigint::numeric / 1000, $6, $7::bigint::numeric / 1000, $8)`, id, l.part, l.section, l.item, qty, l.formula, coef, i); err != nil {
			return store("insert template line", err)
		}
	}
	return nil
}

func (r *req) insertTplStages(ctx context.Context, id uuid.UUID, stages []tplStage) error {
	for i, s := range stages {
		var rate *int64
		if s.rate != nil {
			rate = new(int64(*s.rate))
		}
		if _, err := r.tx.Exec(ctx, `insert into repairs.template_stages (template_id, name, rate_per_day, pause_days, sections, sort)
			values ($1, $2, $3::bigint::numeric / 1000, $4, $5, $6)`, id, s.name, rate, s.pause, s.sections, i); err != nil {
			return store("insert template stage", err)
		}
	}
	return nil
}

// UpdateTemplate answers updateTemplate: the parts of a template of the organization; the objects and the estimates
// already made do not change.
func (s *Service) UpdateTemplate(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b rapi.TemplatePatch) (rapi.Template, error) {
	var out rapi.Template
	err := s.run(ctx, tc, true, func(r *req) error {
		if err := r.catalogWrite(ctx); err != nil {
			return err
		}
		t, err := r.template(ctx, id, true)
		if err != nil {
			return err
		}
		if t == nil {
			return notFound(textTemplateNotFound)
		}
		if err := checkRev(ifMatch, t.revision, textTemplateChanged); err != nil {
			return err
		}
		if err := r.applyTemplatePatch(ctx, t, b); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update repairs.templates set name = $2, documents = $3, checklist = $4, warranty_months = $5, revision = revision + 1, updated_at = $6 where id = $1`,
			t.id, t.name, t.documents, t.checklist, t.warranty, r.now); err != nil {
			return store("update template", err)
		}
		next, err := r.template(ctx, id, false)
		if err != nil {
			return err
		}
		out, err = r.templateOut(ctx, next)
		return err
	})
	return out, err
}

func (r *req) applyTemplatePatch(ctx context.Context, t *tplRow, b rapi.TemplatePatch) error {
	if err := t.applyColumns(b); err != nil {
		return err
	}
	for _, part := range []struct {
		field, part string
		lines       *[]rapi.TemplateLine
	}{{"lines", partEstimate, b.Lines}, {"materials", partMaterial, b.Materials}} {
		if part.lines == nil {
			continue
		}
		lines, err := r.checkTplLines(ctx, part.field, part.part, *part.lines)
		if err != nil {
			return err
		}
		if err := r.replaceLines(ctx, t.id, part.part, lines); err != nil {
			return err
		}
	}
	if b.Stages == nil {
		return nil
	}
	stages, err := checkStages(*b.Stages)
	if err != nil {
		return err
	}
	if _, err := r.tx.Exec(ctx, `delete from repairs.template_stages where template_id = $1`, t.id); err != nil {
		return store("clear template stages", err)
	}
	return r.insertTplStages(ctx, t.id, stages)
}

// applyColumns checks the parts of a template that live in its own columns and writes them into the row.
func (t *tplRow) applyColumns(b rapi.TemplatePatch) error {
	if b.Name != nil {
		n := strings.TrimSpace(*b.Name)
		if c := utf8.RuneCountInString(n); c < 1 || c > 200 {
			return invalid("name", textTemplateName, "required")
		}
		t.name = n
	}
	if b.WarrantyMonths != nil {
		if *b.WarrantyMonths < 1 || *b.WarrantyMonths > 120 {
			return invalid("warrantyMonths", textWarranty, "range")
		}
		t.warranty = *b.WarrantyMonths
	}
	if b.Documents != nil {
		docs, err := documentsOf(*b.Documents)
		if err != nil {
			return err
		}
		t.documents = docs
	}
	if b.Checklist != nil {
		items, err := checklistOf(*b.Checklist)
		if err != nil {
			return err
		}
		t.checklist = items
	}
	return nil
}

func documentsOf(in []rapi.RepairDocumentKind) ([]string, error) {
	docs := make([]string, 0, len(in))
	for i, d := range in {
		if !slices.Contains(documentKinds, string(d)) {
			return nil, invalid(at("documents", i, ""), textDocumentKind, "unknown")
		}
		docs = append(docs, string(d))
	}
	return docs, nil
}

func checklistOf(in []string) ([]string, error) {
	items := make([]string, 0, len(in))
	for i, c := range in {
		c = strings.TrimSpace(c)
		if n := utf8.RuneCountInString(c); n < 1 || n > 300 {
			return nil, invalid(at("checklist", i, ""), textChecklistItem, "length")
		}
		items = append(items, c)
	}
	return items, nil
}

// ownTemplate names a new template of the organization: the name given or the default, trimmed and within the column.
func ownTemplate(name *string, fallback string) (string, error) {
	n := fallback
	if name != nil && strings.TrimSpace(*name) != "" {
		n = strings.TrimSpace(*name)
	}
	if c := utf8.RuneCountInString(n); c < 1 || c > 200 {
		return "", invalid("name", textTemplateName, "length")
	}
	return n, nil
}

// CopyTemplate answers copyTemplate: any template into an own one; the copy is independent of its source.
func (s *Service) CopyTemplate(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, name *string) (rapi.Template, error) {
	var out rapi.Template
	err := s.run(ctx, tc, true, func(r *req) error {
		if err := r.catalogWrite(ctx); err != nil {
			return err
		}
		src, err := r.template(ctx, id, false)
		if err != nil {
			return err
		}
		if src == nil {
			return notFound(textTemplateNotFound)
		}
		n, err := ownTemplate(name, src.name+" (копия)")
		if err != nil {
			return err
		}
		lines, err := r.templateLines(ctx, id)
		if err != nil {
			return err
		}
		stages, err := r.templateStages(ctx, id)
		if err != nil {
			return err
		}
		cp := &tplRow{id: uuid.New(), name: n, kind: src.kind, copiedFrom: &src.id, documents: src.documents, checklist: src.checklist, warranty: src.warranty}
		if err := r.insertTemplate(ctx, cp, lines, stages); err != nil {
			return err
		}
		next, err := r.template(ctx, cp.id, false)
		if err != nil {
			return err
		}
		out, err = r.templateOut(ctx, next)
		return err
	})
	return out, err
}

// insertTemplate writes a template of the organization (source own) with its lines and stages.
func (r *req) insertTemplate(ctx context.Context, t *tplRow, lines []tplLine, stages []tplStage) error {
	if t.source == "" {
		t.source = "own"
	}
	if t.documents == nil {
		t.documents = []string{}
	}
	if t.checklist == nil {
		t.checklist = []string{}
	}
	if _, err := r.tx.Exec(ctx, `insert into repairs.templates (id, name, kind, source, copied_from, source_project_id, documents, checklist, warranty_months, created_at, updated_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`, t.id, t.name, t.kind, t.source, t.copiedFrom, t.sourceProject, t.documents, t.checklist, t.warranty, r.now); err != nil {
		return store("insert template", err)
	}
	// the lines keep their order inside a part
	for _, part := range []string{partEstimate, partMaterial} {
		var of []tplLine
		for _, l := range lines {
			if l.part == part {
				of = append(of, l)
			}
		}
		if err := r.insertTplLines(ctx, t.id, of); err != nil {
			return err
		}
	}
	return r.insertTplStages(ctx, t.id, stages)
}

// SaveProjectAsTemplate answers saveProjectAsTemplate: the lines of the version in force with their formulas and the
// other parts of the template of the object become a new own template.
func (s *Service) SaveProjectAsTemplate(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, name *string) (rapi.Template, error) {
	var out rapi.Template
	err := s.run(ctx, tc, true, func(r *req) error {
		if err := r.catalogWrite(ctx); err != nil {
			return err
		}
		p, err := r.visibleProject(ctx, id, false)
		if err != nil {
			return err
		}
		vs, err := r.versions(ctx, p.id)
		if err != nil {
			return err
		}
		cur := current(vs)
		if cur == nil {
			return conflict(reasonNoEstimate, textNoCurrent)
		}
		n, err := ownTemplate(name, p.name)
		if err != nil {
			return err
		}
		t, rest, stages, err := r.sourceParts(ctx, p)
		if err != nil {
			return err
		}
		t.id, t.name = uuid.New(), n
		mine, err := r.linesAsTemplate(ctx, cur.id)
		if err != nil {
			return err
		}
		if err := r.insertTemplate(ctx, t, append(mine, rest...), stages); err != nil {
			return err
		}
		next, err := r.template(ctx, t.id, false)
		if err != nil {
			return err
		}
		out, err = r.templateOut(ctx, next)
		return err
	})
	return out, err
}

// sourceParts are the parts a template saved from an object takes over from the template the object was built from:
// the kind, the documents, the checklist, the warranty, the materials and the stages. Without a source template they
// are the defaults; the kind of the object, if it has one, wins.
func (r *req) sourceParts(ctx context.Context, p *projectRow) (t *tplRow, materials []tplLine, stages []tplStage, err error) {
	t = &tplRow{kind: defaultKind, sourceProject: &p.id, warranty: defaultWarrantyMonths}
	if p.template != nil {
		if materials, stages, err = r.takeOver(ctx, t, *p.template); err != nil {
			return nil, nil, nil, err
		}
	}
	if p.kind != nil && strings.TrimSpace(*p.kind) != "" {
		t.kind = truncate(strings.TrimSpace(*p.kind), 100)
	}
	return t, materials, stages, nil
}

// takeOver copies the parts of the source template into t and returns its materials and stages.
func (r *req) takeOver(ctx context.Context, t *tplRow, source uuid.UUID) ([]tplLine, []tplStage, error) {
	src, err := r.template(ctx, source, false)
	if err != nil || src == nil {
		return nil, nil, err
	}
	t.kind, t.documents, t.checklist, t.warranty = src.kind, src.documents, src.checklist, src.warranty
	materials, err := r.materialsOf(ctx, src.id)
	if err != nil {
		return nil, nil, err
	}
	stages, err := r.templateStages(ctx, src.id)
	return materials, stages, err
}
func (r *req) materialsOf(ctx context.Context, template uuid.UUID) ([]tplLine, error) {
	all, err := r.templateLines(ctx, template)
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(all, func(l tplLine) bool { return l.part != partMaterial }), nil
}

// linesAsTemplate turns the lines of a version into the lines of a template: the formula and its coefficient stay, a
// fixed line keeps its quantity; a line without an item of the price list cannot be put into a template.
func (r *req) linesAsTemplate(ctx context.Context, estimate uuid.UUID) ([]tplLine, error) {
	secs, err := r.sections(ctx, estimate)
	if err != nil {
		return nil, err
	}
	lines, err := r.lines(ctx, estimate)
	if err != nil {
		return nil, err
	}
	names := map[uuid.UUID]string{}
	for _, s := range secs {
		names[s.id] = truncate(s.name, 100)
	}
	var out []tplLine
	for _, l := range lines {
		if l.item == nil {
			continue
		}
		t := tplLine{part: partEstimate, section: names[l.section], item: *l.item}
		if l.formula != nil && slices.Contains(formulas, *l.formula) {
			k := milli(1000)
			if l.coef != nil {
				k = *l.coef
			}
			t.formula, t.coef = l.formula, &k
		} else {
			q := l.qty
			t.qty = &q
		}
		out = append(out, t)
	}
	return out, nil
}
