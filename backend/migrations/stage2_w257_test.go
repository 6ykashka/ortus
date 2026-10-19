package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// tenant 0018 контрактной дельты W2.57 (0.6.2-stage2, решение Q-W2.07-1 «только рейс»): у запроса пула — вторая строка
// временного назначения роли «Временный водитель» на машину рейса (область resource, fleet.vehicles.read до конца
// окна); она бывает только у запроса с основным назначением. Down снимает ровно эти объекты (без cascade).
func TestStage2W257Migration(t *testing.T) {
	t.Parallel()
	const file = "0018_fleet_driver_transfer_vehicle_grant.sql"
	text := readFile(t, migrations.Tenant, file)
	if want := "-- W2.57 · tenant 0018 · "; !strings.HasPrefix(text, want) {
		t.Errorf("first line must start with %q", want)
	}
	up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
	for _, re := range []string{
		`alter table fleet\.driver_transfers`,
		`add column vehicle_assignment_id uuid references access\.role_assignments \(id\)`,
		`add constraint driver_transfers_vehicle_grant check \(vehicle_assignment_id is null or assignment_id is not null\)`,
	} {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("Up lacks /%s/", re)
		}
	}
	for _, re := range []string{
		`drop constraint driver_transfers_vehicle_grant`,
		`drop column vehicle_assignment_id`,
	} {
		if !regexp.MustCompile(re).MatchString(down) {
			t.Errorf("Down lacks /%s/", re)
		}
	}
	if strings.Contains(down, "cascade") {
		t.Error("Down must not use cascade")
	}
}
