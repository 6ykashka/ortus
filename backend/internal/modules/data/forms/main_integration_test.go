//go:build integration

package forms_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strconv"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	_ "github.com/jackc/pgx/v5/stdlib" // database/sql driver "pgx"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/data"       //nolint:depguard // the registry the provider plugs into
	"github.com/ortus/ortus-crm/backend/internal/modules/data/forms" //nolint:depguard // the package under test
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
	"github.com/ortus/ortus-crm/backend/migrations"              //nolint:depguard // integration test: role names of the test cluster
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: clock and PostgreSQL of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// The world of the package: the isolation fixtures (W1.04) with their content — in every tenant «Осмотр машины» of the
// whole organization with the response form_response:<t>.insp-1 of the driver of Москва-1 (no object) — plus, written
// once before the tests in tenant A:
//   - the trips Р-901 (Москва-1, a.driver-msk1) and Р-902 (Москва-2, a.driver-msk2);
//   - v2 of «Осмотр машины» with «Уровень топлива» q-fuel (¼, ½, ¾, Полный);
//   - the responses R-5001 (v2, Р-901, q-fuel «¾»), R-5002 (v1, Р-902, q-fuel-t «почти полный»), R-5003 (v1, a trip
//     that is gone, by the owner) and R-5004 of another form «Опрос водителей»;
//   - forms.responses.read in the role «Менеджер логистики» (the fixtures do not give it): the managers of a unit read
//     the responses about the trips of their unit — the form is of the whole organization.
var (
	world  *fixtures.World
	dbs    = map[string]*sql.DB{} // the tenant DBs as the superuser
	trips  = map[string]uuid.UUID{}
	answer = map[string]uuid.UUID{} // the responses of the seed by number
	gone   = uuid.New()             // the trip of R-5003: no row
	survey = uuid.New()             // the form «Опрос водителей»
)

func TestMain(m *testing.M) {
	os.Exit(runMain(m))
}

func runMain(m *testing.M) int {
	ctx := context.Background()
	c, stop, err := harness.StartPostgres(ctx)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	defer stop()
	if world, err = fixtures.Load(ctx, c, "dataforms", harness.Now(), fixtures.WithContent()); err != nil {
		fmt.Fprintln(os.Stderr, err)
		return 1
	}
	for _, t := range []string{"a", "b"} {
		d, err := sql.Open("pgx", world.TenantURL(t, "super"))
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			return 1
		}
		d.SetMaxOpenConns(4)
		defer d.Close()
		dbs[t] = d
	}
	if err := seed(ctx); err != nil {
		fmt.Fprintln(os.Stderr, "seed:", err)
		return 1
	}
	return m.Run()
}

// fuelV2 is v2 of «Осмотр машины» of the seed: the text question of the fixtures and «Уровень топлива» as a choice.
const fuelV2 = `{"pages":[{"id":"p1","title":"Страница 1"}],"fields":[{"key":"q-text","pageId":"p1","type":"text",
"label":"Комментарий","required":false},{"key":"q-fuel","pageId":"p1","type":"choice","label":"Уровень топлива","required":true,
"options":[{"key":"o1","label":"¼"},{"key":"o2","label":"½"},{"key":"o3","label":"¾"},{"key":"o4","label":"Полный"}]}]}`

func seed(ctx context.Context) error {
	db := dbs["a"]
	now := harness.Now()
	steps := []struct {
		sql  string
		args []any
	}{
		{`update access.role_versions set actions = array_append(actions, 'forms.responses.read')
			where role_id = (select id from access.roles where name = 'Менеджер логистики')`, nil},
		{`insert into forms.versions (form_id, number, definition, question_count, published_at, published_by)
			values ($1, 2, $2::jsonb, 2, $3, $4)`, []any{ref("form:a.insp"), fuelV2, now.Add(-time.Hour), person("a.owner", "a")}},
		{`update forms.forms set current_version = 2 where id = $1`, []any{ref("form:a.insp")}},
		{`insert into forms.forms (id, name, owner_id, status) values ($1, 'Опрос водителей', $2, 'draft')`,
			[]any{survey, person("a.owner", "a")}},
		{`insert into forms.versions (form_id, number, definition, question_count, published_by)
			select $1, 1, definition, 1, published_by from forms.versions where form_id = $2 and number = 1`, []any{survey, ref("form:a.insp")}},
		{`update forms.forms set status = 'published', current_version = 1 where id = $1`, []any{survey}},
	}
	for _, s := range steps {
		if _, err := db.ExecContext(ctx, s.sql, s.args...); err != nil {
			return fmt.Errorf("%s: %w", s.sql, err)
		}
	}
	for _, x := range []struct {
		number, unit, driver string
	}{{"Р-901", "msk1", "a.driver-msk1"}, {"Р-902", "msk2", "a.driver-msk2"}} {
		trips[x.number] = uuid.New()
		if _, err := db.ExecContext(ctx, `insert into fleet.trips (id, number, unit_id, state, driver_person_id, planned, title)
			values ($1, $2, $3, 'planned', $4, tstzrange($5, $6), 'Рейс сида W4.80')`, trips[x.number], x.number, ref("unit:a."+x.unit),
			person(x.driver, "a"), now.Add(time.Hour), now.Add(3*time.Hour)); err != nil {
			return err
		}
	}
	for _, r := range []struct {
		number         int
		form           uuid.UUID
		version        int
		author         string
		trip           *uuid.UUID
		label, answers string
	}{
		{5001, ref("form:a.insp"), 2, "a.driver-msk1", new(trips["Р-901"]), "Рейс Р-901 · выезд",
			`[{"fieldKey":"q-fuel","value":{"type":"choices","value":["o3"]}}]`},
		{5002, ref("form:a.insp"), 1, "a.driver-msk2", new(trips["Р-902"]), "Рейс Р-902 · сдача",
			`[{"fieldKey":"q-fuel-t","value":{"type":"text","value":"почти полный"}}]`},
		{5003, ref("form:a.insp"), 1, "a.owner", &gone, "Рейс Р-171", `[]`},
		{5004, survey, 1, "a.driver-msk1", new(trips["Р-901"]), "Рейс Р-901", `[]`},
	} {
		id := uuid.New()
		answer[strconv.Itoa(r.number)] = id
		if _, err := db.ExecContext(ctx, `insert into forms.responses (id, form_id, number, version_number, channel, author_id,
			subject_module, subject_type, subject_id, subject_label, answers, review_status, submitted_at)
			values ($1, $2, $3, $4, 'inspection', $5, 'fleet', 'trip', $6, $7, $8::jsonb, 'accepted', $9)`,
			id, r.form, r.number, r.version, person(r.author, "a"), r.trip, r.label, r.answers, now.Add(-time.Duration(r.number)*time.Second)); err != nil {
			return err
		}
	}
	return nil
}

func ref(r string) uuid.UUID {
	id, err := world.ID(r)
	if err != nil {
		panic(err)
	}
	return id
}

func person(actor, tenant string) uuid.UUID { return ref("person:" + actor + "@" + tenant) }

// noModules is the module registry of the tests: nothing is installed (the module of forms is of the core).
type noModules struct{}

func (noModules) States(context.Context, uuid.UUID) (map[string]string, error) {
	return map[string]string{}, nil
}

// pool closes the trips of hidden to the people of who (data.Hider: the driver pool of cmd/api, W2.57).
type pool struct {
	who    uuid.UUID
	hidden []uuid.UUID
}

func (p pool) Hidden(_ context.Context, tc tenantctx.TenantContext) ([]uuid.UUID, error) {
	if tc.PersonID == p.who {
		return p.hidden, nil
	}
	return nil, nil
}

// env is the service wired like cmd/api: tenant pools of ortus_api, the evaluator on the fixtures' clock and the
// registry with the provider of forms.
type env struct {
	dir *tenantctx.PGDirectory
	svc *data.Service
}

func newEnv(t *testing.T, hider data.Hider) env {
	t.Helper()
	ctx := t.Context()
	control, err := pgxpool.New(ctx, world.ControlURL(migrations.RoleAPI))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(control.Close)
	vars := world.Env()
	dir := tenantctx.NewPGDirectory(control)
	pools := tenantctx.NewPools(dir, func(k string) string { return vars[k] }, vars["TENANT_DB_HOST"])
	t.Cleanup(pools.Close)
	src := authz.PGSource{Pools: pools}
	reg, err := data.NewRegistry(forms.Provider{})
	if err != nil {
		t.Fatal(err)
	}
	return env{dir: dir, svc: &data.Service{
		Pools: pools, Authz: authz.New(src, src, harness.Now), Registry: reg, Modules: noModules{}, Hidden: hider,
		Now: harness.Now, Timeout: time.Minute,
	}}
}

// tc resolves the tenant context of actor in tenant («a» or «b»), as the gateway does.
func (e env) tc(t *testing.T, actor, tenant string) tenantctx.TenantContext {
	t.Helper()
	a, err := world.Actor(actor)
	if err != nil {
		t.Fatal(err)
	}
	tc, err := tenantctx.Resolve(t.Context(), e.dir, a.AccountID, ref("tenant:"+tenant).String(), true)
	if err != nil {
		t.Fatal(err)
	}
	return tc
}

// query runs raw (a DatasetQuery) over «Ответы на осмотр» as actor of tenant.
func (e env) query(t *testing.T, actor, tenant, raw string) (dataapi.DatasetQueryResult, error) {
	t.Helper()
	var q dataapi.DatasetQuery
	if err := json.Unmarshal([]byte(raw), &q); err != nil {
		t.Fatalf("%s: %v", raw, err)
	}
	return e.svc.Query(t.Context(), e.tc(t, actor, tenant), forms.Responses, &q)
}

// cells returns the rows as the texts of their cells («∅» for a null), the record id first.
func cells(t *testing.T, res dataapi.DatasetQueryResult) [][]string {
	t.Helper()
	out := make([][]string, 0, len(res.Rows))
	for _, r := range res.Rows {
		row := []string{r.RecordId}
		for _, c := range r.Cells {
			raw, err := json.Marshal(c.Value)
			if err != nil {
				t.Fatal(err)
			}
			var v struct {
				Type  string `json:"type"`
				Value any    `json:"value"`
			}
			if err := json.Unmarshal(raw, &v); err != nil {
				t.Fatal(err)
			}
			if v.Type == "null" {
				row = append(row, "∅")
				continue
			}
			row = append(row, fmt.Sprint(v.Value))
		}
		out = append(out, row)
	}
	return out
}

func records(res dataapi.DatasetQueryResult) []string {
	out := make([]string, 0, len(res.Rows))
	for _, r := range res.Rows {
		out = append(out, r.RecordId)
	}
	slices.Sort(out)
	return out
}

// rec is the record id of a response of «Осмотр машины» of tenant A: «{formId}:{responseId}».
func rec(id uuid.UUID) string { return ref("form:a.insp").String() + ":" + id.String() }
