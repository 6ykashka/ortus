package tenants

import (
	"errors"
	"fmt"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

// base is the creation time of the first tenant of the tests; tenant i is created i minutes later.
var base = time.Date(2026, time.October, 1, 10, 30, 0, 0, time.UTC)

// refs builds n tenants at version 0, slugs t00…t(n-1) in creation order.
func refs(n int) []Ref {
	out := make([]Ref, n)
	for i := range out {
		out[i] = Ref{
			TenantID:  uuid.NewSHA1(uuid.NameSpaceURL, fmt.Appendf(nil, "test:%02d", i)),
			Slug:      fmt.Sprintf("t%02d", i),
			Database:  fmt.Sprintf("t_t%02d", i),
			Sentinel:  uuid.New(),
			CreatedAt: base.Add(time.Duration(i) * time.Minute),
		}
	}
	return out
}

func slugs(rs []Ref) []string {
	out := make([]string, len(rs))
	for i, r := range rs {
		out[i] = r.Slug
	}
	return out
}

func resultSlugs(rs []Result) []string {
	out := make([]string, len(rs))
	for i, r := range rs {
		out[i] = r.Ref.Slug
	}
	return out
}

func phaseNames(ps []Phase) []string {
	out := make([]string, len(ps))
	for i, p := range ps {
		out[i] = fmt.Sprintf("%s:%d", p.Name, len(p.Tenants))
	}
	return out
}

// M-07 WS-41: 12 тенантов, canary «alta», партии по 5; двое уже на цели — пропуск, один впереди цели — отказ без
// изменений; порядок фаз детерминирован (created_at, id).
func TestPlanPhases(t *testing.T) {
	t.Parallel()
	rs := refs(12)
	rs[0].Slug = "alta"
	rs[4].SchemaVersion, rs[7].SchemaVersion = 6, 6
	rs[9].SchemaVersion = 7
	slices.Reverse(rs) // input order does not matter

	phases, skipped, failed, err := PlanPhases(rs, Plan{Target: 6, Canary: []string{"alta"}, BatchSize: 5})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := phaseNames(phases), []string{"canary:1", "batch 1:5", "batch 2:3"}; !slices.Equal(got, want) {
		t.Fatalf("phases %v, want %v", got, want)
	}
	if got := slugs(phases[0].Tenants); !slices.Equal(got, []string{"alta"}) {
		t.Errorf("canary %v", got)
	}
	if got, want := slugs(phases[1].Tenants), []string{"t01", "t02", "t03", "t05", "t06"}; !slices.Equal(got, want) {
		t.Errorf("batch 1 %v, want %v", got, want)
	}
	if got, want := slugs(phases[2].Tenants), []string{"t08", "t10", "t11"}; !slices.Equal(got, want) {
		t.Errorf("batch 2 %v, want %v", got, want)
	}
	if got := resultSlugs(skipped); !slices.Equal(got, []string{"t04", "t07"}) {
		t.Errorf("skipped %v", got)
	}
	if len(failed) != 1 || failed[0].Ref.Slug != "t09" || !errors.Is(failed[0].Err, ErrVersionAhead) {
		t.Errorf("failed %+v, want t09 with ErrVersionAhead", failed)
	}
	if failed[0].From != 7 || failed[0].To != 7 {
		t.Errorf("ahead tenant From/To = %d/%d, want 7/7 (unchanged)", failed[0].From, failed[0].To)
	}
}

// M-08: без canary — первый по created_at, кому нужна миграция; BatchSize 0 → 10.
func TestPlanPhasesDefaults(t *testing.T) {
	t.Parallel()
	rs := refs(16)
	rs[0].SchemaVersion = 6 // the oldest tenant is already there: it is not the canary
	phases, skipped, failed, err := PlanPhases(rs, Plan{Target: 6})
	if err != nil {
		t.Fatal(err)
	}
	if got, want := phaseNames(phases), []string{"canary:1", "batch 1:10", "batch 2:4"}; !slices.Equal(got, want) {
		t.Fatalf("phases %v, want %v", got, want)
	}
	if phases[0].Tenants[0].Slug != "t01" {
		t.Errorf("default canary %s, want t01", phases[0].Tenants[0].Slug)
	}
	if len(skipped) != 1 || len(failed) != 0 {
		t.Errorf("skipped %v failed %v", resultSlugs(skipped), resultSlugs(failed))
	}
}

// Одинаковое время создания — порядок по id: план не зависит от порядка строк из БД.
func TestPlanPhasesTieBreakByID(t *testing.T) {
	t.Parallel()
	rs := refs(4)
	for i := range rs {
		rs[i].CreatedAt = base
	}
	want := slices.Clone(rs)
	slices.SortFunc(want, func(a, b Ref) int { return compareIDs(a.TenantID, b.TenantID) })
	phases, _, _, err := PlanPhases(rs, Plan{Target: 1, BatchSize: 2})
	if err != nil {
		t.Fatal(err)
	}
	var got []string
	for _, p := range phases {
		got = append(got, slugs(p.Tenants)...)
	}
	if !slices.Equal(got, slugs(want)) {
		t.Fatalf("order %v, want %v", got, slugs(want))
	}
}

// Неизвестный canary — ошибка до любых действий; canary на цели — пропуск без фазы canary; canary впереди цели —
// отказ (Rollout считает это отказом canary).
func TestPlanPhasesCanaryEdges(t *testing.T) {
	t.Parallel()
	rs := refs(3)
	if _, _, _, err := PlanPhases(rs, Plan{Target: 6, Canary: []string{"ghost"}}); !errors.Is(err, ErrUnknownTenant) {
		t.Errorf("unknown canary: %v, want ErrUnknownTenant", err)
	}
	if _, _, _, err := PlanPhases(rs, Plan{Target: 0}); err == nil {
		t.Error("target 0: no error")
	}

	rs[1].SchemaVersion = 6
	phases, skipped, _, err := PlanPhases(rs, Plan{Target: 6, Canary: []string{"t01"}})
	if err != nil {
		t.Fatal(err)
	}
	if got := phaseNames(phases); !slices.Equal(got, []string{"batch 1:2"}) {
		t.Errorf("canary on target: phases %v", got)
	}
	if got := resultSlugs(skipped); !slices.Equal(got, []string{"t01"}) {
		t.Errorf("skipped %v", got)
	}

	rs[1].SchemaVersion = 9
	phases, _, failed, err := PlanPhases(rs, Plan{Target: 6, Canary: []string{"t01"}})
	if err != nil {
		t.Fatal(err)
	}
	if len(failed) != 1 || failed[0].Ref.Slug != "t01" || !errors.Is(failed[0].Err, ErrVersionAhead) {
		t.Errorf("ahead canary: failed %+v", failed)
	}
	if got := phaseNames(phases); !slices.Equal(got, []string{"batch 1:2"}) {
		t.Errorf("ahead canary: phases %v", got)
	}
}

// Возврат 1 (ревью, major): организация в provisioning не входит в план — ни canary по умолчанию, ни партии, даже
// названная в --canary; она в skipped с причиной ReasonProvisioning, её версия не важна.
func TestPlanPhasesSkipsProvisioning(t *testing.T) {
	t.Parallel()
	rs := refs(4)
	for i := range rs {
		rs[i].State = "active"
	}
	rs[0].SchemaVersion, rs[2].SchemaVersion = 6, 6
	rs[1].State = StateProvisioning // the first tenant that «needs» the migration: not the canary
	phases, skipped, failed, err := PlanPhases(rs, Plan{Target: 6})
	if err != nil {
		t.Fatal(err)
	}
	if got := phaseNames(phases); !slices.Equal(got, []string{"canary:1"}) || phases[0].Tenants[0].Slug != "t03" {
		t.Fatalf("phases %v, want canary t03", got)
	}
	if got := resultSlugs(skipped); !slices.Equal(got, []string{"t00", "t01", "t02"}) {
		t.Errorf("skipped %v", got)
	}
	if skipped[1].Reason != ReasonProvisioning || skipped[0].Reason != "" {
		t.Errorf("reasons %q %q", skipped[0].Reason, skipped[1].Reason)
	}
	if len(failed) != 0 {
		t.Errorf("failed %+v", failed)
	}

	phases, skipped, _, err = PlanPhases(rs, Plan{Target: 6, Canary: []string{"t01"}})
	if err != nil {
		t.Fatal(err)
	}
	if got := phaseNames(phases); !slices.Equal(got, []string{"batch 1:1"}) {
		t.Errorf("named canary in provisioning: phases %v", got)
	}
	if !slices.Contains(resultSlugs(skipped), "t01") {
		t.Errorf("named canary in provisioning not skipped: %v", resultSlugs(skipped))
	}
}

// Пустой реестр — пустой план без ошибки (стенд до сида).
func TestPlanPhasesEmpty(t *testing.T) {
	t.Parallel()
	phases, skipped, failed, err := PlanPhases(nil, Plan{Target: 6})
	if err != nil || len(phases)+len(skipped)+len(failed) != 0 {
		t.Fatalf("empty registry: %v %v %v %v", phases, skipped, failed, err)
	}
}
