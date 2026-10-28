package service

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

const directionSQL = `select d.id, d.key, d.name, d.color, d.module_key, d.area_label, d.org_unit_id, d.project_id,
	coalesce(d.calendar_id, '00000000-0000-0000-0000-000000000000'::uuid), d.lead_id, d.next_number, coalesce(d.public_slug, ''),
	d.status, d.version,
	coalesce(c.days, '{1,2,3,4,5}'::smallint[]), coalesce((extract(epoch from c.time_from) / 60)::int, 540),
	coalesce((extract(epoch from c.time_to) / 60)::int, 1140), coalesce(c.name, ''), coalesce(c.time_zone, 'Europe/Moscow')
  from service.directions d left join service.calendars c on c.id = d.calendar_id`

// directions loads the directions that match where (a condition over d, may be empty) ordered by key.
func (r *req) directions(ctx context.Context, where string, args ...any) ([]Direction, error) {
	if where != "" {
		where = " where " + where
	}
	rows, err := r.tx.Query(ctx, directionSQL+where+" order by d.key, d.id", args...)
	if err != nil {
		return nil, store("directions", err)
	}
	defer rows.Close()
	var out []Direction
	for rows.Next() {
		var (
			d        Direction
			days     []int16
			from, to int
			zone     string
		)
		if err := rows.Scan(&d.ID, &d.Key, &d.Name, &d.Color, &d.ModuleKey, &d.AreaLabel, &d.OrgUnitID, &d.ProjectID, &d.CalendarID, &d.LeadID,
			&d.Next, &d.PublicSlug, &d.Status, &d.Version, &days, &from, &to, &d.Calendar.Label, &zone); err != nil {
			return nil, store("direction", err)
		}
		d.Calendar.Days = make([]int, 0, len(days))
		for _, x := range days {
			d.Calendar.Days = append(d.Calendar.Days, int(x)-1) // ISO 1 = Monday in the database, 0 in the domain
		}
		d.Calendar.From, d.Calendar.To, d.Calendar.Zone = from, to, LoadZone(zone)
		if d.CalendarID == uuid.Nil {
			d.Calendar.Label = "пн–пт 9:00–19:00"
		}
		out = append(out, d)
	}
	return out, store("directions", rows.Err())
}

// direction loads one direction by id (nil — none); lock takes the row for update (the counter of numbers).
func (r *req) direction(ctx context.Context, id uuid.UUID, lock bool) (*Direction, error) {
	if lock {
		if _, err := r.tx.Exec(ctx, `select 1 from service.directions where id = $1 for update`, id); err != nil {
			return nil, store("lock direction", err)
		}
	}
	list, err := r.directions(ctx, "d.id = $1", id)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return &list[0], nil
}

// types loads the types of the directions.
func (r *req) types(ctx context.Context, dirs []uuid.UUID) ([]Type, error) {
	rows, err := r.tx.Query(ctx, `select id, direction_id, kind, name, first_minutes, resolve_minutes, legal_days, priority
		from service.request_types where direction_id = any($1)
		order by direction_id, array_position(array['complaint','claim','question','idea','thanks','warranty','cargo'], kind), id`, dirs)
	if err != nil {
		return nil, store("types", err)
	}
	defer rows.Close()
	var out []Type
	for rows.Next() {
		var t Type
		if err := rows.Scan(&t.ID, &t.DirectionID, &t.Kind, &t.Name, &t.Goals.First, &t.Goals.Resolve, &t.Goals.Legal, &t.Priority); err != nil {
			return nil, store("type", err)
		}
		out = append(out, t)
	}
	return out, store("types", rows.Err())
}

const requestSQL = `select r.id, r.direction_id, r.number, r.key, r.kind, coalesce(r.type_id, ''), r.title, r.status, r.priority, r.assignee_id,
	r.channel, r.link_ref, r.labels, coalesce(r.outcome, ''), coalesce(r.compensation, ''), r.shared, r.about_member_id,
	coalesce(fr.score, 0), r.created_at, r.resolved_at, r.updated_at, r.revision,
	c.id, c.name, coalesce(c.company, ''), c.phone, c.opted_out, c.since::timestamptz, c.created_at, coalesce(rd.details, '{}')
  from service.requests r
  join service.clients c on c.id = r.client_id
  left join service.ratings fr on fr.id = r.from_rating_id
  left join service.request_details rd on rd.request_id = r.id`

// requests loads the requests that match where (a condition over r, c, may be empty) with the timers and the old keys.
func (r *req) requests(ctx context.Context, where string, args ...any) ([]*Request, error) {
	if where != "" {
		where = " where " + where
	}
	rows, err := r.tx.Query(ctx, requestSQL+where+" order by r.created_at desc, r.id", args...)
	if err != nil {
		return nil, store("requests", err)
	}
	var out []*Request
	for rows.Next() {
		x, err := scanRequest(rows)
		if err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, x)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, store("requests", err)
	}
	return out, r.attach(ctx, out)
}

type scanner interface{ Scan(dest ...any) error }

func scanRequest(rows scanner) (*Request, error) {
	var (
		x                     Request
		assignee, about       *uuid.UUID
		link, shared, details []byte
	)
	if err := rows.Scan(&x.ID, &x.DirectionID, &x.Number, &x.Key, &x.Kind, &x.TypeID, &x.Title, &x.Status, &x.Priority, &assignee,
		&x.Channel, &link, &x.Labels, &x.Outcome, &x.Compensation, &shared, &about, &x.FromRating, &x.CreatedAt, &x.ResolvedAt,
		&x.UpdatedAt, &x.Revision, &x.Client.ID, &x.Client.Name, &x.Client.Company, &x.Client.Phone, &x.Client.OptedOut,
		&x.Client.Since, &x.Client.CreatedAt, &details); err != nil {
		return nil, store("request", err)
	}
	if assignee != nil {
		x.Assignee = *assignee
	}
	if about != nil {
		x.About = *about
	}
	if err := unjson(link, &x.Link); err != nil {
		return nil, err
	}
	if err := unjson(shared, &x.Shared); err != nil {
		return nil, err
	}
	if err := unjson(details, &x.Details); err != nil {
		return nil, err
	}
	if x.Labels == nil {
		x.Labels = []string{}
	}
	return &x, nil
}

func unjson(b []byte, v any) error {
	if len(b) == 0 || string(b) == "null" {
		return nil
	}
	if err := json.Unmarshal(b, v); err != nil {
		return fmt.Errorf("service: json: %w", err)
	}
	return nil
}

// attach puts the timers and the old keys into the requests.
func (r *req) attach(ctx context.Context, list []*Request) error {
	if len(list) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(list))
	byID := make(map[uuid.UUID]*Request, len(list))
	for _, x := range list {
		ids = append(ids, x.ID)
		byID[x.ID] = x
	}
	rows, err := r.tx.Query(ctx, `select request_id, target, coalesce(goal_minutes, 0), due_at, paused_at, stopped_at from service.sla_timers
		where request_id = any($1)`, ids)
	if err != nil {
		return store("timers", err)
	}
	for rows.Next() {
		var (
			id     uuid.UUID
			target string
			t      Timer
			paused *time.Time
		)
		if err := rows.Scan(&id, &target, &t.Goal, &t.Due, &paused, &t.Stopped); err != nil {
			rows.Close()
			return store("timer", err)
		}
		x := byID[id]
		switch target {
		case targetFirst:
			x.SLA.First = &t
		case targetRes:
			x.SLA.Resolve = &t
		case targetLegal:
			x.SLA.Legal = &t
		}
		if paused != nil && target != targetLegal {
			x.PausedAt = paused
		}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return store("timers", err)
	}
	return r.aliases(ctx, ids, byID)
}

func (r *req) aliases(ctx context.Context, ids []uuid.UUID, byID map[uuid.UUID]*Request) error {
	rows, err := r.tx.Query(ctx, `select request_id, key from service.key_aliases where request_id = any($1) order by created_at, key`, ids)
	if err != nil {
		return store("aliases", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id  uuid.UUID
			key string
		)
		if err := rows.Scan(&id, &key); err != nil {
			return store("alias", err)
		}
		byID[id].OldKeys = append(byID[id].OldKeys, key)
	}
	return store("aliases", rows.Err())
}

// request loads one request by id (nil — none); lock takes its row for update.
func (r *req) request(ctx context.Context, id uuid.UUID, lock bool) (*Request, error) {
	if lock {
		if _, err := r.tx.Exec(ctx, `select 1 from service.requests where id = $1 for update`, id); err != nil {
			return nil, store("lock request", err)
		}
	}
	list, err := r.requests(ctx, "r.id = $1", id)
	if err != nil || len(list) == 0 {
		return nil, err
	}
	return list[0], nil
}

// messages loads the feed of a request.
func (r *req) messages(ctx context.Context, request uuid.UUID) ([]Message, error) {
	rows, err := r.tx.Query(ctx, `select id, request_id, kind, author_id, text, coalesce(channel, ''), auto, coalesce(delivery, ''),
		coalesce(score, 0), reasons, contact, files, at from service.messages where request_id = $1 order by at, seq`, request)
	if err != nil {
		return nil, store("messages", err)
	}
	defer rows.Close()
	var out []Message
	for rows.Next() {
		var (
			m      Message
			author *uuid.UUID
		)
		if err := rows.Scan(&m.ID, &m.RequestID, &m.Kind, &author, &m.Text, &m.Channel, &m.Auto, &m.Delivery, &m.Score, &m.Reasons,
			&m.Contact, &m.Files, &m.At); err != nil {
			return nil, store("message", err)
		}
		if author != nil {
			m.Author = *author
		}
		out = append(out, m)
	}
	return out, store("messages", rows.Err())
}

// names are the full names of people by id.
func (r *req) names(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]string, error) {
	out := map[uuid.UUID]string{}
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := r.tx.Query(ctx, `select id, full_name from people.person_profiles where id = any($1)`, ids)
	if err != nil {
		return nil, store("names", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id   uuid.UUID
			name string
		)
		if err := rows.Scan(&id, &name); err != nil {
			return nil, store("name", err)
		}
		out[id] = name
	}
	return out, store("names", rows.Err())
}

func (r *req) name(ctx context.Context, id uuid.UUID) (string, error) {
	m, err := r.names(ctx, []uuid.UUID{id})
	return m[id], err
}

// insertMessage writes a message of a request.
func (r *req) insertMessage(ctx context.Context, m Message) error {
	if m.ID == uuid.Nil {
		m.ID = uuid.New()
	}
	if m.At.IsZero() {
		m.At = r.now
	}
	if m.Reasons == nil {
		m.Reasons = []string{}
	}
	if m.Files == nil {
		m.Files = []uuid.UUID{}
	}
	var author, score, channel, delivery any
	if m.Author != uuid.Nil {
		author = m.Author
	}
	if m.Score > 0 {
		score = m.Score
	}
	if m.Channel != "" {
		channel = m.Channel
	}
	if m.Delivery != "" {
		delivery = m.Delivery
	}
	_, err := r.tx.Exec(ctx, `insert into service.messages (id, request_id, kind, author_id, text, channel, auto, delivery, score, reasons,
		contact, files, at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
		m.ID, m.RequestID, m.Kind, author, m.Text, channel, m.Auto, delivery, score, m.Reasons, m.Contact, m.Files, m.At)
	return store("insert message", err)
}

// system writes a system record of the feed.
func (r *req) system(ctx context.Context, request uuid.UUID, text string) error {
	return r.insertMessage(ctx, Message{RequestID: request, Kind: "system", Text: text})
}

func jsonOrNil(v any) any {
	if v == nil {
		return nil
	}
	b, err := json.Marshal(v)
	if err != nil || string(b) == "null" {
		return nil
	}
	return b
}

// save writes the changes of a request: the columns, the details and the timers; the revision grows by one.
func (r *req) save(ctx context.Context, x *Request) error {
	var assignee, about, resolved any
	if x.Assignee != uuid.Nil {
		assignee = x.Assignee
	}
	if x.About != uuid.Nil {
		about = x.About
	}
	if x.ResolvedAt != nil {
		resolved = *x.ResolvedAt
	}
	var link, shared any
	if x.Link != nil {
		link = jsonOrNil(x.Link)
	}
	if x.Shared != nil {
		shared = jsonOrNil(x.Shared)
	}
	x.Revision++
	x.UpdatedAt = r.now
	if x.Labels == nil {
		x.Labels = []string{}
	}
	if _, err := r.tx.Exec(ctx, `update service.requests set direction_id = $2, number = $3, key = $4, kind = $5, type_id = nullif($6, ''),
		title = $7, status = $8, priority = $9, assignee_id = $10, link_ref = $11, labels = $12, outcome = nullif($13, ''),
		compensation = nullif($14, ''), shared = $15, about_member_id = $16, resolved_at = $17, updated_at = $18, revision = $19 where id = $1`,
		x.ID, x.DirectionID, x.Number, x.Key, x.Kind, x.TypeID, x.Title, x.Status, x.Priority, assignee, link, x.Labels, x.Outcome,
		x.Compensation, shared, about, resolved, x.UpdatedAt, x.Revision); err != nil {
		return store("update request", err)
	}
	if err := r.saveDetails(ctx, x); err != nil {
		return err
	}
	return r.saveTimers(ctx, x)
}

func (r *req) saveDetails(ctx context.Context, x *Request) error {
	b, err := json.Marshal(x.Details)
	if err != nil {
		return fmt.Errorf("service: details: %w", err)
	}
	_, err = r.tx.Exec(ctx, `insert into service.request_details (request_id, details) values ($1, $2)
		on conflict (request_id) do update set details = excluded.details`, x.ID, b)
	return store("details", err)
}

func (r *req) saveTimers(ctx context.Context, x *Request) error {
	for _, p := range []struct {
		target string
		t      *Timer
	}{{targetFirst, x.SLA.First}, {targetRes, x.SLA.Resolve}, {targetLegal, x.SLA.Legal}} {
		if p.t == nil {
			if _, err := r.tx.Exec(ctx, `delete from service.sla_timers where request_id = $1 and target = $2`, x.ID, p.target); err != nil {
				return store("drop timer", err)
			}
			continue
		}
		var paused any
		if x.PausedAt != nil && p.target != targetLegal && p.t.Stopped == nil {
			paused = *x.PausedAt
		}
		if _, err := r.tx.Exec(ctx, `insert into service.sla_timers (request_id, target, goal_minutes, due_at, paused_at, stopped_at)
			values ($1, $2, $3, $4, $5, $6)
			on conflict (request_id, target) do update set goal_minutes = excluded.goal_minutes, due_at = excluded.due_at,
			  paused_at = excluded.paused_at, stopped_at = excluded.stopped_at`,
			x.ID, p.target, p.t.Goal, p.t.Due, paused, p.t.Stopped); err != nil {
			return store("timer", err)
		}
	}
	return nil
}
