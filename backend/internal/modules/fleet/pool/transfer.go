package pool

import (
	"context"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.07: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// transferCols and transferFrom read a transfer with its publication, the names of both companies, its trip, the
// validity of its grant and the assignment of the vehicle of its trip (tenant 0018).
const (
	transferCols = `x.id, x.publication_id, p.person_id, coalesce(p.display_name, ''), x.source_unit_id, su.name,
	       x.target_unit_id, tu.name, tu.time_zone, x.trip_id, t.number, t.state, t.unit_id, t.driver_person_id,
	       t.reviewed_at, t.vehicle_id, lower(x.period), upper(x.period), x.state, x.assignment_id, x.reason,
	       x.requested_by, x.created_at, x.decided_by, x.decided_at, x.decision_comment, x.revoked_by, x.completed_at,
	       x.revision, upper(ra.valid), coalesce(ra.state = 'active' and not isempty(ra.valid), false), ra.role_id,
	       ra.role_version, x.vehicle_assignment_id, va.scope_ref, upper(va.valid), va.state, x.vehicle_mode,
	       x.home_vehicle_id, x.host_vehicle_id, x.vehicle_decision, x.offer_group_id, ` + prepareSQL
	// prepareSQL is the flag of the preparation (W2.72, S2-20, Q-W2.71-3): a request with a vehicle, or a reservation of
	// its trip offered to its driver — before the window the driver reads his trip and chooses.
	prepareSQL = `(x.vehicle_mode is not null or exists (select 1 from sched.reservations o
	        where x.trip_id is not null and o.source_type = 'fleet.trip' and o.source_id = x.trip_id
	          and o.offered_to = p.person_id))`
	transferFrom = `
	  from fleet.driver_transfers x
	  join fleet.pool_publications p on p.id = x.publication_id
	  join org.units su on su.id = x.source_unit_id
	  join org.units tu on tu.id = x.target_unit_id
	  left join fleet.trips t on t.id = x.trip_id
	  left join access.role_assignments ra on ra.id = x.assignment_id
	  left join access.role_assignments va on va.id = x.vehicle_assignment_id`
)

// statusSQL is the status of a transfer at the moment $N (Settle in SQL, for the filter of listDriverTransfers): an
// open request whose window started is expired; an approved transfer completes when its window is over unless its
// trip is started by its driver and not closed, and at once when its trip is accepted, cancelled or lost the driver.
const statusSQL = `case
	  when x.state = 'requested' and lower(x.period) <= %[1]s then 'expired'
	  when x.state = 'approved' and ((upper(x.period) <= %[1]s and not coalesce(t.driver_person_id = p.person_id
	       and t.state in ('on_route', 'returning', 'submitted', 'rework'), false))
	    or (x.trip_id is not null and (t.driver_person_id is distinct from p.person_id
	       or t.state in ('accepted', 'cancelled'))))
	    then 'completed'
	  else x.state end`

// Columns of the scope predicates of transfers: the releasing and the requesting company.
var (
	sourceColumns = authz.Columns{Unit: "x.source_unit_id"}
	targetColumns = authz.Columns{Unit: "x.target_unit_id"}
)

// transfer is a row of fleet.driver_transfers with what its projection needs.
type transfer struct {
	id, publication, person      uuid.UUID
	label                        string
	source, target               uuid.UUID
	sourceName, targetName, zone string
	trip                         *uuid.UUID
	tripNumber, tripState        *string
	tripUnit, tripDriver         *uuid.UUID
	tripReviewed                 *time.Time
	tripVehicle                  *uuid.UUID
	period                       Window
	state                        string
	assignment                   *uuid.UUID
	reason                       *string
	requestedBy                  uuid.UUID
	requestedAt                  time.Time
	decidedBy                    *uuid.UUID
	decidedAt                    *time.Time
	comment                      *string
	revokedBy                    *uuid.UUID
	completedAt                  *time.Time
	revision                     int64
	grantUpper                   *time.Time
	grantLive                    bool       // the assignment is active and not empty
	role                         *uuid.UUID // role and its version of the grant: the assignment of the vehicle takes them
	roleVersion                  *int
	vehicle                      *vehicleGrant // the assignment of the vehicle of the trip; nil — none
	// W2.72 (S2-20, tenant 0023): the vehicle part of the request — the mode, the usual vehicle of the publication and
	// the vehicle of the trip company, the decision on the usual one, the offer the approval created; prepare — the
	// driver prepares for the trip before its window (prepareSQL); parts — the vehicles as the DTO shows them.
	mode, decision    *string
	home, host, group *uuid.UUID
	prepare           bool
	parts             map[uuid.UUID]fleetapi.TransferVehicle
	chooseUntil       *time.Time
}

// vehicleGrant is the stored assignment of the vehicle of the trip of a transfer (scope resource, tenant 0018).
type vehicleGrant struct {
	id, vehicle uuid.UUID
	upper       *time.Time
	active      bool
}

func scanTransfer(row pgx.Row) (transfer, error) {
	var (
		x       transfer
		va, vr  *uuid.UUID
		vu      *time.Time
		vaState *string
	)
	err := row.Scan(&x.id, &x.publication, &x.person, &x.label, &x.source, &x.sourceName, &x.target, &x.targetName, &x.zone,
		&x.trip, &x.tripNumber, &x.tripState, &x.tripUnit, &x.tripDriver, &x.tripReviewed, &x.tripVehicle, &x.period.Start,
		&x.period.End, &x.state, &x.assignment, &x.reason, &x.requestedBy, &x.requestedAt, &x.decidedBy, &x.decidedAt,
		&x.comment, &x.revokedBy, &x.completedAt, &x.revision, &x.grantUpper, &x.grantLive, &x.role, &x.roleVersion, &va, &vr, &vu, &vaState,
		&x.mode, &x.home, &x.host, &x.decision, &x.group, &x.prepare)
	if va != nil && vr != nil {
		x.vehicle = &vehicleGrant{id: *va, vehicle: *vr, upper: vu, active: vaState != nil && *vaState == "active"}
	}
	return x, err
}

// loadTransfer reads transfer id (lock: "" or a locking clause of x); missing — 404.
func loadTransfer(ctx context.Context, q pgx.Tx, id uuid.UUID, lock string) (transfer, error) {
	x, err := scanTransfer(q.QueryRow(ctx, `select `+transferCols+transferFrom+` where x.id = $1`+lock, id))
	if errNoRows(err) {
		return transfer{}, problem.New(problem.CodeNotFound, textTransferNotFound)
	}
	return x, err
}

// input is the transfer as the settlement reads it.
func (x transfer) input() Transfer {
	in := Transfer{
		Status: fleetapi.DriverTransferStatus(x.state), Period: x.period, Revision: x.revision, Person: x.person,
		Grant: x.assignment != nil, GrantUpper: x.grantUpper, GrantLive: x.grantLive, CompletedAt: x.completedAt,
	}
	if x.trip != nil && x.tripState != nil {
		tr := &TripState{State: *x.tripState}
		if x.tripDriver != nil {
			tr.Driver = *x.tripDriver
		}
		if x.tripVehicle != nil {
			tr.Vehicle = *x.tripVehicle
		}
		if tr.State == tripAccepted {
			tr.AcceptedAt = x.tripReviewed
		}
		in.Trip = tr
	}
	return in
}

// dto is the transfer at now (DriverTransfer): the settled status, revision and grant.
func (x transfer) dto(now time.Time) fleetapi.DriverTransfer {
	st := Settle(x.input(), now)
	label, sourceName, targetName, pub := x.label, x.sourceName, x.targetName, x.publication
	requestedAt := x.requestedAt.UTC()
	out := fleetapi.DriverTransfer{
		Id: x.id, DriverMemberId: x.person, SourceOrgUnitId: x.source, TargetOrgUnitId: x.target,
		Window: fleetapi.TimeWindow{StartsAt: x.period.Start.UTC(), EndsAt: x.period.End.UTC(), TimeZone: x.zone},
		Status: st.Status, Revision: st.Revision, TripId: x.trip, PublicationId: &pub, DriverDisplayName: &label,
		SourceOrgUnitName: &sourceName, TargetOrgUnitName: &targetName, TripNumber: x.tripNumber, Reason: x.reason,
		RequestedAt: &requestedAt, DecidedByMemberId: x.decidedBy, DecidedAt: utc(x.decidedAt),
		RevokedByMemberId: x.revokedBy, DecisionComment: x.comment, CompletedAt: utc(st.CompletedAt),
	}
	if x.requestedBy != uuid.Nil {
		by := x.requestedBy
		out.RequestedByMemberId = &by
	}
	if x.assignment != nil && st.Grant != "" {
		out.Grant = grantDTO(x, st)
	}
	out.Vehicle = x.vehicleDTO()
	return out
}

// grantDTO is the temporary assignment of x as st settles it: the vehicle of the trip while it is open, the overdue
// trip while it is closing, the moment and the reason of its end.
func grantDTO(x transfer, st Settled) *fleetapi.TemporaryDriverGrant {
	g := &fleetapi.TemporaryDriverGrant{
		AssignmentId: *x.assignment, OrgUnitId: x.target, TripId: x.trip,
		ValidFrom: x.period.Start.UTC(), ValidUntil: x.period.End.UTC(), State: st.Grant,
	}
	switch st.Grant {
	case fleetapi.TemporaryDriverGrantStateEnded:
		reason := fleetapi.TemporaryDriverGrantEndReasonCompleted
		if st.Status == StatusRevoked {
			reason = fleetapi.TemporaryDriverGrantEndReasonRevoked
		}
		g.EndedAt, g.EndReason = utc(st.EndedAt), &reason
	case fleetapi.TemporaryDriverGrantStateClosing:
		overdue := st.Overdue
		g.Overdue = &overdue
	case fleetapi.TemporaryDriverGrantStateScheduled, fleetapi.TemporaryDriverGrantStateActive:
	}
	if st.Vehicle != uuid.Nil {
		v := st.Vehicle
		g.VehicleId = &v
	}
	return g
}

// sees reports whether the subject reads the transfer: fleet.driver_transfers.read over either company.
func (c *cmd) sees(ctx context.Context, x transfer) (bool, error) {
	for _, u := range []uuid.UUID{x.source, x.target} {
		err := c.ev.Permit(ctx, c.tc, actionRead, authz.Resource{Unit: u})
		switch {
		case err == nil:
			return true, nil
		case !problem.Is(err, problem.CodeNotFound) && !problem.Is(err, problem.CodeForbiddenAction):
			return false, err
		}
	}
	return false, nil
}

// visible reads transfer id the subject sees (lock: a locking clause of x or ""); another company — 404, as a missing
// one (AC-01).
func (c *cmd) visible(ctx context.Context, id uuid.UUID, lock string) (transfer, error) {
	x, err := loadTransfer(ctx, c.tx, id, lock)
	if err != nil {
		return transfer{}, err
	}
	ok, err := c.sees(ctx, x)
	switch {
	case err != nil:
		return transfer{}, err
	case !ok:
		return transfer{}, problem.New(problem.CodeNotFound, textTransferNotFound)
	}
	return x, nil
}

// Transfer reads a transfer of either company and its revision (getDriverTransfer).
func (s *Service) Transfer(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (fleetapi.DriverTransfer, error) {
	var out fleetapi.DriverTransfer
	err := s.run(ctx, tc, func(c *cmd) error {
		x, err := c.visible(ctx, id, "")
		if err != nil {
			return err
		}
		if err := attachParts(ctx, c.tx, []*transfer{&x}, c.now); err != nil {
			return err
		}
		out = x.dto(c.now)
		return nil
	})
	return out, err
}

// Transfers lists the transfers the actor reads (either company), filtered by direction — incoming: approve over the
// releasing company, outgoing: request over the requesting one — and by the settled status, the oldest first
// (listDriverTransfers).
func (s *Service) Transfers(ctx context.Context, tc tenantctx.TenantContext, params fleetapi.ListDriverTransfersParams) (fleetapi.DriverTransferPage, error) {
	limit, err := kit.PageLimit(params.Limit)
	if err != nil {
		return fleetapi.DriverTransferPage{}, err
	}
	statuses, err := statusFilter(params.Status)
	if err != nil {
		return fleetapi.DriverTransferPage{}, err
	}
	out := fleetapi.DriverTransferPage{Items: []fleetapi.DriverTransfer{}}
	err = s.run(ctx, tc, func(c *cmd) error {
		var a sqlArgs
		where, err := c.transferFilter(ctx, &a, params.Direction, statuses)
		if err != nil {
			return err
		}
		direction := ""
		if params.Direction != nil {
			direction = string(*params.Direction)
		}
		fp := c.fingerprint("transfers", direction, strings.Join(statuses, ","))
		if params.Cursor != nil {
			at, id, err := keyset(*params.Cursor, fp)
			if err != nil {
				return err
			}
			where = append(where, "(x.created_at, x.id) > ("+a.add(at)+"::timestamptz, "+a.add(id)+"::uuid)")
		}
		rows, err := c.tx.Query(ctx, `select `+transferCols+transferFrom+` where `+strings.Join(where, " and ")+
			` order by x.created_at, x.id limit `+a.add(limit+1), a.vals...)
		if err != nil {
			return err
		}
		list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (transfer, error) { return scanTransfer(r) })
		if err != nil {
			return err
		}
		if len(list) > limit {
			last := list[limit-1]
			next := encodeCursor(fp, last.requestedAt.UTC().Format(time.RFC3339Nano), last.id.String())
			out.NextCursor, list = &next, list[:limit]
		}
		ptrs := make([]*transfer, 0, len(list))
		for i := range list {
			ptrs = append(ptrs, &list[i])
		}
		if err := attachParts(ctx, c.tx, ptrs, c.now); err != nil {
			return err
		}
		for _, x := range list {
			out.Items = append(out.Items, x.dto(c.now))
		}
		return nil
	})
	return out, err
}

// transferFilter is the condition of listDriverTransfers: read over either company, the direction and the settled
// statuses.
func (c *cmd) transferFilter(ctx context.Context, a *sqlArgs, d *fleetapi.ListDriverTransfersParamsDirection, statuses []string) ([]string, error) {
	src, err := a.scope(ctx, c, actionRead, sourceColumns)
	if err != nil {
		return nil, err
	}
	tgt, err := a.scope(ctx, c, actionRead, targetColumns)
	if err != nil {
		return nil, err
	}
	where := []string{"(" + src + " or " + tgt + ")"}
	if d != nil {
		action, cols := actionApprove, sourceColumns
		switch *d {
		case fleetapi.Incoming:
		case fleetapi.Outgoing:
			action, cols = actionRequest, targetColumns
		default:
			return nil, problem.New(problem.CodeMalformedRequest, "")
		}
		pred, err := a.scope(ctx, c, action, cols)
		if err != nil {
			return nil, err
		}
		where = append(where, pred)
	}
	if len(statuses) > 0 {
		where = append(where, "("+strings.ReplaceAll(statusSQL, "%[1]s", a.add(c.now))+") = any("+a.add(statuses)+"::text[])")
	}
	return where, nil
}

// statusFilter checks the statuses of listDriverTransfers (unknown — 400) and sorts them for the cursor.
func statusFilter(in *[]fleetapi.ListDriverTransfersParamsStatus) ([]string, error) {
	if in == nil {
		return nil, nil
	}
	known := map[fleetapi.ListDriverTransfersParamsStatus]bool{
		fleetapi.ListDriverTransfersParamsStatusRequested: true, fleetapi.ListDriverTransfersParamsStatusApproved: true,
		fleetapi.ListDriverTransfersParamsStatusRejected: true, fleetapi.ListDriverTransfersParamsStatusExpired: true,
		fleetapi.ListDriverTransfersParamsStatusRevoked: true, fleetapi.ListDriverTransfersParamsStatusCompleted: true,
	}
	out := make([]string, 0, len(*in))
	for _, s := range *in {
		if !known[s] {
			return nil, problem.New(problem.CodeMalformedRequest, "")
		}
		out = append(out, string(s))
	}
	slices.Sort(out)
	return slices.Compact(out), nil
}
