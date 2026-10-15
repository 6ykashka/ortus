//go:build integration

package operators

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
	"github.com/ortus/ortus-crm/backend/migrations"
	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
)

// The commands are checked on the first image of migratetest.Images() (PostgreSQL 17.11 by default).
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

// now of the stands: 01.10.2026 10:30 MSK, the «now» of the prototype.
var now = time.Date(2026, time.October, 1, 7, 30, 0, 0, time.UTC)

const day = 24 * time.Hour

// stand is a migrated control DB of one test: admin as ortus_migrator for setup and checks, the service as ortus_api.
type stand struct {
	t     *testing.T
	admin *sql.DB
	api   *sql.DB
	svc   *Service
	subs  subscriptions.Store
}

func newStand(t *testing.T) *stand {
	t.Helper()
	name := cluster.NewDatabase(t, "ops")
	admin := cluster.DB(t, name, migrations.RoleMigrator)
	if _, err := migrations.Up(t.Context(), admin, migrations.Control); err != nil {
		t.Fatal(err)
	}
	api := cluster.DB(t, name, migrations.RoleAPI)
	clock := func() time.Time { return now }
	return &stand{t: t, admin: admin, api: api, svc: &Service{Control: api, Now: clock}, subs: subscriptions.Store{DB: api, Now: clock}}
}

func (s *stand) exec(q string, args ...any) {
	s.t.Helper()
	if _, err := s.admin.ExecContext(s.t.Context(), q, args...); err != nil {
		s.t.Fatalf("%s: %v", q, err)
	}
}

func (s *stand) count(q string, args ...any) int {
	s.t.Helper()
	var n int
	if err := s.admin.QueryRowContext(s.t.Context(), q, args...).Scan(&n); err != nil {
		s.t.Fatalf("%s: %v", q, err)
	}
	return n
}

// tenant registers a tenant in state (since changedAt) with revision 1.
func (s *stand) tenant(slug, state string, changedAt time.Time) uuid.UUID {
	s.t.Helper()
	id := uuid.New()
	s.exec(`insert into tenants (id, slug, display_name, industry_pack, state, state_changed_at)
values ($1, $2, $3, 'logistics', $4::tenant_state, $5)`, id, strings.ReplaceAll(slug, "_", "-"), "Организация "+slug, state, changedAt)
	return id
}

// operator adds an operator with role and status and returns its account.
func (s *stand) operator(role, status string) uuid.UUID {
	s.t.Helper()
	account := uuid.New()
	s.exec(`insert into accounts (id, issuer, subject, email_norm, display_name) values ($1, 'urn:ortus:dev-operators', $2, $3, $4)`,
		account, account.String(), role+"@ortus.example", "Оператор "+role)
	disabled := any(nil)
	if status == "disabled" {
		disabled = now
	}
	s.exec(`insert into platform_operators (account_id, role, status, disabled_at) values ($1, $2, $3, $4)`, account, role, status, disabled)
	return account
}

// subscription stores the subscription row of a tenant (state trial | active | grace | ended) with its entitlements
// (source per key) as version 1.
func (s *stand) subscription(tenant uuid.UUID, plan, state string, from time.Time, to *time.Time, sources map[string]string) {
	s.t.Helper()
	s.exec(`insert into subscriptions (tenant_id, plan_code, state, period) values ($1, $2, $3, tstzrange($4, $5, '[]'))`,
		tenant, plan, state, from, to)
	for key, source := range sources {
		value := int64(10)
		if key == subscriptions.KeyStorageQuota {
			value = subscriptions.DefaultQuotaBytes
		}
		var until any
		ref := "price-book:v2:" + plan
		if source == subscriptions.SourceManual {
			until, ref = now.Add(60*day), "Тикет 42"
		}
		s.exec(`insert into entitlements (tenant_id, feature_key, source_type, source_ref, limit_value, effective, version, reason, actor_id)
values ($1, $2, $3, $4, $5, tstzrange($6, $7, '[]'), 1, 'тест', $1)`, tenant, key, source, ref, value, from, until)
	}
}

// tenantView is what a test checks of a tenant row.
type tenantView struct {
	Name, State, Reason string
	Revision            int64
	ChangedAt           time.Time
}

func (s *stand) read(id uuid.UUID) tenantView {
	s.t.Helper()
	var (
		v      tenantView
		reason sql.NullString
	)
	if err := s.admin.QueryRowContext(s.t.Context(), `select display_name, state::text, state_reason, revision, state_changed_at from tenants where id = $1`, id).
		Scan(&v.Name, &v.State, &reason, &v.Revision, &v.ChangedAt); err != nil {
		s.t.Fatal(err)
	}
	v.Reason, v.ChangedAt = reason.String, v.ChangedAt.UTC()
	return v
}

// auditRow is a platform_audit row of a test.
type auditRow struct {
	ActorKind, Action, TargetType, Reason, Result, RequestID string
	ActorID, TargetID                                        uuid.UUID
	Details                                                  map[string]string
}

func (s *stand) audits(target uuid.UUID) []auditRow {
	s.t.Helper()
	rows, err := s.admin.QueryContext(s.t.Context(), `select actor_kind, coalesce(actor_id, '00000000-0000-0000-0000-000000000000'), action,
target_type, coalesce(target_id, '00000000-0000-0000-0000-000000000000'), coalesce(reason, ''), result, request_id, details::text
  from platform_audit where target_id = $1 order by id`, target)
	if err != nil {
		s.t.Fatal(err)
	}
	defer rows.Close()
	out := []auditRow{}
	for rows.Next() {
		var (
			r   auditRow
			raw string
		)
		must(s.t, rows.Scan(&r.ActorKind, &r.ActorID, &r.Action, &r.TargetType, &r.TargetID, &r.Reason, &r.Result, &r.RequestID, &raw))
		must(s.t, json.Unmarshal([]byte(raw), &r.Details))
		out = append(out, r)
	}
	must(s.t, rows.Err())
	return out
}

func (s *stand) sub(tenant uuid.UUID) subscriptions.Subscription {
	s.t.Helper()
	sub, err := s.subs.Current(s.t.Context(), tenant)
	must(s.t, err)
	return sub
}

func (s *stand) lower(tenant uuid.UUID) time.Time {
	s.t.Helper()
	var at time.Time
	must(s.t, s.admin.QueryRowContext(s.t.Context(), `select lower(period) from subscriptions where tenant_id = $1`, tenant).Scan(&at))
	return at.UTC()
}

func reasonCmd(tenant, actor uuid.UUID, ifMatch, reason string) StatusChange {
	return StatusChange{TenantID: tenant, ActorID: actor, IfMatch: ifMatch, Reason: reason, RequestID: "req-" + uuid.NewString()}
}

func extendCmd(tenant, actor uuid.UUID, ifMatch string, days int) TrialExtension {
	return TrialExtension{TenantID: tenant, ActorID: actor, IfMatch: ifMatch, Days: days, Reason: "Пилот продлён", RequestID: "req-" + uuid.NewString()}
}

// opRow is the expected audit row of an operator command.
func opRow(actor uuid.UUID, action, targetType string, target uuid.UUID, reason, result, requestID string, kv ...string) auditRow {
	d := map[string]string{}
	for i := 0; i+1 < len(kv); i += 2 {
		d[kv[i]] = kv[i+1]
	}
	return auditRow{ActorKind: "operator", ActorID: actor, Action: action, TargetType: targetType, TargetID: target, Reason: reason,
		Result: result, RequestID: requestID, Details: d}
}

// subView is what a test checks of a subscription.
type subView struct {
	Status   string
	TrialEnd string
	Revision int64
	Stored   bool
}

func viewOf(s subscriptions.Subscription) subView {
	v := subView{Status: s.Status, Revision: s.Revision, Stored: s.Stored}
	if s.TrialEndsAt != nil {
		v.TrialEnd = s.TrialEndsAt.UTC().Format(time.RFC3339)
	}
	return v
}

func stamp(t time.Time) string { return t.UTC().Format(time.RFC3339) }

// sources maps the keys of the entitlements of s to "source:ref".
func sources(s subscriptions.Subscription) map[string]string {
	out := map[string]string{}
	for _, e := range s.Entitlements {
		out[e.Key] = e.SourceType + ":" + e.SourceRef
	}
	return out
}

func fieldsOf(err error) []string {
	if f := fields(err); f != nil {
		return f
	}
	return []string{fmt.Sprint(err)}
}
