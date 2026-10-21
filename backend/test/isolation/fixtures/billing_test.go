//go:build isolation

package fixtures

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	harness "github.com/ortus/ortus-crm/backend/test"
)

// W4.60, возврат 1: заявки на тариф фикстур — решённая у A, на рассмотрении у B, автор — владелец своей организации.
func TestLoadRequests(t *testing.T) {
	t.Parallel()
	w, err := Load(t.Context(), cluster, "fx_requests", harness.Now())
	if err != nil {
		t.Fatal(err)
	}
	db := cluster.DB(t, w.ControlDB, migrations.RoleAPI)
	for ref, want := range map[string][3]string{
		"subscription_request:a.rejected": {"tenant:a", "membership:a.owner@a", RequestRejected},
		"subscription_request:b.pending":  {"tenant:b", "membership:b.owner@b", RequestPending},
	} {
		if n := count(t, db, `select count(*) from subscription_change_requests where id = $1 and tenant_id = $2 and requested_by = $3
			and status = $4`, id(t, w, ref), id(t, w, want[0]), id(t, w, want[1]), want[2]); n != 1 {
			t.Errorf("%s = %d, want 1 (%v)", ref, n, want)
		}
	}
	bad := Default()
	bad.Tenants[1].Requests = append(bad.Tenants[1].Requests, RequestDef{Key: "second", Number: "SR-9003", Owner: "a.owner", Tier: TierTeam,
		Status: RequestPending})
	if err := bad.Validate(); err == nil {
		t.Error("Validate: a second pending request by an owner of another tenant must fail")
	}
}
