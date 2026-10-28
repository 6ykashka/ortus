package repairs

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// The operations of step 6.5 (W6.14): the schedule of an object. The server calculates the forecast, the slack and the
// critical path (schedule_calc.go); the client only shows the preview. Every write is under the lock of the object, bumps
// projects.schedule_revision (the If-Match of the schedule) and writes the journal of the schedule.

// scheduleOf reads the schedule the member may read: 404 for a hidden object, 403 without repairs.schedule.read.
func (r *req) scheduleOf(ctx context.Context, id uuid.UUID, action, text string, lock bool) (*sched, error) {
	p, err := r.visibleProject(ctx, id, lock)
	if err != nil {
		return nil, err
	}
	if err := r.need(ctx, p, action, text); err != nil {
		return nil, err
	}
	return r.loadSched(ctx, p)
}

// Schedule answers getSchedule.
func (s *Service) Schedule(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (rapi.Schedule, error) {
	var out rapi.Schedule
	err := s.run(ctx, tc, false, func(r *req) error {
		sc, err := r.scheduleOf(ctx, id, actSchedRead, textNeedSchedRead, false)
		if err != nil {
			return err
		}
		out, err = r.scheduleDTO(ctx, sc)
		return err
	})
	return out, err
}

// writable reads the schedule of an object for a command: the lock of the object, the right to move, the revision and
// the object that is not handed over.
func (r *req) writable(ctx context.Context, id uuid.UUID, action, text, ifMatch string) (*sched, error) {
	sc, err := r.scheduleOf(ctx, id, action, text, true)
	if err != nil {
		return nil, err
	}
	if err := checkRev(ifMatch, sc.revision, textScheduleChanged); err != nil {
		return nil, err
	}
	if sc.p.status == statusHandedOver {
		return nil, conflict(reasonHandedOver, textHandedOverSched)
	}
	return sc, nil
}

// stageChange is a stage that a move touches: its new duration and offset.
type stageChange struct {
	id       uuid.UUID
	dur, off int
}

// plan is a move checked and applied to a copy of the schedule.
type plan struct {
	next    *sched
	notes   []string
	touched map[uuid.UUID]bool
	stages  []stageChange
	links   []linkRow
}

func indexed(i int, field string) string { return "changes[" + strconv.Itoa(i) + "]" + field }

// planChange checks the changes against the rules of the schedule and applies them to a copy: an unknown stage, a stage
// that has begun or is done, a duration shorter than the days gone, a pause of a stage without a predecessor.
func (r *req) planChange(s *sched, changes []rapi.ScheduleStageChange) (*plan, error) {
	if len(changes) == 0 || len(changes) > maxStages {
		return nil, invalid("changes", textNothingToMove)
	}
	before, err := s.compute()
	if err != nil {
		return nil, err
	}
	pl := &plan{next: s.clone(), touched: map[uuid.UUID]bool{}}
	for i, c := range changes {
		idx := slices.IndexFunc(pl.next.stages, func(st stageRow) bool { return st.id == c.StageId })
		switch {
		case idx < 0:
			return nil, invalid(indexed(i, ".stageId"), textStageUnknown, "unknown")
		case pl.touched[c.StageId]:
			return nil, invalid(indexed(i, ".stageId"), textStageRepeated, "duplicate")
		case c.DurationWd == nil && c.OffsetWd == nil && c.LagDays == nil:
			return nil, invalid(indexed(i, ""), textNothingToMove, "empty")
		}
		if err := r.checkStage(s, &pl.next.stages[idx], c, i); err != nil {
			return nil, err
		}
		if err := pl.apply(&pl.next.stages[idx], c, before.times[c.StageId].bind, i); err != nil {
			return nil, err
		}
	}
	return pl, nil
}

// apply writes a checked change of a stage into the copy of the schedule and the notes of the journal; bind is the
// predecessor that sets the start of the stage (a pause is the one of its link).
func (pl *plan) apply(st *stageRow, c rapi.ScheduleStageChange, bind string, i int) error {
	pl.touched[st.id] = true
	ch := stageChange{id: st.id, dur: st.dur, off: st.off}
	if c.DurationWd != nil {
		pl.notes = append(pl.notes, fmt.Sprintf("«%s»: длительность %d → %s", st.name, st.dur, wdn(*c.DurationWd)))
		st.dur, ch.dur = *c.DurationWd, *c.DurationWd
	}
	if c.OffsetWd != nil {
		pl.notes = append(pl.notes, fmt.Sprintf("«%s»: начало с запасом %d раб. дн.", st.name, *c.OffsetWd))
		st.off, ch.off = *c.OffsetWd, *c.OffsetWd
	}
	pl.stages = append(pl.stages, ch)
	if c.LagDays == nil {
		return nil
	}
	li := slices.IndexFunc(pl.next.links, func(l linkRow) bool { return l.to == st.id && l.from.String() == bind })
	if li < 0 {
		return invalid(indexed(i, ".lagDays"), textNoPredecessor, "no_predecessor")
	}
	pl.next.links[li].lag = *c.LagDays
	pl.links = append(pl.links, pl.next.links[li])
	pl.notes = append(pl.notes, fmt.Sprintf("«%s»: пауза после предшественника %d дн.", st.name, *c.LagDays))
	return nil
}

// checkStage checks one change of a stage: the lock of a stage that has begun or is done, the bounds of the values and
// the shortest duration of a stage that has begun (the working days gone since its start and the next one).
func (r *req) checkStage(s *sched, st *stageRow, c rapi.ScheduleStageChange, i int) error {
	moves := c.OffsetWd != nil || c.LagDays != nil
	if st.status == stageDone || (st.status == stageStarted && moves) {
		return &failure{code: codeTransition, detail: textStageLocked, reason: reasonStageLocked}
	}
	if c.DurationWd != nil {
		if err := checkDuration(s, st, *c.DurationWd, i); err != nil {
			return err
		}
	}
	if c.OffsetWd != nil && (*c.OffsetWd < 0 || *c.OffsetWd > maxStageDays) {
		return invalid(indexed(i, ".offsetWd"), "Запас начала — от 0 до "+strconv.Itoa(maxStageDays)+" раб. дней.", "out_of_range")
	}
	if c.LagDays != nil && (*c.LagDays < -maxLagDays || *c.LagDays > maxLagDays) {
		return invalid(indexed(i, ".lagDays"), "Пауза — от −60 до 60 дней.", "out_of_range")
	}
	return nil
}

// checkDuration keeps a duration within 1…365 working days and, for a stage that has begun, not shorter than the days gone.
func checkDuration(s *sched, st *stageRow, dur, i int) error {
	if dur < 1 || dur > maxStageDays {
		return invalid(indexed(i, ".durationWd"), "Длительность — от 1 до "+strconv.Itoa(maxStageDays)+" раб. дней.", "out_of_range")
	}
	if st.actual != nil && st.status == stageStarted {
		if least := s.cal.wdIn(dayOf(*st.actual)-1, s.today) + 1; dur < least {
			return invalid(indexed(i, ".durationWd"), "Этап уже идёт: длительность — не меньше "+wdn(least)+".", "too_short")
		}
	}
	return nil
}

// wdn is «5 раб. дней».
func wdn(n int) string { return strconv.Itoa(n) + " раб. " + days(n) }

// days is the Russian plural of «день».
func days(n int) string {
	switch m10, m100 := n%10, n%100; {
	case m10 == 1 && m100 != 11:
		return "день"
	case m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14):
		return "дня"
	}
	return "дней"
}

// preview is what a move would do: the stages that start on another day, the new forecast and who is told.
func (r *req) preview(s *sched, pl *plan) (rapi.SchedulePreview, *forecast, *forecast, error) {
	before, err := s.compute()
	if err != nil {
		return rapi.SchedulePreview{}, nil, nil, err
	}
	after, err := pl.next.compute()
	if err != nil {
		return rapi.SchedulePreview{}, nil, nil, err
	}
	out := rapi.SchedulePreview{DelayWd: after.delay, NotifyWho: []string{}}
	out.Moved = empty(out.Moved)
	who := map[string]bool{}
	for _, st := range s.stages {
		was, now := before.times[st.id], after.times[st.id]
		moved := was.start != now.start
		if moved {
			moves, m := appended(out.Moved)
			out.Moved, m.StageId = moves, st.id
			setDay(&m.FromStartOn, was.start)
			setDay(&m.ToStartOn, now.start)
		}
		if name := st.executor(); name != "" && (moved || pl.touched[st.id]) && !who[name] {
			who[name] = true
			out.NotifyWho = append(out.NotifyWho, name)
		}
	}
	if after.has {
		setDayPtr(&out.ForecastDueOn, after.fin)
	}
	if before.fin != after.fin {
		out.NotifyWho = append(out.NotifyWho, "Заказчик")
	}
	return out, before, after, nil
}

// PreviewSchedule answers previewScheduleChange: the consequences of a move without a record.
func (s *Service) PreviewSchedule(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, changes []rapi.ScheduleStageChange) (rapi.SchedulePreview, error) {
	var out rapi.SchedulePreview
	err := s.run(ctx, tc, false, func(r *req) error {
		sc, err := r.scheduleOf(ctx, id, actSchedShift, textNeedSchedShift, false)
		if err != nil {
			return err
		}
		if len(sc.stages) == 0 {
			return notFound(textScheduleMissing)
		}
		pl, err := r.planChange(sc, changes)
		if err != nil {
			return err
		}
		out, _, _, err = r.preview(sc, pl)
		return err
	})
	return out, err
}

// clip cuts text to n characters.
func clip(text string, n int) string {
	if utf8.RuneCountInString(text) <= n {
		return text
	}
	return string([]rune(text)[:n-1]) + "…"
}

// ruDM is «01.12».
func ruDM(day int) string { return dateOf(day).Format("02.01") }

// journal writes a line of the journal of the schedule of the object.
func (r *req) journal(ctx context.Context, project uuid.UUID, text string, reason *rapi.RepairScheduleReason, change any, notified []string) error {
	raw, err := json.Marshal(change)
	if err != nil {
		return store("journal change", err)
	}
	who, _ := json.Marshal(notified)
	var author *uuid.UUID
	if r.me() != uuid.Nil {
		author = new(r.me())
	}
	var code *string
	if reason != nil {
		code = new(string(*reason))
	}
	_, err = r.tx.Exec(ctx, `insert into repairs.schedule_changes (project_id, at, author_id, text, reason, change, notified) values ($1, $2, $3, $4, $5, $6, $7)`,
		project, r.now, author, clip(text, 500), code, raw, who)
	return store("journal", err)
}

// bump moves the revision of the schedule on.
func (r *req) bump(ctx context.Context, project uuid.UUID) error {
	_, err := r.tx.Exec(ctx, `update repairs.projects set schedule_revision = schedule_revision + 1, updated_at = $2 where id = $1`, project, r.now)
	return store("schedule revision", err)
}

// publishProject puts an event of the schedule into the outbox in the transaction of the change.
func (r *req) publishProject(ctx context.Context, typ string, project uuid.UUID, payload map[string]any) error {
	payload["projectId"] = project
	_, err := events.Publish(ctx, r.tx, events.Event{Type: typ, Aggregate: aggregateProject, AggregateID: project, Payload: payload})
	return store("event "+typ, err)
}

// ApplySchedule answers applyScheduleChange: the move with a reason, the journal, the notifications through the outbox.
func (s *Service) ApplySchedule(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b rapi.ScheduleChangeApply) (rapi.Schedule, error) {
	var out rapi.Schedule
	err := s.run(ctx, tc, true, func(r *req) error {
		sc, err := r.writable(ctx, id, actSchedShift, textNeedSchedShift, ifMatch)
		if err != nil {
			return err
		}
		if len(sc.stages) == 0 {
			return notFound(textScheduleMissing)
		}
		if _, ok := reasonLabels[b.Reason]; !ok {
			return invalid("reason", textReasonPick, "schedule_reason_required")
		}
		pl, err := r.planChange(sc, b.Changes)
		if err != nil {
			return err
		}
		pv, before, after, err := r.preview(sc, pl)
		if err != nil {
			return err
		}
		if err := r.saveMove(ctx, sc, pl, b, pv.NotifyWho, before, after); err != nil {
			return err
		}
		fresh, err := r.loadSched(ctx, sc.p)
		if err != nil {
			return err
		}
		out, err = r.scheduleDTO(ctx, fresh)
		return err
	})
	return out, err
}

// saveMove writes a checked move: the stages and the links, the journal, the revision, the feed and the event.
func (r *req) saveMove(ctx context.Context, sc *sched, pl *plan, b rapi.ScheduleChangeApply, notify []string, before, after *forecast) error {
	for _, ch := range pl.stages {
		if _, err := r.tx.Exec(ctx, `update repairs.schedule_stages set duration_wd = $2, offset_wd = $3 where id = $1`, ch.id, ch.dur, ch.off); err != nil {
			return store("move stage", err)
		}
	}
	for _, l := range pl.links {
		if _, err := r.tx.Exec(ctx, `update repairs.schedule_links set lag_days = $3 where from_stage_id = $1 and to_stage_id = $2`, l.from, l.to, l.lag); err != nil {
			return store("move link", err)
		}
	}
	text := strings.Join(pl.notes, "; ")
	if before.has && after.has && before.fin != after.fin {
		text += "; сдача " + ruDM(before.fin) + " → " + ruDM(after.fin)
	}
	reason := b.Reason
	if err := r.journal(ctx, sc.p.id, text, &reason, map[string]any{"changes": b.Changes}, notify); err != nil {
		return err
	}
	if err := r.bump(ctx, sc.p.id); err != nil {
		return err
	}
	if err := r.event(ctx, sc.p.id, evScheduleChanged, "перенёс этапы графика: "+reasonLabels[b.Reason]); err != nil {
		return err
	}
	return r.publishProject(ctx, eventScheduleChanged, sc.p.id, movePayload(pl, b.Reason, notify, before, after))
}

// movePayload is the payload of repairs.schedule.changed.v1: the stages, the old and the new due date, the reason, who is told.
func movePayload(pl *plan, reason rapi.RepairScheduleReason, notify []string, before, after *forecast) map[string]any {
	stageIDs := make([]uuid.UUID, 0, len(pl.stages))
	for _, ch := range pl.stages {
		stageIDs = append(stageIDs, ch.id)
	}
	payload := map[string]any{"reason": string(reason), "stageIds": stageIDs, "notify": notify}
	if before.has {
		payload["oldDueOn"] = dateOf(before.fin).Format(time.DateOnly)
	}
	if after.has {
		payload["newDueOn"] = dateOf(after.fin).Format(time.DateOnly)
	}
	return payload
}

// SetStageExecutor answers setScheduleStageExecutor: the executor of a stage without a reason (Q-W4.00-repair-20).
func (s *Service) SetStageExecutor(ctx context.Context, tc tenantctx.TenantContext, project, stage uuid.UUID, ifMatch string, b rapi.StageExecutorSet) (rapi.ScheduleStage, error) {
	var out rapi.ScheduleStage
	err := s.run(ctx, tc, true, func(r *req) error {
		sc, err := r.writable(ctx, project, actSchedShift, textNeedSchedShift, ifMatch)
		if err != nil {
			return err
		}
		idx := slices.IndexFunc(sc.stages, func(st stageRow) bool { return st.id == stage })
		switch {
		case idx < 0:
			return notFound(textStageNotFound)
		case sc.stages[idx].status == stageDone:
			return &failure{code: codeTransition, detail: textStageDone, reason: reasonStageLocked}
		}
		if err := r.setExecutor(ctx, sc, sc.stages[idx], b); err != nil {
			return err
		}
		fresh, err := r.loadSched(ctx, sc.p)
		if err != nil {
			return err
		}
		f, err := fresh.compute()
		if err != nil {
			return err
		}
		out = stageDTO(fresh.stages[idx], f.times[stage])
		return nil
	})
	return out, err
}

// setExecutor writes the executor of a stage, the journal, the revision and the event that tells the new executor.
func (r *req) setExecutor(ctx context.Context, sc *sched, st stageRow, b rapi.StageExecutorSet) error {
	member, name, err := r.executorOf(ctx, b)
	if err != nil {
		return err
	}
	if _, err := r.tx.Exec(ctx, `update repairs.schedule_stages set executor_member_id = $2, executor_name = $3 where id = $1`, st.id, member, name); err != nil {
		return store("stage executor", err)
	}
	now, notified := "", []string{}
	if name != nil {
		now = *name
		notified = append(notified, now)
	}
	text := fmt.Sprintf("«%s»: исполнитель %s → %s", st.name, orNone(st.executor()), orNone(now))
	if err := r.journal(ctx, sc.p.id, text, nil, map[string]any{"stageId": st.id}, notified); err != nil {
		return err
	}
	if err := r.bump(ctx, sc.p.id); err != nil {
		return err
	}
	return r.publishProject(ctx, eventScheduleChanged, sc.p.id, map[string]any{"kind": "executor", "stageIds": []uuid.UUID{st.id}, "notify": notified})
}
func orNone(name string) string {
	if name == "" {
		return "не назначен"
	}
	return name
}

// executorOf resolves the executor of the request: a member of the organization (his name is the name of the stage), a
// name without an account, or nobody.
func (r *req) executorOf(ctx context.Context, b rapi.StageExecutorSet) (*uuid.UUID, *string, error) {
	if b.ExecutorMemberId != nil {
		ok, err := r.isMember(ctx, *b.ExecutorMemberId)
		if err != nil {
			return nil, nil, err
		}
		if !ok {
			return nil, nil, invalid("executorMemberId", textMemberMissing, "unknown")
		}
		if err := r.loadNames(ctx, []uuid.UUID{*b.ExecutorMemberId}); err != nil {
			return nil, nil, err
		}
		id := *b.ExecutorMemberId
		return &id, new(clip(r.names[id], 150)), nil
	}
	if b.ExecutorName != nil {
		if n := strings.TrimSpace(*b.ExecutorName); n != "" {
			return nil, new(clip(n, 150)), nil
		}
	}
	return nil, nil, nil
}

// CreateBaseline answers createScheduleBaseline: a new baseline by the additional agreement; the due date of the object
// changes only this way.
func (s *Service) CreateBaseline(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, agreementNo int) (rapi.Schedule, error) {
	var out rapi.Schedule
	err := s.run(ctx, tc, true, func(r *req) error {
		sc, err := r.writable(ctx, id, actSchedBaseline, textNeedBaseline, ifMatch)
		if err != nil {
			return err
		}
		if len(sc.stages) == 0 {
			return notFound(textScheduleMissing)
		}
		var signed bool
		if err := r.tx.QueryRow(ctx, `select exists (select 1 from repairs.estimates where project_id = $1 and agreement_no = $2 and state = 'approved')`,
			id, agreementNo).Scan(&signed); err != nil {
			return store("agreement", err)
		}
		if !signed {
			return invalid("agreementNo", textAgreementMissing, "unknown")
		}
		f, err := sc.compute()
		if err != nil {
			return err
		}
		if err := r.writeBaseline(ctx, sc, f, agreementNo); err != nil {
			return err
		}
		fresh, err := r.loadSched(ctx, sc.p)
		if err != nil {
			return err
		}
		out, err = r.scheduleDTO(ctx, fresh)
		return err
	})
	return out, err
}

// writeBaseline fixes the forecast as the new baseline: the snapshot of the plan, the term of the object, the journal.
func (r *req) writeBaseline(ctx context.Context, sc *sched, f *forecast, agreementNo int) error {
	type snapStage struct {
		ID  uuid.UUID `json:"id"`
		Dur int       `json:"durationWd"`
		Off int       `json:"offsetWd"`
	}
	type snapLink struct {
		From uuid.UUID `json:"from"`
		To   uuid.UUID `json:"to"`
		Lag  int       `json:"lagDays"`
	}
	snap := struct {
		Stages []snapStage `json:"stages"`
		Links  []snapLink  `json:"links"`
	}{}
	for _, st := range sc.stages {
		snap.Stages = append(snap.Stages, snapStage{st.id, st.dur, st.off})
	}
	for _, l := range sc.links {
		snap.Links = append(snap.Links, snapLink{l.from, l.to, l.lag})
	}
	raw, err := json.Marshal(snap)
	if err != nil {
		return store("baseline snapshot", err)
	}
	version := 1
	if sc.baseline != nil {
		version = sc.baseline.version + 1
	}
	due := dateOf(f.fin)
	var approver *uuid.UUID
	if r.me() != uuid.Nil {
		approver = new(r.me())
	}
	if _, err := r.tx.Exec(ctx, `insert into repairs.schedule_baselines (project_id, version, due_on, approved_at, approved_by, agreement_no, snapshot)
		values ($1, $2, $3, $4, $5, $6, $7)`, sc.p.id, version, due, r.now, approver, agreementNo, raw); err != nil {
		return store("baseline", err)
	}
	if _, err := r.tx.Exec(ctx, `update repairs.projects set due_on = $2, revision = revision + 1, updated_at = $3 where id = $1`, sc.p.id, due, r.now); err != nil {
		return store("due date", err)
	}
	text := fmt.Sprintf("Базовый план обновлён допсоглашением № %d, сдача %s", agreementNo, ruDM(f.fin))
	if err := r.journal(ctx, sc.p.id, text, nil, map[string]any{"agreementNo": agreementNo, "version": version}, []string{}); err != nil {
		return err
	}
	if err := r.bump(ctx, sc.p.id); err != nil {
		return err
	}
	if err := r.event(ctx, sc.p.id, evScheduleBaseline, "зафиксировал базовый план графика: допсоглашение № "+strconv.Itoa(agreementNo)); err != nil {
		return err
	}
	return r.publishProject(ctx, eventScheduleBaselineSet, sc.p.id, map[string]any{"version": version, "agreementNo": agreementNo, "dueOn": due.Format("2006-01-02")})
}

// estimateRow is an estimate version the schedule is built from.
type estimateRow struct {
	id    uuid.UUID
	state string
}

// templateStage is a stage of the technology of a template.
type templateStage struct {
	name     string
	rate     *float64
	pause    int
	sections []string
}

// sectionRow is a section of an estimate with the volume of its works.
type sectionRow struct {
	id     uuid.UUID
	name   string
	volume float64
}

// phases of the built schedule (the prototype): the first stages are rough, the rest finishing, then the hand over.
const (
	phaseRough  = "Черновые работы"
	phaseFinish = "Чистовые работы"
	phaseHand   = "Сдача"
	roughStages = 3
	handName    = "Сдача объекта"
	maxBuilt    = 30
)

// CreateSchedule answers createScheduleFromEstimate: the stages from the sections of an approved version of the
// estimate by the technology of the template of the object.
func (s *Service) CreateSchedule(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, version int) (rapi.Schedule, error) {
	var out rapi.Schedule
	err := s.run(ctx, tc, true, func(r *req) error {
		sc, err := r.scheduleOf(ctx, id, actSchedShift, textNeedSchedShift, true)
		if err != nil {
			return err
		}
		if sc.p.status == statusHandedOver {
			return conflict(reasonHandedOver, textHandedOverSched)
		}
		est, err := r.estimate(ctx, id, version)
		if err != nil {
			return err
		}
		if len(sc.stages) > 0 {
			return &failure{code: codeTransition, detail: textScheduleExists}
		}
		sections, err := r.sections(ctx, est.id)
		if err != nil {
			return err
		}
		tech, err := r.technology(ctx, sc.p, sections)
		if err != nil {
			return err
		}
		if len(tech) == 0 {
			return invalid("estimateVersion", textEstimateEmpty, "empty")
		}
		if err := r.buildStages(ctx, sc.p.id, tech, sections); err != nil {
			return err
		}
		if err := r.journal(ctx, id, fmt.Sprintf("График собран по версии %d сметы и технологии шаблона", version), nil, map[string]any{"estimateVersion": version}, []string{}); err != nil {
			return err
		}
		if err := r.bump(ctx, id); err != nil {
			return err
		}
		if err := r.event(ctx, id, evScheduleBuilt, fmt.Sprintf("собрал график по смете v%d", version)); err != nil {
			return err
		}
		fresh, err := r.loadSched(ctx, sc.p)
		if err != nil {
			return err
		}
		out, err = r.scheduleDTO(ctx, fresh)
		return err
	})
	return out, err
}

func (r *req) estimate(ctx context.Context, project uuid.UUID, version int) (estimateRow, error) {
	var e estimateRow
	err := r.tx.QueryRow(ctx, `select id, state from repairs.estimates where project_id = $1 and version = $2`, project, version).Scan(&e.id, &e.state)
	switch {
	case noRows(err):
		return e, invalid("estimateVersion", textEstimateMissing, "unknown")
	case err != nil:
		return e, store("estimate", err)
	case e.state != "approved":
		return e, conflict(reasonNoEstimate, textEstimateNotOK)
	}
	return e, nil
}

// sections reads the sections of an estimate with the volume of their works (the lines of the kind «work»).
func (r *req) sections(ctx context.Context, estimate uuid.UUID) ([]sectionRow, error) {
	rows, err := r.tx.Query(ctx, `select s.id, s.name, coalesce(sum(l.quantity) filter (where l.kind = 'work'), 0)::float8
		from repairs.estimate_sections s left join repairs.estimate_lines l on l.section_id = s.id
		where s.estimate_id = $1 group by s.id, s.name, s.sort order by s.sort, s.id`, estimate)
	if err != nil {
		return nil, store("estimate sections", err)
	}
	defer rows.Close()
	var out []sectionRow
	for rows.Next() {
		var sec sectionRow
		if err := rows.Scan(&sec.id, &sec.name, &sec.volume); err != nil {
			return nil, store("estimate sections", err)
		}
		out = append(out, sec)
	}
	return out, store("estimate sections", rows.Err())
}

// technology is the sequence of the stages: the technology of the template of the object, else one stage per section.
func (r *req) technology(ctx context.Context, p *projectRow, sections []sectionRow) ([]templateStage, error) {
	var out []templateStage
	if p.template != nil {
		rows, err := r.tx.Query(ctx, `select name, rate_per_day::float8, pause_days, sections from repairs.template_stages where template_id = $1 order by sort, id`, *p.template)
		if err != nil {
			return nil, store("template stages", err)
		}
		defer rows.Close()
		for rows.Next() {
			var t templateStage
			if err := rows.Scan(&t.name, &t.rate, &t.pause, &t.sections); err != nil {
				return nil, store("template stages", err)
			}
			out = append(out, t)
		}
		if err := rows.Err(); err != nil {
			return nil, store("template stages", err)
		}
	}
	if len(out) == 0 {
		for _, sec := range sections {
			out = append(out, templateStage{name: sec.name, sections: []string{sec.name}})
		}
	}
	return out, nil
}

// buildStages writes the stages and the links of the technology, then the stage of the hand over.
func (r *req) buildStages(ctx context.Context, project uuid.UUID, tech []templateStage, sections []sectionRow) error {
	var prev *uuid.UUID
	insert := func(i int, phase, name string, section *uuid.UUID, volume *float64, rate *float64, dur, pause int) error {
		stage := uuid.New()
		if _, err := r.tx.Exec(ctx, `insert into repairs.schedule_stages (id, project_id, phase, name, estimate_section_id, volume, rate_per_day, duration_wd, sort)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, stage, project, phase, name, section, volume, rate, dur, i); err != nil {
			return store("stage", err)
		}
		if prev != nil {
			if _, err := r.tx.Exec(ctx, `insert into repairs.schedule_links (project_id, from_stage_id, to_stage_id, lag_days) values ($1, $2, $3, $4)`,
				project, *prev, stage, pause); err != nil {
				return store("link", err)
			}
		}
		prev = &stage
		return nil
	}
	for i, t := range tech {
		phase := phaseFinish
		if i < roughStages {
			phase = phaseRough
		}
		var (
			section *uuid.UUID
			volume  float64
		)
		for _, sec := range sections {
			if slices.ContainsFunc(t.sections, func(n string) bool { return strings.EqualFold(strings.TrimSpace(n), strings.TrimSpace(sec.name)) }) {
				if section == nil {
					section = new(sec.id)
				}
				volume += sec.volume
			}
		}
		if err := insert(i, phase, t.name, section, volumeArg(volume), t.rate, durationOf(volume, t.rate), t.pause); err != nil {
			return err
		}
	}
	return insert(len(tech), phaseHand, handName, nil, nil, nil, 1, 0)
}

// volumeArg is the volume of a stage for the table (none when the stage has no works).
func volumeArg(v float64) *float64 {
	if v <= 0 {
		return nil
	}
	return &v
}

// durationOf is the duration of a stage in working days: the volume of its works by the rate of the day, rounded up and
// kept within 1…30 days; a stage without a volume or a rate lasts a day.
func durationOf(volume float64, rate *float64) int {
	if rate == nil || *rate <= 0 || volume <= 0 {
		return 1
	}
	return int(min(maxBuilt, max(1, math.Ceil(volume / *rate - 1e-9))))
}
