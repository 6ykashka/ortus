package routes

// W2.72 (S2-20 «Машина для временного водителя», правила 8–9; контракт assignTripVehicle 0.6.3-stage2, Q-W2.70-1,
// Q-W2.70-6): the logist offers the driver of the trip a second vehicle (alternativeVehicleId — one offer of two
// vehicles, held until the deadline of the choice, the trip waits for the choice without a vehicle), and on a trip of a
// temporary driver of the pool the vehicle he puts is confirmed at once for the window of the trip — «Поставить
// машину» of «Требует решения» and the change of the vehicle after the choice. The earlier reservations of the trip are
// released with releaseReason manager.

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/domain/fleetrules"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/offers"   //nolint:depguard // W2.72: the reservations of an offer of the same module
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/vehicles" //nolint:depguard // W2.03: a trip holds a vehicle of the same module (W2.02)
	"github.com/ortus/ortus-crm/backend/internal/modules/sched"          //nolint:depguard // W2.03: the scheduling core the trips hold their vehicles through (W2.02)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// chooseBefore is how long before the start of the trip window the choice of the driver closes (docs/29 rule 4,
// TD-02; pool.ChooseBefore).
const chooseBefore = 30 * time.Minute

// Texts and violations of the second vehicle (the MSW of W2.71, fleet/trips.ts alternativeOf).
const textAlternative = "Проверьте вторую машину."

var (
	violationAltDriver = fleetapi.ProblemViolation{Field: "alternativeVehicleId", Code: "driver",
		Message: "Сначала назначьте водителя рейса"}
	violationAltSame = fleetapi.ProblemViolation{Field: "alternativeVehicleId", Code: "same", Message: "Выберите другую машину"}
)

// checkAlternative checks the second vehicle of an assignment before the vehicles are read: the trip needs a driver,
// the vehicle is another one.
func checkAlternative(t tripRow, vehicle uuid.UUID, alt *uuid.UUID) error {
	switch {
	case alt == nil:
		return nil
	case t.driver == nil:
		return invalidField(textAlternative, violationAltDriver)
	case *alt == vehicle:
		return invalidField(textAlternative, violationAltSame)
	}
	return nil
}

// place holds vehicle id (and the second vehicle alt) for trip t: an offer to the driver of the trip with a second
// vehicle or on a trip of a temporary driver of the pool, a plain assignment otherwise.
func (c command) place(ctx context.Context, t tripRow, id uuid.UUID, alt *uuid.UUID) error {
	v, err := c.assignable(ctx, t, id)
	if err != nil {
		return err
	}
	var second *vehicles.Row
	if alt != nil {
		a, err := c.assignable(ctx, t, *alt)
		if err != nil {
			return err
		}
		second = &a
	}
	temporary, err := c.temporary(ctx, t)
	if err != nil {
		return err
	}
	if t.driver != nil && (second != nil || temporary) {
		return c.offer(ctx, t, v, second)
	}
	return c.plain(ctx, t, v)
}

// assignable reads vehicle id for trip t: visible (404), fitting the cargo (409 vehicle_incompatible) and free (409
// reservation_overlap).
func (c command) assignable(ctx context.Context, t tripRow, id uuid.UUID) (vehicles.Row, error) {
	v, err := c.vehicle(ctx, id)
	if err != nil {
		return vehicles.Row{}, err
	}
	if fit := fleetrules.Compat(v.Rules(), t.rules()); !fit.Fit {
		return vehicles.Row{}, problem.New(codeIncompatible, textIncompatiblePre+strings.Join(misfits(fit), "; "))
	}
	return v, c.free(ctx, v, t)
}

// temporary reports whether the driver of t drives it by an approved transfer of the pool (W2.57).
func (c command) temporary(ctx context.Context, t tripRow) (bool, error) {
	if t.driver == nil {
		return false, nil
	}
	var ok bool
	err := c.tx.QueryRow(ctx, `select exists (select 1 from fleet.driver_transfers x
		  join fleet.pool_publications p on p.id = x.publication_id
		 where x.trip_id = $1 and p.person_id = $2 and x.state = 'approved')`, t.id, *t.driver).Scan(&ok)
	return ok, err
}

// offer releases the live reservations of trip t (manager) and offers its driver v — with alt, until the deadline of
// the choice; alone or after the deadline, confirmed at once.
func (c command) offer(ctx context.Context, t tripRow, v vehicles.Row, alt *vehicles.Row) error {
	vs := []offers.OfferVehicle{{Vehicle: v.ID, Unit: v.Unit, Kind: offers.OfferHost}}
	deadline := t.from.Add(-chooseBefore)
	if alt != nil && c.now.Before(deadline) {
		vs = append(vs, offers.OfferVehicle{Vehicle: alt.ID, Unit: alt.Unit, Kind: offers.OfferUsual})
	}
	req := offers.OfferRequest{Trip: t.id, Window: sched.Window{Start: t.from, End: t.until}, Driver: *t.driver,
		Vehicles: vs, CreatedBy: c.tc.PersonID, Now: c.now}
	if len(vs) > 1 {
		req.ChooseUntil = deadline
	}
	released, err := offers.ReleaseLive(ctx, c.tx, t.id, uuid.Nil, offers.ReasonManager, c.now, req.Claims())
	if err != nil {
		return err
	}
	o, err := offers.HoldOffer(ctx, c.tx, req)
	if _, ok := errors.AsType[*sched.OverlapError](err); ok {
		return problem.New(codeOverlap, textVehicleTaken)
	}
	if err != nil {
		return err
	}
	if err := recordReleased(ctx, c, t, released); err != nil {
		return err
	}
	action, typ := offers.ActionConfirm, offers.EventConfirmed
	if len(vs) > 1 {
		action, typ = offers.ActionHold, offers.EventHeld
	}
	for i, x := range vs {
		extra := map[string]any{"startsAt": t.from, "endsAt": t.until}
		if len(vs) > 1 {
			extra["chooseUntil"] = deadline
		}
		if _, err := offers.RecordOffer(ctx, c.tx, action, typ, offers.OfferEvent{
			Reservation: o.Bundles[i], Vehicle: x.Vehicle, Unit: x.Unit, Trip: t.id, Group: &o.Group, Driver: *t.driver,
			Kind: x.Kind, Extra: extra,
		}); err != nil {
			return err
		}
	}
	return nil
}

// recordReleased writes the release of the reservations of t an assignment took the place of (releaseReason manager).
func recordReleased(ctx context.Context, c command, t tripRow, released []offers.Released) error {
	for _, r := range released {
		var to uuid.UUID
		if t.driver != nil {
			to = *t.driver
		}
		if _, err := offers.RecordOffer(ctx, c.tx, offers.ActionRelease, offers.EventReleased,
			offers.OfferEvent{Reservation: r.Bundle, Vehicle: r.Vehicle, Unit: r.Unit, Trip: t.id, Group: r.Group,
				Driver: to, Reason: offers.ReasonManager}); err != nil {
			return err
		}
	}
	return nil
}

// plain holds v for t as W2.03 does (with the driver of the trip, until the TTL of the module), after the reservations
// of an offer of the trip are released (manager): a plain assignment in place of an offer.
func (c command) plain(ctx context.Context, t tripRow, v vehicles.Row) error {
	released, err := c.releaseOffers(ctx, t, v)
	if err != nil {
		return err
	}
	if len(released) > 0 {
		t.prior = nil // the live rows of the trip are released: the hold has nothing to replace
	}
	if err := recordReleased(ctx, c, t, released); err != nil {
		return err
	}
	b, err := c.hold(ctx, t, v)
	if err != nil {
		return err
	}
	return c.recordHold(ctx, b)
}

// releaseOffers releases the live reservations of an offer of trip t other than its own hold (the hold of the trip is
// replaced inside sched.Hold).
func (c command) releaseOffers(ctx context.Context, t tripRow, v vehicles.Row) ([]offers.Released, error) {
	var offered bool
	if err := c.tx.QueryRow(ctx, `select exists (select 1 from sched.reservations where source_type = 'fleet.trip'
		 and source_id = $1 and offer_group_id is not null and state in ('hold', 'confirmed'))`, t.id).Scan(&offered); err != nil {
		return nil, err
	}
	if !offered {
		return nil, nil
	}
	claims := []sched.Claim{{Kind: sched.KindVehicle, Ref: v.ID, Home: v.Unit}}
	return offers.ReleaseLive(ctx, c.tx, t.id, uuid.Nil, offers.ReasonManager, c.now, claims)
}
