package pool

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/offers"       //nolint:depguard // W2.72: the reservations of an offer of the same module
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/reservations" //nolint:depguard // W2.72: the reservations of an offer of the same module
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit"            //nolint:depguard // W2.07: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Choose confirms one of the reservations offered for a trip (chooseReservation, docs/29 «Данные и API»): the driver
// it is offered to (fleet.reservations.choose, scope self — his trip) or the logist of the trip company
// (fleet.reservations.manage over the unit of the trip, «Оставить …»). Under the locks of the trip, the resources and
// the rows of the offer the reservation becomes confirmed (chosenAt), the others are released (chosen by the driver,
// manager by the logist) and the trip gets the vehicle. Not offered, invisible or missing — 404 «Бронь не найдена.»;
// a choice made, a released reservation or the deadline passed — 409 offer_closed, nothing changes.
func (s *Service) Choose(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (fleetapi.ReservationChoice, error) {
	var out fleetapi.ReservationChoice
	err := s.run(ctx, tc, func(c *cmd) error {
		var err error
		out, err = c.choose(ctx, id)
		return err
	})
	return out, err
}

// offerRef is the reservation of an offer chooseReservation names.
type offerRef struct {
	bundle, trip uuid.UUID
	group, to    *uuid.UUID
}

func (c *cmd) choose(ctx context.Context, id uuid.UUID) (fleetapi.ReservationChoice, error) {
	notFound := problem.New(problem.CodeNotFound, textReservationNotFound)
	var r offerRef
	err := c.tx.QueryRow(ctx, `select r.bundle_id, r.source_id, r.offer_group_id, r.offered_to
		  from sched.reservations r join sched.resources s on s.id = r.resource_id and s.kind = 'vehicle'
		 where (r.id = $1 or r.bundle_id = $1) and r.source_type = 'fleet.trip' limit 1`, id).
		Scan(&r.bundle, &r.trip, &r.group, &r.to)
	if errNoRows(err) {
		return fleetapi.ReservationChoice{}, notFound
	}
	if err != nil {
		return fleetapi.ReservationChoice{}, err
	}
	t, err := loadTripCargo(ctx, c.tx, r.trip, true)
	if problem.Is(err, problem.CodeNotFound) {
		return fleetapi.ReservationChoice{}, notFound
	}
	if err != nil {
		return fleetapi.ReservationChoice{}, err
	}
	driver, err := c.chooser(ctx, r, t)
	if err != nil {
		return fleetapi.ReservationChoice{}, err
	}
	members, err := offers.LockGroup(ctx, c.tx, *r.group)
	if err != nil {
		return fleetapi.ReservationChoice{}, err
	}
	chosen, ok := member(members, r.bundle)
	if !ok || !offers.Open(members, r.bundle, c.now) {
		return fleetapi.ReservationChoice{}, problem.New(codeOfferClosed, textOfferClosed)
	}
	reason := offers.ReasonManager
	if driver {
		reason = offers.ReasonChosen
	}
	released, err := c.confirm(ctx, t, *r.group, chosen, *r.to, reason, c.now)
	if err != nil {
		return fleetapi.ReservationChoice{}, err
	}
	if err := c.notifyChoice(ctx, t, chosen, released, driver); err != nil {
		return fleetapi.ReservationChoice{}, err
	}
	out, err := choice(ctx, c.tx, chosen.Bundle, released, c.now)
	if err != nil {
		return fleetapi.ReservationChoice{}, err
	}
	return out, kit.Complete(ctx, c.tx, 200, "", out)
}

// chooser decides who chooses reservation r of trip t: its driver (true) — offered to the actor, the trip his and
// fleet.reservations.choose over him; the logist of the trip company (false) — fleet.reservations.manage over the
// unit of the trip. Anyone else, and a reservation outside an offer — 404.
func (c *cmd) chooser(ctx context.Context, r offerRef, t tripCargo) (bool, error) {
	notFound := problem.New(problem.CodeNotFound, textReservationNotFound)
	if r.group == nil || r.to == nil {
		return false, notFound
	}
	me := c.tc.PersonID
	if !c.tc.Owner && *r.to == me && t.driver != nil && *t.driver == me {
		err := c.ev.Permit(ctx, c.tc, actionChoose, authz.Resource{Unit: t.unit, Persons: []uuid.UUID{me}})
		switch {
		case err == nil:
			return true, nil
		case !problem.Is(err, problem.CodeNotFound) && !problem.Is(err, problem.CodeForbiddenAction):
			return false, err
		}
	}
	err := c.ev.Permit(ctx, c.tc, actionManage, authz.Resource{Unit: t.unit})
	switch {
	case err == nil:
		return false, nil
	case problem.Is(err, problem.CodeNotFound), problem.Is(err, problem.CodeForbiddenAction):
		return false, notFound
	}
	return false, err
}

// member is the member of the offer whose bundle is b.
func member(members []offers.Member, b uuid.UUID) (offers.Member, bool) {
	for _, m := range members {
		if m.Bundle == b {
			return m, true
		}
	}
	return offers.Member{}, false
}

// confirm confirms chosen of the offer group of trip t at the moment at with reason for the others, closes the
// offered vehicles released for the driver to (at now), settles the transfers of the trip (the grant of its vehicle)
// and writes the audit and the events.
func (c *cmd) confirm(ctx context.Context, t tripCargo, group uuid.UUID, chosen offers.Member, to uuid.UUID,
	reason string, at time.Time) ([]offers.Released, error) {
	released, err := offers.Confirm(ctx, c.tx, t.id, group, chosen.Bundle, chosen.Vehicle, reason, at)
	if err != nil {
		return nil, err
	}
	vs := make([]uuid.UUID, 0, len(released))
	for _, r := range released {
		vs = append(vs, r.Vehicle)
	}
	ids, err := transfersOfTrip(ctx, c.tx, t.id, to)
	if err != nil {
		return nil, err
	}
	if _, err := closeOfferGrants(ctx, c.tx, to, ids, vs, c.now); err != nil {
		return nil, err
	}
	if _, err := SettleTripTx(ctx, c.tx, c.tc.TenantID, t.id, c.now); err != nil {
		return nil, err
	}
	if _, err := realtime.BumpPolicy(ctx, c.tx, c.tc.TenantID, []uuid.UUID{to}, "fleet.reservation.choose"); err != nil {
		return nil, err
	}
	g := group
	if _, err := offers.RecordOffer(ctx, c.tx, offers.ActionConfirm, offers.EventConfirmed,
		offers.OfferEvent{Reservation: chosen.Bundle, Vehicle: chosen.Vehicle, Unit: chosen.Unit, Trip: t.id,
			Group: &g, Driver: to, Kind: chosen.Kind, Reason: reason, Extra: map[string]any{"chosenAt": at}}); err != nil {
		return nil, err
	}
	for _, r := range released {
		if _, err := offers.RecordOffer(ctx, c.tx, offers.ActionRelease, offers.EventReleased,
			offers.OfferEvent{Reservation: r.Bundle, Vehicle: r.Vehicle, Unit: r.Unit, Trip: t.id, Group: &g,
				Driver: to, Reason: reason}); err != nil {
			return nil, err
		}
	}
	return released, nil
}

// choice is the answer of chooseReservation: the chosen reservation and the released ones at now.
func choice(ctx context.Context, q pgx.Tx, chosen uuid.UUID, released []offers.Released, now time.Time) (fleetapi.ReservationChoice, error) {
	out := fleetapi.ReservationChoice{Released: make([]fleetapi.Reservation, 0, len(released))}
	var err error
	if out.Chosen, err = reservations.Load(ctx, q, chosen, now); err != nil {
		return fleetapi.ReservationChoice{}, err
	}
	for _, r := range released {
		x, err := reservations.Load(ctx, q, r.Bundle, now)
		if err != nil {
			return fleetapi.ReservationChoice{}, err
		}
		out.Released = append(out.Released, x)
	}
	return out, nil
}

// notifyChoice tells the company of every vehicle of another company than the trip («машина выбрана» or «машина
// освобождена»: fleet.reservations.manage over the unit of the vehicle) and, when the driver chose, the logists of the
// trip («водитель выбрал»: fleet.routes.manage over the unit of the trip).
func (c *cmd) notifyChoice(ctx context.Context, t tripCargo, chosen offers.Member, released []offers.Released, driver bool) error {
	name, err := vehicleName(ctx, c.tx, chosen.Vehicle)
	if err != nil {
		return err
	}
	if chosen.Unit != t.unit {
		if err := c.notifyUnit(ctx, chosen.Unit, actionManage, noticeConfirmed,
			"Машина "+name+" выбрана на рейс "+t.number, t.id); err != nil {
			return err
		}
	}
	if err := c.notifyReleased(ctx, t, released); err != nil {
		return err
	}
	if !driver {
		return nil
	}
	return c.notifyUnit(ctx, t.unit, actionPlan, noticeConfirmed, "Водитель выбрал машину на рейс "+t.number+": "+name, t.id)
}

// notifyReleased tells the company of every released vehicle of another company than the trip «машина освобождена»
// (fleet.reservations.manage over the unit of the vehicle).
func (c *cmd) notifyReleased(ctx context.Context, t tripCargo, released []offers.Released) error {
	for _, r := range released {
		if r.Unit == t.unit {
			continue
		}
		name, err := vehicleName(ctx, c.tx, r.Vehicle)
		if err != nil {
			return err
		}
		if err := c.notifyUnit(ctx, r.Unit, actionManage, noticeReleased,
			"Машина "+name+" освобождена: рейс "+t.number, t.id); err != nil {
			return err
		}
	}
	return nil
}

// vehicleName is «{модель} {номер}» of vehicle id.
func vehicleName(ctx context.Context, q pgx.Tx, id uuid.UUID) (string, error) {
	var name string
	err := q.QueryRow(ctx, `select coalesce(display_name, plate) || ' ' || plate from fleet.vehicles where id = $1`, id).Scan(&name)
	if err != nil {
		return "", fmt.Errorf("pool: vehicle %s: %w", id, err)
	}
	return name, nil
}

// SettleOffers closes the offers of the tenant whose deadline of the choice came at the clock of the service without a
// choice (docs/29 rule 4): the vehicle of the trip company is confirmed (chosenAt — the deadline), the usual vehicle is
// released (deadline) and its company is told. One transaction per offer; it returns how many offers it closed. The
// worker runs it on the schedule of the pool (cmd/worker), as ortus_worker.
func (s *Service) SettleOffers(ctx context.Context, tenantID uuid.UUID) (int, error) {
	db, err := s.Pools.For(ctx, tenantID)
	if err != nil {
		return 0, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	now := s.now()
	rows, err := db.Query(ctx, `select distinct offer_group_id, source_id from sched.reservations
		 where state = 'hold' and choose_until is not null and choose_until <= $1 and source_type = 'fleet.trip'`, now)
	if err != nil {
		return 0, fmt.Errorf("pool: due offers of %s: %w", tenantID, err)
	}
	type due struct{ group, trip uuid.UUID }
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (due, error) {
		var d due
		return d, r.Scan(&d.group, &d.trip)
	})
	if err != nil {
		return 0, fmt.Errorf("pool: due offers of %s: %w", tenantID, err)
	}
	tc := tenantctx.TenantContext{TenantID: tenantID}
	n := 0
	var errs []error
	for _, d := range list {
		closed := false
		err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
			c := &cmd{s: s, tx: tx, tc: tc, now: now}
			if s.Authz != nil {
				c.ev = s.within(tx, now)
			}
			var err error
			closed, err = c.deadline(ctx, d.group, d.trip)
			return err
		})
		switch {
		case err != nil:
			errs = append(errs, fmt.Errorf("pool: offer %s: %w", d.group, err))
		case closed:
			n++
		}
	}
	return n, errors.Join(errs...)
}

// deadline closes offer group of trip at its deadline: under the locks of the trip, the resources and the rows, an
// offer still open with a held vehicle of the trip company whose deadline came.
func (c *cmd) deadline(ctx context.Context, group, trip uuid.UUID) (bool, error) {
	t, err := loadTripCargo(ctx, c.tx, trip, true)
	if err != nil {
		return false, err
	}
	members, err := offers.LockGroup(ctx, c.tx, group)
	if err != nil {
		return false, err
	}
	held, ok := due(members, c.now)
	if !ok {
		return false, nil
	}
	var to uuid.UUID
	if err := c.tx.QueryRow(ctx, `select offered_to from sched.reservations where id = $1`, held.Bundle).Scan(&to); err != nil {
		return false, err
	}
	if held.Kind != offers.OfferHost {
		// The logist released the vehicle of the trip company before the choice: no vehicle of the logist to keep, the
		// remaining ones go back to their companies (rule 4), the trip waits for a vehicle («Требует решения»).
		released, err := c.lapse(ctx, t, group, to, *held.ChooseUntil)
		if err != nil {
			return false, err
		}
		return true, c.notifyReleased(ctx, t, released)
	}
	released, err := c.confirm(ctx, t, group, held, to, offers.ReasonDeadline, *held.ChooseUntil)
	if err != nil {
		return false, err
	}
	return true, c.notifyReleased(ctx, t, released)
}

// lapse releases the held reservations of the offer group of trip t at its deadline at (deadline), closes their
// vehicles for the driver to and writes the audit and the events.
func (c *cmd) lapse(ctx context.Context, t tripCargo, group, to uuid.UUID, at time.Time) ([]offers.Released, error) {
	released, err := offers.ReleaseGroup(ctx, c.tx, group, offers.ReasonDeadline, at)
	if err != nil {
		return nil, err
	}
	vs := make([]uuid.UUID, 0, len(released))
	for _, r := range released {
		vs = append(vs, r.Vehicle)
	}
	ids, err := transfersOfTrip(ctx, c.tx, t.id, to)
	if err != nil {
		return nil, err
	}
	if _, err := closeOfferGrants(ctx, c.tx, to, ids, vs, c.now); err != nil {
		return nil, err
	}
	if _, err := realtime.BumpPolicy(ctx, c.tx, c.tc.TenantID, []uuid.UUID{to}, "fleet.reservation.deadline"); err != nil {
		return nil, err
	}
	g := group
	for _, r := range released {
		if _, err := offers.RecordOffer(ctx, c.tx, offers.ActionRelease, offers.EventReleased,
			offers.OfferEvent{Reservation: r.Bundle, Vehicle: r.Vehicle, Unit: r.Unit, Trip: t.id, Group: &g,
				Driver: to, Reason: offers.ReasonDeadline}); err != nil {
			return nil, err
		}
	}
	return released, nil
}

// due is the held reservation of an offer still open whose deadline of the choice came at now: the vehicle of the trip
// company (confirmed at the deadline), or — when the logist released it before the choice — another held one (the
// offer lapses).
func due(members []offers.Member, now time.Time) (offers.Member, bool) {
	var held *offers.Member
	for i, m := range members {
		switch {
		case m.State == stateConfirmed || m.State == stateConsumed:
			return offers.Member{}, false
		case m.State != stateHold:
		case m.Kind == offers.OfferHost, held == nil:
			held = &members[i]
		}
	}
	if held == nil || held.ChooseUntil == nil || now.Before(*held.ChooseUntil) {
		return offers.Member{}, false
	}
	return *held, true
}

// notifyUnit tells the holders of action over unit and the owners (the candidates of the decision) about trip — kind,
// title — checked by the audience when enqueued (W1.10). Without the recipients, the audience or the evaluator nothing
// is sent.
func (c *cmd) notifyUnit(ctx context.Context, unit uuid.UUID, action, kind, title string, trip uuid.UUID) error {
	s := c.s
	if s.Recipients == nil || s.Audience == nil || c.ev == nil {
		return nil
	}
	audience := s.Audience
	if _, ok := audience.(inbox.AuthzAudience); ok {
		audience = inbox.AuthzAudience{E: c.ev}
	}
	people, err := c.holders(ctx, action)
	if err != nil {
		return err
	}
	n := inbox.Notice{Kind: kind, Severity: inbox.SeverityInfo, Title: title,
		Object: &inbox.Object{ModuleKey: "fleet", EntityType: "trip", EntityID: trip}, Unit: unit, Permission: action}
	for _, p := range people {
		if err := c.enqueue(ctx, audience, p, n); err != nil {
			return err
		}
	}
	return nil
}

// notifyPerson tells person about trip (a notice without a permission: the driver of the trip).
func (c *cmd) notifyPerson(ctx context.Context, person uuid.UUID, kind, title string, trip, event uuid.UUID) error {
	s := c.s
	if s.Recipients == nil || s.Audience == nil {
		return nil
	}
	return c.enqueue(ctx, s.Audience, person, inbox.Notice{Kind: kind, Severity: inbox.SeverityInfo, Title: title,
		Object: &inbox.Object{ModuleKey: "fleet", EntityType: "trip", EntityID: trip}, SourceEvent: event})
}

// enqueue resolves person through the control DB and enqueues n for him in the transaction; a person without an
// active membership gets nothing.
func (c *cmd) enqueue(ctx context.Context, aud inbox.Audience, person uuid.UUID, n inbox.Notice) error {
	to, err := c.s.Recipients.Recipient(ctx, c.tc.TenantID, person)
	if errors.Is(err, inbox.ErrNoRecipient) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("pool: recipient: %w", err)
	}
	if _, _, err := inbox.Enqueue(ctx, c.tx, aud, to, n); err != nil {
		return fmt.Errorf("pool: notify: %w", err)
	}
	return nil
}

// NotifyAssigned tells the temporary driver of trip that the logist put a vehicle on it (assignTripVehicle on a trip
// of an approved transfer: «машину поставили», two vehicles — «выберите машину»); the trip of a driver of the company
// gets nothing (his inbox shows the trip as before).
func (s *Service) NotifyAssigned(ctx context.Context, tc tenantctx.TenantContext, trip uuid.UUID) error {
	if s.Recipients == nil || s.Audience == nil || tc.TenantID == uuid.Nil {
		return nil
	}
	db, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return err
	}
	now := s.now()
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		c := &cmd{s: s, tx: tx, ev: s.within(tx, now), tc: tc, now: now}
		var (
			number string
			driver uuid.UUID
			count  int
			first  *uuid.UUID
		)
		err := tx.QueryRow(ctx, `select t.number, t.driver_person_id,
			(select count(*) from sched.reservations r where r.source_type = 'fleet.trip' and r.source_id = t.id
			    and r.offered_to = t.driver_person_id and r.bundle_id = r.id and r.state in ('hold', 'confirmed')),
			(select s.ref_id from sched.reservations r join sched.resources s on s.id = r.resource_id and s.kind = 'vehicle'
			  where r.source_type = 'fleet.trip' and r.source_id = t.id and r.offered_to = t.driver_person_id
			    and r.state in ('hold', 'confirmed') order by r.offer_kind limit 1)
			  from fleet.trips t
			 where t.id = $1 and t.driver_person_id is not null and exists (select 1 from fleet.driver_transfers x
			   join fleet.pool_publications p on p.id = x.publication_id
			  where x.trip_id = t.id and p.person_id = t.driver_person_id and x.state = 'approved')`, trip).
			Scan(&number, &driver, &count, &first)
		if errNoRows(err) || (err == nil && (count == 0 || first == nil)) {
			return nil
		}
		if err != nil {
			return err
		}
		kind, title := noticeHeld, "Выберите машину на рейс "+number
		if count == 1 {
			name, err := vehicleName(ctx, tx, *first)
			if err != nil {
				return err
			}
			kind, title = noticeConfirmed, "Машину поставили на рейс "+number+": "+name
		}
		return c.notifyPerson(ctx, driver, kind, title, trip, uuid.Nil)
	})
}
