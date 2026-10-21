package pool

// W2.72, return 1 (docs/29 «События»: «фирме машины — «машина выбрана / освобождена»», rule 8): the logist of the trip
// company changes the vehicle after the choice (assignTripVehicle) or releases a reservation of an offer
// (releaseReservation); the company of a released vehicle of another company than the trip is told «машина
// освобождена». The base commands write the release (its event and audit); the overlay reads the live reservations of
// the offer before the command and tells the companies of those released after it commits.

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/offers" //nolint:depguard // W2.72: the reservations of an offer of the same module
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// foreignOffersSQL: the live reservations of an offer of the trip $1 on vehicles of other companies than the trip.
const foreignOffersSQL = `select r.bundle_id from sched.reservations r
  join sched.resources s on s.id = r.resource_id and s.kind = 'vehicle'
  join fleet.trips t on t.id = r.source_id
 where r.source_type = 'fleet.trip' and r.source_id = $1 and r.offer_group_id is not null
   and r.state in ('hold', 'confirmed') and s.home_unit_id <> t.unit_id`

// releasedSQL: those of the reservations $2 of the trip $1 released since, with their vehicle and its company.
const releasedSQL = `select r.bundle_id, s.ref_id, s.home_unit_id from sched.reservations r
  join sched.resources s on s.id = r.resource_id and s.kind = 'vehicle'
  join fleet.trips t on t.id = r.source_id
 where r.source_type = 'fleet.trip' and r.source_id = $1 and r.bundle_id = any($2::uuid[]) and r.state = 'released'
   and r.offer_group_id is not null and s.home_unit_id <> t.unit_id`

// ForeignOffers returns the live reservations of an offer of trip on vehicles of other companies than the trip: the
// overlay reads them before a command of the base that may release them.
func (s *Service) ForeignOffers(ctx context.Context, tc tenantctx.TenantContext, trip uuid.UUID) ([]uuid.UUID, error) {
	db, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return nil, err
	}
	rows, err := db.Query(ctx, foreignOffersSQL, trip)
	if err != nil {
		return nil, fmt.Errorf("pool: offers of %s: %w", trip, err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return nil, fmt.Errorf("pool: offers of %s: %w", trip, err)
	}
	return ids, nil
}

// NotifyReleased tells the company of the vehicle of every reservation of bundles released meanwhile «Машина …
// освобождена: рейс …» (fleet.reservations.manage over the unit of the vehicle and the owners), in a transaction of its
// own after the command; without the recipients nothing is sent.
func (s *Service) NotifyReleased(ctx context.Context, tc tenantctx.TenantContext, trip uuid.UUID, bundles []uuid.UUID) error {
	if len(bundles) == 0 || s.Recipients == nil || s.Audience == nil || tc.TenantID == uuid.Nil {
		return nil
	}
	db, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return err
	}
	now := s.now()
	return pgx.BeginFunc(ctx, db, func(tx pgx.Tx) error {
		c := &cmd{s: s, tx: tx, ev: s.within(tx, now), tc: tc, now: now}
		t, err := loadTripCargo(ctx, tx, trip, false)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, releasedSQL, trip, bundles)
		if err != nil {
			return fmt.Errorf("pool: released of %s: %w", trip, err)
		}
		released, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (offers.Released, error) {
			var x offers.Released
			return x, r.Scan(&x.Bundle, &x.Vehicle, &x.Unit)
		})
		if err != nil {
			return fmt.Errorf("pool: released of %s: %w", trip, err)
		}
		return c.notifyReleased(ctx, t, released)
	})
}
