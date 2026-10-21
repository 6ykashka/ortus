package pool

import (
	"context"
	"log/slog"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.07: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Server overlays the operations of the pool on a strict server of the tag Fleet; the other operations go to the
// base. The commands of the base that move a trip in or out of its started states (reserveVehicle with a trip,
// releaseReservation, startTrip, reviewTrip) are passed down unchanged and followed by the settlement of the transfers
// of that trip (SettleTrip, bounded by SettleTimeout): the grant of a temporary driver opens at the start of his trip
// and closes at its acceptance right after the command, not only at the next run of the worker (Q-W2.51-15). W2.57
// (Q-W2.07-1, AC-06, D09): the operations on a trip and its objects ask Trips first — a trip of a transfer answers its
// driver 404 before and after the grant and keeps only its continuation while the grant is closing; the lists leave
// such trips out (guard.go).
type Server struct {
	fleetapi.StrictServerInterface
	S     *Service
	Trips TripGuard // nil: no guard of the trips of the transfers
}

var _ fleetapi.StrictServerInterface = Server{}

// NewServer returns the overlay on base (nil: the other operations of the tag answer 501), guarded by s.
func NewServer(base fleetapi.StrictServerInterface, s *Service) Server {
	if base == nil {
		base = unimplemented{}
	}
	h := Server{StrictServerInterface: base, S: s}
	if s != nil {
		h.Trips = s
	}
	return h
}

func headers(ctx context.Context) (cacheControl, reqID *string) {
	cc, rid := kit.NoStore, requestid.FromContext(ctx)
	if rid == "" {
		return &cc, nil
	}
	return &cc, &rid
}

func malformed() error { return problem.New(problem.CodeMalformedRequest, "") }

// ListDriverPoolPublications implements fleetapi.StrictServerInterface.
func (h Server) ListDriverPoolPublications(ctx context.Context, r fleetapi.ListDriverPoolPublicationsRequestObject) (fleetapi.ListDriverPoolPublicationsResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Publications(ctx, tc, r.Params)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return fleetapi.ListDriverPoolPublications200JSONResponse{Body: out,
		Headers: fleetapi.ListDriverPoolPublications200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// PublishDriverToPool implements fleetapi.StrictServerInterface.
func (h Server) PublishDriverToPool(ctx context.Context, r fleetapi.PublishDriverToPoolRequestObject) (fleetapi.PublishDriverToPoolResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, malformed()
	}
	out, err := h.S.Publish(ctx, tc, *r.Body)
	if res, ok := validation(ctx, err); ok {
		return fleetapi.PublishDriverToPool422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: res}, nil
	}
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := kit.ETag(out.Revision), false
	return fleetapi.PublishDriverToPool201JSONResponse{Body: out, Headers: fleetapi.PublishDriverToPool201ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// GetDriverPoolPublication implements fleetapi.StrictServerInterface.
func (h Server) GetDriverPoolPublication(ctx context.Context, r fleetapi.GetDriverPoolPublicationRequestObject) (fleetapi.GetDriverPoolPublicationResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Publication(ctx, tc, r.PublicationId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag := kit.ETag(out.Revision)
	return fleetapi.GetDriverPoolPublication200JSONResponse{Body: out,
		Headers: fleetapi.GetDriverPoolPublication200ResponseHeaders{CacheControl: cc, ETag: &tag, XRequestId: rid}}, nil
}

// WithdrawDriverPoolPublication implements fleetapi.StrictServerInterface.
func (h Server) WithdrawDriverPoolPublication(ctx context.Context, r fleetapi.WithdrawDriverPoolPublicationRequestObject) (fleetapi.WithdrawDriverPoolPublicationResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	var b fleetapi.DriverPoolWithdrawal
	if r.Body != nil {
		b = *r.Body
	}
	out, err := h.S.Withdraw(ctx, tc, r.PublicationId, r.Params.IfMatch, b)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := kit.ETag(out.Revision), false
	return fleetapi.WithdrawDriverPoolPublication200JSONResponse{Body: out, Headers: fleetapi.WithdrawDriverPoolPublication200ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ListAvailableDrivers implements fleetapi.StrictServerInterface.
func (h Server) ListAvailableDrivers(ctx context.Context, r fleetapi.ListAvailableDriversRequestObject) (fleetapi.ListAvailableDriversResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Catalog(ctx, tc, r.Params)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return fleetapi.ListAvailableDrivers200JSONResponse{Body: out,
		Headers: fleetapi.ListAvailableDrivers200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// ListDriverTransfers implements fleetapi.StrictServerInterface.
func (h Server) ListDriverTransfers(ctx context.Context, r fleetapi.ListDriverTransfersRequestObject) (fleetapi.ListDriverTransfersResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Transfers(ctx, tc, r.Params)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	return fleetapi.ListDriverTransfers200JSONResponse{Body: out,
		Headers: fleetapi.ListDriverTransfers200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// GetDriverTransfer implements fleetapi.StrictServerInterface.
func (h Server) GetDriverTransfer(ctx context.Context, r fleetapi.GetDriverTransferRequestObject) (fleetapi.GetDriverTransferResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	out, err := h.S.Transfer(ctx, tc, r.RequestId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag := kit.ETag(out.Revision)
	return fleetapi.GetDriverTransfer200JSONResponse{Body: out,
		Headers: fleetapi.GetDriverTransfer200ResponseHeaders{CacheControl: cc, ETag: &tag, XRequestId: rid}}, nil
}

// RequestDriverTransfer implements fleetapi.StrictServerInterface.
func (h Server) RequestDriverTransfer(ctx context.Context, r fleetapi.RequestDriverTransferRequestObject) (fleetapi.RequestDriverTransferResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, malformed()
	}
	out, err := h.S.Request(ctx, tc, *r.Body)
	if res, ok := validation(ctx, err); ok {
		return fleetapi.RequestDriverTransfer422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: res}, nil
	}
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := kit.ETag(out.Revision), false
	return fleetapi.RequestDriverTransfer201JSONResponse{Body: out, Headers: fleetapi.RequestDriverTransfer201ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// DecideDriverTransfer implements fleetapi.StrictServerInterface.
func (h Server) DecideDriverTransfer(ctx context.Context, r fleetapi.DecideDriverTransferRequestObject) (fleetapi.DecideDriverTransferResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if r.Body == nil {
		return nil, malformed()
	}
	out, err := h.S.Decide(ctx, tc, r.RequestId, r.Params.IfMatch, *r.Body)
	if res, ok := validation(ctx, err); ok {
		return fleetapi.DecideDriverTransfer422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: res}, nil
	}
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	tag, replayed := kit.ETag(out.Revision), false
	return fleetapi.DecideDriverTransfer200JSONResponse{Body: out, Headers: fleetapi.DecideDriverTransfer200ResponseHeaders{
		CacheControl: cc, ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// ReserveVehicle passes the reservation to the base and settles the transfers of its trip after a hold for a trip
// (the trip goes to inspection: the grant of its temporary driver opens). W2.72 (S2-20, D-35 комплекта, variant (a)
// rejected): the temporary driver of the trip of a transfer whose grant is active or prepares the trip never creates
// reservations — 403 forbidden_action; the approval or the logist reserves, he chooses (chooseReservation).
func (h Server) ReserveVehicle(ctx context.Context, r fleetapi.ReserveVehicleRequestObject) (fleetapi.ReserveVehicleResponseObject, error) {
	if r.Body != nil && r.Body.TripId != nil {
		if err := h.noReservation(ctx, *r.Body.TripId); err != nil {
			return nil, err
		}
		if err := h.trip(ctx, "reserveVehicle", "", *r.Body.TripId, textTripNotFound); err != nil {
			return nil, err
		}
	}
	out, err := h.StrictServerInterface.ReserveVehicle(ctx, r)
	if err == nil && r.Body != nil && r.Body.TripId != nil {
		h.settleAfter(ctx, "reserveVehicle", *r.Body.TripId)
	}
	return out, err
}

// noReservation refuses a reservation for trip to its temporary driver while his transfer is active or prepares the
// trip (403 forbidden_action, W2.72).
func (h Server) noReservation(ctx context.Context, trip uuid.UUID) error {
	g, ok := h.Trips.(GrantGuard)
	if !ok {
		return nil
	}
	on, err := g.GrantOn(ctx, trip)
	if err != nil || !on {
		return err
	}
	return problem.New(problem.CodeForbiddenAction, "")
}

// ReleaseReservation passes the release to the base and settles the transfers of the trip of the hold (a released
// trip goes back to planning: the grant of its temporary driver ends with the window again).
func (h Server) ReleaseReservation(ctx context.Context, r fleetapi.ReleaseReservationRequestObject) (fleetapi.ReleaseReservationResponseObject, error) {
	if err := h.object(ctx, "releaseReservation", "", ObjectReservation, r.ReservationId, textReservationNotFound); err != nil {
		return nil, err
	}
	out, err := h.StrictServerInterface.ReleaseReservation(ctx, r)
	if res, ok := out.(fleetapi.ReleaseReservation200JSONResponse); err == nil && ok && res.Body.TripId != nil {
		h.settleAfter(ctx, "releaseReservation", *res.Body.TripId)
		if res.Body.OfferGroupId != nil {
			h.notifyReleased(ctx, *res.Body.TripId, []uuid.UUID{res.Body.Id})
		}
	}
	return out, err
}

// ChooseReservation implements fleetapi.StrictServerInterface (W2.72, S2-20): the guard of the trip of the
// reservation — before the window of an S2-20 transfer the choice is open to its driver (AccessPrepare) — then the
// choice of the service.
func (h Server) ChooseReservation(ctx context.Context, r fleetapi.ChooseReservationRequestObject) (fleetapi.ChooseReservationResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	if err := h.object(ctx, "chooseReservation", "", ObjectReservation, r.ReservationId, textReservationNotFound); err != nil {
		return nil, err
	}
	out, err := h.S.Choose(ctx, tc, r.ReservationId)
	if err != nil {
		return nil, err
	}
	cc, rid := headers(ctx)
	replayed := false
	return fleetapi.ChooseReservation200JSONResponse{Body: out, Headers: fleetapi.ChooseReservation200ResponseHeaders{
		CacheControl: cc, IdempotencyReplayed: &replayed, XRequestId: rid}}, nil
}

// StartTrip passes the start to the base and settles the transfers of the started trip.
func (h Server) StartTrip(ctx context.Context, r fleetapi.StartTripRequestObject) (fleetapi.StartTripResponseObject, error) {
	if r.Body != nil {
		if err := h.object(ctx, "startTrip", "", ObjectReservation, r.Body.ReservationId, textReservationNotFound); err != nil {
			return nil, err
		}
	}
	out, err := h.StrictServerInterface.StartTrip(ctx, r)
	if res, ok := out.(fleetapi.StartTrip201JSONResponse); err == nil && ok {
		h.settleAfter(ctx, "startTrip", res.Body.Id)
	}
	return out, err
}

// ReviewTrip passes the review to the base and settles the transfers of the trip (an accepted trip closes the grant
// of its temporary driver at the acceptance).
func (h Server) ReviewTrip(ctx context.Context, r fleetapi.ReviewTripRequestObject) (fleetapi.ReviewTripResponseObject, error) {
	if err := h.trip(ctx, "reviewTrip", "", r.TripId, textTripNotFound); err != nil {
		return nil, err
	}
	out, err := h.StrictServerInterface.ReviewTrip(ctx, r)
	if err == nil {
		h.settleAfter(ctx, "reviewTrip", r.TripId)
	}
	return out, err
}

// notifyAssigned tells the temporary driver of trip that the logist put a vehicle on it (W2.72, S2-20: «машину
// поставили» / «выберите машину») after assignTripVehicle committed, within SettleTimeout; a failure is only logged.
func (h Server) notifyAssigned(ctx context.Context, trip uuid.UUID) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok || h.S == nil {
		return
	}
	sctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), h.S.settleTimeout())
	defer cancel()
	if err := h.S.NotifyAssigned(sctx, tc, trip); err != nil && h.S.Log != nil {
		h.S.Log.WarnContext(ctx, "pool: notify after assignTripVehicle", slog.String("tenant_id", tc.TenantID.String()),
			slog.String("trip_id", trip.String()), slog.String("error", err.Error()))
	}
}

// foreignOffers reads the live reservations of an offer of trip on vehicles of other companies before a command of the
// base that may release them (W2.72 return 1); a failure is only logged — the command runs, its companies are not told.
func (h Server) foreignOffers(ctx context.Context, trip uuid.UUID) []uuid.UUID {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok || h.S == nil || h.S.Recipients == nil {
		return nil
	}
	live, err := h.S.ForeignOffers(ctx, tc, trip)
	if err != nil && h.S.Log != nil {
		h.S.Log.WarnContext(ctx, "pool: offers before assignTripVehicle", slog.String("tenant_id", tc.TenantID.String()),
			slog.String("trip_id", trip.String()), slog.String("error", err.Error()))
	}
	return live
}

// notifyReleased tells the companies of the vehicles of bundles released by a command of the base that committed
// «машина освобождена» (W2.72 return 1, docs/29 «События»), within SettleTimeout; a failure is only logged.
func (h Server) notifyReleased(ctx context.Context, trip uuid.UUID, bundles []uuid.UUID) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok || h.S == nil || len(bundles) == 0 {
		return
	}
	sctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), h.S.settleTimeout())
	defer cancel()
	if err := h.S.NotifyReleased(sctx, tc, trip, bundles); err != nil && h.S.Log != nil {
		h.S.Log.WarnContext(ctx, "pool: notify the released vehicles", slog.String("tenant_id", tc.TenantID.String()),
			slog.String("trip_id", trip.String()), slog.String("error", err.Error()))
	}
}

// settleAfter settles the transfers of trip after a command of the base that committed (SettleTrip), within
// SettleTimeout: its failure does not fail the command (the worker settles again), it is only logged.
func (h Server) settleAfter(ctx context.Context, op string, trip uuid.UUID) {
	tc, ok := tenantctx.FromContext(ctx)
	if !ok || h.S == nil {
		return
	}
	sctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), h.S.settleTimeout())
	defer cancel()
	if _, err := h.S.SettleTrip(sctx, tc.TenantID, trip); err != nil && h.S.Log != nil {
		h.S.Log.WarnContext(ctx, "pool: settle after "+op, slog.String("tenant_id", tc.TenantID.String()),
			slog.String("trip_id", trip.String()), slog.String("error", err.Error()))
	}
}
