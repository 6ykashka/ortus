package spa

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	api "github.com/ortus/ortus-crm/backend/internal/api/spa"
	"github.com/ortus/ortus-crm/backend/internal/modules/inventory" //nolint:depguard // W5.20: the stock core of the same stage (Q-W5.20-2)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const (
	textNotInStatus = "Визит уже не в том статусе, из которого возможно это действие."
	textPerformedAt = "Время выполнения — не раньше начала визита и не позже текущего момента."
	textFinalPrice  = "Цена по факту — копейки от 0 в валюте услуги."
	textWarehouse   = "Укажите склад списания."
	textOverrideQty = "Фактическое количество — число с точностью до шести знаков."
)

// errNoStock is a service wired without the stock: a programming error of the assembly.
var errNoStock = errors.New("spa: the stock is not wired")

// notInStatus is the refusal of an action a visit cannot take in its status.
func notInStatus() *RefusalError { return conflict(ReasonNotInStatus, textNotInStatus) }

// move writes the new status and the revision of a visit read for update.
func move(ctx context.Context, tx pgx.Tx, v visit, status string, set string, args ...any) (visit, error) {
	q := `update spa.appointments set status = $2, revision = revision + 1` + set + ` where id = $1`
	if _, err := tx.Exec(ctx, q, append([]any{v.Id, status}, args...)...); err != nil {
		return visit{}, fmt.Errorf("spa: update visit: %w", err)
	}
	out, err := scanVisit(tx.QueryRow(ctx, apptSelect+` where a.id = $1`, v.Id))
	if err != nil {
		return visit{}, fmt.Errorf("spa: read back visit: %w", err)
	}
	return out, nil
}

func cleanReason(raw string) (string, error) {
	r := strings.TrimSpace(raw)
	switch {
	case r == "":
		return "", invalid("reason", textReason)
	case utf8.RuneCountInString(r) > 500:
		return "", invalid("reason", textReasonLong)
	}
	return r, nil
}

// Cancel cancels a confirmed visit, or marks the client as not come (cancelAppointment): the booking is cancelled and
// the practitioner, the room and the equipment are free at once.
func (s *Service) Cancel(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b api.AppointmentCancel) (api.Appointment, error) {
	reason, err := cleanReason(b.Reason)
	if err != nil {
		return api.Appointment{}, err
	}
	action := ActionCancel
	if b.NoShow != nil && *b.NoShow {
		action = ActionNoShow
	}
	var out api.Appointment
	err = s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		v, err := lockVisit(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := permitVisit(ctx, ev, tc, actApptCreate, v); err != nil {
			return err
		}
		next, ok := NextStatus(string(v.Status), action)
		if !ok {
			return notInStatus()
		}
		if err := checkRevision(ifMatch, v.Revision); err != nil {
			return err
		}
		if err := releaseBooking(ctx, tx, v.BookingId, reason, s.now()); err != nil {
			return err
		}
		moved, err := move(ctx, tx, v, next, `, cancel_reason = $3`, reason)
		if err != nil {
			return err
		}
		out = moved.Appointment
		if err := recordAudit(ctx, tx, tc, "spa.appointment."+action, targetAppointment, id, v.OrgUnitId, reason,
			map[string]any{"status": next, "startsAt": v.Window.StartsAt}); err != nil {
			return err
		}
		if err := publish(ctx, tx, "spa.appointment.cancelled.v1", moved); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// movedResources are the resources of a visit after a move: those of the request over those it has. A practitioner
// taken over needs the right to book him, as at the booking.
func movedResources(ctx context.Context, tx pgx.Tx, ev Authorizer, tc tenantctx.TenantContext, v visit, b api.AppointmentReschedule) (resources, error) {
	res := resources{practitioner: v.PractitionerMemberId, room: v.RoomId, equipment: v.EquipmentIds}
	if b.PractitionerMemberId != nil && *b.PractitionerMemberId != v.PractitionerMemberId {
		res.practitioner = *b.PractitionerMemberId
		taken := visit{Appointment: api.Appointment{OrgUnitId: v.OrgUnitId, PractitionerMemberId: res.practitioner}}
		if err := permitVisit(ctx, ev, tc, actApptCreate, taken); err != nil {
			return res, err
		}
	}
	if b.RoomId != nil {
		res.room = *b.RoomId
	}
	if b.EquipmentIds != nil {
		res.equipment = idList(*b.EquipmentIds)
	}
	return res, checkBooking(ctx, tx, v.OrgUnitId, v.snap, res)
}

// Reschedule moves a confirmed visit to another time or resources (rescheduleAppointment): every resource is booked
// again with the buffers of the snapshot of the visit under the locks of both sets; a conflict changes nothing.
func (s *Service) Reschedule(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b api.AppointmentReschedule) (api.Appointment, error) {
	if err := checkWhen(b.TimeZone, b.StartsAt); err != nil {
		return api.Appointment{}, err
	}
	var out api.Appointment
	err := s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		v, err := lockVisit(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := permitVisit(ctx, ev, tc, actApptCreate, v); err != nil {
			return err
		}
		if _, ok := NextStatus(string(v.Status), ActionReschedule); !ok {
			return notInStatus()
		}
		if err := checkRevision(ifMatch, v.Revision); err != nil {
			return err
		}
		res, err := movedResources(ctx, tx, ev, tc, v, b)
		if err != nil {
			return err
		}
		old, err := bookingResources(ctx, tx, v.BookingId)
		if err != nil {
			return err
		}
		window, occupied := Plan(b.StartsAt.UTC(), v.snap.DurationMinutes, v.snap.BufferBeforeMinutes, v.snap.BufferAfterMinutes)
		req := bookingRequest{id: v.BookingId, visit: v.Id, unit: v.OrgUnitId, title: v.snap.Name, window: window, occupied: occupied, zone: b.TimeZone,
			before: v.snap.BufferBeforeMinutes, after: v.snap.BufferAfterMinutes, createdBy: tc.PersonID, now: s.now(), res: res}
		if err := moveBooking(ctx, tx, req, old); err != nil {
			return err
		}
		moved, err := move(ctx, tx, v, statusConfirmed, `, practitioner_id = $3, room_id = $4, equipment_ids = $5, starts_at = $6, ends_at = $7, time_zone = $8`,
			res.practitioner, res.room, res.equipment, window.From, window.To, b.TimeZone)
		if err != nil {
			return err
		}
		out = moved.Appointment
		if err := recordAudit(ctx, tx, tc, "spa.appointment.reschedule", targetAppointment, id, v.OrgUnitId, "",
			map[string]any{"from": v.Window.StartsAt, "to": window.From, "practitionerId": res.practitioner}); err != nil {
			return err
		}
		if err := publish(ctx, tx, "spa.appointment.rescheduled.v1", moved); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// noteOf is the clean note of a command, nil when there is none.
func noteOf(raw *string) *string {
	if raw == nil || strings.TrimSpace(*raw) == "" {
		return nil
	}
	n := strings.TrimSpace(*raw)
	return &n
}

// clockSkew is how far ahead of the server clock a device clock may be when it records a treatment.
const clockSkew = 5 * time.Minute

// RecordPerformance records that the treatment happened (recordAppointmentPerformance), apart from the accounting: the
// visit moves to performed_pending_posting, no material and no money is posted. A repeat creates no second fact.
func (s *Service) RecordPerformance(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b api.AppointmentPerformance) (api.Appointment, error) {
	var out api.Appointment
	err := s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		v, err := lockVisit(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := permitVisit(ctx, ev, tc, actApptPerform, v); err != nil {
			return err
		}
		if v.Status == api.AppointmentStatusPerformedPendingPosting || v.Status == api.AppointmentStatusCompleted {
			out = v.Appointment // the fact is recorded already: a repeat is the same answer
			return nil
		}
		if _, ok := NextStatus(string(v.Status), ActionPerform); !ok {
			return notInStatus()
		}
		if err := checkRevision(ifMatch, v.Revision); err != nil {
			return err
		}
		at := b.PerformedAt.UTC()
		if at.Before(v.Window.StartsAt) || at.After(s.now().Add(clockSkew)) {
			return invalid("performedAt", textPerformedAt)
		}
		moved, err := move(ctx, tx, v, statusPerformed, `, performed_at = $3, performance_note = $4`, at, noteOf(b.Note))
		if err != nil {
			return err
		}
		out = moved.Appointment
		if err := recordAudit(ctx, tx, tc, "spa.appointment.perform", targetAppointment, id, v.OrgUnitId, "", map[string]any{"performedAt": at}); err != nil {
			return err
		}
		if err := publish(ctx, tx, "spa.appointment.performed.v1", moved); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, err
}

// recipeOf is the recipe of the snapshot of the visit.
func recipeOf(snap api.SpaService) ([]RecipeLine, error) {
	out := make([]RecipeLine, 0, len(snap.Recipe))
	for _, l := range snap.Recipe {
		q, err := inventory.ParseQuantity(l.Quantity)
		if err != nil {
			return nil, fmt.Errorf("spa: recipe of the snapshot: %w", err)
		}
		out = append(out, RecipeLine{Item: l.ItemId, Qty: q, Unit: string(l.Unit)})
	}
	return out, nil
}

// overridesOf reads the corrections of the practitioner.
func overridesOf(in []api.ConsumptionOverride) ([]Override, error) {
	out := make([]Override, 0, len(in))
	for i, o := range in {
		q, err := inventory.ParseQuantity(o.ActualQuantity)
		if err != nil {
			return nil, invalid(fmt.Sprintf("overrides[%d].actualQuantity", i), textOverrideQty)
		}
		out = append(out, Override{Item: o.ItemId, Qty: q, Reason: o.Reason})
	}
	return out, nil
}

// finalPriceOf is the price of the visit by the fact: the one asked, else the price of the snapshot.
func finalPriceOf(snap api.SpaService, asked *api.Money) (int64, error) {
	if asked == nil {
		return int64(snap.Price.AmountMinor), nil
	}
	if asked.AmountMinor < 0 || int64(asked.AmountMinor) > maxMoneyMinor || asked.Currency != snap.Price.Currency {
		return 0, invalid("finalPrice", textFinalPrice)
	}
	return int64(asked.AmountMinor), nil
}

// consume issues the materials of the visit in the transaction of the completion; a shortage of the warehouse is the
// refusal of the completion with its reason.
func (s *Service) consume(ctx context.Context, tx pgx.Tx, ev Authorizer, tc tenantctx.TenantContext, v visit, b api.AppointmentComplete) ([]uuid.UUID, error) {
	recipe, err := recipeOf(v.snap)
	if err != nil {
		return nil, err
	}
	over, err := overridesOf(b.Overrides)
	if err != nil {
		return nil, err
	}
	// An item archived after the booking is still issued: the stock is what it is, only its unit must be known.
	units, err := allItemUnits(ctx, tx, recipe)
	if err != nil {
		return nil, err
	}
	uses, err := ConsumptionLines(recipe, units, over)
	if err != nil {
		return nil, err
	}
	if len(uses) == 0 {
		return []uuid.UUID{}, nil
	}
	if s.Stock == nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, errNoStock)
	}
	lines := make([]inventory.ConsumeLine, len(uses))
	for i, u := range uses {
		lines[i] = inventory.ConsumeLine{Item: u.Item, Qty: u.Qty}
	}
	movement, err := s.Stock.Consume(ctx, tx, ev, tc, inventory.Consumption{Warehouse: b.WarehouseId, SourceModule: moduleKey, SourceType: typeAppointment,
		SourceID: v.Id, Lines: lines, Corrected: len(over) > 0})
	if f, ok := errors.AsType[*inventory.RefusalError](err); ok {
		return nil, stockRefusal(f)
	}
	if err != nil {
		return nil, err
	}
	return []uuid.UUID{movement}, nil
}

// stockRefusal turns a refusal of the stock into the refusal of the completion with the same reason.
func stockRefusal(f *inventory.RefusalError) *RefusalError {
	if f.Code == codeInvalidTransit {
		return conflict(f.Reason, f.Detail)
	}
	field := f.Field
	if strings.HasPrefix(field, "lines") {
		field = "recipe"
	}
	return invalid(field, f.Detail)
}

// allItemUnits reads the base units of the items of the recipe, archived or not.
func allItemUnits(ctx context.Context, tx pgx.Tx, recipe []RecipeLine) (map[uuid.UUID]string, error) {
	ids := make([]uuid.UUID, len(recipe))
	for i, l := range recipe {
		ids[i] = l.Item
	}
	rows, err := tx.Query(ctx, `select id, base_unit from inventory.items where id = any($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("spa: item units: %w", err)
	}
	defer rows.Close()
	units := map[uuid.UUID]string{}
	for rows.Next() {
		var (
			id   uuid.UUID
			unit string
		)
		if err := rows.Scan(&id, &unit); err != nil {
			return nil, fmt.Errorf("spa: item units: %w", err)
		}
		units[id] = unit
	}
	return units, rows.Err()
}

// storedCompletion reads the completion of a visit that was completed already.
func storedCompletion(ctx context.Context, tx pgx.Tx, v visit) (api.AppointmentCompletion, error) {
	var movements []uuid.UUID
	if err := tx.QueryRow(ctx, `select movement_ids from spa.completions where appointment_id = $1`, v.Id).Scan(&movements); err != nil {
		return api.AppointmentCompletion{}, fmt.Errorf("spa: completion: %w", err)
	}
	if movements == nil {
		movements = []uuid.UUID{}
	}
	return api.AppointmentCompletion{Appointment: v.Appointment, InventoryMovementIds: movements}, nil
}

// Complete closes the accounting of a performed visit (completeAppointment): the materials of the recipe of the booked
// revision are issued from the warehouse once, in the transaction that completes the visit and proposes the price of the
// visit to the cash desk. A shortage returns 409 and leaves the fact and the status as they were; a repeat after the
// completion returns the same answer and issues nothing.
func (s *Service) Complete(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b api.AppointmentComplete) (api.AppointmentCompletion, error) {
	if b.WarehouseId == uuid.Nil {
		return api.AppointmentCompletion{}, invalid("warehouseId", textWarehouse)
	}
	var out api.AppointmentCompletion
	err := s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		v, err := lockVisit(ctx, tx, id)
		if err != nil {
			return err
		}
		if err := permitVisit(ctx, ev, tc, actApptComplete, v); err != nil {
			return err
		}
		if v.Status == api.AppointmentStatusCompleted {
			out, err = storedCompletion(ctx, tx, v)
			return err
		}
		if _, ok := NextStatus(string(v.Status), ActionComplete); !ok {
			return notInStatus()
		}
		if err := checkRevision(ifMatch, v.Revision); err != nil {
			return err
		}
		price, err := finalPriceOf(v.snap, b.FinalPrice)
		if err != nil {
			return err
		}
		movements, err := s.consume(ctx, tx, ev, tc, v, b)
		if err != nil {
			return err
		}
		if out, err = s.closeVisit(ctx, tx, tc, v, b, movements, price); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Appointment.Revision), out)
	})
	return out, err
}

// closeVisit writes the completion row (one per visit: the consumption happens once), the status and the price by the
// fact, the audit and the event, and offers the price to the cash desk.
func (s *Service) closeVisit(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, v visit, b api.AppointmentComplete, movements []uuid.UUID, price int64) (api.AppointmentCompletion, error) {
	overrides := make([]map[string]any, 0, len(b.Overrides))
	for _, o := range b.Overrides {
		overrides = append(overrides, map[string]any{"itemId": o.ItemId, "actualQuantity": o.ActualQuantity, "reason": strings.TrimSpace(o.Reason)})
	}
	if _, err := tx.Exec(ctx, `insert into spa.completions (appointment_id, completed_at, completed_by, warehouse_id, movement_ids, overrides, note)
		 values ($1, $2, $3, $4, $5, $6, $7)`, v.Id, s.now(), tc.PersonID, b.WarehouseId, movements, overrides, b.Note); err != nil {
		if isUnique(err) {
			return api.AppointmentCompletion{}, notInStatus()
		}
		return api.AppointmentCompletion{}, fmt.Errorf("spa: insert completion: %w", err)
	}
	done, err := move(ctx, tx, v, statusCompleted, `, final_price_minor = $3`, price)
	if err != nil {
		return api.AppointmentCompletion{}, err
	}
	if err := recordAudit(ctx, tx, tc, "spa.appointment.complete", targetAppointment, v.Id, v.OrgUnitId, "",
		map[string]any{"warehouseId": b.WarehouseId, "movements": movements, "overrides": len(overrides), "finalPriceMinor": price}); err != nil {
		return api.AppointmentCompletion{}, err
	}
	if err := publish(ctx, tx, "spa.appointment.completed.v1", done); err != nil {
		return api.AppointmentCompletion{}, err
	}
	if s.Offers != nil && price > 0 {
		if err := s.Offers.OfferVisit(ctx, tx, VisitOffer{AppointmentID: v.Id, Title: "Визит: " + v.snap.Name, AmountMinor: price}); err != nil {
			return api.AppointmentCompletion{}, err
		}
	}
	return api.AppointmentCompletion{Appointment: done.Appointment, InventoryMovementIds: movements}, nil
}
