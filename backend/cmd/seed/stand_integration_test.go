//go:build integration

package main

import (
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// Q-W2.02-5 (W2.54): `seed` without arguments switches «Логистика» on in t_alta (policy_version + 1 once) and keeps
// t_lotos without it; a second run changes nothing. The trial of «Альта» in the control DB ends in the future,
// 12 days after the day of the run. Sequential: the tenant DBs of the full seed have fixed names (t_alta, t_lotos).
func TestSeedSwitchesLogisticsOn(t *testing.T) { //nolint:paralleltest // fixed tenant DB names, see above
	ctl := cluster.NewDatabase(t, "ctl_stand")
	if _, err := migrations.Up(t.Context(), cluster.DB(t, ctl, migrations.RoleMigrator), migrations.Control); err != nil {
		t.Fatal(err)
	}
	env := seedEnv(ctl)
	alta := cluster.DB(t, "t_alta", migratetest.Super)
	logistics := `select count(*) from modules.installations where module_key = '` + demoModule + `' and state = 'enabled'`
	var policy int
	for pass := 1; pass <= 2; pass++ {
		if code, out, errOut := runSeed(t, env); code != exitOK {
			t.Fatalf("pass %d: code %d\nstdout: %s\nstderr: %s", pass, code, out, errOut)
		}
		if n := count(t, alta, logistics); n != 1 {
			t.Errorf("pass %d: t_alta logistics enabled %d, want 1", pass, n)
		}
		if n := count(t, cluster.DB(t, "t_lotos", migratetest.Super), `select count(*) from modules.installations where module_key = $1`, demoModule); n != 0 {
			t.Errorf("pass %d: t_lotos logistics %d, want 0", pass, n)
		}
		got := count(t, alta, `select policy_version from access.policy_state`)
		if pass == 2 && got != policy {
			t.Errorf("second run moved policy_version %d → %d", policy, got)
		}
		policy = got
	}
	var end time.Time
	if err := cluster.DB(t, ctl, migratetest.Super).QueryRowContext(t.Context(), `select upper(s.period) from subscriptions s
		 where s.tenant_id = $1 and s.state = 'trial'`, seedID(scopePlatform, protoAlta)).Scan(&end); err != nil {
		t.Fatal(err)
	}
	if left := time.Until(end) / (24 * time.Hour); left != 12 {
		t.Errorf("trial of «Альта» ends %v: %d days left, want 12", end, left)
	}
}
