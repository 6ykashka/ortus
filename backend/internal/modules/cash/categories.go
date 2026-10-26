package cash

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// ListCategories returns the catalogue of cash categories («статьи»), a seeded one that is read only in the pilot
// (Q-W4.00-cash-9): any role with cash.read in some area reads it.
func (s *Service) ListCategories(ctx context.Context, tc tenantctx.TenantContext) (cashapi.CashCategoryList, error) {
	out := cashapi.CashCategoryList{Items: []cashapi.CashCategory{}}
	err := s.inTx(ctx, tc, func(tx pgx.Tx) error {
		ev := s.evaluator(tx)
		// the catalogue belongs to no account: a reader of any account reads it (the gateway admitted cash.read)
		pred, err := ev.ScopeQuery(ctx, tc, actionRead, authz.Columns{Unit: "a.org_unit_id", Objects: map[string]string{authz.KindAccount: areaOf("a")},
			Persons: []string{"a.holder_id"}}, 0)
		if err != nil {
			return err
		}
		var ok bool
		if err := tx.QueryRow(ctx, `select exists (select 1 from cash.accounts a where `+pred.SQL+`)`, pred.Args...).Scan(&ok); err != nil {
			return fmt.Errorf("cash: categories access: %w", err)
		}
		if !ok && !tc.Owner {
			if err := ev.Permit(ctx, tc, actionRead, authz.Resource{}); err != nil {
				return err
			}
		}
		rows, err := tx.Query(ctx, `select id, title, group_name, direction, module_key, expense_category_code from cash.categories order by sort_order, id`)
		if err != nil {
			return fmt.Errorf("cash: categories: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var (
				c         cashapi.CashCategory
				group     string
				direction *string
			)
			if err := rows.Scan(&c.Id, &c.Title, &group, &direction, &c.ModuleKey, &c.ExpenseCategoryCode); err != nil {
				return fmt.Errorf("cash: categories: %w", err)
			}
			c.Group = cashapi.CashCategoryGroup(group)
			if direction != nil {
				d := cashapi.CashCategoryDirection(*direction)
				c.Direction = &d
			}
			out.Items = append(out.Items, c)
		}
		return rows.Err()
	})
	return out, err
}
