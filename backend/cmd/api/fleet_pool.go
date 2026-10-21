package main

import (
	"context"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/files"
	"github.com/ortus/ortus-crm/backend/internal/modules/fleet/pool"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// fleetPool overlays the driver pool of W2.07 on base, the server of the tag Fleet the other modules build (nil:
// their operations answer 501): the publications of the releasing company, the catalog, the requests and the
// decisions with the temporary assignment (fleet/pool). The overlay passes reserveVehicle, releaseReservation,
// startTrip, reviewTrip and assignTripVehicle down and settles the transfers of their trip after them (the grant of a
// temporary driver opens at the start of his trip, closes at its acceptance, the grant of the vehicle of the trip
// follows its vehicle — Q-W2.51-15, W2.57); the worker settles it on its schedule too. W2.57 (Q-W2.07-1 «только
// рейс», AC-06, D09): the operations on a trip and its objects ask the service first — a trip of a transfer answers
// its driver 404 outside its grant and keeps only its continuation while the grant is closing (pool.Server.Trips).
// The requesting logists and the owners (owner bindings of the control DB) learn the decision through the inbox port
// (W1.10); the clock is the one of the application (APP_FIXED_NOW outside prod).
func fleetPool(base fleetapi.StrictServerInterface, pools pool.Pools, ev *authz.Evaluator, control inbox.ControlDB, now func() time.Time) fleetapi.StrictServerInterface {
	return pool.NewServer(base, &pool.Service{
		Pools: pools, Authz: ev, Recipients: inbox.PGRecipients{Control: control}, Owners: pool.ControlOwners{Control: control},
		Audience: inbox.AuthzAudience{E: ev}, Now: now,
	})
}

// poolTrips tells the modules that read the objects of a trip outside the tag Fleet — the files of W1.09 (the photos
// of the trip, its inspections and the receipts of its expenses) and «Данные» of W2.08 («Поездки», «Расходы») — which
// trips the transfers of the subject close to him now (pool.Service.HiddenTrips): the trip of a transfer before and
// after the grant of its driver (W2.57, AC-06: «после срока — 404», 02 §7 п. 5 «не открывает исторические рейсы… и
// все вложения»). The pool reads the same tenant pools on the same clock as the overlay of the tag Fleet.
type poolTrips struct{ S *pool.Service }

var (
	_ files.Hider = poolTrips{}
	_ data.Hider  = poolTrips{}
)

// newPoolTrips is the pool of the trips closed to the subject over the tenant pools and the clock of the application.
func newPoolTrips(pools pool.Pools, now func() time.Time) poolTrips {
	return poolTrips{S: &pool.Service{Pools: pools, Now: now}}
}

// Hidden implements data.Hider: the trips closed to the subject.
func (p poolTrips) Hidden(ctx context.Context, tc tenantctx.TenantContext) ([]uuid.UUID, error) {
	closed, err := p.S.HiddenTrips(ctx, tc)
	if err != nil {
		return nil, err
	}
	out := make([]uuid.UUID, 0, len(closed))
	for id := range closed {
		out = append(out, id)
	}
	return out, nil
}

// Closed implements files.Hider: the trips closed to the subject and the trips left to their continuation (D09: the
// files close the reservation of such a trip — a departure photo is new work, as in the overlay of the tag Fleet).
func (p poolTrips) Closed(ctx context.Context, tc tenantctx.TenantContext) (files.Closed, error) {
	all, err := p.S.TripAccesses(ctx, tc)
	if err != nil {
		return files.Closed{}, err
	}
	out := files.Closed{Hidden: []uuid.UUID{}, Continued: []uuid.UUID{}}
	for id, a := range all {
		switch a {
		case pool.AccessNone, pool.AccessPrepare: // W2.72: before the window of an S2-20 trip — no files of it
			out.Hidden = append(out.Hidden, id)
		case pool.AccessContinuation:
			out.Continued = append(out.Continued, id)
		case pool.AccessBase: // TripAccesses lists no such trip
		}
	}
	return out, nil
}
