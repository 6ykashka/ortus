//go:build integration

package repairs

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

// W6.14: the schedule of an object — the six operations of step 6.5 over the model of the prototype «ЖК Речной ·
// квартира 42» (docs/plan/v2/analysis/dor/repair.md §2.6): D0 = 05.10.2026, the contract due date 27.11, the forecast
// 01.12 (+2 working days), the critical path s2→s3→s5→s7→s9→s10. The roles of the schedule are written once for the
// package (scheduleRoles): the office of Москва reads, moves and fixes the baseline, the foreman («своё») reads and moves.

var (
	schedRolesOnce sync.Once
	errSchedRoles  error
)

// scheduleRoles gives a.region-msk (the office) and a.manager-msk1 (the foreman) the rights of the schedule.
func scheduleRoles(t *testing.T) {
	t.Helper()
	schedRolesOnce.Do(func() {
		office, foreman := uuid.New(), uuid.New()
		for _, r := range []struct {
			id      uuid.UUID
			name    string
			actions []string
		}{
			{office, "График: офис", []string{actSchedRead, actSchedShift, actSchedBaseline}},
			{foreman, "График: прораб", []string{actSchedRead, actSchedShift}},
		} {
			if _, errSchedRoles = superA.Exec(context.Background(), `insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, r.id, r.name); errSchedRoles != nil {
				return
			}
			if _, errSchedRoles = superA.Exec(context.Background(), `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`,
				r.id, r.actions, person("a.owner")); errSchedRoles != nil {
				return
			}
		}
		for _, g := range []struct {
			actor, kind, unit string
			role              uuid.UUID
		}{{"a.region-msk", "unit", "msk", office}, {"a.manager-msk1", "self", "", foreman}} {
			var scope any
			if g.unit != "" {
				scope = unit(g.unit)
			}
			if _, errSchedRoles = superA.Exec(context.Background(), `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version,
				scope_kind, scope_ref, include_descendants, valid, granted_by) values ('person', $1, $2, 1, $3, $4, true,
				tstzrange($5::timestamptz, null), $6)`, person(g.actor), g.role, g.kind, scope, time.Date(2020, 1, 1, 0, 0, 0, 0, time.UTC), person("a.owner")); errSchedRoles != nil {
				return
			}
		}
	})
	if errSchedRoles != nil {
		t.Fatal(errSchedRoles)
	}
}

// today is the date of the prototype scenario (Q-W4.00-repair-15): 20.10.2026.
var today = time.Date(2026, 10, 20, 9, 0, 0, 0, time.UTC)

// svc is the service with the clock stopped on today.
func svc() *Service { return &Service{Pools: pools, Now: func() time.Time { return today }} }

type stageSeed struct {
	key, name, who string
	dur            int
	started        string // actual start, "" — not yet
	done           bool
}

var obj42Stages = []stageSeed{
	{"s1", "Демонтаж", "Бригада О. Дронова", 5, "2026-10-05", true},
	{"s2", "Электрика · черновая", "ООО «ЭлектроПрофи»", 10, "2026-10-12", false},
	{"s3", "Штукатурка стен", "Бригада О. Дронова", 10, "", false},
	{"s4", "Стяжка пола", "Бригада О. Дронова", 2, "", false},
	{"s5", "Шпаклёвка и покраска стен", "Бригада О. Дронова", 12, "", false},
	{"s6", "Плитка в санузле", "", 5, "", false},
	{"s7", "Укладка ламината", "Бригада О. Дронова", 3, "", false},
	{"s8", "Электрика · чистовая", "ООО «ЭлектроПрофи»", 2, "", false},
	{"s9", "Уборка и подготовка к сдаче", "Бригада О. Дронова", 1, "", false},
	{"s10", "Сдача объекта", "Алексей Соколов", 1, "", false},
}

var obj42Links = []struct {
	from, to string
	lag      int
}{
	{"s1", "s2", 0}, {"s2", "s3", -3}, {"s3", "s4", 0}, {"s3", "s5", 5}, {"s4", "s6", 3}, {"s4", "s7", 10}, {"s5", "s7", 0},
	{"s5", "s8", 0}, {"s6", "s9", 0}, {"s7", "s9", 0}, {"s8", "s9", 0}, {"s9", "s10", 0},
}

// scheduled makes an object (start 05.10, due 27.11, the foreman a.manager-msk1) with the schedule of the prototype and
// the baseline of the contract; it returns the object and the ids of the stages by the keys s1…s10.
func scheduled(t *testing.T, name string, o seedOpts) (uuid.UUID, map[string]uuid.UUID) {
	t.Helper()
	scheduleRoles(t)
	if o.foreman == nil {
		o.foreman = new(person("a.manager-msk1"))
	}
	o.due = "2026-11-27"
	id := project(t, name, o)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := superA.Exec(t.Context(), sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`update repairs.projects set start_on = '2026-10-05' where id = $1`, id)
	ids := map[string]uuid.UUID{}
	for i, s := range obj42Stages {
		ids[s.key] = uuid.New()
		var start, who any
		if s.started != "" {
			start = s.started
		}
		if s.who != "" {
			who = s.who
		}
		status := "planned"
		switch {
		case s.done:
			status = "done"
		case s.started != "":
			status = "started"
		}
		phase := "Черновые работы"
		if i > 3 {
			phase = "Чистовые работы"
		}
		exec(`insert into repairs.schedule_stages (id, project_id, phase, name, duration_wd, actual_start, status, executor_name, sort)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, ids[s.key], id, phase, s.name, s.dur, start, status, who, i)
	}
	for _, l := range obj42Links {
		exec(`insert into repairs.schedule_links (project_id, from_stage_id, to_stage_id, lag_days) values ($1, $2, $3, $4)`,
			id, ids[l.from], ids[l.to], l.lag)
	}
	exec(`insert into repairs.schedule_baselines (project_id, version, due_on, snapshot) values ($1, 1, '2026-11-27', '{}')`, id)
	return id, ids
}

func isoDay(d interface{ Format(string) string }) string { return d.Format(time.DateOnly) }

func dayPtr[D interface{ Format(string) string }](d *D) string {
	if d == nil {
		return ""
	}
	return isoDay(*d)
}

func stageOf(t *testing.T, s rapi.Schedule, id uuid.UUID) rapi.ScheduleStage {
	t.Helper()
	for _, st := range s.Stages {
		if st.Id == id {
			return st
		}
	}
	t.Fatalf("no stage %s in the schedule", id)
	return rapi.ScheduleStage{}
}

func TestGetScheduleForecastAndCriticalPath(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes in a row
	t.Parallel()
	ctx, s, office := t.Context(), svc(), as(t, "a.region-msk")
	id, st := scheduled(t, "График: прогноз", seedOpts{})
	got := must(s.Schedule(ctx, office, id)).of(t)
	if dayPtr(got.ForecastDueOn) != "2026-12-01" || got.DelayWd != 2 {
		t.Errorf("forecast %s, delay %d, want 2026-12-01 and 2 working days", dayPtr(got.ForecastDueOn), got.DelayWd)
	}
	if got.Baseline == nil || got.Baseline.Version != 1 || isoDay(got.Baseline.DueOn) != "2026-11-27" {
		t.Errorf("baseline %+v, want version 1 with the due date 2026-11-27", got.Baseline)
	}
	if len(got.Stages) != 10 || len(got.Links) != 12 || got.Revision < 1 {
		t.Errorf("%d stages, %d links, revision %d", len(got.Stages), len(got.Links), got.Revision)
	}
	critical := map[string]bool{"s2": true, "s3": true, "s5": true, "s7": true, "s9": true, "s10": true}
	slack := map[string]int{"s8": 1, "s4": 5, "s6": 9}
	for key, sid := range st {
		sg := stageOf(t, got, sid)
		if sg.Critical != critical[key] {
			t.Errorf("%s: critical %v, want %v", key, sg.Critical, critical[key])
		}
		if want, ok := slack[key]; ok && sg.SlackWd != want {
			t.Errorf("%s: slack %d, want %d", key, sg.SlackWd, want)
		}
	}
	if s2 := stageOf(t, got, st["s2"]); isoDay(s2.StartOn) != "2026-10-12" || s2.Status != "started" || s2.DurationWd != 10 {
		t.Errorf("s2 %+v: a stage that has begun keeps its start 2026-10-12", s2)
	}
	if s10 := stageOf(t, got, st["s10"]); isoDay(s10.EndOn) != "2026-12-01" {
		t.Errorf("s10 ends %s, want 2026-12-01", isoDay(s10.EndOn))
	}
	var noExecutor []uuid.UUID
	for _, is := range got.Issues {
		if is.Kind == rapi.ScheduleIssueKindNoExecutor {
			noExecutor = append(noExecutor, is.StageId)
		}
	}
	if len(noExecutor) != 1 || noExecutor[0] != st["s6"] {
		t.Errorf("no_executor issues %v, want only s6", noExecutor)
	}
	if !holidayListed(got, "2026-11-04") {
		t.Errorf("holidays %v lack 2026-11-04", got.Holidays)
	}
}

func holidayListed(s rapi.Schedule, iso string) bool {
	for _, h := range s.Holidays {
		if isoDay(h) == iso {
			return true
		}
	}
	return false
}

func TestGetScheduleEmptyAndAccess(t *testing.T) {
	t.Parallel()
	ctx, s := t.Context(), svc()
	empty := project(t, "График: пустой", seedOpts{})
	scheduleRoles(t)
	got := must(s.Schedule(ctx, as(t, "a.region-msk"), empty)).of(t)
	if len(got.Stages) != 0 || got.ForecastDueOn != nil || got.DelayWd != 0 || got.Baseline != nil {
		t.Errorf("an object without a schedule: %+v", got)
	}
	id, _ := scheduled(t, "График: доступ", seedOpts{})
	// the foreman of the object reads it; the foreman of nothing and the office without the right are refused
	must(s.Schedule(ctx, as(t, "a.manager-msk1"), id)).of(t)
	_, err := s.Schedule(ctx, as(t, "ab.member"), id) // the office of the object (projects.manage) without repairs.schedule.read
	wantCode(t, err, "forbidden_action", "")
	_, err = s.Schedule(ctx, as(t, "a.manager-msk2"), id) // sees no object: not its foreman, not the office
	wantCode(t, err, "not_found", textObjectNotFound)
	_, err = s.Schedule(ctx, as(t, "a.region-msk"), uuid.New())
	wantCode(t, err, "not_found", textObjectNotFound)
	other := project(t, "График: чужой прораб", seedOpts{foreman: new(person("a.manager-msk2"))})
	_, err = s.Schedule(ctx, as(t, "a.manager-msk1"), other)
	wantCode(t, err, "not_found", textObjectNotFound)
}

func change(stage uuid.UUID, mut func(*rapi.ScheduleStageChange)) rapi.ScheduleStageChange {
	c := rapi.ScheduleStageChange{StageId: stage}
	if mut != nil {
		mut(&c)
	}
	return c
}

func longer(n int) func(*rapi.ScheduleStageChange) {
	return func(c *rapi.ScheduleStageChange) { c.DurationWd = &n }
}

func TestPreviewScheduleChange(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), svc(), as(t, "a.region-msk")
	id, st := scheduled(t, "График: предпросмотр", seedOpts{})
	before := must(s.Schedule(ctx, office, id)).of(t)
	got := must(s.PreviewSchedule(ctx, office, id, []rapi.ScheduleStageChange{change(st["s3"], longer(12))})).of(t)
	if dayPtr(got.ForecastDueOn) != "2026-12-04" || got.DelayWd != 5 {
		t.Errorf("preview forecast %s delay %d, want 2026-12-04 and 5", dayPtr(got.ForecastDueOn), got.DelayWd)
	}
	moved := map[uuid.UUID]bool{}
	for _, m := range got.Moved {
		moved[m.StageId] = true
		if m.FromStartOn == m.ToStartOn {
			t.Errorf("%s is listed as moved with the same start", m.StageId)
		}
	}
	if moved[st["s3"]] || moved[st["s2"]] || !moved[st["s4"]] || !moved[st["s10"]] {
		t.Errorf("moved %v: the followers of s3 move, s3 itself and its predecessors do not", got.Moved)
	}
	for _, who := range []string{"Бригада О. Дронова", "Заказчик"} {
		found := false
		for _, n := range got.NotifyWho {
			found = found || n == who
		}
		if !found {
			t.Errorf("notifyWho %v lacks %q", got.NotifyWho, who)
		}
	}
	after := must(s.Schedule(ctx, office, id)).of(t)
	if after.Revision != before.Revision || len(after.Changes) != len(before.Changes) || dayPtr(after.ForecastDueOn) != dayPtr(before.ForecastDueOn) {
		t.Error("a preview must not write anything")
	}
	// a move that changes nothing: no moved stages, the same forecast
	same := must(s.PreviewSchedule(ctx, office, id, []rapi.ScheduleStageChange{change(st["s3"], longer(10))})).of(t)
	if len(same.Moved) != 0 || dayPtr(same.ForecastDueOn) != "2026-12-01" || same.DelayWd != 2 {
		t.Errorf("no change: %+v", same)
	}
	_, err := s.PreviewSchedule(ctx, as(t, "a.manager-msk2"), id, []rapi.ScheduleStageChange{change(st["s3"], longer(12))})
	wantCode(t, err, "not_found", textObjectNotFound)
	_, err = s.PreviewSchedule(ctx, as(t, "ab.member"), id, []rapi.ScheduleStageChange{change(st["s3"], longer(12))})
	wantCode(t, err, "forbidden_action", "")
}

func TestPreviewScheduleChangeRefusals(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), svc(), as(t, "a.region-msk")
	id, st := scheduled(t, "График: отказы переноса", seedOpts{})
	prev := func(cs ...rapi.ScheduleStageChange) error {
		_, err := s.PreviewSchedule(ctx, office, id, cs)
		return err
	}
	wantField(t, prev(change(uuid.New(), longer(3))), "changes[0].stageId", "")
	wantReason(t, prev(change(st["s1"], longer(3))), "schedule_stage_locked") // done
	wantReason(t, prev(change(st["s2"], func(c *rapi.ScheduleStageChange) { c.OffsetWd = new(1) })), "schedule_stage_locked")
	wantReason(t, prev(change(st["s2"], func(c *rapi.ScheduleStageChange) { c.LagDays = new(2) })), "schedule_stage_locked")
	wantField(t, prev(change(st["s2"], longer(7))), "changes[0].durationWd", "") // the days passed since 12.10 (7) + tomorrow
	if err := prev(change(st["s2"], longer(8))); err != nil {
		t.Errorf("the minimal duration of a stage that has begun (8): %v", err)
	}
	wantField(t, prev(change(st["s3"], longer(3)), change(st["s3"], longer(4))), "changes[1].stageId", "")
	wantField(t, prev(change(st["s1"], nil)), "changes[0]", "") // a change of nothing
	wantField(t, prev(change(st["s3"], func(c *rapi.ScheduleStageChange) { c.LagDays = new(90) })), "changes[0].lagDays", "")
	wantField(t, prev(change(st["s3"], longer(0))), "changes[0].durationWd", "")
	wantField(t, prev(change(st["s4"], longer(3)), change(st["s3"], func(c *rapi.ScheduleStageChange) { c.OffsetWd = new(-1) })), "changes[1].offsetWd", "")
	empty := project(t, "График: пустой для переноса", seedOpts{})
	_, err := s.PreviewSchedule(ctx, office, empty, []rapi.ScheduleStageChange{change(uuid.New(), longer(2))})
	wantCode(t, err, "not_found", textScheduleMissing)
}

func TestApplyScheduleChange(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), svc(), as(t, "a.region-msk")
	id, st := scheduled(t, "График: перенос", seedOpts{})
	cur := must(s.Schedule(ctx, office, id)).of(t)
	body := func(reason rapi.RepairScheduleReason, cs ...rapi.ScheduleStageChange) rapi.ScheduleChangeApply {
		return rapi.ScheduleChangeApply{Changes: cs, Reason: reason}
	}
	move := body(rapi.RepairScheduleReasonMaterialDelay, change(st["s3"], longer(12)))
	_, err := s.ApplySchedule(ctx, office, id, rev(cur.Revision+7), move)
	wantCode(t, err, "revision_mismatch", textScheduleChanged)
	_, err = s.ApplySchedule(ctx, office, id, rev(cur.Revision), body("", change(st["s3"], longer(12))))
	wantField(t, err, "reason", "")
	_, err = s.ApplySchedule(ctx, office, id, rev(cur.Revision), body(rapi.RepairScheduleReasonOther, change(st["s2"], func(c *rapi.ScheduleStageChange) { c.OffsetWd = new(1) })))
	wantReason(t, err, "schedule_stage_locked")
	_, err = s.ApplySchedule(ctx, as(t, "ab.member"), id, rev(cur.Revision), move)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.ApplySchedule(ctx, as(t, "a.manager-msk2"), id, rev(cur.Revision), move)
	wantCode(t, err, "not_found", textObjectNotFound)
	if n := count(t, `select count(*) from repairs.schedule_changes where project_id = $1`, id); n != 0 {
		t.Fatalf("refusals wrote %d journal rows", n)
	}

	got := must(s.ApplySchedule(ctx, office, id, rev(cur.Revision), move)).of(t)
	if got.Revision != cur.Revision+1 || dayPtr(got.ForecastDueOn) != "2026-12-04" || got.DelayWd != 5 {
		t.Errorf("after the move: revision %d (was %d), forecast %s, delay %d; want +1, 2026-12-04, 5", got.Revision, cur.Revision, dayPtr(got.ForecastDueOn), got.DelayWd)
	}
	if s3 := stageOf(t, got, st["s3"]); s3.DurationWd != 12 {
		t.Errorf("s3 lasts %d, want 12", s3.DurationWd)
	}
	if len(got.Changes) != 1 || got.Changes[0].Reason == nil || *got.Changes[0].Reason != rapi.RepairScheduleReasonMaterialDelay || got.Changes[0].AuthorName == "" {
		t.Fatalf("journal %+v: one entry with the reason and the author", got.Changes)
	}
	for _, want := range []string{"Штукатурка стен", "10 → 12"} {
		if !contains(got.Changes[0].Text, want) {
			t.Errorf("journal text %q lacks %q", got.Changes[0].Text, want)
		}
	}
	if n := count(t, `select count(*) from outbox.events where type = 'repairs.schedule.changed.v1' and aggregate_id = $1`, id); n != 1 {
		t.Errorf("%d events repairs.schedule.changed.v1, want 1", n)
	}
	// the same If-Match again: the revision has moved on
	_, err = s.ApplySchedule(ctx, office, id, rev(cur.Revision), move)
	wantCode(t, err, "revision_mismatch", textScheduleChanged)
	// the foreman moves an offset and a pause of his own object
	foreman := as(t, "a.manager-msk1")
	got = must(s.ApplySchedule(ctx, foreman, id, rev(got.Revision), body(rapi.RepairScheduleReasonClientRequest,
		change(st["s8"], func(c *rapi.ScheduleStageChange) { c.OffsetWd = new(2); c.LagDays = new(1) })))).of(t)
	if s8 := stageOf(t, got, st["s8"]); s8.OffsetWd != 2 {
		t.Errorf("s8 offset %d, want 2", s8.OffsetWd)
	}
	var lag int
	if err := superA.QueryRow(ctx, `select lag_days from repairs.schedule_links where from_stage_id = $1 and to_stage_id = $2`, st["s5"], st["s8"]).Scan(&lag); err != nil || lag != 1 {
		t.Errorf("the pause binds to the predecessor that sets the start (s5→s8): %d %v, want 1", lag, err)
	}
	if len(got.Changes) != 2 || got.Changes[0].Text == got.Changes[1].Text {
		t.Errorf("journal %+v: the newest first", got.Changes)
	}
}

func contains(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}

func TestApplyScheduleChangeToHandedOver(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), svc(), as(t, "a.region-msk")
	id, st := scheduled(t, "График: сданный", seedOpts{status: "handed_over"})
	cur := must(s.Schedule(ctx, office, id)).of(t) // reading a handed over object stays open
	_, err := s.ApplySchedule(ctx, office, id, rev(cur.Revision), rapi.ScheduleChangeApply{
		Changes: []rapi.ScheduleStageChange{change(st["s3"], longer(12))}, Reason: rapi.RepairScheduleReasonOther})
	wantReason(t, err, "project_handed_over")
}

func TestSetScheduleStageExecutor(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), svc(), as(t, "a.region-msk")
	id, st := scheduled(t, "График: исполнитель", seedOpts{})
	cur := must(s.Schedule(ctx, office, id)).of(t)
	member := person("a.manager-msk2")
	var fullName string
	if err := superA.QueryRow(ctx, `select full_name from people.person_profiles where id = $1`, member).Scan(&fullName); err != nil {
		t.Fatal(err)
	}
	set := func(r int64, stage uuid.UUID, b rapi.StageExecutorSet) (rapi.ScheduleStage, error) {
		return s.SetStageExecutor(ctx, office, id, stage, rev(r), b)
	}
	_, err := set(cur.Revision+3, st["s6"], rapi.StageExecutorSet{ExecutorName: new("Иван Петров")})
	wantCode(t, err, "revision_mismatch", textScheduleChanged)
	_, err = set(cur.Revision, uuid.New(), rapi.StageExecutorSet{ExecutorName: new("Иван")})
	wantCode(t, err, "not_found", textStageNotFound)
	_, err = set(cur.Revision, st["s1"], rapi.StageExecutorSet{ExecutorName: new("Иван")})
	wantReason(t, err, "schedule_stage_locked")
	_, err = set(cur.Revision, st["s6"], rapi.StageExecutorSet{ExecutorMemberId: new(uuid.New())})
	wantField(t, err, "executorMemberId", "")
	_, err = s.SetStageExecutor(ctx, as(t, "ab.member"), id, st["s6"], rev(cur.Revision), rapi.StageExecutorSet{ExecutorName: new("Иван")})
	wantCode(t, err, "forbidden_action", "")
	_, err = s.SetStageExecutor(ctx, as(t, "a.manager-msk2"), id, st["s6"], rev(cur.Revision), rapi.StageExecutorSet{ExecutorName: new("Иван")})
	wantCode(t, err, "not_found", textObjectNotFound)

	// by name, without a reason
	got := must(set(cur.Revision, st["s6"], rapi.StageExecutorSet{ExecutorName: new("  Иван Петров ")})).of(t)
	if got.ExecutorName == nil || *got.ExecutorName != "Иван Петров" || got.ExecutorMemberId != nil {
		t.Errorf("by name: %+v", got)
	}
	s1 := must(s.Schedule(ctx, office, id)).of(t)
	if s1.Revision != cur.Revision+1 || len(s1.Changes) != 1 || s1.Changes[0].Reason != nil || !contains(s1.Changes[0].Text, "не назначен → Иван Петров") {
		t.Errorf("journal after a name: revision %d, %+v", s1.Revision, s1.Changes)
	}
	for _, is := range s1.Issues {
		if is.Kind == rapi.ScheduleIssueKindNoExecutor {
			t.Errorf("an issue no_executor remains: %+v", is)
		}
	}
	// by a member of the organization: the name is his
	got = must(set(s1.Revision, st["s6"], rapi.StageExecutorSet{ExecutorMemberId: &member})).of(t)
	if got.ExecutorMemberId == nil || *got.ExecutorMemberId != member || got.ExecutorName == nil || *got.ExecutorName != fullName {
		t.Errorf("by a member: %+v, want %s", got, fullName)
	}
	// cleared
	got = must(set(s1.Revision+1, st["s6"], rapi.StageExecutorSet{})).of(t)
	if got.ExecutorMemberId != nil || got.ExecutorName != nil {
		t.Errorf("cleared: %+v", got)
	}
	if n := count(t, `select count(*) from outbox.events where type = 'repairs.schedule.changed.v1' and aggregate_id = $1`, id); n != 3 {
		t.Errorf("%d events for three changes of the executor, want 3", n)
	}
}

func TestCreateScheduleBaseline(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), svc(), as(t, "a.region-msk")
	id, _ := scheduled(t, "График: базовый план", seedOpts{})
	cur := must(s.Schedule(ctx, office, id)).of(t)
	_, err := s.CreateBaseline(ctx, office, id, rev(cur.Revision), 4)
	wantField(t, err, "agreementNo", "")
	if _, err := superA.Exec(ctx, `insert into repairs.estimates (project_id, version, kind, state, agreement_no, approved_at)
		values ($1, 2, 'change', 'approved', 4, $2)`, id, today); err != nil {
		t.Fatal(err)
	}
	_, err = s.CreateBaseline(ctx, office, id, rev(cur.Revision+1), 4)
	wantCode(t, err, "revision_mismatch", textScheduleChanged)
	_, err = s.CreateBaseline(ctx, as(t, "a.manager-msk1"), id, rev(cur.Revision), 4) // the foreman moves stages, he does not fix the baseline
	wantCode(t, err, "forbidden_action", "")
	got := must(s.CreateBaseline(ctx, office, id, rev(cur.Revision), 4)).of(t)
	if got.Baseline == nil || got.Baseline.Version != 2 || isoDay(got.Baseline.DueOn) != "2026-12-01" || got.Baseline.AgreementNo == nil || *got.Baseline.AgreementNo != 4 {
		t.Errorf("baseline %+v, want version 2 with the due date 2026-12-01 and the agreement 4", got.Baseline)
	}
	if got.DelayWd != 0 || got.Revision != cur.Revision+1 || len(got.Changes) != 1 || !contains(got.Changes[0].Text, "допсоглашением № 4") {
		t.Errorf("after the baseline: delay %d, revision %d (was %d), journal %+v", got.DelayWd, got.Revision, cur.Revision, got.Changes)
	}
	var due string
	if err := superA.QueryRow(ctx, `select due_on::text from repairs.projects where id = $1`, id).Scan(&due); err != nil || due != "2026-12-01" {
		t.Errorf("the due date of the object %q %v, want 2026-12-01 (it changes only by the baseline)", due, err)
	}
	if n := count(t, `select count(*) from outbox.events where type = 'repairs.schedule.baseline_set.v1' and aggregate_id = $1`, id); n != 1 {
		t.Errorf("%d events repairs.schedule.baseline_set.v1, want 1", n)
	}
	empty := project(t, "График: базовый план без графика", seedOpts{})
	_, err = s.CreateBaseline(ctx, office, empty, rev(1), 4)
	wantCode(t, err, "not_found", textScheduleMissing)
}

// templateSeed writes a template of three stages and an estimate of the sections «Демонтаж», «Стены», «Полы» with the
// works of 46.8 m², 114.6 m² and none (a material only): the durations 4, 12 and 1 days.
func templateSeed(t *testing.T, state string) (projectID uuid.UUID) {
	t.Helper()
	scheduleRoles(t)
	tpl := uuid.New()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := superA.Exec(t.Context(), sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`insert into repairs.templates (id, name, kind, source) values ($1, 'Капитальный ремонт квартиры', 'Квартира', 'ortus')`, tpl)
	for i, ts := range []struct {
		name  string
		rate  any
		pause int
		sec   []string
	}{{"Демонтаж", 12, 0, []string{"Демонтаж"}}, {"Штукатурка стен", 10, 5, []string{"Стены"}}, {"Укладка полов", nil, 3, []string{"Полы"}}} {
		exec(`insert into repairs.template_stages (template_id, name, rate_per_day, pause_days, sections, sort) values ($1, $2, $3, $4, $5, $6)`,
			tpl, ts.name, ts.rate, ts.pause, ts.sec, i)
	}
	projectID = project(t, "График: из сметы "+state, seedOpts{})
	exec(`update repairs.projects set template_id = $2, start_on = '2026-10-05' where id = $1`, projectID, tpl)
	est := uuid.New()
	approved := any(nil)
	if state == "approved" {
		approved = today
	}
	exec(`insert into repairs.estimates (id, project_id, version, kind, state, template_id, approved_at) values ($1, $2, 1, 'first', $3, $4, $5)`,
		est, projectID, state, tpl, approved)
	for i, sec := range []struct {
		name, kind, unit string
		qty              float64
	}{{"Демонтаж", "work", "m2", 46.8}, {"Стены", "work", "m2", 114.6}, {"Полы", "material", "piece", 20}} {
		sid := uuid.New()
		exec(`insert into repairs.estimate_sections (id, estimate_id, name, sort) values ($1, $2, $3, $4)`, sid, est, sec.name, i)
		exec(`insert into repairs.estimate_lines (estimate_id, section_id, name, unit, kind, price_minor, quantity, sort)
			values ($1, $2, $3, $4, $5, 100, $6, 1)`, est, sid, "Строка "+sec.name, sec.unit, sec.kind, sec.qty)
	}
	return projectID
}

func TestCreateScheduleFromEstimate(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), svc(), as(t, "a.region-msk")
	draft := templateSeed(t, "draft")
	_, err := s.CreateSchedule(ctx, office, draft, 1)
	wantReason(t, err, "repair_estimate_not_approved")
	_, err = s.CreateSchedule(ctx, office, draft, 9)
	wantField(t, err, "estimateVersion", "")

	id := templateSeed(t, "approved")
	_, err = s.CreateSchedule(ctx, as(t, "ab.member"), id, 1)
	wantCode(t, err, "forbidden_action", "")
	got := must(s.CreateSchedule(ctx, office, id, 1)).of(t)
	names := []string{"Демонтаж", "Штукатурка стен", "Укладка полов", "Сдача объекта"}
	durs := []int{4, 12, 1, 1}
	if len(got.Stages) != len(names) {
		t.Fatalf("%d stages, want %d: %+v", len(got.Stages), len(names), got.Stages)
	}
	for i, sg := range got.Stages {
		if sg.Name != names[i] || sg.DurationWd != durs[i] {
			t.Errorf("stage %d: %q for %d days, want %q for %d (the volume of the works of the section ÷ the rate of the day)", i, sg.Name, sg.DurationWd, names[i], durs[i])
		}
		if i > 0 && !sg.Critical {
			t.Errorf("stage %q of a chain must be critical", sg.Name)
		}
	}
	if got.Stages[0].EstimateSectionId == nil || got.Stages[3].EstimateSectionId != nil {
		t.Error("a stage keeps its section of the estimate, the hand over has none")
	}
	if len(got.Links) != 3 || got.Links[0].LagDays != 5 || got.Links[1].LagDays != 3 || got.Links[2].LagDays != 0 {
		t.Errorf("links %+v: the pauses of the template", got.Links)
	}
	if got.Baseline != nil || got.DelayWd != 0 || got.ForecastDueOn == nil || got.Revision < 2 {
		t.Errorf("a new schedule has no baseline yet: %+v", got)
	}
	if got.Stages[0].StartOn.Format(time.DateOnly) != "2026-10-05" {
		t.Errorf("the schedule starts on the first working day on or after the start of the object: %s", isoDay(got.Stages[0].StartOn))
	}
	// the first stage has no predecessor: a pause has nothing to bind to
	_, err = s.PreviewSchedule(ctx, office, id, []rapi.ScheduleStageChange{change(got.Stages[0].Id, func(c *rapi.ScheduleStageChange) { c.LagDays = new(1) })})
	wantField(t, err, "changes[0].lagDays", "")
	if len(got.Changes) != 1 || !contains(got.Changes[0].Text, "версии 1 сметы") {
		t.Errorf("journal %+v", got.Changes)
	}
	_, err = s.CreateSchedule(ctx, office, id, 1)
	wantCode(t, err, "invalid_transition", textScheduleExists)
}

func TestScheduleInSummaryOfObject(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), svc(), as(t, "a.region-msk")
	id, _ := scheduled(t, "График: в сводке", seedOpts{})
	p := must(s.Project(ctx, office, id)).of(t)
	if p.ForecastDueOn == nil || isoDay(*p.ForecastDueOn) != "2026-12-01" || p.DueOn == nil || isoDay(*p.DueOn) != "2026-11-27" {
		t.Errorf("the object carries due %v and forecast %v, want 2026-11-27 and 2026-12-01", p.DueOn, p.ForecastDueOn)
	}
	var slip, idle string
	for _, d := range must(s.Overview(ctx, office, id)).of(t).Decisions {
		if d.Kind == rapi.ScheduleSlip {
			slip = d.Text
		}
		if d.Kind == rapi.StageNoExecutor {
			idle = d.Text
		}
	}
	if slip != "Сдача сдвигается на 01.12" || idle != "Не назначен исполнитель: Плитка в санузле" {
		t.Errorf("decisions: slip %q, idle %q", slip, idle)
	}
	// the list carries the forecast as well
	list := must(s.Projects(ctx, office, ListQuery{Q: new("График: в сводке")})).of(t)
	if len(list.Items) != 1 || list.Items[0].ForecastDueOn == nil || isoDay(*list.Items[0].ForecastDueOn) != "2026-12-01" {
		t.Errorf("list %+v", list.Items)
	}
}
