package repairs

import (
	"context"
	"encoding/json"
	"errors"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Limits of a page (the parameter limit of the contract).
const (
	defaultLimit = 50
	maxLimit     = 200
)

// window is the offset of the cursor ("oN") and the size of the page: what a query with limit and offset needs.
func window(cursor *string, limit *int) (from, n int, err error) {
	if cursor != nil {
		s, ok := strings.CutPrefix(*cursor, "o")
		if from, err = strconv.Atoi(s); !ok || err != nil || from < 0 {
			return 0, 0, malformed(textBadCursor)
		}
	}
	n = defaultLimit
	if limit != nil {
		n = max(1, min(maxLimit, *limit))
	}
	return from, n, nil
}

// paging cuts a sorted list: the cursor is the offset of the next page («o<N>»), opaque to the client.
func paging(total int, cursor *string, limit *int) (from, to int, next *string, err error) {
	from, n, err := window(cursor, limit)
	if err != nil {
		return 0, 0, nil, err
	}
	from = min(from, total)
	to = min(total, from+n)
	if to < total {
		next = new("o" + strconv.Itoa(to))
	}
	return from, to, next, nil
}

// ListQuery is the filter of listRepairProjects.
type ListQuery struct {
	Filter *string // active | todo | draft | done
	Q      *string
	Cursor *string
	Limit  *int
}

var listFilters = []string{"active", "todo", "draft", "done"}

// summary is an object of the list with what the filters and the order read.
type summary struct {
	dto  rapi.RepairProject
	p    *projectRow
	todo int
}

// Projects answers listRepairProjects: the objects the member sees with the summary of the list, those that wait for
// a decision first, then by the term and the name.
func (s *Service) Projects(ctx context.Context, tc tenantctx.TenantContext, q ListQuery) (rapi.RepairProjectPage, error) {
	out := rapi.RepairProjectPage{Items: []rapi.RepairProject{}}
	if q.Filter != nil && !slices.Contains(listFilters, *q.Filter) {
		return out, malformed(textUnknownFilter)
	}
	err := s.run(ctx, tc, false, func(r *req) error {
		if ok, err := r.anywhere(ctx, actRead); err != nil || !ok {
			if err == nil {
				err = forbidden("")
			}
			return err
		}
		all, err := r.allProjects(ctx)
		if err != nil {
			return err
		}
		var seen []*projectRow
		for _, p := range all {
			ok, err := r.sees(ctx, p)
			if err != nil {
				return err
			}
			if ok {
				seen = append(seen, p)
			}
		}
		items, err := r.summaries(ctx, seen, q)
		if err != nil {
			return err
		}
		from, to, next, err := paging(len(items), q.Cursor, q.Limit)
		if err != nil {
			return err
		}
		for _, it := range items[from:to] {
			out.Items = append(out.Items, it.dto)
		}
		out.NextCursor = next
		return nil
	})
	return out, err
}

// summaries builds, filters and orders the summaries of the objects.
func (r *req) summaries(ctx context.Context, seen []*projectRow, q ListQuery) ([]summary, error) {
	ids := make([]uuid.UUID, 0, len(seen))
	var foremen []uuid.UUID
	for _, p := range seen {
		ids = append(ids, p.id)
		if p.foreman != nil {
			foremen = append(foremen, *p.foreman)
		}
	}
	f, err := r.loadFacts(ctx, ids)
	if err != nil {
		return nil, err
	}
	if err := r.loadNames(ctx, foremen); err != nil {
		return nil, err
	}
	var items []summary
	for _, p := range seen {
		dto, todo, _, err := r.summarize(ctx, p, f)
		if err != nil {
			return nil, err
		}
		if matches(p, len(todo), q, r.foremanName(p)) {
			items = append(items, summary{dto: dto, p: p, todo: len(todo)})
		}
	}
	slices.SortStableFunc(items, func(a, b summary) int {
		if (a.todo > 0) != (b.todo > 0) {
			if a.todo > 0 {
				return -1
			}
			return 1
		}
		if c := compareDue(a.p.dueOn, b.p.dueOn); c != 0 {
			return c
		}
		return strings.Compare(strings.ToLower(a.p.name), strings.ToLower(b.p.name))
	})
	return items, nil
}

func (r *req) foremanName(p *projectRow) string {
	if p.foreman == nil {
		return ""
	}
	return r.names[*p.foreman]
}

// compareDue orders the terms ascending, an object without a term last.
func compareDue(a, b *time.Time) int {
	switch {
	case a == nil && b == nil:
		return 0
	case a == nil:
		return 1
	case b == nil:
		return -1
	}
	return a.Compare(*b)
}

// doneStatuses are the statuses of the filter «done».
var doneStatuses = []string{statusHandedOver, "completed", "archived"}

// matches applies the filter and the search of the list to p.
func matches(p *projectRow, todo int, q ListQuery, foreman string) bool {
	return filterOK(p, todo, q.Filter) && searchOK(p, q.Q, foreman)
}

func filterOK(p *projectRow, todo int, filter *string) bool {
	if filter == nil {
		return true
	}
	switch *filter {
	case "active":
		return p.status == statusActive
	case "draft":
		return p.status == statusDraft
	case "done":
		return slices.Contains(doneStatuses, p.status)
	case "todo":
		return p.status == statusActive && todo > 0
	}
	return true
}

// searchOK is the search of the list: the address, the name, the client and the foreman.
func searchOK(p *projectRow, q *string, foreman string) bool {
	if q == nil {
		return true
	}
	needle := strings.ToLower(strings.TrimSpace(*q))
	hay := strings.ToLower(strings.Join([]string{p.address, p.name, deref(p.clientName), foreman}, " "))
	return needle == "" || strings.Contains(hay, needle)
}
func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

// Project answers getRepairProject.
func (s *Service) Project(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (rapi.RepairProject, error) {
	var out rapi.RepairProject
	err := s.run(ctx, tc, false, func(r *req) error {
		p, err := r.visibleProject(ctx, id, false)
		if err != nil {
			return err
		}
		f, err := r.loadFacts(ctx, []uuid.UUID{p.id})
		if err != nil {
			return err
		}
		out, _, _, err = r.summarize(ctx, p, f)
		return err
	})
	return out, err
}

// uniqueViolation reports whether err violates a unique index.
func uniqueViolation(err error) bool {
	pe, ok := errors.AsType[*pgconn.PgError](err)
	return ok && pe.Code == "23505"
}

// trimmedName checks a name of an object: 1–150 characters.
func trimmedName(name string) (string, error) {
	n := strings.TrimSpace(name)
	if c := utf8.RuneCountInString(n); c < 1 || c > 150 {
		return "", invalid("name", textNameShort)
	}
	return n, nil
}

// CreateProject answers createRepairProject: a draft from a lead (no foreman, D-17) or an active object; the crew
// without accounts is written with it.
func (s *Service) CreateProject(ctx context.Context, tc tenantctx.TenantContext, b rapi.RepairProjectCreate) (rapi.RepairProject, error) {
	var out rapi.RepairProject
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.newProject(ctx, b)
		if err != nil {
			return err
		}
		kind, text := evCreated, "создан объект"
		if p.status == statusDraft {
			kind, text = evDraftCreated, "создан объект-черновик"
		}
		if err := r.insertProject(ctx, p, b); err != nil {
			if uniqueViolation(err) && p.leadTask != nil {
				return conflict("", textLeadHasObject)
			}
			return store("insert project", err)
		}
		for i, w := range b.Workers {
			name := strings.TrimSpace(w.DisplayName)
			if _, err := r.tx.Exec(ctx, `insert into repairs.workers (project_id, display_name, trade, created_at) values ($1, $2, $3, $4)`,
				p.id, name, strings.TrimSpace(w.Trade), r.now.Add(time.Duration(i)*time.Microsecond)); err != nil {
				return store("insert worker", err)
			}
		}
		if err := r.event(ctx, p.id, kind, text); err != nil {
			return err
		}
		out, err = r.projectOut(ctx, p.id)
		return err
	})
	return out, err
}

// newProject checks the body of createRepairProject and returns the object to write.
func (r *req) newProject(ctx context.Context, b rapi.RepairProjectCreate) (*projectRow, error) {
	ok, err := r.unitExists(ctx, b.OrgUnitId)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, invalid("orgUnitId", textUnitMissing, "unknown")
	}
	here := &projectRow{unit: b.OrgUnitId}
	if err := r.need(ctx, here, actManage, "Нужно право «Вести объекты»."); err != nil {
		return nil, err
	}
	name, err := trimmedName(b.Name)
	if err != nil {
		return nil, err
	}
	p := &projectRow{id: uuid.New(), unit: b.OrgUnitId, name: name, address: b.Address, kind: b.Kind, rooms: b.Rooms, revision: 1,
		clientName: b.ClientName, clientPhone: b.ClientPhone, leadTask: b.LeadTaskId, template: b.TemplateId, currency: "RUB", createdAt: r.now}
	if b.AreaM2 != nil {
		a, ok := parseQty(*b.AreaM2)
		if !ok {
			return nil, invalid("areaM2", "Площадь — число с точностью до тысячных.", "format")
		}
		p.area = &a
	}
	for i, w := range b.Workers {
		if strings.TrimSpace(w.DisplayName) == "" {
			return nil, invalid("workers["+strconv.Itoa(i)+"].displayName", "Укажите имя работника.", "required")
		}
	}
	if err := r.checkRefs(ctx, p, b); err != nil {
		return nil, err
	}
	if b.Budget != nil {
		p.budget = new(int64(b.Budget.AmountMinor))
		p.currency = b.Budget.Currency
	}
	p.status, p.stage = statusActive, new(stagePrepare)
	if b.LeadTaskId != nil && p.foreman == nil {
		p.status, p.stage = statusDraft, new(stageMeasure)
	}
	return p, nil
}

// checkRefs checks the foreman, the template and the lead of a new object (an object per lead).
func (r *req) checkRefs(ctx context.Context, p *projectRow, b rapi.RepairProjectCreate) error {
	if b.ForemanMemberId != nil {
		ok, err := r.isMember(ctx, *b.ForemanMemberId)
		if err != nil {
			return err
		}
		if !ok {
			return invalid("foremanMemberId", textMemberMissing, "unknown")
		}
		p.foreman = b.ForemanMemberId
	}
	if b.TemplateId != nil {
		var ok bool
		if err := r.tx.QueryRow(ctx, `select exists (select 1 from repairs.templates where id = $1)`, *b.TemplateId).Scan(&ok); err != nil {
			return store("template", err)
		}
		if !ok {
			return invalid("templateId", "Шаблона нет в организации.", "unknown")
		}
	}
	if b.LeadTaskId != nil {
		var taken bool
		if err := r.tx.QueryRow(ctx, `select exists (select 1 from repairs.projects where lead_task_id = $1)`, *b.LeadTaskId).Scan(&taken); err != nil {
			return store("lead", err)
		}
		if taken {
			return conflict("", textLeadHasObject)
		}
	}
	return nil
}

func (r *req) insertProject(ctx context.Context, p *projectRow, b rapi.RepairProjectCreate) error {
	access := []rapi.RepairAccessItem{}
	if b.Access != nil {
		access = *b.Access
	}
	raw, err := json.Marshal(access)
	if err != nil {
		return err
	}
	var createdBy *uuid.UUID
	if r.me() != uuid.Nil {
		createdBy = new(r.me())
	}
	_, err = r.tx.Exec(ctx, `insert into repairs.projects (id, org_unit_id, name, address, status, kind, stage, area_m2, rooms, client_name, client_phone,
		foreman_id, access, template_id, lead_task_id, budget_minor, currency, created_by, created_at, updated_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8::bigint::numeric / 1000, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $19)`,
		p.id, p.unit, p.name, p.address, p.status, p.kind, p.stage, areaArg(p.area), p.rooms, p.clientName, p.clientPhone,
		p.foreman, raw, p.template, p.leadTask, p.budget, p.currency, createdBy, r.now)
	return err
}

func areaArg(a *milli) *int64 {
	if a == nil {
		return nil
	}
	return new(int64(*a))
}

// UpdateProject answers updateRepairProject: the fields of the header of an object that is not handed over.
func (s *Service) UpdateProject(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b rapi.RepairProjectPatch) (rapi.RepairProject, error) {
	var out rapi.RepairProject
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.visibleProject(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actManage, "Нужно право «Вести объекты»."); err != nil {
			return err
		}
		if err := checkRev(ifMatch, p.revision, textObjectChanged); err != nil {
			return err
		}
		if p.status == statusHandedOver {
			return conflict(reasonHandedOver, textHandedOverEdit)
		}
		if err := applyPatch(p, b); err != nil {
			return err
		}
		raw, err := json.Marshal(json.RawMessage(p.access))
		if err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update repairs.projects set name = $2, address = $3, kind = $4, area_m2 = $5::bigint::numeric / 1000, rooms = $6,
			contract_no = $7, due_on = $8, client_name = $9, client_phone = $10, access = $11, revision = revision + 1, updated_at = $12 where id = $1`,
			p.id, p.name, p.address, p.kind, areaArg(p.area), p.rooms, p.contractNo, p.dueOn, p.clientName, p.clientPhone, raw, r.now); err != nil {
			return store("update project", err)
		}
		out, err = r.projectOut(ctx, p.id)
		return err
	})
	return out, err
}

// applyPatch writes the fields of the patch into p.
func applyPatch(p *projectRow, b rapi.RepairProjectPatch) error {
	if b.Name != nil {
		n, err := trimmedName(*b.Name)
		if err != nil {
			return err
		}
		p.name = n
	}
	if b.Address != nil {
		p.address = *b.Address
	}
	if b.AreaM2 != nil {
		a, ok := parseQty(*b.AreaM2)
		if !ok {
			return invalid("areaM2", "Площадь — число с точностью до тысячных.", "format")
		}
		p.area = &a
	}
	p.kind = pick(p.kind, b.Kind)
	p.contractNo = pick(p.contractNo, b.ContractNo)
	p.clientName = pick(p.clientName, b.ClientName)
	p.clientPhone = pick(p.clientPhone, b.ClientPhone)
	if b.Rooms != nil {
		p.rooms = b.Rooms
	}
	if b.DueOn != nil {
		p.dueOn = new(b.DueOn.Time)
	}
	if b.Access != nil {
		raw, err := json.Marshal(*b.Access)
		if err != nil {
			return err
		}
		p.access = raw
	}
	return nil
}

func pick(old, patch *string) *string {
	if patch != nil {
		return patch
	}
	return old
}

// AssignForeman answers assignRepairForeman: once; a draft has no foreman until the contract.
func (s *Service) AssignForeman(ctx context.Context, tc tenantctx.TenantContext, id, member uuid.UUID) (rapi.RepairProject, error) {
	var out rapi.RepairProject
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.visibleProject(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actManage, "Нужно право «Вести объекты»."); err != nil {
			return err
		}
		ok, err := r.isMember(ctx, member)
		if err != nil {
			return err
		}
		if !ok {
			return invalid("foremanMemberId", textMemberMissing, "unknown")
		}
		switch {
		case p.status == statusHandedOver:
			return conflict(reasonHandedOver, textHandedOverEdit)
		case p.status == statusDraft:
			return conflict("", textDraftNoForeman)
		case p.foreman != nil:
			if err := r.loadNames(ctx, []uuid.UUID{*p.foreman}); err != nil {
				return err
			}
			return conflict(reasonForemanAssigned, "Прораб уже назначен: "+orDash(r.names[*p.foreman])+".")
		}
		if _, err := r.tx.Exec(ctx, `update repairs.projects set foreman_id = $2, revision = revision + 1, updated_at = $3 where id = $1`, p.id, member, r.now); err != nil {
			return store("assign foreman", err)
		}
		if err := r.loadNames(ctx, []uuid.UUID{member}); err != nil {
			return err
		}
		if err := r.event(ctx, p.id, evForemanAssigned, "назначен прораб: "+r.names[member]); err != nil {
			return err
		}
		out, err = r.projectOut(ctx, p.id)
		return err
	})
	return out, err
}

func orDash(s string) string {
	if s == "" {
		return "—"
	}
	return s
}

// approvedTotal is the total of the current estimate of an object (the latest approved version, its lines less the
// discount) in minor units; nil — no approved estimate.
func (r *req) approvedTotal(ctx context.Context, project uuid.UUID) (total *int64, estimate uuid.UUID, err error) {
	var (
		sub int64
		pct int
	)
	err = r.tx.QueryRow(ctx, `select e.id, e.discount_pct, coalesce(sum(round(l.price_minor * l.quantity)), 0)::bigint
		from repairs.estimates e left join repairs.estimate_lines l on l.estimate_id = e.id
		where e.project_id = $1 and e.state = 'approved' group by e.id order by e.version desc limit 1`, project).Scan(&estimate, &pct, &sub)
	if noRows(err) {
		return nil, uuid.Nil, nil
	}
	if err != nil {
		return nil, uuid.Nil, store("estimate total", err)
	}
	// the discount rounds half up, as the estimate of the prototype
	t := sub - (sub*int64(pct)+50)/100
	return &t, estimate, nil
}

// Activate answers activateRepairProject: a draft goes to work by the approved estimate; the budget and the works of
// the object come from its lines.
func (s *Service) Activate(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string) (rapi.RepairProject, error) {
	var out rapi.RepairProject
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.visibleProject(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actManage, "Нужно право «Вести объекты»."); err != nil {
			return err
		}
		if err := checkRev(ifMatch, p.revision, textObjectChanged); err != nil {
			return err
		}
		if p.status != statusDraft {
			return conflict(reasonNotDraft, textOnlyDraft)
		}
		total, estimate, err := r.approvedTotal(ctx, p.id)
		if err != nil {
			return err
		}
		if total == nil {
			return conflict(reasonNoEstimate, textNoApproved)
		}
		if _, err := r.tx.Exec(ctx, `update repairs.projects set status = 'active', stage = $2, budget_minor = $3, revision = revision + 1, updated_at = $4 where id = $1`,
			p.id, stagePrepare, *total, r.now); err != nil {
			return store("activate", err)
		}
		if _, err := r.tx.Exec(ctx, `insert into repairs.works (project_id, name, unit, plan_qty, estimate_line_id, sort)
			select $1, left(l.name, 200), l.unit, l.quantity, l.id, (row_number() over (order by s.sort, l.sort, l.id))::int
			  from repairs.estimate_lines l join repairs.estimate_sections s on s.id = l.section_id
			 where l.estimate_id = $2 and l.kind = 'work' and l.quantity > 0
			   and not exists (select 1 from repairs.works w where w.project_id = $1)`, p.id, estimate); err != nil {
			return store("works of the estimate", err)
		}
		if err := r.event(ctx, p.id, evActivated, "объект переведён в работу"); err != nil {
			return err
		}
		out, err = r.projectOut(ctx, p.id)
		return err
	})
	return out, err
}

// HandOver answers handOverRepairProject: by the signed act of hand over the object is handed over with its warranty.
func (s *Service) HandOver(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b rapi.RepairHandOver) (rapi.RepairProject, error) {
	var out rapi.RepairProject
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.visibleProject(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actHandOver, "Нужно право «Сдавать объекты»."); err != nil {
			return err
		}
		if err := checkRev(ifMatch, p.revision, textObjectChanged); err != nil {
			return err
		}
		if p.status == statusHandedOver {
			return conflict(reasonHandedOver, textHandedOverEdit)
		}
		if err := r.checkAct(ctx, p.id, b.ActDocumentId); err != nil {
			return err
		}
		months, err := r.warranty(ctx, p, b.WarrantyMonths)
		if err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update repairs.projects set status = 'handed_over', handed_over_on = $2::date,
			warranty_until = ($2::date + make_interval(months => $3))::date, revision = revision + 1, updated_at = $4 where id = $1`,
			p.id, r.now, months, r.now); err != nil {
			return store("hand over", err)
		}
		if err := r.event(ctx, p.id, evHandedOver, "объект сдан заказчику"); err != nil {
			return err
		}
		out, err = r.projectOut(ctx, p.id)
		return err
	})
	return out, err
}

// checkAct requires the act of hand over of the object to be signed by the client.
func (r *req) checkAct(ctx context.Context, project, act uuid.UUID) error {
	var kind, state string
	err := r.tx.QueryRow(ctx, `select kind, state from repairs.documents where id = $1 and project_id = $2`, act, project).Scan(&kind, &state)
	if noRows(err) {
		return invalid("actDocumentId", textActMissing, "unknown")
	}
	if err != nil {
		return store("act", err)
	}
	if kind != "handover_act" || (state != "signed" && state != "paid") {
		return conflict(reasonActNotSigned, textActNotSigned)
	}
	return nil
}

// warranty is the months of the warranty: the request, else the template of the object, else 24.
func (r *req) warranty(ctx context.Context, p *projectRow, asked *int) (int, error) {
	if asked != nil {
		return *asked, nil
	}
	if p.template == nil {
		return defaultWarrantyMonths, nil
	}
	var months int
	if err := r.tx.QueryRow(ctx, `select warranty_months from repairs.templates where id = $1`, *p.template).Scan(&months); err != nil {
		return 0, store("warranty", err)
	}
	return months, nil
}
