//go:build isolation

package isolation

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/migrations/migratetest"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures"
	"github.com/ortus/ortus-crm/backend/test/isolation/matrix"
)

// Operator rows of the commands of W1.48 (S1-04, S1-23; brief §6 T-01). The positive operator is p.operator of the
// fixtures (role owner, W1.04); a support operator (may read, may not act) is added to the control DB here. The
// commands change a tenant, so their 200 rows act on tenants of their own that exist only in the control DB (the
// commands never touch a tenant DB): tenants A and B of the fixtures keep their state for the other rows.
const actorOpSupport = "op.support"

// Tenants of the operator rows: one per command, in the state the command starts from.
const (
	refOpSuspend = "tenant:op-suspend" // trial → suspended
	refOpResume  = "tenant:op-resume"  // suspended → state of its subscription
	refOpExtend  = "tenant:op-extend"  // trial, derived subscription → trial extended
)

var operatorTenants = map[string]string{refOpSuspend: "trial", refOpResume: "suspended", refOpExtend: "trial"}

func isolationID(kind, key string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceURL, []byte("ortus:isolation:"+kind+":"+key))
}

// withOperators resolves op.support and the tenants of the operator rows on top of the suite's resolver.
type withOperators struct{ matrix.Resolver }

func (w withOperators) Actor(key string) (fixtures.Actor, error) {
	if key == actorOpSupport {
		return fixtures.Actor{Key: key, Name: key, Issuer: fixtures.IssuerDev, Subject: "iso-" + key,
			AccountID: isolationID("account", key), Operator: true}, nil
	}
	return w.Resolver.Actor(key)
}

func (w withOperators) ID(ref string) (uuid.UUID, error) {
	if _, ok := operatorTenants[ref]; ok {
		return isolationID("tenant", strings.TrimPrefix(ref, "tenant:")), nil
	}
	if ref == "account:"+actorOpSupport {
		return isolationID("account", actorOpSupport), nil
	}
	return w.Resolver.ID(ref)
}

var operatorsOnce sync.Once

// ensureOperators writes the support operator and the tenants of the rows once (as superuser: they are not
// fixture data).
func ensureOperators(t *testing.T, w *fixtures.World) {
	t.Helper()
	var err error
	operatorsOnce.Do(func() {
		db := w.Cluster.DB(t, w.ControlDB, migratetest.Super)
		id := isolationID("account", actorOpSupport)
		if _, err = db.ExecContext(t.Context(), `insert into accounts (id, issuer, subject, email_norm, display_name)
values ($1, $2, $3, $4, $5) on conflict (id) do nothing`, id, fixtures.IssuerDev, "iso-"+actorOpSupport, actorOpSupport+"@ortus.example",
			"Оператор поддержки"); err != nil {
			return
		}
		if _, err = db.ExecContext(t.Context(), `insert into platform_operators (account_id, role, status)
values ($1, 'support', 'active') on conflict (account_id) do nothing`, id); err != nil {
			return
		}
		for ref, state := range operatorTenants {
			key := strings.TrimPrefix(ref, "tenant:")
			if _, err = db.ExecContext(t.Context(), `insert into tenants (id, slug, display_name, industry_pack, state, state_changed_at)
values ($1, $2, $3, 'logistics', $4::tenant_state, $5) on conflict (id) do nothing`,
				isolationID("tenant", key), "iso-"+key, "Организация "+key, state, w.Now); err != nil {
				return
			}
		}
	})
	if err != nil {
		t.Fatalf("operators: %v", err)
	}
}

// withCommandHeaders adds to every command what the matrix runner does not send: If-Match = ETag of the card the
// command changes (the tenant, or the subscription for trial-extensions), read first with the same session ("0" when
// the card is not readable). The runner sets Idempotency-Key itself (target_test.go).
func withCommandHeaders(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost || r.Method == http.MethodPatch {
			card := r.URL.Path
			switch {
			case strings.HasSuffix(card, "/trial-extensions"):
				card = strings.TrimSuffix(card, "/trial-extensions") + "/subscription"
			case strings.HasSuffix(card, "/suspend"), strings.HasSuffix(card, "/resume"):
				card = card[:strings.LastIndex(card, "/")]
			}
			get := httptest.NewRequestWithContext(r.Context(), http.MethodGet, card, nil)
			for _, c := range r.Cookies() {
				get.AddCookie(c)
			}
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, get)
			tag := rec.Header().Get("ETag")
			if tag == "" {
				tag = `"0"`
			}
			r.Header.Set("If-Match", tag)
		}
		h.ServeHTTP(w, r)
	})
}

// operatorRows: p.operator (owner) runs each command on its tenant (200), the support operator may read the journal
// but not act (403), an unknown tenant answers 404 like a foreign one.
func operatorRows(w *fixtures.World) (matrix.File, error) {
	i := slices.IndexFunc(w.Catalog.Tenants, func(t fixtures.TenantDef) bool { return t.Key == fixtures.TenantA })
	rename, err := json.Marshal(map[string]string{"name": w.Catalog.Tenants[i].Name})
	if err != nil {
		return matrix.File{}, err
	}
	const (
		reason = `{"reason": "проверка изоляции"}`
		extend = `{"days": 14, "reason": "проверка изоляции"}`
	)
	tenantA := map[string]string{"tenantId": "tenant:a"}
	missing := map[string]string{"tenantId": fixtures.MissingTenant}
	command := func(op, path, own, body string) matrix.Endpoint {
		return matrix.Endpoint{
			Op: op, Method: http.MethodPost, Path: path, Channel: matrix.ChannelHTTP,
			Rows: []matrix.Row{
				{Actor: "p.operator", Params: map[string]string{"tenantId": own}, Status: http.StatusOK, Body: body,
					Present: []string{own}, Absent: []string{"tenant:a", "tenant:b"}, Note: "оператор-владелец"},
				{Actor: actorOpSupport, Params: tenantA, Status: http.StatusForbidden, Code: "forbidden_action", Body: body,
					Absent: []string{"tenant:b"}, Note: "роль support не меняет организации и подписки"},
				{Actor: "p.operator", Params: missing, Status: http.StatusNotFound, Body: body, Absent: []string{"tenant:a", "tenant:b"},
					Note: "несуществующая организация"},
			},
		}
	}
	suspend := command("suspendPlatformTenant", "/api/v1/platform/tenants/{tenantId}/suspend", refOpSuspend, reason)
	resume := command("resumePlatformTenant", "/api/v1/platform/tenants/{tenantId}/resume", refOpResume, reason)
	trial := command("extendPlatformTrial", "/api/v1/platform/tenants/{tenantId}/trial-extensions", refOpExtend, extend)
	trial.Rows[0].Present = nil // Subscription carries no tenant id
	return matrix.File{Module: "operators", Endpoints: []matrix.Endpoint{
		suspend, resume, trial,
		{
			Op: "updatePlatformTenant", Method: http.MethodPatch, Path: "/api/v1/platform/tenants/{tenantId}",
			Channel: matrix.ChannelHTTP,
			Rows: []matrix.Row{
				{Actor: "p.operator", Params: tenantA, Status: http.StatusOK, Body: string(rename), Present: []string{"tenant:a"},
					Absent: []string{"tenant:b"}, Note: "переименование тем же именем: фикстуры не меняются"},
				{Actor: actorOpSupport, Params: tenantA, Status: http.StatusForbidden, Code: "forbidden_action", Body: string(rename),
					Absent: []string{"tenant:b"}},
				{Actor: "p.operator", Params: missing, Status: http.StatusNotFound, Body: string(rename),
					Absent: []string{"tenant:a", "tenant:b"}},
			},
		},
		{
			Op: "listPlatformAuditEvents", Method: http.MethodGet, Path: "/api/v1/platform/audit-events?tenantId={tenantId}",
			Channel: matrix.ChannelHTTP,
			Rows: []matrix.Row{
				{Actor: "p.operator", Params: tenantA, Status: http.StatusOK, Absent: []string{"tenant:b"},
					Note: "журнал одной организации не содержит строк другой"},
				{Actor: actorOpSupport, Params: map[string]string{"tenantId": "tenant:b"}, Status: http.StatusOK,
					Absent: []string{"tenant:a"}, Note: "журнал читают все роли операторов"},
				{Actor: "p.operator", Params: missing, Status: http.StatusNotFound, Absent: []string{"tenant:a", "tenant:b"},
					Note: "неизвестная организация в фильтре — 404"},
			},
		},
	}}, nil
}

func TestIsolationOperatorsAsOperator(t *testing.T) {
	t.Parallel()
	w, ok := suite.Refs.(*fixtures.World)
	if !ok {
		t.Fatalf("suite refs %T, want *fixtures.World", suite.Refs)
	}
	ensureOperators(t, w)
	f, err := operatorRows(w)
	if err != nil {
		t.Fatal(err)
	}
	s := &matrix.Suite{
		Refs:   withOperators{suite.Refs},
		Target: matrix.Target{Handler: withCommandHeaders(suite.Target.Handler), Authenticate: suite.Target.Authenticate},
		Strict: suite.Strict,
	}
	matrix.Run(t, s, f)
}
