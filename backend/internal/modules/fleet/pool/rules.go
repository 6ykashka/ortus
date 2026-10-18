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

// runningTrips are the states of a started trip that is not closed: after the window the temporary driver may only
// finish it — the route, the return, the handover and its rework (D09, AUTH-07); the handed over trip may still come
// back for rework, so the assignment holds (closing) until the acceptance or the cancellation (Q-W2.51-4).
var runningTrips = []string{"inspection", "defect_review", "on_route", "returning", "submitted", "rework"}

// notStartedTrips are the states of a trip the temporary driver has not started: at the end of the window he leaves it.
var notStartedTrips = []string{tripPlanned, tripAssigned}

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
	CompletedAt *time.Time
}

// Settled is a transfer at a moment: its status and the state of its grant as the API shows them, and what the
// settlement writes — the status (Changed: the time changed it, the revision is one more), the upper bound of the
// validity of the grant (GrantUntil, nil — open; GrantChange: it differs from the stored one) and the removal of the
// temporary driver from the trip he did not start (Unassign).
type Settled struct {
	Status      fleetapi.DriverTransferStatus
	Grant       fleetapi.TemporaryDriverGrantState // "" — no grant
	CompletedAt *time.Time
	Revision    int64
	Changed     bool
	GrantUntil  *time.Time
	GrantChange bool
	Unassign    bool
}

func (s Settled) String() string {
	f := func(t *time.Time) string {
		if t == nil {
			return "-"
		}
		return t.UTC().Format(time.RFC3339)
	}
	return fmt.Sprintf("%s grant=%q completedAt=%s rev=%d changed=%v grantUntil=%s grantChange=%v unassign=%v",
		s.Status, s.Grant, f(s.CompletedAt), s.Revision, s.Changed, f(s.GrantUntil), s.GrantChange, s.Unassign)
}

// Settle returns the transfer x at now (Q-W2.51-4, Q-W2.51-15; MSW settlePool):
//   - an open request expires at the start of its window;
//   - an approved transfer is scheduled before the window and active in it; its grant is open while the trip of the
//     driver is started and not closed, ends at the acceptance or the cancellation of the trip and at the end of the
//     window otherwise (the gateway closes the access of a trip not started by itself);
//   - after the window a started trip keeps the assignment closing; otherwise it completes — at the end of the window,
//     at the acceptance of the trip after it, or at the moment its grant was closed after it — and the driver leaves a
//     trip he did not start;
//   - a revoked or completed transfer has an ended grant.
func Settle(x Transfer, now time.Time) Settled {
	out := Settled{Status: x.Status, Revision: x.Revision, CompletedAt: x.CompletedAt}
	switch x.Status {
	case StatusRequested:
		if !now.Before(x.Period.Start) {
			out.Status, out.Revision, out.Changed = StatusExpired, x.Revision+1, true
		}
		return out
	case StatusRevoked, StatusCompleted:
		if x.Grant {
			out.Grant = fleetapi.TemporaryDriverGrantStateEnded
		}
		return out
	case StatusApproved:
		return x.settleApproved(out, now)
	case StatusRejected, StatusExpired:
	}
	return out
}

// settleApproved is Settle of an approved transfer.
func (x Transfer) settleApproved(out Settled, now time.Time) Settled {
	running := x.runs()
	until := x.grantUntil(now, running)
	switch {
	case now.Before(x.Period.Start):
		out.Grant = fleetapi.TemporaryDriverGrantStateScheduled
	case now.Before(x.Period.End):
		out.Grant = fleetapi.TemporaryDriverGrantStateActive
	case running:
		out.Grant = fleetapi.TemporaryDriverGrantStateClosing
	default:
		end := x.completion(now)
		out.Status, out.Grant, out.CompletedAt = StatusCompleted, fleetapi.TemporaryDriverGrantStateEnded, &end
		out.Revision, out.Changed = x.Revision+1, true
		until = earliest(until, &end)
		out.Unassign = x.Trip != nil && x.Trip.Driver == x.Person && slices.Contains(notStartedTrips, x.Trip.State)
	}
	out.GrantUntil = until
	out.GrantChange = x.Grant && !sameMoment(until, x.GrantUpper)
	return out
}

// runs reports whether the trip of x is started by the driver of x and not closed.
func (x Transfer) runs() bool {
	return x.Trip != nil && x.Trip.Driver == x.Person && slices.Contains(runningTrips, x.Trip.State)
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
