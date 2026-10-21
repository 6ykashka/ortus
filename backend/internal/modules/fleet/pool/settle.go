package pool

import (
	"context"
	"fmt"
	"maps"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.07: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// pendingWhere selects the transfers the time may change at $1 (Settle): open requests whose window started; approved
// transfers whose window is over, whose grant is open (a started trip may have closed or gone back to planning), whose
// trip left the planning (started, accepted or cancelled), lost the driver (Q-W2.07-14) or holds another vehicle than
// the open grant of the vehicle (W2.57); revoked transfers whose continuation is open (D09). An approved transfer of a
// trip still planned inside its window with the grant of its vehicle keeps its stored grants, so it is neither read
// nor locked.
const pendingWhere = `((x.state = 'requested' and lower(x.period) <= $1)
	 or (x.state = 'approved' and (upper(x.period) <= $1 or upper(ra.valid) is null
	     or coalesce(t.state not in ('planned', 'assigned'), false)
	     or (x.trip_id is not null and t.driver_person_id is distinct from p.person_id)
	     or (x.trip_id is not null and t.vehicle_id is distinct from (case when va.state = 'active'
	         and (upper(va.valid) is null or upper(va.valid) > $1) then va.scope_ref end))))
	 or (x.state = 'revoked' and ra.state = 'active' and upper(ra.valid) is null))`

// pendingTripsSQL locks the trips of the pending transfers at $1 in the order of their ids. Lock order of the module:
// the trip, then its transfers — as decideDriverTransfer and a command of a trip that settles it in its own transaction
// (SettleTripTx), so two of them never wait for each other in a cycle.
const pendingTripsSQL = `select tt.id from fleet.trips tt where tt.id in (select x.trip_id` + transferFrom + `
	 where ` + pendingWhere + `) order by tt.id for update of tt`

// pendingSQL locks the pending transfers at $1 with condition cond over $2 (the trips already locked, or one trip) in
// the order of their ids: two settlements queue on the same rows.
func pendingSQL(cond string) string {
	return `select ` + transferCols + transferFrom + ` where ` + pendingWhere + ` and (` + cond + `) order by x.id for update of x`
}

// Beginner opens a transaction of the tenant DB (a pgxpool.Pool).
type Beginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// SettleTenant persists the time of the pool of a tenant at the clock of the service (SettleDB): the worker on its
// schedule and the tests.
func (s *Service) SettleTenant(ctx context.Context, tenantID uuid.UUID) (Result, error) {
	db, err := s.Pools.For(ctx, tenantID)
	if err != nil {
		return Result{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	return SettleDB(ctx, db, tenantID, s.now())
}

// SettleTrip persists the time of the transfers of trip at the clock of the service in one transaction of the tenant
// DB (SettleTripTx): the overlay calls it right after a command of the base that moved the trip.
func (s *Service) SettleTrip(ctx context.Context, tenantID, trip uuid.UUID) (Result, error) {
	db, err := s.Pools.For(ctx, tenantID)
	if err != nil {
		return Result{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	var res Result
	err = pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		var err error
		res, err = SettleTripTx(ctx, tx, tenantID, trip, s.now())
		return err
	})
	if err != nil {
		return Result{}, fmt.Errorf("pool: settle trip %s: %w", trip, err)
	}
	return res, nil
}

// SettleDB persists the time of the pool of the tenant DB db at now in one transaction (Settle, Q-W2.51-4,
// Q-W2.51-15): open requests whose window started expire; the grant of an approved transfer opens while its trip is
// started and not closed, closes at the acceptance or the cancellation of the trip and ends with the window otherwise;
// an approved transfer whose window is over completes unless its trip runs, and its driver leaves a trip he did not
// start. Every change of a status writes an audit row of the service and fleet.driver_transfer.settled.v1; a changed
// grant raises policy_version for its driver (W1.07). The worker runs it as ortus_worker (DML only).
func SettleDB(ctx context.Context, db Beginner, tenantID uuid.UUID, now time.Time) (Result, error) {
	var res Result
	err := pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		var err error
		res, err = SettleTx(ctx, tx, tenantID, now)
		return err
	})
	if err != nil {
		return Result{}, fmt.Errorf("pool: settle tenant %s: %w", tenantID, err)
	}
	return res, nil
}

// SettleTx is SettleDB in the transaction tx of the tenant DB. It locks the trips of the pending transfers first, then
// the transfers without a trip or of those trips; a transfer whose trip started to move meanwhile waits for the next
// settlement.
func SettleTx(ctx context.Context, tx pgx.Tx, tenantID uuid.UUID, now time.Time) (Result, error) {
	now = now.UTC()
	rows, err := tx.Query(ctx, pendingTripsSQL, now)
	if err != nil {
		return Result{}, err
	}
	trips, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return Result{}, err
	}
	if trips == nil {
		trips = []uuid.UUID{}
	}
	return settlePending(ctx, tx, tenantID, now, pendingSQL(`x.trip_id is null or x.trip_id = any($2::uuid[])`), trips)
}

// SettleTripTx settles the transfers of trip in the transaction tx of the tenant DB: a command that moves a trip calls
// it in its own transaction (Q-W2.51-15: «в той же транзакции»), after it locked the trip — the order of the module
// (trip, then transfers).
func SettleTripTx(ctx context.Context, tx pgx.Tx, tenantID, trip uuid.UUID, now time.Time) (Result, error) {
	if _, err := tx.Exec(ctx, `select id from fleet.trips where id = $1 for update`, trip); err != nil {
		return Result{}, err
	}
	return settlePending(ctx, tx, tenantID, now.UTC(), pendingSQL(`x.trip_id = $2`), trip)
}

// settlePending locks the pending transfers of query (arguments now and arg) and writes what the time changed of
// them.
func settlePending(ctx context.Context, tx pgx.Tx, tenantID uuid.UUID, now time.Time, query string, arg any) (Result, error) {
	rows, err := tx.Query(ctx, query, now, arg)
	if err != nil {
		return Result{}, err
	}
	pending, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (transfer, error) { return scanTransfer(r) })
	if err != nil {
		return Result{}, err
	}
	var (
		res     Result
		persons []uuid.UUID
	)
	for _, x := range pending {
		granted, err := settleOne(ctx, tx, x, Settle(x.input(), now), now, &res)
		if err != nil {
			return Result{}, err
		}
		if granted {
			persons = append(persons, x.person)
		}
	}
	if len(persons) > 0 {
		if _, err := realtime.BumpPolicy(ctx, tx, tenantID, persons, "fleet.driver_transfer.settle"); err != nil {
			return Result{}, err
		}
	}
	return res, nil
}

// settleOne writes what the time changed of x (st) at now and counts it in res: the status, the bounds of the grant
// and of the grant of the vehicle of the trip, the removal of the driver from a trip he did not start and
// fleet.transfer.expired.v1 when the grant ended; granted: a validity changed (the caller raises policy_version).
func settleOne(ctx context.Context, tx pgx.Tx, x transfer, st Settled, now time.Time, res *Result) (granted bool, err error) {
	if err := settleStatusCounted(ctx, tx, x, st, res); err != nil {
		return false, err
	}
	if st.GrantChange && x.assignment != nil {
		if granted, err = settleGrant(ctx, tx, x, st, res); err != nil {
			return false, err
		}
	}
	moved, err := settleVehicle(ctx, tx, x, st, now)
	if err != nil {
		return false, err
	}
	if err := unassignDriver(ctx, tx, x, st, res); err != nil {
		return false, err
	}
	offered, err := settleOffer(ctx, tx, x, st, now)
	if err != nil {
		return false, err
	}
	return granted || moved || offered, announceEnd(ctx, tx, x, st)
}

// settleOffer makes the offer of the trip of x follow the time (W2.72, S2-20): a transfer that completed before its
// driver started the trip releases its offer (transfer_ended) and closes the offered vehicles; otherwise the rows of
// the vehicles no longer offered to the driver close. changed: a validity moved.
func settleOffer(ctx context.Context, tx pgx.Tx, x transfer, st Settled, now time.Time) (bool, error) {
	if st.Changed && st.Status == StatusCompleted && !x.input().started() {
		return endOffer(ctx, tx, x, now)
	}
	return syncOfferGrants(ctx, tx, x, now)
}

// settleStatusCounted writes the status the time gave x (settleStatus) and counts it in res.
func settleStatusCounted(ctx context.Context, tx pgx.Tx, x transfer, st Settled, res *Result) error {
	if !st.Changed {
		return nil
	}
	if err := settleStatus(ctx, tx, x, st); err != nil {
		return err
	}
	if st.Status == StatusExpired {
		res.Expired++
	} else {
		res.Completed++
	}
	return nil
}

// announceEnd publishes fleet.transfer.expired.v1 when the settlement ended the grant of x: the transfer completed or
// the continuation of a revoked one closed.
func announceEnd(ctx context.Context, tx pgx.Tx, x transfer, st Settled) error {
	completed := st.Changed && st.Status == StatusCompleted
	continuation := x.state == string(StatusRevoked) && st.GrantChange && st.Grant == fleetapi.TemporaryDriverGrantStateEnded
	if !completed && !continuation {
		return nil
	}
	return publishTransfer(ctx, tx, eventExpired, x, map[string]any{"endedAt": st.EndedAt, "status": string(st.Status)})
}

// unassignDriver takes the driver of x off a trip he did not start when st says so (the end of the window) and counts it.
func unassignDriver(ctx context.Context, tx pgx.Tx, x transfer, st Settled, res *Result) error {
	if !st.Unassign || x.trip == nil {
		return nil
	}
	done, err := unassign(ctx, tx, *x.trip, x.person)
	if done {
		res.Unassigned++
	}
	return err
}

// settleGrant moves the upper bound of the validity of the assignment of x to st.GrantUntil and counts it in res. An
// assignment revoked through the access API keeps its validity: only an active one follows the trip (changed false).
func settleGrant(ctx context.Context, tx pgx.Tx, x transfer, st Settled, res *Result) (changed bool, err error) {
	tag, err := tx.Exec(ctx, `update access.role_assignments set valid = tstzrange(lower(valid), $2, '[)')
		 where id = $1 and state = 'active' and not isempty(valid)`, *x.assignment, st.GrantUntil)
	if err != nil {
		return false, fmt.Errorf("grant of %s: %w", x.id, err)
	}
	if tag.RowsAffected() == 0 {
		return false, nil
	}
	if st.GrantUntil == nil {
		res.Opened++
	} else {
		res.Closed++
	}
	return true, nil
}

// settleVehicle makes the assignment of the vehicle of the trip of x follow st (W2.57, scope resource): the same
// vehicle keeps its row with the bound st.VehicleUntil; another vehicle or none closes the open row at now (never later
// than st.VehicleUntil); a vehicle without a row gets one (openVehicle). changed: a validity changed.
func settleVehicle(ctx context.Context, tx pgx.Tx, x transfer, st Settled, now time.Time) (changed bool, err error) {
	if !x.grants() || st.VehicleUntil == nil {
		return false, nil
	}
	v := x.vehicle
	if v.holds(st.Vehicle) {
		if sameMoment(v.upper, st.VehicleUntil) {
			return false, nil
		}
		return true, boundAssignment(ctx, tx, v.id, *st.VehicleUntil)
	}
	changed, err = closeVehicle(ctx, tx, v, *earliest(&now, st.VehicleUntil))
	if err != nil || st.Vehicle == uuid.Nil || !st.VehicleUntil.After(x.period.Start) {
		return changed, err
	}
	return true, openVehicle(ctx, tx, x, st.Vehicle, *st.VehicleUntil, now)
}

// grants reports whether x has a grant whose role the assignment of the vehicle takes.
func (x transfer) grants() bool { return x.assignment != nil && x.role != nil && x.roleVersion != nil }

// holds reports whether the stored assignment v is the active one of vehicle.
func (v *vehicleGrant) holds(vehicle uuid.UUID) bool {
	return v != nil && v.active && vehicle != uuid.Nil && v.vehicle == vehicle
}

// closeVehicle ends the active assignment v at the moment at unless it ends earlier; changed: it was moved.
func closeVehicle(ctx context.Context, tx pgx.Tx, v *vehicleGrant, at time.Time) (changed bool, err error) {
	if v == nil || !v.active || (v.upper != nil && !v.upper.After(at)) {
		return false, nil
	}
	return true, boundAssignment(ctx, tx, v.id, at)
}

// openVehicle writes the assignment of vehicle to the driver of x — the role and the version of the grant of x in
// scope resource, valid from the start of the window to until, granted by the approver — and links it to x.
func openVehicle(ctx context.Context, tx pgx.Tx, x transfer, vehicle uuid.UUID, until, now time.Time) error {
	var by uuid.UUID
	if x.decidedBy != nil {
		by = *x.decidedBy
	}
	var id uuid.UUID
	if err := tx.QueryRow(ctx, `insert into access.role_assignments (principal_kind, principal_id, role_id, role_version,
		scope_kind, scope_ref, include_descendants, valid, source, granted_by, reason, created_at)
		values ('person', $1, $2, $3, 'resource', $4, false, tstzrange($5, $6, '[)'), $7, $8, $9, $10) returning id`,
		x.person, *x.role, *x.roleVersion, vehicle, x.period.Start, until, sourceTransfer, by,
		"Пул водителей: запрос "+x.id.String()+" · машина рейса", now).Scan(&id); err != nil {
		return fmt.Errorf("vehicle grant of %s: %w", x.id, err)
	}
	if _, err := tx.Exec(ctx, `update fleet.driver_transfers set vehicle_assignment_id = $2 where id = $1`, x.id, id); err != nil {
		return fmt.Errorf("vehicle grant of %s: %w", x.id, err)
	}
	return nil
}

// boundAssignment sets the upper bound of the validity of an active assignment (never before its start).
func boundAssignment(ctx context.Context, tx pgx.Tx, id uuid.UUID, until time.Time) error {
	if _, err := tx.Exec(ctx, `update access.role_assignments set valid = tstzrange(lower(valid), greatest(lower(valid), $2), '[)')
		 where id = $1 and state = 'active' and not isempty(valid)`, id, until); err != nil {
		return fmt.Errorf("pool: bound assignment %s: %w", id, err)
	}
	return nil
}

// publishTransfer writes the outbox event typ of the temporary assignment of x (12-errors-and-events
// «fleet.transfer.approved.v1 / .revoked.v1 / .expired.v1»): the ids of the request, the companies, the trip and the
// assignment and the window — never the name of the driver.
func publishTransfer(ctx context.Context, tx pgx.Tx, typ string, x transfer, extra map[string]any) error {
	payload := map[string]any{"id": x.id, keyPublication: x.publication, keySource: x.source,
		keyTarget: x.target, keyStartsAt: x.period.Start, keyEndsAt: x.period.End}
	if x.trip != nil {
		payload["tripId"] = *x.trip
	}
	if x.assignment != nil {
		payload["assignmentId"] = *x.assignment
	}
	maps.Copy(payload, extra)
	if _, err := events.Publish(ctx, tx, events.Event{Type: typ, Aggregate: targetTransfer, AggregateID: x.id,
		Payload: payload}); err != nil {
		return fmt.Errorf("pool: event %s of %s: %w", typ, x.id, err)
	}
	return nil
}

// settleStatus writes the status the time gave x: expired, or completed at its moment; the audit row of the service
// and the event.
func settleStatus(ctx context.Context, tx pgx.Tx, x transfer, st Settled) error {
	if _, err := tx.Exec(ctx, `update fleet.driver_transfers set state = $2, completed_at = $3, revision = revision + 1
		 where id = $1`, x.id, string(st.Status), st.CompletedAt); err != nil {
		return fmt.Errorf("transfer %s: %w", x.id, err)
	}
	diff := map[string]any{"status": string(st.Status)}
	if st.CompletedAt != nil {
		diff["completedAt"] = *st.CompletedAt
	}
	if err := audit.Record(ctx, tx, audit.Event{ActorKind: audit.ActorService, Action: "fleet.driver_transfer.settle",
		TargetType: targetTransfer, TargetID: x.id, UnitID: x.target, Result: audit.OK, RequestID: kit.RequestID(ctx),
		Diff: diff}); err != nil {
		return fmt.Errorf("audit of %s: %w", x.id, err)
	}
	payload := map[string]any{"id": x.id, keyPublication: x.publication, keySource: x.source,
		keyTarget: x.target, "status": string(st.Status)}
	if _, err := events.Publish(ctx, tx, events.Event{Type: eventSettled, Aggregate: targetTransfer, AggregateID: x.id,
		Payload: payload}); err != nil {
		return fmt.Errorf("event of %s: %w", x.id, err)
	}
	return nil
}
