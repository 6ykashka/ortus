package migrations_test

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

func TestTenantDSN(t *testing.T) {
	t.Parallel()
	base := "postgres://ortus_migrator:pw@localhost:6132/ortus_control?sslmode=disable" //nolint:gosec // G101: fake test DSN
	cases := []struct{ host, db, want string }{
		{"", "t_alta", "postgres://ortus_migrator:pw@localhost:6132/t_alta?sslmode=disable"},
		{"db.internal:5432", "t_lotos", "postgres://ortus_migrator:pw@db.internal:5432/t_lotos?sslmode=disable"},
	}
	for _, tc := range cases {
		got, err := migrations.TenantDSN(base, tc.host, tc.db)
		if err != nil || got != tc.want {
			t.Errorf("TenantDSN(%q, %q) = %q, %v; want %q", tc.host, tc.db, got, err, tc.want)
		}
	}
	if _, err := migrations.TenantDSN("::bad", "", "x"); err == nil {
		t.Error("TenantDSN accepted a malformed DSN")
	}
}
