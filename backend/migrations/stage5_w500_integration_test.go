//go:build integration

package migrations_test

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// tenant 0040–0044 (W5.00) на реальном сервере под runtime-ролью API: физическая касса не уходит в минус, терминал без
// кассы точки и подотчёт без держателя — отказ, имя кассы уникально без учёта регистра, сторно — одно на операцию,
// № ФД уникален в паре «касса точки + смена ККТ», одна открытая смена на кассу, перемещение — две разные кассы,
// журнал и попытки закрытия неизменяемы; склад: остаток не уходит в минус, резерв не больше остатка, FEFO-индекс партий;
// SPA: окно визита, завершение — одна строка на визит.
func TestStage5W500Constraints(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name, _ := migrated(t, c, migrations.Tenant)
		db := c.DB(t, name, migrations.RoleAPI)
		ctx := t.Context()
		exec := func(q string, args ...any) error {
			_, err := db.ExecContext(ctx, q, args...)
			return err
		}
		wantState := func(what string, err error, state string) {
			t.Helper()
			if got := sqlState(err); got != state {
				t.Errorf("%s: SQLSTATE %q (%v), want %s", what, got, err, state)
			}
		}
		wantOK := func(what string, err error) {
			t.Helper()
			if err != nil {
				t.Errorf("%s: %v", what, err)
			}
		}

		unit := scalar[string](t, db, `insert into org.units (kind, name, time_zone)
			values ('company', 'Салон', 'Europe/Moscow') returning id::text`)
		morozova := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Анна Морозова', $1) returning id::text`, unit)
		owner := scalar[string](t, db, `insert into people.person_profiles (full_name, home_unit_id)
			values ('Дарья Зимина', $1) returning id::text`, unit)

		// Статьи — сид миграции.
		if n := scalar[int](t, db, `select count(*) from cash.categories`); n != 14 {
			t.Errorf("categories = %d, want 14", n)
		}

		// Кассы: имя уникально без учёта регистра; терминал — с кассой точки; подотчёт — с держателем.
		account := func(nm, kind string, holder, drawer any) (string, error) {
			var id string
			err := db.QueryRowContext(ctx, `insert into cash.accounts (org_unit_id, name, kind, holder_id, drawer_account_id)
				values ($1, $2, $3, $4, $5) returning id::text`, unit, nm, kind, holder, drawer).Scan(&id)
			return id, err
		}
		spa, err := account("Касса салона", "cash_drawer", nil, nil)
		wantOK("drawer", err)
		_, err = account("касса САЛОНА", "cash_drawer", nil, nil)
		wantState("account name taken", err, "23505")
		_, err = account("Терминал", "acquiring", nil, nil)
		wantState("terminal without a cash desk", err, "23514")
		term, err := account("Терминал салона", "acquiring", nil, spa)
		wantOK("terminal", err)
		_, err = account("Подотчёт без держателя", "advance", nil, nil)
		wantState("advance without a holder", err, "23514")
		adv, err := account("Подотчёт Морозовой", "advance", morozova, nil)
		wantOK("advance", err)
		other, err := account("Касса офиса", "cash_drawer", nil, nil)
		wantOK("office drawer", err)
		wantState("physical cash below zero", exec(`update cash.accounts set balance_minor = -1 where id = $1`, spa), "23514")
		wantOK("terminal may be negative", exec(`update cash.accounts set balance_minor = -1 where id = $1`, term))

		// Смены: одна открытая на кассу, номер уникален по кассе.
		shift := scalar[string](t, db, `insert into cash.shifts (account_id, number, status, opened_by, opening_float_minor)
			values ($1, 118, 'open', $2, 500000) returning id::text`, spa, morozova)
		wantState("second open shift", exec(`insert into cash.shifts (account_id, number, status, opened_by)
			values ($1, 119, 'open', $2)`, spa, morozova), "23505")
		wantState("closed shift without a count", exec(`insert into cash.shifts (account_id, number, status, opened_by)
			values ($1, 120, 'closed', $2)`, spa, morozova), "23514")

		// Журнал: сторно — одно на операцию, № ФД — в паре «касса точки + смена ККТ», чек «не пробивали» — с причиной.
		op := func(account, typ, direction string, amount int, fd any, kkt any) (string, error) {
			var id string
			err := db.QueryRowContext(ctx, `insert into cash.operations (account_id, point_account_id, type, direction, amount_minor,
				category, method, occurred_at, created_by, shift_id, fd_number, kkt_shift)
				values ($1, $1, $2, $3, $4, 'service_payment', 'cash', now(), $5, $6, $7, $8) returning id::text`,
				account, typ, direction, amount, morozova, shift, fd, kkt).Scan(&id)
			return id, err
		}
		in1, err := op(spa, "in", "in", 320000, "4390", "118")
		wantOK("operation in", err)
		_, err = op(spa, "in", "in", 100, "4390", "118")
		wantState("receipt already entered", err, "23505")
		_, err = op(spa, "in", "in", 100, "4390", nil)
		wantState("fd without kkt shift", err, "23514")
		_, err = op(spa, "in", "in", 0, nil, nil)
		wantState("zero amount", err, "23514")
		_, err = op(spa, "storno", "out", 320000, nil, nil)
		wantState("storno without a reversed operation", err, "23514")
		wantOK("storno", exec(`insert into cash.operations (account_id, point_account_id, type, direction, amount_minor, category,
			method, occurred_at, created_by, reverses_operation_id)
			values ($1, $1, 'storno', 'out', 320000, 'adjustment', 'cash', now(), $2, $3)`, spa, owner, in1))
		wantState("second storno of one operation", exec(`insert into cash.operations (account_id, point_account_id, type, direction,
			amount_minor, category, method, occurred_at, created_by, reverses_operation_id)
			values ($1, $1, 'storno', 'out', 320000, 'adjustment', 'cash', now(), $2, $3)`, spa, owner, in1), "23505")
		wantState("receipt «none» without a reason", exec(`insert into cash.operations (account_id, point_account_id, type, direction,
			amount_minor, category, method, occurred_at, created_by, receipt_none)
			values ($1, $1, 'out', 'out', 65000, 'expense', 'cash', now(), $2, true)`, spa, morozova), "23514")
		wantState("ledger is append-only: update", exec(`update cash.operations set basis = 'x' where id = $1`, in1), "42501")
		wantState("ledger is append-only: delete", exec(`delete from cash.operations where id = $1`, in1), "42501")

		// Источник — один раз.
		wantOK("source claim", exec(`insert into cash.source_claims (source_key, group_id) values ('visit:ap-1', gen_random_uuid())`))
		wantState("source claimed twice", exec(`insert into cash.source_claims (source_key, group_id) values ('visit:ap-1', gen_random_uuid())`), "23505")

		// Попытки закрытия неизменяемы; перемещение — две разные кассы, отказ — с причиной.
		attempt := scalar[string](t, db, `insert into cash.shift_close_attempts (shift_id, closed_by, counted_minor)
			values ($1, $2, 318400) returning id::text`, shift, morozova)
		wantState("close attempt is append-only", exec(`update cash.shift_close_attempts set counted_minor = 0 where id = $1`, attempt), "42501")
		wantOK("shift review", exec(`insert into cash.shift_reviews (shift_id, attempt_id, decision, reason, decided_by)
			values ($1, $2, 'recount', 'Пересчитайте купюры', $3)`, shift, attempt, owner))
		wantState("second review of one attempt", exec(`insert into cash.shift_reviews (shift_id, attempt_id, decision, reason, decided_by)
			values ($1, $2, 'accept', 'Сдача мелочью', $3)`, shift, attempt, owner), "23505")
		wantState("review is append-only", exec(`update cash.shift_reviews set reason = 'x' where attempt_id = $1`, attempt), "42501")
		wantState("transfer to itself", exec(`insert into cash.transfers (from_account_id, to_account_id, amount_minor, purpose, sent_by)
			values ($1, $1, 100, 'transfer', $2)`, spa, owner), "23514")
		tr := scalar[string](t, db, `insert into cash.transfers (from_account_id, to_account_id, amount_minor, purpose, sent_by)
			values ($1, $2, 2000000, 'transfer', $3) returning id::text`, spa, other, owner)
		wantState("rejected without a reason", exec(`update cash.transfers set status = 'rejected', decided_at = now(), decided_by = $2
			where id = $1`, tr, owner), "23514")
		wantOK("rejected with a reason", exec(`update cash.transfers set status = 'rejected', decided_at = now(), decided_by = $2,
			reason = 'Не пришли деньги' where id = $1`, tr, owner))

		// Предложение: отказ — по ключу предложения; заявку не решает автор.
		wantOK("proposal", exec(`insert into cash.proposals (key, kind, title, amount_minor, direction, source_kind, source_id)
			values ('visit:ap-1', 'visit', 'Массаж лица', 280000, 'in', 'visit', gen_random_uuid())`))
		wantOK("dismissal", exec(`insert into cash.proposal_dismissals (proposal_key, reason, dismissed_by)
			values ('visit:ap-1', 'Клиент отказался', $1)`, owner))
		wantState("dismissal of an unknown proposal", exec(`insert into cash.proposal_dismissals (proposal_key, reason, dismissed_by)
			values ('visit:none', 'Клиент отказался', $1)`, owner), "23503")
		req := scalar[string](t, db, `insert into cash.approval_requests (account_id, type, amount_minor, payload, requested_by)
			values ($1, 'out', 650000, '{}', $2) returning id::text`, other, morozova)
		wantState("author decides own request", exec(`update cash.approval_requests set status = 'approved', decided_at = now(),
			decided_by = $2 where id = $1`, req, morozova), "23514")
		wantOK("owner decides", exec(`update cash.approval_requests set status = 'approved', decided_at = now(), decided_by = $2
			where id = $1`, req, owner))
		wantState("receipt without a file", exec(`insert into cash.advance_receipts (account_id, amount_minor, category_id, submitted_by)
			values ($1, 60000, 'wash', $2)`, adv, morozova), "23502")

		// Склад: остаток не уходит в минус, резерв не больше остатка, FEFO.
		wh := scalar[string](t, db, `insert into inventory.warehouses (org_unit_id, name) values ($1, 'Склад салона') returning id::text`, unit)
		wantState("warehouse name taken", exec(`insert into inventory.warehouses (org_unit_id, name) values ($1, 'склад САЛОНА')`, unit), "23505")
		item := scalar[string](t, db, `insert into inventory.items (org_unit_id, name, sku, base_unit, track_lots)
			values ($1, 'Масло массажное', 'OIL-1', 'ml', true) returning id::text`, unit)
		wantState("sku taken", exec(`insert into inventory.items (org_unit_id, name, sku, base_unit)
			values ($1, 'Масло 2', 'oil-1', 'ml')`, unit), "23505")
		wantState("unknown unit", exec(`insert into inventory.items (org_unit_id, name, sku, base_unit)
			values ($1, 'Крем', 'CR-1', 'pound')`, unit), "23514")
		lot1 := scalar[string](t, db, `insert into inventory.lots (item_id, warehouse_id, lot_code, expires_on)
			values ($1, $2, 'L1', '2026-12-31') returning id::text`, item, wh)
		wantOK("balance", exec(`insert into inventory.balances (warehouse_id, item_id, lot_id, on_hand, reserved)
			values ($1, $2, $3, 400, 50)`, wh, item, lot1))
		wantState("balance of one lot twice", exec(`insert into inventory.balances (warehouse_id, item_id, lot_id, on_hand)
			values ($1, $2, $3, 1)`, wh, item, lot1), "23505")
		wantState("negative stock", exec(`update inventory.balances set on_hand = -1 where warehouse_id = $1 and item_id = $2`, wh, item), "23514")
		wantState("reserved above on hand", exec(`update inventory.balances set reserved = 500 where warehouse_id = $1 and item_id = $2`, wh, item), "23514")
		mv := scalar[string](t, db, `insert into inventory.movements (kind, warehouse_id, posted_by) values ('receipt', $1, $2) returning id::text`, wh, owner)
		wantOK("movement line", exec(`insert into inventory.movement_lines (movement_id, line_no, item_id, lot_id, quantity)
			values ($1, 1, $2, $3, 400)`, mv, item, lot1))
		wantState("zero quantity", exec(`insert into inventory.movement_lines (movement_id, line_no, item_id, quantity)
			values ($1, 2, $2, 0)`, mv, item), "23514")
		wantState("movements are append-only", exec(`update inventory.movements set reason = 'x' where id = $1`, mv), "42501")
		wantState("transfer without a target", exec(`insert into inventory.movements (kind, warehouse_id, posted_by) values ('transfer', $1, $2)`, wh, owner), "23514")
		wantState("reversal without a reversed movement", exec(`insert into inventory.movements (kind, warehouse_id, posted_by) values ('reversal', $1, $2)`, wh, owner), "23514")

		// SPA: окно визита, завершение — одна строка на визит, снимок ревизии услуги.
		svc := scalar[string](t, db, `insert into spa.services (org_unit_id, name, duration_minutes, price_minor)
			values ($1, 'Классический массаж', 60, 320000) returning id::text`, unit)
		wantState("service of zero minutes", exec(`insert into spa.services (org_unit_id, name, duration_minutes, price_minor)
			values ($1, 'Экспресс', 0, 100)`, unit), "23514")
		wantOK("service revision", exec(`insert into spa.service_revisions (service_id, revision, snapshot) values ($1, 1, '{}')`, svc))
		wantState("service revision is append-only", exec(`update spa.service_revisions set snapshot = '{"a":1}' where service_id = $1`, svc), "42501")
		appt := func(starts, ends string, status string, performed any) (string, error) {
			var id string
			err := db.QueryRowContext(ctx, `insert into spa.appointments (org_unit_id, service_id, service_revision, client_id, practitioner_id,
				room_id, starts_at, ends_at, time_zone, booking_id, status, performed_at, service_snapshot, created_by)
				values ($1, $2, 1, gen_random_uuid(), $3, gen_random_uuid(), $4, $5, 'Europe/Moscow', gen_random_uuid(), $6, $7, '{}', $3)
				returning id::text`, unit, svc, morozova, starts, ends, status, performed).Scan(&id)
			return id, err
		}
		_, err = appt("2026-10-02T10:00:00Z", "2026-10-02T09:00:00Z", "confirmed", nil)
		wantState("window reversed", err, "23514")
		_, err = appt("2026-10-02T09:00:00Z", "2026-10-02T10:00:00Z", "completed", nil)
		wantState("completed without performed_at", err, "23514")
		_, err = appt("2026-10-02T09:00:00Z", "2026-10-02T10:00:00Z", "cancelled", nil)
		wantState("cancelled without a reason", err, "23514")
		ap, err := appt("2026-10-02T09:00:00Z", "2026-10-02T10:00:00Z", "performed_pending_posting", "2026-10-02T10:05:00Z")
		wantOK("performed appointment", err)
		wantOK("completion", exec(`insert into spa.completions (appointment_id, completed_by, warehouse_id) values ($1, $2, $3)`, ap, owner, wh))
		wantState("second completion of one appointment", exec(`insert into spa.completions (appointment_id, completed_by, warehouse_id)
			values ($1, $2, $3)`, ap, owner, wh), "23505")
	})
}
