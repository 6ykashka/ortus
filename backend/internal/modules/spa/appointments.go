package spa

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	api "github.com/ortus/ortus-crm/backend/internal/api/spa"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const (
	textApptNotFound  = "Визит не найден."
	textZone          = "Часовой пояс — название из базы IANA, например Europe/Moscow."
	textServiceGone   = "Услуга не найдена."
	textServiceUnit   = "Услуга относится к другому подразделению."
	textPractitioner  = "Сотрудник не найден."
	textRoom          = "Кабинет не найден, не из этого подразделения или не используется."
	textNeedEquipment = "Для услуги нужно оборудование, которого нет в записи."
	textStatus        = "Статус — подтверждён, выполнен без проведения, завершён, отменён или неявка."
	textStart         = "Укажите время начала."
	textReason        = "Укажите причину."
	textReasonLong    = "Причина — не длиннее 500 символов."
)

// apptColumns: a visit is seen by its unit and by its practitioner (scope self).
var apptColumns = authz.Columns{Unit: "a.org_unit_id", Persons: []string{"a.practitioner_id"}}

const apptSelect = `select a.id, a.org_unit_id, a.service_id, a.service_revision, a.client_id, a.practitioner_id, a.room_id, a.equipment_ids,
       lower(b.during), upper(b.during), b.time_zone, a.booking_id, a.status, a.revision, a.performed_at, a.final_price_minor, a.service_snapshot
  from spa.appointments a join sched.bookings b on b.id = a.booking_id`

// visit is a visit as the module works with it: the contract object and the snapshot of the service it was booked with.
type visit struct {
	api.Appointment
	snap api.SpaService
}

func (v visit) resource() authz.Resource {
	return authz.Resource{Unit: v.OrgUnitId, Persons: []uuid.UUID{v.PractitionerMemberId}, ReadAction: actApptRead}
}

func scanVisit(row pgx.Row) (visit, error) {
	var (
		v          visit
		status     string
		performed  *time.Time
		final      *int64
		snapshot   []byte
		start, end time.Time
	)
	if err := row.Scan(&v.Id, &v.OrgUnitId, &v.ServiceId, &v.ServiceRevision, &v.ClientId, &v.PractitionerMemberId, &v.RoomId, &v.EquipmentIds,
		&start, &end, &v.Window.TimeZone, &v.BookingId, &status, &v.Revision, &performed, &final, &snapshot); err != nil {
		return visit{}, err
	}
	if err := json.Unmarshal(snapshot, &v.snap); err != nil {
		return visit{}, fmt.Errorf("spa: snapshot of the visit: %w", err)
	}
	v.Window.StartsAt, v.Window.EndsAt = start.UTC(), end.UTC()
	v.Status = api.AppointmentStatus(status)
	if v.EquipmentIds == nil {
		v.EquipmentIds = []api.Id{}
	}
	if performed != nil {
		t := performed.UTC()
		v.PerformedAt = &t
	}
	if final != nil {
		v.FinalPrice = &api.Money{AmountMinor: int(*final), Currency: v.snap.Price.Currency}
	}
	return v, nil
}

// lockVisit reads a visit under a row lock; a visit that is not there is 404.
func lockVisit(ctx context.Context, tx pgx.Tx, id uuid.UUID) (visit, error) {
	v, err := scanVisit(tx.QueryRow(ctx, apptSelect+` where a.id = $1 for update of a`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return visit{}, problem.New(problem.CodeNotFound, textApptNotFound)
	}
	if err != nil {
		return visit{}, fmt.Errorf("spa: visit: %w", err)
	}
	return v, nil
}

// permitVisit checks a right over the visit: a visit the member does not read is as missing.
func permitVisit(ctx context.Context, ev Authorizer, tc tenantctx.TenantContext, action string, v visit) error {
	err := ev.Permit(ctx, tc, action, v.resource())
	if problem.Is(err, problem.CodeNotFound) {
		return problem.New(problem.CodeNotFound, textApptNotFound)
	}
	return err
}

// GetAppointment reads a visit the member sees (spa.appointments.read over its unit or as its practitioner).
func (s *Service) GetAppointment(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (api.Appointment, error) {
	var out api.Appointment
	err := s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		v, err := scanVisit(tx.QueryRow(ctx, apptSelect+` where a.id = $1`, id))
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New(problem.CodeNotFound, textApptNotFound)
		}
		if err != nil {
			return fmt.Errorf("spa: visit: %w", err)
		}
		if err := permitVisit(ctx, ev, tc, actApptRead, v); err != nil {
			return err
		}
		out = v.Appointment
		return nil
	})
	return out, err
}

var statuses = []string{statusConfirmed, statusPerformed, statusCompleted, statusCancelled, statusNoShow}

// ListAppointments lists the visits the member sees, by the start: a period keeps the visits that overlap it.
func (s *Service) ListAppointments(ctx context.Context, tc tenantctx.TenantContext, q AppointmentQuery) (api.AppointmentPage, error) {
	limit, off, err := pageOf(q.PageQuery)
	if err != nil {
		return api.AppointmentPage{}, err
	}
	if q.Status != "" && !slices.Contains(statuses, q.Status) {
		return api.AppointmentPage{}, invalid("status", textStatus)
	}
	page := api.AppointmentPage{Items: []api.Appointment{}}
	err = s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		pred, err := ev.ScopeQuery(ctx, tc, actApptRead, apptColumns, 6)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, apptSelect+` where (`+pred.SQL+`)
			   and ($3::text = '' or a.status = $3) and ($4::timestamptz is null or upper(b.during) > $4) and ($5::timestamptz is null or lower(b.during) < $5)
			   and ($6::uuid is null or a.practitioner_id = $6)
			 order by lower(b.during), a.id offset $1 limit $2`,
			append([]any{off, limit + 1, q.Status, q.From, q.To, q.Practitioner}, pred.Args...)...)
		if err != nil {
			return fmt.Errorf("spa: visits: %w", err)
		}
		all, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (api.Appointment, error) {
			v, err := scanVisit(r)
			return v.Appointment, err
		})
		if err != nil {
			return fmt.Errorf("spa: visits: %w", err)
		}
		if page.Items, page.NextCursor = paged(all, off, limit); page.Items == nil {
			page.Items = []api.Appointment{}
		}
		return nil
	})
	return page, err
}

// checkBooking checks the references of a request to book (create) a visit or to move one: the practitioner, the
// room and the equipment must be there and belong to the unit; the service must not need equipment that is not booked.
func checkBooking(ctx context.Context, tx pgx.Tx, unit uuid.UUID, svc api.SpaService, res resources) error {
	var found bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from people.person_profiles where id = $1 and archived_at is null)`, res.practitioner).Scan(&found); err != nil {
		return fmt.Errorf("spa: practitioner: %w", err)
	}
	if !found {
		return invalid("practitionerMemberId", textPractitioner)
	}
	if err := tx.QueryRow(ctx, `select exists (select 1 from sched.resources where id = $1 and kind = 'room' and active and home_unit_id = $2)`,
		res.room, unit).Scan(&found); err != nil {
		return fmt.Errorf("spa: room: %w", err)
	}
	if !found {
		return invalid("roomId", textRoom)
	}
	if err := checkEquipment(ctx, tx, unit, res.equipment, "equipmentIds"); err != nil {
		return err
	}
	for _, need := range svc.RequiredEquipmentIds {
		if !slices.Contains(res.equipment, need) {
			return invalid("equipmentIds", textNeedEquipment)
		}
	}
	return nil
}

// bookable checks the right to book the practitioner, loads the service as it is now and checks the references of the
// request: the service and the resources must be of the unit of the visit.
func bookable(ctx context.Context, tx pgx.Tx, ev Authorizer, tc tenantctx.TenantContext, b api.AppointmentCreate) (api.SpaService, resources, error) {
	res := resources{practitioner: b.PractitionerMemberId, room: b.RoomId, equipment: idList(b.EquipmentIds)}
	err := ev.Permit(ctx, tc, actApptCreate, authz.Resource{Unit: b.OrgUnitId, Persons: []uuid.UUID{b.PractitionerMemberId}, ReadAction: actApptRead})
	if problem.Is(err, problem.CodeNotFound) {
		return api.SpaService{}, res, problem.New(problem.CodeNotFound, textApptNotFound)
	}
	if err != nil {
		return api.SpaService{}, res, err
	}
	svc, err := readService(ctx, tx, b.ServiceId)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return svc, res, invalid("serviceId", textServiceGone)
	case err != nil:
		return svc, res, fmt.Errorf("spa: service: %w", err)
	case svc.OrgUnitId != b.OrgUnitId:
		return svc, res, invalid("orgUnitId", textServiceUnit)
	}
	return svc, res, checkBooking(ctx, tx, b.OrgUnitId, svc, res)
}

// insertVisit writes the visit with the snapshot of the service it is booked with.
func insertVisit(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, b api.AppointmentCreate, svc api.SpaService, req bookingRequest, id uuid.UUID) error {
	snap, err := json.Marshal(svc)
	if err != nil {
		return fmt.Errorf("spa: snapshot: %w", err)
	}
	if _, err := tx.Exec(ctx, `insert into spa.appointments (id, org_unit_id, service_id, service_revision, client_id, practitioner_id, room_id, equipment_ids,
		   starts_at, ends_at, time_zone, booking_id, service_snapshot, created_by, created_at)
		 values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
		id, b.OrgUnitId, svc.Id, svc.Revision, b.ClientId, b.PractitionerMemberId, b.RoomId, req.res.equipment, req.window.From, req.window.To, b.TimeZone,
		req.id, snap, tc.PersonID, req.now); err != nil {
		return fmt.Errorf("spa: insert visit: %w", err)
	}
	return nil
}

// checkWhen checks the start and the zone of a request to book or to move a visit.
func checkWhen(zone string, start time.Time) error {
	if _, err := time.LoadLocation(zone); err != nil || zone == "" || zone == "Local" {
		return invalid("timeZone", textZone)
	}
	if start.IsZero() {
		return invalid("startsAt", textStart)
	}
	return nil
}

// CreateAppointment books a visit (createAppointment): the practitioner, the room and the equipment are held together
// for the window of the service with its buffers, or not at all; the service, its recipe and its price are snapshotted.
func (s *Service) CreateAppointment(ctx context.Context, tc tenantctx.TenantContext, b api.AppointmentCreate) (api.Appointment, error) {
	if err := checkWhen(b.TimeZone, b.StartsAt); err != nil {
		return api.Appointment{}, err
	}
	var out api.Appointment
	err := s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		svc, res, err := bookable(ctx, tx, ev, tc, b)
		if err != nil {
			return err
		}
		window, occupied := Plan(b.StartsAt.UTC(), svc.DurationMinutes, svc.BufferBeforeMinutes, svc.BufferAfterMinutes)
		id, booking := uuid.New(), uuid.New()
		req := bookingRequest{id: booking, visit: id, unit: b.OrgUnitId, title: svc.Name, window: window, occupied: occupied, zone: b.TimeZone,
			before: svc.BufferBeforeMinutes, after: svc.BufferAfterMinutes, createdBy: tc.PersonID, now: s.now(), res: res}
		if err := reserve(ctx, tx, req); err != nil {
			return err
		}
		if err := insertVisit(ctx, tx, tc, b, svc, req, id); err != nil {
			return err
		}
		v, err := scanVisit(tx.QueryRow(ctx, apptSelect+` where a.id = $1`, id))
		if err != nil {
			return fmt.Errorf("spa: read back visit: %w", err)
		}
		out = v.Appointment
		if err := recordAudit(ctx, tx, tc, "spa.appointment.create", targetAppointment, id, b.OrgUnitId, "",
			map[string]any{"serviceId": svc.Id, "serviceRevision": svc.Revision, "startsAt": window.From, "practitionerId": b.PractitionerMemberId}); err != nil {
			return err
		}
		if err := publish(ctx, tx, "spa.appointment.created.v1", v); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusCreated, etag(out.Revision), out)
	})
	return out, err
}

// publish puts the event of a visit in the outbox of the transaction of the change.
func publish(ctx context.Context, tx pgx.Tx, typ string, v visit) error {
	payload := map[string]any{"appointmentId": v.Id, "unitId": v.OrgUnitId, "serviceId": v.ServiceId, "practitionerId": v.PractitionerMemberId,
		"clientId": v.ClientId, "status": string(v.Status), "startsAt": v.Window.StartsAt, "endsAt": v.Window.EndsAt}
	if v.PerformedAt != nil {
		payload["performedAt"] = *v.PerformedAt
	}
	if v.FinalPrice != nil {
		payload["finalPrice"] = map[string]any{"amountMinor": v.FinalPrice.AmountMinor, "currency": v.FinalPrice.Currency}
	}
	if _, err := events.Publish(ctx, tx, events.Event{Type: typ, Aggregate: targetAppointment, AggregateID: v.Id, Payload: payload}); err != nil {
		return fmt.Errorf("spa: event: %w", err)
	}
	return nil
}
