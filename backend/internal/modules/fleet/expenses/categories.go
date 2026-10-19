package expenses

// The catalogue of expense categories of the tenant (W2.41, D-12 комплекта — answer of the product owner of 17.10;
// contract 0.6.1-stage2, tenant 0015 fleet.expense_categories): the six seed categories (fuel, wash, parking, toll,
// tire_service, other) and those the owner adds. Any holder of fleet.expenses.read in any scope reads it — the driver
// form, the shift review; the owner (modules.settings.manage over the tenant — settings of the module, Q-W2.52-1) adds
// and archives. «Прочее» always needs a comment and is never archived (Q-W2.52-3); there is no rename and no return
// from the archive (Q-W2.52-2). An archived category stays with the expenses that carry it and is refused for new ones.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// actionSettings changes the catalogue: the settings of the module (x-scope tenant).
const actionSettings = "modules.settings.manage"

const (
	codeRevisionRequired = "revision_required"
	codeRevisionMismatch = "revision_mismatch"
)

// Texts of the answers: the contract (descriptions, examples of W2.52) and the mock (msw/fleet/expenses.ts).
const (
	textKindUnknown       = "Категория расхода не найдена."
	textKindArchived      = "Категория в архиве — выберите другую."
	textCommentFor        = "Для категории «%s» добавьте комментарий"
	textCategoryLabel     = "Укажите название категории."
	textCategoryLabelLong = "Название — не длиннее 100 символов."
	textCategoryCode      = "Код категории — строчные латинские буквы, цифры и «_», от 2 до 50 символов."
	textCategoryDuplicate = "Такая категория уже есть."
	textCategoryNotFound  = "Категория не найдена."
	textOtherArchive      = "Категорию «Прочее» нельзя убрать."
	textAlreadyArchived   = "Категория уже в архиве."
	textStale             = "Данные изменились. Обновите страницу и повторите."
)

const (
	targetCategory   = "fleet.expense_category"
	maxLabel         = 100
	customPrefix     = "custom_"
	sqlUnique        = "23505"
	constraintLabels = "expense_categories_label_uq"
	// maxCustomTries bounds the retries of the next free custom_<N> of concurrent creations without a code.
	maxCustomTries = 20
)

// codeRE is the pattern of ExpenseCategory.code and TripExpense.kind of the contract.
var codeRE = regexp.MustCompile(`^[a-z][a-z0-9_]{1,49}$`)

// category is a row of fleet.expense_categories.
type category struct {
	code, label     string
	commentRequired bool
	seeded          bool
	createdAt       time.Time
	archivedAt      *time.Time
	archivedBy      *uuid.UUID
	revision        int64
}

const categorySelect = `
select code, label, comment_required, seeded, created_at, archived_at, archived_by, revision
  from fleet.expense_categories`

func scanCategory(row pgx.Row) (category, error) {
	var c category
	err := row.Scan(&c.code, &c.label, &c.commentRequired, &c.seeded, &c.createdAt, &c.archivedAt, &c.archivedBy, &c.revision)
	return c, err
}

// dto is ExpenseCategory of the contract: the archive fields only for an archived category.
func (c category) dto() fleetapi.ExpenseCategory {
	out := fleetapi.ExpenseCategory{
		Code: c.code, Label: c.label, CommentRequired: c.commentRequired, Seeded: c.seeded,
		State: fleetapi.ExpenseCategoryStateActive, CreatedAt: c.createdAt.UTC(), Revision: c.revision,
	}
	if c.archivedAt != nil {
		at := c.archivedAt.UTC()
		out.State, out.ArchivedAt, out.ArchivedByMemberId = fleetapi.ExpenseCategoryStateArchived, &at, c.archivedBy
	}
	return out
}

// validateCategory checks the body of createExpenseCategory and returns the trimmed label.
func validateCategory(b *fleetapi.ExpenseCategoryCreate) (string, error) {
	if b == nil {
		return "", problem.New(problem.CodeMalformedRequest, "")
	}
	label := strings.TrimSpace(b.Label)
	switch {
	case label == "":
		return "", invalid(textCategoryLabel)
	case utf8.RuneCountInString(label) > maxLabel:
		return "", invalid(textCategoryLabelLong)
	case b.Code != nil && !codeRE.MatchString(*b.Code):
		return "", invalid(textCategoryCode)
	}
	return label, nil
}

// categoryETag is the ETag of a category, "rev-<revision>" — the form of the mock (W2.52): listExpenseCategories
// carries no ETag of its items and there is no read of one category, so the client builds If-Match of the archive from
// ExpenseCategory.revision the same way for the mock and the stand (Q-W2.41-1).
func categoryETag(revision int64) string { return `"rev-` + strconv.FormatInt(revision, 10) + `"` }

func checkCategoryRevision(ifMatch string, current int64) error {
	v := strings.TrimSpace(ifMatch)
	switch {
	case v == "":
		return problem.New(codeRevisionRequired, "")
	case v != categoryETag(current):
		return problem.New(codeRevisionMismatch, textStale)
	}
	return nil
}

// checkKind checks the category of a new expense: an active category of the catalogue; one with commentRequired needs
// a non-blank comment (for «Прочее» the text is the one of W2.40).
func checkKind(c *category, b *fleetapi.TripExpenseCreate) error {
	switch {
	case c == nil:
		return invalid(textKindUnknown)
	case c.archivedAt != nil:
		return invalid(textKindArchived)
	case c.commentRequired && blank(b.Comment):
		return invalid(fmt.Sprintf(textCommentFor, c.label))
	}
	return nil
}

// kindOf reads the category code of an expense in tx (for share: an archive waits for the expense, or the expense
// sees the archive); a missing code is nil.
func kindOf(ctx context.Context, tx pgx.Tx, code string) (*category, error) {
	c, err := scanCategory(tx.QueryRow(ctx, categorySelect+` where code = $1 for share`, code))
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return nil, nil
	case err != nil:
		return nil, fmt.Errorf("expenses: category: %w", err)
	}
	return &c, nil
}

// readerColumns weigh fleet.expenses.read in any scope (tenant, unit, self); the statement is never run.
var readerColumns = authz.Columns{Unit: "unit_id", Persons: []string{"person_id"}}

// Categories returns the catalogue (listExpenseCategories): seed first, then by creation; archived ones only with
// includeArchived. A member without fleet.expenses.read in any scope — 403 (the gateway refuses it first).
func (s *Service) Categories(ctx context.Context, tc tenantctx.TenantContext, includeArchived bool) (fleetapi.ExpenseCategoryPage, error) {
	page := fleetapi.ExpenseCategoryPage{Items: []fleetapi.ExpenseCategory{}}
	pool, err := s.pool(ctx, tc)
	if err != nil {
		return page, err
	}
	p, err := s.Authz.ScopeQuery(ctx, tc, actionRead, readerColumns, 0)
	if err != nil {
		return page, dbError(err)
	}
	if p.SQL == "false" {
		return page, problem.New(problem.CodeForbiddenAction, "")
	}
	rows, err := pool.Query(ctx, categorySelect+` where $1 or archived_at is null order by sort_order, code`, includeArchived)
	if err != nil {
		return page, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (category, error) { return scanCategory(r) })
	if err != nil {
		return page, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	for _, c := range list {
		page.Items = append(page.Items, c.dto())
	}
	return page, nil
}

// permitSettings checks modules.settings.manage of the subject over the tenant (a grant of a unit does not count).
func (s *Service) permitSettings(ctx context.Context, tc tenantctx.TenantContext) error {
	return s.Authz.Permit(ctx, tc, actionSettings, authz.Resource{})
}

// CreateCategory adds a category of the owner (createExpenseCategory): the given code or the next free custom_<N>;
// a code or an active label already used (case-insensitive) — 422. Writes an audit row.
func (s *Service) CreateCategory(ctx context.Context, tc tenantctx.TenantContext, b fleetapi.ExpenseCategoryCreate) (fleetapi.ExpenseCategory, error) {
	if tc.TenantID == uuid.Nil {
		return fleetapi.ExpenseCategory{}, problem.New(problem.CodeNotFound, "")
	}
	if err := s.permitSettings(ctx, tc); err != nil {
		return fleetapi.ExpenseCategory{}, err
	}
	label, err := validateCategory(&b)
	if err != nil {
		return fleetapi.ExpenseCategory{}, err
	}
	var out fleetapi.ExpenseCategory
	err = s.inTx(ctx, tc, func(tx pgx.Tx) error {
		c, err := insertCategory(ctx, tx, tc, b, label)
		if err != nil {
			return err
		}
		out = c.dto()
		if err := audit.Record(ctx, tx, audit.Event{ActorKind: audit.ActorPerson, ActorID: tc.PersonID,
			Action: "fleet.expense_category.create", TargetType: targetCategory, Result: audit.OK, RequestID: requestID(ctx),
			Diff: map[string]any{"code": c.code, "label": c.label, "commentRequired": c.commentRequired}}); err != nil {
			return fmt.Errorf("expenses: audit: %w", err)
		}
		return complete(ctx, tx, http.StatusCreated, categoryETag(out.Revision), out)
	})
	return out, err
}

const insertCategorySQL = `
insert into fleet.expense_categories (code, label, comment_required, sort_order, created_by)
values ($1, $2, $3, (select coalesce(max(sort_order), 0) + 10 from fleet.expense_categories), $4)
on conflict (code) do nothing
returning code, label, comment_required, seeded, created_at, archived_at, archived_by, revision`

// nextCustomSQL is the next custom_<N> after those already taken (numbers of the codes custom_<digits>).
const nextCustomSQL = `
select coalesce(max(substring(code from '^custom_([0-9]{1,9})$')::bigint), 0) + 1 from fleet.expense_categories`

// createLockKey serializes the creations of a tenant's categories (transaction-scoped advisory lock): sort_order is
// max + 10, and two concurrent creations would otherwise read the same max, leaving their order to the code
// (custom_10 before custom_2) while the contract orders the catalogue «by creation» (return 1 of W2.41).
const createLockKey = "fleet.expense_categories.create:"

// insertCategory inserts the category: on conflict of the code nothing is inserted — a given code is a duplicate, a
// custom_<N> taken by a concurrent creation is retried with the next number (such creations never answer 409).
func insertCategory(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, b fleetapi.ExpenseCategoryCreate, label string) (category, error) {
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, createLockKey+tc.TenantID.String()); err != nil {
		return category{}, fmt.Errorf("expenses: lock categories: %w", err)
	}
	for range maxCustomTries {
		code := ""
		if b.Code != nil {
			code = *b.Code
		} else {
			var n int64
			if err := tx.QueryRow(ctx, nextCustomSQL).Scan(&n); err != nil {
				return category{}, fmt.Errorf("expenses: next custom code: %w", err)
			}
			code = customPrefix + strconv.FormatInt(n, 10)
		}
		c, err := scanCategory(tx.QueryRow(ctx, insertCategorySQL, code, label, b.CommentRequired, tc.PersonID))
		var pe *pgconn.PgError
		switch {
		case err == nil:
			return c, nil
		case errors.As(err, &pe) && pe.Code == sqlUnique && pe.ConstraintName == constraintLabels:
			return category{}, invalid(textCategoryDuplicate)
		case !errors.Is(err, pgx.ErrNoRows):
			return category{}, fmt.Errorf("expenses: insert category: %w", err)
		case b.Code != nil:
			return category{}, invalid(textCategoryDuplicate)
		}
	}
	return category{}, problem.New(problem.CodeDependencyUnavailable, "")
}

// ArchiveCategory archives a category (archiveExpenseCategory, If-Match of its ETag): «Прочее» and an archived one —
// 409 invalid_transition, an unknown code — 404. The expenses that carry it keep it. Writes an audit row.
func (s *Service) ArchiveCategory(ctx context.Context, tc tenantctx.TenantContext, code, ifMatch string) (fleetapi.ExpenseCategory, error) {
	if tc.TenantID == uuid.Nil {
		return fleetapi.ExpenseCategory{}, problem.New(problem.CodeNotFound, "")
	}
	if err := s.permitSettings(ctx, tc); err != nil {
		return fleetapi.ExpenseCategory{}, err
	}
	var out fleetapi.ExpenseCategory
	err := s.inTx(ctx, tc, func(tx pgx.Tx) error {
		c, err := scanCategory(tx.QueryRow(ctx, categorySelect+` where code = $1 for update`, code))
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			return problem.New(problem.CodeNotFound, textCategoryNotFound)
		case err != nil:
			return fmt.Errorf("expenses: category: %w", err)
		}
		if err := checkCategoryRevision(ifMatch, c.revision); err != nil {
			return err
		}
		switch {
		case c.code == kindOther:
			return problem.New(codeInvalidTransition, textOtherArchive)
		case c.archivedAt != nil:
			return problem.New(codeInvalidTransition, textAlreadyArchived)
		}
		c, err = scanCategory(tx.QueryRow(ctx, `update fleet.expense_categories
		    set archived_at = $2, archived_by = $3, revision = revision + 1 where code = $1
		  returning code, label, comment_required, seeded, created_at, archived_at, archived_by, revision`,
			code, s.now(), tc.PersonID))
		if err != nil {
			return fmt.Errorf("expenses: archive category: %w", err)
		}
		out = c.dto()
		if err := audit.Record(ctx, tx, audit.Event{ActorKind: audit.ActorPerson, ActorID: tc.PersonID,
			Action: "fleet.expense_category.archive", TargetType: targetCategory, Result: audit.OK, RequestID: requestID(ctx),
			Diff: map[string]any{"code": c.code, "label": c.label}}); err != nil {
			return fmt.Errorf("expenses: audit: %w", err)
		}
		return complete(ctx, tx, http.StatusOK, categoryETag(out.Revision), out)
	})
	return out, err
}
