package pool

import (
	"context"
	"fmt"
	"net/http"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.07: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Request requests a published driver for the requesting company (requestDriverTransfer). The order of the checks of
// the contract: fleet.driver_transfers.request over targetOrgUnitId (else 403); the publication — publicationId, active
// and of the driver, or the one ChoosePublication picks (Q-W2.51-13; else 404 «Водитель не опубликован в пуле.»);
// sourceOrgUnitId — the home company of the publication, not the target (422); the window inside its free window
// (422); the trip — invisible 404, of another company 422, with a driver 409; a second open request of the publication
// 409 «Запрос уже отправлен». The publication is locked: two requests of one publication queue. Writes the audit row
// and fleet.driver_transfer.requested.v1.
func (s *Service) Request(ctx context.Context, tc tenantctx.TenantContext, b fleetapi.DriverTransferCreate) (fleetapi.DriverTransfer, error) {
	if n := utf8.RuneCountInString(b.Reason); n < 1 || n > maxComment {
		return fleetapi.DriverTransfer{}, kit.Invalid(textLimit)
	}
	w := Window{Start: b.Window.StartsAt.UTC(), End: b.Window.EndsAt.UTC()}
	var out fleetapi.DriverTransfer
	err := s.run(ctx, tc, func(c *cmd) error {
		var err error
		out, err = c.request(ctx, b, w)
		return err
	})
	return out, err
}

func (c *cmd) request(ctx context.Context, b fleetapi.DriverTransferCreate, w Window) (fleetapi.DriverTransfer, error) {
	p, err := c.requestable(ctx, b, w)
	if err != nil {
		return fleetapi.DriverTransfer{}, err
	}
	var id uuid.UUID
	err = c.tx.QueryRow(ctx, `insert into fleet.driver_transfers (publication_id, source_unit_id, target_unit_id, trip_id,
		period, state, requested_by, reason, created_at)
		values ($1, $2, $3, $4, tstzrange($5, $6, '[)'), 'requested', $7, $8, $9) returning id`,
		p.id, b.SourceOrgUnitId, b.TargetOrgUnitId, b.TripId, w.Start, w.End, c.tc.PersonID, b.Reason, c.now).Scan(&id)
	if violates(err, codeUniqueViolation, "driver_transfers_open_uq") {
		return fleetapi.DriverTransfer{}, kit.Conflict(textRequested)
	}
	if err != nil {
		return fleetapi.DriverTransfer{}, fmt.Errorf("pool: request: %w", err)
	}
	diff := map[string]any{keyPublication: p.id, keySource: b.SourceOrgUnitId, keyTarget: b.TargetOrgUnitId,
		"startsAt": w.Start, keyEndsAt: w.End}
	if b.TripId != nil {
		diff["tripId"] = *b.TripId
	}
	if _, err := c.record(ctx, "fleet.driver_transfer.request", eventRequested, targetTransfer, id, b.TargetOrgUnitId, diff); err != nil {
		return fleetapi.DriverTransfer{}, err
	}
	x, err := loadTransfer(ctx, c.tx, id, "")
	if err != nil {
		return fleetapi.DriverTransfer{}, err
	}
	out := x.dto(c.now)
	return out, kit.Complete(ctx, c.tx, http.StatusCreated, kit.ETag(out.Revision), out)
}

// requestable runs the checks of a request in the order of the contract and returns its locked publication.
func (c *cmd) requestable(ctx context.Context, b fleetapi.DriverTransferCreate, w Window) (publication, error) {
	if err := c.ev.Permit(ctx, c.tc, actionRequest, authz.Resource{Unit: b.TargetOrgUnitId}); err != nil {
		if problem.Is(err, problem.CodeNotFound) || problem.Is(err, problem.CodeForbiddenAction) {
			return publication{}, problem.New(problem.CodeForbiddenAction, "")
		}
		return publication{}, err
	}
	p, err := c.publicationFor(ctx, b.DriverMemberId, b.PublicationId, w)
	if err != nil {
		return publication{}, err
	}
	switch {
	case p.home != b.SourceOrgUnitId || b.SourceOrgUnitId == b.TargetOrgUnitId:
		return publication{}, invalid(textSource, violationSource)
	case !w.Valid():
		return publication{}, invalid(textWindow, violationRange)
	case !w.Within(p.free):
		return publication{}, invalid(textOutside, violationOutside)
	}
	if b.TripId != nil {
		if err := c.requestTrip(ctx, *b.TripId, b.TargetOrgUnitId); err != nil {
			return publication{}, err
		}
	}
	var open bool
	if err := c.tx.QueryRow(ctx, `select exists (select 1 from fleet.driver_transfers where publication_id = $1
		 and state = 'requested')`, p.id).Scan(&open); err != nil {
		return publication{}, err
	}
	if open {
		return publication{}, kit.Conflict(textRequested)
	}
	return p, nil
}

// publicationFor locks the publication of a request: publicationId — active and of the driver; without it — the one
// ChoosePublication picks among the active publications of the driver. None — 404.
func (c *cmd) publicationFor(ctx context.Context, driver uuid.UUID, named *uuid.UUID, w Window) (publication, error) {
	notPublished := problem.New(problem.CodeNotFound, textNotPublished)
	var id uuid.UUID
	if named != nil {
		id = *named
	} else {
		rows, err := c.tx.Query(ctx, `select id, lower(available), upper(available) from fleet.pool_publications
			 where person_id = $1 and withdrawn_at is null and upper(available) > $2`, driver, c.now)
		if err != nil {
			return publication{}, err
		}
		active, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (Candidate, error) {
			var k Candidate
			return k, r.Scan(&k.ID, &k.Free.Start, &k.Free.End)
		})
		if err != nil {
			return publication{}, err
		}
		chosen, ok := ChoosePublication(active, w)
		if !ok {
			return publication{}, notPublished
		}
		id = chosen.ID
	}
	p, err := loadPublication(ctx, c.tx, id, " for update of p")
	switch {
	case problem.Is(err, problem.CodeNotFound):
		return publication{}, notPublished
	case err != nil:
		return publication{}, err
	case p.person != driver || p.state(c.now) != fleetapi.DriverPoolPublicationStateActive:
		return publication{}, notPublished
	}
	return p, nil
}

// requestTrip checks the trip of a request: invisible to the actor (fleet.trips.read over its unit and its driver) —
// 404, as a missing one; another company than the target — 422 (Q-W2.51-12); a trip with a driver — 409.
func (c *cmd) requestTrip(ctx context.Context, id, target uuid.UUID) error {
	var (
		unit   uuid.UUID
		driver *uuid.UUID
	)
	err := c.tx.QueryRow(ctx, `select unit_id, driver_person_id from fleet.trips where id = $1 for share`, id).Scan(&unit, &driver)
	notFound := problem.New(problem.CodeNotFound, textTripNotFound)
	switch {
	case errNoRows(err):
		return notFound
	case err != nil:
		return err
	}
	var persons []uuid.UUID
	if driver != nil {
		persons = []uuid.UUID{*driver}
	}
	if err := c.ev.Permit(ctx, c.tc, actionTripsRead, authz.Resource{Unit: unit, Persons: persons}); err != nil {
		if problem.Is(err, problem.CodeNotFound) || problem.Is(err, problem.CodeForbiddenAction) {
			return notFound
		}
		return err
	}
	switch {
	case unit != target:
		return invalid(textTripOther, violationTrip)
	case driver != nil:
		return kit.Conflict(textTripDriver)
	}
	return nil
}
