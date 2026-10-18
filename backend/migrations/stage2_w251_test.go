package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// tenant 0014 стюарда контракта этапа 2 (W2.51, контракт 0.6.0-stage2): индекс sched.reservations (bundle_id)
// (Q-W2.02-14) и пул водителей (S2-14, AUTH-06/07): псевдоним, условия, ревизия и снятие публикации, без пересечения
// активных публикаций водителя; комментарий, решение и автозавершение запроса, один открытый запрос на публикацию,
// одобренный запрос — с временным назначением. Down снимает ровно эти объекты (без cascade).
func TestStage2W251Migration(t *testing.T) {
	t.Parallel()
	const file = "0014_fleet_driver_pool_reservation_bundle.sql"
	text := readFile(t, migrations.Tenant, file)
	if want := "-- W2.51 · tenant 0014 · "; !strings.HasPrefix(text, want) {
		t.Errorf("first line must start with %q", want)
	}
	up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
	for _, re := range []string{
		`create index reservations_bundle_idx on sched\.reservations \(bundle_id\)`,
		`alter table fleet\.pool_publications`,
		`add column display_name text`,
		`add column terms text`,
		`add column revision integer not null default 1`,
		`add column withdrawn_by uuid`,
		`add constraint pool_publications_window check`,
		`add constraint pool_publications_withdrawn check \(\(withdrawn_at is null\) = \(withdrawn_by is null\)\)`,
		`add constraint pool_publications_no_overlap\s+exclude using gist \(person_id with =, available with &&\)\s+where \(withdrawn_at is null\)`,
		`create unique index pool_publications_display_name_uq on fleet\.pool_publications \(display_name\)`,
		`alter table fleet\.driver_transfers`,
		`add column reason text`,
		`add column decision_comment text`,
		`add column completed_at timestamptz`,
		// Возврат 1: комментарий снятия хранится в публикации, автор отзыва — в запросе.
		`add column withdrawal_comment text`,
		`add constraint pool_publications_withdrawal_comment check \(withdrawal_comment is null or \(withdrawn_at is not null and length\(withdrawal_comment\) <= 2000\)\)`,
		`add column revoked_by uuid`,
		`add constraint driver_transfers_revoked check \(\(state = 'revoked'\) = \(revoked_by is not null\)\)`,
		`add constraint driver_transfers_period check`,
		`add constraint driver_transfers_decided check`,
		`add constraint driver_transfers_grant check \(state not in \('approved','completed'\) or assignment_id is not null\)`,
		`add constraint driver_transfers_completed check \(\(state in \('completed','revoked'\)\) = \(completed_at is not null\)\)`,
		`create unique index driver_transfers_open_uq on fleet\.driver_transfers \(publication_id\)\s+where state = 'requested'`,
		`create index driver_transfers_approved_end_idx on fleet\.driver_transfers \(upper\(period\)\)\s+where state = 'approved'`,
		`create index driver_transfers_requested_start_idx on fleet\.driver_transfers \(lower\(period\)\)\s+where state = 'requested'`,
		`create index driver_transfers_trip_idx on fleet\.driver_transfers \(trip_id\)`,
	} {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("Up lacks /%s/", re)
		}
	}
	for _, re := range []string{
		`drop index sched\.reservations_bundle_idx`,
		`drop index fleet\.pool_publications_display_name_uq`,
		`drop constraint pool_publications_no_overlap`,
		`drop column display_name`,
		`drop column withdrawn_by`,
		`drop index fleet\.driver_transfers_open_uq`,
		`drop index fleet\.driver_transfers_trip_idx`,
		`drop constraint driver_transfers_grant`,
		`drop column completed_at`,
		`drop column reason`,
		`drop constraint pool_publications_withdrawal_comment`,
		`drop column withdrawal_comment`,
		`drop constraint driver_transfers_revoked`,
		`drop column revoked_by`,
	} {
		if !regexp.MustCompile(re).MatchString(down) {
			t.Errorf("Down lacks /%s/", re)
		}
	}
	if strings.Contains(down, "cascade") {
		t.Error("Down must not use cascade")
	}
}
