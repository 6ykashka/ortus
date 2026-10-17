package inspections

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// downPools is a tenant DB that cannot be reached.
type downPools struct{}

func (downPools) For(context.Context, uuid.UUID) (*pgxpool.Pool, error) {
	return nil, errors.New("tenant DB is down")
}

// allowAll is an authorizer that is not the evaluator of W1.04.
type allowAll struct{}

func (allowAll) Permit(context.Context, tenantctx.TenantContext, string, authz.Resource) error {
	return nil
}

func (allowAll) ScopeQuery(context.Context, tenantctx.TenantContext, string, authz.Columns, int) (authz.Predicate, error) {
	return authz.Predicate{SQL: "true"}, nil
}

// Without its tenant DB every operation fails closed: no tenant in the context — 404, the DB down — 503 (or the
// error of the pool through scopeddb), never a success.
func TestServiceWithoutTenantDB(t *testing.T) {
	t.Parallel()
	ctx := t.Context()
	s := &Service{Pools: downPools{}, Authz: allowAll{}}
	tc := tenantctx.TenantContext{TenantID: uuid.New(), PersonID: uuid.New()}
	b := validCreate(kindDeparture)
	calls := map[string]func(tenantctx.TenantContext) error{
		"checklist": func(tc tenantctx.TenantContext) error {
			_, err := s.Checklist(ctx, tc, uuid.New(), kindDeparture)
			return err
		},
		"submit": func(tc tenantctx.TenantContext) error { _, err := s.Submit(ctx, tc, b); return err },
		"decide": func(tc tenantctx.TenantContext) error {
			_, err := s.Decide(ctx, tc, uuid.New(), `"1"`, fleetapi.DefectDecision{Decision: decisionAllow})
			return err
		},
		"inspection":  func(tc tenantctx.TenantContext) error { _, err := s.Inspection(ctx, tc, uuid.New()); return err },
		"inspections": func(tc tenantctx.TenantContext) error { _, err := s.Inspections(ctx, tc, PageQuery{}); return err },
		"defect":      func(tc tenantctx.TenantContext) error { _, err := s.Defect(ctx, tc, uuid.New()); return err },
		"defects":     func(tc tenantctx.TenantContext) error { _, err := s.Defects(ctx, tc, DefectQuery{}); return err },
	}
	for name, call := range calls {
		if err := call(tc); err == nil || problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s with the DB down: %v", name, err)
		}
	}
	for _, name := range []string{"checklist", "submit", "decide", "inspection", "inspections"} {
		if err := calls[name](tenantctx.TenantContext{}); err == nil {
			t.Errorf("%s without a tenant succeeded", name)
		}
	}
	if _, err := s.Checklist(ctx, tc, uuid.New(), kindDeparture); !problem.Is(err, problem.CodeDependencyUnavailable) {
		t.Errorf("checklist: %v, want dependency_unavailable", err)
	}
}

func TestServiceHelpers(t *testing.T) {
	t.Parallel()
	s := &Service{Authz: allowAll{}}
	if cp := s.inTx(nil); cp.Authz != s.Authz {
		t.Error("an authorizer other than the evaluator is kept as is")
	}
	if got := s.now(); time.Since(got) > time.Minute || got.Location() != time.UTC {
		t.Errorf("wall clock %v", got)
	}
	at := time.Date(2026, 10, 1, 10, 30, 0, 0, time.FixedZone("MSK", 3*3600))
	if got := (&Service{Now: func() time.Time { return at }}).now(); !got.Equal(at) || got.Location() != time.UTC {
		t.Errorf("clock of the application %v", got)
	}
	var seen string
	h := requestid.Middleware(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) { seen = requestID(r.Context()) }))
	h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequestWithContext(t.Context(), http.MethodGet, "/", nil))
	if seen == "" || strings.HasPrefix(seen, "job-") {
		t.Errorf("request id of a request %q", seen)
	}
	if got := requestID(t.Context()); !strings.HasPrefix(got, "job-") {
		t.Errorf("request id outside a request %q", got)
	}
	if got := persons(nil, new(uuid.Nil), new(uuid.MustParse("10000000-0000-4000-8000-000000000001"))); len(got) != 1 {
		t.Errorf("persons %v", got)
	}
	if orNil(uuid.Nil) != nil || orNil(uuid.New()) == nil {
		t.Error("orNil")
	}
}

// The rest of the body checks of submitInspection.
func TestValidateCreateLimits(t *testing.T) {
	t.Parallel()
	long := func(n int) string { return strings.Repeat("я", n) }
	cases := map[string]func(*fleetapi.InspectionCreate){
		"время осмотра":        func(b *fleetapi.InspectionCreate) { b.CapturedAt = time.Time{} },
		"описание повреждений": func(b *fleetapi.InspectionCreate) { b.ReportedDamage = new(long(5001)) },
		"ключ пункта":          func(b *fleetapi.InspectionCreate) { b.Checks[0].Key = long(101) },
		"пункт дважды":         func(b *fleetapi.InspectionCreate) { b.Checks = append(b.Checks, b.Checks[0]) },
		"комментарий пункта":   func(b *fleetapi.InspectionCreate) { b.Checks[0].Comment = new(long(1001)) },
		"фото без файла":       func(b *fleetapi.InspectionCreate) { b.Photos[0].FileId = uuid.Nil },
		"31 фото": func(b *fleetapi.InspectionCreate) {
			for range 30 {
				b.Photos = append(b.Photos, photo("damage"))
			}
		},
		"21 дефект": func(b *fleetapi.InspectionCreate) {
			d := make([]fleetapi.InspectionDefectReport, 21)
			for i := range d {
				d[i] = fleetapi.InspectionDefectReport{Zone: "Кузов", Description: "Скол", Severity: "minor"}
			}
			b.Defects = &d
		},
	}
	for name, mutate := range cases {
		b := validCreate(kindDeparture)
		mutate(&b)
		if err := validateCreate(b); !problem.Is(err, codeValidation) {
			t.Errorf("%s: %v, want validation_failed", name, err)
		}
	}
	if apiRole("interior") != "" {
		t.Error("interior has no role in the contract")
	}
	if _, err := parseQuantity("1.5"); err != nil {
		t.Errorf("1.5: %v", err)
	}
}
