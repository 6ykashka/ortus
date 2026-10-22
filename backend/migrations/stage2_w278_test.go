package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// tenant 0027 W2.78 (Q-W2.72-1; S2-20 правило 6, Q-W2.70-9; номер — следующий свободный блока этапа 4, стюарду —
// подтвердить): отметка рейса «машина отпущена» (fleet.trips.vehicle_released_at) и условие trips_active_vehicle_uq,
// которое её учитывает — обычная машина временного водителя после осмотра сдачи не держится за рейсом до приёмки.
// Заполнение — рейсы после осмотра сдачи на обычной машине одобренного перевода. Down возвращает индекс 0002 и снимает
// столбец (без cascade).
func TestStage2W278Migration(t *testing.T) {
	t.Parallel()
	const file = "0027_fleet_trip_vehicle_released.sql"
	text := readFile(t, migrations.Tenant, file)
	if want := "-- W2.78 · tenant 0027 · "; !strings.HasPrefix(text, want) {
		t.Errorf("first line must start with %q", want)
	}
	up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
	for _, re := range []string{
		`alter table fleet\.trips\s+add column vehicle_released_at timestamptz`,
		`add constraint trips_vehicle_released check \(vehicle_released_at is null or vehicle_id is not null\)`,
		`drop index fleet\.trips_active_vehicle_uq`,
		`create unique index trips_active_vehicle_uq on fleet\.trips \(vehicle_id\)\s+where state in \('inspection', ?'defect_review', ?'on_route', ?'returning', ?'submitted', ?'rework'\)\s+and vehicle_released_at is null`,
		`update fleet\.trips t\s+set vehicle_released_at = i\.submitted_at`,
		`x\.home_vehicle_id = t\.vehicle_id and x\.vehicle_decision = 'approved'`,
	} {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("Up lacks /%s/", re)
		}
	}
	for _, re := range []string{
		`drop index fleet\.trips_active_vehicle_uq`,
		`create unique index trips_active_vehicle_uq on fleet\.trips \(vehicle_id\)\s+where state in \('inspection', ?'defect_review', ?'on_route', ?'returning', ?'submitted', ?'rework'\);`,
		`drop constraint trips_vehicle_released`,
		`drop column vehicle_released_at`,
	} {
		if !regexp.MustCompile(re).MatchString(down) {
			t.Errorf("Down lacks /%s/", re)
		}
	}
	if strings.Contains(down, "cascade") {
		t.Error("Down must not use cascade")
	}
}
