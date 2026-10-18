package pool

import (
	"context"
	"strings"
	"time"

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
		fp := c.fingerprint("catalog", want.Start.Format(time.RFC3339Nano), want.End.Format(time.RFC3339Nano))
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
		for _, p := range list {
			out.Items = append(out.Items, p.availability())
		}
		return nil
	})
	return out, err
}
