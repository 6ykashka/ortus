package reservations

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.02: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/modules/sched"   //nolint:depguard // W2.02: the scheduling core of the same work stream
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Texts of releaseReservation (the mock W2.00, vehicles.ts).
const (
	textNotHeld = "Бронь уже снята или использована."
	textReason  = "Причина — до 500 символов."
)

// maxReason is ReservationPatch.reason maxLength.
const maxReason = 500

// ReleaseReservation implements fleetapi.StrictServerInterface: the live hold of a reservation the actor sees
// (fleet.reservations.read) is released by fleet.reservations.manage over the unit of its vehicle or its people,
// at the revision of If-Match. The trip of the hold goes back to planned without its vehicle. A hold that ended, was
// released or consumed is 409 invalid_transition.
func (s *Server) ReleaseReservation(ctx context.Context, req fleetapi.ReleaseReservationRequestObject) (fleetapi.ReleaseReservationResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if req.Body == nil || req.Body.Action != fleetapi.Release {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	var reason string
	if req.Body.Reason != nil {
		reason = strings.TrimSpace(*req.Body.Reason)
		if utf8.RuneCountInString(reason) > maxReason {
			return nil, kit.Invalid(textReason)
		}
	}
	now := s.now()
	var out fleetapi.Reservation
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		c := command{s: s, tx: tx, ev: s.within(tx), tc: tc, now: now}
		var err error
		out, err = c.release(ctx, req.ReservationId, req.Params.IfMatch, reason)
		return err
	})
	if err != nil {
		return nil, dbError(err)
	}
	tag, replayed := kit.ETag(out.Revision), false
	return fleetapi.ReleaseReservation200JSONResponse{
		Body: out,
		Headers: fleetapi.ReleaseReservation200ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}

func (c command) release(ctx context.Context, id uuid.UUID, ifMatch, reason string) (fleetapi.Reservation, error) {
	b, err := c.lockReleasable(ctx, id)
	if err != nil {
		return fleetapi.Reservation{}, notFound(err)
	}
	if err := kit.CheckRevision(ifMatch, b.Revision); err != nil {
		return fleetapi.Reservation{}, err
	}
	if _, err := sched.Release(ctx, c.tx, b.ID, c.now); errors.Is(err, sched.ErrNotHeld) {
		return fleetapi.Reservation{}, kit.Conflict(textNotHeld)
	} else if err != nil {
		return fleetapi.Reservation{}, err
	}
	if b.Source == SourceTrip {
		// The trip of the hold goes back to planning: the vehicle is free, the driver chooses again. A trip in
		// defect_review (a blocking defect found at the departure inspection) still keeps its hold and goes back too,
		// without that inspection, as W2.04 does on a confirmed fault (decide.go confirm) and the mock on release: the
		// next departure is inspected again (attempt + 1); the defect stays in the queue for the vehicle, and its
		// decision no longer moves the trip (decide.go tripReviewed).
		if _, err := c.tx.Exec(ctx, `update fleet.trips set state = 'planned', vehicle_id = null, reservation_bundle_id = null,
			departure_inspection_id = null, revision = revision + 1 where id = $1 and reservation_bundle_id = $2
			   and state in ('assigned', 'inspection', 'defect_review')`,
			b.SourceID, b.ID); err != nil {
			return fleetapi.Reservation{}, err
		}
	}
	if b, err = readBundle(ctx, c.tx, b.ID, false); err != nil {
		return fleetapi.Reservation{}, err
	}
	out := b.dto(c.now)
	if err := kit.Audit(ctx, c.tx, audit.Event{
		Action: "fleet.reservation.release", TargetType: targetReservation, TargetID: b.ID, UnitID: b.Unit, Reason: reason,
	}); err != nil {
		return fleetapi.Reservation{}, err
	}
	if _, err := events.Publish(ctx, c.tx, events.Event{
		Type: eventReleased, Aggregate: targetReservation, AggregateID: b.ID,
		Payload: map[string]any{"reservationId": b.ID, "vehicleId": b.Vehicle, "driverMemberId": b.Driver, "unitId": b.Unit},
	}); err != nil {
		return fleetapi.Reservation{}, err
	}
	return out, kit.Complete(ctx, c.tx, http.StatusOK, kit.ETag(out.Revision), out)
}

// lockReleasable reads the reservation id the actor sees (fleet.reservations.read) and may release
// (fleet.reservations.manage) and locks it in the order of reserveVehicle — the trip first, then the rows of the
// hold — so that a release and a new reservation of the same trip queue instead of deadlocking.
func (c command) lockReleasable(ctx context.Context, id uuid.UUID) (bundle, error) {
	b, err := readBundle(ctx, c.tx, id, false)
	if err != nil {
		return bundle{}, err
	}
	if err := c.ev.Permit(ctx, c.tc, ActionRead, b.resource("")); err != nil {
		return bundle{}, err
	}
	if err := c.ev.Permit(ctx, c.tc, ActionManage, b.resource(ActionRead)); err != nil {
		return bundle{}, err
	}
	if b.Source == SourceTrip {
		if _, err := c.tx.Exec(ctx, `select 1 from fleet.trips where id = $1 for update`, b.SourceID); err != nil {
			return bundle{}, err
		}
	}
	return readBundle(ctx, c.tx, id, true)
}
