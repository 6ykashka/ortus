package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	api "github.com/ortus/ortus-crm/backend/internal/api/service"
)

// Exec runs a statement of the tenant DB (the transaction of the seed, a connection of a test).
type Exec func(ctx context.Context, sql string, args ...any) error

// TokenDigest is the digest the server keeps of a token of the portal: sha256:hex(SHA-256(token)).
func TokenDigest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return "sha256:" + hex.EncodeToString(sum[:])
}

// DemoToken is the personal link of a request of the demo: the same as the mock of the front (portalToken of
// msw/service) gives, so that the pages of the portal open the same requests on the stand.
func DemoToken(request uuid.UUID) string {
	return "tok_" + strings.ReplaceAll(request.String(), "-", "") + "z"
}

// DemoTokenExpires is the end of the links of the demo.
var DemoTokenExpires = time.Date(2027, time.December, 31, 0, 0, 0, 0, Moscow)

// calendarIDs maps the seed calendars to the prototype ids of the demo.
var calendarIDs = []string{keySpa, keyRep, keyLog}

// WriteDemo writes the demo data (Demo) into the tenant DB through ex: the calendars, the directions with the version
// 1, the teams, the types, the templates, the clients, the ratings, the requests with their timers, details, feed and
// personal links. The rows already there are kept (a second run changes nothing).
func WriteDemo(ctx context.Context, ex Exec, id DemoIDs) error {
	d := Demo(id)
	w := writer{ex: ex}
	cals := SeedCalendars()
	for _, k := range calendarIDs {
		c := cals[k]
		w.do(ctx, `insert into service.calendars (id, name, days, time_from, time_to, time_zone) values ($1, $2, $3, make_interval(mins => $4)::time,
			make_interval(mins => $5)::time, 'Europe/Moscow') on conflict (id) do nothing`, id("cal-"+k), c.Label, isoDays(c.Days), c.From, c.To)
	}
	for _, dir := range d.Directions {
		w.direction(ctx, dir, id)
	}
	for _, t := range d.Types {
		w.do(ctx, `insert into service.request_types (id, direction_id, kind, name, first_minutes, resolve_minutes, legal_days, priority)
			values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (direction_id, id) do nothing`,
			t.ID, t.DirectionID, t.Kind, t.Name, t.Goals.First, t.Goals.Resolve, t.Goals.Legal, t.Priority)
	}
	for _, dir := range d.Directions {
		for _, t := range d.Templates {
			w.do(ctx, `insert into service.reply_templates (id, direction_id, name, text) values ($1, $2, $3, $4) on conflict do nothing`, t.ID, dir.ID, t.Name, t.Text)
		}
	}
	for _, c := range d.Clients {
		w.do(ctx, `insert into service.clients (id, name, company, phone, since, created_at) values ($1, $2, nullif($3, ''), $4, $5::timestamptz::date, $5::timestamptz)
			on conflict (id) do nothing`, c.ID, c.Name, c.Company, c.Phone, c.CreatedAt)
	}
	for _, rq := range d.Requests {
		w.request(ctx, rq)
	}
	for _, x := range d.Ratings {
		w.do(ctx, `insert into service.ratings (id, direction_id, request_id, client_id, score, reasons, comment, work, status, at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict (id) do nothing`,
			x.ID, x.DirectionID, nullID(x.RequestID), x.ClientID, x.Score, x.Reasons, x.Comment, x.Work, x.Status, x.At)
	}
	for _, rq := range d.Requests {
		w.do(ctx, `insert into service.portal_tokens (id, request_id, token_digest, expires_at, created_at) values ($1, $2, $3, $4, $5)
			on conflict (token_digest) do nothing`, id("token:"+rq.ID.String()), rq.ID, TokenDigest(DemoToken(rq.ID)), DemoTokenExpires, rq.CreatedAt)
	}
	return w.err
}

// DemoTokens are the links of the demo: the digest, the request and the token row, for the index of the control DB.
func DemoTokens(id DemoIDs) []TokenRow {
	var out []TokenRow
	for _, rq := range Demo(id).Requests {
		out = append(out, TokenRow{Digest: TokenDigest(DemoToken(rq.ID)), Request: rq.ID, ID: id("token:" + rq.ID.String()), KeyVersion: 1, ExpiresAt: DemoTokenExpires})
	}
	return out
}

func isoDays(days []int) []int16 {
	out := make([]int16, 0, len(days))
	for _, d := range days {
		out = append(out, int16(d+1)) //nolint:gosec // weekdays 0…6
	}
	return out
}

type writer struct {
	ex  Exec
	err error
}

func (w *writer) do(ctx context.Context, sql string, args ...any) {
	if w.err != nil {
		return
	}
	if err := w.ex(ctx, sql, args...); err != nil {
		w.err = fmt.Errorf("service: demo: %w", err)
	}
}

func (w *writer) direction(ctx context.Context, d Direction, id DemoIDs) {
	w.do(ctx, `insert into service.directions (id, key, name, color, module_key, area_label, org_unit_id, project_id, calendar_id, lead_id, next_number,
		public_slug, status, version) values ($1, $2, $3, $4, $5, $6, null, $7, $8, $9, $10, $11, 'active', 1) on conflict (id) do nothing`,
		d.ID, d.Key, d.Name, d.Color, d.ModuleKey, d.AreaLabel, d.ProjectID, d.CalendarID, d.LeadID, d.Next, nullStr(d.PublicSlug))
	body, _ := json.Marshal(api.ServiceDirectionBody{Name: d.Name, Color: d.Color, Calendar: calendarDTO(d.Calendar)}) //nolint:errchkjson // plain fields
	w.do(ctx, `insert into service.direction_versions (direction_id, number, body, published_by, published_at) values ($1, 1, $2, $3, $4) on conflict do nothing`,
		d.ID, body, d.LeadID, DemoBase)
	if d.LeadID != nil {
		w.do(ctx, `insert into service.direction_team (direction_id, member_id, role) values ($1, $2, 'lead') on conflict do nothing`, d.ID, *d.LeadID)
	}
	if d.ID == id("d-grz") {
		for _, m := range []string{"m-kotova", "m-kotelnikova"} {
			w.do(ctx, `insert into service.direction_team (direction_id, member_id, role) values ($1, $2, 'specialist') on conflict do nothing`, d.ID, id(m))
		}
	}
}

func nullStr(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func (w *writer) request(ctx context.Context, rq DemoRequest) {
	x := rq.Request
	var resolved any
	if x.ResolvedAt != nil {
		resolved = *x.ResolvedAt
	}
	w.do(ctx, `insert into service.requests (id, direction_id, number, key, kind, type_id, title, status, priority, assignee_id, client_id, channel, link_ref,
		labels, outcome, about_member_id, from_rating_id, created_at, resolved_at, updated_at, revision)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, nullif($15, ''), $16, $17, $18, $19, $18, 1) on conflict (id) do nothing`,
		x.ID, x.DirectionID, x.Number, x.Key, x.Kind, x.TypeID, x.Title, x.Status, x.Priority, nullID(x.Assignee), x.Client.ID, x.Channel,
		jsonOrNil(x.Link), nonNil(x.Labels), x.Outcome, nullID(x.About), nullID(rq.RatingID), x.CreatedAt, resolved)
	details, _ := json.Marshal(x.Details) //nolint:errchkjson // plain fields
	w.do(ctx, `insert into service.request_details (request_id, details) values ($1, $2) on conflict do nothing`, x.ID, details)
	for _, p := range []struct {
		target string
		t      *Timer
	}{{targetFirst, x.SLA.First}, {targetRes, x.SLA.Resolve}, {targetLegal, x.SLA.Legal}} {
		if p.t == nil {
			continue
		}
		var paused any
		if x.PausedAt != nil && p.target != targetLegal && p.t.Stopped == nil {
			paused = *x.PausedAt
		}
		w.do(ctx, `insert into service.sla_timers (request_id, target, goal_minutes, due_at, paused_at, stopped_at) values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
			x.ID, p.target, p.t.Goal, p.t.Due, paused, p.t.Stopped)
	}
	for _, m := range rq.Messages {
		var score, channel, delivery any
		if m.Score > 0 {
			score = m.Score
		}
		if m.Channel != "" {
			channel = m.Channel
		}
		if m.Delivery != "" {
			delivery = m.Delivery
		}
		files := m.Files
		if files == nil {
			files = []uuid.UUID{}
		}
		w.do(ctx, `insert into service.messages (id, request_id, kind, author_id, text, channel, auto, delivery, score, reasons, contact, files, at)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) on conflict (id) do nothing`,
			m.ID, x.ID, m.Kind, nullID(m.Author), m.Text, channel, m.Auto, delivery, score, m.Reasons, m.Contact, files, m.At)
	}
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}
