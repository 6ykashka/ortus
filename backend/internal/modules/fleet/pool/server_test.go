package pool

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// TestServerOverlay: the operations of the pool answer without a tenant context like a missing tenant (404), the
// other operations of the tag go to the base (nil: 501).
func TestServerOverlay(t *testing.T) {
	t.Parallel()
	h := NewServer(nil, &Service{})
	ctx := context.Background()
	for name, call := range map[string]func() error{
		"ListDriverPoolPublications": func() error {
			_, err := h.ListDriverPoolPublications(ctx, fleetapi.ListDriverPoolPublicationsRequestObject{})
			return err
		},
		"PublishDriverToPool": func() error {
			_, err := h.PublishDriverToPool(ctx, fleetapi.PublishDriverToPoolRequestObject{})
			return err
		},
		"GetDriverPoolPublication": func() error {
			_, err := h.GetDriverPoolPublication(ctx, fleetapi.GetDriverPoolPublicationRequestObject{})
			return err
		},
		"WithdrawDriverPoolPublication": func() error {
			_, err := h.WithdrawDriverPoolPublication(ctx, fleetapi.WithdrawDriverPoolPublicationRequestObject{})
			return err
		},
		"ListAvailableDrivers": func() error {
			_, err := h.ListAvailableDrivers(ctx, fleetapi.ListAvailableDriversRequestObject{})
			return err
		},
		"ListDriverTransfers": func() error {
			_, err := h.ListDriverTransfers(ctx, fleetapi.ListDriverTransfersRequestObject{})
			return err
		},
		"GetDriverTransfer": func() error {
			_, err := h.GetDriverTransfer(ctx, fleetapi.GetDriverTransferRequestObject{})
			return err
		},
		"RequestDriverTransfer": func() error {
			_, err := h.RequestDriverTransfer(ctx, fleetapi.RequestDriverTransferRequestObject{})
			return err
		},
		"DecideDriverTransfer": func() error {
			_, err := h.DecideDriverTransfer(ctx, fleetapi.DecideDriverTransferRequestObject{})
			return err
		},
	} {
		if err := call(); !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s: %v, want not_found", name, err)
		}
	}
	if _, err := h.ReturnTrip(ctx, fleetapi.ReturnTripRequestObject{}); !problem.Is(err, problem.CodeNotImplemented) {
		t.Errorf("ReturnTrip (W2.05): %v, want the base 501", err)
	}
}

// TestServerRejectsRequests: a command without a body is 400 before the service.
func TestServerRejectsRequests(t *testing.T) {
	t.Parallel()
	h := NewServer(nil, &Service{})
	ctx := tenantctx.WithTenant(context.Background(), tenantctx.TenantContext{TenantID: uuid.New()})
	if _, err := h.PublishDriverToPool(ctx, fleetapi.PublishDriverToPoolRequestObject{}); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("PublishDriverToPool: %v, want malformed_request", err)
	}
	if _, err := h.RequestDriverTransfer(ctx, fleetapi.RequestDriverTransferRequestObject{}); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("RequestDriverTransfer: %v, want malformed_request", err)
	}
	if _, err := h.DecideDriverTransfer(ctx, fleetapi.DecideDriverTransferRequestObject{}); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("DecideDriverTransfer: %v, want malformed_request", err)
	}
}

// startingBase is a base whose trip commands succeed; trip is the trip of their answers (uuid.Nil — a release of a
// hold without a trip).
type startingBase struct {
	unimplemented
	trip uuid.UUID
}

func (b startingBase) StartTrip(context.Context, fleetapi.StartTripRequestObject) (fleetapi.StartTripResponseObject, error) {
	return fleetapi.StartTrip201JSONResponse{Body: fleetapi.Trip{Id: b.trip}}, nil
}

func (startingBase) ReviewTrip(context.Context, fleetapi.ReviewTripRequestObject) (fleetapi.ReviewTripResponseObject, error) {
	return fleetapi.ReviewTrip200JSONResponse{}, nil
}

func (startingBase) ReserveVehicle(context.Context, fleetapi.ReserveVehicleRequestObject) (fleetapi.ReserveVehicleResponseObject, error) {
	return fleetapi.ReserveVehicle201JSONResponse{}, nil
}

func (b startingBase) ReleaseReservation(context.Context, fleetapi.ReleaseReservationRequestObject) (fleetapi.ReleaseReservationResponseObject, error) {
	out := fleetapi.ReleaseReservation200JSONResponse{}
	if b.trip != uuid.Nil {
		trip := b.trip
		out.Body.TripId = &trip
	}
	return out, nil
}

// countingPools counts the tenant DBs asked for and has none.
type countingPools struct{ n atomic.Int32 }

func (p *countingPools) For(context.Context, uuid.UUID) (*pgxpool.Pool, error) {
	p.n.Add(1)
	return nil, errors.New("no tenant DB in a unit test")
}

// TestServerSettlesAfterTripCommands (Q-W2.51-15): a command of the base that moves a trip and succeeds is followed by
// the settlement of the pool of that trip; its answer is passed unchanged even when the settlement fails; a failed
// command, a reservation or a release without a trip settles nothing.
func TestServerSettlesAfterTripCommands(t *testing.T) {
	t.Parallel()
	pools := &countingPools{}
	h := NewServer(startingBase{trip: uuid.New()}, &Service{Pools: pools})
	ctx := tenantctx.WithTenant(context.Background(), tenantctx.TenantContext{TenantID: uuid.New()})
	out, err := h.StartTrip(ctx, fleetapi.StartTripRequestObject{})
	if _, ok := out.(fleetapi.StartTrip201JSONResponse); err != nil || !ok {
		t.Fatalf("StartTrip: %v %#v, want the answer of the base", err, out)
	}
	if _, err := h.ReviewTrip(ctx, fleetapi.ReviewTripRequestObject{TripId: uuid.New()}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.ReleaseReservation(ctx, fleetapi.ReleaseReservationRequestObject{}); err != nil {
		t.Fatal(err)
	}
	trip := uuid.New()
	if _, err := h.ReserveVehicle(ctx, fleetapi.ReserveVehicleRequestObject{Body: &fleetapi.ReserveVehicleJSONRequestBody{TripId: &trip}}); err != nil {
		t.Fatal(err)
	}
	if _, err := h.ReserveVehicle(ctx, fleetapi.ReserveVehicleRequestObject{Body: &fleetapi.ReserveVehicleJSONRequestBody{}}); err != nil {
		t.Fatal(err)
	}
	free := NewServer(startingBase{}, &Service{Pools: pools})
	if _, err := free.ReleaseReservation(ctx, fleetapi.ReleaseReservationRequestObject{}); err != nil {
		t.Fatal(err)
	}
	if n := pools.n.Load(); n != 4 {
		t.Fatalf("settlements: %d, want 4 (start, review, release and reservation of a trip)", n)
	}
	failing := NewServer(nil, &Service{Pools: pools})
	if _, err := failing.StartTrip(ctx, fleetapi.StartTripRequestObject{}); !problem.Is(err, problem.CodeNotImplemented) {
		t.Fatalf("StartTrip of a failing base: %v", err)
	}
	if n := pools.n.Load(); n != 4 {
		t.Fatalf("settlements after a failed command: %d, want 4", n)
	}
}

// stuckPools never answers before its context ends.
type stuckPools struct{}

func (stuckPools) For(ctx context.Context, _ uuid.UUID) (*pgxpool.Pool, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

// TestServerSettlementIsBounded: the settlement after a command of the base has its own deadline (SettleTimeout): a
// stuck tenant DB does not hold the answer of the command.
func TestServerSettlementIsBounded(t *testing.T) {
	t.Parallel()
	h := NewServer(startingBase{trip: uuid.New()}, &Service{Pools: stuckPools{}, SettleTimeout: 50 * time.Millisecond})
	ctx := tenantctx.WithTenant(context.Background(), tenantctx.TenantContext{TenantID: uuid.New()})
	done := make(chan error, 1)
	go func() {
		_, err := h.StartTrip(ctx, fleetapi.StartTripRequestObject{})
		done <- err
	}()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("StartTrip: %v, want the answer of the base", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("StartTrip waits for a stuck settlement")
	}
}
