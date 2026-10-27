package repairs

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Works answers listRepairWorks: the works of an object with the plan, the accepted fact and the volume on acceptance.
func (s *Service) Works(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (rapi.RepairWorkList, error) {
	out := rapi.RepairWorkList{Items: []rapi.RepairWork{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		p, err := r.visibleProject(ctx, id, false)
		if err != nil {
			return err
		}
		f, err := r.loadFacts(ctx, []uuid.UUID{p.id})
		if err != nil {
			return err
		}
		out.Items = workDTOs(f.works[p.id])
		return nil
	})
	return out, err
}

func workDTOs(ws []workFact) []rapi.RepairWork {
	out := make([]rapi.RepairWork, 0, len(ws))
	for _, w := range ws {
		out = append(out, rapi.RepairWork{Id: w.id, ProjectId: w.project, Name: w.name, Unit: rapi.RepairUnit(w.unit), Plan: w.plan.String(),
			Fact: w.fact.String(), Pending: w.pending.String(), EstimateLineId: w.line})
	}
	return out
}

// logRow is a mark of the foreman (repairs.work_logs).
type logRow struct {
	id, project, submittedBy uuid.UUID
	number, zone, status     string
	workDate, createdAt      time.Time
	note                     *string
	crew, evidence           []uuid.UUID
	materials                []byte
	reviewedBy               *uuid.UUID
	reviewedAt               *time.Time
	returnReason             *string
	revision                 int64
	lines                    []rapi.WorkLogLine
}

const logCols = `g.id, g.number, g.project_id, g.submitted_by, g.work_date, g.time_zone, g.status, g.note, g.crew_worker_ids, g.materials,
	g.evidence_file_ids, g.reviewed_by, g.reviewed_at, g.return_reason, g.revision, g.created_at`

func (l *logRow) scan(row interface{ Scan(...any) error }) error {
	return row.Scan(&l.id, &l.number, &l.project, &l.submittedBy, &l.workDate, &l.zone, &l.status, &l.note, &l.crew, &l.materials,
		&l.evidence, &l.reviewedBy, &l.reviewedAt, &l.returnReason, &l.revision, &l.createdAt)
}

// loadLines reads the lines of the marks.
func (r *req) loadLines(ctx context.Context, logs []*logRow) error {
	if len(logs) == 0 {
		return nil
	}
	by := map[uuid.UUID]*logRow{}
	ids := make([]uuid.UUID, 0, len(logs))
	for _, l := range logs {
		by[l.id] = l
		ids = append(ids, l.id)
	}
	rows, err := r.tx.Query(ctx, `select work_log_id, work_id, (quantity * 1000)::bigint, unit, description, presence_minutes
		from repairs.work_log_lines where work_log_id = any($1) order by work_log_id, line_no`, ids)
	if err != nil {
		return store("lines", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id       uuid.UUID
			ln       rapi.WorkLogLine
			work     *uuid.UUID
			qty      int64
			unit     string
			presence *int32
		)
		if err := rows.Scan(&id, &work, &qty, &unit, &ln.Description, &presence); err != nil {
			return store("lines", err)
		}
		ln.WorkId, ln.Quantity, ln.Unit = work, milli(qty).String(), rapi.WorkLogLineUnit(unit)
		if presence != nil {
			ln.PresenceMinutes = new(int64(*presence))
		}
		by[id].lines = append(by[id].lines, ln)
	}
	return store("lines", rows.Err())
}

// logDTO is the mark as the member reads it: the reason of a return is not for the crew (only the office and the foreman).
func logDTO(l *logRow, reasonVisible bool) (rapi.WorkLog, error) {
	materials := []rapi.WorkLogMaterial{}
	if len(l.materials) > 0 {
		if err := json.Unmarshal(l.materials, &materials); err != nil {
			return rapi.WorkLog{}, store("materials", err)
		}
	}
	crew := slices.Clone(l.crew)
	if crew == nil {
		crew = []uuid.UUID{}
	}
	lines := l.lines
	if lines == nil {
		lines = []rapi.WorkLogLine{}
	}
	dto := rapi.WorkLog{Id: l.id, ProjectId: l.project, SubmittedByMemberId: l.submittedBy, TimeZone: l.zone, Lines: lines, EvidenceFileIds: slices.Clone(l.evidence), Status: rapi.WorkLogStatus(l.status), CreatedAt: l.createdAt,
		Revision: l.revision, Number: &l.number, CrewWorkerIds: &crew, Materials: &materials}
	dto.WorkDate.Time = l.workDate
	if l.status == logAccepted && l.reviewedAt != nil {
		dto.AcceptedAt = l.reviewedAt
		dto.AcceptedByMemberId = l.reviewedBy
	}
	if reasonVisible {
		dto.ReturnReason = l.returnReason
	}
	return dto, nil
}

// LogQuery is the filter of listWorkLogs.
type LogQuery struct {
	Project *uuid.UUID
	Status  *string
	Cursor  *string
	Limit   *int
}

var logStatuses = []string{logSubmitted, logAccepted, logRejected}

// WorkLogs answers listWorkLogs: the marks of the objects the member reads (the foreman — of his own), the latest first.
func (s *Service) WorkLogs(ctx context.Context, tc tenantctx.TenantContext, q LogQuery) (rapi.WorkLogPage, error) {
	out := rapi.WorkLogPage{Items: []rapi.WorkLog{}}
	if q.Status != nil && !slices.Contains(logStatuses, *q.Status) {
		return out, malformed(textUnknownStatus)
	}
	err := s.run(ctx, tc, false, func(r *req) error {
		if ok, err := r.anywhere(ctx, actLogsRead); err != nil || !ok {
			if err == nil {
				err = forbidden("")
			}
			return err
		}
		ids, readable, err := r.readableProjects(ctx, q.Project)
		if err != nil || len(ids) == 0 {
			return err
		}
		logs, next, err := r.logPage(ctx, ids, q)
		if err != nil {
			return err
		}
		for _, l := range logs {
			dto, err := logDTO(l, readable[l.project])
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

// logPage reads the page of the marks of the objects ids the cursor and the limit of q ask for, and the cursor of the next one.
func (r *req) logPage(ctx context.Context, ids []uuid.UUID, q LogQuery) ([]*logRow, *string, error) {
	from, n, err := window(q.Cursor, q.Limit)
	if err != nil {
		return nil, nil, err
	}
	logs, err := r.queryLogs(ctx, ids, q.Status, from, n+1) // one more: is there a next page
	if err != nil {
		return nil, nil, err
	}
	var next *string
	if len(logs) > n {
		logs, next = logs[:n], new("o"+strconv.Itoa(from+n))
	}
	return logs, next, r.loadLines(ctx, logs)
}

// readableProjects are the objects whose marks the member reads (he sees the object and holds work_logs.read there; only
// project when set) and, per object, whether he reads the reason of a return: the office and the foreman do.
func (r *req) readableProjects(ctx context.Context, only *uuid.UUID) ([]uuid.UUID, map[uuid.UUID]bool, error) {
	all, err := r.allProjects(ctx)
	if err != nil {
		return nil, nil, err
	}
	reason := map[uuid.UUID]bool{}
	var ids []uuid.UUID
	for _, p := range all {
		if only != nil && p.id != *only {
			continue
		}
		ok, err := r.sees(ctx, p)
		if err == nil && ok {
			ok, err = r.can(ctx, p, actLogsRead)
		}
		if err != nil {
			return nil, nil, err
		}
		if !ok {
			continue
		}
		office, err := r.office(ctx, p)
		if err != nil {
			return nil, nil, err
		}
		ids = append(ids, p.id)
		reason[p.id] = office || p.isForeman(r.me())
	}
	return ids, reason, nil
}

// queryLogs reads a window of the marks of the objects ids (a status when set), the latest first: limit rows from offset.
func (r *req) queryLogs(ctx context.Context, ids []uuid.UUID, status *string, offset, limit int) ([]*logRow, error) {
	rows, err := r.tx.Query(ctx, `select `+logCols+` from repairs.work_logs g where g.project_id = any($1) and ($2::text is null or g.status = $2)
		order by g.created_at desc, g.number desc, g.id desc offset $3 limit $4`, ids, status, offset, limit)
	if err != nil {
		return nil, store("logs", err)
	}
	defer rows.Close()
	var logs []*logRow
	for rows.Next() {
		l := &logRow{}
		if err := l.scan(rows); err != nil {
			return nil, store("logs", err)
		}
		logs = append(logs, l)
	}
	return logs, store("logs", rows.Err())
}

// workLog reads a mark ("for update" locks it); nil — there is none.
func (r *req) workLog(ctx context.Context, id uuid.UUID, lock bool) (*logRow, error) {
	q := `select ` + logCols + ` from repairs.work_logs g where g.id = $1`
	if lock {
		q += ` for update of g`
	}
	l := &logRow{}
	if err := l.scan(r.tx.QueryRow(ctx, q, id)); err != nil {
		if noRows(err) {
			return nil, nil
		}
		return nil, store("log", err)
	}
	return l, r.loadLines(ctx, []*logRow{l})
}

// logOut is the answer of a command on a mark.
func (r *req) logOut(ctx context.Context, id uuid.UUID, p *projectRow) (rapi.WorkLog, error) {
	l, err := r.workLog(ctx, id, false)
	if err != nil || l == nil {
		return rapi.WorkLog{}, err
	}
	office, err := r.office(ctx, p)
	if err != nil {
		return rapi.WorkLog{}, err
	}
	return logDTO(l, office || p.isForeman(r.me()))
}

func lineField(i int, name string) string { return "lines[" + strconv.Itoa(i) + "]." + name }

// SubmitWorkLog answers submitWorkLog: the mark of the foreman of the object — a work and a volume per line, the photos,
// the crew and the materials; it waits for the acceptance.
func (s *Service) SubmitWorkLog(ctx context.Context, tc tenantctx.TenantContext, b rapi.WorkLogCreate) (rapi.WorkLog, error) {
	var out rapi.WorkLog
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.visibleProject(ctx, b.ProjectId, true)
		if err != nil {
			return err
		}
		if ok, err := r.can(ctx, p, actSubmit); err != nil || !ok || !p.isForeman(r.me()) {
			if err == nil {
				err = forbidden(textForemanOnly)
			}
			return err
		}
		if p.status == statusHandedOver {
			return conflict(reasonHandedOver, textHandedOver)
		}
		if err := r.checkDate(b); err != nil {
			return err
		}
		m, err := r.checkMark(ctx, p, b)
		if err != nil {
			return err
		}
		id, err := r.insertLog(ctx, p, b, m)
		if err != nil {
			return err
		}
		out, err = r.logOut(ctx, id, p)
		if err != nil {
			return err
		}
		return r.event(ctx, p.id, evLogSubmitted, "отправлена на приёмку отметка "+deref(out.Number))
	})
	return out, err
}

// markBody is a checked mark: its lines, its crew and its materials.
type markBody struct {
	lines     []markLine
	crew      []uuid.UUID
	materials []materialLine
}

// checkMark checks the body of a mark against the object: the lines, the photos, the crew, the materials.
func (r *req) checkMark(ctx context.Context, p *projectRow, b rapi.WorkLogCreate) (markBody, error) {
	f, err := r.loadFacts(ctx, []uuid.UUID{p.id})
	if err != nil {
		return markBody{}, err
	}
	var m markBody
	if m.lines, err = checkLines(b.Lines, f.works[p.id]); err != nil {
		return m, err
	}
	if len(b.EvidenceFileIds) == 0 {
		return m, invalid("evidenceFileIds", textPhotoPick, "required")
	}
	if err := r.checkPhotos(ctx, b.EvidenceFileIds); err != nil {
		return m, err
	}
	m.crew = []uuid.UUID{}
	if b.CrewWorkerIds != nil {
		m.crew = *b.CrewWorkerIds
	}
	if err := checkCrew(m.crew, f.crew[p.id]); err != nil {
		return m, err
	}
	m.materials, err = r.checkMaterials(ctx, b.Materials)
	return m, err
}

// checkPhotos requires every photo to be a checked file (state ready) of files.objects of the tenant: a made-up id, an
// unfinished upload and the file of another organization (its database holds no such row) are not evidence.
func (r *req) checkPhotos(ctx context.Context, ids []uuid.UUID) error {
	uniq := slices.Clone(ids)
	slices.SortFunc(uniq, func(a, b uuid.UUID) int { return bytes.Compare(a[:], b[:]) })
	uniq = slices.Compact(uniq)
	var n int
	if err := r.tx.QueryRow(ctx, `select count(*) from files.objects where id = any($1) and state = 'ready'`, uniq).Scan(&n); err != nil {
		return store("photos", err)
	}
	if n != len(uniq) {
		return invalid("evidenceFileIds", textPhotoUnknown, "unknown")
	}
	return nil
}

// checkDate requires the day of a mark to have begun in the zone of the mark: not later than today there.
func (r *req) checkDate(b rapi.WorkLogCreate) error {
	loc, err := time.LoadLocation(b.TimeZone)
	if err != nil {
		return invalid("timeZone", textZoneUnknown, "unknown")
	}
	y, m, d := r.now.In(loc).Date()
	today := time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
	wy, wm, wd := b.WorkDate.Date()
	if time.Date(wy, wm, wd, 0, 0, 0, 0, time.UTC).After(today) {
		return invalid("workDate", textDateFuture, "future")
	}
	return nil
}

// markLine is a checked line of a mark.
type markLine struct {
	work uuid.UUID
	qty  milli
	unit string
	note *string
}

// checkLines checks the lines of a mark against the works of the object: the work is the object's, the volume is
// positive and not over the plan by the rule (the lines of one work count together, the unit is the unit of the work).
func checkLines(lines []rapi.WorkLogLine, works []workFact) ([]markLine, error) {
	if len(lines) == 0 {
		return nil, invalid("lines", textLinesRequired, "required")
	}
	taken := map[uuid.UUID]milli{}
	out := make([]markLine, 0, len(lines))
	for i, ln := range lines {
		wi := slices.IndexFunc(works, func(w workFact) bool { return ln.WorkId != nil && w.id == *ln.WorkId })
		if wi < 0 {
			return nil, invalid(lineField(i, "workId"), textWorkPick, "unknown")
		}
		w := works[wi]
		qty, ok := parseQty(ln.Quantity)
		if !ok || qty <= 0 {
			return nil, invalid(lineField(i, "quantity"), textQtyPositive, "positive")
		}
		if over, left := overPlan(qty, w.plan, w.fact, w.pending+taken[w.id]); over {
			text := fmt.Sprintf("Объём превышает план более чем на 10%%: осталось %s %s.", left, unitRu(w.unit))
			return nil, &failure{code: codeValidation, detail: text, reason: reasonOverPlan,
				violations: []violation{{lineField(i, "quantity"), "over_plan", text}}}
		}
		taken[w.id] += qty
		out = append(out, markLine{work: w.id, qty: qty, unit: w.unit, note: ln.Description})
	}
	return out, nil
}

// checkCrew requires a non-empty crew of the workers of the object.
func checkCrew(crew []uuid.UUID, workers []crewRow) error {
	if len(crew) == 0 {
		return invalid("crewWorkerIds", textCrewPick, "required")
	}
	for _, id := range crew {
		if !slices.ContainsFunc(workers, func(w crewRow) bool { return w.id == id && w.status == "active" }) {
			return invalid("crewWorkerIds", textCrewPick, "unknown")
		}
	}
	return nil
}

// materialLine is a material of a mark as it is stored.
type materialLine struct {
	PriceItemID uuid.UUID `json:"priceItemId"`
	Quantity    string    `json:"quantity"`
}

// checkMaterials requires the materials of a mark to be positions of the price list of the kind «material».
func (r *req) checkMaterials(ctx context.Context, ms *[]rapi.WorkLogMaterial) ([]materialLine, error) {
	out := []materialLine{}
	if ms == nil {
		return out, nil
	}
	for i, m := range *ms {
		var ok bool
		if err := r.tx.QueryRow(ctx, `select exists (select 1 from repairs.price_items where id = $1 and kind = 'material')`, m.PriceItemId).Scan(&ok); err != nil {
			return nil, store("material", err)
		}
		field := "materials[" + strconv.Itoa(i) + "]"
		if !ok {
			return nil, invalid(field+".priceItemId", textMaterialMissing, "unknown")
		}
		qty, valid := parseQty(m.Quantity)
		if !valid || qty <= 0 {
			return nil, invalid(field+".quantity", textQtyPositive, "positive")
		}
		out = append(out, materialLine{PriceItemID: m.PriceItemId, Quantity: qty.String()})
	}
	return out, nil
}

func (r *req) insertLog(ctx context.Context, p *projectRow, b rapi.WorkLogCreate, m markBody) (uuid.UUID, error) {
	raw, err := json.Marshal(m.materials)
	if err != nil {
		return uuid.Nil, err
	}
	id := uuid.New()
	if _, err := r.tx.Exec(ctx, `insert into repairs.work_logs (id, number, project_id, submitted_by, work_date, time_zone, note, crew_worker_ids,
		materials, evidence_file_ids, created_at) values ($1, 'WL-' || nextval('repairs.work_log_number_seq'), $2, $3, $4::date, $5, $6, $7, $8, $9, $10)`,
		id, p.id, r.me(), b.WorkDate.Time, b.TimeZone, b.Note, m.crew, raw, b.EvidenceFileIds, r.now); err != nil {
		return uuid.Nil, store("insert log", err)
	}
	for i, ln := range m.lines {
		if _, err := r.tx.Exec(ctx, `insert into repairs.work_log_lines (work_log_id, line_no, work_id, quantity, unit, description)
			values ($1, $2, $3, $4::bigint::numeric / 1000, $5, $6)`, id, i+1, ln.work, int64(ln.qty), ln.unit, ln.note); err != nil {
			return uuid.Nil, store("insert line", err)
		}
	}
	return id, nil
}

// reviewable is a mark of an object the member reviews: 404 for a hidden one, 403 without the right, the revision, and
// 409 for a mark that was reviewed already.
func (r *req) reviewable(ctx context.Context, id uuid.UUID) (*logRow, *projectRow, error) {
	l, err := r.workLog(ctx, id, true)
	if err != nil {
		return nil, nil, err
	}
	if l == nil {
		return nil, nil, notFound(textLogNotFound)
	}
	p, err := r.visibleProject(ctx, l.project, false)
	if err != nil {
		return nil, nil, notFound(textLogNotFound)
	}
	if err := r.need(ctx, p, actReview, textNeedReview); err != nil {
		return nil, nil, err
	}
	if p.status == statusHandedOver {
		return nil, nil, conflict(reasonHandedOver, textHandedOverReview)
	}
	return l, p, nil
}

func (r *req) checkReviewable(l *logRow, ifMatch string) error {
	if err := checkRev(ifMatch, l.revision, textLogChanged); err != nil {
		return err
	}
	if l.status != logSubmitted {
		return conflict(reasonLogReviewed, textLogReviewed)
	}
	return nil
}

// AcceptWorkLog answers acceptWorkLog: the volumes of the mark join the fact of the works and its materials leave the
// stock of the object.
func (s *Service) AcceptWorkLog(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string) (rapi.WorkLog, error) {
	var out rapi.WorkLog
	err := s.run(ctx, tc, true, func(r *req) error {
		l, p, err := r.reviewable(ctx, id)
		if err != nil {
			return err
		}
		if err := r.checkReviewable(l, ifMatch); err != nil {
			return err
		}
		for _, ln := range l.lines {
			qty, _ := parseQty(ln.Quantity)
			if ln.WorkId == nil {
				continue
			}
			if _, err := r.tx.Exec(ctx, `update repairs.works set fact_qty = fact_qty + $2::bigint::numeric / 1000 where id = $1`, *ln.WorkId, int64(qty)); err != nil {
				return store("fact", err)
			}
		}
		if err := r.writeOff(ctx, l); err != nil {
			return err
		}
		if err := r.review(ctx, l, logAccepted, nil); err != nil {
			return err
		}
		if err := r.event(ctx, p.id, evLogAccepted, "принят объём по отметке "+l.number); err != nil {
			return err
		}
		out, err = r.logOut(ctx, l.id, p)
		return err
	})
	return out, err
}

// writeOff takes the materials of an accepted mark off the stock of the object at its average price.
func (r *req) writeOff(ctx context.Context, l *logRow) error {
	var ms []materialLine
	if len(l.materials) > 0 {
		if err := json.Unmarshal(l.materials, &ms); err != nil {
			return store("materials", err)
		}
	}
	for _, m := range ms {
		qty, _ := parseQty(m.Quantity)
		if _, err := r.tx.Exec(ctx, `update repairs.project_stock set
			cost_minor = case when quantity > 0 then round(cost_minor::numeric * greatest(0, quantity - $3::bigint::numeric / 1000) / quantity)::bigint else 0 end,
			quantity = greatest(0, quantity - $3::bigint::numeric / 1000), updated_at = $4
			where project_id = $1 and price_item_id = $2`, l.project, m.PriceItemID, int64(qty), r.now); err != nil {
			return store("stock", err)
		}
	}
	return nil
}

// review writes the decision on a mark.
func (r *req) review(ctx context.Context, l *logRow, status string, reason *string) error {
	_, err := r.tx.Exec(ctx, `update repairs.work_logs set status = $2, reviewed_by = $3, reviewed_at = $4, return_reason = $5, revision = revision + 1 where id = $1`,
		l.id, status, r.me(), r.now, reason)
	return store("review", err)
}

// ReturnWorkLog answers returnWorkLog: the mark goes back to the foreman with the reason (RS-09); its volume is not fact.
func (s *Service) ReturnWorkLog(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch, reason string) (rapi.WorkLog, error) {
	var out rapi.WorkLog
	err := s.run(ctx, tc, true, func(r *req) error {
		l, p, err := r.reviewable(ctx, id)
		if err != nil {
			return err
		}
		why := strings.TrimSpace(reason)
		if c := utf8.RuneCountInString(why); c < 2 || c > 500 {
			return invalid("reason", textReasonRequired, "required")
		}
		if err := r.checkReviewable(l, ifMatch); err != nil {
			return err
		}
		if err := r.review(ctx, l, logRejected, &why); err != nil {
			return err
		}
		if err := r.event(ctx, p.id, evLogReturned, "возвращена прорабу отметка "+l.number); err != nil {
			return err
		}
		out, err = r.logOut(ctx, l.id, p)
		return err
	})
	return out, err
}
