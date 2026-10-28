package docs

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
)

// routeRules are the rules of a route (docs.routes.rules): the key «sign» of the same object holds the challenge of a
// signature in progress.
type routeRules struct {
	Lock          bool            `json:"lock"`
	NotAuthor     bool            `json:"notAuthor"`
	CommentOnBack bool            `json:"commentOnBack"`
	Escalate      bool            `json:"escalate"`
	Sign          json.RawMessage `json:"sign,omitempty"`
}

// extJSON is docs.route_steps.external: the customer of an external step and the mark of an acknowledgement that ended
// early.
type extJSON struct {
	Name   string `json:"name,omitempty"`
	Phone  string `json:"phone,omitempty"`
	Closed bool   `json:"closed,omitempty"`
}

// backJSON is docs.routes.back: where the route returned and why.
type backJSON struct {
	Step    int       `json:"step"`
	By      uuid.UUID `json:"by"`
	Name    string    `json:"name"`
	Comment string    `json:"comment,omitempty"`
	At      time.Time `json:"at"`
}

// routeData is a route with its steps, read for an operation (docs.routes, docs.route_steps and what decides them).
type routeData struct {
	id        uuid.UUID
	doc       uuid.UUID
	version   int
	startedBy uuid.UUID
	startedAt time.Time
	status    string
	current   int
	project   uuid.UUID
	task      uuid.UUID
	rules     routeRules
	back      *backJSON
	steps     []*routeStep
}

// step is the current step of the route; nil when the route has none.
func (rd *routeData) step() *routeStep {
	if rd == nil || rd.current < 0 || rd.current >= len(rd.steps) {
		return nil
	}
	return rd.steps[rd.current]
}

// loadRoute reads the last route of document doc (an active or returned one first) with its steps, decisions and
// acknowledgements; nil — none. lock takes the row for update: two decisions of one route never run side by side.
func (r *req) loadRoute(ctx context.Context, doc uuid.UUID, lock bool) (*routeData, error) {
	return r.routeWhere(ctx, doc, uuid.Nil, lock)
}

// loadRouteByID reads the route id of document doc (the one the snapshot named: a route that has just ended is still
// the route of the answer).
func (r *req) loadRouteByID(ctx context.Context, doc, id uuid.UUID) (*routeData, error) {
	return r.routeWhere(ctx, doc, id, false)
}

func (r *req) routeWhere(ctx context.Context, doc, id uuid.UUID, lock bool) (*routeData, error) {
	sql := `select id, version, started_by, started_at, status, current_step, coalesce(project_id, ` + nilUUID + `),
		coalesce(task_id, ` + nilUUID + `), rules, back from docs.routes where document_id = $1 and ($2::uuid is null or id = $2)
		order by (status in ('active', 'returned')) desc, started_at desc, id limit 1`
	if lock {
		sql += ` for update`
	}
	rd := &routeData{doc: doc}
	var rules, back []byte
	err := r.tx.QueryRow(ctx, sql, doc, nullID(id)).Scan(&rd.id, &rd.version, &rd.startedBy, &rd.startedAt, &rd.status, &rd.current, &rd.project, &rd.task, &rules, &back)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil, nil
	case err != nil:
		return nil, fmt.Errorf("docs: route: %w", err)
	}
	if v := decodeObject[routeRules](rules); v != nil {
		rd.rules = *v
	}
	rd.back = decodeObject[backJSON](back)
	if rd.steps, err = r.loadSteps(ctx, rd); err != nil {
		return nil, err
	}
	return rd, nil
}
func (r *req) loadSteps(ctx context.Context, rd *routeData) ([]*routeStep, error) {
	rows, err := r.tx.Query(ctx, `select position, kind, name, mode, who, audience, days, status, due_at, external
		from docs.route_steps where route_id = $1 order by position`, rd.id)
	if err != nil {
		return nil, fmt.Errorf("docs: route steps: %w", err)
	}
	steps, err := pgx.CollectRows(rows, func(x pgx.CollectableRow) (*routeStep, error) {
		var (
			s   routeStep
			ext []byte
		)
		err := x.Scan(&s.pos, &s.kind, &s.name, &s.mode, &s.who, &s.audience, &s.days, &s.status, &s.due, &ext)
		if v := decodeObject[extJSON](ext); v != nil {
			s.ext, s.closed = extStep{name: v.Name, phone: v.Phone}, v.Closed
		}
		return &s, err
	})
	if err != nil {
		return nil, fmt.Errorf("docs: route steps: %w", err)
	}
	drs, err := r.tx.Query(ctx, `select position, member_id, decision, method, coalesce(comment, ''), at from docs.route_decisions
		where route_id = $1 order by at, id`, rd.id)
	if err != nil {
		return nil, fmt.Errorf("docs: route decisions: %w", err)
	}
	defer drs.Close()
	for drs.Next() {
		var (
			pos int
			d   decision
		)
		if err := drs.Scan(&pos, &d.member, &d.kind, &d.method, &d.comment, &d.at); err != nil {
			return nil, fmt.Errorf("docs: route decisions: %w", err)
		}
		if pos >= 0 && pos < len(steps) {
			steps[pos].decisions = append(steps[pos].decisions, d)
		}
	}
	if err := drs.Err(); err != nil {
		return nil, fmt.Errorf("docs: route decisions: %w", err)
	}
	acked, err := r.ackedBy(ctx, rd.doc, rd.version)
	if err != nil {
		return nil, err
	}
	for _, s := range steps {
		if s.kind == stepAck {
			s.acked = acked
		}
	}
	return steps, nil
}

// ackedBy are the members who acknowledged version v of the document.
func (r *req) ackedBy(ctx context.Context, doc uuid.UUID, v int) ([]uuid.UUID, error) {
	rows, err := r.tx.Query(ctx, `select member_id from docs.acks where document_id = $1 and version = $2 order by at`, doc, v)
	if err != nil {
		return nil, fmt.Errorf("docs: acks: %w", err)
	}
	out, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, fmt.Errorf("docs: acks: %w", err)
	}
	return out, nil
}

// stepDone are the acknowledgements of version v for the card: who, when, on what device.
func (r *req) stepDone(ctx context.Context, doc uuid.UUID, v int) ([]struct {
	At     dapi.Instant      `json:"at"`
	Device string            `json:"device"`
	Member dapi.DocMemberRef `json:"member"`
}, error) {
	type row = struct {
		At     dapi.Instant      `json:"at"`
		Device string            `json:"device"`
		Member dapi.DocMemberRef `json:"member"`
	}
	rows, err := r.tx.Query(ctx, `select member_id, device, at from docs.acks where document_id = $1 and version = $2 order by at`, doc, v)
	if err != nil {
		return nil, fmt.Errorf("docs: acks: %w", err)
	}
	out, err := pgx.CollectRows(rows, func(x pgx.CollectableRow) (row, error) {
		var (
			m uuid.UUID
			o row
		)
		err := x.Scan(&m, &o.Device, &o.At)
		o.Member, o.At = r.memberRef(m), instant(o.At)
		return o, err
	})
	if err != nil {
		return nil, fmt.Errorf("docs: acks: %w", err)
	}
	if out == nil {
		out = []row{}
	}
	return out, nil
}

// insertRoute writes a route with its steps (all waiting).
func (r *req) insertRoute(ctx context.Context, rd *routeData) error {
	rules, _ := json.Marshal(rd.rules)
	if _, err := r.tx.Exec(ctx, `insert into docs.routes (id, document_id, version, started_by, started_at, status, current_step, project_id, task_id, rules)
		values ($1, $2, $3, $4, $5, 'active', 0, $6, null, $7)`, rd.id, rd.doc, rd.version, rd.startedBy, r.now, nullID(rd.project), rules); err != nil {
		return fmt.Errorf("docs: insert route: %w", err)
	}
	for _, s := range rd.steps {
		var ext any
		if s.kind == stepExternal {
			ext, _ = json.Marshal(extJSON{Name: s.ext.name, Phone: s.ext.phone})
		}
		if _, err := r.tx.Exec(ctx, `insert into docs.route_steps (route_id, position, kind, name, mode, who, audience, days, status, external)
			values ($1, $2, $3, $4, $5, $6, $7, $8, 'wait', $9)`,
			rd.id, s.pos, s.kind, s.name, s.mode, nonNilIDs(s.who), nullBytes(s.audience), s.days, ext); err != nil {
			return fmt.Errorf("docs: insert route step: %w", err)
		}
	}
	return nil
}

func nonNilIDs(ids []uuid.UUID) []uuid.UUID {
	if ids == nil {
		return []uuid.UUID{}
	}
	return ids
}

// saveRoute writes the status, the current step, the task and the return of a route.
func (r *req) saveRoute(ctx context.Context, rd *routeData) error {
	rules, _ := json.Marshal(rd.rules)
	var back any
	if rd.back != nil {
		back, _ = json.Marshal(rd.back)
	}
	var finished any
	if rd.status == routeDone || rd.status == routeCancelled {
		finished = r.now
	}
	if _, err := r.tx.Exec(ctx, `update docs.routes set version = $2, status = $3, current_step = $4, task_id = $5, project_id = $6, rules = $7,
		back = $8, finished_at = $9 where id = $1`, rd.id, rd.version, rd.status, rd.current, nullID(rd.task), nullID(rd.project), rules, back, finished); err != nil {
		return fmt.Errorf("docs: save route: %w", err)
	}
	return nil
}

// saveStep writes the state of a step: the status, the term, the addressees and the mark of an early end.
func (r *req) saveStep(ctx context.Context, rd *routeData, s *routeStep) error {
	var ext any
	switch s.kind {
	case stepExternal:
		ext, _ = json.Marshal(extJSON{Name: s.ext.name, Phone: s.ext.phone})
	case stepAck:
		if s.closed {
			ext, _ = json.Marshal(extJSON{Closed: true})
		}
	}
	if _, err := r.tx.Exec(ctx, `update docs.route_steps set status = $3, due_at = $4, who = $5, external = $6 where route_id = $1 and position = $2`,
		rd.id, s.pos, s.status, s.due, nonNilIDs(s.who), ext); err != nil {
		return fmt.Errorf("docs: save step: %w", err)
	}
	return nil
}

// addDecision writes a decision of a member on a step and keeps it in the step.
func (r *req) addDecision(ctx context.Context, rd *routeData, s *routeStep, d decision) error {
	d.at = r.now
	var comment any
	if d.comment != "" {
		comment = d.comment
	}
	if _, err := r.tx.Exec(ctx, `insert into docs.route_decisions (route_id, position, member_id, decision, method, comment, at)
		values ($1, $2, $3, $4, $5, $6, $7)`, rd.id, s.pos, d.member, d.kind, d.method, comment, d.at); err != nil {
		return fmt.Errorf("docs: insert decision: %w", err)
	}
	s.decisions = append(s.decisions, d)
	return nil
}

// grantTemp gives member a temporary access of the route and keeps it in the snapshot: the access chain of the rest of
// the operation sees it.
func (r *req) grantTemp(ctx context.Context, d *document, member uuid.UUID, l level, why string, onlyVersion int, keep bool) error {
	var only any
	if onlyVersion > 0 {
		only = onlyVersion
	}
	if _, err := r.tx.Exec(ctx, `insert into docs.temp_grants (document_id, member_id, level, why, only_version, keep, granted_by, granted_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8)`, d.id, member, l.code(), why, only, keep, r.actorID(), r.now); err != nil {
		return fmt.Errorf("docs: temporary access: %w", err)
	}
	d.tmp = append(d.tmp, tempGrant{member: member, level: l, why: why, onlyVersion: onlyVersion, keep: keep})
	return nil
}

// revokeTemps takes back the temporary accesses of the route that are not kept (an acknowledgement keeps «Читает»).
func (r *req) revokeTemps(ctx context.Context, d *document) error {
	if _, err := r.tx.Exec(ctx, `update docs.temp_grants set revoked_at = $2 where document_id = $1 and revoked_at is null and not keep`, d.id, r.now); err != nil {
		return fmt.Errorf("docs: revoke temporary accesses: %w", err)
	}
	d.tmp = slices.DeleteFunc(d.tmp, func(t tempGrant) bool { return !t.keep })
	return nil
}

// saveDoc writes the status of a document after a step of its route; frozen (nil — as it is) closes the CRM fields.
func (r *req) saveDoc(ctx context.Context, d *document, status string, frozen []byte) error {
	if _, err := r.tx.Exec(ctx, `update docs.documents set status = $2, frozen = coalesce($3, frozen), updated_at = $4, revision = revision + 1
		where id = $1`, d.id, status, nullBytes(frozen), r.now); err != nil {
		return fmt.Errorf("docs: save status: %w", err)
	}
	d.status, d.updated = status, r.now
	d.revision++
	if len(frozen) > 0 {
		d.frozen = frozen
	}
	return nil
}
