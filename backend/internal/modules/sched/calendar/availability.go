package calendar

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	calendarapi "github.com/ortus/ortus-crm/backend/internal/api/calendar"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Bounds of a search of slots.
const (
	maxMinutes      = 24 * 60
	maxBuffer       = 240 // sched.bookings: prep_minutes, cleanup_minutes
	defaultMaxSlots = 20  // MSW
	maxSlotsLimit   = 100
	tokenTTL        = 5 * time.Minute // AvailabilitySlot.tokenExpiresAt
)

// Texts of the checks of a search of slots.
const (
	textDuration     = "Длительность — от 1 до 1440 минут."
	textStep         = "Шаг — от 1 до 1440 минут."
	textSlotWindow   = "Конец окна раньше начала."
	textBuffer       = "Подготовка и уборка — от 0 до 240 минут."
	textMaxSlots     = "Слотов — от 1 до 100."
	textRequirements = "Укажите ресурсы."
	textCount        = "Нужно ресурсов — от 1 до числа указанных."
)

// checkQuery checks the numbers of a search of slots (the bodies the schema of the contract does not bound).
func checkQuery(q calendarapi.AvailabilityQuery) error {
	if err := checkNumbers(q); err != nil {
		return err
	}
	if _, err := time.LoadLocation(q.Window.TimeZone); err != nil || q.Window.TimeZone == "" || strings.EqualFold(q.Window.TimeZone, "local") {
		return invalid("window.timeZone", "zone", textUnknownZone)
	}
	for i, g := range q.Requirements {
		if g.RequiredCount < 1 || g.RequiredCount > len(g.ResourceIds) {
			return invalid("requirements["+strconv.Itoa(i)+"].requiredCount", "range", textCount)
		}
	}
	return nil
}

// checkNumbers checks the duration, the step, the window, the buffers, the most slots and that there are requirements.
func checkNumbers(q calendarapi.AvailabilityQuery) error {
	inRange := func(p *int, lo, hi int) bool { return p == nil || (*p >= lo && *p <= hi) }
	switch {
	case q.DurationMinutes < 1 || q.DurationMinutes > maxMinutes:
		return invalid("durationMinutes", "range", textDuration)
	case q.StepMinutes < 1 || q.StepMinutes > maxMinutes:
		return invalid("stepMinutes", "range", textStep)
	case !q.Window.StartsAt.Before(q.Window.EndsAt):
		return invalid("window", "range", textSlotWindow)
	case !inRange(q.PrepMinutes, 0, maxBuffer):
		return invalid("prepMinutes", "range", textBuffer)
	case !inRange(q.CleanupMinutes, 0, maxBuffer):
		return invalid("cleanupMinutes", "range", textBuffer)
	case !inRange(q.MaxSlots, 1, maxSlotsLimit):
		return invalid("maxSlots", "range", textMaxSlots)
	case len(q.Requirements) == 0:
		return invalid("requirements", "required", textRequirements)
	}
	return nil
}

func orZero(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}

// Availability finds the free slots for all resources of the requirements (findCalendarAvailability, freeSlots of the
// prototype): the resources are those the member sees through calendar.availability.read; excludeBookingId — a
// booking it reads (otherwise 404), whose own rows never make a resource busy and whose start is not offered. Every
// live row of another bundle makes its resource busy, whoever may read it.
func (s *Service) Availability(ctx context.Context, tc tenantctx.TenantContext, q calendarapi.AvailabilityQuery) (calendarapi.AvailabilityResult, error) {
	out := calendarapi.AvailabilityResult{Slots: []calendarapi.AvailabilitySlot{}}
	if err := checkQuery(q); err != nil {
		return out, err
	}
	err := s.run(ctx, tc, false, func(r *request) error {
		var exists bool
		if err := r.tx.QueryRow(ctx, `select exists (select 1 from org.units where id = $1)`, q.OrgUnitId).Scan(&exists); err != nil {
			return fmt.Errorf("calendar: unit: %w", err)
		}
		if !exists {
			return problem.New(problem.CodeNotFound, textUnitNotFound)
		}
		v, err := r.newView(ctx, actionAvailability)
		if err != nil {
			return err
		}
		sq := slotQuery{
			window: span{q.Window.StartsAt, q.Window.EndsAt}, loc: location(q.Window.TimeZone),
			duration: time.Duration(q.DurationMinutes) * time.Minute, step: time.Duration(q.StepMinutes) * time.Minute,
			prep: time.Duration(orZero(q.PrepMinutes)) * time.Minute, cleanup: time.Duration(orZero(q.CleanupMinutes)) * time.Minute,
			max: defaultMaxSlots,
		}
		if q.MaxSlots != nil {
			sq.max = *q.MaxSlots
		}
		except := uuid.Nil
		if q.ExcludeBookingId != nil {
			b, err := r.excluded(ctx, *q.ExcludeBookingId)
			if err != nil {
				return err
			}
			except, sq.current = b.id, &b.start
		}
		groups, err := v.groups(q.Requirements)
		if err != nil {
			return err
		}
		busy, err := r.busy(ctx, groups, except, sq)
		if err != nil {
			return err
		}
		for _, sl := range freeSlots(sq, groups, busy) {
			sel := make([]calendarapi.ResourceSelection, 0, len(sl.resources))
			for _, res := range sl.resources {
				sel = append(sel, calendarapi.ResourceSelection{Kind: calendarapi.ResourceSelectionKind(apiKind(res.kind)), ResourceId: res.id})
			}
			out.Slots = append(out.Slots, calendarapi.AvailabilitySlot{
				Window:            calendarapi.TimeWindow{StartsAt: sl.start.UTC(), EndsAt: sl.end.UTC(), TimeZone: q.Window.TimeZone},
				Resources:         sel,
				AvailabilityToken: slotToken(except, sl.start),
				TokenExpiresAt:    r.now.Add(tokenTTL),
			})
		}
		out.CalculatedAt = r.now
		return nil
	})
	return out, err
}

// excluded reads the booking of a reschedule the member reads through calendar.bookings.read; otherwise 404.
func (r *request) excluded(ctx context.Context, id uuid.UUID) (*booking, error) {
	v, err := r.newView(ctx, actionRead)
	if err != nil {
		return nil, err
	}
	return v.readable(ctx, id, false)
}

// groups resolves the requirements against the resources the member sees; another id or a kind that does not match —
// 422 of its place.
func (v *view) groups(reqs []calendarapi.ResourceRequirement) ([]slotGroup, error) {
	out := make([]slotGroup, 0, len(reqs))
	for gi, g := range reqs {
		kind, ok := dbKind(string(g.Kind))
		if !ok {
			return nil, invalid("requirements["+strconv.Itoa(gi)+"].kind", "unknown", textUnknownResource)
		}
		group := slotGroup{kind: kind, count: g.RequiredCount}
		for i, id := range g.ResourceIds {
			res := v.byID[id]
			if res == nil || !v.visible[id] || res.kind != kind {
				return nil, invalid("requirements["+strconv.Itoa(gi)+"].resourceIds["+strconv.Itoa(i)+"]", "unknown", textUnknownResource)
			}
			group.resources = append(group.resources, slotResource{id: id, kind: kind, day: res.day})
		}
		out = append(out, group)
	}
	return out, nil
}

// busy reads the live rows of other bundles on the resources of groups around the window of the search and answers
// whether a resource is busy for an occupancy.
func (r *request) busy(ctx context.Context, groups []slotGroup, except uuid.UUID, q slotQuery) (func(uuid.UUID, span) bool, error) {
	var ids []uuid.UUID
	for _, g := range groups {
		for _, res := range g.resources {
			ids = append(ids, res.id)
		}
	}
	rows, err := r.tx.Query(ctx, `select x.resource_id, lower(x.occupied), upper(x.occupied) from sched.reservations x
		 where x.resource_id = any($2) and x.bundle_id <> $3 and x.occupied && tstzrange($4, $5, '[)') and `+liveX,
		r.now, ids, except, q.window.from.Add(-24*time.Hour), q.window.to.Add(24*time.Hour))
	if err != nil {
		return nil, fmt.Errorf("calendar: busy: %w", err)
	}
	defer rows.Close()
	taken := map[uuid.UUID][]span{}
	for rows.Next() {
		var (
			id  uuid.UUID
			occ span
		)
		if err := rows.Scan(&id, &occ.from, &occ.to); err != nil {
			return nil, fmt.Errorf("calendar: busy: %w", err)
		}
		taken[id] = append(taken[id], occ)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("calendar: busy: %w", err)
	}
	return func(id uuid.UUID, occ span) bool {
		for _, t := range taken[id] {
			if t.overlaps(occ) {
				return true
			}
		}
		return false
	}, nil
}
