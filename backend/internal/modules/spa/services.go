package spa

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	api "github.com/ortus/ortus-crm/backend/internal/api/spa"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

const (
	textServiceNotFound = "Услуга не найдена."
	textUnitNotFound    = "Подразделение не найдено."
	textNameTaken       = "Услуга с таким названием в подразделении уже есть."
	textNothing         = "Нечего менять."
	textEquipment       = "Оборудование не найдено, не из этого подразделения или не используется."
	textEquipmentTwice  = "Оборудование указано дважды."
)

// serviceColumns: the visibility of a service is the org unit.
var serviceColumns = authz.Columns{Unit: "s.org_unit_id"}

const serviceSelect = `select s.id, s.org_unit_id, s.name, s.duration_minutes, s.buffer_before_minutes, s.buffer_after_minutes,
       s.price_minor, s.currency, s.required_equipment_ids, s.revision
  from spa.services s`

func scanService(row pgx.Row) (api.SpaService, error) {
	var (
		s     api.SpaService
		price int64
	)
	if err := row.Scan(&s.Id, &s.OrgUnitId, &s.Name, &s.DurationMinutes, &s.BufferBeforeMinutes, &s.BufferAfterMinutes,
		&price, &s.Price.Currency, &s.RequiredEquipmentIds, &s.Revision); err != nil {
		return api.SpaService{}, err
	}
	s.Price.AmountMinor = int(price)
	if s.RequiredEquipmentIds == nil {
		s.RequiredEquipmentIds = []api.Id{}
	}
	s.Recipe = []api.ConsumptionRecipeLine{}
	return s, nil
}

// withRecipes reads the recipes of the services and puts them in.
func withRecipes(ctx context.Context, tx pgx.Tx, list []api.SpaService) error {
	if len(list) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, len(list))
	at := map[uuid.UUID]int{}
	for i, s := range list {
		ids[i], at[s.Id] = s.Id, i
	}
	rows, err := tx.Query(ctx, `select service_id, item_id, trim_scale(quantity)::text, unit from spa.service_recipe_lines
		 where service_id = any($1) order by service_id, line_no`, ids)
	if err != nil {
		return fmt.Errorf("spa: recipes: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id   uuid.UUID
			l    api.ConsumptionRecipeLine
			unit string
		)
		if err := rows.Scan(&id, &l.ItemId, &l.Quantity, &unit); err != nil {
			return fmt.Errorf("spa: recipes: %w", err)
		}
		l.Unit = api.ConsumptionRecipeLineUnit(unit)
		list[at[id]].Recipe = append(list[at[id]].Recipe, l)
	}
	return rows.Err()
}

// readService reads one service with its recipe; pgx.ErrNoRows when there is none.
func readService(ctx context.Context, tx pgx.Tx, id uuid.UUID) (api.SpaService, error) {
	s, err := scanService(tx.QueryRow(ctx, serviceSelect+` where s.id = $1`, id))
	if err != nil {
		return api.SpaService{}, err
	}
	list := []api.SpaService{s}
	if err := withRecipes(ctx, tx, list); err != nil {
		return api.SpaService{}, err
	}
	return list[0], nil
}

// ListServices lists the services of the units the member reads (spa.services.read), oldest first.
func (s *Service) ListServices(ctx context.Context, tc tenantctx.TenantContext, q PageQuery) (api.SpaServicePage, error) {
	limit, off, err := pageOf(q)
	if err != nil {
		return api.SpaServicePage{}, err
	}
	page := api.SpaServicePage{Items: []api.SpaService{}}
	err = s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		pred, err := ev.ScopeQuery(ctx, tc, actServicesRead, serviceColumns, 2)
		if err != nil {
			return err
		}
		rows, err := tx.Query(ctx, serviceSelect+` where (`+pred.SQL+`) order by s.created_at, s.id offset $1 limit $2`,
			append([]any{off, limit + 1}, pred.Args...)...)
		if err != nil {
			return fmt.Errorf("spa: services: %w", err)
		}
		all, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (api.SpaService, error) { return scanService(r) })
		if err != nil {
			return fmt.Errorf("spa: services: %w", err)
		}
		if page.Items, page.NextCursor = paged(all, off, limit); page.Items == nil {
			page.Items = []api.SpaService{}
		}
		return withRecipes(ctx, tx, page.Items)
	})
	return page, err
}

// GetService reads a service with its recipe; a service of a unit the member does not read is as missing.
func (s *Service) GetService(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (api.SpaService, error) {
	var out api.SpaService
	err := s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		var unit uuid.UUID
		err := tx.QueryRow(ctx, `select org_unit_id from spa.services where id = $1`, id).Scan(&unit)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New(problem.CodeNotFound, textServiceNotFound)
		}
		if err != nil {
			return fmt.Errorf("spa: service: %w", err)
		}
		if err := permitService(ctx, ev, tc, actServicesRead, unit); err != nil {
			return err
		}
		out, err = readService(ctx, tx, id)
		return err
	})
	return out, err
}

// permitService checks a right over the unit of a service: a unit the member does not read is as missing.
func permitService(ctx context.Context, ev Authorizer, tc tenantctx.TenantContext, action string, unit uuid.UUID) error {
	err := ev.Permit(ctx, tc, action, authz.Resource{Unit: unit, ReadAction: actServicesRead})
	if problem.Is(err, problem.CodeNotFound) {
		return problem.New(problem.CodeNotFound, textServiceNotFound)
	}
	return err
}

// itemUnits reads the base units of the items a recipe names (items in the archive are not offered).
func itemUnits(ctx context.Context, tx pgx.Tx, in []api.ConsumptionRecipeLine) (map[uuid.UUID]string, error) {
	ids := make([]uuid.UUID, 0, len(in))
	for _, l := range in {
		ids = append(ids, l.ItemId)
	}
	rows, err := tx.Query(ctx, `select id, base_unit from inventory.items where id = any($1) and not archived`, ids)
	if err != nil {
		return nil, fmt.Errorf("spa: item units: %w", err)
	}
	defer rows.Close()
	units := map[uuid.UUID]string{}
	for rows.Next() {
		var (
			id   uuid.UUID
			unit string
		)
		if err := rows.Scan(&id, &unit); err != nil {
			return nil, fmt.Errorf("spa: item units: %w", err)
		}
		units[id] = unit
	}
	return units, rows.Err()
}

// checkEquipment checks that every id is an active equipment item of the unit, given once.
func checkEquipment(ctx context.Context, tx pgx.Tx, unit uuid.UUID, ids []uuid.UUID, field string) error {
	seen := map[uuid.UUID]bool{}
	for i, id := range ids {
		if seen[id] {
			return invalid(fmt.Sprintf("%s[%d]", field, i), textEquipmentTwice)
		}
		seen[id] = true
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := tx.Query(ctx, `select id from sched.resources where id = any($1) and kind = 'equipment' and active and home_unit_id = $2`, ids, unit)
	if err != nil {
		return fmt.Errorf("spa: equipment: %w", err)
	}
	defer rows.Close()
	found := map[uuid.UUID]bool{}
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return fmt.Errorf("spa: equipment: %w", err)
		}
		found[id] = true
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("spa: equipment: %w", err)
	}
	for i, id := range ids {
		if !found[id] {
			return invalid(fmt.Sprintf("%s[%d]", field, i), textEquipment)
		}
	}
	return nil
}

// writeRecipe replaces the recipe lines of a service.
func writeRecipe(ctx context.Context, tx pgx.Tx, id uuid.UUID, lines []RecipeLine) error {
	if _, err := tx.Exec(ctx, `delete from spa.service_recipe_lines where service_id = $1`, id); err != nil {
		return fmt.Errorf("spa: clear recipe: %w", err)
	}
	for i, l := range lines {
		if _, err := tx.Exec(ctx, `insert into spa.service_recipe_lines (service_id, line_no, item_id, quantity, unit)
			values ($1, $2, $3, $4::numeric / 1000000, $5)`, id, i+1, l.Item, int64(l.Qty), l.Unit); err != nil {
			return fmt.Errorf("spa: recipe line: %w", err)
		}
	}
	return nil
}

// snapshotRevision keeps the state of the service at its revision: the visits booked on it keep it too.
func snapshotRevision(ctx context.Context, tx pgx.Tx, s api.SpaService) error {
	raw, err := json.Marshal(s)
	if err != nil {
		return fmt.Errorf("spa: snapshot: %w", err)
	}
	if _, err := tx.Exec(ctx, `insert into spa.service_revisions (service_id, revision, snapshot) values ($1, $2, $3)`, s.Id, s.Revision, raw); err != nil {
		return fmt.Errorf("spa: snapshot: %w", err)
	}
	return nil
}

func idList(in []api.Id) []uuid.UUID {
	if in == nil {
		return []uuid.UUID{}
	}
	return in
}

// checkedRecipe reads the base units of the items of a recipe and checks the lines against them.
func checkedRecipe(ctx context.Context, tx pgx.Tx, in []api.ConsumptionRecipeLine) ([]RecipeLine, error) {
	units, err := itemUnits(ctx, tx, in)
	if err != nil {
		return nil, err
	}
	return CleanRecipe(in, units)
}

// finishService reads the saved service back, keeps its revision, writes the audit row and the outcome of the command.
func finishService(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, id, unit uuid.UUID, action string, status int, diff map[string]any) (api.SpaService, error) {
	out, err := readService(ctx, tx, id)
	if err != nil {
		return api.SpaService{}, fmt.Errorf("spa: read back service: %w", err)
	}
	if err := snapshotRevision(ctx, tx, out); err != nil {
		return api.SpaService{}, err
	}
	if err := recordAudit(ctx, tx, tc, action, targetService, id, unit, "", diff); err != nil {
		return api.SpaService{}, err
	}
	return out, complete(ctx, tx, status, etag(out.Revision), out)
}

// unitExists reports whether the org unit is there and not archived.
func unitExists(ctx context.Context, tx pgx.Tx, id uuid.UUID) (bool, error) {
	var exists bool
	if err := tx.QueryRow(ctx, `select exists (select 1 from org.units where id = $1 and archived_at is null)`, id).Scan(&exists); err != nil {
		return false, fmt.Errorf("spa: unit: %w", err)
	}
	return exists, nil
}

// CreateService creates a treatment of an org unit with its duration, buffers, price, equipment and recipe
// (createSpaService).
func (s *Service) CreateService(ctx context.Context, tc tenantctx.TenantContext, b api.SpaServiceCreate) (api.SpaService, error) {
	name, err := CleanService(b.Name, b.DurationMinutes, b.BufferBeforeMinutes, b.BufferAfterMinutes, b.Price)
	if err != nil {
		return api.SpaService{}, err
	}
	var out api.SpaService
	err = s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		if err := permitService(ctx, ev, tc, actServicesManage, b.OrgUnitId); err != nil {
			return err
		}
		if ok, err := unitExists(ctx, tx, b.OrgUnitId); err != nil {
			return err
		} else if !ok {
			return invalid("orgUnitId", textUnitNotFound)
		}
		equipment := idList(b.RequiredEquipmentIds)
		if err := checkEquipment(ctx, tx, b.OrgUnitId, equipment, "requiredEquipmentIds"); err != nil {
			return err
		}
		recipe, err := checkedRecipe(ctx, tx, b.Recipe)
		if err != nil {
			return err
		}
		var id uuid.UUID
		err = tx.QueryRow(ctx, `insert into spa.services (org_unit_id, name, duration_minutes, buffer_before_minutes, buffer_after_minutes,
			   price_minor, currency, required_equipment_ids) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
			b.OrgUnitId, name, b.DurationMinutes, b.BufferBeforeMinutes, b.BufferAfterMinutes, int64(b.Price.AmountMinor), b.Price.Currency, equipment).Scan(&id)
		if isUnique(err) {
			return conflict("", textNameTaken)
		}
		if err != nil {
			return fmt.Errorf("spa: insert service: %w", err)
		}
		if err := writeRecipe(ctx, tx, id, recipe); err != nil {
			return err
		}
		out, err = finishService(ctx, tx, tc, id, b.OrgUnitId, "spa.service.create", http.StatusCreated,
			map[string]any{"name": name, "durationMinutes": b.DurationMinutes, "recipeLines": len(recipe)})
		return err
	})
	return out, err
}

// UpdateService edits a service and its recipe under If-Match: the revision of the service grows, the old state stays in
// the revisions, and the visits already booked keep the snapshot they were booked with (updateSpaService).
func (s *Service) UpdateService(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, p api.SpaServicePatch) (api.SpaService, error) {
	if p.Name == nil && p.DurationMinutes == nil && p.BufferBeforeMinutes == nil && p.BufferAfterMinutes == nil && p.Price == nil &&
		p.RequiredEquipmentIds == nil && p.Recipe == nil {
		return api.SpaService{}, invalid("body", textNothing)
	}
	var out api.SpaService
	err := s.inTx(ctx, tc, func(tx pgx.Tx, ev Authorizer) error {
		var unit uuid.UUID
		err := tx.QueryRow(ctx, `select org_unit_id from spa.services where id = $1 for update`, id).Scan(&unit)
		if errors.Is(err, pgx.ErrNoRows) {
			return problem.New(problem.CodeNotFound, textServiceNotFound)
		}
		if err != nil {
			return fmt.Errorf("spa: service: %w", err)
		}
		if err := permitService(ctx, ev, tc, actServicesManage, unit); err != nil {
			return err
		}
		cur, err := readService(ctx, tx, id)
		if err != nil {
			return fmt.Errorf("spa: read service: %w", err)
		}
		if err := checkRevision(ifMatch, cur.Revision); err != nil {
			return err
		}
		out, err = s.applyPatch(ctx, tx, tc, cur, p)
		return err
	})
	return out, err
}

// merged is the service with the fields of the patch put over it (the recipe is written apart).
func merged(cur api.SpaService, p api.SpaServicePatch) api.SpaService {
	next := cur
	if p.Name != nil {
		next.Name = *p.Name
	}
	if p.DurationMinutes != nil {
		next.DurationMinutes = *p.DurationMinutes
	}
	if p.BufferBeforeMinutes != nil {
		next.BufferBeforeMinutes = *p.BufferBeforeMinutes
	}
	if p.BufferAfterMinutes != nil {
		next.BufferAfterMinutes = *p.BufferAfterMinutes
	}
	if p.Price != nil {
		next.Price = *p.Price
	}
	if p.RequiredEquipmentIds != nil {
		next.RequiredEquipmentIds = idList(*p.RequiredEquipmentIds)
	}
	return next
}

// applyPatch writes the checked patch over the current state of the service and reads the new one back.
func (s *Service) applyPatch(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, cur api.SpaService, p api.SpaServicePatch) (api.SpaService, error) {
	next := merged(cur, p)
	name, err := CleanService(next.Name, next.DurationMinutes, next.BufferBeforeMinutes, next.BufferAfterMinutes, next.Price)
	if err != nil {
		return api.SpaService{}, err
	}
	if p.RequiredEquipmentIds != nil {
		if err := checkEquipment(ctx, tx, cur.OrgUnitId, next.RequiredEquipmentIds, "requiredEquipmentIds"); err != nil {
			return api.SpaService{}, err
		}
	}
	var recipe []RecipeLine
	if p.Recipe != nil {
		if recipe, err = checkedRecipe(ctx, tx, *p.Recipe); err != nil {
			return api.SpaService{}, err
		}
	}
	_, err = tx.Exec(ctx, `update spa.services set name = $2, duration_minutes = $3, buffer_before_minutes = $4, buffer_after_minutes = $5,
		   price_minor = $6, currency = $7, required_equipment_ids = $8, revision = revision + 1, updated_at = $9 where id = $1`,
		cur.Id, name, next.DurationMinutes, next.BufferBeforeMinutes, next.BufferAfterMinutes, int64(next.Price.AmountMinor), next.Price.Currency,
		next.RequiredEquipmentIds, s.now())
	if isUnique(err) {
		return api.SpaService{}, conflict("", textNameTaken)
	}
	if err != nil {
		return api.SpaService{}, fmt.Errorf("spa: update service: %w", err)
	}
	if p.Recipe != nil {
		if err := writeRecipe(ctx, tx, cur.Id, recipe); err != nil {
			return api.SpaService{}, err
		}
	}
	return finishService(ctx, tx, tc, cur.Id, cur.OrgUnitId, "spa.service.update", http.StatusOK,
		map[string]any{"revision": cur.Revision + 1, "recipeChanged": p.Recipe != nil})
}
