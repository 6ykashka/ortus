package repairs

import (
	"context"
	"fmt"
	"slices"
	"strconv"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the refusals of the supply (the prototype api.js, the supply of «Ремонт и стройка», and its MSW port).
const (
	textRequestNotFound  = "Заявка не найдена."
	textRequestChanged   = "Заявку уже изменили — обновите страницу"
	textNeedSupply       = "Нужно право «Снабжение»."
	textNeedRequest      = "Нужно право «Заявка на материал»."
	textMaterialPick     = "Выберите материал справочника."
	textNeedByPast       = "Срок «Нужно к» не может быть в прошлом."
	textSupplyState      = "Заявка уже обработана."
	textStockShort       = "Не хватает свободного остатка на складе."
	textWarehouseMissing = "Склада нет в организации."
	textNeedPost         = "Нужно право «Проводить движения» на складе."
	textHandedOverAsk    = "Объект сдан: новые заявки не принимаются."
	textHandedOverUse    = "Объект сдан: списание закрыто."
	textObjectStockShort = "На объекте нет столько материала."
	textUnknownState     = "Неизвестное состояние заявки."
	textReservationGone  = "Резерв на складе снят: решите заявку заново."
)

var supplyStates = []string{stRequest, stReserved, stIssued, stOrdered, stBought, stUsed}

// supplyRequest reads a request ("for update" locks it); nil — there is none.
func (r *req) supplyRequest(ctx context.Context, id uuid.UUID, lock bool) (*supplyRow, error) {
	sql := `select ` + supplyCols + supplyFrom + ` where q.id = $1`
	if lock {
		sql += ` for update of q`
	}
	q := &supplyRow{}
	if err := q.scan(r.tx.QueryRow(ctx, sql, id)); err != nil {
		if noRows(err) {
			return nil, nil
		}
		return nil, store("supply request", err)
	}
	return q, nil
}

// supplyDTO is the request as the member reads it: the cost and the free stock are for the supply only.
//
//nolint:revive // the fields mirror the anonymous struct of the generated type
func supplyDTO(q *supplyRow, cost bool, free []availableRow) rapi.SupplyRequest {
	dto := rapi.SupplyRequest{Id: q.id, Number: q.number, ProjectId: q.project, ProjectName: q.projectName, PriceItemId: q.priceItem, Name: q.name,
		Unit: rapi.RepairUnit(q.unit), Quantity: q.qty.String(), State: rapi.SupplyRequestState(q.state), CreatedAt: q.createdAt, Revision: q.revision,
		WarehouseId: q.warehouse, PurchaseId: q.purchase}
	dto.NeedBy.Time = q.needBy
	if cost && q.cost != nil {
		dto.Cost = &rapi.Money{AmountMinor: int(*q.cost), Currency: q.currency}
	}
	if len(free) > 0 {
		av := make([]struct {
			Free          rapi.Quantity `json:"free"`
			WarehouseId   rapi.Id       `json:"warehouseId"`
			WarehouseName string        `json:"warehouseName"`
		}, 0, len(free))
		for _, f := range free {
			av = append(av, struct {
				Free          rapi.Quantity `json:"free"`
				WarehouseId   rapi.Id       `json:"warehouseId"`
				WarehouseName string        `json:"warehouseName"`
			}{f.free.String(), f.warehouse, f.name})
		}
		dto.Available = &av
	}
	return dto
}

// publish tells the outbox about a fact of the supply (no sums: the payload carries no restricted fields).
func (r *req) publish(ctx context.Context, topic, aggregate string, id uuid.UUID, payload map[string]any) error {
	_, err := events.Publish(ctx, r.tx, events.Event{Type: topic, Aggregate: aggregate, AggregateID: id, Payload: payload})
	return store("event "+topic, err)
}

func (r *req) publishRequest(ctx context.Context, topic string, q *supplyRow) error {
	return r.publish(ctx, topic, aggRequest, q.id, map[string]any{"requestId": q.id, "number": q.number, "projectId": q.project, "priceItemId": q.priceItem,
		"quantity": q.qty.String()})
}

// requestText is the line of the feed about a request: «З-12: Плитка × 4».
func requestText(verb string, q *supplyRow) string {
	return fmt.Sprintf("%s %s: %s × %s", verb, q.number, q.name, q.qty)
}

// visibleRequest reads the request and the object it is about for a command: 404 for a missing one and for an object
// the member does not see.
func (r *req) visibleRequest(ctx context.Context, id uuid.UUID) (*supplyRow, *projectRow, error) {
	q, err := r.supplyRequest(ctx, id, true)
	if err != nil {
		return nil, nil, err
	}
	if q == nil {
		return nil, nil, notFound(textRequestNotFound)
	}
	p, err := r.visibleProject(ctx, q.project, false)
	if err != nil {
		return nil, nil, notFound(textRequestNotFound)
	}
	return q, p, nil
}

// setState moves a request to the next step: the revision grows, the cost is written when given.
func (r *req) setState(ctx context.Context, q *supplyRow, to string, warehouse, purchase *uuid.UUID, cost *int64) error {
	if !supplyStep(q.state, to) {
		return store("state", fmt.Errorf("%s → %s", q.state, to))
	}
	_, err := r.tx.Exec(ctx, `update repairs.supply_requests set state = $2, warehouse_id = coalesce($3, warehouse_id), purchase_id = coalesce($4, purchase_id),
		cost_minor = coalesce($5, cost_minor), revision = revision + 1, updated_at = $6 where id = $1`, q.id, to, warehouse, purchase, cost, r.now)
	return store("state", err)
}

// CreateSupplyRequest answers createSupplyRequest: the foreman asks for a material of the price list «нужно к» a day.
func (s *Service) CreateSupplyRequest(ctx context.Context, tc tenantctx.TenantContext, project uuid.UUID, b rapi.SupplyRequestCreate) (rapi.SupplyRequest, error) {
	var out rapi.SupplyRequest
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.visibleProject(ctx, project, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actSupplyRequest, textNeedRequest); err != nil {
			return err
		}
		if p.status == statusHandedOver {
			return conflict(reasonHandedOver, textHandedOverAsk)
		}
		qty, ok := parseQty(b.Quantity)
		if !ok || qty <= 0 {
			return invalid("quantity", textQtyPositive, "positive")
		}
		y, m, d := r.now.Date()
		if b.NeedBy.Before(timeDay(y, int(m), d)) {
			return invalid("needBy", textNeedByPast, "past")
		}
		var known bool
		if err := r.tx.QueryRow(ctx, `select exists (select 1 from repairs.price_items where id = $1 and kind = 'material' and not archived)`, b.PriceItemId).Scan(&known); err != nil {
			return store("material", err)
		}
		if !known {
			return invalid("priceItemId", textMaterialPick, "unknown")
		}
		var id uuid.UUID
		if err := r.tx.QueryRow(ctx, `insert into repairs.supply_requests (number, project_id, price_item_id, quantity, need_by, created_by, created_at, updated_at)
			values ($1 || nextval('repairs.supply_request_number_seq'), $2, $3, $4::bigint::numeric / 1000, $5::date, $6, $7, $7) returning id`,
			requestNumberPrefix, p.id, b.PriceItemId, int64(qty), b.NeedBy.Time, r.me(), r.now).Scan(&id); err != nil {
			return store("insert request", err)
		}
		q, err := r.supplyRequest(ctx, id, false)
		if err != nil {
			return err
		}
		if err := r.event(ctx, p.id, evSupplyRequested, requestText("заявка", q)); err != nil {
			return err
		}
		out = supplyDTO(q, false, nil)
		return r.publishRequest(ctx, topicRequestCreated, q)
	})
	return out, err
}

// SupplyQuery is the filter of listSupplyRequests.
type SupplyQuery struct {
	Project *uuid.UUID
	State   *string
	Cursor  *string
	Limit   *int
}

// SupplyRequests answers listSupplyRequests: the requests of the objects the member reads — the supply sees every request
// of its area with the cost and the free stock, the foreman only the requests of his objects.
func (s *Service) SupplyRequests(ctx context.Context, tc tenantctx.TenantContext, q SupplyQuery) (rapi.SupplyRequestPage, error) {
	out := rapi.SupplyRequestPage{Items: []rapi.SupplyRequest{}}
	if q.State != nil && !slices.Contains(supplyStates, *q.State) {
		return out, malformed(textUnknownState)
	}
	err := s.run(ctx, tc, false, func(r *req) error {
		if err := r.needSupplyOrRequest(ctx); err != nil {
			return err
		}
		ids, manage, err := r.supplyProjects(ctx, q.Project)
		if err != nil || len(ids) == 0 {
			return err
		}
		from, n, err := window(q.Cursor, q.Limit)
		if err != nil {
			return err
		}
		rows, err := r.queryRequests(ctx, ids, q.State, from, n+1)
		if err != nil {
			return err
		}
		if len(rows) > n {
			rows, out.NextCursor = rows[:n], new("o"+strconv.Itoa(from+n))
		}
		out.Items, err = r.supplyItems(ctx, rows, manage)
		return err
	})
	return out, err
}

// needSupplyOrRequest requires repairs.supply.manage or repairs.supply.request in any role: 403 otherwise.
func (r *req) needSupplyOrRequest(ctx context.Context) error {
	for _, a := range []string{actSupply, actSupplyRequest} {
		if ok, err := r.anywhere(ctx, a); err != nil || ok {
			return err
		}
	}
	return forbidden("")
}

// supplyItems are the requests as the member reads them: the supply sees the cost and, for a request waiting for a
// decision, the free stock of the warehouses.
func (r *req) supplyItems(ctx context.Context, rows []*supplyRow, manage map[uuid.UUID]bool) ([]rapi.SupplyRequest, error) {
	free := map[string][]availableRow{}
	out := make([]rapi.SupplyRequest, 0, len(rows))
	for _, row := range rows {
		var av []availableRow
		if manage[row.project] && row.state == stRequest {
			var err error
			if av, err = r.availableOf(ctx, free, row.name); err != nil {
				return nil, err
			}
		}
		out = append(out, supplyDTO(row, manage[row.project], av))
	}
	return out, nil
}

func (r *req) availableOf(ctx context.Context, cache map[string][]availableRow, name string) ([]availableRow, error) {
	if av, ok := cache[name]; ok {
		return av, nil
	}
	av, err := r.available(ctx, name)
	cache[name] = av
	return av, err
}

// supplyProjects are the objects whose requests the member reads (he sees the object and holds supply.manage or
// supply.request there; only project when set) and, per object, whether he holds supply.manage (the cost, the free stock).
func (r *req) supplyProjects(ctx context.Context, only *uuid.UUID) ([]uuid.UUID, map[uuid.UUID]bool, error) {
	all, err := r.allProjects(ctx)
	if err != nil {
		return nil, nil, err
	}
	manage := map[uuid.UUID]bool{}
	var ids []uuid.UUID
	for _, p := range all {
		if only != nil && p.id != *only {
			continue
		}
		ok, err := r.sees(ctx, p)
		if err != nil || !ok {
			if err != nil {
				return nil, nil, err
			}
			continue
		}
		mng, err := r.can(ctx, p, actSupply)
		if err != nil {
			return nil, nil, err
		}
		ask := mng
		if !ask {
			if ask, err = r.can(ctx, p, actSupplyRequest); err != nil {
				return nil, nil, err
			}
		}
		if ask {
			ids = append(ids, p.id)
			manage[p.id] = mng
		}
	}
	return ids, manage, nil
}

// queryRequests reads a window of the requests of the objects ids (a state when set): the earliest «нужно к» first.
func (r *req) queryRequests(ctx context.Context, ids []uuid.UUID, state *string, offset, limit int) ([]*supplyRow, error) {
	rows, err := r.tx.Query(ctx, `select `+supplyCols+supplyFrom+` where q.project_id = any($1) and ($2::text is null or q.state = $2)
		order by q.need_by, q.created_at, q.id offset $3 limit $4`, ids, state, offset, limit)
	if err != nil {
		return nil, store("requests", err)
	}
	defer rows.Close()
	var out []*supplyRow
	for rows.Next() {
		q := &supplyRow{}
		if err := q.scan(rows); err != nil {
			return nil, store("requests", err)
		}
		out = append(out, q)
	}
	return out, store("requests", rows.Err())
}

// lastPrice is the price of a unit in the last received purchase of the material; nil — there was none.
func (r *req) lastPrice(ctx context.Context, priceItem uuid.UUID) (*int64, error) {
	var price *int64
	err := r.tx.QueryRow(ctx, `select pl.price_minor from repairs.purchase_lines pl join repairs.purchases pu on pu.id = pl.purchase_id
		where pl.price_item_id = $1 and pu.state = 'received' order by pu.received_at desc, pu.id desc limit 1`, priceItem).Scan(&price)
	if noRows(err) {
		return nil, nil
	}
	return price, store("last price", err)
}

// ReserveSupply answers reserveSupplyRequest: «со склада» — the free stock of the warehouse is held for the request.
func (s *Service) ReserveSupply(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, warehouse uuid.UUID) (rapi.SupplyRequest, error) {
	var out rapi.SupplyRequest
	err := s.run(ctx, tc, true, func(r *req) error {
		q, p, err := r.visibleRequest(ctx, id)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actSupply, textNeedSupply); err != nil {
			return err
		}
		if err := checkRev(ifMatch, q.revision, textRequestChanged); err != nil {
			return err
		}
		if q.state != stRequest {
			return conflict(reasonSupplyState, textSupplyState)
		}
		w, err := r.holdOn(ctx, q, warehouse)
		if err != nil {
			return err
		}
		if err := r.setState(ctx, q, stReserved, &w.id, nil, nil); err != nil {
			return err
		}
		if err := r.event(ctx, p.id, evSupplyReserved, requestText("со склада", q)); err != nil {
			return err
		}
		if err := r.publishRequest(ctx, topicRequestReserved, q); err != nil {
			return err
		}
		out, err = r.supplyOut(ctx, q.id)
		return err
	})
	return out, err
}

// holdOn reserves the quantity of the request on the warehouse: 422 for a warehouse that is not there, 409 for a stock that
// is smaller than the quantity (or an item the warehouse does not hold).
func (r *req) holdOn(ctx context.Context, q *supplyRow, warehouse uuid.UUID) (*whRow, error) {
	w, err := r.warehouse(ctx, warehouse)
	if err != nil {
		return nil, err
	}
	if w == nil || w.archived {
		return nil, invalid("warehouseId", textWarehouseMissing, "unknown")
	}
	item, found, err := r.stockItem(ctx, q.name, w)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, conflict(reasonStock, textStockShort)
	}
	held, err := r.reserveAt(ctx, w.id, item, q.id, q.qty)
	if err == nil && !held {
		err = conflict(reasonStock, textStockShort)
	}
	return w, err
}

// supplyOut reads the request after a command: the cost only for who holds repairs.supply.manage on the object (the foreman
// who writes the material off and the storekeeper who hands it out do not see it).
func (r *req) supplyOut(ctx context.Context, id uuid.UUID) (rapi.SupplyRequest, error) {
	q, err := r.supplyRequest(ctx, id, false)
	if err != nil || q == nil {
		return rapi.SupplyRequest{}, err
	}
	p, err := r.project(ctx, q.project, false)
	if err != nil || p == nil {
		return supplyDTO(q, false, nil), err
	}
	cost, err := r.can(ctx, p, actSupply)
	if err != nil {
		return rapi.SupplyRequest{}, err
	}
	return supplyDTO(q, cost, nil), nil
}

// IssueSupply answers issueSupplyRequest: the storekeeper hands out the reserved material — the movement «issue» of the
// module «Склад», the cost at the price of the unit goes to the stock (and the expenses) of the object.
func (s *Service) IssueSupply(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string) (rapi.SupplyRequest, error) {
	var out rapi.SupplyRequest
	err := s.run(ctx, tc, true, func(r *req) error {
		q, err := r.supplyRequest(ctx, id, true)
		if err != nil {
			return err
		}
		if q == nil {
			return notFound(textRequestNotFound)
		}
		w, err := r.issuer(ctx, q)
		if err != nil {
			return err
		}
		if err := checkRev(ifMatch, q.revision, textRequestChanged); err != nil {
			return err
		}
		if q.state != stReserved || w == nil {
			return conflict(reasonSupplyState, textSupplyState)
		}
		cost, err := r.handOut(ctx, q, w)
		if err != nil {
			return err
		}
		if err := r.setState(ctx, q, stIssued, nil, nil, &cost); err != nil {
			return err
		}
		if err := r.event(ctx, q.project, evSupplyIssued, requestText("выдано со склада", q)); err != nil {
			return err
		}
		if err := r.publishRequest(ctx, topicRequestIssued, q); err != nil {
			return err
		}
		out, err = r.supplyOut(ctx, q.id)
		return err
	})
	return out, err
}

const textCostTooBig = "Стоимость слишком большая."

// handOut takes the reserved quantity out of the warehouse and puts it on the stock of the object at the price of a unit;
// it returns the cost.
func (r *req) handOut(ctx context.Context, q *supplyRow, w *whRow) (int64, error) {
	item, found, err := r.stockItem(ctx, q.name, w)
	if err != nil {
		return 0, err
	}
	if !found {
		return 0, conflict(reasonStock, textReservationGone)
	}
	if _, ok, err := r.issueAt(ctx, w, item, q.id, q.qty); err != nil || !ok {
		if err == nil {
			err = conflict(reasonStock, textReservationGone)
		}
		return 0, err
	}
	last, err := r.lastPrice(ctx, q.priceItem)
	if err != nil {
		return 0, err
	}
	cost := costOf(q.qty, unitPriceOf(last, q.catalogPrice))
	if cost > maxMinor {
		return 0, invalid("quantity", textCostTooBig, "too_big")
	}
	return cost, r.addStock(ctx, q.project, q.priceItem, q.qty, cost)
}

// issuer is the warehouse of a reserved request when the member may post movements over it. A request without a warehouse
// has none to check: the member then needs the right somewhere (404 as a missing request otherwise) and the state refuses.
func (r *req) issuer(ctx context.Context, q *supplyRow) (*whRow, error) {
	if q.warehouse == nil {
		ok, err := r.anywhere(ctx, actMovementsPost)
		if err == nil && !ok {
			err = notFound(textRequestNotFound)
		}
		return nil, err
	}
	w, err := r.warehouse(ctx, *q.warehouse)
	if err != nil {
		return nil, err
	}
	if w == nil {
		return nil, notFound(textRequestNotFound)
	}
	return w, r.postable(ctx, w)
}

// needWriteOff requires repairs.supply.request (the foreman) or repairs.work_logs.review (who accepts the marks) on the object.
func (r *req) needWriteOff(ctx context.Context, p *projectRow) error {
	for _, a := range []string{actSupplyRequest, actReview} {
		if ok, err := r.can(ctx, p, a); err != nil || ok {
			return err
		}
	}
	return forbidden(textNeedRequest)
}

// ConsumeSupply answers consumeSupplyRequest: the material on the object is written off to the work (the foreman of the
// object or who reviews the marks).
func (s *Service) ConsumeSupply(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string) (rapi.SupplyRequest, error) {
	var out rapi.SupplyRequest
	err := s.run(ctx, tc, true, func(r *req) error {
		q, p, err := r.visibleRequest(ctx, id)
		if err != nil {
			return err
		}
		if err := r.needWriteOff(ctx, p); err != nil {
			return err
		}
		if err := checkRev(ifMatch, q.revision, textRequestChanged); err != nil {
			return err
		}
		if p.status == statusHandedOver {
			return conflict(reasonHandedOver, textHandedOverUse)
		}
		if q.state != stIssued && q.state != stBought {
			return conflict(reasonSupplyState, textSupplyState)
		}
		if err := r.writeOffStock(ctx, q); err != nil {
			return err
		}
		if err := r.setState(ctx, q, stUsed, nil, nil, nil); err != nil {
			return err
		}
		if err := r.event(ctx, p.id, evSupplyUsed, requestText("списано на объект", q)); err != nil {
			return err
		}
		if err := r.publishRequest(ctx, topicRequestUsed, q); err != nil {
			return err
		}
		out, err = r.supplyOut(ctx, q.id)
		return err
	})
	return out, err
}
