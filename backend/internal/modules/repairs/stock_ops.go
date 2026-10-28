package repairs

import (
	"context"
	"slices"
	"strconv"
	"time"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the refusals of the stock of the objects.
const (
	textItemsNeeded    = "Добавьте от одной до 100 позиций."
	textItemDuplicate  = "Позиция уже есть в списке."
	textNoStockItem    = "На складе нет такой номенклатуры."
	textTargetPick     = "Выберите другой объект."
	textTargetUnknown  = "Объекта нет или он вам не виден."
	textTargetHandOver = "Объект сдан: остаток на него не переносится."
)

const maxStockItems = 100

func timeDay(y, m, d int) time.Time { return time.Date(y, time.Month(m), d, 0, 0, 0, 0, time.UTC) }

// stockRow is the stock of a material on an object.
type stockRow struct {
	qty  milli
	cost int64
}

// stockOf reads the stock of the material on the object ("for update" locks it); ok false — there is none.
func (r *req) stockOf(ctx context.Context, project, priceItem uuid.UUID, lock bool) (stockRow, error) {
	sql := `select (quantity * 1000)::bigint, cost_minor from repairs.project_stock where project_id = $1 and price_item_id = $2`
	if lock {
		sql += ` for update`
	}
	var (
		s   stockRow
		qty int64
	)
	err := r.tx.QueryRow(ctx, sql, project, priceItem).Scan(&qty, &s.cost)
	s.qty = milli(qty)
	if noRows(err) {
		return stockRow{}, nil
	}
	return s, store("stock", err)
}

// addStock puts quantity and cost on the stock of the object.
func (r *req) addStock(ctx context.Context, project, priceItem uuid.UUID, qty milli, cost int64) error {
	_, err := r.tx.Exec(ctx, `insert into repairs.project_stock (project_id, price_item_id, quantity, cost_minor, updated_at)
		values ($1, $2, $3::bigint::numeric / 1000, $4, $5)
		on conflict (project_id, price_item_id) do update set quantity = repairs.project_stock.quantity + excluded.quantity,
		cost_minor = repairs.project_stock.cost_minor + excluded.cost_minor, updated_at = excluded.updated_at`, project, priceItem, int64(qty), cost, r.now)
	return store("add stock", err)
}

// takeStock takes qty off the stock of the object with its share of the cost and returns the share.
func (r *req) takeStock(ctx context.Context, project, priceItem uuid.UUID, qty milli) (int64, error) {
	s, err := r.stockOf(ctx, project, priceItem, true)
	if err != nil {
		return 0, err
	}
	if s.qty < qty {
		return 0, conflict(reasonStock, textObjectStockShort)
	}
	share := shareOf(s.cost, qty, s.qty)
	_, err = r.tx.Exec(ctx, `update repairs.project_stock set quantity = quantity - ($3::bigint::numeric / 1000), cost_minor = cost_minor - $4, updated_at = $5
		where project_id = $1 and price_item_id = $2`, project, priceItem, int64(qty), share, r.now)
	return share, store("take stock", err)
}

// writeOffStock takes the quantity of a request off the stock of its object (the write-off «use»).
func (r *req) writeOffStock(ctx context.Context, q *supplyRow) error {
	_, err := r.takeStock(ctx, q.project, q.priceItem, q.qty)
	return err
}

func stockDTO(name string, projectID, priceItem uuid.UUID, item, unit string, s stockRow) rapi.ProjectStockItem {
	return rapi.ProjectStockItem{ProjectId: projectID, ProjectName: name, PriceItemId: priceItem, Name: item, Unit: rapi.RepairUnit(unit), Quantity: s.qty.String(),
		Cost: rapi.Money{AmountMinor: int(s.cost), Currency: currencyRUB}}
}

// stockItems reads the stock rows of the objects (only the materials in items when given; the empty ones too then).
func (r *req) stockItems(ctx context.Context, projects, items []uuid.UUID, withEmpty bool) ([]rapi.ProjectStockItem, error) {
	rows, err := r.tx.Query(ctx, `select s.project_id, p.name, s.price_item_id, i.name, i.unit, (s.quantity * 1000)::bigint, s.cost_minor
		from repairs.project_stock s join repairs.projects p on p.id = s.project_id join repairs.price_items i on i.id = s.price_item_id
		where s.project_id = any($1) and ($2::uuid[] is null or s.price_item_id = any($2)) and ($3 or s.quantity > 0)
		order by p.name, p.id, i.name, i.id`, projects, items, withEmpty)
	if err != nil {
		return nil, store("stock list", err)
	}
	defer rows.Close()
	out := []rapi.ProjectStockItem{}
	for rows.Next() {
		var (
			project, item uuid.UUID
			pname, iname  string
			unit          string
			s             stockRow
			qty           int64
		)
		if err := rows.Scan(&project, &pname, &item, &iname, &unit, &qty, &s.cost); err != nil {
			return nil, store("stock list", err)
		}
		s.qty = milli(qty)
		out = append(out, stockDTO(pname, project, item, iname, unit, s))
	}
	return out, store("stock list", rows.Err())
}

// ProjectStock answers listProjectStock: the stock on the objects the member decides the supply of.
func (s *Service) ProjectStock(ctx context.Context, tc tenantctx.TenantContext) (rapi.ProjectStockList, error) {
	out := rapi.ProjectStockList{Items: []rapi.ProjectStockItem{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		if err := r.needSupplyAnywhere(ctx); err != nil {
			return err
		}
		ids, err := r.manageable(ctx)
		if err != nil || len(ids) == 0 {
			return err
		}
		out.Items, err = r.stockItems(ctx, ids, nil, false)
		return err
	})
	return out, err
}

// checkStockItems checks the items of a return or a transfer: 1–100, each material once, a positive quantity of three decimals.
func checkStockItems(in []rapi.StockItemInput) ([]stockLine, error) {
	if len(in) == 0 || len(in) > maxStockItems {
		return nil, invalid("items", textItemsNeeded, "required")
	}
	out := make([]stockLine, 0, len(in))
	for i, it := range in {
		field := "items[" + strconv.Itoa(i) + "]"
		qty, ok := parseQty(it.Quantity)
		if !ok || qty <= 0 {
			return nil, invalid(field+".quantity", textQtyPositive, "positive")
		}
		if slices.ContainsFunc(out, func(l stockLine) bool { return l.priceItem == it.PriceItemId }) {
			return nil, invalid(field+".priceItemId", textItemDuplicate, "duplicate")
		}
		out = append(out, stockLine{priceItem: it.PriceItemId, qty: qty, field: field})
	}
	return out, nil
}

type stockLine struct {
	priceItem uuid.UUID
	qty       milli
	field     string
	name      string
}

// materials names the materials of the lines and refuses an unknown one.
func (r *req) materials(ctx context.Context, lines []stockLine) error {
	for i, l := range lines {
		err := r.tx.QueryRow(ctx, `select name from repairs.price_items where id = $1 and kind = 'material'`, l.priceItem).Scan(&lines[i].name)
		if noRows(err) {
			return invalid(l.field+".priceItemId", textMaterialPick, "unknown")
		}
		if err != nil {
			return store("material", err)
		}
	}
	return nil
}

func itemIDs(lines []stockLine) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(lines))
	for _, l := range lines {
		ids = append(ids, l.priceItem)
	}
	return ids
}

// ReturnStock answers returnProjectStock: the surplus of the object goes back to a warehouse — the movement «receipt» of the
// module «Склад», the stock and the expenses of the object decrease by the cost of what went back.
func (s *Service) ReturnStock(ctx context.Context, tc tenantctx.TenantContext, project uuid.UUID, b rapi.StockReturn) (rapi.StockMoveResult, error) {
	out := rapi.StockMoveResult{MovementIds: []rapi.Id{}, Items: []rapi.ProjectStockItem{}}
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.visibleProject(ctx, project, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actSupply, textNeedSupply); err != nil {
			return err
		}
		lines, err := checkStockItems(b.Items)
		if err != nil {
			return err
		}
		w, err := r.warehouse(ctx, b.WarehouseId)
		if err != nil {
			return err
		}
		if w == nil || w.archived {
			return invalid("warehouseId", textWarehouseMissing, "unknown")
		}
		if err := r.postable(ctx, w); err != nil {
			return err
		}
		if err := r.materials(ctx, lines); err != nil {
			return err
		}
		if out.MovementIds, err = r.giveBack(ctx, p, w, lines); err != nil {
			return err
		}
		if out.Items, err = r.stockItems(ctx, []uuid.UUID{p.id}, itemIDs(lines), true); err != nil {
			return err
		}
		return r.publish(ctx, topicStockReturned, aggProject, p.id, map[string]any{"projectId": p.id, "warehouseId": w.id, "movementIds": out.MovementIds})
	})
	return out, err
}

// TransferStock answers transferProjectStock: the stock moves to another object with its cost; the requests of the target
// for the same material shrink or close — the oldest first.
func (s *Service) TransferStock(ctx context.Context, tc tenantctx.TenantContext, project uuid.UUID, b rapi.StockTransfer) (rapi.StockMoveResult, error) {
	out := rapi.StockMoveResult{MovementIds: []rapi.Id{}, Items: []rapi.ProjectStockItem{}}
	err := s.run(ctx, tc, true, func(r *req) error {
		if _, err := r.tx.Exec(ctx, `select 1 from repairs.projects where id = any($1) order by id for update`, []uuid.UUID{project, b.ToProjectId}); err != nil {
			return store("lock projects", err)
		}
		from, err := r.visibleProject(ctx, project, false)
		if err != nil {
			return err
		}
		if err := r.need(ctx, from, actSupply, textNeedSupply); err != nil {
			return err
		}
		to, err := r.transferTarget(ctx, from, b.ToProjectId)
		if err != nil {
			return err
		}
		lines, err := checkStockItems(b.Items)
		if err != nil {
			return err
		}
		if err := r.materials(ctx, lines); err != nil {
			return err
		}
		if err := r.moveLines(ctx, from, to, lines); err != nil {
			return err
		}
		if out.Items, err = r.stockItems(ctx, []uuid.UUID{from.id, to.id}, itemIDs(lines), true); err != nil {
			return err
		}
		return r.publish(ctx, topicStockMoved, aggProject, from.id, map[string]any{"projectId": from.id, "toProjectId": to.id, "priceItemIds": itemIDs(lines)})
	})
	return out, err
}

// transferTarget is the object the stock moves to: another one, the member sees it and decides its supply, not handed over.
func (r *req) transferTarget(ctx context.Context, from *projectRow, id uuid.UUID) (*projectRow, error) {
	if id == from.id {
		return nil, invalid("toProjectId", textTargetPick, "same")
	}
	to, err := r.project(ctx, id, false)
	if err != nil {
		return nil, err
	}
	if to != nil {
		seen, err := r.sees(ctx, to)
		if err != nil {
			return nil, err
		}
		if !seen {
			to = nil
		}
	}
	if to == nil {
		return nil, invalid("toProjectId", textTargetUnknown, "unknown")
	}
	if err := r.need(ctx, to, actSupply, textNeedSupply); err != nil {
		return nil, err
	}
	if to.status == statusHandedOver {
		return nil, conflict(reasonHandedOver, textTargetHandOver)
	}
	return to, nil
}

// coverRequests lets the moved stock answer the requests of the target for the material that wait for a decision: the oldest
// first, a covered one is closed («used»: the table allows no other state without a warehouse or a purchase), the last one shrinks.
func (r *req) coverRequests(ctx context.Context, project, priceItem uuid.UUID, moved milli) error {
	rows, err := r.tx.Query(ctx, `select id, (quantity * 1000)::bigint from repairs.supply_requests where project_id = $1 and price_item_id = $2 and state = 'request'
		order by need_by, created_at, id for update`, project, priceItem)
	if err != nil {
		return store("cover", err)
	}
	type waiting struct {
		id  uuid.UUID
		qty milli
	}
	var queue []waiting
	for rows.Next() {
		var (
			w waiting
			n int64
		)
		if err := rows.Scan(&w.id, &n); err != nil {
			rows.Close()
			return store("cover", err)
		}
		w.qty = milli(n)
		queue = append(queue, w)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return store("cover", err)
	}
	left := moved
	for _, w := range queue {
		if left <= 0 {
			break
		}
		if w.qty <= left {
			_, err = r.tx.Exec(ctx, `update repairs.supply_requests set state = 'used', revision = revision + 1, updated_at = $2 where id = $1`, w.id, r.now)
			left -= w.qty
		} else {
			_, err = r.tx.Exec(ctx, `update repairs.supply_requests set quantity = (quantity * 1000 - $2::bigint)::numeric / 1000, revision = revision + 1, updated_at = $3 where id = $1`,
				w.id, int64(left), r.now)
			left = 0
		}
		if err != nil {
			return store("cover", err)
		}
	}
	return nil
}

// giveBack returns the lines to the warehouse and writes the movements «receipt»; it returns their ids.
func (r *req) giveBack(ctx context.Context, p *projectRow, w *whRow, lines []stockLine) ([]rapi.Id, error) {
	ids := []rapi.Id{}
	for _, l := range lines {
		item, found, err := r.stockItem(ctx, l.name, w)
		if err != nil {
			return nil, err
		}
		if !found {
			return nil, invalid(l.field+".priceItemId", textNoStockItem, "no_stock_item")
		}
		if _, err := r.takeStock(ctx, p.id, l.priceItem, l.qty); err != nil {
			return nil, err
		}
		id, err := r.receiveAt(ctx, w, item, p.id, l.qty)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
		if err := r.event(ctx, p.id, evSupplyReturned, "возврат на склад: "+l.name+" × "+l.qty.String()); err != nil {
			return nil, err
		}
	}
	return ids, nil
}

// moveLines moves the lines from one object to another with their cost and covers the requests of the target.
func (r *req) moveLines(ctx context.Context, from, to *projectRow, lines []stockLine) error {
	for _, l := range lines {
		cost, err := r.takeStock(ctx, from.id, l.priceItem, l.qty)
		if err != nil {
			return err
		}
		if err := r.addStock(ctx, to.id, l.priceItem, l.qty, cost); err != nil {
			return err
		}
		if err := r.coverRequests(ctx, to.id, l.priceItem, l.qty); err != nil {
			return err
		}
		if err := r.event(ctx, from.id, evSupplyTransferred, "перемещено на «"+to.name+"»: "+l.name+" × "+l.qty.String()); err != nil {
			return err
		}
		if err := r.event(ctx, to.id, evSupplyTransferred, "получено с «"+from.name+"»: "+l.name+" × "+l.qty.String()); err != nil {
			return err
		}
	}
	return nil
}
