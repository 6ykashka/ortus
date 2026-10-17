// Package fleet is the source of the logistics module for «Требует решения» (W2.09, S2-18): blocking defects in
// review, shifts handed in for acceptance and trips without a driver. Every query carries the scope predicate of the
// action the card leads to (scopeddb), so a member sees only the situations he may decide now (PD-53).
package fleet

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/modules/home" //nolint:depguard // the registry this source plugs into
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
)

// ModuleKey is the key of the logistics module in the module registry.
const ModuleKey = "fleet"

// Kinds of the cards (api/openapi/components/home/schemas.yaml DecisionItem.kind).
const (
	KindBlockingDefect    = "fleet.blocking_defect"
	KindTripReview        = "fleet.trip_review"
	KindTripWithoutDriver = "fleet.trip_without_driver"
)

// Actions the cards lead to (api/permissions.yaml, fleet).
const (
	actionDefects = "fleet.inspections.review" // «Решить»: the queue of blocking defects (W2.04)
	actionReview  = "fleet.trips.review"       // «Принять смену» (W2.06)
	actionPlan    = "fleet.routes.manage"      // «Назначить водителя» (W2.03)
)

// maxPerKind bounds every query: the queue shows 8 cards, and a business of the pilot has tens of vehicles; total
// counts at most this many cards of a kind.
const maxPerKind = 200

// Columns of the scope predicates: a defect is decided in the unit of its vehicle (as the queue of W2.04), a trip in
// its own unit; territorial grants only (x-scope responsible-manager-or-owner) — no «own» people columns.
var (
	defectColumns = authz.Columns{Unit: "v.unit_id"}
	tripColumns   = authz.Columns{Unit: "t.unit_id"}
)

// Source reads the cards of the logistics module from the tenant DB of the request.
type Source struct {
	Pools scopeddb.Pools  // tenantctx.Pools
	Authz scopeddb.Scoper // *authz.Evaluator
}

var _ home.Source = Source{}

// Module implements home.Source.
func (Source) Module() string { return ModuleKey }

// Cards implements home.Source: blocking defects (danger), shifts handed in (warn), then — while the module is active
// (planning is closed in read_only and draining) — trips without a driver (info).
func (s Source) Cards(ctx context.Context, q home.Query) ([]homeapi.DecisionItem, error) {
	conn, err := scopeddb.For(ctx, s.Pools, s.Authz, q.Tenant)
	if err != nil {
		return nil, err
	}
	out, err := blockingDefects(ctx, conn)
	if err != nil {
		return nil, err
	}
	reviews, err := tripReviews(ctx, conn)
	if err != nil {
		return nil, err
	}
	out = append(out, reviews...)
	if q.ModuleState != "active" {
		return out, nil
	}
	free, err := tripsWithoutDriver(ctx, conn)
	if err != nil {
		return nil, err
	}
	return append(out, free...), nil
}

func tripRef(id uuid.UUID) *homeapi.ObjectRef {
	return &homeapi.ObjectRef{ModuleKey: ModuleKey, EntityType: "trip", EntityId: id}
}

func utc(t time.Time) *time.Time {
	u := t.UTC()
	return &u
}

// collect runs a scoped query and scans every row with scan.
func collect(ctx context.Context, conn *scopeddb.Conn, action string, cols authz.Columns, sql string,
	scan func(pgx.CollectableRow) (homeapi.DecisionItem, error)) ([]homeapi.DecisionItem, error) {
	rows, err := conn.Query(ctx, action, cols, sql, maxPerKind)
	if err != nil {
		return nil, fmt.Errorf("home/fleet: %s: %w", action, err)
	}
	items, err := pgx.CollectRows(rows, scan)
	if err != nil {
		return nil, fmt.Errorf("home/fleet: %s: %w", action, err)
	}
	return items, nil
}

// blockingDefects are the defects in review (S2-17) of the vehicles of the review scope, oldest first.
func blockingDefects(ctx context.Context, conn *scopeddb.Conn) ([]homeapi.DecisionItem, error) {
	return collect(ctx, conn, actionDefects, defectColumns, `
	select d.id, d.zone, d.description, d.created_at, t.id, t.number, coalesce(p.full_name, '')
	  from fleet.defects d
	  join fleet.vehicles v on v.id = d.vehicle_id
	  join fleet.trips t on t.id = d.trip_id
	  left join people.person_profiles p on p.id = t.driver_person_id
	 where d.state = 'in_review' and `+scopeddb.Placeholder+`
	 order by d.created_at, d.id
	 limit $1`, func(row pgx.CollectableRow) (homeapi.DecisionItem, error) {
		var (
			id, trip                          uuid.UUID
			zone, description, number, driver string
			at                                time.Time
		)
		if err := row.Scan(&id, &zone, &description, &at, &trip, &number, &driver); err != nil {
			return homeapi.DecisionItem{}, err
		}
		return homeapi.DecisionItem{
			Key: KindBlockingDefect + ":" + id.String(), Kind: KindBlockingDefect, ModuleKey: ModuleKey, Tone: homeapi.Danger,
			Object: tripRef(trip), OccurredAt: utc(at),
			Params: map[string]string{"tripNumber": number, "zone": zone, "description": description, "driverName": driver},
		}, nil
	})
}

// tripReviews are the shifts handed in for acceptance (state submitted) of the trips of the review scope, in the
// order they were handed in.
func tripReviews(ctx context.Context, conn *scopeddb.Conn) ([]homeapi.DecisionItem, error) {
	return collect(ctx, conn, actionReview, tripColumns, `
	select t.id, t.number, t.returned_at, coalesce(p.full_name, '')
	  from fleet.trips t
	  left join people.person_profiles p on p.id = t.driver_person_id
	 where t.state = 'submitted' and `+scopeddb.Placeholder+`
	 order by t.returned_at nulls last, t.created_at, t.id
	 limit $1`, func(row pgx.CollectableRow) (homeapi.DecisionItem, error) {
		var (
			id             uuid.UUID
			number, driver string
			returned       *time.Time
		)
		if err := row.Scan(&id, &number, &returned, &driver); err != nil {
			return homeapi.DecisionItem{}, err
		}
		it := homeapi.DecisionItem{
			Key: KindTripReview + ":" + id.String(), Kind: KindTripReview, ModuleKey: ModuleKey, Tone: homeapi.Warn,
			Object: tripRef(id), Params: map[string]string{"tripNumber": number, "driverName": driver},
		}
		if returned != nil {
			it.OccurredAt = utc(*returned)
		}
		return it, nil
	})
}

// tripsWithoutDriver are the planned trips of the planning scope without a driver, the earliest first; a pending
// request to the driver pool adds poolRequest and the unit the driver comes from (MSW W2.00).
func tripsWithoutDriver(ctx context.Context, conn *scopeddb.Conn) ([]homeapi.DecisionItem, error) {
	return collect(ctx, conn, actionPlan, tripColumns, `
	select t.id, t.number, coalesce(t.title, ''), coalesce(t.cargo_description, ''), lower(t.planned),
	       r.id is not null, coalesce(u.name, '')
	  from fleet.trips t
	  left join lateral (select x.id, x.source_unit_id from fleet.driver_transfers x
	                      where x.trip_id = t.id and x.state = 'requested'
	                      order by x.created_at, x.id limit 1) r on true
	  left join org.units u on u.id = r.source_unit_id
	 where t.state = 'planned' and t.driver_person_id is null and `+scopeddb.Placeholder+`
	 order by lower(t.planned), t.number, t.id
	 limit $1`, func(row pgx.CollectableRow) (homeapi.DecisionItem, error) {
		var (
			id                         uuid.UUID
			number, title, cargo, home string
			starts                     time.Time
			pool                       bool
		)
		if err := row.Scan(&id, &number, &title, &cargo, &starts, &pool, &home); err != nil {
			return homeapi.DecisionItem{}, err
		}
		params := map[string]string{"tripNumber": number, "title": title, "cargo": cargo, "startsAt": starts.UTC().Format(time.RFC3339)}
		if pool {
			params["poolRequest"], params["poolHome"] = "pending", home
		}
		return homeapi.DecisionItem{
			Key: KindTripWithoutDriver + ":" + id.String(), Kind: KindTripWithoutDriver, ModuleKey: ModuleKey, Tone: homeapi.Info,
			Object: tripRef(id), Params: params,
		}, nil
	})
}
