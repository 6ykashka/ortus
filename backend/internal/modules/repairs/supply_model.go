package repairs

import (
	"math/big"
	"slices"
	"time"

	"github.com/google/uuid"
)

// Actions of the supply (api/permissions.yaml) and of the module «Склад» that the supply needs.
const (
	actSupplyRequest = "repairs.supply.request"
	actMovementsPost = "inventory.movements.post"
	actMovementsRead = "inventory.movements.read"
)

// Reasons of invalid_transition (api/errors.yaml, W6.00).
const (
	reasonSupplyState   = "repair_supply_state"
	reasonPurchaseState = "repair_purchase_state"
	reasonStock         = "repair_stock_insufficient"
)

// States of a supply request (repairs.supply_requests.state) and of a purchase.
const (
	stRequest  = "request"
	stReserved = "reserved"
	stIssued   = "issued"
	stOrdered  = "ordered"
	stBought   = "bought"
	stUsed     = "used"

	purchaseOrdered  = "ordered"
	purchaseReceived = "received"
)

// Kinds of the feed of an object that the supply writes, and the events of the outbox.
const (
	evSupplyRequested   = "supply.requested"
	evSupplyReserved    = "supply.reserved"
	evSupplyIssued      = "supply.issued"
	evSupplyUsed        = "supply.used"
	evSupplyOrdered     = "supply.ordered"
	evSupplyReceived    = "supply.received"
	evSupplyReturned    = "supply.returned"
	evSupplyTransferred = "supply.transferred"

	topicRequestCreated  = "repairs.supply_request.created.v1"
	topicRequestReserved = "repairs.supply_request.reserved.v1"
	topicRequestIssued   = "repairs.supply_request.issued.v1"
	topicRequestUsed     = "repairs.supply_request.consumed.v1"
	topicPurchaseOrder   = "repairs.purchase.ordered.v1"
	topicPurchaseRecv    = "repairs.purchase.received.v1"
	topicStockReturned   = "repairs.project_stock.returned.v1"
	topicStockMoved      = "repairs.project_stock.transferred.v1"

	aggRequest  = "repairs.supply_request"
	aggPurchase = "repairs.purchase"
	aggProject  = "repairs.project"
)

// currencyRUB is the only currency of the module (Money.currency of the contract is a code, the tables default to RUB).
const currencyRUB = "RUB"

// maxMinor is the largest sum the tables take (a check of the columns *_minor: the exact integer range of JSON).
const maxMinor = 9007199254740991

// requestNumberPrefix and purchaseNumberPrefix start the numbers from the sequence of the tenant.
const (
	requestNumberPrefix  = "З-"
	purchaseNumberPrefix = "ЗК-"
)

// micro is a quantity in millionths: the unit of the balances of the module «Склад» (numeric(18, 6)).
type micro int64

func (m milli) micro() micro { return micro(m) * 1000 }

// mulDiv is a×b/d rounded half up (a, b ≥ 0, d > 0) without an overflow of the product.
func mulDiv(a, b, d int64) int64 {
	n := new(big.Int).Mul(big.NewInt(a), big.NewInt(b))
	n.Mul(n, big.NewInt(2))
	n.Add(n, big.NewInt(d))
	n.Quo(n, big.NewInt(2*d))
	if !n.IsInt64() {
		return maxMinor + 1 // above the range of a column: the caller refuses it
	}
	return n.Int64()
}

// costOf is the cost in kopecks of qty at the price of a unit.
func costOf(qty milli, unitPrice int64) int64 { return mulDiv(int64(qty), unitPrice, 1000) }

// shareOf is the part of cost that take of the have on hand carries (all of it when take reaches have).
func shareOf(cost int64, take, have milli) int64 {
	if have <= 0 || take >= have {
		return cost
	}
	return mulDiv(cost, int64(take), int64(have))
}

// unitPriceOf is the price of a unit of a material (Q-W6.13-1): the last received purchase, else the price list.
func unitPriceOf(lastPurchase *int64, catalog int64) int64 {
	if lastPurchase != nil {
		return *lastPurchase
	}
	return catalog
}

// allocate cuts want out of the rows in their order: how much to take from each, false when the rows hold less.
func allocate(free []int64, want int64) ([]int64, bool) {
	take := make([]int64, len(free))
	left := want
	for i, f := range free {
		n := min(f, left)
		take[i], left = n, left-n
	}
	if left > 0 {
		return nil, false
	}
	return take, true
}

// supplyFlow are the steps of a request: request → reserved → issued → used and request → ordered → bought → used.
var supplyFlow = map[string][]string{
	stRequest:  {stReserved, stOrdered},
	stReserved: {stIssued},
	stIssued:   {stUsed},
	stOrdered:  {stBought},
	stBought:   {stUsed},
}

func supplyStep(from, to string) bool {
	return slices.Contains(supplyFlow[from], to)
}

// supplyRow is a row of repairs.supply_requests with the names of its object and its material.
type supplyRow struct {
	id, project, priceItem uuid.UUID
	number, state          string
	qty                    milli
	needBy                 time.Time
	warehouse, purchase    *uuid.UUID
	cost                   *int64
	currency               string
	revision               int64
	createdAt              time.Time
	projectName, name      string
	unit                   string
	catalogPrice           int64
}

const supplyCols = `q.id, q.project_id, q.price_item_id, q.number, q.state, (q.quantity * 1000)::bigint, q.need_by, q.warehouse_id, q.purchase_id,
	q.cost_minor, q.currency, q.revision, q.created_at, p.name, i.name, i.unit, i.price_minor`

const supplyFrom = ` from repairs.supply_requests q join repairs.projects p on p.id = q.project_id join repairs.price_items i on i.id = q.price_item_id`

func (q *supplyRow) scan(row interface{ Scan(...any) error }) error {
	var qty int64
	err := row.Scan(&q.id, &q.project, &q.priceItem, &q.number, &q.state, &qty, &q.needBy, &q.warehouse, &q.purchase,
		&q.cost, &q.currency, &q.revision, &q.createdAt, &q.projectName, &q.name, &q.unit, &q.catalogPrice)
	q.qty = milli(qty)
	return err
}
