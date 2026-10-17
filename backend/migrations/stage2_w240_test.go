package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// tenant 0013 аддитивного PR стюарда этапа 2 (W2.40, контракт 0.5.1-stage2): ответ владельца продукта 17.10
// на D-12 комплекта — категория tire_service и «прочее» с обязательным комментарием в fleet.expenses;
// юрлицо рейса — nullable FK fleet.trips.legal_entity_id. Down снимает ровно эти объекты (без cascade).
func TestStage2W240Migration(t *testing.T) {
	t.Parallel()
	const file = "0013_fleet_expense_kinds_trip_legal_entity.sql"
	text := readFile(t, migrations.Tenant, file)
	if want := "-- W2.40 · tenant 0013 · "; !strings.HasPrefix(text, want) {
		t.Errorf("first line must start with %q", want)
	}
	up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
	for _, re := range []string{
		`alter table fleet\.expenses`,
		`drop constraint expenses_category_check`,
		`add constraint expenses_category_check\s+check \(category in \('fuel','wash','parking','toll','tire_service','other'\)\)`,
		`add constraint expenses_other_comment\s+check \(category <> 'other' or length\(btrim\(coalesce\(comment, ''\)\)\) > 0\)`,
		`alter table fleet\.trips`,
		`add column legal_entity_id uuid references org\.legal_entities\(id\)`,
		`create index trips_legal_entity_idx on fleet\.trips \(legal_entity_id\)`,
	} {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("Up lacks /%s/", re)
		}
	}
	for _, re := range []string{
		`drop index fleet\.trips_legal_entity_idx`,
		`drop column legal_entity_id`,
		`drop constraint expenses_other_comment`,
		`add constraint expenses_category_check\s+check \(category in \('fuel','wash','parking','toll','other'\)\)`,
	} {
		if !regexp.MustCompile(re).MatchString(down) {
			t.Errorf("Down lacks /%s/", re)
		}
	}
	if strings.Contains(down, "cascade") {
		t.Error("Down must not use cascade")
	}
}
