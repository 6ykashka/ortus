package migrations_test

import (
	"regexp"
	"strings"
	"testing"

	"github.com/ortus/ortus-crm/backend/migrations"
)

// Control-миграции исполнителей этапа 1 (план v2 §3.5, Q-W0.04-1: номер — из резерва стюарда «0006+» в
// api/README.md). Up создаёт объекты шага, Down снимает ровно их, без cascade.
func TestControlStage1Migrations(t *testing.T) {
	t.Parallel()
	tests := []struct {
		name string
		file string
		ws   string
		up   []string
		down []string
		// downNot: Down keeps data — it refuses instead of deleting rows it cannot take back.
		downNot []string
	}{
		{
			name: "0006 вход BFF: сессии, записи входа, автор приглашения владельца (S1-05, S1-06)",
			file: "0006_auth_sessions.sql",
			ws:   "W1.03",
			up: []string{
				// Q-W0.09-8: durable-сессии; в БД — только хеш идентификатора.
				`create table auth_sessions \(`,
				`id_hash\s+bytea primary key`,
				`account_id\s+uuid not null references accounts\(id\)`,
				`csrf_token\s+text not null`,
				`auth_time\s+timestamptz not null`,
				`expires_at\s+timestamptz not null`,
				`revoked_at\s+timestamptz`,
				`logout_key\s+text`,
				`check \(expires_at > issued_at\)`,
				`create index auth_sessions_account_idx on auth_sessions \(account_id\) where revoked_at is null`,
				`create index auth_sessions_expiry_idx on auth_sessions \(expires_at\)`,
				// Одноразовая запись входа OIDC: state, nonce, code_verifier (10 минут).
				`create table auth_login_states \(`,
				`code_verifier\s+text not null`,
				`return_to\s+text not null`,
				`create index auth_login_states_expiry_idx on auth_login_states \(expires_at\)`,
				// Приглашение владельца выпускает оператор или система (W1.02 п. 3).
				`alter table invitations`,
				`alter column created_by drop not null`,
				`add column created_by_operator\s+uuid references platform_operators\(id\)`,
				`add column grants_owner\s+boolean not null default false`,
				`add constraint invitations_author_chk check \(created_by is not null or grants_owner\)`,
				// Назначения tenant DB, которые принятие делает active (dormant без этой ссылки не трогаются).
				`add column role_assignment_ids\s+uuid\[\] not null default '\{\}'`,
			},
			down: []string{
				`drop column role_assignment_ids`,
				`drop table auth_login_states;`,
				`drop table auth_sessions;`,
				`drop constraint invitations_author_chk`,
				`drop column created_by_operator`,
				`drop column grants_owner`,
				`alter column created_by set not null`,
			},
			downNot: []string{`delete from`},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			text := readFile(t, migrations.Control, tt.file)
			wantHeader := "-- " + tt.ws + " · control " + tt.file[:4] + " · "
			if !strings.HasPrefix(text, wantHeader) {
				t.Errorf("first line must start with %q", wantHeader)
			}
			up, down := stripComments(upBody(t, text)), stripComments(downBody(t, text))
			for _, re := range tt.up {
				if !regexp.MustCompile(re).MatchString(up) {
					t.Errorf("Up lacks /%s/", re)
				}
			}
			for _, re := range tt.down {
				if !regexp.MustCompile(re).MatchString(down) {
					t.Errorf("Down lacks /%s/", re)
				}
			}
			for _, re := range tt.downNot {
				if regexp.MustCompile(re).MatchString(down) {
					t.Errorf("Down must not contain /%s/", re)
				}
			}
			if strings.Contains(down, "cascade") {
				t.Error("Down must not use cascade")
			}
		})
	}
}
