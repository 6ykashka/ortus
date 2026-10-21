package billinghttp

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

var errFailed = errors.New("control DB down")

// altaTenant is the Tenant of the registry of W1.02 (the fields of 0.1) of the example getPlatformTenant/ok.
func altaTenant() platformapi.Tenant {
	return platformapi.Tenant{
		Id: alta, Name: "Альта Групп", Status: "trial", OwnerUserIds: []uuid.UUID{*zimina.AccountID},
		CreatedAt: time.Date(2026, 9, 30, 15, 12, 0, 0, time.UTC), Revision: 1,
	}
}

// registry is the composed server of the tag Platform under the overlay: every operation that answers a Tenant.
type registry struct {
	platformapi.StrictServerInterface
}

func (registry) ListPlatformTenants(context.Context, platformapi.ListPlatformTenantsRequestObject) (platformapi.ListPlatformTenantsResponseObject, error) {
	return platformapi.ListPlatformTenants200JSONResponse{Body: platformapi.TenantPage{Items: []platformapi.Tenant{altaTenant()}}}, nil
}

func (registry) GetPlatformTenant(context.Context, platformapi.GetPlatformTenantRequestObject) (platformapi.GetPlatformTenantResponseObject, error) {
	return platformapi.GetPlatformTenant200JSONResponse{Body: altaTenant()}, nil
}

func (registry) CreatePlatformTenant(context.Context, platformapi.CreatePlatformTenantRequestObject) (platformapi.CreatePlatformTenantResponseObject, error) {
	return platformapi.CreatePlatformTenant201JSONResponse{Body: altaTenant()}, nil
}

func (registry) UpdatePlatformTenant(context.Context, platformapi.UpdatePlatformTenantRequestObject) (platformapi.UpdatePlatformTenantResponseObject, error) {
	return platformapi.UpdatePlatformTenant200JSONResponse{Body: altaTenant()}, nil
}

func (registry) SuspendPlatformTenant(context.Context, platformapi.SuspendPlatformTenantRequestObject) (platformapi.SuspendPlatformTenantResponseObject, error) {
	return platformapi.SuspendPlatformTenant200JSONResponse{Body: altaTenant()}, nil
}

func (registry) ResumePlatformTenant(context.Context, platformapi.ResumePlatformTenantRequestObject) (platformapi.ResumePlatformTenantResponseObject, error) {
	return nil, problem.New("invalid_transition", "")
}

func altaFacts() map[uuid.UUID]billing.Facts {
	return map[uuid.UUID]billing.Facts{alta: {Seats: billing.Seats{Limit: new(10), Active: 7, Invited: 2}, MemberCount: 10, TierCode: "start"}}
}

// W4.60 (W4.07 возврат 1): каждый ответ Tenant оператора — с местами, участниками, тарифом и знаком организации;
// тело карточки = пример getPlatformTenant/ok; отказ команды проходит как есть.
func TestTenantFacts(t *testing.T) {
	t.Parallel()
	srv := PlatformServer{StrictServerInterface: registry{}, Store: &fakeStore{facts: altaFacts()}, Marks: fakeMarks{}, Now: clock}
	ctx := operator(t)
	want := example(t, "getPlatformTenant", "ok")
	get, err := srv.GetPlatformTenant(ctx, platformapi.GetPlatformTenantRequestObject{TenantId: alta})
	if err != nil {
		t.Fatal(err)
	}
	gok, _ := get.(platformapi.GetPlatformTenant200JSONResponse)
	same(t, "get", asJSON(t, gok.Body), want)
	list, err := srv.ListPlatformTenants(ctx, platformapi.ListPlatformTenantsRequestObject{})
	if err != nil {
		t.Fatal(err)
	}
	lok, _ := list.(platformapi.ListPlatformTenants200JSONResponse)
	same(t, "list", asJSON(t, lok.Body.Items[0]), want)
	created, err := srv.CreatePlatformTenant(ctx, platformapi.CreatePlatformTenantRequestObject{})
	must(t, err)
	cok, _ := created.(platformapi.CreatePlatformTenant201JSONResponse)
	same(t, "create", asJSON(t, cok.Body), want)
	updated, err := srv.UpdatePlatformTenant(ctx, platformapi.UpdatePlatformTenantRequestObject{})
	must(t, err)
	uok, _ := updated.(platformapi.UpdatePlatformTenant200JSONResponse)
	same(t, "update", asJSON(t, uok.Body), want)
	suspended, err := srv.SuspendPlatformTenant(ctx, platformapi.SuspendPlatformTenantRequestObject{})
	must(t, err)
	sok, _ := suspended.(platformapi.SuspendPlatformTenant200JSONResponse)
	same(t, "suspend", asJSON(t, sok.Body), want)
	if _, err := srv.ResumePlatformTenant(ctx, platformapi.ResumePlatformTenantRequestObject{}); !problem.Is(err, "invalid_transition") {
		t.Errorf("resume refused: %v", err)
	}
	// Фактов не прочитать — 503, а не организация без мест.
	srv.Store = &fakeStore{err: errFailed}
	if _, err := srv.GetPlatformTenant(ctx, platformapi.GetPlatformTenantRequestObject{TenantId: alta}); !problem.Is(err, problem.CodeDependencyUnavailable) {
		t.Errorf("facts failed: %v", err)
	}
}

func must(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
