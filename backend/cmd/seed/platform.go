package main

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Platform (control DB) part of the seed: design/ortus/mock-data.js baseSeed().platform.

// Dev identity provider issuers (AUTH_PROVIDER=dev, W0.09): subject = prototype account / operator id.
const (
	issuerDev          = "urn:ortus:dev"
	issuerDevOperators = "urn:ortus:dev-operators"
)

type tenantDef struct {
	proto, slug, name, industry, state, reason string
	database                                   string // "" — no tenant DB in the local stand
}

func (t tenantDef) id() uuid.UUID       { return seedID(scopePlatform, t.proto) }
func (t tenantDef) sentinel() uuid.UUID { return seedID(scopePlatform, "sentinel:"+t.proto) }

// Prototype statuses → tenant_state (PLAT-02): restricted → read_only.
var tenants = []tenantDef{
	{proto: protoAlta, slug: "alta", name: "Альта Групп", industry: "logistics", state: "trial", database: "t_alta"},
	{proto: protoLotos, slug: "lotos", name: "SPA «Лотос»", industry: "spa", state: stActive, database: "t_lotos"},
	{
		proto: "t-remstroy", slug: "remstroy", name: "Ремстрой Плюс", industry: "repair", state: "read_only",
		reason: "Пробный период завершён, новые операции ограничены",
	},
	{proto: "t-cargo", slug: "cargo", name: "Карго Сити", industry: "logistics", state: "suspended"},
}

type membershipRef struct {
	tenant, status string
	owner          bool
}

type account struct {
	proto, name, email, protoStatus string
	mfa                             bool
	lastLogin, lockReason           string
	memberships                     []membershipRef
}

func (a account) id() uuid.UUID { return seedID(scopePlatform, a.proto) }

// status maps the prototype account status: pending (invited, never logged in) is an active account.
func (a account) status() string {
	if a.protoStatus == "locked" {
		return "locked"
	}
	return stActive
}

var accounts = []account{
	{"acc-1", "Дарья Зимина", "d.zimina@alta.example", stActive, true, "01.10 09:12", "", []membershipRef{{protoAlta, stActive, true}}},
	{"acc-2", "Марина Котова", "m.kotova@alta.example", stActive, true, "01.10 08:40", "", []membershipRef{{protoAlta, stActive, false}, {"t-cargo", "ended", false}}},
	{"acc-3", "Илья Васильев", "i.vasiliev@alta.example", stActive, false, "01.10 07:55", "", []membershipRef{{protoAlta, stActive, false}}},
	{"acc-4", "Анна Морозова", "a.morozova@alta.example", stActive, false, "30.09 19:05", "", []membershipRef{{protoAlta, stActive, false}, {protoLotos, stActive, false}}},
	{"acc-5", "Алексей Соколов", "a.sokolov@alta.example", stActive, false, "30.09 17:30", "", []membershipRef{{protoAlta, stActive, false}, {"t-remstroy", stActive, false}}},
	{"acc-6", "Олеся Петрова", "o.petrova@alta.example", "pending", false, "", "", []membershipRef{{protoAlta, stInvited, false}}},
	{"acc-7", "Кирилл Громов", "k.gromov@alta.example", stActive, false, "14.09 08:02", "", []membershipRef{{protoAlta, "suspended", false}}},
	{"acc-8", "Вера Котельникова", "v.kotelnikova@alta.example", stActive, true, "01.10 08:58", "", []membershipRef{{protoAlta, stActive, false}}},
	{"acc-9", "Тимур Ахмедов", "t.akhmedov@alta.example", stActive, false, "01.10 06:47", "", []membershipRef{{protoAlta, stActive, false}}},
	{"acc-10", "Сергей Ильин", "s.ilyin@alta.example", "pending", false, "", "", []membershipRef{{protoAlta, stInvited, false}}},
	{"acc-11", "Ирина Белова", "owner@lotos-spa.example", stActive, true, "01.10 10:01", "", []membershipRef{{protoLotos, stActive, true}}},
	{"acc-12", "Павел Орлов", "p.orlov@remstroy.example", stActive, false, "20.09 12:44", "", []membershipRef{{"t-remstroy", stActive, true}}},
	{
		"acc-13", "Денис Шишкин", "d.shishkin@cargo.example", "locked", true, "18.09 23:51",
		"Подозрительные входы из разных стран, 18.09", []membershipRef{{"t-cargo", stActive, true}},
	},
}

type operator struct {
	proto, name, email, role, status string
	mfa                              bool
	lastLogin, disabledOn            string
}

func (o operator) id() uuid.UUID        { return seedID(scopePlatform, o.proto) }
func (o operator) accountID() uuid.UUID { return seedID(scopePlatform, "account:"+o.proto) }

// Operators of «Ортус · Платформа» (separate realm ortus-operators, control_0001_init.sql:115).
var operators = []operator{
	{"op-1", "Евгения Лаптева", "e.lapteva@ortus.example", "owner", stActive, true, "02.10 09:05", ""},
	{"op-2", "Михаил Сорокин", "m.sorokin@ortus.example", "owner", stActive, true, "01.10 18:22", ""},
	{"op-3", "Алёна Гусева", "a.guseva@ortus.example", "billing", stActive, true, "02.10 08:40", ""},
	{"op-4", "Игорь Пахомов", "i.pakhomov@ortus.example", "support", stActive, true, "02.10 07:58", ""},
	{"op-5", "Дина Валиева", "d.valieva@ortus.example", "support", stInvited, false, "", ""},
	{"op-6", "Станислав Рябов", "s.ryabov@ortus.example", "admin", "disabled", true, "12.08 17:10", "15.08 00:00"},
}

// membership links an account to a member of a tenant that has a database in the stand.
type membership struct {
	tenant, member, status string
	owner                  bool
	account                account
}

func (m membership) id() uuid.UUID {
	return seedID(scopePlatform, "membership:"+m.tenant+":"+m.account.proto)
}
func (m membership) ownerID() uuid.UUID {
	return seedID(scopePlatform, "owner:"+m.tenant+":"+m.account.proto)
}

// personID is the person profile of the membership in its tenant DB.
func (m membership) personID() uuid.UUID { return seedID(m.tenant, m.member) }

// memberships returns the memberships of tenants with a database; the member is found by e-mail.
func memberships() []membership {
	var out []membership
	for _, a := range accounts {
		for _, ref := range a.memberships {
			td, ok := tenantDataOf(ref.tenant)
			if !ok {
				continue
			}
			for _, m := range td.members {
				if m.email == a.email {
					out = append(out, membership{tenant: ref.tenant, member: m.proto, status: ref.status, owner: ref.owner, account: a})
				}
			}
		}
	}
	return out
}

// seedPlatform writes the control DB rows in one transaction; existing rows are kept (on conflict do nothing).
func seedPlatform(ctx context.Context, db *sql.DB) (err error) {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("platform: %w", err)
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()
	steps := []func(context.Context, *sql.Tx) error{seedTenants, seedAccounts, seedOperators, seedMemberships}
	for _, step := range steps {
		if err = step(ctx, tx); err != nil {
			return fmt.Errorf("platform: %w", err)
		}
	}
	return tx.Commit()
}

// tenantSecretRef is tenant_routing.secret_ref of the local stand: the variable TENANT_DB_URL holds the DSN of the
// runtime role ortus_api; the API pool (W0.09) replaces its path with database_name (migrations.TenantDSN).
// Migrator credentials (DDL) never go to secret_ref: cmd/migrate derives tenant DSNs from MIGRATOR_DB_URL.
// A re-run repairs stands seeded with the old reference.
const tenantSecretRef = "env:TENANT_DB_URL" //nolint:gosec // G101: a variable name, not a credential

func seedTenants(ctx context.Context, tx *sql.Tx) error {
	for _, t := range tenants {
		if _, err := tx.ExecContext(ctx, `
insert into tenants (id, slug, display_name, industry_pack, state, state_reason)
values ($1, $2, $3, $4, $5::tenant_state, nullif($6, ''))
on conflict (id) do nothing`, t.id(), t.slug, t.name, t.industry, t.state, t.reason); err != nil {
			return fmt.Errorf("tenant %s: %w", t.proto, err)
		}
		if t.database == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
insert into tenant_routing (tenant_id, cluster_ref, database_name, secret_ref, sentinel)
values ($1, 'local', $2, $4, $3)
on conflict (tenant_id) do update set secret_ref = excluded.secret_ref`, t.id(), t.database, t.sentinel(), tenantSecretRef); err != nil {
			return fmt.Errorf("tenant_routing %s: %w", t.proto, err)
		}
	}
	return nil
}

func seedAccounts(ctx context.Context, tx *sql.Tx) error {
	for _, a := range accounts {
		var lockedAt *time.Time
		if a.lockReason != "" {
			lockedAt = protoTime(a.lastLogin)
		}
		if _, err := tx.ExecContext(ctx, `
insert into accounts (id, issuer, subject, email_norm, display_name, status, mfa_enabled, last_login_at, locked_at, lock_reason)
values ($1, $2, $3, $4, $5, $6, $7, $8, $9, nullif($10, ''))
on conflict (id) do nothing`,
			a.id(), issuerDev, a.proto, a.email, a.name, a.status(), a.mfa, protoTime(a.lastLogin), lockedAt, a.lockReason,
		); err != nil {
			return fmt.Errorf("account %s: %w", a.proto, err)
		}
	}
	return nil
}

func seedOperators(ctx context.Context, tx *sql.Tx) error {
	for _, o := range operators {
		if _, err := tx.ExecContext(ctx, `
insert into accounts (id, issuer, subject, email_norm, display_name, status, mfa_enabled, last_login_at)
values ($1, $2, $3, $4, $5, 'active', $6, $7)
on conflict (id) do nothing`, o.accountID(), issuerDevOperators, o.proto, o.email, o.name, o.mfa, protoTime(o.lastLogin)); err != nil {
			return fmt.Errorf("operator account %s: %w", o.proto, err)
		}
		if _, err := tx.ExecContext(ctx, `
insert into platform_operators (id, account_id, role, status, disabled_at)
values ($1, $2, $3, $4, $5)
on conflict (id) do nothing`, o.id(), o.accountID(), o.role, o.status, protoTime(o.disabledOn)); err != nil {
			return fmt.Errorf("operator %s: %w", o.proto, err)
		}
	}
	return nil
}

func seedMemberships(ctx context.Context, tx *sql.Tx) error {
	for _, m := range memberships() {
		tenantID := seedID(scopePlatform, m.tenant)
		if _, err := tx.ExecContext(ctx, `
insert into memberships (id, tenant_id, account_id, status, person_profile_id)
values ($1, $2, $3, $4::membership_status, $5)
on conflict (id) do nothing`, m.id(), tenantID, m.account.id(), m.status, m.personID()); err != nil {
			return fmt.Errorf("membership %s@%s: %w", m.account.proto, m.tenant, err)
		}
		if !m.owner {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
insert into owner_bindings (id, tenant_id, membership_id)
values ($1, $2, $3)
on conflict (id) do nothing`, m.ownerID(), tenantID, m.id()); err != nil {
			return fmt.Errorf("owner %s@%s: %w", m.account.proto, m.tenant, err)
		}
	}
	return nil
}
