package reservations

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.02: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// listSQL pages the reservations the actor sees, newest first: $1, $2 — the keyset position or null, $3 — the page
// size.
const listSQL = selectSQL + `
   and {{scope}}
   and ($1::timestamptz is null or (rv.created_at, rv.bundle_id) < ($1::timestamptz, $2::uuid))
 order by rv.created_at desc, rv.bundle_id desc
 limit $3`

// GetReservation implements fleetapi.StrictServerInterface: a reservation in the scope of fleet.reservations.read,
// else 404 — the same for a foreign and a missing id (AC-01).
func (s *Server) GetReservation(ctx context.Context, req fleetapi.GetReservationRequestObject) (fleetapi.GetReservationResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	c, err := s.conn(ctx, tc)
	if err != nil {
		return nil, err
	}
	var b bundle
	err = c.One(ctx, ActionRead, columns, func(r pgx.Row) error {
		var err error
		b, err = scanBundle(r)
		return err
	}, selectSQL+` and rv.bundle_id = $1 and {{scope}}`, req.ReservationId)
	if err != nil {
		return nil, dbError(notFound(err))
	}
	tag := kit.ETag(b.Revision)
	return fleetapi.GetReservation200JSONResponse{
		Body: b.dto(s.now()),
		Headers: fleetapi.GetReservation200ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, XRequestId: rid(ctx),
		},
	}, nil
}

// ListReservations implements fleetapi.StrictServerInterface: the reservations in the scope of
// fleet.reservations.read (the predicate comes before the pagination), newest first.
func (s *Server) ListReservations(ctx context.Context, req fleetapi.ListReservationsRequestObject) (fleetapi.ListReservationsResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	limit, err := kit.PageLimit(req.Params.Limit)
	if err != nil {
		return nil, err
	}
	var afterAt *time.Time
	var afterID *string
	if req.Params.Cursor != nil {
		keys, err := kit.DecodeCursor(*req.Params.Cursor, 2)
		if err != nil {
			return nil, err
		}
		at, err := time.Parse(time.RFC3339Nano, keys[0])
		if err != nil {
			return nil, problem.Wrap(problem.CodeMalformedRequest, err)
		}
		if _, err := uuid.Parse(keys[1]); err != nil {
			return nil, problem.Wrap(problem.CodeMalformedRequest, err)
		}
		afterAt, afterID = &at, &keys[1]
	}
	c, err := s.conn(ctx, tc)
	if err != nil {
		return nil, err
	}
	rows, err := c.Query(ctx, ActionRead, columns, listSQL, afterAt, afterID, limit+1)
	if err != nil {
		return nil, dbError(err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (bundle, error) { return scanBundle(r) })
	if err != nil {
		return nil, dbError(err)
	}
	page := fleetapi.ReservationPage{Items: make([]fleetapi.Reservation, 0, min(len(list), limit))}
	if len(list) > limit {
		last := list[limit-1]
		next := kit.EncodeCursor(last.CreatedAt.UTC().Format(time.RFC3339Nano), last.ID.String())
		page.NextCursor = &next
		list = list[:limit]
	}
	now := s.now()
	for _, b := range list {
		page.Items = append(page.Items, b.dto(now))
	}
	return fleetapi.ListReservations200JSONResponse{
		Body: page, Headers: fleetapi.ListReservations200ResponseHeaders{CacheControl: noStore(), XRequestId: rid(ctx)},
	}, nil
}
