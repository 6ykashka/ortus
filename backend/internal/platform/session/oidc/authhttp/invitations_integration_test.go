//go:build integration

package authhttp_test

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	authapi "github.com/ortus/ortus-crm/backend/internal/api/auth"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/invitations"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// T-06 of the brief W1.03: S1-06 «token → e-mail check → membership active» on a control DB and a tenant DB
// (testcontainers, role ortus_api). The service lives in modules/access/invitations; its integration tests live here,
// next to the Auth server that calls it, because depguard keeps modules away from backend/migrations (test helpers
// included).

var cluster *migratetest.Cluster

func TestMain(m *testing.M) {
	c, stop, err := migratetest.Start(context.Background(), migratetest.Images()[0])
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	cluster = c
	code := m.Run()
	stop()
	os.Exit(code)
}

// pool migrates a new database of kind k and opens it as ortus_api; name is the database (for a superuser fault).
func pool(t *testing.T, k migrations.Kind) (p *pgxpool.Pool, name string) {
	t.Helper()
	name = cluster.NewDatabase(t, string(k))
	if _, err := migrations.Up(t.Context(), cluster.DB(t, name, migrations.RoleMigrator), k); err != nil {
		t.Fatalf("migrate %s: %v", k, err)
	}
	p, err := pgxpool.New(t.Context(), cluster.URL(name, migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(p.Close)
	return p, name
}

type tenantPools map[uuid.UUID]*pgxpool.Pool

func (f tenantPools) For(_ context.Context, id uuid.UUID) (*pgxpool.Pool, error) {
	if p, ok := f[id]; ok {
		return p, nil
	}
	return nil, errors.New("no pool")
}

// world is one control DB with one tenant «Альта Групп» and its tenant DB.
type world struct {
	t           *testing.T
	control     *pgxpool.Pool
	controlName string
	tenant      *pgxpool.Pool
	tenantID,
	unit, role uuid.UUID
	inviter uuid.UUID                 // membership of the owner who invites, created on first use
	grants  map[uuid.UUID][]uuid.UUID // dormant assignments of the invitation, by profile
	svc     *invitations.Service
}

func newWorld(t *testing.T) *world {
	t.Helper()
	w := &world{t: t, tenantID: uuid.New(), unit: uuid.New(), role: uuid.New(), grants: map[uuid.UUID][]uuid.UUID{}}
	w.control, w.controlName = pool(t, migrations.Control)
	w.tenant, _ = pool(t, migrations.Tenant)
	w.ctl(`insert into tenants (id, slug, display_name, industry_pack, state) values ($1, $2, 'Альта Групп', 'logistics', 'active')`,
		w.tenantID, "alta-"+w.tenantID.String()[:6])
	w.tdb(`insert into org.units (id, kind, name, time_zone) values ($1, 'company', 'Альта Групп', 'Europe/Moscow')`, w.unit)
	w.tdb(`insert into access.policy_state (singleton, policy_version) values (true, 7)`)
	w.tdb(`insert into access.roles (id, name, kind) values ($1, 'Диспетчер', 'custom')`, w.role)
	w.tdb(`insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, '{members.read}', $1)`, w.role)
	w.svc = &invitations.Service{Control: w.control, Tenants: tenantPools{w.tenantID: w.tenant}}
	return w
}

func (w *world) ctl(sql string, args ...any) {
	w.t.Helper()
	if _, err := w.control.Exec(w.t.Context(), sql, args...); err != nil {
		w.t.Fatalf("control: %s: %v", sql, err)
	}
}

func (w *world) tdb(sql string, args ...any) {
	w.t.Helper()
	if _, err := w.tenant.Exec(w.t.Context(), sql, args...); err != nil {
		w.t.Fatalf("tenant: %s: %v", sql, err)
	}
}

func (w *world) scalar(db *pgxpool.Pool, sql string, args ...any) any {
	w.t.Helper()
	var v any
	if err := db.QueryRow(w.t.Context(), sql, args...).Scan(&v); err != nil {
		w.t.Fatalf("%s: %v", sql, err)
	}
	return v
}

func (w *world) account(email, name string) uuid.UUID {
	w.t.Helper()
	id := uuid.New()
	w.ctl(`insert into accounts (id, issuer, subject, email_norm, display_name) values ($1, 'http://idp.test/realms/ortus', $2, $3, $4)`,
		id, id.String(), email, name)
	return id
}

// profile creates a person profile (membership not linked yet) with one dormant assignment of the invitation.
func (w *world) profile(fullName, email string) uuid.UUID {
	w.t.Helper()
	id := uuid.New()
	w.tdb(`insert into people.person_profiles (id, full_name, email, home_unit_id) values ($1, $2, $3, $4)`, id, fullName, email, w.unit)
	w.grants[id] = append(w.grants[id], w.assignment(id, "tstzrange(now(), null)"))
	return id
}

// assignment adds a dormant tenant-wide assignment of the role to person, valid in the range expression valid.
func (w *world) assignment(person uuid.UUID, valid string) uuid.UUID {
	w.t.Helper()
	var id uuid.UUID
	err := w.tenant.QueryRow(w.t.Context(), `insert into access.role_assignments
		(principal_kind, principal_id, role_id, role_version, scope_kind, state, granted_by, valid)
		values ('person', $1, $2, 1, 'tenant', 'dormant', $1, `+valid+`) returning id`, person, w.role).Scan(&id)
	if err != nil {
		w.t.Fatalf("assignment: %v", err)
	}
	return id
}

// invite issues an invitation like inviteMember (W1.06) or the owner invitation, and returns its token.
func (w *world) invite(email string, person uuid.UUID, owner bool) string {
	w.t.Helper()
	ctx := w.t.Context()
	tx, err := w.control.Begin(ctx)
	if err != nil {
		w.t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(ctx) }()
	d := invitations.Draft{TenantID: w.tenantID, PersonProfileID: person, Email: email, Owner: owner, RoleAssignmentIDs: w.grants[person]}
	if !owner {
		creator := w.creator()
		d.CreatedBy = &creator
	}
	token, _, err := invitations.Issue(ctx, tx, d)
	if err != nil {
		w.t.Fatal(err)
	}
	if err := tx.Commit(ctx); err != nil {
		w.t.Fatal(err)
	}
	return token
}

// creator is the active membership of the owner who invites (one per business: it takes one seat).
func (w *world) creator() uuid.UUID {
	w.t.Helper()
	if w.inviter != uuid.Nil {
		return w.inviter
	}
	acc := w.account(uuid.NewString()+"@alta.example", "Владелец")
	w.inviter = uuid.New()
	w.ctl(`insert into memberships (id, tenant_id, account_id, status, person_profile_id) values ($1, $2, $3, 'active', gen_random_uuid())`,
		w.inviter, w.tenantID, acc)
	return w.inviter
}

func expectCode(t *testing.T, err error, code string) {
	t.Helper()
	if !problem.Is(err, code) {
		t.Errorf("err = %v, want %s", err, code)
	}
}

func TestIssueStoresOnlyTheHash(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	token := w.invite("o.petrova@alta.example", w.profile("Олеся Петрова", "o.petrova@alta.example"), false)
	if len(token) < 32 {
		t.Fatalf("token %q: want at least 32 characters (InvitationToken)", token)
	}
	if n := w.scalar(w.control, `select count(*) from invitations where token_hash = $1`, invitations.HashToken(token)); n != int64(1) {
		t.Fatalf("rows by hash: %v", n)
	}
	exp := w.scalar(w.control, `select expires_at - created_at from invitations where token_hash = $1`, invitations.HashToken(token))
	if fmt.Sprint(exp) == "" {
		t.Fatal("no expiry")
	}
}

func TestInspect(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	token := w.invite("o.petrova@alta.example", w.profile("Олеся Петрова", "o.petrova@alta.example"), false)
	got, err := w.svc.Inspect(ctx, token)
	if err != nil {
		t.Fatal(err)
	}
	if got.TenantName != "Альта Групп" || got.InvitedEmailMasked != "o•••••@alta.example" || got.Status != authapi.Pending ||
		time.Until(got.ExpiresAt) < 6*24*time.Hour {
		t.Fatalf("preview %+v", got)
	}
	_, err = w.svc.Inspect(ctx, "unknown-token-0000000000000000000000")
	expectCode(t, err, problem.CodeNotFound)
	for status, sql := range map[authapi.InvitationPreviewStatus]string{
		authapi.Revoked: `update invitations set revoked_at = now() where token_hash = $1`,
		authapi.Expired: `update invitations set revoked_at = null, created_at = now() - interval '9 days', expires_at = now() - interval '1 day' where token_hash = $1`,
	} {
		w.ctl(sql, invitations.HashToken(token))
		if got, err := w.svc.Inspect(ctx, token); err != nil || got.Status != status {
			t.Errorf("%s: %+v, %v", status, got, err)
		}
	}
	w.ctl(`update tenants set state = 'provisioning' where id = $1`, w.tenantID)
	_, err = w.svc.Inspect(ctx, token)
	expectCode(t, err, problem.CodeNotFound)
}

// S1-06: the invited person accepts — profile linked, dormant assignments active, policy version bumped, audit;
// membership active, invitation accepted, the business remembered as lastTenantId.
func TestAcceptCreatesMembership(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	person := w.profile("Олеся Петрова", "o.petrova@alta.example")
	token := w.invite("o.petrova@alta.example", person, false)
	acc := w.account("o.petrova@alta.example", "Олеся Петрова")
	res, err := w.svc.Accept(ctx, acc, token)
	if err != nil {
		t.Fatal(err)
	}
	if res.TenantId != w.tenantID || res.TenantName != "Альта Групп" || res.MembershipStatus != authapi.Active {
		t.Fatalf("result %+v", res)
	}
	checks := []struct {
		db   *pgxpool.Pool
		sql  string
		args []any
		want any
	}{
		{w.control, `select count(*) from memberships where id = $1 and account_id = $2 and status = 'active' and person_profile_id = $3`,
			[]any{res.MembershipId, acc, person}, int64(1)},
		{w.control, `select count(*) from invitations where accepted_account = $1 and accepted_at is not null`, []any{acc}, int64(1)},
		{w.control, `select last_tenant_id = $2 from accounts where id = $1`, []any{acc, w.tenantID}, true},
		{w.control, `select count(*) from owner_bindings where membership_id = $1`, []any{res.MembershipId}, int64(0)},
		{w.tenant, `select membership_id = $2 from people.person_profiles where id = $1`, []any{person, res.MembershipId}, true},
		{w.tenant, `select count(*) from access.role_assignments where principal_id = $1 and state = 'active'`, []any{person}, int64(1)},
		{w.tenant, `select policy_version from access.policy_state`, nil, int64(8)},
		{w.tenant, `select count(*) from audit.events where action = 'access.invitation.accept' and target_id = $1`, []any{person}, int64(1)},
	}
	for _, c := range checks {
		if got := w.scalar(c.db, c.sql, c.args...); got != c.want {
			t.Errorf("%s = %v, want %v", c.sql, got, c.want)
		}
	}
	// A repeat without the idempotency replay: the invitation is no longer pending.
	_, err = w.svc.Accept(ctx, acc, token)
	expectCode(t, err, "invalid_transition")
}

// The owner invitation of a new business (W1.02: provisioner, profile named by the e-mail) makes an owner.
func TestAcceptOwnerInvitation(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	person := w.profile("owner@new.example", "owner@new.example")
	token := w.invite("Owner@New.Example", person, true)
	acc := w.account("owner@new.example", "Ирина Белова")
	res, err := w.svc.Accept(t.Context(), acc, token)
	if err != nil {
		t.Fatal(err)
	}
	if n := w.scalar(w.control, `select count(*) from owner_bindings where membership_id = $1 and revoked_at is null`, res.MembershipId); n != int64(1) {
		t.Errorf("owner bindings: %v, want 1", n)
	}
	if name := w.scalar(w.tenant, `select full_name from people.person_profiles where id = $1`, person); name != "Ирина Белова" {
		t.Errorf("full name %v: the e-mail placeholder takes the name of the account", name)
	}
}

// An invited membership already in the business (seed, earlier invitation) is activated, not duplicated, and takes
// the account that signed in.
func TestAcceptActivatesInvitedMembership(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	person := w.profile("Олеся Петрова", "o.petrova@alta.example")
	// The invited membership belongs to another account (seed placeholder, another e-mail).
	placeholder := w.account("petrova.dev@alta.example", "Олеся Петрова (dev)")
	invited := uuid.New()
	w.ctl(`insert into memberships (id, tenant_id, account_id, status, person_profile_id) values ($1, $2, $3, 'invited', $4)`,
		invited, w.tenantID, placeholder, person)
	token := w.invite("o.petrova@alta.example", person, false)
	acc := w.account("o.petrova@alta.example", "Олеся Петрова")
	res, err := w.svc.Accept(t.Context(), acc, token)
	if err != nil {
		t.Fatal(err)
	}
	if res.MembershipId != invited {
		t.Fatalf("membership %s, want the invited one %s", res.MembershipId, invited)
	}
	if n := w.scalar(w.control, `select count(*) from memberships where tenant_id = $1 and person_profile_id = $2`, w.tenantID, person); n != int64(1) {
		t.Fatalf("memberships of the profile: %v", n)
	}
	if got := w.scalar(w.control, `select account_id = $2 and status = 'active' from memberships where id = $1`, invited, acc); got != true {
		t.Fatal("the invited membership must be active and belong to the signed-in account")
	}
	if n := w.scalar(w.control, `select count(*) from memberships where account_id = $1`, placeholder); n != int64(0) {
		t.Fatalf("the placeholder account keeps %v memberships, want 0", n)
	}
}

// Acceptance activates only the dormant assignments the invitation names, still valid and of the invited profile.
// Other dormant assignments of the profile (A-09: grants of a disabled module) stay dormant (review W1.03, return 1).
func TestAcceptActivatesOnlyInvitationAssignments(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	person := w.profile("Олеся Петрова", "o.petrova@alta.example")
	granted := w.grants[person][0]
	disabledModule := w.assignment(person, "tstzrange(now(), null)") // not named by the invitation
	expired := w.assignment(person, "tstzrange(now() - interval '2 days', now() - interval '1 day')")
	other := w.profile("Сергей Ильин", "s.ilyin@alta.example")
	w.grants[person] = append(w.grants[person], expired, w.grants[other][0]) // named, but expired or someone else's
	token := w.invite("o.petrova@alta.example", person, false)
	acc := w.account("o.petrova@alta.example", "Олеся Петрова")
	if _, err := w.svc.Accept(t.Context(), acc, token); err != nil {
		t.Fatal(err)
	}
	for id, want := range map[uuid.UUID]string{
		granted: "active", disabledModule: "dormant", expired: "dormant", w.grants[other][0]: "dormant",
	} {
		if got := w.scalar(w.tenant, `select state from access.role_assignments where id = $1`, id); got != want {
			t.Errorf("assignment %s: %v, want %s", id, got, want)
		}
	}
}

func TestAcceptRefusals(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	invite := func(email string) string { return w.invite(email, w.profile(email, email), false) }
	acc := w.account("o.petrova@alta.example", "Олеся Петрова")

	_, err := w.svc.Accept(ctx, acc, "unknown-token-0000000000000000000000")
	expectCode(t, err, problem.CodeNotFound)

	_, err = w.svc.Accept(ctx, acc, invite("s.ilyin@alta.example"))
	expectCode(t, err, problem.CodeForbiddenAction) // someone else's invitation

	revoked := invite("o.petrova@alta.example")
	w.ctl(`update invitations set revoked_at = now() where token_hash = $1`, invitations.HashToken(revoked))
	_, err = w.svc.Accept(ctx, acc, revoked)
	expectCode(t, err, "invalid_transition")

	expired := invite("o.petrova@alta.example")
	w.ctl(`update invitations set created_at = now() - interval '9 days', expires_at = now() - interval '1 day' where token_hash = $1`,
		invitations.HashToken(expired))
	_, err = w.svc.Accept(ctx, acc, expired)
	expectCode(t, err, "public_token_expired")

	pending := invite("o.petrova@alta.example")
	w.ctl(`update tenants set state = 'suspended' where id = $1`, w.tenantID)
	_, err = w.svc.Accept(ctx, acc, pending)
	expectCode(t, err, problem.CodeTenantSuspended)
	w.ctl(`update tenants set state = 'read_only' where id = $1`, w.tenantID)
	_, err = w.svc.Accept(ctx, acc, pending)
	expectCode(t, err, problem.CodeTenantReadOnly)
	w.ctl(`update tenants set state = 'closed' where id = $1`, w.tenantID)
	_, err = w.svc.Accept(ctx, acc, pending)
	expectCode(t, err, problem.CodeNotFound)
	if n := w.scalar(w.control, `select count(*) from memberships where account_id = $1`, acc); n != int64(0) {
		t.Fatalf("a refused acceptance created %v memberships", n)
	}
}

// No free seat: 409 seats_exhausted, nothing changes in either database.
func TestAcceptSeatsExhausted(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	w.creator() // one active membership
	w.seatLimit(1)
	person := w.profile("Олеся Петрова", "o.petrova@alta.example")
	token := w.invite("o.petrova@alta.example", person, false)
	acc := w.account("o.petrova@alta.example", "Олеся Петрова")
	_, err := w.svc.Accept(t.Context(), acc, token)
	expectCode(t, err, "seats_exhausted")
	if got := w.scalar(w.tenant, `select membership_id is null from people.person_profiles where id = $1`, person); got != true {
		t.Fatal("the tenant DB changed on a refused acceptance")
	}
}

// seatLimit puts the entitlement seats of the business in effect.
func (w *world) seatLimit(n int) {
	w.t.Helper()
	w.ctl(`insert into entitlements (tenant_id, feature_key, source_type, limit_value, limit_unit, effective, version, reason, actor_id)
		values ($1, 'seats', 'trial', $2, 'seats', tstzrange(now() - interval '1 day', null), 1, 'trial', gen_random_uuid())`, w.tenantID, n)
}

// unchanged checks that a refused acceptance left both databases as they were: the membership of the account (if
// any) in its status, the invitation pending, the profile unlinked, its assignment dormant, the policy version 7.
func (w *world) unchanged(acc, person uuid.UUID, token, membership string) {
	w.t.Helper()
	checks := []struct {
		db   *pgxpool.Pool
		sql  string
		args []any
		want any
	}{
		{w.control, `select coalesce(string_agg(status::text, ','), '') from memberships where account_id = $1`, []any{acc}, membership},
		{w.control, `select accepted_at is null from invitations where token_hash = $1`, []any{invitations.HashToken(token)}, true},
		{w.tenant, `select membership_id is null from people.person_profiles where id = $1`, []any{person}, true},
		{w.tenant, `select count(*) from access.role_assignments where principal_id = $1 and state = 'dormant'`, []any{person}, int64(1)},
		{w.tenant, `select policy_version from access.policy_state`, nil, int64(7)},
	}
	for _, c := range checks {
		if got := w.scalar(c.db, c.sql, c.args...); got != c.want {
			w.t.Errorf("%s = %v, want %v", c.sql, got, c.want)
		}
	}
}

// A former member (membership ended) takes a seat again: tenant_seat_usage counts only active and invited
// memberships, so the reactivation is checked against the limit like a new membership (review W1.03, return 1).
func TestAcceptEndedMemberTakesASeat(t *testing.T) {
	t.Parallel()
	for _, tt := range []struct {
		name  string
		limit int
		ok    bool
	}{
		{name: "no free seat: 409 seats_exhausted, both databases unchanged", limit: 1},
		{name: "free seat: the ended membership is reactivated", limit: 2, ok: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			w := newWorld(t)
			w.creator() // the first seat
			w.seatLimit(tt.limit)
			acc := w.account("o.petrova@alta.example", "Олеся Петрова")
			ended := uuid.New()
			w.ctl(`insert into memberships (id, tenant_id, account_id, status, person_profile_id, ended_at)
				values ($1, $2, $3, 'ended', gen_random_uuid(), now() - interval '30 days')`, ended, w.tenantID, acc)
			person := w.profile("Олеся Петрова", "o.petrova@alta.example")
			token := w.invite("o.petrova@alta.example", person, false)
			res, err := w.svc.Accept(t.Context(), acc, token)
			if !tt.ok {
				expectCode(t, err, "seats_exhausted")
				w.unchanged(acc, person, token, "ended")
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if res.MembershipId != ended {
				t.Fatalf("membership %s, want the ended one %s reactivated", res.MembershipId, ended)
			}
			if got := w.scalar(w.control, `select status = 'active' and ended_at is null and person_profile_id = $2 from memberships
				where id = $1`, ended, person); got != true {
				t.Fatal("the ended membership must be active, without ended_at, with the invited profile")
			}
			if n := w.scalar(w.control, `select seats_used from tenant_seat_usage where tenant_id = $1`, w.tenantID); n != int32(2) {
				t.Fatalf("seats used %v, want 2", n)
			}
		})
	}
}

// blocked waits until n sessions of this test's control DB wait on a lock. pg_locks is cluster-wide and the other
// tests of the package run in parallel on their own databases, so the waiters are counted by the database of their
// session (pg_stat_activity), not by pg_locks.database: a row lock is awaited as a transactionid lock, which has none.
// A test that never sees its n waiters fails instead of silently not reproducing its race (review W1.03, return 2).
func (w *world) blocked(n int) {
	w.t.Helper()
	const waiting = `select count(*) from pg_locks l join pg_stat_activity a on a.pid = l.pid
 where not l.granted and a.datname = current_database()`
	deadline := time.Now().Add(10 * time.Second)
	for {
		got := w.scalar(w.control, waiting)
		if got == int64(n) {
			return
		}
		if time.Now().After(deadline) {
			w.t.Errorf("%v sessions of the control DB wait on a lock, want %d", got, n)
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// acceptHeld accepts tokens for acc at the same time: the business is held (FOR UPDATE of its tenants row) until
// every acceptance waits on a lock, then released. It returns the error of each acceptance.
func (w *world) acceptHeld(acc uuid.UUID, tokens []string) []error {
	w.t.Helper()
	ctx := w.t.Context()
	hold, err := w.control.Begin(ctx)
	if err != nil {
		w.t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(ctx) }()
	if _, err := hold.Exec(ctx, `select id from tenants where id = $1 for update`, w.tenantID); err != nil {
		w.t.Fatal(err)
	}
	errs := make([]error, len(tokens))
	var wg sync.WaitGroup
	for i, token := range tokens {
		wg.Go(func() { _, errs[i] = w.svc.Accept(ctx, acc, token) })
	}
	w.blocked(len(tokens))
	if err := hold.Rollback(ctx); err != nil {
		w.t.Fatal(err)
	}
	wg.Wait()
	return errs
}

// Two different invitations of one account into one business, accepted at the same time: the acceptances are
// serialised by the business (FOR UPDATE of tenants before the membership lookup), the second sees the membership of
// the first — 409 invalid_transition, and its profile in the tenant DB stays untouched (review W1.03, return 1).
func TestAcceptTwoInvitationsOfOneAccountConcurrently(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	people := []uuid.UUID{w.profile("Олеся Петрова", "o.petrova@alta.example"), w.profile("Олеся Петрова", "o.petrova@alta.example")}
	tokens := []string{w.invite("o.petrova@alta.example", people[0], false), w.invite("o.petrova@alta.example", people[1], false)}
	acc := w.account("o.petrova@alta.example", "Олеся Петрова")
	errs := w.acceptHeld(acc, tokens)

	won := -1
	for i, err := range errs {
		switch {
		case err == nil && won < 0:
			won = i
		case !problem.Is(err, "invalid_transition"):
			t.Errorf("acceptance %d: %v, want one success and one invalid_transition", i, err)
		}
	}
	if won < 0 {
		t.Fatalf("no acceptance succeeded: %v", errs)
	}
	lost := people[1-won]
	if got := w.scalar(w.tenant, `select membership_id is null from people.person_profiles where id = $1`, lost); got != true {
		t.Error("the refused invitation linked its profile in the tenant DB")
	}
	if n := w.scalar(w.tenant, `select count(*) from access.role_assignments where principal_id = $1 and state = 'dormant'`, lost); n != int64(1) {
		t.Errorf("dormant assignments of the refused profile: %v, want 1", n)
	}
	if v := w.scalar(w.tenant, `select policy_version from access.policy_state`); v != int64(8) {
		t.Errorf("policy version %v, want 8 (one acceptance)", v)
	}
	if n := w.scalar(w.control, `select count(*) from memberships where account_id = $1 and status = 'active'`, acc); n != int64(1) {
		t.Errorf("active memberships of the account: %v, want 1", n)
	}
}

// The tenant DB commits, the control DB commit fails (deferred fault): the client gets 503, the invitation stays
// pending, and a repeat of the acceptance completes it — the tenant statements are idempotent (review W1.03, return 1).
func TestAcceptRetryAfterControlCommitFails(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	person := w.profile("Олеся Петрова", "o.petrova@alta.example")
	token := w.invite("o.petrova@alta.example", person, false)
	acc := w.account("o.petrova@alta.example", "Олеся Петрова")
	super := cluster.DB(t, w.controlName, migratetest.Super)
	for _, sql := range []string{
		`create function fail_commit() returns trigger language plpgsql as $$ begin raise exception 'control commit fails'; end $$`,
		`create constraint trigger fail_commit after update on invitations deferrable initially deferred
			for each row execute function fail_commit()`,
	} {
		if _, err := super.ExecContext(ctx, sql); err != nil {
			t.Fatalf("%s: %v", sql, err)
		}
	}
	_, err := w.svc.Accept(ctx, acc, token)
	expectCode(t, err, problem.CodeDependencyUnavailable)
	if n := w.scalar(w.control, `select count(*) from memberships where account_id = $1`, acc); n != int64(0) {
		t.Fatalf("memberships after the failed commit: %v, want 0", n)
	}
	if got := w.scalar(w.control, `select accepted_at is null from invitations where token_hash = $1`, invitations.HashToken(token)); got != true {
		t.Fatal("the invitation must stay pending after the failed commit")
	}
	if _, err := super.ExecContext(ctx, `drop trigger fail_commit on invitations`); err != nil {
		t.Fatal(err)
	}

	res, err := w.svc.Accept(ctx, acc, token)
	if err != nil {
		t.Fatalf("repeat: %v", err)
	}
	checks := []struct {
		db   *pgxpool.Pool
		sql  string
		args []any
		want any
	}{
		{w.control, `select count(*) from memberships where account_id = $1 and status = 'active' and id = $2`, []any{acc, res.MembershipId}, int64(1)},
		{w.tenant, `select membership_id = $2 from people.person_profiles where id = $1`, []any{person, res.MembershipId}, true},
		{w.tenant, `select count(*) from access.role_assignments where principal_id = $1 and state = 'active'`, []any{person}, int64(1)},
		// Each attempt is a policy change and an audit record of its own: the first one did change the tenant DB.
		{w.tenant, `select policy_version from access.policy_state`, nil, int64(9)},
		{w.tenant, `select count(*) from audit.events where action = 'access.invitation.accept' and target_id = $1`, []any{person}, int64(2)},
	}
	for _, c := range checks {
		if got := w.scalar(c.db, c.sql, c.args...); got != c.want {
			t.Errorf("%s = %v, want %v", c.sql, got, c.want)
		}
	}
}

// An active member of the business cannot accept a second invitation into it.
func TestAcceptByActiveMember(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	acc := w.account("o.petrova@alta.example", "Олеся Петрова")
	w.ctl(`insert into memberships (tenant_id, account_id, status, person_profile_id) values ($1, $2, 'active', gen_random_uuid())`, w.tenantID, acc)
	token := w.invite("o.petrova@alta.example", w.profile("Олеся Петрова", "o.petrova@alta.example"), false)
	_, err := w.svc.Accept(t.Context(), acc, token)
	expectCode(t, err, "invalid_transition")
}

// Two concurrent acceptances of one invitation: exactly one wins (FOR UPDATE of the invitation).
func TestAcceptConcurrent(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	token := w.invite("o.petrova@alta.example", w.profile("Олеся Петрова", "o.petrova@alta.example"), false)
	acc := w.account("o.petrova@alta.example", "Олеся Петрова")
	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		errs []error
	)
	for range 4 {
		wg.Go(func() {
			_, err := w.svc.Accept(t.Context(), acc, token)
			mu.Lock()
			errs = append(errs, err)
			mu.Unlock()
		})
	}
	wg.Wait()
	ok := 0
	for _, err := range errs {
		switch {
		case err == nil:
			ok++
		case !problem.Is(err, "invalid_transition"):
			t.Errorf("unexpected error %v", err)
		}
	}
	if ok != 1 {
		t.Fatalf("%d acceptances succeeded, want 1", ok)
	}
}

// rawInvite stores a pending invitation of person bypassing Issue and its refusals, as data written by another path
// (seed, a W1.06 bug) would be, and returns its token.
func (w *world) rawInvite(email string, person uuid.UUID) string {
	w.t.Helper()
	token := strings.ReplaceAll(uuid.NewString()+uuid.NewString(), "-", "")
	w.ctl(`insert into invitations (tenant_id, email_norm, token_hash, person_profile_id, created_by, expires_at, role_assignment_ids)
		values ($1, $2, $3, $4, $5, now() + interval '7 days', $6)`,
		w.tenantID, email, invitations.HashToken(token), person, w.creator(), w.grants[person])
	return token
}

// One person profile, one live membership: a second invitation of a profile that is already an active or suspended
// member of another account (re-invitation to a corrected e-mail without revoking the first one) is refused with
// 409 invalid_transition, and neither database changes — otherwise two accounts act as one person with its grants
// (review W1.03, return 2, major).
func TestAcceptProfileOfAnotherMember(t *testing.T) {
	t.Parallel()
	for _, status := range []string{"active", "suspended"} {
		t.Run(status, func(t *testing.T) {
			t.Parallel()
			w := newWorld(t)
			ctx := t.Context()
			person := w.profile("Олеся Петрова", "o.petrova@alta.example")
			first := w.account("o.petrova@alta.example", "Олеся Петрова")
			res, err := w.svc.Accept(ctx, first, w.invite("o.petrova@alta.example", person, false))
			if err != nil {
				t.Fatal(err)
			}
			w.ctl(`update memberships set status = $2 where id = $1`, res.MembershipId, status)
			second := w.account("olesya@gmail.example", "Олеся П.")
			_, err = w.svc.Accept(ctx, second, w.rawInvite("olesya@gmail.example", person))
			expectCode(t, err, "invalid_transition")
			if n := w.scalar(w.control, `select count(*) from memberships where account_id = $1`, second); n != int64(0) {
				t.Errorf("memberships of the second account: %v, want 0", n)
			}
			if got := w.scalar(w.tenant, `select membership_id = $2 from people.person_profiles where id = $1`, person, res.MembershipId); got != true {
				t.Error("the profile must stay linked to the membership of the first account")
			}
			if v := w.scalar(w.tenant, `select policy_version from access.policy_state`); v != int64(8) {
				t.Errorf("policy version %v, want 8 (only the first acceptance)", v)
			}
		})
	}
}

// Issue refuses a profile that already has a pending invitation or a live membership in the business (W1.06 revokes
// the old invitation in the same transaction first); a revoked or expired invitation and an invited membership of the
// profile (seed placeholder) do not block it (review W1.03, return 2).
func TestIssueRefusesBusyProfile(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	issue := func(person uuid.UUID, email string) error {
		creator := w.creator()
		_, _, err := invitations.Issue(ctx, w.control, invitations.Draft{
			TenantID: w.tenantID, PersonProfileID: person, Email: email, CreatedBy: &creator, RoleAssignmentIDs: w.grants[person],
		})
		return err
	}
	person := w.profile("Олеся Петрова", "o.petrova@alta.example")
	placeholder := w.account("petrova.dev@alta.example", "Олеся Петрова (dev)")
	w.ctl(`insert into memberships (tenant_id, account_id, status, person_profile_id) values ($1, $2, 'invited', $3)`,
		w.tenantID, placeholder, person)
	token := w.invite("o.petrova@alta.example", person, false) // an invited membership does not block
	if err := issue(person, "olesya@gmail.example"); !errors.Is(err, invitations.ErrProfileBusy) {
		t.Fatalf("pending invitation: %v, want ErrProfileBusy", err)
	}
	w.ctl(`update invitations set created_at = now() - interval '9 days', expires_at = now() - interval '1 day' where token_hash = $1`,
		invitations.HashToken(token))
	if err := issue(person, "olesya@gmail.example"); err != nil {
		t.Fatalf("after expiry: %v", err)
	}
	w.ctl(`update invitations set revoked_at = now() where person_profile_id = $1`, person)
	if err := issue(person, "o.petrova@alta.example"); err != nil {
		t.Fatalf("after revocation: %v", err)
	}
	acc := w.account("o.petrova@alta.example", "Олеся Петрова")
	if _, err := w.svc.Accept(ctx, acc, w.rawInvite("o.petrova@alta.example", person)); err != nil {
		t.Fatal(err)
	}
	w.ctl(`update invitations set revoked_at = now() where person_profile_id = $1 and accepted_at is null`, person)
	if err := issue(person, "olesya@gmail.example"); !errors.Is(err, invitations.ErrProfileBusy) {
		t.Fatalf("active membership: %v, want ErrProfileBusy", err)
	}
}

// Lock order (control 0002, AUTH-08): the business first. A revocation that holds the business and then takes the
// invitation (revokeInvitation of W1.06) must not deadlock with an acceptance waiting for that business; the
// acceptance then sees the invitation revoked (review W1.03, return 2).
func TestAcceptLocksTheBusinessFirst(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	token := w.invite("o.petrova@alta.example", w.profile("Олеся Петрова", "o.petrova@alta.example"), false)
	acc := w.account("o.petrova@alta.example", "Олеся Петрова")
	hold, err := w.control.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(ctx) }()
	if _, err := hold.Exec(ctx, `select id from tenants where id = $1 for update`, w.tenantID); err != nil {
		t.Fatal(err)
	}
	errc := make(chan error, 1)
	go func() { _, err := w.svc.Accept(ctx, acc, token); errc <- err }()
	w.blocked(1)
	if _, err := hold.Exec(ctx, `update invitations set revoked_at = now() where token_hash = $1`, invitations.HashToken(token)); err != nil {
		t.Fatalf("revocation after locking the business: %v", err)
	}
	if err := hold.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	expectCode(t, <-errc, "invalid_transition")
	if n := w.scalar(w.control, `select count(*) from memberships where account_id = $1`, acc); n != int64(0) {
		t.Errorf("memberships after a revoked invitation: %v, want 0", n)
	}
}

// The state of the business is read under its lock: a suspension committed while the acceptance waits for the
// business refuses the acceptance (review W1.03, return 2).
func TestAcceptSeesStateChangedWhileWaiting(t *testing.T) {
	t.Parallel()
	w := newWorld(t)
	ctx := t.Context()
	token := w.invite("o.petrova@alta.example", w.profile("Олеся Петрова", "o.petrova@alta.example"), false)
	acc := w.account("o.petrova@alta.example", "Олеся Петрова")
	hold, err := w.control.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback(ctx) }()
	if _, err := hold.Exec(ctx, `select id from tenants where id = $1 for update`, w.tenantID); err != nil {
		t.Fatal(err)
	}
	errc := make(chan error, 1)
	go func() { _, err := w.svc.Accept(ctx, acc, token); errc <- err }()
	w.blocked(1)
	if _, err := hold.Exec(ctx, `update tenants set state = 'suspended' where id = $1`, w.tenantID); err != nil {
		t.Fatal(err)
	}
	if err := hold.Commit(ctx); err != nil {
		t.Fatal(err)
	}
	expectCode(t, <-errc, problem.CodeTenantSuspended)
	if n := w.scalar(w.control, `select count(*) from memberships where account_id = $1`, acc); n != int64(0) {
		t.Errorf("memberships in a suspended business: %v, want 0", n)
	}
}

// The account's own membership (ended or invited) is reactivated; an invited membership of the invited profile held
// by another account (seed placeholder, earlier invitation) ends, so the person keeps one membership and its seat
// passes to the reactivated one — a full business still accepts (review W1.03, return 2).
func TestAcceptEndsInvitedMembershipOfProfile(t *testing.T) {
	t.Parallel()
	for _, own := range []string{"ended", "invited"} {
		t.Run(own, func(t *testing.T) {
			t.Parallel()
			w := newWorld(t)
			w.creator() // the first seat
			acc := w.account("o.petrova@alta.example", "Олеся Петрова")
			mine := uuid.New()
			w.ctl(`insert into memberships (id, tenant_id, account_id, status, person_profile_id, ended_at)
				values ($1, $2, $3, $4::text::membership_status, gen_random_uuid(), case when $4::text = 'ended' then now() - interval '30 days' end)`,
				mine, w.tenantID, acc, own)
			person := w.profile("Олеся Петрова", "o.petrova@alta.example")
			placeholder := w.account("petrova.dev@alta.example", "Олеся Петрова (dev)")
			invited := uuid.New()
			w.ctl(`insert into memberships (id, tenant_id, account_id, status, person_profile_id) values ($1, $2, $3, 'invited', $4)`,
				invited, w.tenantID, placeholder, person)
			var used int
			if err := w.control.QueryRow(t.Context(), `select seats_used from tenant_seat_usage where tenant_id = $1`, w.tenantID).
				Scan(&used); err != nil {
				t.Fatal(err)
			}
			w.seatLimit(used) // no free seat
			res, err := w.svc.Accept(t.Context(), acc, w.invite("o.petrova@alta.example", person, false))
			if err != nil {
				t.Fatal(err)
			}
			if res.MembershipId != mine {
				t.Fatalf("membership %s, want the account's own %s", res.MembershipId, mine)
			}
			if got := w.scalar(w.control, `select status = 'ended' and ended_at is not null from memberships where id = $1`, invited); got != true {
				t.Error("the invited membership of the profile must end")
			}
			if n := w.scalar(w.control, `select count(*) from memberships where person_profile_id = $1 and status <> 'ended'`, person); n != int64(1) {
				t.Errorf("live memberships of the profile: %v, want 1", n)
			}
			if n := w.scalar(w.control, `select seats_used from tenant_seat_usage where tenant_id = $1`, w.tenantID); n != int32(2) {
				t.Errorf("seats used %v, want 2 (the owner and the accepted membership)", n)
			}
		})
	}
}
