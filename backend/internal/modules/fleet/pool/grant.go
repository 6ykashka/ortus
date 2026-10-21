package pool

import (
	"context"
	"fmt"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// GrantGuard is what the overlay asks before a reservation for a trip (Service in cmd/api; optional for a TripGuard).
type GrantGuard interface {
	// GrantOn reports whether a transfer of the subject of ctx puts him on trip with a grant that is active or
	// prepares the trip.
	GrantOn(ctx context.Context, trip uuid.UUID) (bool, error)
}

var _ GrantGuard = (*Service)(nil)

// GrantOn reports what the transfers of the subject of ctx leave him on trip at the clock of the service: whether a
// transfer puts him on it with a grant that is active or prepares the trip (an S2-20 transfer before its window). A
// temporary driver never creates reservations (W2.71, variant (a) rejected): reserveVehicle on such a trip is 403.
func (s *Service) GrantOn(ctx context.Context, trip uuid.UUID) (bool, error) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok || !guarded(tc) {
		return false, nil
	}
	db, err := s.db(ctx, tc)
	if err != nil {
		return false, err
	}
	x, err := scanTransfer(db.QueryRow(ctx, `select `+transferCols+transferFrom+`
		 where p.person_id = $1 and x.trip_id = $2 and x.assignment_id is not null
		 order by x.created_at desc, x.id desc limit 1`, tc.PersonID, trip))
	switch {
	case errNoRows(err):
		return false, nil
	case err != nil:
		return false, problem.Wrap(problem.CodeDependencyUnavailable, fmt.Errorf("pool: grant on %s: %w", trip, err))
	}
	switch accessOf(Settle(x.input(), s.now()), x.prepare) {
	case AccessPrepare:
		return true, nil
	case AccessBase:
		return true, nil
	case AccessNone, AccessContinuation:
	}
	return false, nil
}
