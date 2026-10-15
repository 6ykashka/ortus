package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// Миграции второго контрактного PR этапа 1 (W1.00, план v2 §3.5, PD-59): control 0004–0005 и tenant 0007.
// Номер выдал стюард; Up создаёт объекты шага, Down снимает ровно их (без cascade).
func TestStage1bMigrations(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name      string
		kind      migrations.Kind
		file      string
		up        []string
		forbidden []string // подстроки, которых нет ни в Up, ни в Down
		down      []string
	}{
		{
			name: "control 0004 последний выбранный бизнес (S1-07, selectTenant)",
			kind: migrations.Control,
			file: "0004_accounts_last_tenant.sql",
			up: []string{
				`alter table accounts`,
				`add column last_tenant_id\s+uuid references tenants\(id\) on delete set null`,
				`add column last_tenant_at\s+timestamptz`,
			},
			down: []string{`alter table accounts`, `drop column last_tenant_at`, `drop column last_tenant_id`},
		},
		{
			name: "control 0005 идемпотентность команд control-plane (S1-25)",
			kind: migrations.Control,
			file: "0005_idempotency_keys.sql",
			up: []string{
				`create table idempotency_keys \(`,
				`id\s+bigint generated always as identity primary key`,
				// Ревью W1.00 (возврат 1): пространство ключа — тенант + actor + операция (параметр IdempotencyKey,
				// 03-api-guide); в control DB тенант указывается явно, null — команда без организации.
				`tenant_id\s+uuid,`,
				`constraint idempotency_keys_scope_key unique nulls not distinct \(actor_id, tenant_id, operation, key\)`,
				// Длина ключа — как minLength/maxLength параметра IdempotencyKey контракта (16–128).
				`key\s+text not null check \(length\(key\) between 16 and 128\)`,
				`request_hash\s+bytea not null`,
				`state\s+text not null check \(state in \('in_progress','completed'\)\)`,
				`check \(state = 'in_progress' or response_status is not null\)`,
				`create index idempotency_keys_expiry_idx on idempotency_keys \(expires_at\)`,
			},
			down: []string{`drop table idempotency_keys`},
		},
		{
			// Ревью W1.00 (возврат 2): 0007 согласована с outbox W1.01 (events/outbox.go, Q-W1.01-3). Dead-letter —
			// available_at = 'infinity' и причина в last_error; аренда — только locked_until (без владельца);
			// очередь Claim читает outbox_pending_idx tenant 0001, поэтому он остаётся.
			name: "tenant 0007 outbox: dead-letter в модели W1.01 (S1-24)",
			kind: migrations.Tenant,
			file: "0007_outbox_dead_letter.sql",
			up: []string{
				`update outbox\.events set last_error = 'unknown error'\s+where published_at is null and available_at = 'infinity' and last_error is null`,
				`alter table outbox\.events\s+add constraint events_dead_has_error check \(available_at <> 'infinity' or last_error is not null\)`,
				`create index outbox_dead_idx on outbox\.events \(id\)\s+where published_at is null and available_at = 'infinity'`,
			},
			forbidden: []string{`lease_owner`, `lease_pair`, `dead_at`, `retried_`, `outbox_pending_idx`, `outbox_ready_idx`},
			down: []string{
				`drop index outbox\.outbox_dead_idx`,
				`alter table outbox\.events drop constraint events_dead_has_error`,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			text := readFile(t, tt.kind, tt.file)
			wantHeader := "-- W1.00 · " + string(tt.kind) + " " + tt.file[:4] + " · "
			if !strings.HasPrefix(text, wantHeader) {
				t.Errorf("first line must start with %q", wantHeader)
			}
			up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
			for _, re := range tt.up {
				if !regexp.MustCompile(re).MatchString(up) {
					t.Errorf("Up lacks /%s/", re)
				}
			}
			for _, s := range tt.forbidden {
				if strings.Contains(up, s) || strings.Contains(down, s) {
					t.Errorf("migration must not touch %q", s)
				}
			}
			if strings.Contains(up, "primary key (actor_id, operation, key)") {
				t.Error("Up keeps the key namespace without tenant_id")
			}
			for _, re := range tt.down {
				if !regexp.MustCompile(re).MatchString(down) {
					t.Errorf("Down lacks /%s/", re)
				}
			}
			if strings.Contains(down, "cascade") {
				t.Error("Down must not use cascade")
			}
		})
	}
}
