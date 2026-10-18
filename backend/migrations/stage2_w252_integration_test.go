//go:build integration

package migrations_test

import (
	"database/sql"
	"encoding/json"
	"slices"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// w252 — помощники строк tenant 0015–0017 (W2.52): организация, водитель, машина, рейс.
type w252 struct {
	t  *testing.T
	db *sql.DB
}

func (w w252) exec(q string, args ...any) error {
	_, err := w.db.ExecContext(w.t.Context(), q, args...)
	return err
}

func (w w252) must(what, q string, args ...any) {
	w.t.Helper()
	if err := w.exec(q, args...); err != nil {
		w.t.Fatalf("%s: %v", what, err)
	}
}

func (w w252) want(what string, err error, state string) {
	w.t.Helper()
	if got := sqlState(err); got != state {
		w.t.Errorf("%s: SQLSTATE %q (%v), want %s", what, got, err, state)
	}
}

func (w w252) unit(name string) string {
	return scalar[string](w.t, w.db, `insert into org.units (kind, name, time_zone)
		values ('company', $1, 'Europe/Moscow') returning id::text`, name)
}

func (w w252) person(name, unit string) string {
	return scalar[string](w.t, w.db, `insert into people.person_profiles (full_name, home_unit_id)
		values ($1, $2) returning id::text`, name, unit)
}

func (w w252) vehicle(unit, plate string) string {
	return scalar[string](w.t, w.db, `insert into fleet.vehicles (unit_id, plate, body_type, payload_kg, volume_m3,
		cargo_length_mm) values ($1, $2, 'tent', 1500, 16, 4200) returning id::text`, unit, plate)
}

func (w w252) trip(unit, number, driver string) string {
	return scalar[string](w.t, w.db, `insert into fleet.trips (number, unit_id, state, driver_person_id, planned,
		cargo_weight_kg, cargo_volume_m3, cargo_length_mm, title)
		values ($1, $2, 'planned', $3, tstzrange('2026-10-01 06:00Z', '2026-10-01 10:00Z'), 1100, 12, 3000, 'Рейс')
		returning id::text`, number, unit, driver)
}

// tenant 0015 (W2.52, D-12 комплекта): справочник с посевом шести категорий; расход ссылается на код справочника,
// «прочее» не архивируется и всегда требует комментарий; подпись активной категории уникальна.
func TestStage2W252ExpenseCategories(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name, _ := migrated(t, c, migrations.Tenant)
		w := w252{t: t, db: c.DB(t, name, migrations.RoleAPI)}

		got := scalar[string](t, w.db, `select string_agg(code || ':' || label || ':' || comment_required, ','
			order by sort_order) from fleet.expense_categories where seeded and archived_at is null`)
		want := "fuel:Топливо:false,wash:Мойка:false,parking:Парковка:false,toll:Платная дорога:false," +
			"tire_service:Шиномонтаж и мелкий ремонт:false,other:Прочее:true"
		if got != want {
			t.Errorf("seed = %s, want %s", got, want)
		}

		sever := w.unit("Север Логистик")
		driver := w.person("Илья Васильев", sever)
		trip := w.trip(sever, "Р-208", driver)
		owner := w.person("Дарья Зимина", sever)
		expense := `insert into fleet.expenses (trip_id, category, amount_minor, occurred_on, comment, claimed_by)
			values ($1, $2, 120000, '2026-10-01', $3, $4)`
		w.must("seed code", expense, trip, "tire_service", nil, driver)
		w.want("unknown code", w.exec(expense, trip, "fine", "Штраф", driver), "23503")
		w.want("other without comment", w.exec(expense, trip, "other", nil, driver), "23514")

		category := `insert into fleet.expense_categories (code, label, comment_required, sort_order, created_by)
			values ($1, $2, $3, 70, $4)`
		w.must("custom category", category, "custom_1", "Ремни и стяжки", false, owner)
		w.must("custom code in an expense", expense, trip, "custom_1", nil, driver)
		w.want("duplicate active label", w.exec(category, "custom_2", " мойка ", false, owner), "23505")
		w.want("bad code", w.exec(category, "Custom-3", "Прочее разное", false, owner), "23514")
		w.want("category without author", w.exec(`insert into fleet.expense_categories (code, label, sort_order)
			values ('custom_4', 'Без автора', 80)`), "23514")
		w.want("archived without author", w.exec(`update fleet.expense_categories set archived_at = now()
			where code = 'toll'`), "23514")
		w.must("archived toll", `update fleet.expense_categories set archived_at = now(), archived_by = $1,
			revision = revision + 1 where code = 'toll'`, owner)
		w.must("label of an archived category is free", category, "toll_city", "Платная дорога", false, owner)
		w.want("other archived", w.exec(`update fleet.expense_categories set archived_at = now(), archived_by = $1
			where code = 'other'`, owner), "23514")
		w.want("other without comment flag", w.exec(`update fleet.expense_categories set comment_required = false
			where code = 'other'`), "23514")
		if n := scalar[int](t, w.db, `select count(*) from fleet.expenses where category = 'custom_1'`); n != 1 {
			t.Errorf("expenses of custom_1 = %d, want 1", n)
		}
	})
}

// stmt — команда транзакции w252.tx.
type stmt struct {
	q    string
	args []any
}

func sq(q string, args ...any) stmt { return stmt{q: q, args: args} }

// tx выполняет команды одной транзакцией и возвращает ошибку фиксации (отложенные проверки) или первой команды.
func (w w252) tx(stmts ...stmt) error {
	tx, err := w.db.BeginTx(w.t.Context(), nil)
	if err != nil {
		return err
	}
	for _, s := range stmts {
		if _, err := tx.ExecContext(w.t.Context(), s.q, s.args...); err != nil {
			_ = tx.Rollback()
			return err
		}
	}
	return tx.Commit()
}

// tenant 0016 (W2.52, модель данных п. 2, D-11 комплекта): новая машина сама получает открытый период фирмы
// регистрации; открытый период и fleet.vehicles.unit_id сверяются при фиксации (перемещение — одной транзакцией);
// периоды машины не пересекаются, открытый — один; история удаляется вместе с машиной. Импорт машин — строки
// предпросмотра с действием, применённый — с моментом и автором.
func TestStage2W252VehicleAssignmentsImports(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name, _ := migrated(t, c, migrations.Tenant)
		w := w252{t: t, db: c.DB(t, name, migrations.RoleAPI)}
		sever, yug := w.unit("Север Логистик"), w.unit("Юг Транс")
		owner := w.person("Дарья Зимина", sever)
		v := w.vehicle(sever, "Т 771 ЕХ 77")

		if got := scalar[string](t, w.db, `select u.name || ':' || (a.valid_from = v.created_at) || ':' || (a.valid_to is null)
			from fleet.vehicle_assignments a join fleet.vehicles v on v.id = a.vehicle_id join org.units u on u.id = a.unit_id
			where a.vehicle_id = $1`, v); got != "Север Логистик:true:true" {
			t.Errorf("open period of a new vehicle = %s, want Север Логистик:true:true", got)
		}
		w.must("history from 01.09", `update fleet.vehicle_assignments set valid_from = '2026-09-01 06:00Z'
			where vehicle_id = $1`, v)
		w.want("unit change without a period", w.exec(`update fleet.vehicles set unit_id = $2 where id = $1`, v, yug),
			"23514")

		period := `insert into fleet.vehicle_assignments (vehicle_id, unit_id, valid_from, valid_to, reason, assigned_by)
			values ($1, $2, $3, $4, $5, $6)`
		closeOpen := `update fleet.vehicle_assignments set valid_to = $2 where vehicle_id = $1 and valid_to is null`
		if err := w.tx(
			sq(closeOpen, v, "2026-10-01 07:30Z"),
			sq(period, v, yug, "2026-10-01 07:30Z", nil, "Перевод в Юг Транс", owner),
			sq(`update fleet.vehicles set unit_id = $2, revision = revision + 1 where id = $1`, v, yug),
		); err != nil {
			t.Fatalf("move in one transaction: %v", err)
		}
		w.want("open period in another company than the vehicle", w.tx(
			sq(closeOpen, v, "2026-10-10 07:30Z"),
			sq(period, v, sever, "2026-10-10 07:30Z", nil, "Без перемещения машины", owner),
		), "23514")
		w.want("overlapping period", w.exec(period, v, sever, "2026-09-15 06:00Z", "2026-09-20 06:00Z", nil, nil),
			"23P01")
		// Второй открытый период пересекает текущий: отказ даёт exclusion (23P01) или открытый unique (23505).
		if s := sqlState(w.exec(period, v, sever, "2026-11-01 06:00Z", nil, nil, nil)); s != "23P01" && s != "23505" {
			t.Errorf("second open period: SQLSTATE %q, want 23P01 or 23505", s)
		}
		w.want("empty period", w.exec(period, v, sever, "2026-08-01 06:00Z", "2026-08-01 06:00Z", nil, nil), "23514")
		w.want("blank reason", w.exec(period, v, sever, "2026-07-01 06:00Z", "2026-07-02 06:00Z", "  ", nil), "23514")
		on := `select u.name from fleet.vehicle_assignments a join org.units u on u.id = a.unit_id
			where a.vehicle_id = $1 and tstzrange(a.valid_from, a.valid_to) @> $2::timestamptz`
		if got := scalar[string](t, w.db, on, v, "2026-09-10 12:00Z"); got != "Север Логистик" {
			t.Errorf("company on 10.09 = %s", got)
		}
		if got := scalar[string](t, w.db, on, v, "2026-10-05 12:00Z"); got != "Юг Транс" {
			t.Errorf("company on 05.10 = %s", got)
		}
		w.must("vehicle with its history deleted", `delete from fleet.vehicles where id = $1`, w.vehicle(yug, "Х 001 ХХ 77"))

		imp := scalar[string](t, w.db, `insert into fleet.vehicle_imports (file_name, default_unit_id, created_by,
			expires_at) values ('mashiny.csv', $1, $2, now() + interval '1 day') returning id::text`, sever, owner)
		row := `insert into fleet.vehicle_import_rows (import_id, line, action, data) values ($1, $2, $3, '{}')`
		w.must("create row", row, imp, 2, "create")
		w.want("header line", w.exec(row, imp, 1, "create"), "23514")
		w.want("unknown action", w.exec(row, imp, 3, "delete"), "23514")
		w.want("committed without moment", w.exec(`update fleet.vehicle_imports set state = 'committed'
			where id = $1`, imp), "23514")
		w.want("committed without author", w.exec(`update fleet.vehicle_imports set state = 'committed',
			committed_at = now() where id = $1`, imp), "23514")
		w.must("committed", `update fleet.vehicle_imports set state = 'committed', committed_at = now(),
			committed_by = $2, revision = revision + 1 where id = $1`, imp, owner)
	})
}

// tenant 0017 (W2.52, модель данных п. 4, D-30, D-29 и D-11 комплекта): определение чек-листа заполняется при
// вставке без него (FormDefinition), поля задачи дефекта согласованы, адрес навигатора ограничен, фото хранит
// серверное время и повтор.
func TestStage2W252InspectionEvidence(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name, _ := migrated(t, c, migrations.Tenant)
		w := w252{t: t, db: c.DB(t, name, migrations.RoleAPI)}

		list := scalar[string](t, w.db, `insert into fleet.checklist_versions (kind, version, items, required_photo_roles)
			values ('departure', 1, '[{"key":"body","label":"Кузов и стёкла осмотрены","required":true,
			"failureBlocksRelease":true},{"key":"docs","label":"Документы и комплект на месте","required":false}]',
			'{front,back,odometer,interior}') returning id::text`)
		def := scalar[string](t, w.db, `select definition::text from fleet.checklist_versions where id = $1`, list)
		checkDefinition(t, def, "Осмотр перед выездом",
			[]string{"body", "docs", "photo_front", "photo_rear", "photo_odometer"})
		if !strings.Contains(def, `"blockingValues": ["fail"]`) || strings.Count(def, "blockingValues") != 1 {
			t.Errorf("blockingValues only for the item with failureBlocksRelease: %s", def)
		}
		given := `{"title":"Своя форма","description":"","fields":[{"key":"x","label":"X","type":"boolean",
			"required":true}],"visibility":[],"confirmationText":""}`
		w.must("given definition", `insert into fleet.checklist_versions (kind, version, items, definition)
			values ('return', 1, '[]', $1::jsonb)`, given)
		if got := scalar[string](t, w.db, `select definition->>'title' from fleet.checklist_versions
			where kind = 'return'`); got != "Своя форма" {
			t.Errorf("a given definition is kept, got %s", got)
		}
		w.want("definition without fields", w.exec(`insert into fleet.checklist_versions (kind, version, items,
			definition) values ('return', 2, '[]', '{"title":"Т"}')`), "23514")

		sever := w.unit("Север Логистик")
		driver := w.person("Илья Васильев", sever)
		manager := w.person("Марина Котова", sever)
		v := w.vehicle(sever, "А 412 МР 77")
		trip := w.trip(sever, "Р-208", driver)
		defect := scalar[string](t, w.db, `insert into fleet.defects (vehicle_id, trip_id, zone, severity, description,
			state, reported_by) values ($1, $2, 'Стёкла', 'blocking', 'Скол', 'in_review', $3) returning id::text`,
			v, trip, driver)
		w.want("due without assignee", w.exec(`update fleet.defects set due_at = now() where id = $1`, defect), "23514")
		w.want("assignee without moment", w.exec(`update fleet.defects set assignee_id = $2 where id = $1`,
			defect, manager), "23514")
		w.want("unknown assignee", w.exec(`update fleet.defects set assignee_id = gen_random_uuid(), assigned_at = now(),
			assigned_by = $2 where id = $1`, defect, manager), "23503")
		w.must("assigned", `update fleet.defects set assignee_id = $2, due_at = '2026-10-01 09:00Z', assigned_at = now(),
			assigned_by = $2, revision = revision + 1 where id = $1`, defect, manager)

		w.want("blank navigation address", w.exec(`insert into fleet.trip_stops (trip_id, seq, op, address,
			navigation_address) values ($1, 1, 'load', 'Склад № 1', ' ')`, trip), "23514")
		w.must("navigation address", `insert into fleet.trip_stops (trip_id, seq, op, address, navigation_address)
			values ($1, 1, 'load', 'Склад № 1 · ворота 3', 'Лобня, ул. Победы, 1')`, trip)

		if n := scalar[int](t, w.db, `select count(*) from pg_indexes where schemaname = 'files'
			and indexname = 'files_sha256_idx'`); n != 1 {
			t.Error("no index files.files_sha256_idx")
		}
		file := scalar[string](t, w.db, `insert into files.objects (object_key, state, purpose, owner_type, owner_id,
			declared_mime, bytes, sha256, uploaded_by) values ('t/insp/1', 'ready', 'inspection', 'fleet.trip', $1,
			'image/jpeg', 2457600, '\x01', $2) returning id::text`, trip, driver)
		insp := scalar[string](t, w.db, `insert into fleet.inspections (trip_id, vehicle_id, kind, checklist_version_id,
			odometer_km, fuel_level, answers, state, submitted_by) values ($1, $2, 'departure', $3, 84500, 'half', '{}',
			'submitted', $4) returning id::text`, trip, v, list, driver)
		photo := `insert into fleet.inspection_photos (inspection_id, role, file_id, server_captured_at, duplicate_count,
			duplicate_first_seen_at, duplicate_same_owner) values ($1, $2, $3, now(), $4, $5, $6)`
		w.want("duplicate count without first seen", w.exec(photo, insp, "front", file, 1, nil, false), "23514")
		w.want("zero duplicates", w.exec(photo, insp, "front", file, 0, "2026-10-01 06:00Z", false), "23514")
		w.must("photo with duplicate", photo, insp, "front", file, 2, "2026-09-30 06:00Z", false)
		w.must("photo without duplicate", photo, insp, "back", file, nil, nil, nil)
	})
}

// formField — поле FormDefinition определения чек-листа (W2.45).
type formField struct {
	Key, Label, Type string
	Required         bool
	Options          []struct{ Key, Label string }
	MaxFiles         int      `json:"maxFiles"`
	AllowedMimeTypes []string `json:"allowedMimeTypes"`
	MaxFileBytes     int      `json:"maxFileBytes"`
}

// validField: фото — обязательное поле file на один JPEG до 20 МБ; пункт — single_choice pass/fail/not_applicable.
func validField(f formField) bool {
	if strings.HasPrefix(f.Key, "photo_") {
		return f.Type == "file" && f.Required && f.MaxFiles == 1 && f.Label != "" &&
			slices.Equal(f.AllowedMimeTypes, []string{"image/jpeg"}) && f.MaxFileBytes == 20971520
	}
	return f.Type == "single_choice" && len(f.Options) == 3 && f.Options[0].Key == "pass" &&
		f.Options[1].Label == "Неисправно"
}

// checkDefinition проверяет форму FormDefinition определения чек-листа: заголовок и ключи полей по порядку.
func checkDefinition(t *testing.T, raw, title string, keys []string) {
	t.Helper()
	var d struct {
		Title            string      `json:"title"`
		Description      string      `json:"description"`
		ConfirmationText string      `json:"confirmationText"`
		Visibility       []any       `json:"visibility"`
		Fields           []formField `json:"fields"`
	}
	if err := json.Unmarshal([]byte(raw), &d); err != nil {
		t.Fatalf("definition %s: %v", raw, err)
	}
	if d.Title != title || d.Description != "" || d.ConfirmationText != "" || d.Visibility == nil {
		t.Errorf("definition head = %+v", d)
	}
	got := make([]string, 0, len(d.Fields))
	for _, f := range d.Fields {
		got = append(got, f.Key)
		if !validField(f) {
			t.Errorf("field %+v", f)
		}
	}
	if !slices.Equal(got, keys) {
		t.Errorf("fields = %v, want %v", got, keys)
	}
}

// Up → Down до 0014 → данные до W2.52 → Up: перенос текущей фирмы машин в историю, определения чек-листов из
// items и ролей, серверного времени фото из сессии загрузки; Down снимает таблицы, колонки, функции и индексы.
func TestStage2W252Down(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		ctx := t.Context()
		_, mig := migrated(t, c, migrations.Tenant)
		if res, err := migrations.DownTo(ctx, mig, migrations.Tenant, 14); err != nil || res.To != 14 {
			t.Fatalf("down to 14 = %+v, %v", res, err)
		}
		objects := `select (select count(*) from information_schema.tables where table_schema = 'fleet'
				and table_name in ('expense_categories', 'vehicle_assignments', 'vehicle_imports', 'vehicle_import_rows'))
			+ (select count(*) from information_schema.columns where table_schema = 'fleet'
				and (table_name, column_name) in (('checklist_versions', 'definition'), ('defects', 'assignee_id'),
					('defects', 'due_at'), ('inspection_photos', 'server_captured_at'), ('trip_stops', 'navigation_address')))
			+ (select count(*) from pg_indexes where indexname = 'files_sha256_idx')
			+ (select count(*) from pg_proc where proname in ('checklist_definition', 'checklist_versions_fill_definition',
				'vehicles_open_assignment', 'vehicle_assignment_check'))
			+ (select count(*) from pg_trigger where tgname in ('vehicles_open_assignment', 'vehicles_assignment_check'))`
		if n := scalar[int](t, mig, objects); n != 0 {
			t.Errorf("%d objects of 0015–0017 survive Down", n)
		}
		w := w252{t: t, db: mig}
		w.want("six codes after Down", w.exec(`insert into fleet.expenses (trip_id, category, amount_minor, occurred_on,
			claimed_by) values (gen_random_uuid(), 'custom_1', 1, '2026-10-01', gen_random_uuid())`), "23514")

		sever := w.unit("Север Логистик")
		driver := w.person("Илья Васильев", sever)
		v := w.vehicle(sever, "А 412 МР 77")
		trip := w.trip(sever, "Р-208", driver)
		list := scalar[string](t, mig, `insert into fleet.checklist_versions (kind, version, items, required_photo_roles)
			values ('return', 7, '[{"key":"cargo","label":"Груз выгружен полностью","required":true}]',
			'{front,back,left,right,odometer}') returning id::text`)
		file := scalar[string](t, mig, `insert into files.objects (object_key, state, purpose, owner_type, owner_id,
			declared_mime, bytes, sha256, uploaded_by) values ('t/insp/2', 'ready', 'inspection', 'fleet.trip', $1,
			'image/jpeg', 2457600, '\x02', $2) returning id::text`, trip, driver)
		w.must("upload session", `insert into files.upload_sessions (file_id, actor_id, state, reserved_bytes,
			ticket_expires_at, session_expires_at, completed_at) values ($1, $2, 'completed', 0, '2026-10-01 07:45Z',
			'2026-10-01 08:30Z', '2026-10-01 07:31Z')`, file, driver)
		insp := scalar[string](t, mig, `insert into fleet.inspections (trip_id, vehicle_id, kind, checklist_version_id,
			odometer_km, fuel_level, answers, state, submitted_by) values ($1, $2, 'return', $3, 84560, 'half', '{}',
			'submitted', $4) returning id::text`, trip, v, list, driver)
		w.must("photo", `insert into fleet.inspection_photos (inspection_id, role, file_id) values ($1, 'front', $2)`,
			insp, file)

		if _, err := migrations.Up(ctx, mig, migrations.Tenant); err != nil {
			t.Fatalf("up again: %v", err)
		}
		if got := scalar[string](t, mig, `select u.name || ':' || (a.valid_from = v.created_at) || ':' || (a.valid_to is null)
			from fleet.vehicle_assignments a join fleet.vehicles v on v.id = a.vehicle_id join org.units u on u.id = a.unit_id
			where a.vehicle_id = $1`, v); got != "Север Логистик:true:true" {
			t.Errorf("assignment of a vehicle before 0016 = %s", got)
		}
		def := scalar[string](t, mig, `select definition::text from fleet.checklist_versions where id = $1`, list)
		checkDefinition(t, def, "Осмотр при сдаче",
			[]string{"cargo", "photo_front", "photo_rear", "photo_left", "photo_right", "photo_odometer"})
		if got := scalar[string](t, mig, `select to_char(server_captured_at at time zone 'UTC', 'HH24:MI')
			from fleet.inspection_photos where inspection_id = $1`, insp); got != "07:31" {
			t.Errorf("server_captured_at of a photo before 0017 = %s, want 07:31 (upload completion)", got)
		}
		if n := scalar[int](t, mig, objects); n != 16 {
			t.Errorf("after Up again: %d objects of 0015–0017, want 16", n)
		}
		if got := scalar[string](t, mig, `select string_agg(u.name, ',') from fleet.vehicle_assignments a
			join org.units u on u.id = a.unit_id where a.vehicle_id = $1 and a.valid_to is null`,
			w.vehicle(sever, "Т 900 АА 77")); got != "Север Логистик" {
			t.Errorf("open period of a vehicle after Up again = %s", got)
		}
	})
}
