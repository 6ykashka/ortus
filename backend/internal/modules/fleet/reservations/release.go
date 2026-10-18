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
// released or consumed is 409 invalid_transition — except the ended hold a trip not started yet still keeps its
// vehicle by (withdraw): its release takes the assignment back. A hold of an assignment of the logist to a trip without
// a driver is released the same way (Q-W2.53-3).
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
		kept, err := c.withdraw(ctx, b)
		if err != nil {
			return fleetapi.Reservation{}, err
		}
		if !kept {
			return fleetapi.Reservation{}, kit.Conflict(textNotHeld)
		}
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
	payload := map[string]any{"reservationId": b.ID, "vehicleId": b.Vehicle, "unitId": b.Unit}
	if b.Driver != uuid.Nil {
		payload["driverMemberId"] = b.Driver
	}
	if _, err := events.Publish(ctx, c.tx, events.Event{
		Type: eventReleased, Aggregate: targetReservation, AggregateID: b.ID, Payload: payload,
	}); err != nil {
		return fleetapi.Reservation{}, err
	}
	return out, kit.Complete(ctx, c.tx, http.StatusOK, kit.ETag(out.Revision), out)
}

// withdrawSQL releases the ended hold of a bundle ($1) that its trip ($2) still keeps: the trip is not started and
// holds its vehicle by that bundle for its window after the end of the hold (assignTripVehicle, Q-W2.03-7).
const withdrawSQL = `update sched.reservations r set state = 'released', revision = r.revision + 1
 where r.bundle_id = $1 and (r.state = 'expired' or (r.state = 'hold' and r.hold_expires_at <= $3))
   and exists (select 1 from fleet.trips t where t.id = $2 and t.reservation_bundle_id = $1
                  and t.state in ('assigned', 'inspection', 'defect_review'))`

// withdraw takes back the ended hold of a trip that still keeps its vehicle by it (Q-W2.53-3): the hold has ended,
// but the trip holds the vehicle for its window until it is released or replaced, so releaseReservation is how the
// logist takes the assignment back. It reports whether there was such a hold; any other ended hold is not
// releasable (409).
func (c command) withdraw(ctx context.Context, b bundle) (bool, error) {
	if b.Source != SourceTrip {
		return false, nil
	}
	tag, err := c.tx.Exec(ctx, withdrawSQL, b.ID, b.SourceID, c.now)
	if err != nil {
		return false, err
	}
	return tag.RowsAffected() > 0, nil
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
