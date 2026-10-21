// Package offers holds the reservations of an offer of vehicles to the driver of a trip (W2.72, S2-20 «Машина для
// временного водителя», D-35 комплекта; docs/29 «Данные и API», tenant 0023): the statements the pool (the approval of a
// request, the choice, the deadline, the end of a transfer) and the planning (assignTripVehicle with a second vehicle or
// on a trip of a temporary driver) share. The reservations are rows of sched.reservations of the source fleet.trip; the
// module of the reservations (W2.02) reads them.
package offers

import (
	"context"
	"fmt"
	"maps"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.72: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/modules/sched"   //nolint:depguard // W2.72: the scheduling core the reservations of an offer hold through
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
)

// The reservations of an offer — the alternative vehicles of one trip offered to its driver (offer_group_id, offered_to,
// offer_kind). Two vehicles are held until the deadline of the choice (hold_expires_at = choose_until); one vehicle is
// confirmed at once (Q-W2.70-1, -2). Exactly one reservation of a group becomes confirmed (reservations_offer_chosen_uq),
// the others are released with a reason. The pool (the approval of a request, the choice, the deadline, the end of a
// transfer) and the planning (assignTripVehicle with a second vehicle or on a trip of a temporary driver) share these
// statements.

// Kinds of the vehicles of an offer (Reservation.offerKind).
const (
	OfferHost  = "host"  // a vehicle of the company of the trip («Поставил логист»)
	OfferUsual = "usual" // the usual vehicle of the driver («Ваша обычная»)
)

// Reasons of a release (Reservation.releaseReason).
const (
	ReasonChosen        = "chosen"
	ReasonDeadline      = "deadline"
	ReasonManager       = "manager"
	ReasonTransferEnded = "transfer_ended"
)

// Events of the reservations of an offer (12-errors-and-events; W2.71 0.6.3-stage2).
const (
	EventHeld      = "fleet.reservation.held.v1"
	EventConfirmed = "fleet.reservation.confirmed.v1"
	EventReleased  = "fleet.reservation.released.v1"
)

// SourceTrip is the source of the reservations of an offer (sched.reservations.source_type, reservations.SourceTrip);
// targetReservation — the target of their audit rows and events.
const (
	SourceTrip        = "fleet.trip"
	targetReservation = "fleet.reservation"
)

// OfferVehicle is a vehicle of an offer: its id, its company (sched.resources.home_unit_id) and its kind.
type OfferVehicle struct {
	Vehicle, Unit uuid.UUID
	Kind          string
}

// OfferRequest is an offer of vehicles to the driver of a trip.
type OfferRequest struct {
	Trip        uuid.UUID
	Window      sched.Window // the window of the trip: the vehicles are occupied only for it (docs/29 rule 3)
	Driver      uuid.UUID    // the driver who chooses (sched.reservations.offered_to)
	Vehicles    []OfferVehicle
	ChooseUntil time.Time // the deadline of the choice between several vehicles; zero — one vehicle, confirmed at once
	Replaces    uuid.UUID // the bundle the trip held before (uuid.Nil: none), released inside the first hold
	CreatedBy   uuid.UUID
	Now         time.Time
}

// Offer is what HoldOffer wrote: the group and the bundle of every vehicle in the order of OfferRequest.Vehicles.
type Offer struct {
	Group   uuid.UUID
	Bundles []uuid.UUID
}

// Claims are the claims of the vehicles of r: LockClaims takes them before the holds.
func (r OfferRequest) Claims() []sched.Claim {
	out := make([]sched.Claim, 0, len(r.Vehicles))
	for _, v := range r.Vehicles {
		out = append(out, sched.Claim{Kind: sched.KindVehicle, Ref: v.Vehicle, Home: v.Unit})
	}
	return out
}

// HoldOffer holds every vehicle of r for the window of the trip (a bundle of the vehicle only: the driver of an offer
// is not a claim, the reservations of one offer are alternatives) as one offer and writes the trip: with one confirmed
// vehicle the trip is assigned with it; with several the trip waits for the choice without a vehicle. The resources
// are locked in the order of Hold first (sched.LockClaims, with the live rows of the trip); a taken interval is the
// *sched.OverlapError of Hold, and tx is aborted.
func HoldOffer(ctx context.Context, tx pgx.Tx, r OfferRequest) (Offer, error) {
	if err := sched.LockClaims(ctx, tx, r.Claims(), SourceTrip, r.Trip); err != nil {
		return Offer{}, err
	}
	out := Offer{Group: uuid.New()}
	choice := !r.ChooseUntil.IsZero()
	expires, state := r.Window.End, sched.StateConfirmed
	var until any
	if choice {
		expires, state, until = r.ChooseUntil, sched.StateHold, r.ChooseUntil
	}
	for i, v := range r.Vehicles {
		b := uuid.New()
		replaces := uuid.Nil
		if i == 0 {
			replaces = r.Replaces
		}
		if err := sched.Hold(ctx, tx, sched.HoldRequest{
			Bundle: b, Claims: []sched.Claim{{Kind: sched.KindVehicle, Ref: v.Vehicle, Home: v.Unit}}, Window: r.Window,
			ExpiresAt: expires, SourceType: SourceTrip, SourceID: r.Trip, CreatedBy: r.CreatedBy, Now: r.Now, Replaces: replaces,
		}); err != nil {
			return Offer{}, err
		}
		if _, err := tx.Exec(ctx, `update sched.reservations set state = $2, offer_group_id = $3, offered_to = $4,
			offer_kind = $5, choose_until = $6 where bundle_id = $1`, b, state, out.Group, r.Driver, v.Kind, until); err != nil {
			return Offer{}, fmt.Errorf("reservations: offer %s: %w", v.Vehicle, err)
		}
		out.Bundles = append(out.Bundles, b)
	}
	if r.Replaces != uuid.Nil {
		if err := MarkReleased(ctx, tx, r.Replaces, ReasonManager, r.Now); err != nil {
			return Offer{}, err
		}
	}
	return out, linkTrip(ctx, tx, r.Trip, out, choice, r.Vehicles)
}

// linkTrip writes the trip of an offer: assigned with its only (confirmed) vehicle, or planned without a vehicle
// while the driver chooses.
func linkTrip(ctx context.Context, tx pgx.Tx, trip uuid.UUID, o Offer, choice bool, vs []OfferVehicle) error {
	var err error
	if choice || len(o.Bundles) == 0 {
		_, err = tx.Exec(ctx, `update fleet.trips set vehicle_id = null, reservation_bundle_id = null,
			state = case when state = 'assigned' then 'planned' else state end, revision = revision + 1 where id = $1`, trip)
	} else {
		err = AssignTrip(ctx, tx, trip, vs[0].Vehicle, o.Bundles[0])
	}
	if err != nil {
		return fmt.Errorf("reservations: trip of the offer: %w", err)
	}
	return nil
}

// AssignTrip gives the trip the vehicle of a confirmed reservation (bundle): a planned trip becomes assigned.
func AssignTrip(ctx context.Context, tx pgx.Tx, trip, vehicle, bundle uuid.UUID) error {
	if _, err := tx.Exec(ctx, `update fleet.trips set vehicle_id = $2, reservation_bundle_id = $3,
		state = case when state = 'planned' then 'assigned' else state end, revision = revision + 1 where id = $1`,
		trip, vehicle, bundle); err != nil {
		return fmt.Errorf("reservations: vehicle of the trip: %w", err)
	}
	return nil
}

// MarkReleased writes the reason and the moment of the release of the released rows of bundle (the release of sched
// writes the state only); a released reservation is never chosen (tenant 0023 reservations_chosen, Q-W2.71-13).
func MarkReleased(ctx context.Context, tx pgx.Tx, bundle uuid.UUID, reason string, at time.Time) error {
	if _, err := tx.Exec(ctx, `update sched.reservations set released_at = $2, release_reason = $3, chosen_at = null
		 where bundle_id = $1 and state = 'released' and released_at is null`, bundle, at, reason); err != nil {
		return fmt.Errorf("reservations: release reason of %s: %w", bundle, err)
	}
	return nil
}

// Released is a reservation an offer command released: its bundle, its vehicle, the company of the vehicle and its
// offer.
type Released struct {
	Bundle, Vehicle, Unit uuid.UUID
	Group                 *uuid.UUID
}

// releaseLiveSQL releases the live rows of the trip $1 — a hold before its end or of an offer, a confirmed row — only
// those offered to $2 when it is not null, at $3 with the reason $4; the vehicle rows released are returned.
const releaseLiveSQL = `with rel as (
  update sched.reservations r set state = 'released', released_at = $3, release_reason = $4, chosen_at = null,
         revision = r.revision + 1
   where r.source_type = 'fleet.trip' and r.source_id = $1 and ($2::uuid is null or r.offered_to = $2)
     and (r.state = 'confirmed' or (r.state = 'hold' and (r.hold_expires_at > $3 or r.offer_group_id is not null)))
  returning r.bundle_id, r.resource_id, r.offer_group_id)
select rel.bundle_id, s.ref_id, s.home_unit_id, rel.offer_group_id
  from rel join sched.resources s on s.id = rel.resource_id and s.kind = 'vehicle'`

// ReleaseLive releases the live reservations of trip with reason at now — only those offered to person unless it is
// uuid.Nil — and takes the vehicle of a released reservation off the trip that is not started (it goes back to
// planning). The resources of the trip are locked first (LockClaims with extra, the claims the caller holds next).
func ReleaseLive(ctx context.Context, tx pgx.Tx, trip, person uuid.UUID, reason string, now time.Time, extra []sched.Claim) ([]Released, error) {
	if err := sched.LockClaims(ctx, tx, extra, SourceTrip, trip); err != nil {
		return nil, err
	}
	var to any
	if person != uuid.Nil {
		to = person
	}
	rows, err := tx.Query(ctx, releaseLiveSQL, trip, to, now, reason)
	if err != nil {
		return nil, fmt.Errorf("reservations: release of %s: %w", trip, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Released, error) {
		var x Released
		return x, r.Scan(&x.Bundle, &x.Vehicle, &x.Unit, &x.Group)
	})
	if err != nil {
		return nil, fmt.Errorf("reservations: release of %s: %w", trip, err)
	}
	bundles := make([]uuid.UUID, 0, len(out))
	for _, x := range out {
		bundles = append(bundles, x.Bundle)
	}
	if _, err := tx.Exec(ctx, `update fleet.trips set state = 'planned', vehicle_id = null, reservation_bundle_id = null,
		departure_inspection_id = null, revision = revision + 1
		 where id = $1 and reservation_bundle_id = any($2::uuid[]) and state in ('assigned', 'inspection', 'defect_review')`,
		trip, bundles); err != nil {
		return nil, fmt.Errorf("reservations: trip of %s: %w", trip, err)
	}
	return out, nil
}

// confirmSQL confirms the held rows of the bundle $1 at $2 — the chosen reservation holds its vehicle until the end of
// the window; releaseOthersSQL releases the other held rows of its group $3 at $2 with the reason $4.
const (
	confirmSQL = `update sched.reservations set state = 'confirmed', chosen_at = $2, hold_expires_at = upper(during),
	revision = revision + 1 where bundle_id = $1 and state = 'hold'`
	releaseOthersSQL = `with rel as (
  update sched.reservations r set state = 'released', released_at = $2, release_reason = $4, revision = r.revision + 1
   where r.offer_group_id = $3 and r.bundle_id <> $1 and r.state = 'hold'
  returning r.bundle_id, r.resource_id, r.offer_group_id)
select rel.bundle_id, s.ref_id, s.home_unit_id, rel.offer_group_id
  from rel join sched.resources s on s.id = rel.resource_id and s.kind = 'vehicle'`
)

// Confirm confirms the held reservation bundle of group (chosenAt at), releases the other held reservations of the
// group with reason at the same moment and gives trip the vehicle of bundle. The caller locked the trip, the resources
// and the rows of the group (LockGroup) and checked that the choice is open.
func Confirm(ctx context.Context, tx pgx.Tx, trip, group, bundle, vehicle uuid.UUID, reason string, at time.Time) ([]Released, error) {
	if _, err := tx.Exec(ctx, confirmSQL, bundle, at); err != nil {
		return nil, fmt.Errorf("reservations: confirm %s: %w", bundle, err)
	}
	rows, err := tx.Query(ctx, releaseOthersSQL, bundle, at, group, reason)
	if err != nil {
		return nil, fmt.Errorf("reservations: release the offer %s: %w", group, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Released, error) {
		var x Released
		return x, r.Scan(&x.Bundle, &x.Vehicle, &x.Unit, &x.Group)
	})
	if err != nil {
		return nil, fmt.Errorf("reservations: release the offer %s: %w", group, err)
	}
	return out, AssignTrip(ctx, tx, trip, vehicle, bundle)
}

// releaseGroupSQL releases the held rows of the offer $1 at $2 with the reason $3.
const releaseGroupSQL = `with rel as (
  update sched.reservations r set state = 'released', released_at = $2, release_reason = $3, chosen_at = null,
         revision = r.revision + 1
   where r.offer_group_id = $1 and r.state = 'hold'
  returning r.bundle_id, r.resource_id, r.offer_group_id)
select rel.bundle_id, s.ref_id, s.home_unit_id, rel.offer_group_id
  from rel join sched.resources s on s.id = rel.resource_id and s.kind = 'vehicle'`

// ReleaseGroup releases the held reservations of the offer group at the moment at with reason — the deadline of an
// offer whose vehicle of the trip company the logist released before the choice (W2.72 return 1): the usual vehicle
// goes back to its company, the trip stays without a vehicle. The caller locked the trip, the resources and the rows
// of the group (LockGroup).
func ReleaseGroup(ctx context.Context, tx pgx.Tx, group uuid.UUID, reason string, at time.Time) ([]Released, error) {
	rows, err := tx.Query(ctx, releaseGroupSQL, group, at, reason)
	if err != nil {
		return nil, fmt.Errorf("reservations: release the offer %s: %w", group, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Released, error) {
		var x Released
		return x, r.Scan(&x.Bundle, &x.Vehicle, &x.Unit, &x.Group)
	})
	if err != nil {
		return nil, fmt.Errorf("reservations: release the offer %s: %w", group, err)
	}
	return out, nil
}

// Member is a reservation of an offer as LockGroup reads it: the bundle (the row of the vehicle), the vehicle and its
// company, its state, kind and deadline.
type Member struct {
	Bundle, Vehicle, Unit uuid.UUID
	State                 string
	Kind                  string
	ChooseUntil           *time.Time
}

// LockGroup locks the resources and then the rows of the offer group (the order of Hold) and reads its members.
func LockGroup(ctx context.Context, tx pgx.Tx, group uuid.UUID) ([]Member, error) {
	if _, err := tx.Exec(ctx, `select id from sched.resources where id in (select resource_id from sched.reservations
		 where offer_group_id = $1) order by id for update`, group); err != nil {
		return nil, fmt.Errorf("reservations: lock the resources of %s: %w", group, err)
	}
	if _, err := tx.Exec(ctx, `select id from sched.reservations where offer_group_id = $1 order by id for update`, group); err != nil {
		return nil, fmt.Errorf("reservations: lock the offer %s: %w", group, err)
	}
	rows, err := tx.Query(ctx, `select r.bundle_id, s.ref_id, s.home_unit_id, r.state, coalesce(r.offer_kind, ''), r.choose_until
		  from sched.reservations r join sched.resources s on s.id = r.resource_id and s.kind = 'vehicle'
		 where r.offer_group_id = $1 order by r.bundle_id`, group)
	if err != nil {
		return nil, fmt.Errorf("reservations: offer %s: %w", group, err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Member, error) {
		var m Member
		return m, r.Scan(&m.Bundle, &m.Vehicle, &m.Unit, &m.State, &m.Kind, &m.ChooseUntil)
	})
	if err != nil {
		return nil, fmt.Errorf("reservations: offer %s: %w", group, err)
	}
	return out, nil
}

// Open reports whether the reservation bundle of an offer may be chosen at now: it is held, no reservation of the offer
// is confirmed or consumed (the choice is not made) and the deadline has not come. A reservation the logist released
// before the choice (releaseReservation, W2.72 return 1) does not close the offer: the remaining one is chosen or
// settled at the deadline.
func Open(members []Member, bundle uuid.UUID, now time.Time) bool {
	open := false
	for _, m := range members {
		switch {
		case m.State == sched.StateConfirmed || m.State == sched.StateConsumed:
			return false
		case m.Bundle == bundle:
			open = m.State == sched.StateHold && (m.ChooseUntil == nil || now.Before(*m.ChooseUntil))
		}
	}
	return open
}

// OfferEvent is what the audit row and the outbox event of a reservation of an offer carry (no restricted field,
// AC-05).
type OfferEvent struct {
	Reservation, Vehicle, Unit, Trip uuid.UUID
	Group                            *uuid.UUID
	Driver                           uuid.UUID
	Kind, Reason                     string
	Extra                            map[string]any
}

// Audit actions of the reservations of an offer.
const (
	ActionHold    = "fleet.reservation.hold"
	ActionConfirm = "fleet.reservation.confirm"
	ActionRelease = "fleet.reservation.release"
)

// RecordOffer writes the audit row action and the outbox event typ of a reservation of an offer and returns the id of
// the event.
func RecordOffer(ctx context.Context, tx pgx.Tx, action, typ string, e OfferEvent) (uuid.UUID, error) {
	diff := map[string]any{"vehicleId": e.Vehicle, "tripId": e.Trip}
	if e.Group != nil {
		diff["offerGroupId"] = *e.Group
	}
	if e.Driver != uuid.Nil {
		diff["offeredToMemberId"] = e.Driver
	}
	if e.Kind != "" {
		diff["offerKind"] = e.Kind
	}
	if e.Reason != "" {
		diff["reason"] = e.Reason
	}
	maps.Copy(diff, e.Extra)
	if err := kit.Audit(ctx, tx, audit.Event{Action: action, TargetType: targetReservation, TargetID: e.Reservation,
		UnitID: e.Unit, Diff: diff}); err != nil {
		return uuid.Nil, err
	}
	payload := map[string]any{"reservationId": e.Reservation, "unitId": e.Unit}
	maps.Copy(payload, diff)
	id, err := events.Publish(ctx, tx, events.Event{Type: typ, Aggregate: targetReservation, AggregateID: e.Reservation,
		Payload: payload})
	if err != nil {
		return uuid.Nil, fmt.Errorf("reservations: event %s: %w", typ, err)
	}
	return id, nil
}
