package repairs

import (
	"context"
	"slices"
	"time"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

// Kinds of the feed of an object written by step 6.3 (repairs.project_events.kind).
const (
	evMeasured          = "measurement.saved"
	evEstimateBuilt     = "estimate.draft_created"
	evEstimateRevision  = "estimate.revision_created"
	evEstimateSent      = "estimate.sent"
	evEstimateRecalled  = "estimate.recalled"
	evEstimateDeleted   = "estimate.deleted"
	evEstimateApproved  = "estimate.approved"
	evChangeProposed    = "change_order.proposed"
	evChangeRejected    = "change_order.rejected"
	evSignRequested     = "document.sign_requested"
	evDocumentSigned    = "document.signed"
	stateDraft          = "draft"
	stateSent           = "sent"
	stateApproved       = "approved"
	stateReplaced       = "replaced"
	kindFirst           = "first"
	kindRevision        = "revision"
	kindChange          = "change"
	codeEstimateLocked  = "estimate_version_locked"
	codeDraftExists     = "estimate_draft_exists"
	codeChangeClosed    = "change_order_closed"
	codeAgreementWaits  = "agreement_pending"
	reasonDocumentState = "repair_document_state"
)

// Texts of the estimates (the prototype, design/docs/19 «Смета: кто правит, версии, допработы, шаблоны»).
const (
	textEstimateNotFound = "Версия сметы не найдена."
	textNeedFinance      = "Нужно право «Видеть финансы объекта»."
	textNeedEstimates    = "Нужно право «Составлять сметы»."
	textDraftExists      = "У объекта уже есть черновик или отправленная версия сметы."
	textBuilt            = "Смета уже собрана: новая версия — через «Новую версию сметы»."
	textLocked           = "Версия отправлена или согласована: отозвите отправку или изменяйте через допсоглашение."
	textEstimateChanged  = "Смету уже изменили — обновите страницу"
	textTemplateMissing  = "Шаблона нет в организации."
	textAgreementPending = "Допсоглашение у заказчика: дождитесь подписи или отзовите его."
	textBeforeContract   = "До договора правка — новая версия сметы."
	textAfterContract    = "После договора правка — только допсоглашение."
	textNoLines          = "Добавьте в смету хотя бы одну строку."
	textTotalTooBig      = "Сумма сметы слишком велика."
	textNoSection        = "Без раздела"
)

// failureOf is a refusal with a code of its own (409 of the estimates: estimate_version_locked and the like).
func failureOf(code, detail string) *failure { return &failure{code: code, detail: detail} }

// estRow is a version of the estimate of an object (repairs.estimates).
type estRow struct {
	id, project        uuid.UUID
	version            int
	kind, state        string
	base               *int
	template           *uuid.UUID
	discount           int
	agreementNo        *int
	changes            []uuid.UUID
	sentAt, approvedAt *time.Time
	revision           int64
}

const estCols = `e.id, e.project_id, e.version, e.kind, e.state, e.base_version, e.template_id, e.discount_pct, e.agreement_no,
	e.change_order_ids, e.sent_at, e.approved_at, e.revision`

func (e *estRow) scan(row interface{ Scan(...any) error }) error {
	return row.Scan(&e.id, &e.project, &e.version, &e.kind, &e.state, &e.base, &e.template, &e.discount, &e.agreementNo,
		&e.changes, &e.sentAt, &e.approvedAt, &e.revision)
}

// secRow is a section of a version.
type secRow struct {
	id   uuid.UUID
	name string
	sort int
}

// lineRow is a line of a version; key is the id of the contract (the same in every version the line is copied to).
type lineRow struct {
	id, key, section uuid.UUID
	item             *uuid.UUID
	name, unit, kind string
	price            int64
	qty              milli
	formula          *string
	coef             *milli
	manual, isNew    bool
	sort             int
}

// versions reads the versions of an object, the oldest first.
func (r *req) versions(ctx context.Context, project uuid.UUID) ([]*estRow, error) {
	rows, err := r.tx.Query(ctx, `select `+estCols+` from repairs.estimates e where e.project_id = $1 order by e.version`, project)
	if err != nil {
		return nil, store("estimates", err)
	}
	defer rows.Close()
	var out []*estRow
	for rows.Next() {
		e := &estRow{}
		if err := e.scan(rows); err != nil {
			return nil, store("estimates", err)
		}
		out = append(out, e)
	}
	return out, store("estimates", rows.Err())
}

// estimate reads one version of an object; nil — there is none.
func (r *req) estimate(ctx context.Context, project uuid.UUID, version int) (*estRow, error) {
	e := &estRow{}
	if err := e.scan(r.tx.QueryRow(ctx, `select `+estCols+` from repairs.estimates e where e.project_id = $1 and e.version = $2`, project, version)); err != nil {
		if noRows(err) {
			return nil, nil
		}
		return nil, store("estimate", err)
	}
	return e, nil
}

// estimateOr404 is the version as the member asks for it: 404 «Версия сметы не найдена».
func (r *req) estimateOr404(ctx context.Context, project uuid.UUID, version int) (*estRow, error) {
	e, err := r.estimate(ctx, project, version)
	if err != nil {
		return nil, err
	}
	if e == nil {
		return nil, notFound(textEstimateNotFound)
	}
	return e, nil
}

func (r *req) sections(ctx context.Context, estimate uuid.UUID) ([]secRow, error) {
	rows, err := r.tx.Query(ctx, `select id, name, sort from repairs.estimate_sections where estimate_id = $1 order by sort, id`, estimate)
	if err != nil {
		return nil, store("sections", err)
	}
	defer rows.Close()
	var out []secRow
	for rows.Next() {
		var s secRow
		if err := rows.Scan(&s.id, &s.name, &s.sort); err != nil {
			return nil, store("sections", err)
		}
		out = append(out, s)
	}
	return out, store("sections", rows.Err())
}

func (r *req) lines(ctx context.Context, estimate uuid.UUID) ([]lineRow, error) {
	rows, err := r.tx.Query(ctx, `select l.id, l.line_key, l.section_id, l.price_item_id, l.name, l.unit, l.kind, l.price_minor,
		(l.quantity * 1000)::bigint, l.formula, (l.coef * 1000)::bigint, l.manual, l.is_new, l.sort
		from repairs.estimate_lines l join repairs.estimate_sections s on s.id = l.section_id
		where l.estimate_id = $1 order by s.sort, s.id, l.sort, l.id`, estimate)
	if err != nil {
		return nil, store("lines", err)
	}
	defer rows.Close()
	var out []lineRow
	for rows.Next() {
		var (
			l    lineRow
			qty  int64
			coef *int64
		)
		if err := rows.Scan(&l.id, &l.key, &l.section, &l.item, &l.name, &l.unit, &l.kind, &l.price, &qty, &l.formula, &coef, &l.manual, &l.isNew, &l.sort); err != nil {
			return nil, store("lines", err)
		}
		l.qty = milli(qty)
		if coef != nil {
			l.coef = new(milli(*coef))
		}
		out = append(out, l)
	}
	return out, store("lines", rows.Err())
}

// sums are the sums of the lines (kopecks); ok is false when one of them or the total leaves the integer range.
func sums(lines []lineRow) ([]int64, bool) {
	out := make([]int64, 0, len(lines))
	var all int64
	for _, l := range lines {
		s, ok := lineSum(l.price, l.qty)
		if !ok {
			return nil, false
		}
		all += s
		if all > maxMoney {
			return nil, false
		}
		out = append(out, s)
	}
	return out, true
}

// totalOf is the total of a version (the lines less the discount) in kopecks; ok is false beyond the range.
func totalOf(lines []lineRow, discount int) (int64, bool) {
	s, ok := sums(lines)
	if !ok {
		return 0, false
	}
	_, _, total := estimateTotal(s, discount)
	return total, true
}

func moneyOut(minor int64) rapi.Money { return rapi.Money{AmountMinor: int(minor), Currency: currency} }

func deltaOut(minor int64) rapi.RepairMoneyDelta {
	return rapi.RepairMoneyDelta{AmountMinor: minor, Currency: currency}
}

func lineOut(l lineRow) rapi.EstimateLine {
	sum, _ := lineSum(l.price, l.qty)
	out := rapi.EstimateLine{Id: l.key, SectionId: l.section, Name: l.name, Unit: rapi.RepairUnit(l.unit), Kind: rapi.EstimateLineKind(l.kind),
		Price: moneyOut(l.price), Quantity: l.qty.String(), Sum: moneyOut(sum), Manual: l.manual, IsNew: l.isNew, PriceItemId: l.item, Formula: l.formula}
	if l.coef != nil {
		out.Coef = new(l.coef.String())
	}
	return out
}

// estimateOut is a version with its sections, lines and total.
func (r *req) estimateOut(ctx context.Context, e *estRow) (rapi.Estimate, error) {
	secs, err := r.sections(ctx, e.id)
	if err != nil {
		return rapi.Estimate{}, err
	}
	lines, err := r.lines(ctx, e.id)
	if err != nil {
		return rapi.Estimate{}, err
	}
	total, _ := totalOf(lines, e.discount)
	out := rapi.Estimate{ProjectId: e.project, Version: e.version, Kind: rapi.EstimateKind(e.kind), State: rapi.EstimateState(e.state),
		Sections: make([]rapi.EstimateSection, 0, len(secs)), Lines: make([]rapi.EstimateLine, 0, len(lines)), DiscountPct: e.discount,
		Total: moneyOut(total), ChangeOrderIds: append([]uuid.UUID{}, e.changes...), Revision: e.revision, BaseVersion: e.base,
		TemplateId: e.template, AgreementNo: e.agreementNo, SentAt: e.sentAt, ApprovedAt: e.approvedAt}
	for _, s := range secs {
		out.Sections = append(out.Sections, rapi.EstimateSection{Id: s.id, Name: s.name})
	}
	for _, l := range lines {
		out.Lines = append(out.Lines, lineOut(l))
	}
	return out, nil
}

// insertEstimate writes a version; the caller fills its sections and lines.
func (r *req) insertEstimate(ctx context.Context, e *estRow) error {
	e.id = uuid.New()
	e.revision = 1
	var by *uuid.UUID
	if r.me() != uuid.Nil {
		by = new(r.me())
	}
	if e.changes == nil {
		e.changes = []uuid.UUID{}
	}
	_, err := r.tx.Exec(ctx, `insert into repairs.estimates (id, project_id, version, kind, state, base_version, template_id, discount_pct, change_order_ids, created_by, created_at)
		values ($1, $2, $3, $4, 'draft', $5, $6, $7, $8, $9, $10)`, e.id, e.project, e.version, e.kind, e.base, e.template, e.discount, e.changes, by, r.now)
	e.state = stateDraft
	return store("insert estimate", err)
}

func (r *req) insertSection(ctx context.Context, estimate uuid.UUID, name string, sort int) (uuid.UUID, error) {
	id := uuid.New()
	_, err := r.tx.Exec(ctx, `insert into repairs.estimate_sections (id, estimate_id, name, sort) values ($1, $2, $3, $4)`, id, estimate, name, sort)
	return id, store("insert section", err)
}

// insertLine writes a line; a zero key makes a new one (a copy keeps the key of its source).
func (r *req) insertLine(ctx context.Context, estimate uuid.UUID, l lineRow) error {
	if l.key == uuid.Nil {
		l.key = uuid.New()
	}
	var coef *int64
	if l.coef != nil {
		coef = new(int64(*l.coef))
	}
	_, err := r.tx.Exec(ctx, `insert into repairs.estimate_lines (id, line_key, estimate_id, section_id, price_item_id, name, unit, kind, price_minor, currency,
		quantity, formula, coef, manual, is_new, sort) values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::bigint::numeric / 1000, $11,
		$12::bigint::numeric / 1000, $13, $14, $15)`, l.key, estimate, l.section, l.item, l.name, l.unit, l.kind, l.price, currency, int64(l.qty), l.formula, coef,
		l.manual, l.isNew, l.sort)
	return store("insert line", err)
}

// bump counts a change of a version.
func (r *req) bump(ctx context.Context, e *estRow) error {
	e.revision++
	_, err := r.tx.Exec(ctx, `update repairs.estimates set revision = $2 where id = $1`, e.id, e.revision)
	return store("bump estimate", err)
}

// editor requires the right to estimate over the object (repairs.estimates.edit, together with repairs.finance.read).
func (r *req) editor(ctx context.Context, p *projectRow) error {
	if err := r.need(ctx, p, actEstimates, textNeedEstimates); err != nil {
		return err
	}
	return r.need(ctx, p, actFinance, textNeedFinance)
}

// current is the version in force (the latest approved), nil — there is none.
func current(vs []*estRow) *estRow {
	for _, v := range slices.Backward(vs) {
		if v.state == stateApproved {
			return v
		}
	}
	return nil
}

// open is the version that is a draft or sent (an object has at most one), nil — there is none.
func open(vs []*estRow) *estRow {
	for _, v := range vs {
		if v.state == stateDraft || v.state == stateSent {
			return v
		}
	}
	return nil
}

// nextVersion is the number of the next version.
func nextVersion(vs []*estRow) int {
	if len(vs) == 0 {
		return 1
	}
	return vs[len(vs)-1].version + 1
}
