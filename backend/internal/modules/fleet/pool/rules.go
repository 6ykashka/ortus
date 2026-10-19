package pool

import (
	"bytes"
	"fmt"
	"slices"
	"strconv"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.07: shared command helpers of the modules (cursor, ETag; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Statuses of a transfer (DriverTransfer.status, fleet.driver_transfers.state).
const (
	StatusRequested = fleetapi.DriverTransferStatusRequested
	StatusApproved  = fleetapi.DriverTransferStatusApproved
	StatusRejected  = fleetapi.DriverTransferStatusRejected
	StatusExpired   = fleetapi.DriverTransferStatusExpired
	StatusRevoked   = fleetapi.DriverTransferStatusRevoked
	StatusCompleted = fleetapi.DriverTransferStatusCompleted
)

// States of a trip the pool reads (fleet.trips.state).
const (
	tripPlanned   = "planned"
	tripAssigned  = "assigned"
	tripAccepted  = "accepted"
	tripCancelled = "cancelled"
)

// startedTrips are the states of a started trip that is not closed (W2.57, Q-W2.07-1: started from on_route): after
// the window or a revocation the temporary driver may only finish it — the route, the return, the handover and its
// rework (D09, AUTH-07); the handed over trip may still come back for rework, so the assignment holds (closing) until
// the acceptance or the cancellation (Q-W2.51-4). A trip in inspection or defect_review has not left: it is new work.
var startedTrips = []string{"on_route", "returning", "submitted", "rework"}

// handedOver is the started state in which the driver has handed the trip over: closing without being overdue.
const handedOver = "submitted"

// notStartedTrips are the states of a trip the temporary driver has not started: at the end of the window he leaves it.
var notStartedTrips = []string{tripPlanned, tripAssigned}

// Kinds of an inspection (InspectionCreate.kind).
const (
	kindDeparture = "departure"
	kindReturn    = "return"
)

// TemporaryDriverActions are the actions of the system role «Временный водитель» (api/permissions.yaml
// role_templates.temporary_driver, Q-W2.07-1 «только рейс»): the trip the driver drives and its objects in scope self.
// TemporaryDriverResourceActions act through the second row of the role in scope resource — the vehicle of the trip.
var (
	TemporaryDriverActions = []string{
		"files.read", "files.upload", "fleet.vehicles.read", "fleet.reservations.read", "fleet.inspections.read",
		"fleet.inspections.submit", "fleet.trips.read", "fleet.trips.start", "fleet.trips.return", "fleet.routes.read",
		"fleet.expenses.read", "fleet.expenses.create",
	}
	TemporaryDriverResourceActions = []string{"fleet.vehicles.read"}
)

// continuation are the operations of the tag Fleet that only finish a started trip and read it (D09: the return, the
// return inspection, the expenses and the photos of this trip; 08-domain-scenarios §4.6 п. 7–8).
var continuation = map[string]bool{
	"getTrip": true, "getTripPlan": true, "finishTripRoute": true, "returnTrip": true, "getInspection": true,
	"getInspectionDefect": true, "listTripExpenses": true, "createTripExpense": true, "getTripExpense": true,
	"submitInspection": true,
}

// Continues reports whether operation op on a trip in its continuation (closing) is allowed: the operations of
// continuation; submitInspection only with kind return (a departure inspection is new work).
func Continues(op, kind string) bool {
	if op == "submitInspection" {
		return kind == kindReturn
	}
	return continuation[op]
}

// Extension checks the new end until of the window period of an approved transfer at now (decision extend): later
// than the current end (else textWindow) and than now (else textWindowPast), inside the free window of its publication
// (else textOutside). The start never moves.
func Extension(period, free Window, until, now time.Time) (Window, error) {
	w := Window{Start: period.Start, End: until}
	switch {
	case !until.After(period.End):
		return Window{}, invalid(textWindow, violationEnd)
	case !until.After(now):
		return Window{}, invalid(textWindowPast, violationEnd)
	case !w.Within(free):
		return Window{}, invalid(textOutside, violationOutside)
	}
	return w, nil
}

// labelPrefix is the pool label of a published driver (Водитель #N, DriverPoolPublication.displayName).
const labelPrefix = "Водитель #"

// Window is a half-open interval [Start, End).
type Window struct{ Start, End time.Time }

// Valid reports whether the window is not empty.
func (w Window) Valid() bool { return w.Start.Before(w.End) }

// Within reports whether w is a window inside outer.
func (w Window) Within(outer Window) bool {
	return w.Valid() && !w.Start.Before(outer.Start) && !w.End.After(outer.End)
}

// Overlaps reports whether the windows w and o share a moment.
func (w Window) Overlaps(o Window) bool {
	return w.Valid() && o.Valid() && w.Start.Before(o.End) && o.Start.Before(w.End)
}

// Candidate is an active publication of a driver a request may name.
type Candidate struct {
	ID   uuid.UUID
	Free Window
}

// ChoosePublication picks the publication of a request without publicationId (Q-W2.51-13, variant A): among the
// active publications of the driver the one whose free window contains w, otherwise one that overlaps w, otherwise
// any; the earliest free window first, then the smaller id. false: the driver has no active publication.
func ChoosePublication(active []Candidate, w Window) (Candidate, bool) {
	if len(active) == 0 {
		return Candidate{}, false
	}
	sorted := slices.Clone(active)
	slices.SortFunc(sorted, func(a, b Candidate) int {
		if c := a.Free.Start.Compare(b.Free.Start); c != 0 {
			return c
		}
		return bytes.Compare(a.ID[:], b.ID[:])
	})
	if i := slices.IndexFunc(sorted, func(c Candidate) bool { return w.Within(c.Free) }); i >= 0 {
		return sorted[i], true
	}
	if i := slices.IndexFunc(sorted, func(c Candidate) bool { return c.Free.Overlaps(w) }); i >= 0 {
		return sorted[i], true
	}
	return sorted[0], true
}

// PublicationState is the state of a publication at now: withdrawn by the source company, expired when the free
// window is over, active otherwise.
func PublicationState(free Window, withdrawn bool, now time.Time) fleetapi.DriverPoolPublicationState {
	switch {
	case withdrawn:
		return fleetapi.DriverPoolPublicationStateWithdrawn
	case !now.Before(free.End):
		return fleetapi.DriverPoolPublicationStateExpired
	}
	return fleetapi.DriverPoolPublicationStateActive
}

// NextLabel is the pool label after the largest number of the tenant (MSW nextLabel).
func NextLabel(maxNumber int) string { return labelPrefix + strconv.Itoa(maxNumber+1) }

// TripState is the trip of a transfer as the settlement reads it.
type TripState struct {
	State      string
	Driver     uuid.UUID  // uuid.Nil: no driver
	Vehicle    uuid.UUID  // fleet.trips.vehicle_id, the vehicle reserved for the trip; uuid.Nil: none
	AcceptedAt *time.Time // fleet.trips.reviewed_at of an accepted trip
}

// Transfer is what the settlement needs of a stored transfer.
type Transfer struct {
	Status      fleetapi.DriverTransferStatus
	Period      Window
	Revision    int64
	Person      uuid.UUID // the driver
	Trip        *TripState
	Grant       bool       // the transfer has a temporary assignment
	GrantUpper  *time.Time // upper(valid) of the assignment; nil — open
	GrantLive   bool       // the assignment is active and not empty: the revocation of a started trip left it open
	CompletedAt *time.Time
}

// Settled is a transfer at a moment: its status and the state of its grant as the API shows them, and what the
// settlement writes — the status (Changed: the time changed it, the revision is one more), the upper bound of the
// validity of the grant (GrantUntil, nil — open; GrantChange: it differs from the stored one), the removal of the
// temporary driver from the trip he did not start (Unassign) and the grant of the vehicle of the trip: Vehicle — the
// vehicle whose grant is open now (uuid.Nil — none), VehicleUntil — the bound no grant of a vehicle of the transfer
// outlives (the end of the window, the revocation or the end of the grant). Overdue: closing and the trip not handed
// over yet; EndedAt: the moment the grant ended.
type Settled struct {
	Status       fleetapi.DriverTransferStatus
	Grant        fleetapi.TemporaryDriverGrantState // "" — no grant
	CompletedAt  *time.Time
	Revision     int64
	Changed      bool
	GrantUntil   *time.Time
	GrantChange  bool
	Unassign     bool
	Overdue      bool
	EndedAt      *time.Time
	Vehicle      uuid.UUID
	VehicleUntil *time.Time
}

func (s Settled) String() string {
	f := func(t *time.Time) string {
		if t == nil {
			return "-"
		}
		return t.UTC().Format(time.RFC3339)
	}
	return fmt.Sprintf("%s grant=%q completedAt=%s rev=%d changed=%v grantUntil=%s grantChange=%v unassign=%v "+
		"overdue=%v endedAt=%s vehicle=%s vehicleUntil=%s", s.Status, s.Grant, f(s.CompletedAt), s.Revision, s.Changed,
		f(s.GrantUntil), s.GrantChange, s.Unassign, s.Overdue, f(s.EndedAt), s.Vehicle, f(s.VehicleUntil))
}

// Settle returns the transfer x at now (Q-W2.51-4, Q-W2.51-15, Q-W2.07-1; MSW settlePool):
//   - an open request expires at the start of its window;
//   - an approved transfer is scheduled before the window and active in it; its grant is open while the trip of the
//     driver is started (from on_route) and not closed, ends at the end of the window otherwise; the acceptance, the
//     cancellation and taking the driver off the trip end it at once (also inside the window) and complete the transfer;
//   - after the window a started trip keeps the assignment closing (only its continuation, D09); otherwise it completes
//     — at the end of the window, at the acceptance of the trip after it, or at the moment its grant was closed after
//     it — and the driver leaves a trip he did not start;
//   - a revoked transfer of a started trip keeps the continuation (closing) until the trip is closed or loses the
//     driver; a revoked or completed transfer has an ended grant otherwise;
//   - the vehicle of the trip is open while the grant is scheduled or active, never after the end of the window or the
//     revocation.
func Settle(x Transfer, now time.Time) Settled {
	out := Settled{Status: x.Status, Revision: x.Revision, CompletedAt: x.CompletedAt}
	switch x.Status {
	case StatusRequested:
		if !now.Before(x.Period.Start) {
			out.Status, out.Revision, out.Changed = StatusExpired, x.Revision+1, true
		}
		return out
	case StatusRevoked:
		out = x.settleRevoked(out, now)
	case StatusCompleted:
		if x.Grant {
			out.Grant, out.GrantUntil, out.EndedAt = fleetapi.TemporaryDriverGrantStateEnded, x.GrantUpper, x.CompletedAt
		}
	case StatusApproved:
		out = x.settleApproved(out, now)
	case StatusRejected, StatusExpired:
		return out
	}
	if x.Grant {
		end := x.Period.End
		out.VehicleUntil = earliest(earliest(out.GrantUntil, &end), x.revokedAt())
	}
	return out
}

// settleApproved is Settle of an approved transfer.
func (x Transfer) settleApproved(out Settled, now time.Time) Settled {
	started := x.started()
	until := x.grantUntil(now, started)
	switch {
	case !now.Before(x.Period.End) && !started:
		end := x.completion(now)
		out = x.complete(out, end)
		until = earliest(until, &end)
		out.Unassign = x.Trip != nil && x.Trip.Driver == x.Person && slices.Contains(notStartedTrips, x.Trip.State)
	case x.closed() || x.lost():
		end := x.closedAt(now)
		out = x.complete(out, end)
		until = earliest(x.GrantUpper, new(later(end, x.Period.Start)))
	case now.Before(x.Period.Start):
		out.Grant = fleetapi.TemporaryDriverGrantStateScheduled
	case now.Before(x.Period.End):
		out.Grant = fleetapi.TemporaryDriverGrantStateActive
	default:
		out.Grant = fleetapi.TemporaryDriverGrantStateClosing
		out.Overdue = x.Trip.State != handedOver
	}
	out.Vehicle = x.openVehicle(out.Grant)
	out.GrantUntil = until
	out.GrantChange = x.Grant && !sameMoment(until, x.GrantUpper)
	return out
}

// openVehicle is the vehicle of the trip of x whose grant is open while the grant of x is in state g: only while it is
// scheduled or active, never in closing (D09: the continuation does not take the vehicle again).
func (x Transfer) openVehicle(g fleetapi.TemporaryDriverGrantState) uuid.UUID {
	open := g == fleetapi.TemporaryDriverGrantStateScheduled || g == fleetapi.TemporaryDriverGrantStateActive
	if !open || x.Trip == nil || x.Trip.Driver != x.Person {
		return uuid.Nil
	}
	return x.Trip.Vehicle
}

// complete is out completed at end: the status, the ended grant and the revision of the change.
func (x Transfer) complete(out Settled, end time.Time) Settled {
	out.Status, out.Grant, out.CompletedAt, out.EndedAt = StatusCompleted, fleetapi.TemporaryDriverGrantStateEnded, &end, &end
	out.Revision, out.Changed = x.Revision+1, true
	return out
}

// settleRevoked is Settle of a revoked transfer: the continuation of a started trip the revocation left open (D09,
// 08-domain-scenarios §4.6 п. 8) is closing until the trip is closed or loses the driver; then — and for a trip not
// started — the grant is ended.
func (x Transfer) settleRevoked(out Settled, now time.Time) Settled {
	switch {
	case !x.Grant:
		return out
	case !x.GrantLive:
		out.Grant, out.GrantUntil, out.EndedAt = fleetapi.TemporaryDriverGrantStateEnded, x.GrantUpper, x.CompletedAt
		return out
	case x.GrantUpper != nil:
		out.Grant, out.GrantUntil, out.EndedAt = fleetapi.TemporaryDriverGrantStateEnded, x.GrantUpper, x.GrantUpper
		return out
	}
	if x.started() {
		out.Grant, out.Overdue = fleetapi.TemporaryDriverGrantStateClosing, x.Trip.State != handedOver
		return out
	}
	end := x.closedAt(now)
	out.Grant, out.GrantUntil, out.EndedAt, out.GrantChange = fleetapi.TemporaryDriverGrantStateEnded, &end, &end, true
	return out
}

// started reports whether the trip of x is started by the driver of x and not closed (D09).
func (x Transfer) started() bool {
	return x.Trip != nil && x.Trip.Driver == x.Person && slices.Contains(startedTrips, x.Trip.State)
}

// closed reports whether the trip of x driven by its driver is accepted or cancelled.
func (x Transfer) closed() bool {
	return x.Trip != nil && x.Trip.Driver == x.Person && (x.Trip.State == tripAccepted || x.Trip.State == tripCancelled)
}

// lost reports whether the driver of x was taken off its trip (Q-W2.07-14).
func (x Transfer) lost() bool { return x.Trip != nil && x.Trip.Driver != x.Person }

// closedAt is the moment the trip of x closed its grant: the acceptance; the moment of the settlement for a cancelled
// trip or a driver taken off it (the trip does not store the moment).
func (x Transfer) closedAt(now time.Time) time.Time {
	if x.Trip != nil && x.Trip.Driver == x.Person && x.Trip.State == tripAccepted && x.Trip.AcceptedAt != nil {
		return *x.Trip.AcceptedAt
	}
	return now
}

// revokedAt is the moment of the revocation of x (completed_at of a revoked transfer); nil — not revoked.
func (x Transfer) revokedAt() *time.Time {
	if x.Status == StatusRevoked {
		return x.CompletedAt
	}
	return nil
}

func later(a, b time.Time) time.Time {
	if a.After(b) {
		return a
	}
	return b
}

// grantUntil is the upper bound of the grant of an approved transfer: open while its trip runs; the acceptance or the
// cancellation of the trip (never later than the stored bound, never before the start); the end of the window otherwise.
func (x Transfer) grantUntil(now time.Time, running bool) *time.Time {
	if running {
		return nil
	}
	if x.Trip != nil && x.Trip.Driver == x.Person {
		var closed *time.Time
		switch {
		case x.Trip.State == tripAccepted && x.Trip.AcceptedAt != nil:
			closed = x.Trip.AcceptedAt
		case x.Trip.State == tripCancelled, x.Trip.State == tripAccepted:
			closed = &now
		}
		if closed != nil {
			c := *closed
			if c.Before(x.Period.Start) {
				c = x.Period.Start
			}
			return earliest(x.GrantUpper, &c)
		}
	}
	end := x.Period.End
	return &end
}

// completion is the moment an approved transfer whose window is over completes: the acceptance of its trip after the
// window, the moment its grant was closed after the window, the moment of the settlement for a cancelled trip whose
// grant is still open, the end of the window otherwise.
func (x Transfer) completion(now time.Time) time.Time {
	end := x.Period.End
	switch {
	case x.Trip != nil && x.Trip.Driver == x.Person && x.Trip.State == tripAccepted && x.Trip.AcceptedAt != nil &&
		x.Trip.AcceptedAt.After(end):
		return *x.Trip.AcceptedAt
	case x.GrantUpper != nil && x.GrantUpper.After(end):
		return *x.GrantUpper
	case x.GrantUpper == nil && x.Grant && x.Trip != nil && x.Trip.Driver == x.Person && x.Trip.State == tripCancelled:
		return now
	}
	return end
}

// earliest is the earlier of two bounds; nil is the open bound.
func earliest(a, b *time.Time) *time.Time {
	switch {
	case a == nil:
		return b
	case b == nil, a.Before(*b):
		return a
	}
	return b
}

func sameMoment(a, b *time.Time) bool { return (a == nil) == (b == nil) && (a == nil || a.Equal(*b)) }

// encodeCursor returns the opaque cursor of a keyset position bound to fingerprint — the tenant, the actor and the
// filters of the list (DriverTransferPage: «bound to tenant, principal, effective scopes, filters and sort»).
func encodeCursor(fingerprint string, keys ...string) string {
	return kit.EncodeCursor(append([]string{fingerprint}, keys...)...)
}

// decodeCursor returns the n keys of a cursor of fingerprint; another list's cursor or a malformed one is 400.
func decodeCursor(s, fingerprint string, n int) ([]string, error) {
	keys, err := kit.DecodeCursor(s, n+1)
	if err != nil {
		return nil, err
	}
	if keys[0] != fingerprint {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	return keys[1:], nil
}
