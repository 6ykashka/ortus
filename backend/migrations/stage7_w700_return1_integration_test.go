//go:build integration

package migrations_test

import (
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// control 0011 (W7.00, возврат 1) на реальном сервере под runtime-ролью API: дайджест токена и slug публичной
// страницы направления глобально уникальны, строки привязаны к тенанту, формат проверяется, slug свободен для
// другого тенанта после удаления строки.
func TestStage7W700Return1ControlRoutingConstraints(t *testing.T) {
	t.Parallel()
	eachCluster(t, func(t *testing.T, c *migratetest.Cluster) {
		t.Helper()
		name, _ := migrated(t, c, migrations.Control)
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
		lotos := scalar[string](t, db, `insert into tenants (slug, display_name, industry_pack)
			values ('lotos', 'SPA «Лотос»', 'spa') returning id::text`)
		alta := scalar[string](t, db, `insert into tenants (slug, display_name, industry_pack)
			values ('alta', 'Альта Групп', 'spa') returning id::text`)
		digest := func(c string) string { return "sha256:" + strings.Repeat(c, 64) }

		// Внешние ссылки документов: дайджест уникален во всём control, ссылка — в одном тенанте.
		doc, link := uuid.NewString(), uuid.NewString()
		wantOK("doc link", exec(`insert into public_doc_links (token_digest, tenant_id, document_id, link_id, expires_at)
			values ($1, $2, $3, $4, now() + interval '14 days')`, digest("a"), lotos, doc, link))
		wantState("same digest for another tenant", exec(`insert into public_doc_links
			(token_digest, tenant_id, document_id, link_id, expires_at)
			values ($1, $2, $3, $4, now() + interval '1 day')`, digest("a"), alta, uuid.NewString(), uuid.NewString()), "23505")
		wantState("same link twice", exec(`insert into public_doc_links
			(token_digest, tenant_id, document_id, link_id, expires_at)
			values ($1, $2, $3, $4, now() + interval '1 day')`, digest("b"), lotos, doc, link), "23505")
		wantState("digest format", exec(`insert into public_doc_links
			(token_digest, tenant_id, document_id, link_id, expires_at)
			values ('plain-token', $1, $2, $3, now())`, lotos, uuid.NewString(), uuid.NewString()), "23514")
		wantState("unknown tenant", exec(`insert into public_doc_links
			(token_digest, tenant_id, document_id, link_id, expires_at)
			values ($1, $2, $3, $4, now())`, digest("c"), uuid.NewString(), uuid.NewString(), uuid.NewString()), "23503")

		// Портал обращений: токен клиента.
		req, tok := uuid.NewString(), uuid.NewString()
		wantOK("service token", exec(`insert into public_service_tokens
			(token_digest, tenant_id, request_id, token_id, expires_at)
			values ($1, $2, $3, $4, now() + interval '30 days')`, digest("d"), alta, req, tok))
		wantState("service token twice", exec(`insert into public_service_tokens
			(token_digest, tenant_id, request_id, token_id, expires_at)
			values ($1, $2, $3, $4, now())`, digest("e"), alta, req, tok), "23505")

		// Slug публичной страницы направления: глобально уникален, формат как у параметра пути.
		dir := uuid.NewString()
		wantOK("slug", exec(`insert into public_service_slugs (slug, tenant_id, direction_id) values ('support', $1, $2)`, lotos, dir))
		wantState("slug of another tenant", exec(`insert into public_service_slugs (slug, tenant_id, direction_id)
			values ('support', $1, $2)`, alta, uuid.NewString()), "23505")
		wantState("second slug of a direction", exec(`insert into public_service_slugs (slug, tenant_id, direction_id)
			values ('help', $1, $2)`, lotos, dir), "23505")
		wantState("slug format", exec(`insert into public_service_slugs (slug, tenant_id, direction_id)
			values ('Bad_Slug', $1, $2)`, alta, uuid.NewString()), "23514")
		wantOK("free slug", exec(`delete from public_service_slugs where slug = 'support'`))
		wantOK("slug for another tenant", exec(`insert into public_service_slugs (slug, tenant_id, direction_id)
			values ('support', $1, $2)`, alta, uuid.NewString()))
	})
}
