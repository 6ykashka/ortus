package invitations

import (
	"context"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// noQuery fails the test on any query.
type noQuery struct{ t *testing.T }

func (r noQuery) Query(context.Context, string, ...any) (pgx.Rows, error) {
	r.t.Fatal("Pending queried the control DB for no profiles")
	return nil, nil
}

// T-6 (W1.52): no profiles — no query, an empty map.
func TestPendingWithoutProfiles(t *testing.T) {
	t.Parallel()
	for _, persons := range [][]uuid.UUID{nil, {}} {
		got, err := Pending(t.Context(), noQuery{t}, uuid.New(), persons)
		if err != nil || got == nil || len(got) != 0 {
			t.Fatalf("Pending(%v) = %v, %v; want an empty map", persons, got, err)
		}
	}
}
