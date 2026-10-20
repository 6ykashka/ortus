package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// tenant 0023 контрактной дельты W2.71 (0.7.1-stage4, в ветке 0019 и 0.6.3-stage2 — перенумерована при вливании после
// W4.02 и W4.06; S2-20 «Машина для временного водителя»): обычная машина
// публикации пула, режим и машины запроса водителя, решение фирмы водителя по обычной машине, брони предложения
// (группа, кому, вид машины, срок выбора, выбор и снятие с причиной), одна подтверждённая бронь на группу; exclusion
// constraint sched.reservations не меняется. Down снимает ровно эти объекты (без cascade).
func TestStage2W271Migration(t *testing.T) {
	t.Parallel()
	const file = "0023_fleet_temporary_driver_vehicle_offer.sql"
	text := readFile(t, migrations.Tenant, file)
	if want := "-- W2.71 · tenant 0023 · "; !strings.HasPrefix(text, want) {
		t.Errorf("first line must start with %q", want)
	}
	up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
	for _, re := range []string{
		`alter table fleet\.pool_publications\s+add column usual_vehicle_id uuid references fleet\.vehicles \(id\)`,
		`alter table fleet\.driver_transfers`,
		`add column vehicle_mode text`,
		`add column home_vehicle_id uuid references fleet\.vehicles \(id\)`,
		`add column host_vehicle_id uuid references fleet\.vehicles \(id\)`,
		`add column vehicle_decision text`,
		`add constraint driver_transfers_vehicle_mode check \(vehicle_mode is null or vehicle_mode in \('home', 'host', 'host_or_home'\)\)`,
		`add constraint driver_transfers_vehicle_decision check \(vehicle_decision is null or vehicle_decision in \('approved', 'declined'\)\)`,
		`alter table sched\.reservations`,
		`add column offer_group_id uuid`,
		`add column offered_to uuid references people\.person_profiles \(id\)`,
		`add column choose_until timestamptz`,
		`add column chosen_at timestamptz`,
		`add column released_at timestamptz`,
		`add column release_reason text`,
		`add constraint reservations_offer_hold check \(state <> 'hold' or choose_until is null or hold_expires_at = choose_until\)`,
		`create unique index reservations_offer_chosen_uq on sched\.reservations \(offer_group_id\)\s+where offer_group_id is not null and state in \('confirmed', 'consumed'\)`,
	} {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("Up lacks /%s/", re)
		}
	}
	if strings.Contains(up, "reservations_no_overlap") {
		t.Error("Up must not touch the exclusion constraint of sched.reservations")
	}
	for _, re := range []string{
		`drop index sched\.reservations_offer_chosen_uq`,
		`drop column offer_group_id`,
		`drop column offered_to`,
		`drop column choose_until`,
		`drop column vehicle_mode`,
		`drop column home_vehicle_id`,
		`drop column host_vehicle_id`,
		`drop column vehicle_decision`,
		`alter table fleet\.pool_publications\s+drop column usual_vehicle_id`,
	} {
		if !regexp.MustCompile(re).MatchString(down) {
			t.Errorf("Down lacks /%s/", re)
		}
	}
	if strings.Contains(down, "cascade") {
		t.Error("Down must not use cascade")
	}
}
