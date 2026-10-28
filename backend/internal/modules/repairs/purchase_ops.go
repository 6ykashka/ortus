package repairs

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of the refusals of the purchases.
const (
	textPurchaseNotFound = "Закупка не найдена."
	textPurchaseChanged  = "Закупку уже изменили — обновите страницу"
	textPurchaseState    = "Закупка уже получена."
	textSupplierShort    = "Укажите поставщика (до 150 знаков)."
	textPurchaseLines    = "Добавьте от одной до 200 заявок."
	textLineDuplicate    = "Заявка уже есть в закупке."
	textLineUnknown      = "Заявки нет."
	textPriceBad         = "Цена — неотрицательная сумма в рублях."
	textReceiptShort     = "Укажите чек: до 500 знаков."
)

const maxPurchaseLines = 200

// purchaseLine is a line of a purchase with the quantity of its request.
type purchaseLine struct {
	request, project, priceItem uuid.UUID
	qty                         milli
	price                       int64
	currency                    string
}

// purchaseRow is a row of repairs.purchases.
type purchaseRow struct {
	id               uuid.UUID
	number, supplier string
	state            string
	receiptQR        *string
	revision         int64
	createdAt        time.Time
	receivedAt       *time.Time
	lines            []purchaseLine
}

const purchaseCols = `u.id, u.number, u.supplier, u.state, u.receipt_qr, u.revision, u.created_at, u.received_at`

func (u *purchaseRow) scan(row interface{ Scan(...any) error }) error {
	return row.Scan(&u.id, &u.number, &u.supplier, &u.state, &u.receiptQR, &u.revision, &u.createdAt, &u.receivedAt)
}

func (u *purchaseRow) total() int64 {
	var sum int64
	for _, l := range u.lines {
		sum += costOf(l.qty, l.price)
	}
	return sum
}

func (u *purchaseRow) projects() []uuid.UUID {
	var ids []uuid.UUID
	for _, l := range u.lines {
		if !slices.Contains(ids, l.project) {
			ids = append(ids, l.project)
		}
	}
	return ids
}

// loadPurchaseLines reads the lines of the purchases, the oldest request first.
func (r *req) loadPurchaseLines(ctx context.Context, ps []*purchaseRow) error {
	if len(ps) == 0 {
		return nil
	}
	by := map[uuid.UUID]*purchaseRow{}
	ids := make([]uuid.UUID, 0, len(ps))
	for _, u := range ps {
		by[u.id] = u
		ids = append(ids, u.id)
	}
	rows, err := r.tx.Query(ctx, `select l.purchase_id, l.supply_request_id, l.project_id, l.price_item_id, (l.quantity * 1000)::bigint, l.price_minor, l.currency
		from repairs.purchase_lines l join repairs.supply_requests q on q.id = l.supply_request_id where l.purchase_id = any($1)
		order by l.purchase_id, q.created_at, q.number`, ids)
	if err != nil {
		return store("purchase lines", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id  uuid.UUID
			l   purchaseLine
			qty int64
		)
		if err := rows.Scan(&id, &l.request, &l.project, &l.priceItem, &qty, &l.price, &l.currency); err != nil {
			return store("purchase lines", err)
		}
		l.qty = milli(qty)
		by[id].lines = append(by[id].lines, l)
	}
	return store("purchase lines", rows.Err())
}

func purchaseDTO(u *purchaseRow) rapi.Purchase {
	lines := make([]rapi.PurchaseLine, 0, len(u.lines))
	for _, l := range u.lines {
		lines = append(lines, rapi.PurchaseLine{SupplyRequestId: l.request, ProjectId: l.project, PriceItemId: l.priceItem, Quantity: l.qty.String(),
			Price: rapi.Money{AmountMinor: int(l.price), Currency: l.currency}})
	}
	return rapi.Purchase{Id: u.id, Number: u.number, Supplier: u.supplier, State: rapi.PurchaseState(u.state), Lines: lines,
		Total: rapi.Money{AmountMinor: int(u.total()), Currency: currencyRUB}, CreatedAt: u.createdAt, Revision: u.revision, ReceiptQr: u.receiptQR,
		ReceivedAt: u.receivedAt}
}

// purchase reads a purchase with its lines ("for update" locks it); nil — there is none.
func (r *req) purchase(ctx context.Context, id uuid.UUID, lock bool) (*purchaseRow, error) {
	sql := `select ` + purchaseCols + ` from repairs.purchases u where u.id = $1`
	if lock {
		sql += ` for update of u`
	}
	u := &purchaseRow{}
	if err := u.scan(r.tx.QueryRow(ctx, sql, id)); err != nil {
		if noRows(err) {
			return nil, nil
		}
		return nil, store("purchase", err)
	}
	return u, r.loadPurchaseLines(ctx, []*purchaseRow{u})
}

// needSupplyAnywhere requires repairs.supply.manage in any role: the purchases are not of one object.
func (r *req) needSupplyAnywhere(ctx context.Context) error {
	ok, err := r.anywhere(ctx, actSupply)
	if err == nil && !ok {
		err = forbidden(textNeedSupply)
	}
	return err
}

// CreatePurchase answers createPurchase: one purchase for the requests of several objects — the supplier and the price
// of a unit per line (without it: the last received purchase of the material, else the price list, Q-W6.13-1). The
// requests become «ordered».
func (s *Service) CreatePurchase(ctx context.Context, tc tenantctx.TenantContext, b rapi.PurchaseCreate) (rapi.Purchase, error) {
	var out rapi.Purchase
	err := s.run(ctx, tc, true, func(r *req) error {
		if err := r.needSupplyAnywhere(ctx); err != nil {
			return err
		}
		supplier := strings.TrimSpace(b.Supplier)
		if c := utf8.RuneCountInString(supplier); c < 1 || c > 150 {
			return invalid("supplier", textSupplierShort, "required")
		}
		if len(b.Lines) == 0 || len(b.Lines) > maxPurchaseLines {
			return invalid("lines", textPurchaseLines, "required")
		}
		reqs, lines, err := r.checkPurchaseLines(ctx, b.Lines)
		if err != nil {
			return err
		}
		u, err := r.insertPurchase(ctx, supplier, reqs, lines)
		if err != nil {
			return err
		}
		for _, project := range u.projects() {
			if err := r.event(ctx, project, evSupplyOrdered, "в закупку "+u.number+": "+u.supplier); err != nil {
				return err
			}
		}
		out = purchaseDTO(u)
		return r.publish(ctx, topicPurchaseOrder, aggPurchase, u.id, map[string]any{"purchaseId": u.id, "number": u.number, "projectIds": u.projects(),
			"requestIds": requestIDs(lines)})
	})
	return out, err
}

// insertPurchase writes the purchase with its lines and moves the requests to «ordered».
func (r *req) insertPurchase(ctx context.Context, supplier string, reqs []*supplyRow, lines []purchaseLine) (*purchaseRow, error) {
	var id uuid.UUID
	if err := r.tx.QueryRow(ctx, `insert into repairs.purchases (number, supplier, created_by, created_at) values ($1 || nextval('repairs.supply_request_number_seq'), $2, $3, $4)
		returning id`, purchaseNumberPrefix, supplier, r.me(), r.now).Scan(&id); err != nil {
		return nil, store("insert purchase", err)
	}
	for i, l := range lines {
		if _, err := r.tx.Exec(ctx, `insert into repairs.purchase_lines (purchase_id, supply_request_id, project_id, price_item_id, quantity, price_minor, currency)
			values ($1, $2, $3, $4, $5::bigint::numeric / 1000, $6, $7)`, id, l.request, l.project, l.priceItem, int64(l.qty), l.price, l.currency); err != nil {
			return nil, store("insert purchase line", err)
		}
		if err := r.setState(ctx, reqs[i], stOrdered, nil, &id, nil); err != nil {
			return nil, err
		}
	}
	return r.purchase(ctx, id, false)
}

func requestIDs(lines []purchaseLine) []uuid.UUID {
	ids := make([]uuid.UUID, 0, len(lines))
	for _, l := range lines {
		ids = append(ids, l.request)
	}
	return ids
}

// checkPurchaseLines checks the lines of a new purchase against the requests and prices them: the request is one the member
// decides (supply.manage over its object), waits for the decision, is named once; the price is a sum in rubles.
func (r *req) checkPurchaseLines(ctx context.Context, in []rapi.PurchaseLineInput) ([]*supplyRow, []purchaseLine, error) {
	reqs := make([]*supplyRow, 0, len(in))
	lines := make([]purchaseLine, 0, len(in))
	var total int64
	for i, l := range in {
		field := "lines[" + strconv.Itoa(i) + "]"
		if slices.ContainsFunc(reqs, func(q *supplyRow) bool { return q.id == l.SupplyRequestId }) {
			return nil, nil, invalid(field+".supplyRequestId", textLineDuplicate, "duplicate")
		}
		q, err := r.decidable(ctx, l.SupplyRequestId, field+".supplyRequestId")
		if err != nil {
			return nil, nil, err
		}
		price, err := r.linePrice(ctx, q, l.Price, field+".price")
		if err != nil {
			return nil, nil, err
		}
		sum := costOf(q.qty, price)
		if total += sum; sum > maxMinor || total > maxMinor {
			return nil, nil, invalid(field+".price", textCostTooBig, "too_big")
		}
		reqs = append(reqs, q)
		lines = append(lines, purchaseLine{request: q.id, project: q.project, priceItem: q.priceItem, qty: q.qty, price: price, currency: currencyRUB})
	}
	return reqs, lines, nil
}

// decidable is the request a purchase may take (locked): it is there, the member sees its object and decides its supply,
// it waits for the decision. A request that is not there or hidden is a violation of the field.
func (r *req) decidable(ctx context.Context, id uuid.UUID, field string) (*supplyRow, error) {
	q, err := r.supplyRequest(ctx, id, true)
	if err != nil {
		return nil, err
	}
	if q == nil {
		return nil, invalid(field, textLineUnknown, "unknown")
	}
	p, err := r.project(ctx, q.project, false)
	if err != nil {
		return nil, err
	}
	if ok, err := r.sees(ctx, p); err != nil || !ok {
		if err == nil {
			err = invalid(field, textLineUnknown, "unknown")
		}
		return nil, err
	}
	if err := r.need(ctx, p, actSupply, textNeedSupply); err != nil {
		return nil, err
	}
	if q.state != stRequest {
		return nil, conflict(reasonSupplyState, textSupplyState)
	}
	return q, nil
}

// linePrice is the price of a unit of a line: the given one or the default of Q-W6.13-1.
func (r *req) linePrice(ctx context.Context, q *supplyRow, given *rapi.Money, field string) (int64, error) {
	if given == nil {
		last, err := r.lastPrice(ctx, q.priceItem)
		return unitPriceOf(last, q.catalogPrice), err
	}
	if given.Currency != currencyRUB || given.AmountMinor < 0 || int64(given.AmountMinor) > maxMinor {
		return 0, invalid(field, textPriceBad, "invalid")
	}
	return int64(given.AmountMinor), nil
}

// Purchases answers listPurchases: the purchases with a line of an object the member decides, the latest first.
func (s *Service) Purchases(ctx context.Context, tc tenantctx.TenantContext, cursor *string, limit *int) (rapi.PurchasePage, error) {
	out := rapi.PurchasePage{Items: []rapi.Purchase{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		if err := r.needSupplyAnywhere(ctx); err != nil {
			return err
		}
		ids, err := r.manageable(ctx)
		if err != nil || len(ids) == 0 {
			return err
		}
		from, n, err := window(cursor, limit)
		if err != nil {
			return err
		}
		rows, err := r.tx.Query(ctx, `select `+purchaseCols+` from repairs.purchases u where exists (select 1 from repairs.purchase_lines l where l.purchase_id = u.id
			and l.project_id = any($1)) order by u.created_at desc, u.id desc offset $2 limit $3`, ids, from, n+1)
		if err != nil {
			return store("purchases", err)
		}
		var ps []*purchaseRow
		for rows.Next() {
			u := &purchaseRow{}
			if err := u.scan(rows); err != nil {
				rows.Close()
				return store("purchases", err)
			}
			ps = append(ps, u)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return store("purchases", err)
		}
		if len(ps) > n {
			ps, out.NextCursor = ps[:n], new("o"+strconv.Itoa(from+n))
		}
		if err := r.loadPurchaseLines(ctx, ps); err != nil {
			return err
		}
		for _, u := range ps {
			out.Items = append(out.Items, purchaseDTO(u))
		}
		return nil
	})
	return out, err
}

// manageable are the objects the member sees and holds supply.manage over.
func (r *req) manageable(ctx context.Context) ([]uuid.UUID, error) {
	ids, manage, err := r.supplyProjects(ctx, nil)
	if err != nil {
		return nil, err
	}
	return slices.DeleteFunc(ids, func(id uuid.UUID) bool { return !manage[id] }), nil
}

// ReceivePurchase answers receivePurchase: the purchase arrived by the receipt QR — the requests become «bought», the cost
// of each line goes to the stock of its object.
func (s *Service) ReceivePurchase(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch, receiptQR string) (rapi.Purchase, error) {
	var out rapi.Purchase
	err := s.run(ctx, tc, true, func(r *req) error {
		if err := r.needSupplyAnywhere(ctx); err != nil {
			return err
		}
		u, err := r.receivable(ctx, id, ifMatch)
		if err != nil {
			return err
		}
		qr := strings.TrimSpace(receiptQR)
		if c := utf8.RuneCountInString(qr); c < 1 || c > 500 {
			return invalid("receiptQr", textReceiptShort, "required")
		}
		if err := r.arrive(ctx, u, qr); err != nil {
			return err
		}
		for _, project := range u.projects() {
			if err := r.event(ctx, project, evSupplyReceived, "получена закупка "+u.number+" по чеку"); err != nil {
				return err
			}
		}
		if u, err = r.purchase(ctx, id, false); err != nil {
			return err
		}
		out = purchaseDTO(u)
		return r.publish(ctx, topicPurchaseRecv, aggPurchase, u.id, map[string]any{"purchaseId": u.id, "number": u.number, "projectIds": u.projects()})
	})
	return out, err
}

// receivable is the purchase (locked) that waits for the receipt: it is there, the member decides every object of it, the
// revision is current.
func (r *req) receivable(ctx context.Context, id uuid.UUID, ifMatch string) (*purchaseRow, error) {
	u, err := r.purchase(ctx, id, true)
	if err != nil {
		return nil, err
	}
	if u == nil {
		return nil, notFound(textPurchaseNotFound)
	}
	if err := r.decides(ctx, u); err != nil {
		return nil, err
	}
	if err := checkRev(ifMatch, u.revision, textPurchaseChanged); err != nil {
		return nil, err
	}
	if u.state != purchaseOrdered {
		return nil, conflict(reasonPurchaseState, textPurchaseState)
	}
	return u, nil
}

// arrive marks the purchase received and spreads its lines over the objects: the requests become «bought» at the cost of
// the line, the cost goes to the stock of the object.
func (r *req) arrive(ctx context.Context, u *purchaseRow, receiptQR string) error {
	for _, l := range u.lines {
		q, err := r.supplyRequest(ctx, l.request, true)
		if err != nil || q == nil {
			return err
		}
		cost := costOf(l.qty, l.price)
		if err := r.setState(ctx, q, stBought, nil, nil, &cost); err != nil {
			return err
		}
		if err := r.addStock(ctx, l.project, l.priceItem, l.qty, cost); err != nil {
			return err
		}
	}
	_, err := r.tx.Exec(ctx, `update repairs.purchases set state = 'received', receipt_qr = $2, received_at = $3, revision = revision + 1 where id = $1`, u.id, receiptQR, r.now)
	return store("receive purchase", err)
}

// decides requires supply.manage over every object of the purchase: 403 for the member of an area that covers only a part.
func (r *req) decides(ctx context.Context, u *purchaseRow) error {
	for _, project := range u.projects() {
		p, err := r.project(ctx, project, false)
		if err != nil || p == nil {
			return err
		}
		if err := r.need(ctx, p, actSupply, textNeedSupply); err != nil {
			return err
		}
	}
	return nil
}
