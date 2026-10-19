package expenses

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// TestValidateCategory: the body of createExpenseCategory — a label of 1…100 characters after trimming, an optional
// code of the contract pattern (W2.52, 0.6.1-stage2).
func TestValidateCategory(t *testing.T) {
	t.Parallel()
	wantProblem(t, second(validateCategory(nil)), problem.CodeMalformedRequest, "")
	label, err := validateCategory(&fleetapi.ExpenseCategoryCreate{Label: "  Стоянка на ночь ", CommentRequired: true})
	if err != nil || label != "Стоянка на ночь" {
		t.Fatalf("validateCategory = %q, %v", label, err)
	}
	for _, blank := range []string{"", "   ", "\t"} {
		wantProblem(t, second(validateCategory(&fleetapi.ExpenseCategoryCreate{Label: blank})), codeValidation, textCategoryLabel)
	}
	long := &fleetapi.ExpenseCategoryCreate{Label: strings.Repeat("я", 101)}
	wantProblem(t, second(validateCategory(long)), codeValidation, textCategoryLabelLong)
	if _, err := validateCategory(&fleetapi.ExpenseCategoryCreate{Label: strings.Repeat("я", 100)}); err != nil {
		t.Errorf("100 characters: %v", err)
	}
	for _, code := range []string{"Fuel", "1fuel", "a", "night-parking", strings.Repeat("a", 51), "ночь"} {
		b := &fleetapi.ExpenseCategoryCreate{Label: "Стоянка", Code: new(code)}
		wantProblem(t, second(validateCategory(b)), codeValidation, textCategoryCode)
	}
	if _, err := validateCategory(&fleetapi.ExpenseCategoryCreate{Label: "Стоянка", Code: new("night_parking")}); err != nil {
		t.Errorf("night_parking: %v", err)
	}
}

// TestCategoryRevision: the ETag of a category is "rev-<revision>" — the form of the mock W2.52: listExpenseCategories
// carries no ETag of its items, the client takes If-Match of the archive from ExpenseCategory.revision (Q-W2.41-1).
func TestCategoryRevision(t *testing.T) {
	t.Parallel()
	if got := categoryETag(3); got != `"rev-3"` {
		t.Fatalf("categoryETag(3) = %s", got)
	}
	wantProblem(t, checkCategoryRevision("", 1), codeRevisionRequired, "")
	wantProblem(t, checkCategoryRevision(" ", 1), codeRevisionRequired, "")
	wantProblem(t, checkCategoryRevision(`"rev-2"`, 1), codeRevisionMismatch, textStale)
	wantProblem(t, checkCategoryRevision(`"1"`, 1), codeRevisionMismatch, textStale)
	if err := checkCategoryRevision(`"rev-1"`, 1); err != nil {
		t.Fatalf("matching revision: %v", err)
	}
}

// TestCheckKind: an expense takes an active category of the catalogue; one with commentRequired needs a comment
// («Прочее» — the text of W2.40).
func TestCheckKind(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	wash := &category{code: "wash", label: "Мойка"}
	other := &category{code: "other", label: "Прочее", commentRequired: true, seeded: true}
	night := &category{code: "night_parking", label: "Стоянка на ночь", commentRequired: true}
	gone := &category{code: "toll", label: "Платная дорога", archivedAt: &at}
	b := body("wash")
	if err := checkKind(wash, &b); err != nil {
		t.Fatalf("wash: %v", err)
	}
	wantProblem(t, checkKind(nil, &b), codeValidation, textKindUnknown)
	wantProblem(t, checkKind(gone, &b), codeValidation, textKindArchived)
	wantProblem(t, checkKind(other, &b), codeValidation, textOtherComment)
	wantProblem(t, checkKind(night, &b), codeValidation, "Для категории «Стоянка на ночь» добавьте комментарий")
	b.Comment = new("  ")
	wantProblem(t, checkKind(night, &b), codeValidation, "Для категории «Стоянка на ночь» добавьте комментарий")
	b.Comment = new("Охраняемая стоянка, Химки")
	if err := checkKind(night, &b); err != nil {
		t.Fatalf("night_parking with a comment: %v", err)
	}
}

// TestCategoryDTO: ExpenseCategory of a row — state, archive fields only for an archived one.
func TestCategoryDTO(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	by := uuid.New()
	live := category{code: "fuel", label: "Топливо", seeded: true, createdAt: at, revision: 1}.dto()
	if live.State != fleetapi.ExpenseCategoryStateActive || live.ArchivedAt != nil || live.ArchivedByMemberId != nil ||
		!live.Seeded || live.Revision != 1 || live.Code != "fuel" || live.Label != "Топливо" || !live.CreatedAt.Equal(at) {
		t.Fatalf("active dto = %+v", live)
	}
	gone := category{code: "toll", label: "Платная дорога", archivedAt: &at, archivedBy: &by, revision: 2}.dto()
	if gone.State != fleetapi.ExpenseCategoryStateArchived || gone.ArchivedAt == nil || *gone.ArchivedByMemberId != by {
		t.Fatalf("archived dto = %+v", gone)
	}
}

// TestCategoryServer: the catalogue operations answer without a tenant context like a missing tenant (404), a create
// without a body is malformed; the other operations go to the base (nil: 501).
func TestCategoryServer(t *testing.T) {
	t.Parallel()
	h := NewCategoryServer(nil, &Service{})
	ctx := context.Background()
	for name, err := range map[string]error{
		"ListExpenseCategories":  second(h.ListExpenseCategories(ctx, fleetapi.ListExpenseCategoriesRequestObject{})),
		"CreateExpenseCategory":  second(h.CreateExpenseCategory(ctx, fleetapi.CreateExpenseCategoryRequestObject{})),
		"ArchiveExpenseCategory": second(h.ArchiveExpenseCategory(ctx, fleetapi.ArchiveExpenseCategoryRequestObject{})),
	} {
		if !problem.Is(err, problem.CodeNotFound) {
			t.Errorf("%s: %v, want not_found", name, err)
		}
	}
	tc := tenantctx.WithTenant(ctx, tenantctx.TenantContext{TenantID: uuid.New()})
	if _, err := h.CreateExpenseCategory(tc, fleetapi.CreateExpenseCategoryRequestObject{}); !problem.Is(err, problem.CodeMalformedRequest) {
		t.Errorf("CreateExpenseCategory without a body: %v, want malformed_request", err)
	}
	if _, err := h.CreateTripExpense(ctx, fleetapi.CreateTripExpenseRequestObject{}); !problem.Is(err, problem.CodeNotImplemented) {
		t.Errorf("CreateTripExpense (W2.05): %v, want the base 501", err)
	}
}
