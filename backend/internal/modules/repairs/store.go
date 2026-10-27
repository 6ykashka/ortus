package repairs

import (
	"context"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// project reads an object ("for update" locks the row for a command); nil — there is none.
func (r *req) project(ctx context.Context, id uuid.UUID, lock bool) (*projectRow, error) {
	q := `select ` + projectCols + ` from repairs.projects p where p.id = $1`
	if lock {
		q += ` for update of p`
	}
	var p projectRow
	if err := p.scan(r.tx.QueryRow(ctx, q, id)); err != nil {
		if noRows(err) {
			return nil, nil
		}
		return nil, store("project", err)
	}
	return &p, nil
}

// visibleProject is the object id as the member sees it: 404 «Объект не найден» for a missing or a hidden one.
func (r *req) visibleProject(ctx context.Context, id uuid.UUID, lock bool) (*projectRow, error) {
	p, err := r.project(ctx, id, lock)
	if err != nil {
		return nil, err
	}
	if p == nil {
		return nil, notFound(textObjectNotFound)
	}
	ok, err := r.sees(ctx, p)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, notFound(textObjectNotFound)
	}
	return p, nil
}

// allProjects reads every object of the tenant (the area is cut by sees: the tenant of a repair business holds
// dozens of objects, not thousands).
func (r *req) allProjects(ctx context.Context) ([]*projectRow, error) {
	rows, err := r.tx.Query(ctx, `select `+projectCols+` from repairs.projects p order by p.created_at, p.id`)
	if err != nil {
		return nil, store("projects", err)
	}
	defer rows.Close()
	var out []*projectRow
	for rows.Next() {
		p := &projectRow{}
		if err := p.scan(rows); err != nil {
			return nil, store("projects", err)
		}
		out = append(out, p)
	}
	return out, store("projects", rows.Err())
}

// event writes a line of the feed of an object (append only).
func (r *req) event(ctx context.Context, project uuid.UUID, kind, text string) error {
	var actor *uuid.UUID
	if r.me() != uuid.Nil {
		actor = new(r.me())
	}
	_, err := r.tx.Exec(ctx, `insert into repairs.project_events (project_id, at, kind, text, actor_id) values ($1, $2, $3, $4, $5)`,
		project, r.now, kind, text, actor)
	return store("event", err)
}

// isMember reports whether id is a live person of the tenant with an account (a candidate for the foreman).
func (r *req) isMember(ctx context.Context, id uuid.UUID) (bool, error) {
	var ok bool
	err := r.tx.QueryRow(ctx, `select exists (select 1 from people.person_profiles where id = $1 and archived_at is null and membership_id is not null)`,
		id).Scan(&ok)
	return ok, store("member", err)
}

// unitExists reports whether id is an org unit of the tenant that is not archived.
func (r *req) unitExists(ctx context.Context, id uuid.UUID) (bool, error) {
	var ok bool
	err := r.tx.QueryRow(ctx, `select exists (select 1 from org.units where id = $1 and archived_at is null)`, id).Scan(&ok)
	return ok, store("unit", err)
}

// crewRow is a worker of the crew (a card without an account).
type crewRow struct {
	id, project uuid.UUID
	name, trade string
	status      string
}

// workFact is a work of an object with the accepted fact and the volume on acceptance.
type workFact struct {
	id, project         uuid.UUID
	name, unit          string
	plan, fact, pending milli
	line                *uuid.UUID
}

// pendingLog is a mark on acceptance with its first line (the text of the decision «Принять объём»).
type pendingLog struct {
	id         uuid.UUID
	number     string
	work, unit string
	qty        milli
}

type estFact struct {
	version int
	state   string
}

type docFact struct {
	id          uuid.UUID
	kind, state string
	title       string
}

type changeFact struct {
	id     uuid.UUID
	seq    int
	title  string
	status string
}

// facts are the rows the summary and the queue of decisions of a set of objects read in a few queries.
type facts struct {
	works     map[uuid.UUID][]workFact
	pending   map[uuid.UUID][]pendingLog
	today     map[uuid.UUID]bool
	estimates map[uuid.UUID][]estFact
	docs      map[uuid.UUID][]docFact
	supply    map[uuid.UUID]int
	changes   map[uuid.UUID][]changeFact
	idle      map[uuid.UUID][]string
	measured  map[uuid.UUID]bool
	crew      map[uuid.UUID][]crewRow
	hasLink   map[uuid.UUID]bool
}

// group reads the rows of a query into dst by the key of the object each row starts with.
func group[T any](ctx context.Context, tx pgx.Tx, what, sql string, dst map[uuid.UUID][]T, scan func(pgx.Rows) (uuid.UUID, T, error), args ...any) error {
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return store(what, err)
	}
	defer rows.Close()
	for rows.Next() {
		k, v, err := scan(rows)
		if err != nil {
			return store(what, err)
		}
		dst[k] = append(dst[k], v)
	}
	return store(what, rows.Err())
}

// flag marks the objects a query of ids answers.
func flag(ctx context.Context, tx pgx.Tx, what, sql string, dst map[uuid.UUID]bool, args ...any) error {
	rows, err := tx.Query(ctx, sql, args...)
	if err != nil {
		return store(what, err)
	}
	got, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return store(what, err)
	}
	for _, id := range got {
		dst[id] = true
	}
	return nil
}

// loadFacts reads what the objects ids need for their summary.
func (r *req) loadFacts(ctx context.Context, ids []uuid.UUID) (*facts, error) {
	f := &facts{works: map[uuid.UUID][]workFact{}, pending: map[uuid.UUID][]pendingLog{}, today: map[uuid.UUID]bool{},
		estimates: map[uuid.UUID][]estFact{}, docs: map[uuid.UUID][]docFact{}, supply: map[uuid.UUID]int{},
		changes: map[uuid.UUID][]changeFact{}, idle: map[uuid.UUID][]string{}, measured: map[uuid.UUID]bool{},
		crew: map[uuid.UUID][]crewRow{}, hasLink: map[uuid.UUID]bool{}}
	if len(ids) == 0 {
		return f, nil
	}
	tx := r.tx
	steps := []func() error{
		func() error { return r.factWorks(ctx, f, ids) },
		func() error { return r.factPending(ctx, f, ids) },
		func() error {
			return flag(ctx, tx, "logs of today", `select distinct project_id from repairs.work_logs where project_id = any($1) and work_date = $2::date`, f.today, ids, r.now)
		},
		func() error {
			return group(ctx, tx, "estimates", `select project_id, version, state from repairs.estimates where project_id = any($1) order by project_id, version`, f.estimates,
				func(rows pgx.Rows) (uuid.UUID, estFact, error) {
					var (
						k uuid.UUID
						e estFact
					)
					err := rows.Scan(&k, &e.version, &e.state)
					return k, e, err
				}, ids)
		},
		func() error {
			return group(ctx, tx, "documents", `select project_id, id, kind, state, title from repairs.documents where project_id = any($1) order by project_id, created_at, id`, f.docs,
				func(rows pgx.Rows) (uuid.UUID, docFact, error) {
					var (
						k uuid.UUID
						d docFact
					)
					err := rows.Scan(&k, &d.id, &d.kind, &d.state, &d.title)
					return k, d, err
				}, ids)
		},
		func() error { return r.factSupply(ctx, f, ids) },
		func() error {
			return group(ctx, tx, "change orders", `select project_id, id, seq, title, status from repairs.change_orders where project_id = any($1) order by project_id, seq`, f.changes,
				func(rows pgx.Rows) (uuid.UUID, changeFact, error) {
					var (
						k uuid.UUID
						c changeFact
					)
					err := rows.Scan(&k, &c.id, &c.seq, &c.title, &c.status)
					return k, c, err
				}, ids)
		},
		func() error {
			return group(ctx, tx, "stages", `select project_id, name from repairs.schedule_stages where project_id = any($1) and executor_member_id is null
				and coalesce(executor_name, '') = '' and status <> 'done' order by project_id, sort, id`, f.idle,
				func(rows pgx.Rows) (uuid.UUID, string, error) {
					var (
						k    uuid.UUID
						name string
					)
					err := rows.Scan(&k, &name)
					return k, name, err
				}, ids)
		},
		func() error {
			return flag(ctx, tx, "measurements", `select distinct project_id from repairs.measurements where project_id = any($1) and jsonb_array_length(rooms) > 0`, f.measured, ids)
		},
		func() error {
			return group(ctx, tx, "crew", `select project_id, id, display_name, trade, status from repairs.workers where project_id = any($1) order by project_id, created_at, id`, f.crew,
				func(rows pgx.Rows) (uuid.UUID, crewRow, error) {
					var w crewRow
					err := rows.Scan(&w.project, &w.id, &w.name, &w.trade, &w.status)
					return w.project, w, err
				}, ids)
		},
		func() error {
			return flag(ctx, tx, "client links", `select distinct project_id from repairs.client_links where project_id = any($1) and revoked_at is null
				and (expires_at is null or expires_at > $2)`, f.hasLink, ids, r.now)
		},
	}
	for _, step := range steps {
		if err := step(); err != nil {
			return nil, err
		}
	}
	return f, nil
}

func (r *req) factWorks(ctx context.Context, f *facts, ids []uuid.UUID) error {
	return group(ctx, r.tx, "works", `select w.project_id, w.id, w.name, w.unit, (w.plan_qty * 1000)::bigint, (w.fact_qty * 1000)::bigint, w.estimate_line_id,
		coalesce((select sum(l.quantity * 1000)::bigint from repairs.work_log_lines l join repairs.work_logs g on g.id = l.work_log_id
		           where l.work_id = w.id and g.status = 'submitted'), 0)
		from repairs.works w where w.project_id = any($1) order by w.project_id, w.sort, w.name, w.id`, f.works,
		func(rows pgx.Rows) (uuid.UUID, workFact, error) {
			var (
				w                   workFact
				plan, fact, pending int64
			)
			err := rows.Scan(&w.project, &w.id, &w.name, &w.unit, &plan, &fact, &w.line, &pending)
			w.plan, w.fact, w.pending = milli(plan), milli(fact), milli(pending)
			return w.project, w, err
		}, ids)
}

func (r *req) factPending(ctx context.Context, f *facts, ids []uuid.UUID) error {
	return group(ctx, r.tx, "pending logs", `select g.project_id, g.id, g.number, coalesce(w.name, ''), coalesce(l.unit, ''), coalesce((l.quantity * 1000)::bigint, 0)
		from repairs.work_logs g
		left join lateral (select * from repairs.work_log_lines where work_log_id = g.id order by line_no limit 1) l on true
		left join repairs.works w on w.id = l.work_id
		where g.project_id = any($1) and g.status = 'submitted' order by g.created_at, g.id`, f.pending,
		func(rows pgx.Rows) (uuid.UUID, pendingLog, error) {
			var (
				k   uuid.UUID
				l   pendingLog
				qty int64
			)
			err := rows.Scan(&k, &l.id, &l.number, &l.work, &l.unit, &qty)
			l.qty = milli(qty)
			return k, l, err
		}, ids)
}

func (r *req) factSupply(ctx context.Context, f *facts, ids []uuid.UUID) error {
	rows, err := r.tx.Query(ctx, `select project_id, count(*) from repairs.supply_requests where project_id = any($1) and state = 'request' group by project_id`, ids)
	if err != nil {
		return store("supply requests", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			project uuid.UUID
			n       int
		)
		if err := rows.Scan(&project, &n); err != nil {
			return store("supply requests", err)
		}
		f.supply[project] = n
	}
	return store("supply requests", rows.Err())
}
