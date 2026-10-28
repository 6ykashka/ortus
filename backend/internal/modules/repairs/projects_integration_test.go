//go:build integration

package repairs

import (
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/jackc/pgx/v5/pgxpool"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"  //nolint:depguard // integration test: the superuser that writes the data of the tests
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

func day(s string) time.Time {
	d, err := time.Parse(time.DateOnly, s)
	if err != nil {
		panic(err)
	}
	return d
}

func create(name string, mods ...func(*rapi.RepairProjectCreate)) rapi.RepairProjectCreate {
	b := rapi.RepairProjectCreate{OrgUnitId: unit("msk1"), Name: name, Address: "ул. Лесная, 1", Workers: []rapi.WorkerCreate{}}
	for _, m := range mods {
		m(&b)
	}
	return b
}

func ids(items []rapi.RepairProject) []string {
	out := make([]string, 0, len(items))
	for _, p := range items {
		out = append(out, p.Name)
	}
	return out
}

func TestCreateDraftFromLead(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	lead := uuid.New()
	p := must(s.CreateProject(ctx, office, create("Дом в Истре · черновик", func(b *rapi.RepairProjectCreate) {
		b.LeadTaskId = &lead
		b.Kind = new("Ремонт под ключ")
		b.AreaM2 = new("140.5")
		b.ClientName = new("Ольга Смирнова")
		b.ClientPhone = new("+7 900 000-00-01")
		b.Workers = []rapi.WorkerCreate{{DisplayName: "Иван Петров", Trade: "Плиточник"}, {DisplayName: "Пётр Сидоров", Trade: "Маляр"}}
	}))).of(t)
	if p.Status != rapi.RepairProjectStatusDraft || p.ForemanMemberId != nil || p.Revision != 1 {
		t.Fatalf("draft: %+v", p)
	}
	if p.Stage == nil || *p.Stage != "Замер" || p.LeadTaskId == nil || *p.LeadTaskId != lead || p.AreaM2 == nil || *p.AreaM2 != "140.5" {
		t.Fatalf("draft fields: stage %v lead %v area %v", p.Stage, p.LeadTaskId, p.AreaM2)
	}
	if len(p.Workers) != 2 || p.Workers[0].Status != rapi.WorkerStatusActive || p.Workers[0].DisplayName != "Иван Петров" {
		t.Fatalf("crew without accounts: %+v", p.Workers)
	}
	if p.ClientPhone == nil || p.Budget != nil || p.Measured {
		t.Fatalf("office with finance reads the phone, no budget yet, not measured: %+v", p)
	}
	if n := count(t, `select count(*) from repairs.project_events where project_id = $1 and kind = 'object.draft_created'`, p.Id); n != 1 {
		t.Fatalf("feed rows %d", n)
	}
	// one object per lead
	_, err := s.CreateProject(ctx, office, create("Дубль", func(b *rapi.RepairProjectCreate) { b.LeadTaskId = &lead }))
	wantCode(t, err, codeTransition, "По заявке уже есть объект.")
}

func TestCreateActiveWithForeman(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	foreman := person("a.manager-msk1")
	p := must(s.CreateProject(ctx, office, create("Квартира на Парковой", func(b *rapi.RepairProjectCreate) {
		b.ForemanMemberId = &foreman
		b.Budget = &rapi.Money{AmountMinor: 500000_00, Currency: "RUB"}
	}))).of(t)
	if p.Status != rapi.RepairProjectStatusActive || p.ForemanMemberId == nil || *p.ForemanMemberId != foreman {
		t.Fatalf("active: %+v", p)
	}
	if p.Budget == nil || p.Budget.AmountMinor != 500000_00 {
		t.Fatalf("budget: %+v", p.Budget)
	}
}

func TestCreateRefusals(t *testing.T) {
	t.Parallel()
	ctx, s := t.Context(), service()
	office := as(t, "a.region-msk")
	_, err := s.CreateProject(ctx, office, create("x", func(b *rapi.RepairProjectCreate) { b.OrgUnitId = uuid.New() }))
	wantField(t, err, "orgUnitId", "")
	nobody := uuid.New()
	_, err = s.CreateProject(ctx, office, create("x", func(b *rapi.RepairProjectCreate) { b.ForemanMemberId = &nobody }))
	wantField(t, err, "foremanMemberId", "")
	_, err = s.CreateProject(ctx, office, create("   "))
	wantField(t, err, "name", "")
	// «manage» is held in the area of the new object: the reader of Москва-2 and the foreman have none; a unit outside
	// the area of the office is refused as well (Санкт-Петербург)
	_, err = s.CreateProject(ctx, as(t, "a.manager-msk2"), create("x", func(b *rapi.RepairProjectCreate) { b.OrgUnitId = unit("msk2") }))
	wantCode(t, err, "forbidden_action", "")
	_, err = s.CreateProject(ctx, as(t, "a.manager-msk1"), create("x"))
	wantCode(t, err, "forbidden_action", "")
	_, err = s.CreateProject(ctx, office, create("x", func(b *rapi.RepairProjectCreate) { b.OrgUnitId = unit("spb1") }))
	wantCode(t, err, "forbidden_action", "")
}

func TestListVisibilityAndFilters(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s := t.Context(), service()
	office, foreman, reader := as(t, "a.region-msk"), as(t, "a.manager-msk1"), as(t, "a.manager-msk2")
	me := person("a.manager-msk1")
	other := person("a.driver-msk1")
	prefix := "Список/"
	own := project(t, prefix+"свой", seedOpts{foreman: &me, due: "2026-12-01"})
	_ = project(t, prefix+"чужой прораб", seedOpts{foreman: &other, due: "2026-11-01"})
	_ = project(t, prefix+"черновик", seedOpts{status: "draft"})
	_ = project(t, prefix+"сдан", seedOpts{status: "handed_over", foreman: &me})
	_ = project(t, prefix+"в Москве-2", seedOpts{unit: "msk2", foreman: &other})
	w := work(t, own, "Штукатурка", "m2", "100", "0")
	_ = w

	names := func(tc tenantctx.TenantContext, q ListQuery) []string {
		if q.Q == nil { // the shared test database holds objects of other tests: look at this test's own by the prefix
			q.Q = &prefix
		}
		page := must(s.Projects(ctx, tc, q)).of(t)
		var out []string
		for _, n := range ids(page.Items) {
			if len(n) > len(prefix) && n[:len(prefix)] == prefix {
				out = append(out, n[len(prefix):])
			}
		}
		return out
	}
	all := names(office, ListQuery{})
	for _, want := range []string{"свой", "чужой прораб", "черновик", "сдан", "в Москве-2"} {
		if !slices.Contains(all, want) {
			t.Errorf("office does not see %q: %v", want, all)
		}
	}
	// by the date: the object due first goes first, no date — last
	if slices.Index(all, "чужой прораб") > slices.Index(all, "свой") {
		t.Errorf("order by due date: %v", all)
	}
	if got := names(foreman, ListQuery{}); !slices.Equal(got, []string{"свой", "сдан"}) {
		t.Errorf("foreman sees only his objects that are not drafts: %v", got)
	}
	// the reader of Москва-2 is not an office: no drafts, and objects of foremen only through «своё» — none; the
	// object of other foreman in his area is read through the area grant, drafts stay hidden
	if got := names(reader, ListQuery{}); slices.Contains(got, "черновик") || slices.Contains(got, "свой") {
		t.Errorf("reader: %v", got)
	}
	if got := names(office, ListQuery{Filter: new("draft")}); !slices.Equal(got, []string{"черновик"}) {
		t.Errorf("draft filter: %v", got)
	}
	if got := names(office, ListQuery{Filter: new("done")}); !slices.Equal(got, []string{"сдан"}) {
		t.Errorf("done filter: %v", got)
	}
	if got := names(office, ListQuery{Filter: new("active")}); slices.Contains(got, "сдан") || slices.Contains(got, "черновик") || !slices.Contains(got, "свой") {
		t.Errorf("active filter: %v", got)
	}
	if got := names(office, ListQuery{Q: new("ЧУЖОЙ")}); !slices.Equal(got, []string{"чужой прораб"}) {
		t.Errorf("search by name: %v", got)
	}
	if _, err := s.Projects(ctx, office, ListQuery{Filter: new("nope")}); err == nil {
		t.Error("an unknown filter is malformed_request")
	}
}

// «todo» keeps the active objects that wait for a decision: a pending mark for the reviewer, no foreman for the office.
func TestListTodoFilterAndSummary(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s := t.Context(), service()
	office := as(t, "a.region-msk")
	me := person("a.manager-msk1")
	waiting := project(t, "Todo/ждёт приёмки", seedOpts{foreman: &me})
	quiet := project(t, "Todo/спокойный", seedOpts{foreman: &me})
	noForeman := project(t, "Todo/без прораба", seedOpts{})
	w := work(t, waiting, "Покраска", "m2", "40", "0")
	w2 := work(t, quiet, "Покраска", "m2", "40", "0")
	_ = w2
	logID := uuid.New()
	if _, err := superA.Exec(ctx, `insert into repairs.work_logs (id, number, project_id, submitted_by, work_date, time_zone, evidence_file_ids)
		values ($1, 'WL-9001', $2, $3, '2026-10-20', 'Europe/Moscow', array[gen_random_uuid()])`, logID, waiting, me); err != nil {
		t.Fatal(err)
	}
	if _, err := superA.Exec(ctx, `insert into repairs.work_log_lines (work_log_id, line_no, work_id, quantity, unit) values ($1, 1, $2, 10, 'm2')`, logID, w); err != nil {
		t.Fatal(err)
	}
	page := must(s.Projects(ctx, office, ListQuery{Filter: new("todo"), Q: new("Todo/")})).of(t)
	got := ids(page.Items)
	if !slices.Contains(got, "Todo/ждёт приёмки") || !slices.Contains(got, "Todo/без прораба") || slices.Contains(got, "Todo/спокойный") {
		t.Fatalf("todo: %v", got)
	}
	if got[0] != "Todo/ждёт приёмки" && got[0] != "Todo/без прораба" {
		t.Errorf("the objects that wait go first: %v", got)
	}
	for _, p := range page.Items {
		switch p.Id {
		case waiting:
			if p.TodoCount != 1 || p.TodoTop == nil || string(p.TodoTop.Kind) != "work_log_pending" || p.TodoTop.Text != "Покраска: 10 м²" ||
				p.Readiness.PendingPct != 25 || p.Readiness.AcceptedPct != 0 {
				t.Errorf("waiting summary: %+v %+v", p.TodoTop, p.Readiness)
			}
		case noForeman:
			if p.TodoTop == nil || string(p.TodoTop.Kind) != "no_foreman" {
				t.Errorf("no foreman: %+v", p.TodoTop)
			}
		case quiet:
			t.Error("quiet in todo")
		}
	}
}

func TestListPaging(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	for _, n := range []string{"A", "B", "C"} {
		project(t, "Страницы/"+n, seedOpts{})
	}
	first := must(s.Projects(ctx, office, ListQuery{Q: new("Страницы/"), Limit: new(2)})).of(t)
	if len(first.Items) != 2 || first.NextCursor == nil {
		t.Fatalf("first page: %d %v", len(first.Items), first.NextCursor)
	}
	second := must(s.Projects(ctx, office, ListQuery{Q: new("Страницы/"), Limit: new(2), Cursor: first.NextCursor})).of(t)
	if len(second.Items) != 1 || second.NextCursor != nil {
		t.Fatalf("second page: %d %v", len(second.Items), second.NextCursor)
	}
	if first.Items[0].Id == second.Items[0].Id || first.Items[1].Id == second.Items[0].Id {
		t.Error("pages overlap")
	}
	if _, err := s.Projects(ctx, office, ListQuery{Cursor: new("###")}); err == nil {
		t.Error("a broken cursor is malformed_request")
	}
}

func TestGetAndFinanceFields(t *testing.T) {
	t.Parallel()
	ctx, s := t.Context(), service()
	me := person("a.manager-msk1")
	id := project(t, "Карточка/цены", seedOpts{foreman: &me})
	if _, err := superA.Exec(ctx, `update repairs.projects set budget_minor = 123400, client_phone = '+7 900', client_name = 'Заказчик' where id = $1`, id); err != nil {
		t.Fatal(err)
	}
	p := must(s.Project(ctx, as(t, "a.region-msk"), id)).of(t)
	if p.Budget == nil || p.Budget.AmountMinor != 123400 || p.ClientPhone == nil {
		t.Fatalf("finance sees the sums: %+v", p)
	}
	for _, who := range []string{"a.manager-msk1", "ab.member"} {
		p := must(s.Project(ctx, as(t, who), id)).of(t)
		if p.Budget != nil || p.ClientPhone != nil || p.ClientName == nil {
			t.Fatalf("%s: no sums and no phone without repairs.finance.read: %+v", who, p)
		}
	}
	// a stranger and the other foreman are as if there were no object
	_, err := s.Project(ctx, as(t, "a.two-roles"), id)
	wantCode(t, err, "not_found", "")
	other := project(t, "Карточка/чужой", seedOpts{foreman: new(person("a.driver-msk1"))})
	_, err = s.Project(ctx, as(t, "a.manager-msk1"), other)
	wantCode(t, err, "not_found", "")
	draft := project(t, "Карточка/черновик", seedOpts{status: "draft"})
	_, err = s.Project(ctx, as(t, "a.manager-msk2"), draft)
	wantCode(t, err, "not_found", "")
	_, err = s.Project(ctx, as(t, "a.region-msk"), uuid.New())
	wantCode(t, err, "not_found", "")
}

func TestOverview(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s := t.Context(), service()
	me := person("a.manager-msk1")
	id := project(t, "Обзор/квартира", seedOpts{foreman: &me})
	w := work(t, id, "Стяжка", "m2", "50", "20")
	c1 := crew(t, id, "Иван")
	_ = crew(t, id, "Пётр")
	logID, file := uuid.New(), uuid.New()
	if _, err := superA.Exec(ctx, `insert into repairs.work_logs (id, number, project_id, submitted_by, work_date, time_zone, evidence_file_ids, crew_worker_ids)
		values ($1, 'WL-9002', $2, $3, '2026-10-20', 'Europe/Moscow', array[$4::uuid], array[$5::uuid])`, logID, id, me, file, c1); err != nil {
		t.Fatal(err)
	}
	if _, err := superA.Exec(ctx, `insert into repairs.work_log_lines (work_log_id, line_no, work_id, quantity, unit) values ($1, 1, $2, 5, 'm2')`, logID, w); err != nil {
		t.Fatal(err)
	}
	if _, err := superA.Exec(ctx, `update repairs.projects set budget_minor = 1000000, client_name = 'Ольга' where id = $1`, id); err != nil {
		t.Fatal(err)
	}
	if _, err := superA.Exec(ctx, `insert into repairs.project_events (project_id, kind, text, actor_id) values ($1, 'object.activated', 'объект переведён в работу', $2)`, id, person("a.owner")); err != nil {
		t.Fatal(err)
	}
	o := must(s.Overview(ctx, as(t, "a.region-msk"), id)).of(t)
	if o.Project.Id != id || len(o.Works) != 1 || o.Works[0].Fact != "20" || o.Works[0].Pending != "5" || o.Works[0].Plan != "50" {
		t.Fatalf("works: %+v", o.Works)
	}
	if len(o.Photos) != 1 || o.Photos[0].FileId != file || string(o.Photos[0].Status) != "pending" || o.Photos[0].WorkLogId != logID {
		t.Fatalf("photos: %+v", o.Photos)
	}
	if o.People.Foreman == nil || o.People.Foreman.MemberId != me || len(o.People.Crew) != 2 || o.People.ClientName == nil || o.People.ClientLinkActive {
		t.Fatalf("people: %+v", o.People)
	}
	if o.Money == nil || o.Money.Contract.AmountMinor != 1000000 {
		t.Fatalf("money with finance: %+v", o.Money)
	}
	if len(o.Feed) != 1 || o.Feed[0].Text != "объект переведён в работу" || o.Feed[0].ActorName == nil {
		t.Fatalf("feed: %+v", o.Feed)
	}
	// the foreman: no money, no contract amount
	f := must(s.Overview(ctx, as(t, "a.manager-msk1"), id)).of(t)
	if f.Money != nil || f.Project.Budget != nil {
		t.Fatalf("foreman gets no money: %+v", f.Money)
	}
	_, err := s.Overview(ctx, as(t, "a.region-msk"), uuid.New())
	wantCode(t, err, "not_found", "")
}

func TestUpdateProject(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Правка/квартира", seedOpts{})
	p := must(s.Project(ctx, office, id)).of(t)
	patch := rapi.RepairProjectPatch{Name: new("Правка/новое имя"), Rooms: new(3), ContractNo: new("42/2026"),
		Access: &[]rapi.RepairAccessItem{{Icon: "key", Text: "Ключи у консьержа"}}}
	alloc(&patch.DueOn).Time = day("2026-12-15")
	up := must(s.UpdateProject(ctx, office, id, rev(p.Revision), patch)).of(t)
	if up.Name != "Правка/новое имя" || up.Revision != p.Revision+1 || up.Rooms == nil || *up.Rooms != 3 || up.ContractNo == nil || *up.ContractNo != "42/2026" ||
		len(up.Access) != 1 || up.DueOn == nil || up.DueOn.String() != "2026-12-15" {
		t.Fatalf("updated: %+v", up)
	}
	_, err := s.UpdateProject(ctx, office, id, rev(p.Revision), rapi.RepairProjectPatch{Rooms: new(4)})
	wantCode(t, err, "revision_mismatch", "")
	_, err = s.UpdateProject(ctx, office, id, rev(up.Revision), rapi.RepairProjectPatch{Name: new(" ")})
	wantField(t, err, "name", "")
	mine := project(t, "Правка/свой", seedOpts{foreman: new(person("a.manager-msk1"))})
	_, err = s.UpdateProject(ctx, as(t, "a.manager-msk1"), mine, rev(1), rapi.RepairProjectPatch{Rooms: new(4)})
	wantCode(t, err, "forbidden_action", "")
	done := project(t, "Правка/сдан", seedOpts{status: "handed_over"})
	_, err = s.UpdateProject(ctx, office, done, rev(1), rapi.RepairProjectPatch{Rooms: new(4)})
	wantReason(t, err, "project_handed_over")
}

func TestAssignForeman(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Прораб/объект", seedOpts{})
	nobody := uuid.New()
	_, err := s.AssignForeman(ctx, office, id, nobody)
	wantField(t, err, "foremanMemberId", "")
	foreman := person("a.manager-msk1")
	p := must(s.AssignForeman(ctx, office, id, foreman)).of(t)
	if p.ForemanMemberId == nil || *p.ForemanMemberId != foreman || p.Revision != 2 {
		t.Fatalf("assigned: %+v", p)
	}
	if n := count(t, `select count(*) from repairs.project_events where project_id = $1 and kind = 'object.foreman_assigned'`, id); n != 1 {
		t.Fatalf("feed rows %d", n)
	}
	_, err = s.AssignForeman(ctx, office, id, person("a.driver-msk1"))
	wantReason(t, err, "foreman_already_assigned")
	draft := project(t, "Прораб/черновик", seedOpts{status: "draft"})
	_, err = s.AssignForeman(ctx, office, draft, foreman)
	wantCode(t, err, codeTransition, "Объект-черновик: прораб назначается после договора.")
	done := project(t, "Прораб/сдан", seedOpts{status: "handed_over"})
	_, err = s.AssignForeman(ctx, office, done, foreman)
	wantReason(t, err, "project_handed_over")
	_, err = s.AssignForeman(ctx, as(t, "a.manager-msk1"), project(t, "Прораб/чужой", seedOpts{}), foreman)
	wantCode(t, err, "not_found", "")
	_, err = s.AssignForeman(ctx, as(t, "a.manager-msk1"), project(t, "Прораб/свой", seedOpts{foreman: &foreman}), foreman)
	wantCode(t, err, "forbidden_action", "")
}

// estimate writes an approved estimate of two lines: a work 10 m2 × 100 ₽ and a material 2 pieces × 50 ₽, discount 10 %.
func estimate(t *testing.T, projectID uuid.UUID, state string) {
	t.Helper()
	est, sec := uuid.New(), uuid.New()
	approved := any(nil)
	if state == "approved" {
		approved = "2026-10-10T10:00:00Z"
	}
	if _, err := superA.Exec(t.Context(), `insert into repairs.estimates (id, project_id, version, kind, state, discount_pct, approved_at)
		values ($1, $2, 1, 'first', $3, 10, $4)`, est, projectID, state, approved); err != nil {
		t.Fatal(err)
	}
	if _, err := superA.Exec(t.Context(), `insert into repairs.estimate_sections (id, estimate_id, name) values ($1, $2, 'Пол')`, sec, est); err != nil {
		t.Fatal(err)
	}
	if _, err := superA.Exec(t.Context(), `insert into repairs.estimate_lines (estimate_id, section_id, name, unit, kind, price_minor, quantity, sort) values
		($1, $2, 'Стяжка пола', 'm2', 'work', 10000, 10, 1), ($1, $2, 'Смесь', 'piece', 'material', 5000, 2, 2)`, est, sec); err != nil {
		t.Fatal(err)
	}
}

func TestActivate(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	draft := project(t, "Активация/черновик", seedOpts{status: "draft"})
	p := must(s.Project(ctx, office, draft)).of(t)
	_, err := s.Activate(ctx, office, draft, rev(p.Revision))
	wantReason(t, err, "repair_estimate_not_approved")
	estimate(t, draft, "sent")
	_, err = s.Activate(ctx, office, draft, rev(p.Revision))
	wantReason(t, err, "repair_estimate_not_approved")
	for _, q := range []string{`delete from repairs.estimate_lines where estimate_id in (select id from repairs.estimates where project_id = $1)`,
		`delete from repairs.estimate_sections where estimate_id in (select id from repairs.estimates where project_id = $1)`,
		`delete from repairs.estimates where project_id = $1`} {
		if _, err := superA.Exec(ctx, q, draft); err != nil {
			t.Fatal(err)
		}
	}
	estimate(t, draft, "approved")
	_, err = s.Activate(ctx, office, draft, rev(p.Revision+5))
	wantCode(t, err, "revision_mismatch", "")
	a := must(s.Activate(ctx, office, draft, rev(p.Revision))).of(t)
	// 10 × 100 ₽ + 2 × 50 ₽ = 1 100 ₽, minus 10 % → 990 ₽
	if a.Status != rapi.RepairProjectStatusActive || a.Budget == nil || a.Budget.AmountMinor != 99000 || a.Revision != p.Revision+1 || a.Stage == nil || *a.Stage != "Подготовка" {
		t.Fatalf("activated: %+v budget %+v", a, a.Budget)
	}
	works := must(s.Works(ctx, office, draft)).of(t)
	if len(works.Items) != 1 || works.Items[0].Name != "Стяжка пола" || works.Items[0].Plan != "10" || works.Items[0].Fact != "0" || works.Items[0].EstimateLineId == nil {
		t.Fatalf("works of the work lines of the estimate: %+v", works.Items)
	}
	_, err = s.Activate(ctx, office, draft, rev(a.Revision))
	wantReason(t, err, "repair_project_not_draft")
	if n := count(t, `select count(*) from repairs.project_events where project_id = $1 and kind = 'object.activated'`, draft); n != 1 {
		t.Fatalf("feed rows %d", n)
	}
}

func TestHandOver(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Сдача/объект", seedOpts{})
	p := must(s.Project(ctx, office, id)).of(t)
	if _, err := superA.Exec(ctx, `update repairs.projects set contract_no = 'N-1' where id = $1`, id); err != nil {
		t.Fatal(err)
	}
	unsigned, signed, act := uuid.New(), uuid.New(), uuid.New()
	for _, d := range []struct {
		id    uuid.UUID
		kind  string
		state string
	}{{unsigned, "handover_act", "draft"}, {signed, "handover_act", "signed"}, {act, "act", "signed"}} {
		signedAt := any(nil)
		if d.state == "signed" {
			signedAt = "2026-10-20T10:00:00Z"
		}
		if _, err := superA.Exec(ctx, `insert into repairs.documents (id, project_id, kind, title, state, signed_at) values ($1, $2, $3, 'Акт', $4, $5)`,
			d.id, id, d.kind, d.state, signedAt); err != nil {
			t.Fatal(err)
		}
	}
	_, err := s.HandOver(ctx, office, id, rev(p.Revision), rapi.RepairHandOver{ActDocumentId: unsigned})
	wantReason(t, err, "repair_act_not_signed")
	_, err = s.HandOver(ctx, office, id, rev(p.Revision), rapi.RepairHandOver{ActDocumentId: act})
	wantReason(t, err, "repair_act_not_signed")
	_, err = s.HandOver(ctx, office, id, rev(p.Revision), rapi.RepairHandOver{ActDocumentId: uuid.New()})
	wantField(t, err, "actDocumentId", "")
	_, err = s.HandOver(ctx, as(t, "a.manager-msk2"), id, rev(p.Revision), rapi.RepairHandOver{ActDocumentId: signed})
	wantCode(t, err, "not_found", "")
	_, err = s.HandOver(ctx, as(t, "ab.member"), id, rev(p.Revision), rapi.RepairHandOver{ActDocumentId: signed})
	wantCode(t, err, "forbidden_action", "") // projects.hand_over is not in the desk role
	_, err = s.HandOver(ctx, office, id, rev(p.Revision+1), rapi.RepairHandOver{ActDocumentId: signed})
	wantCode(t, err, "revision_mismatch", "")
	h := must(s.HandOver(ctx, office, id, rev(p.Revision), rapi.RepairHandOver{ActDocumentId: signed, WarrantyMonths: new(12)})).of(t)
	if h.Status != rapi.RepairProjectStatusHandedOver || h.HandedOverOn == nil || h.WarrantyUntil == nil || h.Revision != p.Revision+1 {
		t.Fatalf("handed over: %+v", h)
	}
	if want := h.HandedOverOn.AddDate(1, 0, 0).Format(time.DateOnly); h.WarrantyUntil.String() != want {
		t.Fatalf("warranty %s, want %s", h.WarrantyUntil, want)
	}
	if h.Readiness.AcceptedPct != 100 || h.Readiness.ClientPct != 100 {
		t.Fatalf("handed over is ready: %+v", h.Readiness)
	}
	_, err = s.HandOver(ctx, office, id, rev(h.Revision), rapi.RepairHandOver{ActDocumentId: signed})
	wantReason(t, err, "project_handed_over")
	// the default warranty is the 24 months of the template
	id2 := project(t, "Сдача/второй", seedOpts{})
	h2 := must(s.HandOver(ctx, office, id2, rev(1), rapi.RepairHandOver{ActDocumentId: mustSignedAct(t, id2)})).of(t)
	if want := h2.HandedOverOn.AddDate(2, 0, 0).Format(time.DateOnly); h2.WarrantyUntil.String() != want {
		t.Fatalf("default warranty %s, want %s", h2.WarrantyUntil, want)
	}
}

func mustSignedAct(t *testing.T, projectID uuid.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := superA.Exec(t.Context(), `insert into repairs.documents (id, project_id, kind, title, state, signed_at) values ($1, $2, 'handover_act', 'Акт сдачи', 'signed', now())`,
		id, projectID); err != nil {
		t.Fatal(err)
	}
	return id
}

// A tenant is its own database: an object of tenant B is not an object of tenant A for any id, and the members of A
// read none of its feed, works or marks (AC-02).
func TestTenantIsolation(t *testing.T) {
	t.Parallel()
	ctx, s := t.Context(), service()
	superB, err := pgxpool.New(ctx, world.TenantURL(fixtures.TenantB, migratetest.Super))
	if err != nil {
		t.Fatal(err)
	}
	defer superB.Close()
	foreign := uuid.New()
	if _, err := superB.Exec(ctx, `insert into repairs.projects (id, org_unit_id, name, address, status) values ($1, $2, 'Объект тенанта Б 7731', 'ул. Б', 'active')`,
		foreign, ref("unit:b.msk1")); err != nil {
		t.Fatal(err)
	}
	for _, who := range []string{"a.owner", "a.region-msk", "a.manager-msk1"} {
		tc := as(t, who)
		_, err := s.Project(ctx, tc, foreign)
		wantCode(t, err, "not_found", "")
		_, err = s.Overview(ctx, tc, foreign)
		wantCode(t, err, "not_found", "")
		_, err = s.Works(ctx, tc, foreign)
		wantCode(t, err, "not_found", "")
		_, err = s.AssignForeman(ctx, tc, foreign, person("a.manager-msk1"))
		wantCode(t, err, "not_found", "")
		page := must(s.Projects(ctx, tc, ListQuery{Q: new("7731")})).of(t)
		if len(page.Items) != 0 {
			t.Fatalf("%s reads a foreign object: %v", who, ids(page.Items))
		}
	}
}
