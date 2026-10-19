//go:build integration

package expenses_test

import (
	"fmt"
	"slices"
	"sync"
	"testing"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// codes are the codes of a page of the catalogue.
func codes(p fleetapi.ExpenseCategoryPage) []string {
	out := make([]string, 0, len(p.Items))
	for _, c := range p.Items {
		out = append(out, c.Code)
	}
	return out
}

func find(p fleetapi.ExpenseCategoryPage, code string) (fleetapi.ExpenseCategory, bool) {
	i := slices.IndexFunc(p.Items, func(c fleetapi.ExpenseCategory) bool { return c.Code == code })
	if i < 0 {
		return fleetapi.ExpenseCategory{}, false
	}
	return p.Items[i], true
}

var seedCodes = []string{"fuel", "wash", "parking", "toll", "tire_service", "other"}

// TestCategoriesSeed: every tenant has the six seed categories of D-12 (answer of 17.10, tenant 0015) in the order of
// the catalogue; the driver, the manager and the owner read them (fleet.expenses.read in any scope); a member without
// the right in any scope — 403.
func TestCategoriesSeed(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	for _, actor := range []string{"a.owner", "a.manager-msk1", "a.driver-msk1"} {
		p, err := e.svc.Categories(ctx, e.tc(t, actor, "a"), false)
		if err != nil {
			t.Fatalf("%s: %v", actor, err)
		}
		got := slices.DeleteFunc(codes(p), func(c string) bool { return !slices.Contains(seedCodes, c) })
		if !slices.Equal(got, seedCodes) {
			t.Fatalf("%s: seed %v, want %v", actor, got, seedCodes)
		}
		expect(t, actor, p, p.NextCursor == nil)
	}
	p, err := e.svc.Categories(ctx, e.tc(t, "b.owner", "b"), false)
	if err != nil || !slices.Equal(codes(p), seedCodes) {
		t.Fatalf("tenant B: %v, %v", codes(p), err)
	}
	other, _ := find(p, "other")
	fuel, _ := find(p, "fuel")
	expect(t, "seed", p, other.CommentRequired, other.Seeded, other.Label == "Прочее", !fuel.CommentRequired,
		fuel.Label == "Топливо", fuel.State == fleetapi.ExpenseCategoryStateActive, fuel.Revision == 1)
	_, err = e.svc.Categories(ctx, e.tc(t, "ab.member", "a"), false) // the observer: no fleet.expenses.read
	wantProblem(t, err, problem.CodeForbiddenAction, "")
}

// TestCreateCategory: the owner adds a category — custom_<N> or the given code, the label unique among the active ones
// without regard to case; the audit row; a member without modules.settings.manage over the tenant — 403.
func TestCreateCategory(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	owner := e.tc(t, "a.owner", "a")
	n := seq.Add(1)
	label := fmt.Sprintf("Ремни и стяжки %d", n)
	c, err := e.svc.CreateCategory(ctx, owner, fleetapi.ExpenseCategoryCreate{Label: "  " + label + " "})
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	expect(t, "created", c, c.Label == label, len(c.Code) > len("custom_") && c.Code[:7] == "custom_", !c.Seeded,
		!c.CommentRequired, c.State == fleetapi.ExpenseCategoryStateActive, c.Revision == 1, !c.CreatedAt.IsZero())
	d := dbs["a"]
	expect(t, "audit", nil, scalar[int](t, d, `select count(*) from audit.events where action = 'fleet.expense_category.create'
	   and diff->>'code' = $1`, c.Code) == 1)
	expect(t, "created by", nil, scalar[bool](t, d, `select created_by = $2 from fleet.expense_categories where code = $1`,
		c.Code, person("a.owner")))

	code := fmt.Sprintf("night_parking_%d", n)
	own, err := e.svc.CreateCategory(ctx, owner, fleetapi.ExpenseCategoryCreate{
		Label: fmt.Sprintf("Стоянка на ночь %d", n), CommentRequired: true, Code: &code})
	if err != nil {
		t.Fatalf("CreateCategory with a code: %v", err)
	}
	expect(t, "with a code", own, own.Code == code, own.CommentRequired)

	for name, b := range map[string]fleetapi.ExpenseCategoryCreate{
		"label of a seed category": {Label: " мойка "},
		"label of the owner":       {Label: label},
		"code of a seed category":  {Label: fmt.Sprintf("Новая %d", n), Code: new("fuel")},
		"code of the owner":        {Label: fmt.Sprintf("Другая %d", n), Code: &code},
	} {
		_, err := e.svc.CreateCategory(ctx, owner, b)
		wantProblem(t, err, "validation_failed", "Такая категория уже есть.")
		if t.Failed() {
			t.Fatalf("%s", name)
		}
	}
	_, err = e.svc.CreateCategory(ctx, owner, fleetapi.ExpenseCategoryCreate{Label: " "})
	wantProblem(t, err, "validation_failed", "Укажите название категории.")
	for _, actor := range []string{"a.manager-msk1", "a.driver-msk1", "a.admin"} {
		_, err = e.svc.CreateCategory(ctx, e.tc(t, actor, "a"), fleetapi.ExpenseCategoryCreate{Label: "Чужая"})
		wantProblem(t, err, problem.CodeForbiddenAction, "")
	}
	page, err := e.svc.Categories(ctx, owner, false)
	if err != nil {
		t.Fatalf("Categories: %v", err)
	}
	i, j := slices.Index(codes(page), c.Code), slices.Index(codes(page), code)
	expect(t, "order", codes(page), i > slices.Index(codes(page), "other"), j > i)
}

// TestCreateCategoryConcurrently: creations without a code never collide — each takes the next free custom_<N>
// (contract: «such creations never answer 409»).
func TestCreateCategoryConcurrently(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.tc(t, "a.owner", "a")
	n := seq.Add(1)
	const parallel = 6
	var (
		wg   sync.WaitGroup
		mu   sync.Mutex
		got  []string
		errs []error
	)
	for i := range parallel {
		wg.Go(func() {
			c, err := e.svc.CreateCategory(t.Context(), owner, fleetapi.ExpenseCategoryCreate{
				Label: fmt.Sprintf("Параллельная %d-%d", n, i)})
			mu.Lock()
			defer mu.Unlock()
			got, errs = append(got, c.Code), append(errs, err)
		})
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatalf("concurrent CreateCategory: %v", err)
		}
	}
	slices.Sort(got)
	if len(slices.Compact(got)) != parallel {
		t.Fatalf("codes %v, want %d distinct", got, parallel)
	}
	distinctSortOrder(t, got)
}

// distinctSortOrder: the catalogue is ordered «by creation» — concurrent creations never share a sort_order, else the
// code decides and custom_10 goes before custom_2 (return 1 of W2.41).
func distinctSortOrder(t *testing.T, got []string) {
	t.Helper()
	sorts := scalar[int](t, dbs["a"], `select count(distinct sort_order) from fleet.expense_categories
	   where code = any($1)`, got)
	if sorts != len(got) {
		t.Fatalf("%d distinct sort_order for %d concurrent creations %v", sorts, len(got), got)
	}
}

// TestCreateCategoryConcurrentlyWithCodes: concurrent creations with their own codes do not collide on the code, so
// only the order of the catalogue tells them apart — each one gets its own sort_order (return 1 of W2.41).
func TestCreateCategoryConcurrentlyWithCodes(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	owner := e.tc(t, "a.owner", "a")
	n := seq.Add(1)
	const parallel = 8
	var (
		wg    sync.WaitGroup
		mu    sync.Mutex
		got   []string
		errs  []error
		start = make(chan struct{})
	)
	for i := range parallel {
		wg.Go(func() {
			code := fmt.Sprintf("parallel_%d_%d", n, i)
			<-start
			_, err := e.svc.CreateCategory(t.Context(), owner, fleetapi.ExpenseCategoryCreate{
				Label: fmt.Sprintf("Своя параллельная %d-%d", n, i), Code: &code})
			mu.Lock()
			defer mu.Unlock()
			got, errs = append(got, code), append(errs, err)
		})
	}
	close(start)
	wg.Wait()
	for _, err := range errs {
		if err != nil {
			t.Fatalf("concurrent CreateCategory: %v", err)
		}
	}
	distinctSortOrder(t, got)
}

// TestArchiveCategory: archiving needs the ETag of the category; «Прочее» and an archived category — 409, an unknown
// code — 404; an archived one leaves the active list, stays with includeArchived and keeps its expenses.
func TestArchiveCategory(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	owner := e.tc(t, "a.owner", "a")
	c, err := e.svc.CreateCategory(ctx, owner, fleetapi.ExpenseCategoryCreate{Label: fmt.Sprintf("В архив %d", seq.Add(1))})
	if err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	_, err = e.svc.ArchiveCategory(ctx, owner, c.Code, "")
	wantProblem(t, err, "revision_required", "")
	_, err = e.svc.ArchiveCategory(ctx, owner, c.Code, `"rev-2"`)
	wantProblem(t, err, "revision_mismatch", "Данные изменились. Обновите страницу и повторите.")
	_, err = e.svc.ArchiveCategory(ctx, e.tc(t, "a.manager-msk1", "a"), c.Code, `"rev-1"`)
	wantProblem(t, err, problem.CodeForbiddenAction, "")
	got, err := e.svc.ArchiveCategory(ctx, owner, c.Code, `"rev-1"`)
	if err != nil {
		t.Fatalf("ArchiveCategory: %v", err)
	}
	expect(t, "archived", got, got.State == fleetapi.ExpenseCategoryStateArchived, got.Revision == 2,
		got.ArchivedAt != nil, got.ArchivedByMemberId != nil && *got.ArchivedByMemberId == person("a.owner"))
	_, err = e.svc.ArchiveCategory(ctx, owner, c.Code, `"rev-2"`)
	wantProblem(t, err, "invalid_transition", "Категория уже в архиве.")
	_, err = e.svc.ArchiveCategory(ctx, owner, "other", `"rev-1"`)
	wantProblem(t, err, "invalid_transition", "Категорию «Прочее» нельзя убрать.")
	_, err = e.svc.ArchiveCategory(ctx, owner, "no_such_code", `"rev-1"`)
	wantProblem(t, err, problem.CodeNotFound, "Категория не найдена.")
	_, err = e.svc.ArchiveCategory(ctx, e.tc(t, "b.owner", "b"), c.Code, `"rev-1"`)
	wantProblem(t, err, problem.CodeNotFound, "Категория не найдена.")
	d := dbs["a"]
	expect(t, "audit", nil, scalar[int](t, d, `select count(*) from audit.events where action = 'fleet.expense_category.archive'
	   and diff->>'code' = $1`, c.Code) == 1)

	activeOnly, err := e.svc.Categories(ctx, owner, false)
	if err != nil {
		t.Fatalf("Categories: %v", err)
	}
	all, err := e.svc.Categories(ctx, e.tc(t, "a.driver-msk1", "a"), true)
	if err != nil {
		t.Fatalf("Categories includeArchived: %v", err)
	}
	kept, ok := find(all, c.Code)
	_, listed := find(activeOnly, c.Code)
	expect(t, "lists", all, !listed, ok && kept.State == fleetapi.ExpenseCategoryStateArchived)

	// A label of an archived category is free again (the label is unique among the active ones only).
	again, err := e.svc.CreateCategory(ctx, owner, fleetapi.ExpenseCategoryCreate{Label: c.Label})
	if err != nil || again.Code == c.Code {
		t.Fatalf("label of an archived category: %+v, %v", again, err)
	}
}

// TestExpenseByCatalogue: createTripExpense takes the category from the catalogue of the tenant (W2.41): unknown —
// «Категория расхода не найдена.», archived — «Категория в архиве — выберите другую.», commentRequired without a
// comment — «Для категории «{label}» добавьте комментарий»; a category of the owner with a comment passes; an expense
// keeps its category after the archive.
func TestExpenseByCatalogue(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := t.Context()
	owner := e.tc(t, "a.owner", "a")
	drv := e.tc(t, "a.driver-msk1", "a")
	tr := seedTrip(t, "msk1", person("a.driver-msk1"), "rework")
	n := seq.Add(1)
	code := fmt.Sprintf("night_%d", n)
	label := fmt.Sprintf("Стоянка на ночь %d", n)
	if _, err := e.svc.CreateCategory(ctx, owner, fleetapi.ExpenseCategoryCreate{Label: label, CommentRequired: true, Code: &code}); err != nil {
		t.Fatalf("CreateCategory: %v", err)
	}
	unknown := wash(t, tr)
	unknown.Kind = "fine"
	_, err := e.svc.Create(ctx, drv, tr.ID, unknown)
	wantProblem(t, err, "validation_failed", "Категория расхода не найдена.")
	bare := wash(t, tr)
	bare.Kind = code
	_, err = e.svc.Create(ctx, drv, tr.ID, bare)
	wantProblem(t, err, "validation_failed", "Для категории «"+label+"» добавьте комментарий")
	bare.Comment = new("Охраняемая стоянка, Химки")
	x, err := e.svc.Create(ctx, drv, tr.ID, bare)
	if err != nil {
		t.Fatalf("expense of a category of the owner: %v", err)
	}
	expect(t, "expense", x, x.Kind == code)
	if _, err := e.svc.ArchiveCategory(ctx, owner, code, `"rev-1"`); err != nil {
		t.Fatalf("ArchiveCategory: %v", err)
	}
	later := wash(t, tr)
	later.Kind, later.Comment = code, new("Ещё одна ночь")
	_, err = e.svc.Create(ctx, drv, tr.ID, later)
	wantProblem(t, err, "validation_failed", "Категория в архиве — выберите другую.")
	kept, err := e.svc.Get(ctx, drv, tr.ID, x.Id)
	if err != nil || kept.Kind != code {
		t.Fatalf("expense after the archive: %+v, %v", kept, err)
	}
}
