package migrations_test

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// EnsureRoles повторяет только гонку за pg_authid; прочие внутренние ошибки (XX000) не маскируются повторами.
func TestIsCatalogRace(t *testing.T) {
	t.Parallel()
	cases := []struct {
		name string
		err  error
		want bool
	}{
		{"tuple concurrently updated", &pgconn.PgError{Code: "XX000", Message: "tuple concurrently updated"}, true},
		{"tuple concurrently deleted", &pgconn.PgError{Code: "XX000", Message: "tuple concurrently deleted"}, true},
		{"wrapped", fmt.Errorf("migrations: alter role: %w", &pgconn.PgError{Code: "XX000", Message: "tuple concurrently updated"}), true},
		{"role created meanwhile", &pgconn.PgError{Code: "42710", Message: `role "ortus_api" already exists`}, true},
		{"unique pg_authid", &pgconn.PgError{Code: "23505", Message: "duplicate key value violates unique constraint"}, true},
		{"other internal error", &pgconn.PgError{Code: "XX000", Message: "cache lookup failed for role 16384"}, false},
		{"permission denied", &pgconn.PgError{Code: "42501", Message: "permission denied to create role"}, false},
		{"not a pg error", errors.New("tuple concurrently updated"), false},
		{"nil", nil, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := migrations.IsCatalogRace(tc.err); got != tc.want {
				t.Errorf("IsCatalogRace(%v) = %t, want %t", tc.err, got, tc.want)
			}
		})
	}
}
