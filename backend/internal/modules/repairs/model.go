package repairs

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

// Actions of the module (api/permissions.yaml, the catalog of modulesreg).
const (
	actRead      = "repairs.projects.read"
	actManage    = "repairs.projects.manage"
	actHandOver  = "repairs.projects.hand_over"
	actLogsRead  = "repairs.work_logs.read"
	actSubmit    = "repairs.work_logs.submit"
	actReview    = "repairs.work_logs.review"
	actFinance   = "repairs.finance.read"
	actEstimates = "repairs.estimates.edit"
	actSupply    = "repairs.supply.manage"
	actCatalog   = "repairs.catalog.manage"
)

// Statuses of an object (repairs.projects.status) and of a mark (repairs.work_logs.status).
const (
	statusDraft      = "draft"
	statusActive     = "active"
	statusHandedOver = "handed_over"

	logSubmitted = "submitted"
	logAccepted  = "accepted"
	logRejected  = "rejected"
)

// Stages of an object the module sets: a draft waits for the measurement, an activated object prepares.
const (
	stageMeasure = "Замер"
	stagePrepare = "Подготовка"
)

// Kinds of the feed of an object (repairs.project_events.kind; the events of docs/12 without the sums).
const (
	evDraftCreated    = "object.draft_created"
	evCreated         = "object.created"
	evActivated       = "object.activated"
	evForemanAssigned = "object.foreman_assigned"
	evHandedOver      = "object.handed_over"
	evLogSubmitted    = "work_log.submitted"
	evLogAccepted     = "work_log.accepted"
	evLogReturned     = "work_log.returned"
)

// Warranty of an object after the hand over: the months of the template «Ремонт под ключ» (design/docs/19).
const defaultWarrantyMonths = 24

// milli is a quantity in thousandths (numeric(14, 3) of the tables, Quantity of the contract: «46.82», «18»).
type milli int64

// parseQty reads a Quantity: digits with at most three decimals, no sign.
func parseQty(s string) (milli, bool) {
	whole, frac, _ := strings.Cut(s, ".")
	if whole == "" || len(frac) > 3 || !digits(whole) || (frac != "" && !digits(frac)) || len(whole) > 11 {
		return 0, false
	}
	if strings.Contains(s, ".") && frac == "" {
		return 0, false
	}
	w, err := strconv.ParseInt(whole, 10, 64)
	if err != nil {
		return 0, false
	}
	f := int64(0)
	if frac != "" {
		f, _ = strconv.ParseInt((frac + "000")[:3], 10, 64)
	}
	return milli(w*1000 + f), true
}

func digits(s string) bool {
	for _, c := range s {
		if c < '0' || c > '9' {
			return false
		}
	}
	return s != ""
}

// String is the Quantity of the contract: the decimals without trailing zeros.
func (m milli) String() string {
	s := strconv.FormatInt(int64(m)/1000, 10)
	if f := int64(m) % 1000; f != 0 {
		s += "." + strings.TrimRight(fmt.Sprintf("%03d", f), "0")
	}
	return s
}

// overPlan applies the rule of a mark to a line of qty: the rest of the work is the plan less the accepted fact and
// the volume on acceptance; a line is over when it exceeds the rest by more than 10 % of it and 10 % of the plan.
// It returns the rest for the text of the refusal («осталось N»).
func overPlan(qty, plan, fact, pending milli) (bool, milli) {
	left := max(0, plan-fact-pending)
	return qty*10 > left*11 && qty*10 > plan && qty > left, left
}

// pct is n of plan in whole percents rounded half up and capped at 100 (0 without a plan).
func pct(n, plan milli) int {
	if plan <= 0 {
		return 0
	}
	return int(min(100, (n*200+plan)/(plan*2)))
}

// readinessOf is the readiness of an object (Q-W4.00-repair-4): the team — accepted volumes to the plan and the
// volumes on acceptance; the client — signed acts to acts.
func readinessOf(plan, fact, pending milli, acts, signed int) rapi.RepairReadiness {
	client := 0
	if acts > 0 {
		client = (signed*200 + acts) / (acts * 2)
	}
	return rapi.RepairReadiness{AcceptedPct: pct(fact, plan), PendingPct: pct(pending, plan), ClientPct: client}
}

// unitsRu are the short names of the units in the texts of the queue of decisions (the prototype).
var unitsRu = map[string]string{
	unitHour: "ч", unitM2: "м²", unitM3: "м³", unitM: "м", unitPiece: "шт", unitSet: "компл", unitTrip: "рейс", unitMesh: "меш", unitLiter: "л",
}

func unitRu(u string) string {
	if r, ok := unitsRu[u]; ok {
		return r
	}
	return u
}

// projectRow is a row of repairs.projects.
type projectRow struct {
	id, unit                    uuid.UUID
	name, address, status       string
	kind, stage                 *string
	area                        *milli
	rooms                       *int
	contractNo                  *string
	startOn, dueOn              *time.Time
	clientName, clientPhone     *string
	foreman, template, leadTask *uuid.UUID
	access                      []byte
	budget                      *int64
	currency                    string
	handedOverOn, warrantyUntil *time.Time
	revision                    int64
	createdAt                   time.Time
}

// projectCols are the columns scanned into projectRow, in its order.
const projectCols = `p.id, p.org_unit_id, p.name, p.address, p.status, p.kind, p.stage,
	case when p.area_m2 is null then null else round(p.area_m2 * 1000)::bigint end, p.rooms, p.contract_no, p.start_on, p.due_on,
	p.client_name, p.client_phone, p.foreman_id, p.template_id, p.lead_task_id, p.access, p.budget_minor, p.currency,
	p.handed_over_on, p.warranty_until, p.revision, p.created_at`

func (p *projectRow) scan(row interface{ Scan(...any) error }) error {
	var area *int64
	err := row.Scan(&p.id, &p.unit, &p.name, &p.address, &p.status, &p.kind, &p.stage, &area, &p.rooms, &p.contractNo, &p.startOn, &p.dueOn,
		&p.clientName, &p.clientPhone, &p.foreman, &p.template, &p.leadTask, &p.access, &p.budget, &p.currency,
		&p.handedOverOn, &p.warrantyUntil, &p.revision, &p.createdAt)
	if area != nil {
		p.area = new(milli(*area))
	}
	return err
}

func (p *projectRow) isForeman(me uuid.UUID) bool {
	return p.foreman != nil && me != uuid.Nil && *p.foreman == me
}
