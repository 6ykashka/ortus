package tenantctx

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// S1-02 «без fallback в главную БД»: имя tenant DB из tenant_routing — только имя базы тенанта. Служебные базы
// кластера, control DB и пустое имя (путь DSN «/» — база по умолчанию роли) отклоняются до соединения.
func TestCheckDatabaseName(t *testing.T) {
	t.Parallel()
	bad := []string{
		"", "postgres", "template0", "template1", "ortus_control",
		"T_ALTA", "t-alta", "t alta", "1t", "t_alta;drop", strings.Repeat("t", 64),
	}
	for _, name := range bad {
		if err := CheckDatabaseName(name); err == nil {
			t.Errorf("CheckDatabaseName(%q) = nil, want an error", name)
		}
	}
	for _, name := range []string{"t_alta", "t_lotos", "iso_t_a", "t_alta_logistika_3f9a1c", strings.Repeat("t", 63)} {
		if err := CheckDatabaseName(name); err != nil {
			t.Errorf("CheckDatabaseName(%q) = %v, want nil", name, err)
		}
	}
}

// countDir counts Routing calls; every tenant routes to database name db with a reachable-looking secret.
type countDir struct {
	fakeDir
	db    string
	calls int
}

func (d *countDir) Routing(_ context.Context, id uuid.UUID) (Routing, error) {
	d.calls++
	return Routing{TenantID: id, DatabaseName: d.db, SecretRef: "env:TENANT_DB_URL", Sentinel: uuid.New()}, nil //nolint:gosec // G101: a variable name
}

// Маршрут в служебную или control DB не открывает пул: ответ dependency_unavailable с причиной «имя базы», а не
// ошибка соединения (до сети дело не доходит: порт 1 никто не слушает, но текст ошибки — о имени).
func TestPoolsRefuseServiceDatabases(t *testing.T) {
	t.Parallel()
	env := map[string]string{"TENANT_DB_URL": "postgres://ortus_api:p4ss@127.0.0.1:1/?sslmode=disable"} //nolint:gosec // G101: test fixture
	for _, db := range []string{"", "postgres", "template1", "ortus_control", "control_x"} {
		d := &countDir{db: db}
		p := NewPools(d, func(k string) string { return env[k] }, "")
		p.Reserved = []string{"control_x"}
		_, err := p.For(t.Context(), tenant)
		if !problem.Is(err, problem.CodeDependencyUnavailable) {
			t.Errorf("%q: %v, want dependency_unavailable", db, err)
		} else if !strings.Contains(err.Error(), "database name") {
			t.Errorf("%q: %v, want a database name error before connecting", db, err)
		}
		if len(p.Opened()) != 0 {
			t.Errorf("%q: pool cached: %v", db, p.Opened())
		}
		p.Close()
	}
}

// Пустой tenant id (uuid.Nil) не ищется в tenant_routing: «нет организации» не превращается в «какую-то БД».
func TestPoolsRefuseNilTenant(t *testing.T) {
	t.Parallel()
	d := &countDir{db: "t_alta"}
	p := NewPools(d, func(string) string { return "" }, "")
	defer p.Close()
	if _, err := p.For(t.Context(), uuid.Nil); !problem.Is(err, problem.CodeDependencyUnavailable) {
		t.Fatalf("For(uuid.Nil) = %v, want dependency_unavailable", err)
	}
	if d.calls != 0 {
		t.Fatalf("Routing called %d times for uuid.Nil", d.calls)
	}
}
