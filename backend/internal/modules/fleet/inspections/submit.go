package inspections

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

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Events of the module (outbox.events.type).
const (
	eventSubmitted = "fleet.inspection.submitted.v1"
	eventBlocking  = "fleet.defect.blocking_reported.v1"
	eventDecided   = "fleet.defect.decided.v1"
)

// target is the trip an inspection is submitted for, locked for the transaction; a departure comes with its
// reservation (sched.reservations of the trip, its vehicle through sched.resources).
type target struct {
	trip        uuid.UUID
	number      string
	unit        uuid.UUID
	state       string
	vehicle     *uuid.UUID
	driver      *uuid.UUID
	departure   *uuid.UUID // departure_inspection_id
	departureKm *float64   // its odometer: the start of a return inspection

	reservation uuid.UUID // departure only
	resState    string
	resExpires  *time.Time
	resVehicle  uuid.UUID
}

// vehicleRow is the vehicle of an inspection.
type vehicleRow struct {
	id       uuid.UUID
	unit     uuid.UUID
	odometer float64
	plate    string
	name     string
}

const reservationSQL = `
select r.source_id, s.ref_id
  from sched.reservations r join sched.resources s on s.id = r.resource_id and s.kind = 'vehicle'
 where r.id = $1 and r.source_type = 'fleet.trip'`

// lockReservationSQL locks every row of the bundle of the reservation $1 (the row of the vehicle: its id is the bundle
// of sched.Hold, the driver is another row of the bundle) in the order of their ids, as sched.Hold orders its locks:
// the bundle is confirmed whole (Q-W2.02-13).
const lockReservationSQL = `
select state, hold_expires_at from sched.reservations
 where bundle_id = (select bundle_id from sched.reservations where id = $1)
 order by id for update`

const lockTripSQL = `
select t.id, t.number, t.unit_id, t.state, t.vehicle_id, t.driver_person_id, t.departure_inspection_id,
       (select i.odometer_km::float8 from fleet.inspections i where i.id = t.departure_inspection_id)
  from fleet.trips t where t.id = $1 for update`

const vehicleRowSQL = `
select id, unit_id, odometer_km::float8, plate, coalesce(display_name, '') from fleet.vehicles where id = $1`

// Submit records an inspection (submitInspection, S2-04, S2-05, AC-04): a departure by the reservation of the trip,
// a return by the trip. The trip decides who may submit (fleet.inspections.submit over the trip, its driver; the owner
// for anyone); the checklist version, the five photos of the parent and the odometer are checked; a blocking defect on
// departure sends the trip to the manager queue (S2-17).
func (s *Service) Submit(ctx context.Context, tc tenantctx.TenantContext, b fleetapi.InspectionCreate) (fleetapi.Inspection, error) {
	if err := validateCreate(b); err != nil {
		return fleetapi.Inspection{}, err
	}
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return fleetapi.Inspection{}, err
	}
	var out fleetapi.Inspection
	err = inTx(ctx, pool, func(tx pgx.Tx) error {
		s := s.inTx(tx)
		t, err := s.lockTarget(ctx, tx, tc, b)
		if err != nil {
			return err
		}
		v, err := vehicleOf(ctx, tx, b.VehicleId)
		if err != nil {
			return err
		}
		if err := checkEvidence(ctx, tx, t, v, b); err != nil {
			return err
		}
		id, err := s.record(ctx, tx, tc, t, v, b)
		if err != nil {
			return err
		}
		if out, err = loadInspection(ctx, tx, id); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusCreated, etag(out.Revision), out)
	})
	return out, err
}

// lockTarget finds and locks the trip of the inspection and checks the right of the subject on it.
func (s *Service) lockTarget(ctx context.Context, tx querier, tc tenantctx.TenantContext, b fleetapi.InspectionCreate) (target, error) {
	var t target
	tripID := uuid.Nil
	if b.Kind == kindDeparture {
		t.reservation = *b.ReservationId
		err := tx.QueryRow(ctx, reservationSQL, t.reservation).Scan(&tripID, &t.resVehicle)
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return target{}, problem.New(problem.CodeNotFound, "")
		case err != nil:
			return target{}, fmt.Errorf("inspections: reservation: %w", err)
		}
	} else {
		tripID = *b.TripId
	}
	err := tx.QueryRow(ctx, lockTripSQL, tripID).Scan(&t.trip, &t.number, &t.unit, &t.state, &t.vehicle, &t.driver,
		&t.departure, &t.departureKm)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return target{}, problem.New(problem.CodeNotFound, "")
	case err != nil:
		return target{}, fmt.Errorf("inspections: trip: %w", err)
	}
	if b.Kind == kindDeparture {
		if err := t.lockBundle(ctx, tx); err != nil {
			return target{}, err
		}
	}
	res := authz.Resource{Unit: t.unit, Persons: persons(t.driver), ReadAction: actionTripsRead}
	if err := s.Authz.Permit(ctx, tc, actionSubmit, res); err != nil {
		return target{}, err
	}
	if !tc.Owner && (t.driver == nil || *t.driver != tc.PersonID) {
		return target{}, problem.New(problem.CodeForbiddenAction, "Осмотр отправляет водитель рейса.")
	}
	return t, t.ready(b, s.now())
}

// lockBundle locks the rows of the bundle of the reservation and reads the bundle as one reservation: held while
// every row is held (otherwise the state of the first row that is not), until the earliest end of its holds.
func (t *target) lockBundle(ctx context.Context, q querier) error {
	rows, err := q.Query(ctx, lockReservationSQL, t.reservation)
	if err != nil {
		return fmt.Errorf("inspections: lock reservation: %w", err)
	}
	defer rows.Close()
	t.resState, t.resExpires = "", nil
	for rows.Next() {
		var (
			state string
			until *time.Time
		)
		if err := rows.Scan(&state, &until); err != nil {
			return fmt.Errorf("inspections: lock reservation: %w", err)
		}
		if t.resState == "" || t.resState == "hold" {
			t.resState = state
		}
		if until != nil && (t.resExpires == nil || until.Before(*t.resExpires)) {
			t.resExpires = until
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("inspections: lock reservation: %w", err)
	}
	return nil
}

// ready checks that the trip waits for this inspection.
func (t target) ready(b fleetapi.InspectionCreate, now time.Time) error {
	if b.Kind == kindDeparture {
		switch {
		case t.resVehicle != b.VehicleId:
			return problem.New(problem.CodeNotFound, "")
		case t.resState != "hold" || t.state != "inspection" || t.departure != nil:
			return problem.New(codeInvalidTransition, "Осмотр перед выездом уже отправлен или бронь снята.")
		case t.resExpires == nil || !t.resExpires.After(now):
			return problem.New(codeReservationExpired, "Бронь истекла. Забронируйте машину снова.")
		}
		return nil
	}
	switch {
	case t.vehicle == nil || *t.vehicle != b.VehicleId:
		return invalid("Машина осмотра — не машина рейса.")
	case t.state != "returning" && t.state != "rework":
		return problem.New(codeInvalidTransition, "Сначала «Завершить рейс».")
	}
	return nil
}

func vehicleOf(ctx context.Context, q querier, id uuid.UUID) (vehicleRow, error) {
	var v vehicleRow
	err := q.QueryRow(ctx, vehicleRowSQL, id).Scan(&v.id, &v.unit, &v.odometer, &v.plate, &v.name)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return vehicleRow{}, problem.New(problem.CodeNotFound, "")
	case err != nil:
		return vehicleRow{}, fmt.Errorf("inspections: vehicle: %w", err)
	}
	return v, nil
}

const photosSQL = `select id::text, state, purpose, owner_type, owner_id from files.objects where id = any($1::uuid[])`

// checkEvidence checks the inspection against the data: the current checklist version, what is missing (409
// inspection_incomplete), the photos — files of the parent of the inspection, all ready (409 photo_not_ready) — and
// the odometer (422 odometer_decrease).
func checkEvidence(ctx context.Context, q querier, t target, v vehicleRow, b fleetapi.InspectionCreate) error {
	c, err := currentChecklist(ctx, q, string(b.Kind))
	if err != nil {
		return err
	}
	if b.ChecklistVersionId != c.ID {
		return invalid(detailChecklist)
	}
	if miss := missing(c, b.Photos, b.Checks); len(miss) > 0 {
		return problem.New(codeIncomplete, incompleteDetail(string(b.Kind), miss))
	}
	if err := checkPhotos(ctx, q, t, b); err != nil {
		return err
	}
	start := v.odometer
	if b.Kind == kindReturn && t.departureKm != nil {
		start = *t.departureKm
	}
	return checkOdometer(b.OdometerKm, start)
}

// usedPhotosSQL reports whether one of the files ($2) is already a photo of another inspection of the trip ($1): a
// role (fleet.inspection_photos) or a damage photo (answers.photos). A file of the parent of an inspection can only be
// attached to the inspections of its trip, so the trip bounds the search; the trip is locked, submits do not race.
const usedPhotosSQL = `
select exists (
  select 1 from fleet.inspections i
   where i.trip_id = $1
     and (exists (select 1 from fleet.inspection_photos p where p.inspection_id = i.id and p.file_id::text = any($2::text[]))
          or exists (select 1 from jsonb_array_elements(case when jsonb_typeof(i.answers->'photos') = 'array'
                                                            then i.answers->'photos' else '[]'::jsonb end) a
                      where a->>'fileId' = any($2::text[]))))`

// checkPhotos checks that every photo is a file of the parent of the inspection (FleetParents of W1.09: a departure
// attaches to its reservation or trip, a return to its trip) with the purpose inspection, not attached to another
// inspection of the trip (another attempt or kind: AC-04, five photos of this inspection), and ready.
func checkPhotos(ctx context.Context, q querier, t target, b fleetapi.InspectionCreate) error {
	ids := make([]uuid.UUID, 0, len(b.Photos))
	for _, p := range b.Photos {
		ids = append(ids, p.FileId)
	}
	found, err := photoFiles(ctx, q, ids)
	if err != nil {
		return err
	}
	ready := true
	for _, id := range ids {
		f, ok := found[id]
		if !ok || !f.of(t, string(b.Kind)) {
			return invalid(detailForeign)
		}
		ready = ready && f.state == "ready"
	}
	var used bool
	if err := q.QueryRow(ctx, usedPhotosSQL, t.trip, uuidStrings(ids)).Scan(&used); err != nil {
		return fmt.Errorf("inspections: used photos: %w", err)
	}
	if used {
		return invalid(detailUsedFile)
	}
	if !ready {
		return problem.New(codePhotoNotReady, detailNotReady)
	}
	return nil
}

// photoFile is a file of files.objects named as a photo.
type photoFile struct {
	state, purpose, ownerType string
	owner                     uuid.UUID
}

// of reports whether the file is an inspection photo of the parent of an inspection of kind for t.
func (f photoFile) of(t target, kind string) bool {
	if f.purpose != "inspection" {
		return false
	}
	return (f.ownerType == "fleet.trip" && f.owner == t.trip) ||
		(kind == kindDeparture && f.ownerType == "fleet.reservation" && f.owner == t.reservation)
}

func photoFiles(ctx context.Context, q querier, ids []uuid.UUID) (map[uuid.UUID]photoFile, error) {
	rows, err := q.Query(ctx, photosSQL, uuidStrings(ids))
	if err != nil {
		return nil, fmt.Errorf("inspections: photos: %w", err)
	}
	defer rows.Close()
	found := map[uuid.UUID]photoFile{}
	for rows.Next() {
		var (
			id string
			f  photoFile
		)
		if err := rows.Scan(&id, &f.state, &f.purpose, &f.ownerType, &f.owner); err != nil {
			return nil, fmt.Errorf("inspections: photos: %w", err)
		}
		if parsed, err := uuid.Parse(id); err == nil {
			found[parsed] = f
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("inspections: photos: %w", err)
	}
	return found, nil
}

// answers is fleet.inspections.answers: what the contract sends and the stored columns cannot hold exactly.
type answers struct {
	Checks         []fleetapi.InspectionCheck `json:"checks"`
	Photos         []fleetapi.InspectionPhoto `json:"photos"`
	FuelPercent    *int                       `json:"fuelPercent,omitempty"`
	OdometerKm     string                     `json:"odometerKm,omitempty"`
	ReportedDamage *string                    `json:"reportedDamage,omitempty"`
}

const insertInspectionSQL = `
insert into fleet.inspections (trip_id, vehicle_id, kind, checklist_version_id, odometer_km, fuel_level, answers, state,
                               submitted_by, submitted_at, client_captured_at, attempt, comment)
select $1, $2, $3, $4, $5::numeric, $6, $7, $8, $9, $10, $11, coalesce(max(attempt), 0) + 1, $12
  from fleet.inspections where trip_id = $1 and kind = $3
returning id`

const insertDefectSQL = `
insert into fleet.defects (vehicle_id, inspection_id, trip_id, zone, severity, description, state, reported_by, created_at)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
returning id`

// record writes the inspection, its photos and defects and moves the trip; a blocking defect on departure moves the
// trip to defect_review, notes the vehicle, keeps the reservation without expiry and notifies the managers.
func (s *Service) record(ctx context.Context, tx querier, tc tenantctx.TenantContext, t target, v vehicleRow, b fleetapi.InspectionCreate) (uuid.UUID, error) {
	now := s.now()
	reports := []fleetapi.InspectionDefectReport{}
	if b.Defects != nil {
		reports = *b.Defects
	}
	blocking := b.Kind == kindDeparture && slices.ContainsFunc(reports, func(d fleetapi.InspectionDefectReport) bool {
		return d.Severity == severityBlocking
	})
	id, err := insertInspection(ctx, tx, tc, t, v, b, blocking, now)
	if err != nil {
		return uuid.Nil, err
	}
	first := uuid.Nil // the first blocking defect: the one of the queue card and of the notification
	zone := ""
	for i, d := range reports {
		// The defects of one inspection share the moment of the command: a microsecond apart they keep the order of
		// the report in the queue and in the inspection (created_at, id).
		at := now.Add(time.Duration(i) * time.Microsecond)
		state := stateOpen
		if b.Kind == kindDeparture && d.Severity == severityBlocking {
			state = stateInReview
		}
		var did uuid.UUID
		if err := tx.QueryRow(ctx, insertDefectSQL, v.id, id, t.trip, d.Zone, d.Severity, d.Description, state, tc.PersonID, at).Scan(&did); err != nil {
			return uuid.Nil, fmt.Errorf("inspections: defect: %w", err)
		}
		if state == stateInReview && first == uuid.Nil {
			first, zone = did, d.Zone
		}
	}
	if err := moveTrip(ctx, tx, t, b, id, blocking); err != nil {
		return uuid.Nil, err
	}
	if _, err := events.Publish(ctx, tx, events.Event{Type: eventSubmitted, Aggregate: "fleet.inspection", AggregateID: id,
		Payload: map[string]any{"inspectionId": id, "tripId": t.trip, "vehicleId": v.id, "kind": b.Kind, "blocking": blocking}}); err != nil {
		return uuid.Nil, err
	}
	if !blocking {
		return id, nil
	}
	return id, s.reportBlocking(ctx, tx, tc.TenantID, t, v, first, zone)
}

func insertInspection(ctx context.Context, tx querier, tc tenantctx.TenantContext, t target, v vehicleRow, b fleetapi.InspectionCreate, blocking bool, now time.Time) (uuid.UUID, error) {
	fuel := b.FuelPercent
	a, err := json.Marshal(answers{Checks: b.Checks, Photos: b.Photos, FuelPercent: &fuel, OdometerKm: b.OdometerKm, ReportedDamage: b.ReportedDamage})
	if err != nil {
		return uuid.Nil, fmt.Errorf("inspections: answers: %w", err)
	}
	state := "submitted"
	if blocking {
		state = "blocked"
	}
	var comment any
	if b.Comment != nil && !blank(*b.Comment) {
		comment = *b.Comment
	}
	var id uuid.UUID
	err = tx.QueryRow(ctx, insertInspectionSQL, t.trip, v.id, b.Kind, b.ChecklistVersionId, b.OdometerKm, fuelLevel(fuel), a,
		state, tc.PersonID, now, b.CapturedAt.UTC(), comment).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("inspections: insert: %w", err)
	}
	for _, p := range b.Photos {
		role, ok := storedRole(string(p.Role))
		if !ok {
			continue // damage photos live in answers only
		}
		if _, err := tx.Exec(ctx, `insert into fleet.inspection_photos (inspection_id, role, file_id) values ($1, $2, $3)`,
			id, role, p.FileId); err != nil {
			return uuid.Nil, fmt.Errorf("inspections: photo: %w", err)
		}
	}
	return id, nil
}

// moveTrip points the trip at its latest inspection of the kind; a blocking departure sends it to defect_review.
func moveTrip(ctx context.Context, tx querier, t target, b fleetapi.InspectionCreate, id uuid.UUID, blocking bool) error {
	sql := `update fleet.trips set return_inspection_id = $2, revision = revision + 1 where id = $1`
	args := []any{t.trip, id}
	if b.Kind == kindDeparture {
		sql = `update fleet.trips set departure_inspection_id = $2,
		              state = case when $3 then 'defect_review' else state end, revision = revision + 1 where id = $1`
		args = append(args, blocking)
	}
	if _, err := tx.Exec(ctx, sql, args...); err != nil {
		return fmt.Errorf("inspections: trip: %w", err)
	}
	return nil
}

// reportBlocking makes the vehicle unavailable («критический дефект на проверке»), keeps the reservation for the
// trip while the manager decides (confirmed: no expiry), publishes the event and notifies the managers of the area
// and the owner (S2-17 п. 1).
func (s *Service) reportBlocking(ctx context.Context, tx querier, tenant uuid.UUID, t target, v vehicleRow, defect uuid.UUID, zone string) error {
	if _, err := tx.Exec(ctx, `update fleet.vehicles set service_note = $2, revision = revision + 1 where id = $1`, v.id, noteBlocked); err != nil {
		return fmt.Errorf("inspections: vehicle note: %w", err)
	}
	// The whole bundle (vehicle and driver), locked by lockBundle: the driver row does not run out by its TTL while the
	// manager decides (Q-W2.02-13).
	if _, err := tx.Exec(ctx, `update sched.reservations set state = 'confirmed', revision = revision + 1
	                            where bundle_id = (select bundle_id from sched.reservations where id = $1) and state = 'hold'`,
		t.reservation); err != nil {
		return fmt.Errorf("inspections: keep reservation: %w", err)
	}
	ev, err := events.Publish(ctx, tx, events.Event{Type: eventBlocking, Aggregate: "fleet.defect", AggregateID: defect,
		Payload: map[string]any{"defectId": defect, "tripId": t.trip, "vehicleId": v.id}})
	if err != nil {
		return err
	}
	return s.notifyManagers(ctx, tx, tenant, t, ev, blockingTitle(v.name, v.plate, zone))
}
