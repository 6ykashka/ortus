package pool

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.07: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// availability is the catalog card of a publication: only what the home company published (AUTH-06) — the pool
// label, the qualifications, the free window, the terms, the home company and the reference of the publication; never
// the name, the contacts, the earnings or the history of the driver.
func (p publication) availability() fleetapi.DriverAvailability {
	id, homeName := p.id, p.homeName
	return fleetapi.DriverAvailability{
		DriverMemberId: p.person, DisplayName: p.label, HomeOrgUnitId: p.home, HomeOrgUnitName: &homeName,
		Qualifications: nonNil(p.qualifications), FreeWindow: p.window(), Terms: p.terms, PublicationId: &id,
	}
}

// Catalog lists the active publications whose free window overlaps [availableFrom, availableUntil) and whose driver
// has no approved transfer in it, without the drivers of the companies where the actor requests drivers (the owner
// sees every company): «Свободные водители других фирм группы» (listAvailableDrivers). The earliest window first.
func (s *Service) Catalog(ctx context.Context, tc tenantctx.TenantContext, params fleetapi.ListAvailableDriversParams) (fleetapi.DriverAvailabilityPage, error) {
	limit, err := kit.PageLimit(params.Limit)
	if err != nil {
		return fleetapi.DriverAvailabilityPage{}, err
	}
	want := Window{Start: params.AvailableFrom.UTC(), End: params.AvailableUntil.UTC()}
	if !want.Valid() {
		return fleetapi.DriverAvailabilityPage{}, kit.Invalid(textWindow)
	}
	out := fleetapi.DriverAvailabilityPage{Items: []fleetapi.DriverAvailability{}}
	err = s.run(ctx, tc, func(c *cmd) error {
		trip, tripKey, err := c.catalogFor(ctx, params.TripId)
		if err != nil {
			return err
		}
		var a sqlArgs
		from, until := a.add(want.Start), a.add(want.End)
		where := []string{
			"p.withdrawn_at is null", "upper(p.available) > " + a.add(c.now),
			"p.available && tstzrange(" + from + ", " + until + ", '[)')",
			`not exists (select 1 from fleet.driver_transfers x join fleet.pool_publications o on o.id = x.publication_id
			  where o.person_id = p.person_id and x.state = 'approved' and x.period && tstzrange(` + from + ", " + until + ", '[)'))",
		}
		if !c.tc.Owner {
			own, err := a.scope(ctx, c, actionRequest, homeColumns)
			if err != nil {
				return err
			}
			where = append(where, "not ("+own+")")
		}
		fp := c.fingerprint("catalog", want.Start.Format(time.RFC3339Nano), want.End.Format(time.RFC3339Nano), tripKey)
		if params.Cursor != nil {
			at, id, err := keyset(*params.Cursor, fp)
			if err != nil {
				return err
			}
			s, i := a.add(at), a.add(id)
			where = append(where, "(lower(p.available) > "+s+" or (lower(p.available) = "+s+" and p.id > "+i+"))")
		}
		rows, err := c.tx.Query(ctx, `select `+publicationCols+publicationFrom+` where `+strings.Join(where, " and ")+
			` order by lower(p.available), p.id limit `+a.add(limit+1), a.vals...)
		if err != nil {
			return err
		}
		list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (publication, error) { return scanPublication(r) })
		if err != nil {
			return err
		}
		if len(list) > limit {
			last := list[limit-1]
			next := encodeCursor(fp, last.free.Start.UTC().Format(time.RFC3339Nano), last.id.String())
			out.NextCursor, list = &next, list[:limit]
		}
		out.Items, err = c.cards(ctx, list, trip)
		return err
	})
	return out, err
}

// catalogFor is the trip the logist reads the catalog for (W2.72, S2-20 rule 2: the fit of the usual vehicles to its
// cargo and window; an invisible trip — 404) and its key of the cursor; nil — none.
func (c *cmd) catalogFor(ctx context.Context, id *uuid.UUID) (*tripCargo, string, error) {
	if id == nil {
		return nil, "", nil
	}
	t, err := c.catalogTrip(ctx, *id)
	return t, id.String(), err
}

// cards are the catalog cards of list with the usual vehicle of each publication (for trip, when given).
func (c *cmd) cards(ctx context.Context, list []publication, trip *tripCargo) ([]fleetapi.DriverAvailability, error) {
	out := make([]fleetapi.DriverAvailability, 0, len(list))
	for _, p := range list {
		item := p.availability()
		usual, err := c.usualCard(ctx, p, trip)
		if err != nil {
			return nil, err
		}
		item.UsualVehicle = usual
		out = append(out, item)
	}
	return out, nil
}
