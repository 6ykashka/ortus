package vehicles

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.42: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of moveVehicle (the mock W2.52, vehicles.ts; @ortus/texts errors.mock.logistics.vehicleMove). The reason has
// no text in the prototype (no-reference, Q-W2.42-6).
const (
	textSameUnit   = "Машина уже в этой фирме."
	textBusy       = "Машина занята рейсом — перемещение после его закрытия."
	textMoveReason = "Укажите причину перемещения (до 500 символов)."
)

const (
	// maxReason is VehicleMove.reason maxLength (fleet.vehicle_assignments.reason: 1…500 after trimming).
	maxReason = 500
	// codeUnavailable is the Problem code of a vehicle a trip or a reservation keeps (api/errors.yaml).
	codeUnavailable = "resources_unavailable"
	actionMove      = "fleet.vehicle.move"
	eventMoved      = "fleet.vehicle.moved.v1"
)

// moveInput is a checked VehicleMove.
type moveInput struct {
	unit   uuid.UUID
	reason string
}

func checkMove(b *fleetapi.VehicleMove) (moveInput, error) {
	if b == nil {
		return moveInput{}, problem.New(problem.CodeMalformedRequest, "")
	}
	reason := strings.TrimSpace(b.Reason)
	if reason == "" || utf8.RuneCountInString(reason) > maxReason {
		return moveInput{}, kit.Invalid(textMoveReason)
	}
	return moveInput{unit: b.OrgUnitId, reason: reason}, nil
}

// Busy reports whether something keeps the vehicle where it is: a trip that is not closed (assigned … rework) or a
// live hold or a confirmed reservation (selectSQL: one that has not ended). The vehicle moves after them.
func (s State) Busy() bool { return s.TripState != "" || s.Held }

// moveInstant is the instant the open period opened at openFrom ends and the next one starts: the clock of the
// application to the microsecond the database keeps, or a microsecond after openFrom when the period opened at that
// instant or later (a fixed APP_FIXED_NOW in the past, a vehicle registered by the clock of the database), so that the
// periods stay ordered (vehicle_assignments_period).
func moveInstant(now, openFrom time.Time) time.Time {
	at := now.Truncate(time.Microsecond)
	if !at.After(openFrom) {
		return openFrom.Add(time.Microsecond)
	}
	return at
}

// MoveVehicle implements fleetapi.StrictServerInterface: the vehicle moves to another company from now on, by
// fleet.vehicles.manage over the current and the target company (as a move of a member between units), at the
// revision of If-Match. In one transaction the open period ends, a period of the target company starts with its
// reason and author, the vehicle changes its company (revision + 1) and its resource of the scheduling core follows
// it; trips, inspections and expenses stay with the companies they were made in. Refusals in the order of the
// contract: the vehicle outside the scope of fleet.vehicles.read, archived or missing — 404; without the right over
// its company — 403; If-Match — 428/412; the same company — 422; an unknown or invisible target — the same 422, an
// archived one — 422, a visible one without the right — 403; a vehicle a trip or a reservation keeps — 409.
func (s *Server) MoveVehicle(ctx context.Context, req fleetapi.MoveVehicleRequestObject) (fleetapi.MoveVehicleResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	in, err := checkMove(req.Body)
	if err != nil {
		return nil, err
	}
	now := s.now()
	var row Row
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		var err error
		row, err = s.move(ctx, tx, tc, req.VehicleId, req.Params.IfMatch, in, now)
		return err
	})
	if err != nil {
		return nil, dbError(err)
	}
	tag, replayed := kit.ETag(row.Revision), false
	return fleetapi.MoveVehicle200JSONResponse{
		Body: row.DTO(),
		Headers: fleetapi.MoveVehicle200ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}

// move is the transaction of moveVehicle: the checks of lockMovable, the new period, the audit, the event and the
// stored outcome.
func (s *Server) move(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, in moveInput, now time.Time) (Row, error) {
	from, err := s.lockMovable(ctx, tx, tc, id, ifMatch, in, now)
	if err != nil {
		return Row{}, err
	}
	at, err := s.reassign(ctx, tx, tc, id, in, now)
	if err != nil {
		return Row{}, err
	}
	row, err := Get(ctx, tx, id, now)
	if err != nil {
		return Row{}, err
	}
	if err := kit.Audit(ctx, tx, audit.Event{
		Action: actionMove, TargetType: TargetVehicle, TargetID: id, UnitID: in.unit, Reason: in.reason,
		Diff: map[string]any{"orgUnitId": map[string]any{"from": from, "to": in.unit}},
	}); err != nil {
		return Row{}, err
	}
	if _, err := events.Publish(ctx, tx, events.Event{
		Type: eventMoved, Aggregate: TargetVehicle, AggregateID: id,
		Payload: map[string]any{"vehicleId": id, "fromOrgUnitId": from, "toOrgUnitId": in.unit, "movedAt": at.UTC()},
	}); err != nil {
		return Row{}, err
	}
	return row, kit.Complete(ctx, tx, http.StatusOK, kit.ETag(row.Revision), row.DTO())
}

// lockResourceSQL creates or locks the resource of the vehicle $1 in the scheduling core and moves its home to the
// company $2. A vehicle that was never held has no resource yet: sched.Hold creates it, and an update alone would find
// no row and take no lock, so the move would not see a first hold that is not committed. The insert waits for such a
// hold (the unique (kind, ref_id) of an uncommitted row) and then updates the committed resource under its lock.
const lockResourceSQL = `insert into sched.resources (kind, ref_id, home_unit_id) values ('vehicle', $1, $2)
	on conflict (kind, ref_id) do update set home_unit_id = excluded.home_unit_id`

// lockMovable checks the move of vehicle id to in.unit in the order of the contract and returns the company the
// vehicle leaves. Locks: the row of the vehicle first (a parallel move or command of the vehicle waits), then its
// resource of the scheduling core (lockResourceSQL) — the lock sched.Hold takes before a hold, so a parallel
// reservation or assignment of the vehicle waits for the move or the move for it, a first hold included — and only
// then the check that nothing keeps the vehicle.
func (s *Server) lockMovable(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, in moveInput, now time.Time) (uuid.UUID, error) {
	var from uuid.UUID
	var revision int64
	err := tx.QueryRow(ctx, `select unit_id, revision from fleet.vehicles where id = $1 and archived_at is null for update`, id).
		Scan(&from, &revision)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, problem.New(problem.CodeNotFound, TextNotFound)
	}
	if err != nil {
		return uuid.Nil, err
	}
	if err := s.within(tx).Permit(ctx, tc, ActionManage, authz.Resource{Unit: from, ReadAction: ActionRead}); err != nil {
		return uuid.Nil, notFound(err)
	}
	if err := kit.CheckRevision(ifMatch, revision); err != nil {
		return uuid.Nil, err
	}
	if in.unit == from {
		return uuid.Nil, kit.Invalid(textSameUnit)
	}
	if err := s.unitOf(ctx, tx, tc, in.unit); err != nil {
		return uuid.Nil, err
	}
	if _, err := tx.Exec(ctx, lockResourceSQL, id, in.unit); err != nil {
		return uuid.Nil, err
	}
	current, err := Get(ctx, tx, id, now)
	if err != nil {
		return uuid.Nil, err
	}
	if current.State.Busy() {
		return uuid.Nil, problem.New(codeUnavailable, textBusy)
	}
	return from, nil
}

// reassign closes the open period of the vehicle, opens the period of the target company and moves the vehicle there,
// all at the instant of the move it returns; the deferred check of tenant 0016 sees one open period in the company of
// the vehicle at the commit.
func (s *Server) reassign(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, id uuid.UUID, in moveInput, now time.Time) (time.Time, error) {
	var openFrom time.Time
	err := tx.QueryRow(ctx, `select valid_from from fleet.vehicle_assignments where vehicle_id = $1 and valid_to is null for update`, id).
		Scan(&openFrom)
	if errors.Is(err, pgx.ErrNoRows) {
		return time.Time{}, errNoOpenPeriod
	}
	if err != nil {
		return time.Time{}, err
	}
	at := moveInstant(now, openFrom)
	var by *uuid.UUID
	if tc.PersonID != uuid.Nil {
		by = &tc.PersonID
	}
	for _, step := range []struct {
		sql  string
		args []any
	}{
		{`update fleet.vehicle_assignments set valid_to = $2 where vehicle_id = $1 and valid_to is null`, []any{id, at}},
		{`insert into fleet.vehicle_assignments (vehicle_id, unit_id, valid_from, reason, assigned_by)
			values ($1, $2, $3, $4, $5)`, []any{id, in.unit, at, in.reason, by}},
		{`update fleet.vehicles set unit_id = $2, revision = revision + 1 where id = $1`, []any{id, in.unit}},
	} {
		if _, err := tx.Exec(ctx, step.sql, step.args...); err != nil {
			return time.Time{}, err
		}
	}
	return at, nil
}
