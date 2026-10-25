package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// tenant 0040–0044 контрактного PR этапа 5 (W5.00, контракт 0.12.0-stage5): схемы cash (журнал, смены, перемещения,
// предложения, подотчёт, заявки), inventory (склады, номенклатура, партии, остатки, движения, резервы) и spa (услуги
// с техкартой, визиты, однократное списание). Down снимает ровно эти объекты (без cascade).
func w500Migration(t *testing.T, file, firstLine string, upRe, downRe []string) {
	t.Helper()
	text := readFile(t, migrations.Tenant, file)
	if !strings.HasPrefix(text, firstLine) {
		t.Errorf("%s: first line must start with %q", file, firstLine)
	}
	up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
	for _, re := range upRe {
		if !regexp.MustCompile(re).MatchString(up) {
			t.Errorf("%s: Up lacks /%s/", file, re)
		}
	}
	for _, re := range downRe {
		if !regexp.MustCompile(re).MatchString(down) {
			t.Errorf("%s: Down lacks /%s/", file, re)
		}
	}
	if strings.Contains(down, "cascade") {
		t.Errorf("%s: Down must not use cascade", file)
	}
}

func TestStage5W500CashLedger(t *testing.T) {
	t.Parallel()
	w500Migration(t, "0040_cash_ledger.sql", "-- W5.00 · tenant 0040 · ", []string{
		`create schema if not exists cash`,
		`create table cash\.categories`,
		`group_name\s+text not null check \(group_name in \('income', 'expense', 'transfer', 'adjustment'\)\)`,
		`create table cash\.accounts`,
		`org_unit_id\s+uuid references org\.units \(id\)`,
		`kind\s+text not null check \(kind in \('cash_drawer', 'safe', 'advance', 'acquiring', 'bank', 'virtual'\)\)`,
		`shift_mode\s+text not null default 'none' check \(shift_mode in \('none', 'open', 'blind'\)\)`,
		`kkt_mode\s+text not null default 'none' check \(kkt_mode in \('none', 'manual'\)\)`,
		`constraint accounts_advance_holder check \(kind <> 'advance' or holder_id is not null\)`,
		`constraint accounts_terminal_drawer check \(kind <> 'acquiring' or drawer_account_id is not null\)`,
		`constraint accounts_physical_not_negative check \(kind in \('bank', 'acquiring', 'virtual'\) or balance_minor >= 0\)`,
		`create unique index accounts_name_idx on cash\.accounts \(lower\(btrim\(name\)\)\)`,
		`create sequence cash\.operation_number_seq`,
		`create table cash\.operations`,
		`type\s+text not null check \(type in \('in', 'out', 'refund', 'move_in', 'move_out', 'opening', 'adjust', 'storno'\)\)`,
		`method\s+text not null check \(method in \('cash', 'card', 'sbp', 'transfer'\)\)`,
		`amount_minor\s+bigint not null check \(amount_minor > 0\)`,
		`origin\s+text not null default 'manual' check \(origin in \('manual', 'proposal', 'import', 'integration'\)\)`,
		`constraint operations_storno check \(\(type = 'storno'\) = \(reverses_operation_id is not null\)\)`,
		`constraint operations_receipt check \(\(fd_number is null\) = \(kkt_shift is null\)\)`,
		`constraint operations_receipt_none check \(not receipt_none or receipt_reason is not null\)`,
		`create unique index operations_number_idx on cash\.operations \(number\)`,
		`create unique index operations_reverses_idx on cash\.operations \(reverses_operation_id\) where reverses_operation_id is not null`,
		`create unique index operations_receipt_idx on cash\.operations \(point_account_id, kkt_shift, fd_number\) where fd_number is not null`,
		`create table cash\.source_claims`,
		`source_key\s+text primary key`,
		`create table cash\.operation_links`,
		`create unique index operation_links_source_idx on cash\.operation_links \(source_key\)`,
		`insert into cash\.categories`,
	}, []string{
		`drop table cash\.operation_links`,
		`drop table cash\.source_claims`,
		`drop table cash\.operations`,
		`drop sequence cash\.operation_number_seq`,
		`drop table cash\.accounts`,
		`drop table cash\.categories`,
		`drop schema cash`,
	})
}

func TestStage5W500CashShiftsTransfers(t *testing.T) {
	t.Parallel()
	w500Migration(t, "0041_cash_shifts_transfers.sql", "-- W5.00 · tenant 0041 · ", []string{
		`create table cash\.shifts`,
		`status\s+text not null check \(status in \('open', 'review', 'closed'\)\)`,
		`create unique index shifts_number_idx on cash\.shifts \(account_id, number\)`,
		`create unique index shifts_open_idx on cash\.shifts \(account_id\) where status = 'open'`,
		`create table cash\.shift_close_attempts`,
		`create table cash\.shift_reviews`,
		`decision\s+text not null check \(decision in \('accept', 'recount'\)\)`,
		`create unique index shift_reviews_attempt_idx on cash\.shift_reviews \(attempt_id\)`,
		`create table cash\.transfers`,
		`purpose\s+text not null check \(purpose in \('transfer', 'shift_handover', 'advance_issue', 'advance_return'\)\)`,
		`status\s+text not null default 'transit' check \(status in \('transit', 'done', 'rejected'\)\)`,
		`constraint transfers_distinct check \(from_account_id <> to_account_id\)`,
		`constraint transfers_rejected_reason check \(status <> 'rejected' or reason is not null\)`,
		`alter table cash\.operations add constraint operations_shift_fk foreign key \(shift_id\) references cash\.shifts \(id\)`,
		`alter table cash\.operations add constraint operations_transfer_fk foreign key \(transfer_id\) references cash\.transfers \(id\) deferrable initially deferred`,
	}, []string{
		`alter table cash\.operations drop constraint operations_transfer_fk`,
		`alter table cash\.operations drop constraint operations_shift_fk`,
		`drop table cash\.transfers`,
		`drop table cash\.shift_reviews`,
		`drop table cash\.shift_close_attempts`,
		`drop table cash\.shifts`,
	})
}

func TestStage5W500CashProposalsAdvances(t *testing.T) {
	t.Parallel()
	w500Migration(t, "0042_cash_proposals_advances.sql", "-- W5.00 · tenant 0042 · ", []string{
		`create table cash\.proposals`,
		`key\s+text primary key`,
		`kind\s+text not null check \(kind in \('visit', 'expense', 'payroll', 'refund', 'purchase', 'invoice'\)\)`,
		`status\s+text not null default 'open' check \(status in \('open', 'posted', 'dismissed'\)\)`,
		`create table cash\.proposal_dismissals`,
		`proposal_key\s+text primary key references cash\.proposals \(key\)`,
		`create table cash\.advance_receipts`,
		`status\s+text not null default 'review' check \(status in \('review', 'accepted', 'rejected'\)\)`,
		`file_id\s+uuid not null`,
		`create table cash\.approval_requests`,
		`type\s+text not null check \(type in \('out', 'refund', 'issue'\)\)`,
		`status\s+text not null default 'pending' check \(status in \('pending', 'approved', 'rejected'\)\)`,
		`payload\s+jsonb not null`,
	}, []string{
		`drop table cash\.approval_requests`,
		`drop table cash\.advance_receipts`,
		`drop table cash\.proposal_dismissals`,
		`drop table cash\.proposals`,
	})
}

func TestStage5W500Inventory(t *testing.T) {
	t.Parallel()
	w500Migration(t, "0043_inventory.sql", "-- W5.00 · tenant 0043 · ", []string{
		`create schema if not exists inventory`,
		`create table inventory\.warehouses`,
		`org_unit_id\s+uuid not null references org\.units \(id\)`,
		`create table inventory\.items`,
		`base_unit\s+text not null check \(base_unit in \('ml', 'g', 'piece', 'litre', 'kg'\)\)`,
		`create table inventory\.lots`,
		`create table inventory\.balances`,
		`on_hand\s+numeric\(18, 6\) not null default 0 check \(on_hand >= 0\)`,
		`reserved\s+numeric\(18, 6\) not null default 0 check \(reserved >= 0\)`,
		`constraint balances_reserved check \(reserved <= on_hand\)`,
		`create table inventory\.movements`,
		`kind\s+text not null check \(kind in \('receipt', 'issue', 'transfer', 'adjustment', 'reversal'\)\)`,
		`create unique index movements_reverses_idx on inventory\.movements \(reverses_movement_id\) where reverses_movement_id is not null`,
		`create table inventory\.movement_lines`,
		`quantity\s+numeric\(18, 6\) not null check \(quantity > 0\)`,
		`create table inventory\.reservations`,
		`status\s+text not null default 'active' check \(status in \('active', 'consumed', 'released'\)\)`,
		`create table inventory\.reservation_lines`,
		`create index lots_fefo_idx on inventory\.lots \(warehouse_id, item_id, expires_on nulls last, received_at\)`,
	}, []string{
		`drop table inventory\.reservation_lines`,
		`drop table inventory\.reservations`,
		`drop table inventory\.movement_lines`,
		`drop table inventory\.movements`,
		`drop table inventory\.balances`,
		`drop table inventory\.lots`,
		`drop table inventory\.items`,
		`drop table inventory\.warehouses`,
		`drop schema inventory`,
	})
}

func TestStage5W500Spa(t *testing.T) {
	t.Parallel()
	w500Migration(t, "0044_spa.sql", "-- W5.00 · tenant 0044 · ", []string{
		`create schema if not exists spa`,
		`create table spa\.services`,
		`duration_minutes\s+integer not null check \(duration_minutes >= 1\)`,
		`create table spa\.service_revisions`,
		`primary key \(service_id, revision\)`,
		`create table spa\.service_recipe_lines`,
		`create table spa\.appointments`,
		`status\s+text not null default 'confirmed' check \(status in \('confirmed', 'performed_pending_posting', 'completed', 'cancelled', 'no_show'\)\)`,
		`constraint appointments_window check \(starts_at < ends_at\)`,
		`practitioner_id\s+uuid not null references people\.person_profiles \(id\)`,
		`create table spa\.completions`,
		`appointment_id\s+uuid primary key references spa\.appointments \(id\)`,
	}, []string{
		`drop table spa\.completions`,
		`drop table spa\.appointments`,
		`drop table spa\.service_recipe_lines`,
		`drop table spa\.service_revisions`,
		`drop table spa\.services`,
		`drop schema spa`,
	})
}

// Модуль пишет только в свою схему: внешние ключи схем cash, inventory, spa — только на org, people и себя;
// id объектов других модулей (файлы, визиты, расходы, склад) — без внешних ключей.
func TestStage5W500NoCrossModuleKeys(t *testing.T) {
	t.Parallel()
	re := regexp.MustCompile(`references\s+(\w+)\.`)
	own := map[string]string{
		"0040_cash_ledger.sql": "cash", "0041_cash_shifts_transfers.sql": "cash", "0042_cash_proposals_advances.sql": "cash",
		"0043_inventory.sql": "inventory", "0044_spa.sql": "spa",
	}
	for file, schema := range own {
		up := stripComments(upBody(t, readFile(t, migrations.Tenant, file)))
		for _, m := range re.FindAllStringSubmatch(up, -1) {
			if m[1] != schema && m[1] != "org" && m[1] != "people" {
				t.Errorf("%s: foreign key to schema %q (the module writes only to its own schema)", file, m[1])
			}
		}
	}
}
