package pool

// W2.72 (S2-20 «Машина для временного водителя», D-35 комплекта; docs/29 «Решение», «Правила» 1–10, «Данные и API»;
// контракт 0.7.1-stage4 W2.71, tenant 0023): the vehicle of a pool request. The logist names the vehicle in the request
// (home — the usual vehicle of the publication, host — a vehicle of the trip company, host_or_home — both, the driver
// chooses); the home company decides on the driver and the usual vehicle (approve, approve_driver_only); the approval
// creates in its transaction the reservations of the offer (offers.HoldOffer): two vehicles are held until the
// deadline of the choice (the start of the trip window − 30 minutes, TD-02), one vehicle is confirmed at once. The
// driver — or the logist of the trip company («Оставить …») — chooses one (chooseReservation): it is confirmed, the
// others are released at once (TD-04). At the deadline the scheduler keeps the vehicle of the trip company and returns
// the usual one to its company (SettleOffers). From the approval the driver reads his trip, the reservations offered to
// him and their vehicles (rows of scope resource) and chooses; everything else of the trip opens with the window
// (AccessPrepare, Q-W2.71-3). A transfer that ends before the trip starts releases its offer (transfer_ended).

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/domain/fleetrules"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/offers"   //nolint:depguard // W2.72: the reservations of an offer of the same module
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/vehicles" //nolint:depguard // W2.72: the vehicles of a request of the same module
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit"        //nolint:depguard // W2.07: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/modules/sched"          //nolint:depguard // W2.72: the scheduling core of the reservations of an offer
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// ChooseBefore is how long before the start of the trip window the choice among the offered vehicles closes
// (docs/29 rule 4, TD-02: fixed 30 minutes).
const ChooseBefore = 30 * time.Minute

// AccessPrepare: the grant of a transfer of S2-20 is scheduled — before the window the driver reads his trip and the
// reservations offered to him and chooses (Q-W2.71-3); everything else of the trip answers 404.
const AccessPrepare Access = AccessNone + 1

// prepareOps are the operations of the tag Fleet on the trip of an S2-20 transfer open to its driver before the
// window: the trip, its reservations and the choice.
var prepareOps = map[string]bool{"getTrip": true, "getTripPlan": true, "getReservation": true, "chooseReservation": true}

// Prepares reports whether operation op is open to the driver before the window of an S2-20 transfer.
func Prepares(op string) bool { return prepareOps[op] }

// Actions and codes of S2-20 (api/permissions.yaml, api/errors.yaml).
const (
	actionVehiclesRead = "fleet.vehicles.read"
	actionChoose       = "fleet.reservations.choose"
	actionManage       = "fleet.reservations.manage"
	actionPlan         = "fleet.routes.manage"
	codeOfferClosed    = "offer_closed"
	codeIncompatible   = "vehicle_incompatible"
	codeOverlap        = "reservation_overlap"
)

// Vehicle modes of a request (DriverTransferVehicleCreate.mode) and decisions on the usual vehicle.
const (
	modeHome         = string(fleetapi.DriverTransferVehicleModeHome)
	modeHost         = string(fleetapi.DriverTransferVehicleModeHost)
	homeApproved     = string(fleetapi.DriverTransferVehicleHomeDecisionApproved)
	homeDeclined     = string(fleetapi.DriverTransferVehicleHomeDecisionDeclined)
	stateHold        = sched.StateHold
	stateConfirmed   = sched.StateConfirmed
	stateConsumed    = sched.StateConsumed
	noticeHeld       = "fleet.reservation.held"
	noticeConfirmed  = "fleet.reservation.confirmed"
	noticeReleased   = "fleet.reservation.released"
	offerGrantSuffix = " · предложенная машина"
)

// Texts of S2-20 (no reference, Q-W2.70-13: the MSW of W2.71 — fleet/offers.ts, @ortus/texts).
const (
	textOfferClosed     = "Выбор машины уже закрыт."
	textVehicleNotFound = "Машина не найдена."
	textCheckTrip       = "Проверьте рейс."
	textCheckVehicle    = "Проверьте машину."
	textCheckDecision   = "Проверьте решение."
	textRejectReason    = "Укажите причину отказа."
	textNotFit          = "Машина не подходит рейсу: "
	textBusy            = "Машина занята на время рейса. Обновите список."
)

// Violations of the bodies of S2-20 (MSW fleet/pool.ts, OFFER_TEXT).
var (
	violationTripRequired = fleetapi.ProblemViolation{Field: "tripId", Code: "required", Message: "Машину запрашивают на рейс"}
	violationHostRequired = fleetapi.ProblemViolation{Field: "vehicle.hostVehicleId", Code: "required",
		Message: "Выберите машину фирмы рейса"}
	violationHostWithHome = fleetapi.ProblemViolation{Field: "vehicle.hostVehicleId", Code: "home",
		Message: "Машину фирмы рейса не указывают для своей обычной"}
	violationNoUsual = fleetapi.ProblemViolation{Field: "vehicle.mode", Code: "usual_vehicle",
		Message: "У водителя нет обычной машины"}
	violationUsualVehicle = fleetapi.ProblemViolation{Field: "usualVehicleId", Code: "vehicle",
		Message: "Нужна машина фирмы водителя"}
	violationDriverOnly = fleetapi.ProblemViolation{Field: "decision", Code: "usual_vehicle",
		Message: "Обычную машину не запрашивали"}
	violationReason = fleetapi.ProblemViolation{Field: "comment", Code: "required", Message: "Укажите причину отказа"}
)

// usualAsked reports whether the request of x asked for the usual vehicle of the driver (home, host_or_home).
func (x transfer) usualAsked() bool { return x.mode != nil && *x.mode != modeHost }

// tripCargo is a trip as an offer reads it: its company, number, state, driver, earlier hold, window and cargo.
type tripCargo struct {
	id, unit      uuid.UUID
	number, state string
	driver, prior *uuid.UUID
	window        Window
	rules         fleetrules.Trip
}

// loadTripCargo reads trip id (lock: for update); missing — 404 «Рейс не найден.».
func loadTripCargo(ctx context.Context, q pgx.Tx, id uuid.UUID, lock bool) (tripCargo, error) {
	var (
		t                          tripCargo
		weightKg, volumeM3, length float64
		tempMin, tempMax           *float64
	)
	sql := `select t.id, t.unit_id, t.number, t.state, t.driver_person_id, t.reservation_bundle_id, lower(t.planned),
	       upper(t.planned), t.cargo_weight_kg::float8, t.cargo_volume_m3::float8,
	       (coalesce(t.cargo_length_mm, 0) / 1000.0)::float8, t.cargo_temp_min_c::float8, t.cargo_temp_max_c::float8
	  from fleet.trips t where t.id = $1`
	if lock {
		sql += ` for update`
	}
	err := q.QueryRow(ctx, sql, id).Scan(&t.id, &t.unit, &t.number, &t.state, &t.driver, &t.prior, &t.window.Start,
		&t.window.End, &weightKg, &volumeM3, &length, &tempMin, &tempMax)
	if errNoRows(err) {
		return tripCargo{}, problem.New(problem.CodeNotFound, textTripNotFound)
	}
	if err != nil {
		return tripCargo{}, err
	}
	cargo := fleetrules.Cargo{WeightT: weightKg / 1000, VolumeM3: volumeM3, LengthM: length}
	if tempMin != nil && tempMax != nil {
		cargo.Temp = &fleetrules.TempRange{*tempMin, *tempMax}
	}
	t.rules = fleetrules.Trip{ID: t.id.String(), Cargo: cargo}
	return t, nil
}

// busySQL reports whether vehicle $1 is taken for the window [$2, $3) of trip $4 by another source: a live hold (a hold
// before its end or of an offer), a confirmed or a consumed reservation, or another trip that keeps it.
const busySQL = `select exists (select 1 from sched.resources s join sched.reservations r on r.resource_id = s.id
	 where s.kind = 'vehicle' and s.ref_id = $1 and r.occupied && tstzrange($2, $3, '[)')
	   and not (r.source_type = 'fleet.trip' and r.source_id = $4)
	   and (r.state in ('confirmed', 'consumed') or (r.state = 'hold' and (r.hold_expires_at > $5 or r.offer_group_id is not null))))
	 or exists (select 1 from fleet.trips o join fleet.vehicles v on v.id = o.vehicle_id
	  where o.vehicle_id = $1 and o.id <> $4 and o.planned && tstzrange($2, $3, '[)')
	    and o.state in ('assigned', 'inspection', 'defect_review', 'on_route', 'returning', 'submitted', 'rework')
	    and not (o.state in ('returning', 'submitted', 'rework') and o.return_inspection_id is not null
	        and exists (select 1 from fleet.driver_transfers x where x.trip_id = o.id and x.home_vehicle_id = v.id
	                     and x.vehicle_decision = 'approved')))`

// fitOf returns the reasons vehicle v does not fit the cargo of trip t (payload, volume, body length, temperature —
// fleetrules.Compat, LOG-05) and whether it is free for the window of t: in service, without a blocking defect, not on
// a route now and taken by nothing else in the window.
func fitOf(ctx context.Context, q pgx.Tx, v vehicles.Row, t tripCargo, now time.Time) ([]string, bool, error) {
	reasons := []string{}
	for _, ch := range fleetrules.Compat(v.Rules(), t.rules).Checks {
		if ch.OK || ch.Key == fleetrules.CheckAvail {
			continue
		}
		r := ch.Label + ": " + ch.Value
		if ch.Need != "" {
			r += ", нужно " + ch.Need
		}
		reasons = append(reasons, r)
	}
	if !v.Available() {
		return reasons, false, nil
	}
	var busy bool
	if err := q.QueryRow(ctx, busySQL, v.ID, t.window.Start, t.window.End, t.id, now).Scan(&busy); err != nil {
		return nil, false, fmt.Errorf("pool: vehicle %s for the trip: %w", v.ID, err)
	}
	return reasons, !busy, nil
}

// fits is fitOf as the 409 of a request and of an approval: a vehicle that does not fit — vehicle_incompatible with the
// reasons, a taken one — reservation_overlap.
func fits(ctx context.Context, q pgx.Tx, v vehicles.Row, t tripCargo, now time.Time) error {
	reasons, free, err := fitOf(ctx, q, v, t, now)
	switch {
	case err != nil:
		return err
	case len(reasons) > 0:
		return problem.New(codeIncompatible, textNotFit+strings.Join(reasons, "; "))
	case !free:
		return problem.New(codeOverlap, textBusy)
	}
	return nil
}

// usualOf returns the usual vehicle of publication p: an active vehicle of its home company (ok false — none).
func (c *cmd) usualOf(ctx context.Context, p publication) (vehicles.Row, bool, error) {
	if p.usual == nil {
		return vehicles.Row{}, false, nil
	}
	v, err := vehicles.Get(ctx, c.tx, *p.usual, c.now)
	switch {
	case problem.Is(err, problem.CodeNotFound):
		return vehicles.Row{}, false, nil
	case err != nil:
		return vehicles.Row{}, false, err
	}
	return v, v.Unit == p.home, nil
}

// usualVehicle checks usualVehicleId of a publication (rule 1, TD-01): an active vehicle of the home company visible to
// the actor (fleet.vehicles.read); an unknown, archived, invisible or foreign one — the same 422 (Q-W2.71-2).
func (c *cmd) usualVehicle(ctx context.Context, id *uuid.UUID, home uuid.UUID) error {
	if id == nil {
		return nil
	}
	bad := invalid(textCheckVehicle, violationUsualVehicle)
	v, err := vehicles.Get(ctx, c.tx, *id, c.now)
	switch {
	case problem.Is(err, problem.CodeNotFound):
		return bad
	case err != nil:
		return err
	case v.Unit != home:
		return bad
	}
	if err := c.ev.Permit(ctx, c.tc, actionVehiclesRead, authz.Resource{Unit: v.Unit}); err != nil {
		return denied(err, bad)
	}
	return nil
}

// hostVehicle reads the vehicle of the trip company of a request: a vehicle of target visible to the actor; another
// company, an invisible or unknown one — 404 «Машина не найдена.».
func (c *cmd) hostVehicle(ctx context.Context, id, target uuid.UUID) (vehicles.Row, error) {
	notFound := problem.New(problem.CodeNotFound, textVehicleNotFound)
	v, err := vehicles.Get(ctx, c.tx, id, c.now)
	switch {
	case problem.Is(err, problem.CodeNotFound):
		return vehicles.Row{}, notFound
	case err != nil:
		return vehicles.Row{}, err
	case v.Unit != target:
		return vehicles.Row{}, notFound
	}
	if err := c.ev.Permit(ctx, c.tc, actionVehiclesRead, authz.Resource{Unit: v.Unit}); err != nil {
		if problem.Is(err, problem.CodeNotFound) || problem.Is(err, problem.CodeForbiddenAction) {
			return vehicles.Row{}, notFound
		}
		return vehicles.Row{}, err
	}
	return v, nil
}

// checkMode checks the body of the vehicle of request b before the database: the trip (422 tripId), the mode and
// hostVehicleId with it (422 vehicle.hostVehicleId).
func checkMode(b fleetapi.DriverTransferCreate) (string, error) {
	v := b.Vehicle
	if b.TripId == nil {
		return "", invalid(textCheckTrip, violationTripRequired)
	}
	switch v.Mode {
	case fleetapi.DriverTransferVehicleCreateModeHome, fleetapi.DriverTransferVehicleCreateModeHost,
		fleetapi.DriverTransferVehicleCreateModeHostOrHome:
	default:
		return "", problem.New(problem.CodeMalformedRequest, "")
	}
	mode := string(v.Mode)
	withHost := mode != modeHome
	switch {
	case withHost && v.HostVehicleId == nil:
		return "", invalid(textCheckVehicle, violationHostRequired)
	case !withHost && v.HostVehicleId != nil:
		return "", invalid(textCheckVehicle, violationHostWithHome)
	}
	return mode, nil
}

// requested is the checked vehicle part of a request.
type requested struct {
	mode       string
	home, host *uuid.UUID
}

// requestVehicle checks the vehicle of a request in the order of the contract (after the checks of the request): the
// trip (422 tripId), hostVehicleId with the mode (422 vehicle.hostVehicleId), the usual vehicle of the publication
// (422 vehicle.mode), the vehicle of the trip company (404), then every vehicle against the cargo and the window of the
// trip (409 vehicle_incompatible, reservation_overlap). No reservation exists before the approval.
func (c *cmd) requestVehicle(ctx context.Context, b fleetapi.DriverTransferCreate, p publication) (*requested, error) {
	v := b.Vehicle
	if v == nil {
		return nil, nil
	}
	mode, err := checkMode(b)
	if err != nil {
		return nil, err
	}
	withHost, withUsual := mode != modeHome, mode != modeHost
	out := &requested{mode: mode}
	var check []vehicles.Row
	if withUsual {
		u, ok, err := c.usualOf(ctx, p)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, invalid(textCheckVehicle, violationNoUsual)
		}
		out.home = &u.ID
		check = append(check, u)
	}
	if withHost {
		h, err := c.hostVehicle(ctx, *v.HostVehicleId, b.TargetOrgUnitId)
		if err != nil {
			return nil, err
		}
		out.host = &h.ID
		check = append([]vehicles.Row{h}, check...)
	}
	t, err := loadTripCargo(ctx, c.tx, *b.TripId, false)
	if err != nil {
		return nil, err
	}
	for _, row := range check {
		if err := fits(ctx, c.tx, row, t, c.now); err != nil {
			return nil, err
		}
	}
	return out, nil
}

// offer creates the reservations of the approved request x (decision d) in the transaction of the approval (docs/29
// «Решение» п. 1): the vehicle of the trip company (modes host, host_or_home) and the usual vehicle (modes home,
// host_or_home approved with it), rechecked under the locks of the trip — a vehicle no longer fitting or taken fails
// the approval as a whole (Q-W2.70-11). Two vehicles are held until the deadline of the choice; one vehicle is
// confirmed at once (Q-W2.70-1, -2); at or after the deadline the vehicle of the trip company is confirmed and the
// usual one is not held (Q-W2.71-5); the usual vehicle alone with «Только водителя» — no reservation, the logist puts
// a vehicle («Требует решения», fleet.trip_without_vehicle). The offered vehicles open to the driver at once (rows of
// scope resource of role, version); the driver is told («машину поставили» or «выберите машину»).
func (c *cmd) offer(ctx context.Context, x transfer, d fleetapi.DriverTransferDecisionDecision, role uuid.UUID, version int) error {
	if x.mode == nil || x.trip == nil {
		return nil
	}
	decision := homeDecision(x, d)
	t, err := loadTripCargo(ctx, c.tx, *x.trip, true)
	if err != nil {
		return err
	}
	deadline := t.window.Start.Add(-ChooseBefore)
	ids, kinds := offered(x, decision, c.now.Before(deadline))
	var group any
	if len(ids) > 0 {
		o, rows, err := c.holdOffer(ctx, x, t, ids, kinds, deadline)
		if err != nil {
			return err
		}
		group = o.Group
		if err := c.recordOffer(ctx, x, t, o, rows, kinds, role, version, deadline); err != nil {
			return err
		}
	}
	if _, err := c.tx.Exec(ctx, `update fleet.driver_transfers set vehicle_decision = $2, offer_group_id = $3 where id = $1`,
		x.id, decision, group); err != nil {
		return fmt.Errorf("pool: offer of %s: %w", x.id, err)
	}
	return nil
}

// homeDecision is the decision of the home company on the usual vehicle of x (fleet.driver_transfers.vehicle_decision):
// approved with approve, declined with approve_driver_only; nil when the usual vehicle was not asked for.
func homeDecision(x transfer, d fleetapi.DriverTransferDecisionDecision) any {
	switch {
	case !x.usualAsked():
		return nil
	case d == fleetapi.DriverTransferDecisionDecisionApproveDriverOnly:
		return homeDeclined
	}
	return homeApproved
}

// offered are the vehicles the approval of x with decision offers and their kinds: the vehicle of the trip company
// (modes host, host_or_home) and the usual vehicle approved with the request — beside the vehicle of the trip company
// only while the choice is open (Q-W2.71-5).
func offered(x transfer, decision any, open bool) ([]uuid.UUID, []string) {
	var (
		ids   []uuid.UUID
		kinds []string
	)
	if *x.mode != modeHome && x.host != nil {
		ids, kinds = append(ids, *x.host), append(kinds, offers.OfferHost)
	}
	if decision == homeApproved && x.home != nil && (len(ids) == 0 || open) {
		ids, kinds = append(ids, *x.home), append(kinds, offers.OfferUsual)
	}
	return ids, kinds
}

// holdOffer rechecks the vehicles ids for trip t and holds them as one offer to the driver of x. The resources of the
// vehicles are locked before the check (sched.LockClaims, the order of Hold): a command that puts one of them on a
// trip without a reservation takes the same lock, so the check sees it (W2.72 return 1).
func (c *cmd) holdOffer(ctx context.Context, x transfer, t tripCargo, ids []uuid.UUID, kinds []string, deadline time.Time) (offers.Offer, []vehicles.Row, error) {
	req := offers.OfferRequest{Trip: t.id, Window: sched.Window{Start: t.window.Start, End: t.window.End},
		Driver: x.person, CreatedBy: c.tc.PersonID, Now: c.now}
	if t.prior != nil {
		req.Replaces = *t.prior
	}
	if len(ids) > 1 {
		req.ChooseUntil = deadline
	}
	rows := make([]vehicles.Row, 0, len(ids))
	for i, id := range ids {
		v, err := vehicles.Get(ctx, c.tx, id, c.now)
		if problem.Is(err, problem.CodeNotFound) {
			return offers.Offer{}, nil, problem.New(codeOverlap, textBusy)
		}
		if err != nil {
			return offers.Offer{}, nil, err
		}
		rows = append(rows, v)
		req.Vehicles = append(req.Vehicles, offers.OfferVehicle{Vehicle: v.ID, Unit: v.Unit, Kind: kinds[i]})
	}
	if err := sched.LockClaims(ctx, c.tx, req.Claims(), offers.SourceTrip, t.id); err != nil {
		return offers.Offer{}, nil, err
	}
	for _, v := range rows {
		if err := fits(ctx, c.tx, v, t, c.now); err != nil {
			return offers.Offer{}, nil, err
		}
	}
	o, err := offers.HoldOffer(ctx, c.tx, req)
	if _, ok := errors.AsType[*sched.OverlapError](err); ok {
		return offers.Offer{}, nil, problem.New(codeOverlap, textBusy)
	}
	if errors.Is(err, sched.ErrInvalid) {
		return offers.Offer{}, nil, kit.Conflict(textTripStarted)
	}
	return o, rows, err
}

// recordOffer opens the offered vehicles to the driver of x (scope resource, from now to the end of the window),
// writes the audit and the events of the reservations and tells the driver.
func (c *cmd) recordOffer(ctx context.Context, x transfer, t tripCargo, o offers.Offer, rows []vehicles.Row,
	kinds []string, role uuid.UUID, version int, deadline time.Time) error {
	choice := len(rows) > 1
	action, typ := offers.ActionConfirm, offers.EventConfirmed
	if choice {
		action, typ = offers.ActionHold, offers.EventHeld
	}
	var first uuid.UUID
	for i, v := range rows {
		if err := openOfferGrant(ctx, c.tx, x, role, version, v.ID, c.now); err != nil {
			return err
		}
		extra := map[string]any{keyStartsAt: t.window.Start, keyEndsAt: t.window.End}
		if choice {
			extra["chooseUntil"] = deadline
		}
		ev, err := offers.RecordOffer(ctx, c.tx, action, typ, offers.OfferEvent{
			Reservation: o.Bundles[i], Vehicle: v.ID, Unit: v.Unit, Trip: t.id, Group: &o.Group, Driver: x.person,
			Kind: kinds[i], Extra: extra,
		})
		if err != nil {
			return err
		}
		if i == 0 {
			first = ev
		}
	}
	kind, title := noticeConfirmed, "Машину поставили на рейс "+t.number+": "+label(rows[0])
	if choice {
		kind, title = noticeHeld, "Выберите машину на рейс "+t.number
	}
	return c.notifyPerson(ctx, x.person, kind, title, t.id, first)
}

// label is a vehicle as the notifications name it: «Ford Transit М 608 КТ 77».
func label(v vehicles.Row) string { return v.Name + " " + v.Plate }

// offerReason is the reason of a row of scope resource of an offered vehicle of transfer id.
func offerReason(id uuid.UUID) string {
	return "Пул водителей: запрос " + id.String() + offerGrantSuffix
}

// openOfferGrant opens vehicle to the driver of x from now to the end of the window: a row of the role of the grant in
// scope resource (W2.57), granted by the approver.
func openOfferGrant(ctx context.Context, tx pgx.Tx, x transfer, role uuid.UUID, version int, vehicle uuid.UUID, now time.Time) error {
	if !now.Before(x.period.End) {
		return nil
	}
	by := uuid.Nil
	if x.decidedBy != nil {
		by = *x.decidedBy
	}
	if _, err := tx.Exec(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version,
		scope_kind, scope_ref, include_descendants, valid, source, granted_by, reason, created_at)
		values ('person', $1, $2, $3, 'resource', $4, false, tstzrange($5, $6, '[)'), $7, $8, $9, $5)`,
		x.person, role, version, vehicle, now, x.period.End, sourceTransfer, by, offerReason(x.id)); err != nil {
		return fmt.Errorf("pool: offered vehicle of %s: %w", x.id, err)
	}
	return nil
}

// closeOfferGrantsSQL ends at $3 the open rows of the offered vehicles of person $1 — of the vehicles $2 (null: all) —
// that the transfers whose reasons are $4 wrote (offerReason), never before their start. The rows of another transfer
// of the same driver (another trip, the same usual vehicle) stay (W2.72, return 1).
const closeOfferGrantsSQL = `update access.role_assignments
   set valid = tstzrange(lower(valid), greatest(lower(valid), $3), '[)')
 where principal_kind = 'person' and principal_id = $1 and source = 'transfer' and scope_kind = 'resource'
   and reason = any($4::text[]) and state = 'active' and not isempty(valid) and (upper(valid) is null or upper(valid) > $3)
   and ($2::uuid[] is null or scope_ref = any($2::uuid[]))`

// closeOfferGrants ends the rows of the offered vehicles of person written for the transfers ids (nil vehicles: all of
// them) at now; changed — a validity moved (the caller raises policy_version).
func closeOfferGrants(ctx context.Context, tx pgx.Tx, person uuid.UUID, ids, vs []uuid.UUID, now time.Time) (bool, error) {
	if len(ids) == 0 {
		return false, nil
	}
	reasons := make([]string, 0, len(ids))
	for _, id := range ids {
		reasons = append(reasons, offerReason(id))
	}
	var arg any
	if vs != nil {
		arg = vs
	}
	tag, err := tx.Exec(ctx, closeOfferGrantsSQL, person, arg, now, reasons)
	if err != nil {
		return false, fmt.Errorf("pool: close the offered vehicles of %s: %w", person, err)
	}
	return tag.RowsAffected() > 0, nil
}

// transfersOfTrip are the transfers of person to trip (the rows of the offered vehicles of an offer of the trip carry
// their ids).
func transfersOfTrip(ctx context.Context, tx pgx.Tx, trip, person uuid.UUID) ([]uuid.UUID, error) {
	rows, err := tx.Query(ctx, `select x.id from fleet.driver_transfers x
		join fleet.pool_publications p on p.id = x.publication_id where x.trip_id = $1 and p.person_id = $2`, trip, person)
	if err != nil {
		return nil, fmt.Errorf("pool: transfers of %s: %w", trip, err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, fmt.Errorf("pool: transfers of %s: %w", trip, err)
	}
	return ids, nil
}

// syncOfferGrantsSQL ends at $3 the rows of the offered vehicles of person $1 whose vehicle is no longer offered to him
// for trip $2 (no hold or confirmed reservation of it).
const syncOfferGrantsSQL = `update access.role_assignments a
   set valid = tstzrange(lower(a.valid), greatest(lower(a.valid), $3), '[)')
 where a.principal_kind = 'person' and a.principal_id = $1 and a.source = 'transfer' and a.scope_kind = 'resource'
   and a.reason = $4 and a.state = 'active' and not isempty(a.valid) and (upper(a.valid) is null or upper(a.valid) > $3)
   and not exists (select 1 from sched.reservations r join sched.resources s on s.id = r.resource_id and s.kind = 'vehicle'
                    where s.ref_id = a.scope_ref and r.source_type = 'fleet.trip' and r.source_id = $2
                      and r.offered_to = $1 and r.state in ('hold', 'confirmed'))`

// syncOfferGrants closes the rows of the vehicles no longer offered to the driver of x for its trip (released by the
// logist, replaced by another vehicle); changed — a validity moved.
func syncOfferGrants(ctx context.Context, tx pgx.Tx, x transfer, now time.Time) (bool, error) {
	if !x.prepare || x.trip == nil {
		return false, nil
	}
	tag, err := tx.Exec(ctx, syncOfferGrantsSQL, x.person, *x.trip, now, offerReason(x.id))
	if err != nil {
		return false, fmt.Errorf("pool: offered vehicles of %s: %w", x.id, err)
	}
	return tag.RowsAffected() > 0, nil
}

// endOffer releases the offer of the trip of x that ended before the trip started (releaseReason transfer_ended) and
// closes the offered vehicles of its driver; changed — a validity moved.
func endOffer(ctx context.Context, tx pgx.Tx, x transfer, now time.Time) (bool, error) {
	if !x.prepare || x.trip == nil {
		return false, nil
	}
	released, err := offers.ReleaseLive(ctx, tx, *x.trip, x.person, offers.ReasonTransferEnded, now, nil)
	if err != nil {
		return false, err
	}
	for _, r := range released {
		if _, err := offers.RecordOffer(ctx, tx, offers.ActionRelease, offers.EventReleased,
			offers.OfferEvent{Reservation: r.Bundle, Vehicle: r.Vehicle, Unit: r.Unit, Trip: *x.trip, Group: r.Group,
				Driver: x.person, Reason: offers.ReasonTransferEnded}); err != nil {
			return false, err
		}
	}
	return closeOfferGrants(ctx, tx, x.person, []uuid.UUID{x.id}, nil, now)
}
