package accesstest

import (
	"encoding/json"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
)

// PolicyBump is an access.policy.bumped.v1 of the outbox decoded the way the relay of W1.07 decodes it
// (realtime.PolicyBumped); Err is the decoding error the relay would fail with.
type PolicyBump struct {
	AggregateID uuid.UUID
	realtime.PolicyBumped
	Err error
}

// PolicyBumps returns the policy events of the tenant DB in the order they were written.
func (w *World) PolicyBumps() []PolicyBump {
	w.tb.Helper()
	rows, err := w.Tenant.Query(w.ctx(), `select aggregate_id, payload from outbox.events where type = $1 order by id`,
		realtime.EventPolicyBumped)
	if err != nil {
		w.tb.Fatalf("policy events: %v", err)
	}
	out, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (PolicyBump, error) {
		var (
			b   PolicyBump
			raw []byte
		)
		if err := r.Scan(&b.AggregateID, &raw); err != nil {
			return b, err
		}
		b.Err = json.Unmarshal(raw, &b.PolicyBumped)
		return b, nil
	})
	if err != nil {
		w.tb.Fatalf("policy events: %v", err)
	}
	return out
}

// LastPolicyBump returns the latest policy event; the test fails without one.
func (w *World) LastPolicyBump() PolicyBump {
	w.tb.Helper()
	all := w.PolicyBumps()
	if len(all) == 0 {
		w.tb.Fatal("no access.policy.bumped.v1 in the outbox")
	}
	return all[len(all)-1]
}

// CheckPolicyBump fails the test unless b decodes for the relay of W1.07, belongs to the tenant of the world, carries
// version want and names exactly persons (in any order).
func (w *World) CheckPolicyBump(b PolicyBump, want int64, persons ...uuid.UUID) {
	w.tb.Helper()
	if b.Err != nil {
		w.tb.Errorf("the relay of W1.07 cannot decode the event: %v", b.Err)
	}
	if b.AggregateID != w.TenantID {
		w.tb.Errorf("aggregate_id %s, want the tenant %s", b.AggregateID, w.TenantID)
	}
	if b.PolicyVersion != want {
		w.tb.Errorf("policyVersion %d, want %d", b.PolicyVersion, want)
	}
	got, exp := sortIDs(b.PersonIDs), sortIDs(persons)
	if !slices.Equal(got, exp) {
		w.tb.Errorf("personIds %v, want %v", got, exp)
	}
}

func sortIDs(in []uuid.UUID) []uuid.UUID {
	out := slices.Clone(in)
	slices.SortFunc(out, func(a, b uuid.UUID) int { return slices.Compare(a[:], b[:]) })
	return out
}
