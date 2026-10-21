package billinghttp

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	platformapi "github.com/ortus/ortus-crm/backend/internal/api/platform"
	"github.com/ortus/ortus-crm/backend/internal/control/billing"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// fakeMarks are the signs of the seed W0.12 (TenantBrandMark of the examples).
type fakeMarks struct{ err error }

func (f fakeMarks) Marks(_ context.Context, ids []uuid.UUID) (map[uuid.UUID]platformapi.TenantBrandMark, error) {
	all := map[uuid.UUID]platformapi.TenantBrandMark{
		alta:  {AccentUsed: "#1F6B52"},
		lotos: {AccentUsed: "#7A3E79", ShortName: new("Лотос")},
		cargo: {AccentUsed: "#2B5479", ShortName: new("Карго")},
	}
	out := map[uuid.UUID]platformapi.TenantBrandMark{}
	for _, id := range ids {
		if m, ok := all[id]; ok {
			out[id] = m
		}
	}
	return out, f.err
}

// usageRows are «Лотос» and «Карго» of the example getPlatformUsage/ok.
func usageRows() []billing.UsageTenant {
	return []billing.UsageTenant{
		{
			ID: lotos, Name: "SPA «Лотос»", Status: "active", OwnerName: "Ирина Белова", TierCode: "team", TierName: "Команда",
			Seats: billing.Seats{Limit: new(25), Active: 23}, StorageUsed: 13314398618, StorageQuota: 53687091200, ModuleKeys: []string{"spa"},
			MemberCount: 23, ActiveMembers: 23, ActiveMembers7d: 12, LastSignIn: new(time.Date(2026, 10, 1, 7, 14, 0, 0, time.UTC)),
			Pending: &billing.RequestRef{ID: sr12().ID, Number: "SR-12"},
		},
		{
			ID: cargo, Name: "Карго Сити", Status: "suspended", OwnerName: "Денис Шишкин", TierCode: "team", TierName: "Команда",
			Seats: billing.Seats{Limit: new(25), Active: 22}, StorageUsed: 67645734912, StorageQuota: 107374182400, ModuleKeys: []string{"fleet"},
			MemberCount: 22, ActiveMembers: 22, LastSignIn: new(time.Date(2026, 9, 18, 20, 51, 0, 0, time.UTC)),
		},
	}
}

// exampleUsage is the example getPlatformUsage/ok as JSON values.
func exampleUsage(t *testing.T) map[string][]any {
	t.Helper()
	var u map[string]json.RawMessage
	if err := json.Unmarshal([]byte(example(t, "getPlatformUsage", "ok")), &u); err != nil {
		t.Fatal(err)
	}
	out := map[string][]any{}
	for _, key := range []string{"signals", "modules", "tenants"} {
		var items []any
		if err := json.Unmarshal(u[key], &items); err != nil {
			t.Fatal(err)
		}
		out[key] = items
	}
	return out
}

// of keeps the items of the example of the tenants of usageRows (by tenantId), in their order.
func of(items []any) []any {
	var out []any
	for _, it := range items {
		if m, ok := it.(map[string]any); ok && (m["tenantId"] == lotos.String() || m["tenantId"] == cargo.String()) {
			out = append(out, it)
		}
	}
	return out
}

// «Использование»: строки организаций со знаком, сигналы с заявкой, модули — как в примере getPlatformUsage/ok
// (для «Лотоса» и «Карго»).
func TestGetPlatformUsage(t *testing.T) {
	t.Parallel()
	store := &fakeStore{usage: billing.Summarize(usageRows(), []string{"fleet", "spa", "repairs"}, now)}
	srv := PlatformServer{Store: store, Marks: fakeMarks{}, Now: clock}
	resp, err := srv.GetPlatformUsage(operator(t), platformapi.GetPlatformUsageRequestObject{})
	if err != nil {
		t.Fatal(err)
	}
	ok, isOK := resp.(platformapi.GetPlatformUsage200JSONResponse)
	if !isOK {
		t.Fatalf("%+v", resp)
	}
	var got map[string]any
	if err := json.Unmarshal([]byte(asJSON(t, ok.Body)), &got); err != nil {
		t.Fatal(err)
	}
	want := exampleUsage(t)
	same(t, "tenants", asJSON(t, got["tenants"]), asJSON(t, of(want["tenants"])))
	same(t, "signals", asJSON(t, got["signals"]), asJSON(t, of(want["signals"])))
	mods, _ := got["modules"].([]any)
	same(t, "fleet", asJSON(t, mods[0]), asJSON(t, want["modules"][0]))
	eq(t, "measured", got["measuredAt"], any("2026-10-01T07:30:00Z"))
	store.err = errFailed
	if _, err := srv.GetPlatformUsage(operator(t), platformapi.GetPlatformUsageRequestObject{}); !problem.Is(err, problem.CodeDependencyUnavailable) {
		t.Errorf("store failed: %v", err)
	}
}
