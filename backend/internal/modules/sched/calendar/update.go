package calendar

import (
	"context"
	"fmt"
	"net/http"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	calendarapi "github.com/ortus/ortus-crm/backend/internal/api/calendar"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W4.40: shared command helpers of the modules (Audit, Complete; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the reschedule (MSW calendar/index.ts).
const (
	textTimeAndResources = "Укажите новое время и ресурсы."
	textWindowOrder      = "Конец брони раньше начала."
	textUnknownResource  = "Ресурс не найден."
	textResourceTwice    = "Ресурс указан дважды."
	textOutOfWorkday     = "Время вне рабочего дня ресурса."
	textUnknownZone      = "Неизвестный часовой пояс."
	textReasonLong       = "Причина — не длиннее 1000 символов."
	textConflict         = "Конфликт ресурсов"
)

// Audit names of the calendar.
const (
	targetBooking     = "sched.booking"
	actionRescheduled = "calendar.booking.rescheduled"
	actionCancelled   = "calendar.booking.cancelled"
	maxReason         = 1000
)

// Update reschedules or cancels a confirmed booking (updateCalendarBooking, moveBooking of the prototype). A booking
// the member does not read — 404; the lock permission — 403; any other lock — 409 invalid_transition with the text of
// the prototype; then If-Match. The reschedule rechecks every resource of the booking with the buffers under the locks
// of the resources and changes nothing on a conflict (409 resources_unavailable with the items of bookingConflicts).
func (s *Service) Update(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, p calendarapi.BookingPatch) (calendarapi.Booking, error) {
	var out calendarapi.Booking
	err := s.run(ctx, tc, true, func(r *request) error {
		v, err := r.newView(ctx, actionRead)
		if err != nil {
			return err
		}
		b, err := v.readable(ctx, id, true)
		if err != nil {
			return err
		}
		lock, err := v.lockOf(ctx, b)
		switch {
		case err != nil:
			return err
		case lock == string(calendarapi.Permission):
			return problem.New(problem.CodeForbiddenAction, "")
		case lock != "":
			return problem.New(codeInvalidTransition, lockTexts[lock])
		}
		if err := checkRevision(ifMatch, b.revision); err != nil {
			return err
		}
		switch p.Action {
		case calendarapi.Cancel:
			out, err = v.cancel(ctx, b, p.Reason)
		case calendarapi.Reschedule:
			out, err = v.reschedule(ctx, b, p)
		default:
			return problem.New(problem.CodeMalformedRequest, "")
		}
		if err != nil {
			return err
		}
		return kit.Complete(ctx, r.tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// moved is a checked reschedule: the window, its occupancy and the resources in the order of the patch.
type moved struct {
	start, end time.Time
	occupied   span
	resources  []*resource
}

// check validates the patch against the view: a window and resources, the order of the window, every resource seen
// by the member with its kind and given once, the occupancy inside the workday of every resource.
func (v *view) check(b *booking, p calendarapi.BookingPatch) (moved, error) {
	if p.Window == nil {
		return moved{}, invalid("window", "required", textTimeAndResources)
	}
	if p.Resources == nil || len(*p.Resources) == 0 {
		return moved{}, invalid("resources", "required", textTimeAndResources)
	}
	m := moved{start: p.Window.StartsAt.UTC(), end: p.Window.EndsAt.UTC()}
	if !m.start.Before(m.end) {
		return moved{}, invalid("window", "range", textWindowOrder)
	}
	if _, err := time.LoadLocation(p.Window.TimeZone); err != nil || p.Window.TimeZone == "" || strings.EqualFold(p.Window.TimeZone, "local") {
		return moved{}, invalid("window.timeZone", "zone", textUnknownZone)
	}
	var err error
	if m.resources, err = v.selection(*p.Resources); err != nil {
		return moved{}, err
	}
	m.occupied = occupiedOf(m.start, m.end, b.prep, b.cleanup)
	for _, res := range m.resources {
		if !res.day.holds(m.occupied) {
			return moved{}, invalid("window", "workday", textOutOfWorkday)
		}
	}
	return m, nil
}

// selection resolves the resources of a patch: each one seen by the member with its kind and given once.
func (v *view) selection(sels []calendarapi.ResourceSelection) ([]*resource, error) {
	out := make([]*resource, 0, len(sels))
	for i, sel := range sels {
		field := "resources[" + strconv.Itoa(i) + "]"
		res := v.byID[sel.ResourceId]
		if res == nil || !v.visible[res.id] || apiKind(res.kind) != string(sel.Kind) {
			return nil, invalid(field, "unknown", textUnknownResource)
		}
		if slices.Contains(out, res) {
			return nil, invalid(field, "duplicate", textResourceTwice)
		}
		out = append(out, res)
	}
	return out, nil
}

func (m moved) ids() []uuid.UUID {
	out := make([]uuid.UUID, 0, len(m.resources))
	for _, res := range m.resources {
		out = append(out, res.id)
	}
	return out
}

// reschedule moves b (a booking of sched.bookings without a lock) to the window and resources of p in the transaction
// of the request: it locks the resources of both sets in the order of their ids (the order of sched.Hold), expires
// the ended holds of them, checks the occupancy against the live rows of other bundles, then moves the rows: the kept
// resources get the new window, the removed ones are released, the added ones are held as confirmed.
func (v *view) reschedule(ctx context.Context, b *booking, p calendarapi.BookingPatch) (calendarapi.Booking, error) {
	m, err := v.check(b, p)
	if err != nil {
		return calendarapi.Booking{}, err
	}
	r := v.r
	ids := m.ids()
	locked := append(slices.Clone(ids), b.resources...)
	if _, err := r.tx.Exec(ctx, `select id from sched.resources where id = any($1) order by id for update`, locked); err != nil {
		return calendarapi.Booking{}, fmt.Errorf("calendar: lock resources: %w", err)
	}
	if _, err := r.tx.Exec(ctx, `update sched.reservations set state = 'expired', revision = revision + 1
		 where resource_id = any($1) and state = 'hold' and hold_expires_at <= $2`, locked, r.now); err != nil {
		return calendarapi.Booking{}, fmt.Errorf("calendar: expire holds: %w", err)
	}
	if err := v.conflicts(ctx, b, m); err != nil {
		return calendarapi.Booking{}, err
	}
	if err := v.move(ctx, b, m); err != nil {
		return calendarapi.Booking{}, err
	}
	diff := map[string]any{
		"from":      map[string]string{"startsAt": stamp(b.start), "endsAt": stamp(b.end)},
		"to":        map[string]string{"startsAt": stamp(m.start), "endsAt": stamp(m.end)},
		"resources": ids,
	}
	if err := kit.Audit(ctx, r.tx, audit.Event{Action: actionRescheduled, TargetType: targetBooking, TargetID: b.id,
		UnitID: b.unit, Diff: diff}); err != nil {
		return calendarapi.Booking{}, err
	}
	bs, err := r.loadBookings(ctx, bookingWhere{ids: []uuid.UUID{b.id}})
	if err != nil || len(bs) == 0 {
		return calendarapi.Booking{}, fmt.Errorf("calendar: reread booking: %w", err)
	}
	v.complete(bs[0])
	return v.dto(ctx, bs[0])
}

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// clashSQL finds the live rows of other bundles on the resources $2 whose occupancy meets [$4, $5).
const clashSQL = `select x.bundle_id, x.resource_id from sched.reservations x
 where x.resource_id = any($2) and x.bundle_id <> $3 and x.occupied && tstzrange($4, $5, '[)') and ` + liveX

// conflicts is the 409 of the reschedule when the occupancy of m meets a live row of another bundle on one of its
// resources: the items of bookingConflicts — the other bookings in the order of creation, their resources in their
// order, the title only when the member reads the other booking.
func (v *view) conflicts(ctx context.Context, b *booking, m moved) error {
	busy, err := v.r.busyPairs(ctx, b.id, m)
	if err != nil || len(busy) == 0 {
		return err
	}
	clashes, err := v.clashes(ctx, busy)
	if err != nil {
		return err
	}
	names := map[uuid.UUID]string{}
	for _, res := range m.resources {
		names[res.id] = res.name
	}
	if e := conflicts(m.ids(), names, clashes); e != nil {
		return e
	}
	return nil
}

// busyPairs is the resources of m each other bundle holds live in the occupancy of m: bundle → resources.
func (r *request) busyPairs(ctx context.Context, self uuid.UUID, m moved) (map[uuid.UUID]map[uuid.UUID]bool, error) {
	rows, err := r.tx.Query(ctx, clashSQL, r.now, m.ids(), self, m.occupied.from, m.occupied.to)
	if err != nil {
		return nil, fmt.Errorf("calendar: conflicts: %w", err)
	}
	defer rows.Close()
	busy := map[uuid.UUID]map[uuid.UUID]bool{}
	for rows.Next() {
		var bundle, res uuid.UUID
		if err := rows.Scan(&bundle, &res); err != nil {
			return nil, fmt.Errorf("calendar: conflicts: %w", err)
		}
		if busy[bundle] == nil {
			busy[bundle] = map[uuid.UUID]bool{}
		}
		busy[bundle][res] = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("calendar: conflicts: %w", err)
	}
	return busy, nil
}

// clashes orders the other bundles by creation (then id) with their busy resources in their own order.
func (v *view) clashes(ctx context.Context, busy map[uuid.UUID]map[uuid.UUID]bool) ([]clash, error) {
	others := make([]uuid.UUID, 0, len(busy))
	for id := range busy {
		others = append(others, id)
	}
	bs, err := v.r.loadBookings(ctx, bookingWhere{ids: others})
	if err != nil {
		return nil, err
	}
	found := map[uuid.UUID]*booking{}
	for _, o := range bs {
		v.complete(o)
		found[o.id] = o
	}
	slices.SortFunc(others, func(x, y uuid.UUID) int {
		if ox, oy := found[x], found[y]; ox != nil && oy != nil {
			if c := ox.created.Compare(oy.created); c != 0 {
				return c
			}
		}
		return slices.Compare(x[:], y[:])
	})
	out := make([]clash, 0, len(others))
	for _, id := range others {
		c := clash{}
		if o := found[id]; o != nil {
			if c.readable, err = v.canRead(ctx, o); err != nil {
				return nil, err
			}
			c.title = o.title
			c.resources = slices.DeleteFunc(slices.Clone(o.resources), func(res uuid.UUID) bool { return !busy[id][res] })
		}
		if len(c.resources) < len(busy[id]) { // a row the booking does not list (it ended meanwhile): by id
			for _, res := range sortedIDs(busy[id]) {
				if !slices.Contains(c.resources, res) {
					c.resources = append(c.resources, res)
				}
			}
		}
		out = append(out, c)
	}
	return out, nil
}

// sortedIDs is the keys of set in the order of their bytes.
func sortedIDs(set map[uuid.UUID]bool) []uuid.UUID {
	out := make([]uuid.UUID, 0, len(set))
	for id := range set {
		out = append(out, id)
	}
	slices.SortFunc(out, func(x, y uuid.UUID) int { return slices.Compare(x[:], y[:]) })
	return out
}

// move writes the reschedule: the rows of the kept resources get the window, the removed ones are released, the
// added ones are inserted as confirmed (the source of the rows of the booking), and the booking gets the window and a
// new revision.
func (v *view) move(ctx context.Context, b *booking, m moved) error {
	r := v.r
	ids := m.ids()
	if _, err := r.tx.Exec(ctx, `update sched.reservations set state = 'released', revision = revision + 1
		 where bundle_id = $1 and state = 'confirmed' and resource_id <> all($2)`, b.id, ids); err != nil {
		return fmt.Errorf("calendar: release removed resources: %w", err)
	}
	if _, err := r.tx.Exec(ctx, `update sched.reservations
		   set during = tstzrange($3, $4, '[)'), occupied = tstzrange($5, $6, '[)'), revision = revision + 1
		 where bundle_id = $1 and state = 'confirmed' and resource_id = any($2)`,
		b.id, ids, m.start, m.end, m.occupied.from, m.occupied.to); err != nil {
		return overlapOr(err, "calendar: move reservations")
	}
	added := slices.DeleteFunc(slices.Clone(ids), func(id uuid.UUID) bool { return slices.Contains(b.resources, id) })
	if len(added) > 0 {
		if _, err := r.tx.Exec(ctx, `insert into sched.reservations (resource_id, bundle_id, during, occupied, state, source_type,
			source_id, created_by)
			select a, $1, tstzrange($3, $4, '[)'), tstzrange($5, $6, '[)'), 'confirmed', $7, $1, $8 from unnest($2::uuid[]) as a`,
			b.id, added, m.start, m.end, m.occupied.from, m.occupied.to, targetBooking, r.tc.PersonID); err != nil {
			return overlapOr(err, "calendar: hold added resources")
		}
	}
	if _, err := r.tx.Exec(ctx, `update sched.bookings set during = tstzrange($2, $3, '[)'), revision = revision + 1, updated_at = $4
		 where id = $1`, b.id, m.start, m.end, r.now); err != nil {
		return fmt.Errorf("calendar: move booking: %w", err)
	}
	return nil
}

// overlapOr is 409 resources_unavailable when err is the exclusion of overlapping reservations (a row the check did
// not see; the locks of the resources make it unreachable), else err wrapped.
func overlapOr(err error, what string) error {
	if isOverlap(err) {
		return problem.New(codeResourcesUnavailable, textConflict)
	}
	return fmt.Errorf("%s: %w", what, err)
}

// cancel cancels b: the booking is cancelled with the reason, its live reservations are released and the resources
// are free at once.
func (v *view) cancel(ctx context.Context, b *booking, reason *string) (calendarapi.Booking, error) {
	r := v.r
	var why *string
	if reason != nil && strings.TrimSpace(*reason) != "" {
		t := strings.TrimSpace(*reason)
		if utf8.RuneCountInString(t) > maxReason {
			return calendarapi.Booking{}, invalid("reason", "range", textReasonLong)
		}
		why = &t
	}
	var rev int64
	if err := r.tx.QueryRow(ctx, `update sched.bookings set status = 'cancelled', cancel_reason = $2, revision = revision + 1,
		updated_at = $3 where id = $1 returning revision`, b.id, why, r.now).Scan(&rev); err != nil {
		return calendarapi.Booking{}, fmt.Errorf("calendar: cancel booking: %w", err)
	}
	if _, err := r.tx.Exec(ctx, `update sched.reservations x set state = 'released', revision = revision + 1
		 where x.bundle_id = $2 and `+liveX, r.now, b.id); err != nil {
		return calendarapi.Booking{}, fmt.Errorf("calendar: release reservations: %w", err)
	}
	diff := map[string]any{"window": map[string]string{"startsAt": stamp(b.start), "endsAt": stamp(b.end)}}
	reasonText := ""
	if why != nil {
		reasonText = *why
	}
	if err := kit.Audit(ctx, r.tx, audit.Event{Action: actionCancelled, TargetType: targetBooking, TargetID: b.id,
		UnitID: b.unit, Reason: reasonText, Diff: diff}); err != nil {
		return calendarapi.Booking{}, err
	}
	b.status, b.revision = statusCancelled, rev
	return v.dtoWith(b, ""), nil
}
