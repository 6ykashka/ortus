package calendar

import (
	"encoding/base64"
	"errors"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/google/uuid"

	calendarapi "github.com/ortus/ortus-crm/backend/internal/api/calendar"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Kinds of a resource in sched.resources.kind; the contract names a person «member».
const (
	kindVehicle   = "vehicle"
	kindPerson    = "person"
	kindRoom      = "room"
	kindEquipment = "equipment"
	apiMember     = "member"
)

// kindOrder is the order of the kinds in lists — the order of the seed of the prototype (vehicle, member, room,
// equipment) — and of the resources within a booking (sched.reservations keeps no position).
var kindOrder = []string{kindVehicle, kindPerson, kindRoom, kindEquipment}

// apiKind is CalendarResource.kind of a kind of sched.resources.
func apiKind(db string) string {
	if db == kindPerson {
		return apiMember
	}
	return db
}

// dbKind is the kind of sched.resources of a kind of the contract.
func dbKind(api string) (string, bool) {
	switch api {
	case apiMember:
		return kindPerson, true
	case kindVehicle, kindRoom, kindEquipment:
		return api, true
	}
	return "", false
}

// kindRank is the place of a kind in kindOrder (an unknown kind goes last).
func kindRank(db string) int {
	if i := slices.Index(kindOrder, db); i >= 0 {
		return i
	}
	return len(kindOrder)
}

// span is a half-open interval [from, to).
type span struct{ from, to time.Time }

func (s span) overlaps(o span) bool { return s.from.Before(o.to) && o.from.Before(s.to) }

// occupiedOf is the window the resources of a booking are busy: start − prep … end + cleanup (busySpan of the
// prototype; the hatched buffer «подготовка и уборка — ресурс занят»).
func occupiedOf(start, end time.Time, prep, cleanup int) span {
	return span{start.Add(-time.Duration(prep) * time.Minute), end.Add(time.Duration(cleanup) * time.Minute)}
}

var errClock = errors.New("calendar: clock is not HH:MM")

// parseClock reads «HH:MM» or «HH:MM:SS» (the text of a time column) as the offset from midnight.
func parseClock(s string) (time.Duration, error) {
	parts := strings.Split(s, ":")
	if len(parts) < 2 || len(parts) > 3 || len(parts[0]) != 2 || len(parts[1]) != 2 {
		return 0, fmt.Errorf("%w: %q", errClock, s)
	}
	var d time.Duration
	units := []time.Duration{time.Hour, time.Minute, time.Second}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil || n < 0 {
			return 0, fmt.Errorf("%w: %q", errClock, s)
		}
		d += time.Duration(n) * units[i]
	}
	return d, nil
}

// formatClock writes an offset from midnight as «HH:MM» (CalendarWorkday).
func formatClock(d time.Duration) string {
	m := int(d / time.Minute)
	return fmt.Sprintf("%02d:%02d", m/60, m%60)
}

// workday is the working day of a resource (CAL-05): the local start and end in the zone of the resource.
type workday struct {
	start, end time.Duration
	loc        *time.Location
}

// midnight is the start of the local day of t in loc.
func midnight(t time.Time, loc *time.Location) time.Time {
	l := t.In(loc)
	return time.Date(l.Year(), l.Month(), l.Day(), 0, 0, 0, 0, loc)
}

// at is the workday of the local date of day (a midnight in any zone) in the zone of the resource.
func (w workday) at(day time.Time) span {
	d := time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, w.loc)
	return span{d.Add(w.start), d.Add(w.end)}
}

// on is the workday of the local day of t in the zone of the resource.
func (w workday) on(t time.Time) span { return w.at(midnight(t, w.loc)) }

// holds reports whether occ lies inside the workday of the local day of its start (with the buffers).
func (w workday) holds(occ span) bool {
	d := w.on(occ.from)
	return !occ.from.Before(d.from) && !occ.to.After(d.to)
}

// nameLess orders labels like the calendar of the prototype (localeCompare 'ru'): case-insensitive, Cyrillic before
// Latin, digits and spaces first, «ё» right after «е»; equal labels — by their bytes.
func nameLess(a, b string) bool {
	ra, rb := []rune(a), []rune(b)
	for i := 0; i < len(ra) && i < len(rb); i++ {
		ka, kb := collationKey(ra[i]), collationKey(rb[i])
		if ka != kb {
			return ka < kb
		}
	}
	if len(ra) != len(rb) {
		return len(ra) < len(rb)
	}
	return a < b
}

// collationKey is the weight of a rune: its class (spaces and punctuation, digits, Cyrillic, Latin, the rest) and the
// lowercase rune; «ё» sorts after «е» and before «ж».
func collationKey(r rune) int64 {
	r = unicode.ToLower(r)
	var class int64
	switch {
	case unicode.IsSpace(r), unicode.IsPunct(r), unicode.IsSymbol(r):
		class = 0
	case unicode.IsDigit(r):
		class = 1
	case unicode.Is(unicode.Cyrillic, r):
		class = 2
	case unicode.Is(unicode.Latin, r):
		class = 3
	default:
		class = 4
	}
	weight := int64(r) * 2
	if r == 'ё' {
		weight = int64('е')*2 + 1
	}
	return class<<40 | weight
}

// week is the longest window of listCalendarBookings (a week of the calendar).
const week = 7 * 24 * time.Hour

// Texts of the window of listCalendarBookings (MSW calendar/index.ts).
const (
	textPeriodBoth  = "Укажите начало и конец периода."
	textPeriodOrder = "Конец периода раньше начала."
	textPeriodWeek  = "Период не длиннее 7 дней."
)

// listWindow is the window of listCalendarBookings: from and to, or — without both — the day of now in the zone of
// the organization; only one of them, a reversed or a longer than a week window — 422.
func listWindow(from, to *time.Time, now time.Time, loc *time.Location) (span, error) {
	switch {
	case from == nil && to == nil:
		d := midnight(now, loc)
		return span{d, d.AddDate(0, 0, 1)}, nil
	case from == nil:
		return span{}, invalid("from", "required", textPeriodBoth)
	case to == nil:
		return span{}, invalid("to", "required", textPeriodBoth)
	case !from.Before(*to):
		return span{}, invalid("to", "range", textPeriodOrder)
	case to.Sub(*from) > week:
		return span{}, invalid("to", "range", textPeriodWeek)
	}
	return span{*from, *to}, nil
}

// Problem codes of the tag (api/errors.yaml).
const (
	codeValidation           = "validation_failed"
	codeInvalidTransition    = "invalid_transition"
	codeResourcesUnavailable = "resources_unavailable"
	codeRevisionRequired     = "revision_required"
	codeRevisionMismatch     = "revision_mismatch"
	codeIdemInProgress       = "idempotency_in_progress"
)

// fieldsError is a Problem with violations (Problem.violations): 422 validation_failed of a field, 409
// resources_unavailable of the busy resources. Unwrap gives the plain Problem for answers without violations.
type fieldsError struct {
	code, detail string
	violations   []calendarapi.ProblemViolation
}

func (e *fieldsError) Error() string { return e.code + ": " + e.detail }

func (e *fieldsError) Unwrap() error { return problem.New(e.code, e.detail) }

// invalid is 422 validation_failed of one field with the message as the detail.
func invalid(field, code, message string) *fieldsError {
	return &fieldsError{code: codeValidation, detail: message,
		violations: []calendarapi.ProblemViolation{{Field: field, Code: code, Message: message}}}
}

func asFields(err error) (*fieldsError, bool) { return errors.AsType[*fieldsError](err) }

// problemCode is Problem.code of err ("" — none).
func problemCode(err error) string {
	if e, ok := errors.AsType[*problem.Error](err); ok {
		return e.Code
	}
	return ""
}

// etag is the ETag of a booking revision — "rev-N", the form of the mock (getCalendarBooking, If-Match of the
// reschedule).
func etag(revision int64) string { return `"rev-` + strconv.FormatInt(revision, 10) + `"` }

// textStale is the 412 of a stale If-Match.
const textStale = "Данные изменились. Обновите страницу и повторите."

// checkRevision compares If-Match with the current revision: missing — 428, anything else than its ETag — 412.
func checkRevision(ifMatch string, current int64) error {
	switch v := strings.TrimSpace(ifMatch); {
	case v == "":
		return problem.New(codeRevisionRequired, "")
	case v != etag(current):
		return problem.New(codeRevisionMismatch, textStale)
	}
	return nil
}

// clash is another booking whose occupancy meets the reschedule: its title, whether the member reads it and its
// resources in its own order.
type clash struct {
	title     string
	readable  bool
	resources []uuid.UUID
}

// conflicts is the 409 resources_unavailable of a reschedule (bookingConflicts of the prototype, models.js:395): an
// item per pair «other booking × resource it shares with moved», the other bookings in the order given (of creation),
// within one the resources in its order; the title of the other booking only when the member reads it. nil — no item.
func conflicts(moved []uuid.UUID, names map[uuid.UUID]string, others []clash) *fieldsError {
	var items []calendarapi.ProblemViolation
	for _, o := range others {
		for _, id := range o.resources {
			i := slices.Index(moved, id)
			if i < 0 {
				continue
			}
			msg := names[id] + " занят"
			if o.readable {
				msg += " («" + o.title + "»)"
			}
			items = append(items, calendarapi.ProblemViolation{Field: "resources[" + strconv.Itoa(i) + "]", Code: "busy", Message: msg})
		}
	}
	if len(items) == 0 {
		return nil
	}
	texts := make([]string, 0, len(items))
	for _, v := range items {
		texts = append(texts, v.Message)
	}
	return &fieldsError{code: codeResourcesUnavailable, detail: "Конфликт ресурсов: " + strings.Join(texts, "; "), violations: items}
}

// slotResource is a candidate resource of a requirement group.
type slotResource struct {
	id   uuid.UUID
	kind string
	day  workday
}

// slotGroup is a requirement of findCalendarAvailability: count resources of its candidates.
type slotGroup struct {
	kind      string
	count     int
	resources []slotResource
}

// slotQuery is a search of free slots: the window to search, the zone of its days, the duration and the step of a
// slot, the buffers, the most slots and the start not to offer (the current start of the rescheduled booking).
type slotQuery struct {
	window         span
	loc            *time.Location
	duration, step time.Duration
	prep, cleanup  time.Duration
	max            int
	current        *time.Time
}

// slot is a free start with the resources picked for it.
type slot struct {
	start, end time.Time
	resources  []slotResource
}

// freeSlots is freeSlots of the prototype: for every day of the window (at most a week) the starts every step from the
// latest start of the workdays of all resources plus the preparation, while the end plus the cleanup stays inside the
// earliest end; a start is free when every group has count candidates whose occupancy (start − prep … end + cleanup)
// busy does not report. Slots go by start, at most q.max.
func freeSlots(q slotQuery, groups []slotGroup, busy func(uuid.UUID, span) bool) []slot {
	var out []slot
	if q.step <= 0 || q.duration <= 0 || q.max <= 0 {
		return out
	}
	var all []slotResource
	for _, g := range groups {
		all = append(all, g.resources...)
	}
	limit := q.window.from.Add(week)
	for day := midnight(q.window.from, q.loc); day.Before(q.window.to) && day.Before(limit) && len(out) < q.max; day = day.AddDate(0, 0, 1) {
		out = q.daySlots(out, commonDay(day, all), groups, busy)
	}
	return out
}

// commonDay is the part of the local day starting at day inside the workdays of all resources.
func commonDay(day time.Time, all []slotResource) span {
	bounds := span{day, day.AddDate(0, 0, 1)}
	for _, r := range all {
		w := r.day.at(day)
		if w.from.After(bounds.from) {
			bounds.from = w.from
		}
		if w.to.Before(bounds.to) {
			bounds.to = w.to
		}
	}
	return bounds
}

// daySlots appends to out the free starts of one day bounded by bounds, up to q.max slots in all.
func (q slotQuery) daySlots(out []slot, bounds span, groups []slotGroup, busy func(uuid.UUID, span) bool) []slot {
	for t := bounds.from.Add(q.prep); !t.Add(q.duration+q.cleanup).After(bounds.to) && len(out) < q.max; t = t.Add(q.step) {
		if t.Before(q.window.from) || t.Add(q.duration).After(q.window.to) || (q.current != nil && t.Equal(*q.current)) {
			continue
		}
		if picked, ok := pick(groups, span{t.Add(-q.prep), t.Add(q.duration + q.cleanup)}, busy); ok {
			out = append(out, slot{start: t, end: t.Add(q.duration), resources: picked})
		}
	}
	return out
}

// pick takes count free candidates of every group for occ; false when a group lacks them.
func pick(groups []slotGroup, occ span, busy func(uuid.UUID, span) bool) ([]slotResource, bool) {
	var picked []slotResource
	for _, g := range groups {
		n := 0
		for _, r := range g.resources {
			if n == g.count {
				break
			}
			if !busy(r.id, occ) {
				picked = append(picked, r)
				n++
			}
		}
		if n < g.count {
			return nil, false
		}
	}
	return picked, true
}

// slotToken is AvailabilitySlot.availabilityToken — a freshness hint, not an authorization: base64 of
// «a.<booking>.<start>» without padding, as the mock («-» without a booking).
func slotToken(booking uuid.UUID, start time.Time) string {
	id := "-"
	if booking != uuid.Nil {
		id = booking.String()
	}
	return base64.RawStdEncoding.EncodeToString([]byte("a." + id + "." + start.UTC().Format(time.RFC3339)))
}
