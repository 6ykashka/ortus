package calendar

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	calendarapi "github.com/ortus/ortus-crm/backend/internal/api/calendar"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// ResourceQuery is the query of listCalendarResources.
type ResourceQuery struct {
	Kind    *string    // kind of the contract: member, room, vehicle, equipment
	OrgUnit *uuid.UUID // with its descendants
	Cursor  *string
	Limit   *int
}

// BookingQuery is the query of listCalendarBookings.
type BookingQuery struct {
	From, To *time.Time
	Kind     *string    // a booking holding a visible resource of this kind
	OrgUnit  *uuid.UUID // a booking holding a visible resource of this unit or of its descendants
	Resource *uuid.UUID // a booking holding this resource
	Cursor   *string
	Limit    *int
}

// Page sizes (common/parameters.yaml Limit).
const (
	defaultLimit = 50
	maxLimit     = 200
)

// Resources lists the resources the member sees (listCalendarResources): by kind, then label; an inactive one only
// while it holds a booking that ends after now.
func (s *Service) Resources(ctx context.Context, tc tenantctx.TenantContext, q ResourceQuery) (calendarapi.CalendarResourcePage, error) {
	out := calendarapi.CalendarResourcePage{Items: []calendarapi.CalendarResource{}}
	kind, err := kindParam(q.Kind)
	if err != nil {
		return out, err
	}
	limit, err := pageLimit(q.Limit)
	if err != nil {
		return out, err
	}
	err = s.run(ctx, tc, false, func(r *request) error {
		v, err := r.newView(ctx, actionRead)
		if err != nil {
			return err
		}
		units, err := r.subtree(ctx, q.OrgUnit)
		if err != nil {
			return err
		}
		var items []calendarapi.CalendarResource
		for _, res := range v.all {
			listed := v.visible[res.id] && (res.active || res.future)
			if !listed || (kind != "" && res.kind != kind) || (units != nil && !units[res.unit]) {
				continue
			}
			items = append(items, v.resourceDTO(res))
		}
		binding := bindingOf(tc.TenantID, tc.PersonID, "resources", kind, q.OrgUnit)
		out.Items, out.NextCursor, err = pageOf(items, q.Cursor, limit, binding)
		return err
	})
	return out, err
}

// Bookings lists the bookings of a day or a week the member reads (listCalendarBookings): their occupancy meets the
// window; by start, then id.
func (s *Service) Bookings(ctx context.Context, tc tenantctx.TenantContext, q BookingQuery) (calendarapi.BookingPage, error) {
	out := calendarapi.BookingPage{Items: []calendarapi.Booking{}}
	kind, err := kindParam(q.Kind)
	if err != nil {
		return out, err
	}
	limit, err := pageLimit(q.Limit)
	if err != nil {
		return out, err
	}
	err = s.run(ctx, tc, false, func(r *request) error {
		loc, err := r.zoneOf(ctx)
		if err != nil {
			return err
		}
		window, err := listWindow(q.From, q.To, r.now, loc)
		if err != nil {
			return err
		}
		v, err := r.newView(ctx, actionRead)
		if err != nil {
			return err
		}
		units, err := r.subtree(ctx, q.OrgUnit)
		if err != nil {
			return err
		}
		all, err := r.loadBookings(ctx, bookingWhere{window: &window})
		if err != nil {
			return err
		}
		items, err := v.pick(ctx, all, bookingFilter{kind: kind, units: units, resource: q.Resource, window: window})
		if err != nil {
			return err
		}
		binding := bindingOf(tc.TenantID, tc.PersonID, "bookings", window.from.Unix(), window.to.Unix(), kind, q.OrgUnit, q.Resource)
		out.Items, out.NextCursor, err = pageOf(items, q.Cursor, limit, binding)
		return err
	})
	return out, err
}

// pick is the bookings of all the member reads and f keeps, by start, then id.
func (v *view) pick(ctx context.Context, all []*booking, f bookingFilter) ([]calendarapi.Booking, error) {
	var picked []*booking
	for _, b := range all {
		v.complete(b)
		ok, err := v.canRead(ctx, b)
		if err != nil {
			return nil, err
		}
		if ok && f.keeps(v, b) {
			picked = append(picked, b)
		}
	}
	slices.SortFunc(picked, func(a, b *booking) int {
		if c := a.start.Compare(b.start); c != 0 {
			return c
		}
		return slices.Compare(a.id[:], b.id[:])
	})
	items := make([]calendarapi.Booking, 0, len(picked))
	for _, b := range picked {
		d, err := v.dto(ctx, b)
		if err != nil {
			return nil, err
		}
		items = append(items, d)
	}
	return items, nil
}

// bookingFilter is the filters of listCalendarBookings over the visible resources of a booking.
type bookingFilter struct {
	kind     string
	units    map[uuid.UUID]bool
	resource *uuid.UUID
	window   span
}

func (f bookingFilter) keeps(v *view, b *booking) bool {
	if !b.occupied.overlaps(f.window) {
		return false
	}
	match := func(cond func(*resource) bool) bool {
		return slices.ContainsFunc(b.resources, func(id uuid.UUID) bool {
			res := v.byID[id]
			return res != nil && v.visible[id] && cond(res)
		})
	}
	switch {
	case f.kind != "" && !match(func(r *resource) bool { return r.kind == f.kind }):
		return false
	case f.units != nil && !match(func(r *resource) bool { return f.units[r.unit] }):
		return false
	case f.resource != nil && !match(func(r *resource) bool { return r.id == *f.resource }):
		return false
	}
	return true
}

// Booking reads a booking the member reads (getCalendarBooking); any other id — 404 «Бронь не найдена.».
func (s *Service) Booking(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (calendarapi.Booking, error) {
	var out calendarapi.Booking
	err := s.run(ctx, tc, false, func(r *request) error {
		v, err := r.newView(ctx, actionRead)
		if err != nil {
			return err
		}
		b, err := v.readable(ctx, id, false)
		if err != nil {
			return err
		}
		out, err = v.dto(ctx, b)
		return err
	})
	return out, err
}

// readable reads booking id (lock: its row for the command) when the member reads it; otherwise 404.
func (v *view) readable(ctx context.Context, id uuid.UUID, lock bool) (*booking, error) {
	bs, err := v.r.loadBookings(ctx, bookingWhere{ids: []uuid.UUID{id}, lock: lock})
	if err != nil {
		return nil, err
	}
	for _, b := range bs {
		v.complete(b)
		ok, err := v.canRead(ctx, b)
		if err != nil {
			return nil, err
		}
		if ok {
			return b, nil
		}
	}
	return nil, problem.New(problem.CodeNotFound, textBookingNotFound)
}

// subtree is the unit with its descendants (org.unit_closure); nil — no filter. An unknown unit has itself only.
func (r *request) subtree(ctx context.Context, unit *uuid.UUID) (map[uuid.UUID]bool, error) {
	if unit == nil {
		return nil, nil
	}
	rows, err := r.tx.Query(ctx, `select descendant_id from org.unit_closure where ancestor_id = $1`, *unit)
	if err != nil {
		return nil, fmt.Errorf("calendar: units: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, fmt.Errorf("calendar: units: %w", err)
	}
	out := map[uuid.UUID]bool{*unit: true}
	for _, id := range ids {
		out[id] = true
	}
	return out, nil
}

// kindParam is the kind of sched.resources of a kind of the contract; anything else — 400.
func kindParam(k *string) (string, error) {
	if k == nil {
		return "", nil
	}
	if db, ok := dbKind(*k); ok {
		return db, nil
	}
	return "", problem.New(problem.CodeMalformedRequest, "Неизвестный вид ресурса.")
}

// pageLimit is the page size: 50 when absent, 1…200 otherwise.
func pageLimit(p *int) (int, error) {
	if p == nil {
		return defaultLimit, nil
	}
	if *p < 1 || *p > maxLimit {
		return 0, problem.New(problem.CodeMalformedRequest, fmt.Sprintf("limit: 1…%d", maxLimit))
	}
	return *p, nil
}

// cursor is the position of a page (the offset of its first item) and the fingerprint of the selection it continues:
// the tenant, the member and the filters (contract: «bound to tenant, principal, effective scopes, filters and sort»).
type cursor struct {
	Offset  int    `json:"o"`
	Binding string `json:"b"`
}

const textBadCursor = "Неверный курсор страницы."

func bindingOf(parts ...any) string {
	raw, err := json.Marshal(parts)
	if err != nil { // ids, strings, numbers and nil pointers always marshal
		panic("calendar: binding: " + err.Error())
	}
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:12])
}

// pageOf is the page of items after the cursor; a cursor of another selection — 400 malformed_request.
func pageOf[T any](items []T, cur *string, limit int, binding string) ([]T, *string, error) {
	from := 0
	if cur != nil {
		raw, err := base64.RawURLEncoding.DecodeString(*cur)
		var c cursor
		if err != nil || json.Unmarshal(raw, &c) != nil || c.Offset < 0 || c.Binding != binding {
			return nil, nil, problem.New(problem.CodeMalformedRequest, textBadCursor)
		}
		from = c.Offset
	}
	from = min(from, len(items))
	to := min(from+limit, len(items))
	page := slices.Clone(items[from:to])
	if page == nil {
		page = []T{}
	}
	if to >= len(items) {
		return page, nil, nil
	}
	raw, _ := json.Marshal(cursor{Offset: to, Binding: binding}) // an int and a string always marshal
	next := base64.RawURLEncoding.EncodeToString(raw)
	return page, &next, nil
}
