package trips

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// etag is the strong ETag of a revision (the TripPlan and the 0.1 Trip of one row share it).
func etag(revision int64) string { return `"` + strconv.FormatInt(revision, 10) + `"` }

// checkRevision compares If-Match with the current revision: missing — 428; anything but the strong ETag — 412.
func checkRevision(ifMatch string, current int64) error {
	v := strings.TrimSpace(ifMatch)
	switch {
	case v == "":
		return problem.New(codeRevisionRequired, "")
	case v != etag(current):
		return problem.New(codeRevisionMismatch, textStale)
	}
	return nil
}

// Finish is «Завершить рейс» (finishTripRoute, S2-07): the driver of a trip on the route moves it to the return
// inspection (returning) with the If-Match of the trip; the moment is routeCompletedAt.
func (s *Service) Finish(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string) (fleetapi.TripPlan, error) {
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return fleetapi.TripPlan{}, err
	}
	var out fleetapi.TripPlan
	err = inTx(ctx, pool, func(tx pgx.Tx) error {
		s := s.inTx(tx)
		t, err := lockTrip(ctx, tx, id, textTripNotFound)
		if err != nil {
			return err
		}
		if err := s.authorize(ctx, tx, tc, t, actionReturn, textTripNotFound, textDriverOnlyShift); err != nil {
			return err
		}
		if err := checkRevision(ifMatch, t.revision); err != nil {
			return err
		}
		if err := t.finishable(); err != nil {
			return err
		}
		now := s.now()
		if _, err := tx.Exec(ctx, `update fleet.trips set state = 'returning', route_completed_at = $2, revision = revision + 1
			 where id = $1`, t.id, now); err != nil {
			return fmt.Errorf("trips: finish: %w", err)
		}
		if _, err := record(ctx, tx, tc, t, "fleet.trip.finish_route", eventCompleted, map[string]any{"routeCompletedAt": now}); err != nil {
			return err
		}
		if out, err = loadPlan(ctx, tx, t.id); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, dbError(err)
}

// startKmSQL is the odometer of the departure inspection of a trip: the start of the return (LOG-09).
const startKmSQL = `
select coalesce(nullif(answers->>'odometerKm', '')::numeric, odometer_km)::float8 from fleet.inspections where id = $1`

// reworkSinceSQL is the moment of the latest review that sent the shift back for rework.
const reworkSinceSQL = `
select max(reviewed_at) from fleet.trip_reviews where trip_id = $1 and decision = 'rework'`

// Return is «Сдать машину» (returnTrip, S2-09): the driver submits the shift with the latest return inspection of the
// trip (after a rework — a new one), its odometer not below the departure; the trip waits for the acceptance
// (submitted), the vehicle stays occupied until the manager accepts it (W2.06). New defects come with the return
// inspection (W2.04).
func (s *Service) Return(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b fleetapi.TripReturn) (fleetapi.Trip, error) {
	if err := checkReturn(&b); err != nil {
		return fleetapi.Trip{}, err
	}
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return fleetapi.Trip{}, err
	}
	var out fleetapi.Trip
	err = inTx(ctx, pool, func(tx pgx.Tx) error {
		s := s.inTx(tx)
		insp, err := lockInspection(ctx, tx, b.ReturnInspectionId)
		if err != nil {
			return err
		}
		t, err := lockTrip(ctx, tx, id, textTripNotFound)
		if err != nil {
			return err
		}
		if err := s.authorize(ctx, tx, tc, t, actionReturn, textTripNotFound, textDriverOnlyShift); err != nil {
			return err
		}
		if err := checkRevision(ifMatch, t.revision); err != nil {
			return err
		}
		if out, err = s.submit(ctx, tx, tc, t, insp); err != nil {
			return err
		}
		return complete(ctx, tx, http.StatusOK, etag(out.Revision), out)
	})
	return out, dbError(err)
}

// submit runs the return of the locked trip t the subject may return.
func (s *Service) submit(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, t tripRow, insp *inspRow) (fleetapi.Trip, error) {
	var startKm float64
	if t.departure != nil {
		if err := tx.QueryRow(ctx, startKmSQL, *t.departure).Scan(&startKm); err != nil && !errNoRows(err) {
			return fleetapi.Trip{}, fmt.Errorf("trips: departure odometer: %w", err)
		}
	}
	var since *time.Time
	if err := tx.QueryRow(ctx, reworkSinceSQL, t.id).Scan(&since); err != nil {
		return fleetapi.Trip{}, fmt.Errorf("trips: reviews: %w", err)
	}
	if err := t.returnable(insp, startKm, since); err != nil {
		return fleetapi.Trip{}, err
	}
	now := s.now()
	if _, err := tx.Exec(ctx, `update fleet.trips set state = 'submitted', returned_at = $2, revision = revision + 1
		 where id = $1`, t.id, now); err != nil {
		return fleetapi.Trip{}, fmt.Errorf("trips: return: %w", err)
	}
	plan, err := loadPlan(ctx, tx, t.id)
	if err != nil {
		return fleetapi.Trip{}, err
	}
	out, ok := tripOf(plan)
	if !ok {
		return fleetapi.Trip{}, fmt.Errorf("trips: trip %s has no 0.1 projection", t.id)
	}
	diff := map[string]any{"returnInspectionId": insp.id, "returnedAt": now, "odometerKm": insp.odometer}
	ev, err := record(ctx, tx, tc, t, "fleet.trip.return", eventSubmitted, diff)
	if err != nil {
		return fleetapi.Trip{}, err
	}
	var vehicle uuid.UUID
	if t.vehicle != nil {
		vehicle = *t.vehicle
	}
	name, plate, err := vehicleName(ctx, tx, vehicle)
	if err != nil {
		return fleetapi.Trip{}, err
	}
	return out, s.notifyManagers(ctx, tx, tc.TenantID, t, ev, noticeSubmitted, submittedTitle(t.number, name, plate))
}
