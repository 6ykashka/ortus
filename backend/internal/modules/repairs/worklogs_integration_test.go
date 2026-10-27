//go:build integration

package repairs

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

// board is an active object of the foreman a.manager-msk1 with a work of 100 m2 (20 accepted) and two workers.
type board struct {
	project, work, ivan, petr uuid.UUID
}

func newBoard(t *testing.T, name string) board {
	t.Helper()
	me := person("a.manager-msk1")
	id := project(t, name, seedOpts{foreman: &me})
	return board{project: id, work: work(t, id, "Штукатурка стен", "m2", "100", "20"), ivan: crew(t, id, "Иван"), petr: crew(t, id, "Пётр")}
}

func material(t *testing.T, name string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := superA.Exec(t.Context(), `insert into repairs.price_items (id, section, name, unit, kind, price_minor) values ($1, 'Материалы', $2, 'piece', 'material', 25000)`,
		id, name); err != nil {
		t.Fatal(err)
	}
	return id
}

func mark(b board, qty string, mods ...func(*rapi.WorkLogCreate)) rapi.WorkLogCreate {
	w := rapi.WorkLogCreate{
		ProjectId: b.project, TimeZone: "Europe/Moscow",
		Lines:           []rapi.WorkLogLine{{WorkId: &b.work, Quantity: qty, Unit: rapi.WorkLogLineUnitM2}},
		EvidenceFileIds: slices.Clone(photos), CrewWorkerIds: &[]uuid.UUID{b.ivan, b.petr},
	}
	w.WorkDate.Time = day("2026-10-01")
	for _, m := range mods {
		m(&w)
	}
	return w
}

func TestSubmitWorkLog(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, foreman := t.Context(), service(), as(t, "a.manager-msk1")
	b := newBoard(t, "Отметки/сдача")
	paint := material(t, "Шпаклёвка Отметки/сдача")
	l := must(s.SubmitWorkLog(ctx, foreman, mark(b, "30", func(w *rapi.WorkLogCreate) {
		w.Note = new("Первый слой")
		w.Materials = &[]rapi.WorkLogMaterial{{PriceItemId: paint, Quantity: "4"}}
	}))).of(t)
	if l.Status != "submitted" || l.Number == nil || len(*l.Number) < 4 || (*l.Number)[:3] != "WL-" || l.Revision != 1 || l.SubmittedByMemberId != person("a.manager-msk1") {
		t.Fatalf("submitted: %+v", l)
	}
	if len(l.Lines) != 1 || l.Lines[0].Quantity != "30" || l.Lines[0].Unit != rapi.WorkLogLineUnitM2 || l.Lines[0].WorkId == nil || *l.Lines[0].WorkId != b.work {
		t.Fatalf("lines: %+v", l.Lines)
	}
	if l.CrewWorkerIds == nil || len(*l.CrewWorkerIds) != 2 || l.Materials == nil || len(*l.Materials) != 1 || (*l.Materials)[0].Quantity != "4" || len(l.EvidenceFileIds) != 2 {
		t.Fatalf("crew, materials, photos: %+v", l)
	}
	// the accepted fact is not touched by a mark on acceptance; the volume waits as «pending»
	w := must(s.Works(ctx, as(t, "a.region-msk"), b.project)).of(t)
	if w.Items[0].Fact != "20" || w.Items[0].Pending != "30" {
		t.Fatalf("works: %+v", w.Items)
	}
	// numbers go on
	l2 := must(s.SubmitWorkLog(ctx, foreman, mark(b, "5"))).of(t)
	if *l2.Number == *l.Number {
		t.Fatalf("the same number %s", *l.Number)
	}
	if n := count(t, `select count(*) from repairs.project_events where project_id = $1 and kind = 'work_log.submitted'`, b.project); n != 2 {
		t.Fatalf("feed rows %d", n)
	}
}

func TestSubmitWorkLogRefusals(t *testing.T) {
	t.Parallel()
	ctx, s, foreman := t.Context(), service(), as(t, "a.manager-msk1")
	b := newBoard(t, "Отметки/отказы")
	other := newBoard(t, "Отметки/чужая бригада")
	ghost := uuid.New()

	// only the foreman of the object; the office reads and reviews but does not mark
	_, err := s.SubmitWorkLog(ctx, as(t, "a.region-msk"), mark(b, "10"))
	wantCode(t, err, "forbidden_action", "Отметку по объекту отправляет его прораб.")
	otherForeman := project(t, "Отметки/чужой объект", seedOpts{foreman: new(person("a.driver-msk1"))})
	_, err = s.SubmitWorkLog(ctx, foreman, mark(board{project: otherForeman, work: b.work, ivan: b.ivan, petr: b.petr}, "10"))
	wantCode(t, err, "not_found", "")
	_, err = s.SubmitWorkLog(ctx, foreman, mark(b, "10", func(w *rapi.WorkLogCreate) { w.ProjectId = uuid.New() }))
	wantCode(t, err, "not_found", "")

	_, err = s.SubmitWorkLog(ctx, foreman, mark(b, "10", func(w *rapi.WorkLogCreate) { w.EvidenceFileIds = nil }))
	wantField(t, err, "evidenceFileIds", "")
	_, err = s.SubmitWorkLog(ctx, foreman, mark(b, "10", func(w *rapi.WorkLogCreate) { w.CrewWorkerIds = &[]uuid.UUID{} }))
	wantField(t, err, "crewWorkerIds", "")
	_, err = s.SubmitWorkLog(ctx, foreman, mark(b, "10", func(w *rapi.WorkLogCreate) { w.CrewWorkerIds = &[]uuid.UUID{other.ivan} }))
	wantField(t, err, "crewWorkerIds", "")
	_, err = s.SubmitWorkLog(ctx, foreman, mark(b, "10", func(w *rapi.WorkLogCreate) { w.Lines[0].WorkId = &other.work }))
	wantField(t, err, "lines[0].workId", "")
	_, err = s.SubmitWorkLog(ctx, foreman, mark(b, "10", func(w *rapi.WorkLogCreate) { w.Lines[0].WorkId = nil }))
	wantField(t, err, "lines[0].workId", "")
	_, err = s.SubmitWorkLog(ctx, foreman, mark(b, "0"))
	wantField(t, err, "lines[0].quantity", "")
	_, err = s.SubmitWorkLog(ctx, foreman, mark(b, "1.5.5"))
	wantField(t, err, "lines[0].quantity", "")
	_, err = s.SubmitWorkLog(ctx, foreman, mark(b, "10", func(w *rapi.WorkLogCreate) {
		w.Materials = &[]rapi.WorkLogMaterial{{PriceItemId: ghost, Quantity: "1"}}
	}))
	wantField(t, err, "materials[0].priceItemId", "")
	_, err = s.SubmitWorkLog(ctx, foreman, mark(b, "10", func(w *rapi.WorkLogCreate) { w.Lines = nil }))
	wantField(t, err, "lines", "")

	// the rest is 80; 100 is over the rest by more than 10 % — and the text names what is left (MSW)
	_, err = s.SubmitWorkLog(ctx, foreman, mark(b, "100"))
	wantField(t, err, "lines[0].quantity", "work_volume_exceeds_plan")
	wantCode(t, err, "validation_failed", "Объём превышает план более чем на 10%: осталось 80 м².")
	// a mark on acceptance counts as taken
	must(s.SubmitWorkLog(ctx, foreman, mark(b, "70"))).of(t)
	_, err = s.SubmitWorkLog(ctx, foreman, mark(b, "40"))
	wantField(t, err, "lines[0].quantity", "work_volume_exceeds_plan")
	must(s.SubmitWorkLog(ctx, foreman, mark(b, "10"))).of(t) // exactly what is left

	// no marks on a draft and on a handed over object
	draft := project(t, "Отметки/черновик", seedOpts{status: "draft"})
	_, err = s.SubmitWorkLog(ctx, foreman, mark(board{project: draft, work: b.work, ivan: b.ivan, petr: b.petr}, "1"))
	wantCode(t, err, "not_found", "")
	done := project(t, "Отметки/сдан", seedOpts{status: "handed_over", foreman: new(person("a.manager-msk1"))})
	_, err = s.SubmitWorkLog(ctx, foreman, mark(board{project: done, work: b.work, ivan: b.ivan, petr: b.petr}, "1"))
	wantReason(t, err, "project_handed_over")
	_, err = s.SubmitWorkLog(ctx, as(t, "a.manager-msk2"), mark(b, "1"))
	wantCode(t, err, "not_found", "")
}

func TestAcceptWorkLog(t *testing.T) {
	t.Parallel()
	ctx, s, foreman, office := t.Context(), service(), as(t, "a.manager-msk1"), as(t, "a.region-msk")
	b := newBoard(t, "Приёмка/объект")
	l := must(s.SubmitWorkLog(ctx, foreman, mark(b, "30"))).of(t)
	_, err := s.AcceptWorkLog(ctx, foreman, l.Id, rev(l.Revision))
	wantCode(t, err, "forbidden_action", "Нужно право «Принимать объём».")
	_, err = s.AcceptWorkLog(ctx, as(t, "a.manager-msk2"), l.Id, rev(l.Revision))
	wantCode(t, err, "not_found", "")
	_, err = s.AcceptWorkLog(ctx, office, l.Id, rev(l.Revision+1))
	wantCode(t, err, "revision_mismatch", "")
	_, err = s.AcceptWorkLog(ctx, office, uuid.New(), rev(1))
	wantCode(t, err, "not_found", "")

	a := must(s.AcceptWorkLog(ctx, office, l.Id, rev(l.Revision))).of(t)
	if a.Status != "accepted" || a.Revision != l.Revision+1 || a.AcceptedAt == nil || a.AcceptedByMemberId == nil || *a.AcceptedByMemberId != person("a.region-msk") {
		t.Fatalf("accepted: %+v", a)
	}
	w := must(s.Works(ctx, office, b.project)).of(t)
	if w.Items[0].Fact != "50" || w.Items[0].Pending != "0" {
		t.Fatalf("fact grows by the accepted volume: %+v", w.Items)
	}
	_, err = s.AcceptWorkLog(ctx, office, l.Id, rev(a.Revision))
	wantReason(t, err, "work_log_already_reviewed")
	_, err = s.ReturnWorkLog(ctx, office, l.Id, rev(a.Revision), "поздно")
	wantReason(t, err, "work_log_already_reviewed")
	if n := count(t, `select count(*) from repairs.project_events where project_id = $1 and kind = 'work_log.accepted'`, b.project); n != 1 {
		t.Fatalf("feed rows %d", n)
	}
	// readiness: 50 of 100
	p := must(s.Project(ctx, office, b.project)).of(t)
	if p.Readiness.AcceptedPct != 50 {
		t.Fatalf("readiness: %+v", p.Readiness)
	}
}

// Accepting is the only way the fact grows, and the materials of the mark leave the stock of the object.
func TestAcceptWorkLogWritesOffMaterials(t *testing.T) {
	t.Parallel()
	ctx, s, foreman, office := t.Context(), service(), as(t, "a.manager-msk1"), as(t, "a.region-msk")
	b := newBoard(t, "Приёмка/материалы")
	item := material(t, "Грунтовка Приёмка/материалы")
	if _, err := superA.Exec(ctx, `insert into repairs.project_stock (project_id, price_item_id, quantity, cost_minor) values ($1, $2, 10, 100000)`, b.project, item); err != nil {
		t.Fatal(err)
	}
	l := must(s.SubmitWorkLog(ctx, foreman, mark(b, "5", func(w *rapi.WorkLogCreate) {
		w.Materials = &[]rapi.WorkLogMaterial{{PriceItemId: item, Quantity: "4"}}
	}))).of(t)
	var q string
	var cost int64
	read := func() {
		if err := superA.QueryRow(ctx, `select quantity::text, cost_minor from repairs.project_stock where project_id = $1 and price_item_id = $2`, b.project, item).Scan(&q, &cost); err != nil {
			t.Fatal(err)
		}
	}
	read()
	if q != "10.000" {
		t.Fatalf("the stock stays until acceptance: %s", q)
	}
	must(s.AcceptWorkLog(ctx, office, l.Id, rev(l.Revision))).of(t)
	read()
	if q != "6.000" || cost != 60000 {
		t.Fatalf("stock after acceptance: %s, %d (average price 10 000 per piece stays)", q, cost)
	}
}

func TestReturnWorkLog(t *testing.T) {
	t.Parallel()
	ctx, s, foreman, office := t.Context(), service(), as(t, "a.manager-msk1"), as(t, "a.region-msk")
	b := newBoard(t, "Возврат/объект")
	l := must(s.SubmitWorkLog(ctx, foreman, mark(b, "30"))).of(t)
	_, err := s.ReturnWorkLog(ctx, office, l.Id, rev(l.Revision), " ")
	wantField(t, err, "reason", "")
	_, err = s.ReturnWorkLog(ctx, foreman, l.Id, rev(l.Revision), "переделать")
	wantCode(t, err, "forbidden_action", "")
	_, err = s.ReturnWorkLog(ctx, office, l.Id, rev(l.Revision+3), "переделать")
	wantCode(t, err, "revision_mismatch", "")
	r := must(s.ReturnWorkLog(ctx, office, l.Id, rev(l.Revision), "  Нет фото угла  ")).of(t)
	if r.Status != "rejected" || r.ReturnReason == nil || *r.ReturnReason != "Нет фото угла" || r.Revision != l.Revision+1 {
		t.Fatalf("returned: %+v", r)
	}
	w := must(s.Works(ctx, office, b.project)).of(t)
	if w.Items[0].Fact != "20" || w.Items[0].Pending != "0" {
		t.Fatalf("a returned mark is neither fact nor pending: %+v", w.Items)
	}
	// the foreman and the office read the reason
	for _, who := range []string{"a.manager-msk1", "a.region-msk"} {
		page := must(s.WorkLogs(ctx, as(t, who), LogQuery{Project: &b.project, Status: new("rejected")})).of(t)
		if len(page.Items) != 1 || page.Items[0].ReturnReason == nil || *page.Items[0].ReturnReason != "Нет фото угла" {
			t.Fatalf("%s: %+v", who, page.Items)
		}
	}
	// the crew has no account, so it never asks; a reader of the area reads logs only with work_logs.read
	if n := count(t, `select count(*) from repairs.project_events where project_id = $1 and kind = 'work_log.returned'`, b.project); n != 1 {
		t.Fatalf("feed rows %d", n)
	}
}

func TestListWorkLogs(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, foreman, office := t.Context(), service(), as(t, "a.manager-msk1"), as(t, "a.region-msk")
	mine, theirs := newBoard(t, "Журнал/мой"), project(t, "Журнал/чужой", seedOpts{foreman: new(person("a.driver-msk1"))})
	l1 := must(s.SubmitWorkLog(ctx, foreman, mark(mine, "10"))).of(t)
	l2 := must(s.SubmitWorkLog(ctx, foreman, mark(mine, "12"))).of(t)
	must(s.AcceptWorkLog(ctx, office, l1.Id, rev(l1.Revision))).of(t)
	tw := work(t, theirs, "Чужая работа", "m2", "10", "0")
	lid := uuid.New()
	if _, err := superA.Exec(ctx, `insert into repairs.work_logs (id, number, project_id, submitted_by, work_date, time_zone, evidence_file_ids)
		values ($1, 'WL-9100', $2, $3, '2026-10-21', 'Europe/Moscow', array[gen_random_uuid()])`, lid, theirs, person("a.driver-msk1")); err != nil {
		t.Fatal(err)
	}
	if _, err := superA.Exec(ctx, `insert into repairs.work_log_lines (work_log_id, line_no, work_id, quantity, unit) values ($1, 1, $2, 3, 'm2')`, lid, tw); err != nil {
		t.Fatal(err)
	}

	page := must(s.WorkLogs(ctx, office, LogQuery{Project: &mine.project})).of(t)
	if len(page.Items) != 2 || page.Items[0].Id != l2.Id || page.Items[1].Id != l1.Id {
		t.Fatalf("the latest first: %+v", page.Items)
	}
	if page = must(s.WorkLogs(ctx, office, LogQuery{Project: &mine.project, Status: new("accepted")})).of(t); len(page.Items) != 1 || page.Items[0].Id != l1.Id {
		t.Fatalf("status filter: %+v", page.Items)
	}
	// the foreman reads the logs of his own objects only
	own := must(s.WorkLogs(ctx, foreman, LogQuery{})).of(t)
	for _, l := range own.Items {
		if l.ProjectId == theirs {
			t.Fatalf("the foreman reads a log of a foreign object: %+v", l)
		}
	}
	if p := must(s.WorkLogs(ctx, foreman, LogQuery{Project: &theirs})).of(t); len(p.Items) != 0 {
		t.Fatalf("a foreign object is empty for the foreman: %+v", p.Items)
	}
	// the reader of Москва-2 has no work_logs.read
	_, err := s.WorkLogs(ctx, as(t, "a.manager-msk2"), LogQuery{})
	wantCode(t, err, "forbidden_action", "")
	if _, err := s.WorkLogs(ctx, office, LogQuery{Status: new("nope")}); err == nil {
		t.Fatal("an unknown status is malformed_request")
	}
	paged := must(s.WorkLogs(ctx, office, LogQuery{Project: &mine.project, Limit: new(1)})).of(t)
	if len(paged.Items) != 1 || paged.NextCursor == nil {
		t.Fatalf("paging: %+v", paged)
	}
}

func TestListWorks(t *testing.T) {
	t.Parallel()
	ctx, s := t.Context(), service()
	b := newBoard(t, "Работы/объект")
	w := must(s.Works(ctx, as(t, "a.manager-msk1"), b.project)).of(t)
	if len(w.Items) != 1 || w.Items[0].Id != b.work || w.Items[0].ProjectId != b.project || w.Items[0].Unit != "m2" || w.Items[0].Plan != "100" || w.Items[0].Fact != "20" || w.Items[0].Pending != "0" {
		t.Fatalf("works: %+v", w.Items)
	}
	_, err := s.Works(ctx, as(t, "a.manager-msk1"), project(t, "Работы/чужой", seedOpts{foreman: new(person("a.driver-msk1"))}))
	wantCode(t, err, "not_found", "")
}

// The evidence of a mark names the files of its tenant: a file that is not in files.objects of the tenant (a made-up id,
// the file of another organization) is a violation of evidenceFileIds, not a mark with a dangling photo (Q-W6.11-3).
func TestSubmitWorkLogChecksPhotos(t *testing.T) {
	t.Parallel()
	ctx, s, foreman := t.Context(), service(), as(t, "a.manager-msk1")
	b := newBoard(t, "Отметки/фото")
	for name, files := range map[string][]uuid.UUID{
		"made-up":    {uuid.New()},
		"one of two": {photos[0], uuid.New()},
	} {
		_, err := s.SubmitWorkLog(ctx, foreman, mark(b, "1", func(w *rapi.WorkLogCreate) { w.EvidenceFileIds = files }))
		if f, ok := asFailure(err); !ok || f.code != codeValidation {
			t.Fatalf("%s: %v, want validation_failed on evidenceFileIds", name, err)
		}
		wantField(t, err, "evidenceFileIds", "")
	}
	// a file that is not ready (an upload being scanned) is not evidence either
	pending := uuid.New()
	if _, err := superA.Exec(ctx, `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime, bytes, uploaded_by, created_at)
		values ($1, $2, 'scanning', 'inspection', 'fleet.vehicle', $3, 'image/jpeg', 10, $4, $5)`,
		pending, "repairs/pending-"+pending.String()+".jpg", uuid.New(), person("a.owner"), clock()); err != nil {
		t.Fatal(err)
	}
	_, err := s.SubmitWorkLog(ctx, foreman, mark(b, "1", func(w *rapi.WorkLogCreate) { w.EvidenceFileIds = []uuid.UUID{pending} }))
	wantField(t, err, "evidenceFileIds", "")
	must(s.SubmitWorkLog(ctx, foreman, mark(b, "1", func(w *rapi.WorkLogCreate) { w.EvidenceFileIds = []uuid.UUID{photos[0], photos[0]} }))).of(t)
}

// A mark is of a day that has begun: the date in the zone of the mark is not later than today there (Q-W6.11-7).
func TestSubmitWorkLogDate(t *testing.T) {
	t.Parallel()
	ctx, s, foreman := t.Context(), service(), as(t, "a.manager-msk1")
	b := newBoard(t, "Отметки/дата")
	for _, d := range []string{"2026-10-02", "2027-01-01"} {
		_, err := s.SubmitWorkLog(ctx, foreman, mark(b, "1", func(w *rapi.WorkLogCreate) { w.WorkDate.Time = day(d) }))
		wantField(t, err, "workDate", "")
	}
	// the clock of the suite is 01.10.2026 10:30 MSK: in Honolulu it is still the evening of the 30th of September
	must(s.SubmitWorkLog(ctx, foreman, mark(b, "1", func(w *rapi.WorkLogCreate) {
		w.WorkDate.Time, w.TimeZone = day("2026-09-30"), "Pacific/Honolulu"
	}))).of(t)
	_, err := s.SubmitWorkLog(ctx, foreman, mark(b, "1", func(w *rapi.WorkLogCreate) { w.WorkDate.Time, w.TimeZone = day("2026-10-01"), "Pacific/Honolulu" }))
	wantField(t, err, "workDate", "")
	must(s.SubmitWorkLog(ctx, foreman, mark(b, "1", func(w *rapi.WorkLogCreate) { w.WorkDate.Time = day("2026-09-01") }))).of(t)
}

// A handed-over object takes no decisions on its marks: accepting and returning are refused as sending is (409
// project_handed_over), the mark stays on acceptance and the fact does not move (Q-W6.11-8).
func TestReviewRefusedOnHandedOver(t *testing.T) {
	t.Parallel()
	ctx, s, foreman, office := t.Context(), service(), as(t, "a.manager-msk1"), as(t, "a.region-msk")
	b := newBoard(t, "Приёмка/сдан")
	l := must(s.SubmitWorkLog(ctx, foreman, mark(b, "30"))).of(t)
	if _, err := superA.Exec(ctx, `update repairs.projects set status = 'handed_over', handed_over_on = '2026-09-30' where id = $1`, b.project); err != nil {
		t.Fatal(err)
	}
	_, err := s.AcceptWorkLog(ctx, office, l.Id, rev(l.Revision))
	wantReason(t, err, "project_handed_over")
	_, err = s.ReturnWorkLog(ctx, office, l.Id, rev(l.Revision), "поздно")
	wantReason(t, err, "project_handed_over")
	if n := count(t, `select count(*) from repairs.work_logs where id = $1 and status = 'submitted'`, l.Id); n != 1 {
		t.Fatal("the mark of a handed-over object changed")
	}
	if f := count(t, `select count(*) from repairs.works where id = $1 and fact_qty = 20`, b.work); f != 1 {
		t.Fatal("the fact of a handed-over object moved")
	}
}

// The page of the marks is cut by the database: the cursor walks all the marks of the objects, newest first, each once.
func TestListWorkLogsCursorWalk(t *testing.T) {
	t.Parallel()
	ctx, s, foreman, office := t.Context(), service(), as(t, "a.manager-msk1"), as(t, "a.region-msk")
	b := newBoard(t, "Журнал/курсор")
	var want []uuid.UUID
	for _, q := range []string{"1", "2", "3", "4", "5"} {
		want = append([]uuid.UUID{must(s.SubmitWorkLog(ctx, foreman, mark(b, q))).of(t).Id}, want...)
	}
	var got []uuid.UUID
	var cursor *string
	for range 10 {
		page := must(s.WorkLogs(ctx, office, LogQuery{Project: &b.project, Limit: new(2), Cursor: cursor})).of(t)
		if len(page.Items) > 2 {
			t.Fatalf("page of %d, limit 2", len(page.Items))
		}
		for _, l := range page.Items {
			got = append(got, l.Id)
		}
		if cursor = page.NextCursor; cursor == nil {
			break
		}
	}
	if !slices.Equal(got, want) {
		t.Fatalf("walk %v, want %v", got, want)
	}
	// the cursor past the end is an empty page, not an error
	end := "o99"
	if page := must(s.WorkLogs(ctx, office, LogQuery{Project: &b.project, Cursor: &end})).of(t); len(page.Items) != 0 || page.NextCursor != nil {
		t.Fatalf("past the end: %+v", page)
	}
}
