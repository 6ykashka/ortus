package repairs

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

// Actions of the schedule (api/permissions.yaml).
const (
	actSchedRead     = "repairs.schedule.read"
	actSchedShift    = "repairs.schedule.shift"
	actSchedBaseline = "repairs.schedule.baseline"
)

// Statuses of a stage (repairs.schedule_stages.status) and the reason of the locked ones.
const (
	stagePlanned = "planned"
	stageStarted = "started"
	stageDone    = "done"

	reasonStageLocked = "schedule_stage_locked"
)

// Events of the schedule (the outbox, api/openapi/paths/repairs.yaml) and the kind of its line in the feed of the object.
const (
	eventScheduleChanged     = "repairs.schedule.changed.v1"
	eventScheduleBaselineSet = "repairs.schedule.baseline_set.v1"
	evScheduleChanged        = "schedule.changed"
	evScheduleBuilt          = "schedule.built"
	evScheduleBaseline       = "schedule.baseline_set"
	aggregateProject         = "repairs.project"
)

// Texts of the refusals of the schedule.
const (
	textScheduleChanged  = "График уже изменили — обновите страницу"
	textScheduleMissing  = "График ещё не собран."
	textScheduleExists   = "График уже собран."
	textStageNotFound    = "Этап не найден."
	textNeedSchedRead    = "Нужно право «Видеть график»."
	textNeedSchedShift   = "Нужно право «Переносить этапы»."
	textNeedBaseline     = "Нужно право «Менять базовый план»."
	textStageUnknown     = "Этапа нет в графике."
	textStageLocked      = "Начавшийся этап не сдвигается: меняется только длительность; выполненный этап не меняется."
	textStageDone        = "Выполненный этап не меняется."
	textReasonPick       = "Выберите причину."
	textNothingToMove    = "Укажите, что изменить в этапе."
	textNoPredecessor    = "У этапа нет предшественника."
	textStageRepeated    = "Этап указан дважды."
	textEstimateMissing  = "Версии сметы нет у объекта."
	textEstimateNotOK    = "График строится по согласованной версии сметы."
	textEstimateEmpty    = "В смете нет разделов: графику не из чего строиться."
	textAgreementMissing = "Нет подписанного допсоглашения с таким номером."
	textHandedOverSched  = "Объект сдан: график не меняется."
)

// Limits of a move (the contract: lagDays −60…60; the stage and the offset are bounded by a year of working days).
const (
	maxStageDays = 365
	maxLagDays   = 60
	maxStages    = 100
)

var moscow = time.FixedZone("MSK", 3*60*60)

// reasonLabels are the reasons of a move as the office reads them (the prototype GREASONS): the line of the feed.
var reasonLabels = map[rapi.RepairScheduleReason]string{
	rapi.RepairScheduleReasonClientRequest:   "Решение заказчика",
	rapi.RepairScheduleReasonMaterialDelay:   "Поставка материалов",
	rapi.RepairScheduleReasonExecutorBusy:    "Задержка подрядчика",
	rapi.RepairScheduleReasonRework:          "Уточнили объём работ",
	rapi.RepairScheduleReasonWeatherOrDrying: "Технологическая пауза",
	rapi.RepairScheduleReasonScopeChange:     "Добавили людей на этап",
	rapi.RepairScheduleReasonOther:           "Нет доступа на объект",
}

// stageRow is a row of repairs.schedule_stages.
type stageRow struct {
	id, project uuid.UUID
	phase, name string
	section     *uuid.UUID
	dur, off    int
	actual      *time.Time
	status      string
	execMember  *uuid.UUID
	execName    *string
	sort        int
}

const stageCols = `id, project_id, phase, name, estimate_section_id, duration_wd, offset_wd, actual_start, status, executor_member_id, executor_name, sort`

func (s *stageRow) scan(row interface{ Scan(...any) error }) error {
	return row.Scan(&s.id, &s.project, &s.phase, &s.name, &s.section, &s.dur, &s.off, &s.actual, &s.status, &s.execMember, &s.execName, &s.sort)
}

// executor is the name of who works on the stage ("" — nobody).
func (s *stageRow) executor() string {
	if s.execName == nil {
		return ""
	}
	return strings.TrimSpace(*s.execName)
}

func (s *stageRow) hasExecutor() bool { return s.execMember != nil || s.executor() != "" }

// linkRow is a row of repairs.schedule_links.
type linkRow struct {
	from, to uuid.UUID
	lag      int
	note     *string
}

// baselineRow is a baseline of the contract: the due date by it and the agreement that fixed it.
type baselineRow struct {
	version     int
	due         time.Time
	approvedAt  time.Time
	agreementNo *int
}

// changeRow is a line of the journal of the schedule.
type changeRow struct {
	id     uuid.UUID
	at     time.Time
	author *uuid.UUID
	text   string
	reason *string
}

// sched is the schedule of an object as it is stored, with the calendar it runs on.
type sched struct {
	p        *projectRow
	revision int64
	stages   []stageRow
	links    []linkRow
	baseline *baselineRow
	changes  []changeRow
	cal      *workCal
	holidays []time.Time
	today    int
}

// startDay is day 0 of the schedule: the start of the object, else today.
func (s *sched) startDay() int {
	if s.p.startOn != nil {
		return dayOf(*s.p.startOn)
	}
	return s.today
}

// calcInput converts the stored stages and links to the input of the calculation.
func (s *sched) calcInput() ([]calcStage, []calcLink) {
	stages := make([]calcStage, len(s.stages))
	key := func(id uuid.UUID) string { return id.String() }
	for i, st := range s.stages {
		cs := calcStage{id: key(st.id), dur: st.dur, off: st.off, done: st.status == stageDone}
		if st.actual != nil {
			cs.actual = new(dayOf(*st.actual))
		}
		stages[i] = cs
	}
	links := make([]calcLink, len(s.links))
	for i, l := range s.links {
		links[i] = calcLink{from: key(l.from), to: key(l.to), lag: l.lag}
	}
	return stages, links
}

// forecast is the calculation of the schedule: the timing of each stage by its id, the forecast of the hand over and
// the delay against the due date by the contract (working days).
type forecast struct {
	times map[uuid.UUID]*timing
	fin   int
	has   bool
	delay int
}

func (s *sched) compute() (*forecast, error) {
	stages, links := s.calcInput()
	res, fin, has, err := s.cal.schedule(s.startDay(), stages, links)
	if err != nil {
		return nil, store("schedule", err)
	}
	out := &forecast{times: make(map[uuid.UUID]*timing, len(s.stages)), fin: fin, has: has}
	for _, st := range s.stages {
		out.times[st.id] = res[st.id.String()]
	}
	if has {
		if due, ok := s.dueDay(); ok && fin > due {
			out.delay = s.cal.wdIn(due, fin)
		}
	}
	return out, nil
}

// dueDay is the due date by the contract: the last baseline, else the term of the object.
func (s *sched) dueDay() (int, bool) {
	switch {
	case s.baseline != nil:
		return dayOf(s.baseline.due), true
	case s.p.dueOn != nil:
		return dayOf(*s.p.dueOn), true
	}
	return 0, false
}

// clone copies the stages and the links so a trial move leaves the stored schedule as it was.
func (s *sched) clone() *sched {
	c := *s
	c.stages = slices.Clone(s.stages)
	c.links = slices.Clone(s.links)
	return &c
}

// setDay sets a date field of the contract (a Date wraps time.Time; the module does not import the type).
func setDay[D ~struct{ time.Time }](d *D, day int) { *d = D{Time: dateOf(day)} }

// appended appends a zero element to s and returns it to fill (the elements of the contract are named by their slice).
func appended[T any](s []T) ([]T, *T) {
	var zero T
	s = append(s, zero)
	return s, &s[len(s)-1]
}

// empty is an empty, not nil, slice of the type of s (the arrays of the contract are never null).
func empty[T any](_ []T) []T { return []T{} }

// calendar reads the work calendar of the region RU (the tenant fixes the transfers of days off there); without it
// Monday–Friday and the fixed public holidays. holidays are the days listed for the client around the schedule.
func (r *req) calendar(ctx context.Context, around time.Time) (*workCal, []time.Time, error) {
	var (
		workdays []int16
		holidays []time.Time
	)
	err := r.tx.QueryRow(ctx, `select workdays, holidays from repairs.work_calendars where region = 'RU'`).Scan(&workdays, &holidays)
	switch {
	case noRows(err):
		workdays, holidays = []int16{1, 2, 3, 4, 5}, defaultHolidays(around)
	case err != nil:
		return nil, nil, store("work calendar", err)
	}
	cal := newWorkCal(workdays, holidays)
	lo, hi := around.AddDate(0, 0, -31), around.AddDate(2, 0, 0)
	listed := slices.DeleteFunc(slices.Clone(holidays), func(h time.Time) bool { return h.Before(lo) || h.After(hi) })
	slices.SortFunc(listed, func(a, b time.Time) int { return a.Compare(b) })
	return cal, listed, nil
}

// loadSched reads the schedule of p.
func (r *req) loadSched(ctx context.Context, p *projectRow) (*sched, error) {
	s := &sched{p: p, today: dayOf(r.now.In(moscow))}
	if err := r.tx.QueryRow(ctx, `select schedule_revision from repairs.projects where id = $1`, p.id).Scan(&s.revision); err != nil {
		return nil, store("schedule revision", err)
	}
	rows, err := r.tx.Query(ctx, `select `+stageCols+` from repairs.schedule_stages where project_id = $1 order by sort, id`, p.id)
	if err != nil {
		return nil, store("schedule stages", err)
	}
	defer rows.Close()
	for rows.Next() {
		var st stageRow
		if err := st.scan(rows); err != nil {
			return nil, store("schedule stages", err)
		}
		s.stages = append(s.stages, st)
	}
	if err := rows.Err(); err != nil {
		return nil, store("schedule stages", err)
	}
	if s.links, err = r.loadLinks(ctx, p.id); err != nil {
		return nil, err
	}
	if s.baseline, err = r.loadBaseline(ctx, p.id); err != nil {
		return nil, err
	}
	if s.changes, err = r.loadChanges(ctx, p.id); err != nil {
		return nil, err
	}
	around := r.now
	if p.startOn != nil {
		around = *p.startOn
	}
	s.cal, s.holidays, err = r.calendar(ctx, around)
	return s, err
}

func (r *req) loadLinks(ctx context.Context, project uuid.UUID) ([]linkRow, error) {
	rows, err := r.tx.Query(ctx, `select l.from_stage_id, l.to_stage_id, l.lag_days, l.note from repairs.schedule_links l
		join repairs.schedule_stages f on f.id = l.from_stage_id where l.project_id = $1 order by f.sort, l.to_stage_id`, project)
	if err != nil {
		return nil, store("schedule links", err)
	}
	defer rows.Close()
	var out []linkRow
	for rows.Next() {
		var l linkRow
		if err := rows.Scan(&l.from, &l.to, &l.lag, &l.note); err != nil {
			return nil, store("schedule links", err)
		}
		out = append(out, l)
	}
	return out, store("schedule links", rows.Err())
}

func (r *req) loadBaseline(ctx context.Context, project uuid.UUID) (*baselineRow, error) {
	var b baselineRow
	err := r.tx.QueryRow(ctx, `select version, due_on, approved_at, agreement_no from repairs.schedule_baselines
		where project_id = $1 order by version desc limit 1`, project).Scan(&b.version, &b.due, &b.approvedAt, &b.agreementNo)
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("schedule baseline", err)
	}
	return &b, nil
}

// maxJournal is the number of the lines of the journal the schedule carries (the newest).
const maxJournal = 200

func (r *req) loadChanges(ctx context.Context, project uuid.UUID) ([]changeRow, error) {
	rows, err := r.tx.Query(ctx, `select id, at, author_id, text, reason from repairs.schedule_changes where project_id = $1
		order by at desc, id desc limit $2`, project, maxJournal)
	if err != nil {
		return nil, store("schedule changes", err)
	}
	defer rows.Close()
	var out []changeRow
	for rows.Next() {
		var c changeRow
		if err := rows.Scan(&c.id, &c.at, &c.author, &c.text, &c.reason); err != nil {
			return nil, store("schedule changes", err)
		}
		out = append(out, c)
	}
	return out, store("schedule changes", rows.Err())
}

// issues are the notes «Требует внимания» of the schedule: a stage without an executor, an executor busy on two stages
// at the same days. A missing material is not computed: a request of the supply is not tied to a stage.
func (s *sched) issues(f *forecast) []rapi.ScheduleIssue {
	out := []rapi.ScheduleIssue{}
	for _, st := range s.stages {
		if st.status != stageDone && !st.hasExecutor() {
			out = append(out, rapi.ScheduleIssue{Kind: rapi.ScheduleIssueKindNoExecutor, StageId: st.id, Text: "Нет исполнителя"})
		}
	}
	for i, a := range s.stages {
		for _, b := range s.stages[i+1:] {
			if a.status == stageDone || b.status == stageDone || !sameExecutor(a, b) {
				continue
			}
			ta, tb := f.times[a.id], f.times[b.id]
			if ta.start <= tb.end && tb.start <= ta.end {
				out = append(out, rapi.ScheduleIssue{Kind: rapi.ScheduleIssueKindExecutorBusy, StageId: b.id,
					Text: "Исполнитель занят: «" + a.name + "» идёт параллельно"})
			}
		}
	}
	return out
}

func sameExecutor(a, b stageRow) bool {
	if a.execMember != nil && b.execMember != nil {
		return *a.execMember == *b.execMember
	}
	return a.executor() != "" && strings.EqualFold(a.executor(), b.executor())
}

// stageDTO is a stage with its dates and its place on the critical path.
func stageDTO(st stageRow, t *timing) rapi.ScheduleStage {
	out := rapi.ScheduleStage{Id: st.id, Phase: st.phase, Name: st.name, DurationWd: st.dur, OffsetWd: st.off, SlackWd: t.slack,
		Critical: st.status != stageDone && t.slack == 0, Status: rapi.ScheduleStageStatus(st.status), ExecutorMemberId: st.execMember,
		EstimateSectionId: st.section}
	setDay(&out.StartOn, t.start)
	setDay(&out.EndOn, t.end)
	if name := st.executor(); name != "" {
		out.ExecutorName = &name
	}
	return out
}

// scheduleDTO builds the Schedule of the contract: the stages, the links, the baseline, the forecast and the journal.
func (r *req) scheduleDTO(ctx context.Context, s *sched) (rapi.Schedule, error) {
	f, err := s.compute()
	if err != nil {
		return rapi.Schedule{}, err
	}
	out := rapi.Schedule{ProjectId: s.p.id, Stages: []rapi.ScheduleStage{}, Links: []rapi.ScheduleLink{}, DelayWd: f.delay, Revision: s.revision,
		Issues: s.issues(f)}
	for _, st := range s.stages {
		out.Stages = append(out.Stages, stageDTO(st, f.times[st.id]))
	}
	for _, l := range s.links {
		out.Links = append(out.Links, rapi.ScheduleLink{FromStageId: l.from, ToStageId: l.to, LagDays: l.lag, Note: l.note})
	}
	if f.has {
		setDayPtr(&out.ForecastDueOn, f.fin)
	}
	if b := s.baseline; b != nil {
		bl := rapi.ScheduleBaseline{Version: b.version, ApprovedAt: b.approvedAt, AgreementNo: b.agreementNo}
		bl.DueOn.Time = b.due
		out.Baseline = &bl
	}
	out.Holidays = empty(out.Holidays)
	for _, h := range s.holidays {
		hs, e := appended(out.Holidays)
		out.Holidays, e.Time = hs, h
	}
	out.Changes, err = r.journalDTO(ctx, s)
	return out, err
}

// setDayPtr sets an optional date field of the contract.
func setDayPtr[D ~struct{ time.Time }](d **D, day int) {
	v := new(D)
	setDay(v, day)
	*d = v
}

// journalDTO is the journal of the schedule, the newest first, with the names of the authors.
func (r *req) journalDTO(ctx context.Context, s *sched) ([]rapi.ScheduleChangeEntry, error) {
	authors := make([]uuid.UUID, 0, len(s.changes))
	for _, c := range s.changes {
		if c.author != nil {
			authors = append(authors, *c.author)
		}
	}
	if err := r.loadNames(ctx, authors); err != nil {
		return nil, err
	}
	out := []rapi.ScheduleChangeEntry{}
	for _, c := range s.changes {
		e := rapi.ScheduleChangeEntry{Id: c.id, At: c.at, Text: c.text, AuthorName: "Система"}
		if c.author != nil && r.names[*c.author] != "" {
			e.AuthorName = r.names[*c.author]
		}
		if c.reason != nil {
			e.Reason = new(rapi.RepairScheduleReason(*c.reason))
		}
		out = append(out, e)
	}
	return out, nil
}

// sched row of the summary: the forecast of the hand over of an object and its delay.
type schedFact struct {
	fin   time.Time
	delay int
}

// factSchedules reads the schedules of the objects ids and calculates their forecasts for the list and the card.
func (r *req) factSchedules(ctx context.Context, f *facts, ids []uuid.UUID) error {
	byProject := map[uuid.UUID]*sched{}
	rows, err := r.tx.Query(ctx, `select `+stageCols+` from repairs.schedule_stages where project_id = any($1) order by project_id, sort, id`, ids)
	if err != nil {
		return store("schedule stages", err)
	}
	defer rows.Close()
	for rows.Next() {
		var st stageRow
		if err := st.scan(rows); err != nil {
			return store("schedule stages", err)
		}
		if byProject[st.project] == nil {
			byProject[st.project] = &sched{today: dayOf(r.now.In(moscow))}
		}
		byProject[st.project].stages = append(byProject[st.project].stages, st)
	}
	if err := rows.Err(); err != nil {
		return store("schedule stages", err)
	}
	rows.Close()
	if len(byProject) == 0 {
		return nil
	}
	have := make([]uuid.UUID, 0, len(byProject))
	for id := range byProject {
		have = append(have, id)
	}
	if err := r.attachSchedules(ctx, byProject, have); err != nil {
		return err
	}
	cal, _, err := r.calendar(ctx, r.now)
	if err != nil {
		return err
	}
	for id, s := range byProject {
		s.cal = cal
		fc, err := s.compute()
		if err != nil {
			return err
		}
		if fc.has {
			f.sched[id] = &schedFact{fin: dateOf(fc.fin), delay: fc.delay}
		}
	}
	return nil
}

// attachSchedules fills the links, the baselines and the dates of the objects have into byProject.
func (r *req) attachSchedules(ctx context.Context, byProject map[uuid.UUID]*sched, have []uuid.UUID) error {
	lrows, err := r.tx.Query(ctx, `select project_id, from_stage_id, to_stage_id, lag_days from repairs.schedule_links where project_id = any($1)`, have)
	if err != nil {
		return store("schedule links", err)
	}
	defer lrows.Close()
	for lrows.Next() {
		var (
			project uuid.UUID
			l       linkRow
		)
		if err := lrows.Scan(&project, &l.from, &l.to, &l.lag); err != nil {
			return store("schedule links", err)
		}
		byProject[project].links = append(byProject[project].links, l)
	}
	if err := lrows.Err(); err != nil {
		return store("schedule links", err)
	}
	lrows.Close()
	prows, err := r.tx.Query(ctx, `select p.id, p.start_on, p.due_on, b.due_on from repairs.projects p
		left join lateral (select due_on from repairs.schedule_baselines where project_id = p.id order by version desc limit 1) b on true
		where p.id = any($1)`, have)
	if err != nil {
		return store("schedule projects", err)
	}
	defer prows.Close()
	for prows.Next() {
		var (
			id               uuid.UUID
			start, due, bdue *time.Time
		)
		if err := prows.Scan(&id, &start, &due, &bdue); err != nil {
			return store("schedule projects", err)
		}
		s := byProject[id]
		s.p = &projectRow{id: id, startOn: start, dueOn: due}
		if bdue != nil {
			s.baseline = &baselineRow{due: *bdue}
		}
	}
	return store("schedule projects", prows.Err())
}
