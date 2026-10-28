package repairs

import (
	"context"
	"slices"
	"strconv"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// finance opens a read of the estimates of an object: the object the member sees and repairs.finance.read over it.
func (r *req) finance(ctx context.Context, id uuid.UUID, lock bool) (*projectRow, error) {
	p, err := r.visibleProject(ctx, id, lock)
	if err != nil {
		return nil, err
	}
	return p, r.need(ctx, p, actFinance, textNeedFinance)
}

// Estimates answers listEstimates: the versions of the estimate of an object, the oldest first.
func (s *Service) Estimates(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (rapi.EstimateList, error) {
	out := rapi.EstimateList{Items: []rapi.Estimate{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		p, err := r.finance(ctx, id, false)
		if err != nil {
			return err
		}
		vs, err := r.versions(ctx, p.id)
		if err != nil {
			return err
		}
		for _, v := range vs {
			e, err := r.estimateOut(ctx, v)
			if err != nil {
				return err
			}
			out.Items = append(out.Items, e)
		}
		return nil
	})
	return out, err
}

// Estimate answers getEstimate.
func (s *Service) Estimate(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, version int) (rapi.Estimate, error) {
	var out rapi.Estimate
	err := s.run(ctx, tc, false, func(r *req) error {
		p, err := r.finance(ctx, id, false)
		if err != nil {
			return err
		}
		e, err := r.estimateOr404(ctx, p.id, version)
		if err != nil {
			return err
		}
		out, err = r.estimateOut(ctx, e)
		return err
	})
	return out, err
}

// writable opens a change of the estimates of an object: the object locked, the right to estimate, an object that is
// not handed over.
func (r *req) writable(ctx context.Context, id uuid.UUID) (*projectRow, error) {
	p, err := r.visibleProject(ctx, id, true)
	if err != nil {
		return nil, err
	}
	if err := r.editor(ctx, p); err != nil {
		return nil, err
	}
	if p.status == statusHandedOver {
		return nil, conflict(reasonHandedOver, textHandedOverEdit)
	}
	return p, nil
}

// EstimateFromTemplate answers createEstimateFromTemplate: the first draft of an object (version 1) from a template and
// the measurement; the prices are those of the price list at this moment.
func (s *Service) EstimateFromTemplate(ctx context.Context, tc tenantctx.TenantContext, id, template uuid.UUID) (rapi.Estimate, error) {
	var out rapi.Estimate
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.writable(ctx, id)
		if err != nil {
			return err
		}
		vs, err := r.versions(ctx, p.id)
		if err != nil {
			return err
		}
		switch {
		case open(vs) != nil:
			return failureOf(codeDraftExists, textDraftExists)
		case len(vs) > 0:
			return conflict("", textBuilt)
		}
		var name string
		if err := r.tx.QueryRow(ctx, `select name from repairs.templates where id = $1`, template).Scan(&name); err != nil {
			if noRows(err) {
				return invalid("templateId", textTemplateMissing, "unknown")
			}
			return store("template", err)
		}
		m, err := r.measurement(ctx, p.id)
		if err != nil {
			return err
		}
		e := &estRow{project: p.id, version: 1, kind: kindFirst, template: &template}
		if err := r.insertEstimate(ctx, e); err != nil {
			return err
		}
		if err := r.buildLines(ctx, e, template, measureRooms(m.rooms)); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update repairs.projects set template_id = $2, revision = revision + 1, updated_at = $3 where id = $1`, p.id, template, r.now); err != nil {
			return store("object template", err)
		}
		if err := r.event(ctx, p.id, evEstimateBuilt, "собран черновик сметы по шаблону «"+name+"»"); err != nil {
			return err
		}
		out, err = r.estimateOut(ctx, e)
		return err
	})
	return out, err
}

// builtLine is a line of the first draft with the section of the template it goes into.
type builtLine struct {
	section string
	line    lineRow
}

// templateSources reads the lines of a template with the price list, the volumes by the formulas on the measurement.
func (r *req) templateSources(ctx context.Context, template uuid.UUID, t totals) ([]builtLine, error) {
	rows, err := r.tx.Query(ctx, `select tl.section, tl.price_item_id, pi.name, pi.unit, pi.kind, pi.price_minor, (tl.quantity * 1000)::bigint, tl.formula, (tl.coef * 1000)::bigint
		from repairs.template_lines tl join repairs.price_items pi on pi.id = tl.price_item_id
		where tl.template_id = $1 and tl.part = 'estimate' order by tl.sort, tl.id`, template)
	if err != nil {
		return nil, store("template lines", err)
	}
	defer rows.Close()
	var all []builtLine
	for rows.Next() {
		var (
			s         builtLine
			item      uuid.UUID
			qty, coef *int64
		)
		if err := rows.Scan(&s.section, &item, &s.line.name, &s.line.unit, &s.line.kind, &s.line.price, &qty, &s.line.formula, &coef); err != nil {
			return nil, store("template lines", err)
		}
		s.line.item = &item
		k := milli(1000)
		if coef != nil {
			k = milli(*coef)
			s.line.coef = &k
		}
		switch {
		case s.line.formula != nil:
			s.line.qty = volume(*s.line.formula, k, s.line.unit, t)
		case qty != nil:
			s.line.qty = milli(*qty)
		}
		all = append(all, s)
	}
	return all, store("template lines", rows.Err())
}

// buildLines writes the sections and the lines of the first draft: the lines of the template in its order, the sections
// in the order they appear, the volumes by the formulas on the measurement, the prices of the price list.
func (r *req) buildLines(ctx context.Context, e *estRow, template uuid.UUID, t totals) error {
	all, err := r.templateSources(ctx, template, t)
	if err != nil {
		return err
	}
	sections := map[string]uuid.UUID{}
	for i, s := range all {
		name := strings.TrimSpace(s.section)
		if name == "" {
			name = textNoSection
		}
		id, ok := sections[name]
		if !ok {
			if id, err = r.insertSection(ctx, e.id, name, len(sections)); err != nil {
				return err
			}
			sections[name] = id
		}
		l := s.line
		l.section, l.sort = id, i
		if _, ok := lineSum(l.price, l.qty); !ok || l.qty > maxQty {
			return invalid("templateId", textTotalTooBig, "max")
		}
		if err := r.insertLine(ctx, e.id, l); err != nil {
			return err
		}
	}
	lines, err := r.lines(ctx, e.id)
	if err != nil {
		return err
	}
	if _, ok := totalOf(lines, 0); !ok {
		return invalid("templateId", textTotalTooBig, "max")
	}
	return nil
}

// changeOrderRow is a change order as the estimates read it.
type changeOrderRow struct {
	id     uuid.UUID
	seq    int
	status string
}

// pickChanges reads the change orders an agreement collects, in the order asked: each belongs to the object and is not
// closed. A signed or rejected one — change_order_closed, one that is already at the client — agreement_pending.
func (r *req) pickChanges(ctx context.Context, project uuid.UUID, ids []uuid.UUID) ([]changeOrderRow, error) {
	out := make([]changeOrderRow, 0, len(ids))
	for i, id := range ids {
		c := changeOrderRow{id: id}
		err := r.tx.QueryRow(ctx, `select seq, status from repairs.change_orders where id = $1 and project_id = $2`, id, project).Scan(&c.seq, &c.status)
		if noRows(err) {
			return nil, invalid("changeOrderIds["+strconv.Itoa(i)+"]", "Допработы нет у объекта.", "unknown")
		}
		if err != nil {
			return nil, store("change order", err)
		}
		switch c.status {
		case stateSigned, stateRejected:
			return nil, failureOf(codeChangeClosed, "Допработа ДР-"+strconv.Itoa(c.seq)+" уже "+map[string]string{stateSigned: "подписана", stateRejected: "отклонена"}[c.status]+".")
		case stateSent:
			return nil, failureOf(codeAgreementWaits, textAgreementPending)
		}
		out = append(out, c)
	}
	return out, nil
}

// EstimateRevision answers createEstimateRevision: before the contract a new version from the one in force, after it an
// additional agreement; the change orders chosen go into the section «Допработы · ДР-N» and become priced.
func (s *Service) EstimateRevision(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b rapi.EstimateRevisionCreate) (rapi.Estimate, error) {
	var out rapi.Estimate
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.writable(ctx, id)
		if err != nil {
			return err
		}
		vs, err := r.versions(ctx, p.id)
		if err != nil {
			return err
		}
		cur, changes, err := r.revisionBasis(ctx, p, vs, b)
		if err != nil {
			return err
		}
		var ids []uuid.UUID
		if b.ChangeOrderIds != nil {
			ids = *b.ChangeOrderIds
		}
		e := &estRow{project: p.id, version: nextVersion(vs), kind: string(b.Kind), base: &cur.version, template: cur.template, discount: cur.discount, changes: ids}
		if err := r.insertEstimate(ctx, e); err != nil {
			return err
		}
		if err := r.cloneInto(ctx, cur.id, e.id); err != nil {
			return err
		}
		if err := r.addChangeSections(ctx, e, changes); err != nil {
			return err
		}
		if err := r.event(ctx, p.id, evEstimateRevision, "начата "+map[string]string{kindRevision: "новая версия сметы", kindChange: "версия сметы с допсоглашением"}[e.kind]+": версия "+strconv.Itoa(e.version)); err != nil {
			return err
		}
		out, err = r.estimateOut(ctx, e)
		return err
	})
	return out, err
}

// revisionBasis checks what a new version may be made from: the version in force, no open version, the kind that fits
// the object (a revision before the contract, an agreement after it) and the change orders it collects.
func (r *req) revisionBasis(ctx context.Context, p *projectRow, vs []*estRow, b rapi.EstimateRevisionCreate) (*estRow, []changeOrderRow, error) {
	cur := current(vs)
	switch o := open(vs); {
	case o != nil && o.state == stateSent && o.kind == kindChange:
		return nil, nil, failureOf(codeAgreementWaits, textAgreementPending)
	case o != nil:
		return nil, nil, failureOf(codeDraftExists, textDraftExists)
	case cur == nil:
		return nil, nil, conflict(reasonNoEstimate, textNoApproved)
	}
	want, text := kindChange, textAfterContract
	if p.status == statusDraft {
		want, text = kindRevision, textBeforeContract
	}
	var ids []uuid.UUID
	if b.ChangeOrderIds != nil {
		ids = *b.ChangeOrderIds
	}
	changes, err := r.pickChanges(ctx, p.id, ids)
	if err != nil {
		return nil, nil, err
	}
	switch {
	case string(b.Kind) != want:
		return nil, nil, invalid("kind", text, "kind")
	case want == kindRevision && len(changes) > 0:
		return nil, nil, invalid("changeOrderIds[0]", textBeforeContract, "kind")
	}
	return cur, changes, nil
}

// cloneInto copies the sections and the lines of a version into another: the lines keep their key, none is new.
func (r *req) cloneInto(ctx context.Context, from, to uuid.UUID) error {
	secs, err := r.sections(ctx, from)
	if err != nil {
		return err
	}
	lines, err := r.lines(ctx, from)
	if err != nil {
		return err
	}
	moved := map[uuid.UUID]uuid.UUID{}
	for _, s := range secs {
		if moved[s.id], err = r.insertSection(ctx, to, s.name, s.sort); err != nil {
			return err
		}
	}
	for _, l := range lines {
		l.section, l.isNew = moved[l.section], false
		if err := r.insertLine(ctx, to, l); err != nil {
			return err
		}
	}
	return nil
}

// addChangeSections adds a section «Допработы · ДР-N» per change order of an agreement and prices the change orders.
func (r *req) addChangeSections(ctx context.Context, e *estRow, changes []changeOrderRow) error {
	secs, err := r.sections(ctx, e.id)
	if err != nil {
		return err
	}
	for i, c := range changes {
		if _, err := r.insertSection(ctx, e.id, "Допработы · ДР-"+strconv.Itoa(c.seq), len(secs)+i); err != nil {
			return err
		}
	}
	if len(changes) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(changes))
	for _, c := range changes {
		ids = append(ids, c.id)
	}
	_, err = r.tx.Exec(ctx, `update repairs.change_orders set status = 'priced', revision = revision + 1, updated_at = $2 where id = any($1)`, ids, r.now)
	return store("price change orders", err)
}

// draftOf opens a version for a change: the object locked, the version found, If-Match checked.
func (r *req) draftOf(ctx context.Context, id uuid.UUID, version int, ifMatch string) (*projectRow, *estRow, error) {
	p, err := r.writable(ctx, id)
	if err != nil {
		return nil, nil, err
	}
	e, err := r.estimateOr404(ctx, p.id, version)
	if err != nil {
		return nil, nil, err
	}
	if err := checkRev(ifMatch, e.revision, textEstimateChanged); err != nil {
		return nil, nil, err
	}
	return p, e, nil
}

// PatchEstimate answers updateEstimateDraft: sections, lines from the price list, volumes (manual from then on), prices,
// removals, «вернуть из замера» and the discount of a draft in one batch; a refusal changes nothing.
func (s *Service) PatchEstimate(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, version int, ifMatch string, b rapi.EstimateDraftPatch) (rapi.Estimate, error) {
	var out rapi.Estimate
	err := s.run(ctx, tc, true, func(r *req) error {
		_, e, err := r.draftOf(ctx, id, version, ifMatch)
		if err != nil {
			return err
		}
		if e.state != stateDraft {
			return failureOf(codeEstimateLocked, textLocked)
		}
		if err := r.applyPatch(ctx, e, b); err != nil {
			return err
		}
		if err := r.bump(ctx, e); err != nil {
			return err
		}
		out, err = r.estimateOut(ctx, e)
		return err
	})
	return out, err
}

func at(field string, i int, sub string) string {
	if sub == "" {
		return field + "[" + strconv.Itoa(i) + "]"
	}
	return field + "[" + strconv.Itoa(i) + "]." + sub
}

// applyPatch performs the batch: the sections first (the lines may go into them), then the new lines, the changes of
// the lines, the removals, the returns to the measurement and the discount.
func (r *req) applyPatch(ctx context.Context, e *estRow, b rapi.EstimateDraftPatch) error {
	secs, err := r.addSections(ctx, e, b.AddSections)
	if err != nil {
		return err
	}
	lines, err := r.lines(ctx, e.id)
	if err != nil {
		return err
	}
	if b.AddLines != nil {
		if err := r.addLines(ctx, e, secs, len(lines), *b.AddLines); err != nil {
			return err
		}
	}
	if b.Lines != nil {
		if err := r.changeLines(ctx, lines, *b.Lines); err != nil {
			return err
		}
	}
	if err := r.dropLines(ctx, e, lines, b); err != nil {
		return err
	}
	if err := r.setDiscount(ctx, e, b.DiscountPct); err != nil {
		return err
	}
	all, err := r.lines(ctx, e.id)
	if err != nil {
		return err
	}
	if _, ok := totalOf(all, e.discount); !ok {
		return invalid("lines", textTotalTooBig, "max")
	}
	return nil
}

// addSections adds the sections of a batch and returns all the sections of the version.
func (r *req) addSections(ctx context.Context, e *estRow, names *[]string) ([]secRow, error) {
	secs, err := r.sections(ctx, e.id)
	if err != nil || names == nil {
		return secs, err
	}
	for i, name := range *names {
		n := strings.TrimSpace(name)
		if c := utf8.RuneCountInString(n); c < 1 || c > 150 {
			return nil, invalid(at("addSections", i, ""), "Назовите раздел.")
		}
		sec, err := r.insertSection(ctx, e.id, n, len(secs))
		if err != nil {
			return nil, err
		}
		secs = append(secs, secRow{id: sec, name: n, sort: len(secs)})
	}
	return secs, nil
}

// setDiscount sets the discount of a draft (any editor may give it, design/docs/19).
func (r *req) setDiscount(ctx context.Context, e *estRow, pct *int) error {
	if pct == nil {
		return nil
	}
	if *pct < 0 || *pct > 100 {
		return invalid("discountPct", "Скидка — от 0 до 100 %.", "range")
	}
	if _, err := r.tx.Exec(ctx, `update repairs.estimates set discount_pct = $2 where id = $1`, e.id, *pct); err != nil {
		return store("discount", err)
	}
	e.discount = *pct
	return nil
}
func (r *req) addLines(ctx context.Context, e *estRow, secs []secRow, n int, add []rapi.EstimateLineAdd) error {
	for i, a := range add {
		if !sectionIn(secs, a.SectionId) {
			return invalid(at("addLines", i, "sectionId"), "Раздела нет в смете.", "unknown")
		}
		l := lineRow{section: a.SectionId, qty: 1000, isNew: true, sort: n + i}
		err := r.tx.QueryRow(ctx, `select id, name, unit, kind, price_minor from repairs.price_items where id = $1 and not archived`, a.PriceItemId).
			Scan(new(uuid.UUID), &l.name, &l.unit, &l.kind, &l.price)
		if noRows(err) {
			return invalid(at("addLines", i, "priceItemId"), "Позиции нет в справочнике.", "unknown")
		}
		if err != nil {
			return store("price item", err)
		}
		l.item = &a.PriceItemId
		if a.Quantity != nil {
			if l.qty, err = quantity(at("addLines", i, "quantity"), *a.Quantity); err != nil {
				return err
			}
		}
		if err := r.insertLine(ctx, e.id, l); err != nil {
			return err
		}
	}
	return nil
}

func sectionIn(secs []secRow, id uuid.UUID) bool {
	for _, s := range secs {
		if s.id == id {
			return true
		}
	}
	return false
}

// quantity reads a quantity of a line: zero or more, within the column.
func quantity(field, raw string) (milli, error) {
	v, ok := parseQty(raw)
	if !ok || v > maxQty {
		return 0, invalid(field, "Укажите объём числом не больше трёх знаков после запятой.", "format")
	}
	return v, nil
}

func (r *req) changeLines(ctx context.Context, lines []lineRow, patch []rapi.EstimateLinePatch) error {
	for i, u := range patch {
		l := findLine(lines, u.Id)
		if l == nil {
			return invalid(at("lines", i, "id"), "Строки нет в смете.", "unknown")
		}
		if u.Quantity != nil {
			q, err := quantity(at("lines", i, "quantity"), *u.Quantity)
			if err != nil {
				return err
			}
			if _, err := r.tx.Exec(ctx, `update repairs.estimate_lines set quantity = $2::bigint::numeric / 1000, manual = true where id = $1`, l.id, int64(q)); err != nil {
				return store("line quantity", err)
			}
		}
		if u.Price != nil {
			if u.Price.Currency != currency || u.Price.AmountMinor < 0 || int64(u.Price.AmountMinor) > maxMoney {
				return invalid(at("lines", i, "price"), "Укажите цену в рублях, не меньше нуля.", "format")
			}
			if _, err := r.tx.Exec(ctx, `update repairs.estimate_lines set price_minor = $2 where id = $1`, l.id, u.Price.AmountMinor); err != nil {
				return store("line price", err)
			}
		}
	}
	return nil
}

func findLine(lines []lineRow, key uuid.UUID) *lineRow {
	for i := range lines {
		if lines[i].key == key {
			return &lines[i]
		}
	}
	return nil
}

// dropLines removes lines and returns the lines of a formula to the measurement.
func (r *req) dropLines(ctx context.Context, e *estRow, lines []lineRow, b rapi.EstimateDraftPatch) error {
	if b.RemoveLineIds != nil {
		for i, key := range *b.RemoveLineIds {
			l := findLine(lines, key)
			if l == nil {
				return invalid(at("removeLineIds", i, ""), "Строки нет в смете.", "unknown")
			}
			if _, err := r.tx.Exec(ctx, `delete from repairs.estimate_lines where id = $1`, l.id); err != nil {
				return store("remove line", err)
			}
		}
	}
	if b.ResetLineIds == nil {
		return nil
	}
	m, err := r.measurement(ctx, e.project)
	if err != nil {
		return err
	}
	t := measureRooms(m.rooms)
	for i, key := range *b.ResetLineIds {
		l := findLine(lines, key)
		if l == nil {
			return invalid(at("resetLineIds", i, ""), "Строки нет в смете.", "unknown")
		}
		if l.formula == nil {
			continue
		}
		k := milli(1000)
		if l.coef != nil {
			k = *l.coef
		}
		if _, err := r.tx.Exec(ctx, `update repairs.estimate_lines set quantity = $2::bigint::numeric / 1000, manual = false where id = $1`, l.id, int64(volume(*l.formula, k, l.unit, t))); err != nil {
			return store("reset line", err)
		}
	}
	return nil
}

// SendEstimate answers sendEstimate: the draft goes to the client and its volumes are fixed. An additional agreement gets
// its number, its change orders become «sent» and a document of the agreement appears («Ждёт подписи заказчика»).
func (s *Service) SendEstimate(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, version int, ifMatch string) (rapi.Estimate, error) {
	var out rapi.Estimate
	err := s.run(ctx, tc, true, func(r *req) error {
		p, e, err := r.draftOf(ctx, id, version, ifMatch)
		if err != nil {
			return err
		}
		if e.state != stateDraft {
			return failureOf(codeEstimateLocked, "Версия уже отправлена или согласована.")
		}
		lines, err := r.lines(ctx, e.id)
		if err != nil {
			return err
		}
		if len(lines) == 0 {
			return invalid("lines", textNoLines, "required")
		}
		m, err := r.measurement(ctx, p.id)
		if err != nil {
			return err
		}
		if err := r.recalcLines(ctx, e.id, measureRooms(m.rooms)); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update repairs.estimates set state = 'sent', sent_at = $2 where id = $1`, e.id, r.now); err != nil {
			return store("send estimate", err)
		}
		e.state, e.sentAt = stateSent, new(r.now)
		if e.kind == kindChange {
			if err := r.sendAgreement(ctx, p, e); err != nil {
				return err
			}
		}
		if err := r.bump(ctx, e); err != nil {
			return err
		}
		if err := r.event(ctx, p.id, evEstimateSent, "версия "+strconv.Itoa(e.version)+" сметы отправлена заказчику"); err != nil {
			return err
		}
		out, err = r.estimateOut(ctx, e)
		return err
	})
	return out, err
}

// sendAgreement numbers the agreement, sends its change orders and writes its document; the amount is the change of the
// total against the version in force (a decrease is kept without an amount: the amount of a document is not negative).
func (r *req) sendAgreement(ctx context.Context, p *projectRow, e *estRow) error {
	var no int
	if err := r.tx.QueryRow(ctx, `select coalesce(max(agreement_no), 0) + 1 from repairs.estimates where project_id = $1`, p.id).Scan(&no); err != nil {
		return store("agreement number", err)
	}
	if _, err := r.tx.Exec(ctx, `update repairs.estimates set agreement_no = $2 where id = $1`, e.id, no); err != nil {
		return store("agreement number", err)
	}
	e.agreementNo = &no
	seqs, err := r.sendChanges(ctx, e, no)
	if err != nil {
		return err
	}
	diff, err := r.agreementDiff(ctx, p, e)
	if err != nil {
		return err
	}
	var amount *int64
	if diff >= 0 {
		amount = &diff
	}
	_, err = r.tx.Exec(ctx, `insert into repairs.documents (project_id, kind, title, state, estimate_version, amount_minor, currency, sent_at, created_at)
		values ($1, 'agreement', $2, 'wait', $3, $4, $5, $6, $6)`, p.id, agreementTitle(no, seqs), e.version, amount, currency, r.now)
	return store("agreement document", err)
}

// sendChanges marks the change orders of an agreement «sent» and returns their numbers in order.
func (r *req) sendChanges(ctx context.Context, e *estRow, no int) ([]int, error) {
	if len(e.changes) == 0 {
		return nil, nil
	}
	rows, err := r.tx.Query(ctx, `update repairs.change_orders set status = 'sent', agreement_no = $2, revision = revision + 1, updated_at = $3
		where id = any($1) returning seq`, e.changes, no, r.now)
	if err != nil {
		return nil, store("send change orders", err)
	}
	defer rows.Close()
	var seqs []int
	for rows.Next() {
		var n int
		if err := rows.Scan(&n); err != nil {
			return nil, store("send change orders", err)
		}
		seqs = append(seqs, n)
	}
	slices.Sort(seqs)
	return seqs, store("send change orders", rows.Err())
}

// agreementDiff is the change of the total of an agreement against the version in force (the whole total if none).
func (r *req) agreementDiff(ctx context.Context, p *projectRow, e *estRow) (int64, error) {
	lines, err := r.lines(ctx, e.id)
	if err != nil {
		return 0, err
	}
	total, ok := totalOf(lines, e.discount)
	if !ok {
		return 0, invalid("lines", textTotalTooBig, "max")
	}
	vs, err := r.versions(ctx, p.id)
	if err != nil {
		return 0, err
	}
	cur := current(vs)
	if cur == nil {
		return total, nil
	}
	cl, err := r.lines(ctx, cur.id)
	if err != nil {
		return 0, err
	}
	prev, _ := totalOf(cl, cur.discount)
	return total - prev, nil
}

// RecallEstimate answers recallEstimate: a sent version (not yet approved) goes back to a draft; the change orders of an
// agreement return to «priced» and its document goes away.
func (s *Service) RecallEstimate(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, version int, ifMatch string) (rapi.Estimate, error) {
	var out rapi.Estimate
	err := s.run(ctx, tc, true, func(r *req) error {
		p, e, err := r.draftOf(ctx, id, version, ifMatch)
		if err != nil {
			return err
		}
		if e.state != stateSent {
			return failureOf(codeEstimateLocked, "Версия согласована или не отправлялась: отозвать отправку нельзя.")
		}
		if _, err := r.tx.Exec(ctx, `update repairs.estimates set state = 'draft', sent_at = null, agreement_no = null where id = $1`, e.id); err != nil {
			return store("recall estimate", err)
		}
		if e.kind == kindChange {
			if _, err := r.tx.Exec(ctx, `update repairs.change_orders set status = 'priced', agreement_no = null, revision = revision + 1, updated_at = $2 where id = any($1)`, e.changes, r.now); err != nil {
				return store("recall change orders", err)
			}
			if _, err := r.tx.Exec(ctx, `delete from repairs.documents where project_id = $1 and kind = 'agreement' and estimate_version = $2 and state <> 'signed' and state <> 'paid'`, p.id, e.version); err != nil {
				return store("recall agreement", err)
			}
		}
		e.state, e.sentAt, e.agreementNo = stateDraft, nil, nil
		if err := r.bump(ctx, e); err != nil {
			return err
		}
		if err := r.event(ctx, p.id, evEstimateRecalled, "отозвана отправка версии "+strconv.Itoa(e.version)+" сметы"); err != nil {
			return err
		}
		out, err = r.estimateOut(ctx, e)
		return err
	})
	return out, err
}

// DeleteEstimate answers deleteEstimateDraft: a draft goes away and its change orders return to «proposed».
func (s *Service) DeleteEstimate(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, version int, ifMatch string) error {
	return s.run(ctx, tc, true, func(r *req) error {
		p, e, err := r.draftOf(ctx, id, version, ifMatch)
		if err != nil {
			return err
		}
		if e.state != stateDraft {
			return failureOf(codeEstimateLocked, "Удалить можно только черновик.")
		}
		if len(e.changes) > 0 {
			if _, err := r.tx.Exec(ctx, `update repairs.change_orders set status = 'proposed', agreement_no = null, revision = revision + 1, updated_at = $2
				where id = any($1) and status in ('priced', 'sent')`, e.changes, r.now); err != nil {
				return store("return change orders", err)
			}
		}
		for _, q := range []string{`delete from repairs.estimate_lines where estimate_id = $1`, `delete from repairs.estimate_sections where estimate_id = $1`,
			`delete from repairs.estimates where id = $1`} {
			if _, err := r.tx.Exec(ctx, q, e.id); err != nil {
				return store("delete estimate", err)
			}
		}
		return r.event(ctx, p.id, evEstimateDeleted, "удалён черновик версии "+strconv.Itoa(e.version)+" сметы")
	})
}

// DiffEstimates answers diffEstimates: the version asked against another by the key of the line.
func (s *Service) DiffEstimates(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, from, to int) (rapi.EstimateDiff, error) {
	var out rapi.EstimateDiff
	err := s.run(ctx, tc, false, func(r *req) error {
		p, err := r.finance(ctx, id, false)
		if err != nil {
			return err
		}
		a, err := r.estimateOr404(ctx, p.id, from)
		if err != nil {
			return err
		}
		b, err := r.estimateOr404(ctx, p.id, to)
		if err != nil {
			return err
		}
		la, err := r.lines(ctx, a.id)
		if err != nil {
			return err
		}
		lb, err := r.lines(ctx, b.id)
		if err != nil {
			return err
		}
		ta, _ := totalOf(la, a.discount)
		tb, _ := totalOf(lb, b.discount)
		out = rapi.EstimateDiff{ProjectId: p.id, From: a.version, To: b.version, Rows: []rapi.EstimateDiffRow{}, TotalFrom: moneyOut(ta), TotalTo: moneyOut(tb), Delta: deltaOut(tb - ta)}
		for _, row := range diffLines(vers(la), vers(lb)) {
			out.Rows = append(out.Rows, diffRowOut(row))
		}
		return nil
	})
	return out, err
}

func vers(lines []lineRow) []lineVer {
	out := make([]lineVer, 0, len(lines))
	for _, l := range lines {
		sum, _ := lineSum(l.price, l.qty)
		out = append(out, lineVer{key: l.key, name: l.name, qty: l.qty, price: l.price, sum: sum})
	}
	return out
}

func diffRowOut(d diffRow) rapi.EstimateDiffRow {
	row := rapi.EstimateDiffRow{Change: rapi.EstimateDiffRowChange(d.change), Name: d.name(), Delta: deltaOut(d.delta())}
	if d.b != nil {
		row.LineId = &d.b.key
		row.QuantityB, row.PriceB = new(d.b.qty.String()), new(moneyOut(d.b.price))
	} else {
		row.LineId = &d.a.key
	}
	if d.a != nil {
		row.QuantityA, row.PriceA = new(d.a.qty.String()), new(moneyOut(d.a.price))
	}
	return row
}
