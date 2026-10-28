package repairs

import (
	"bytes"
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

// Texts of the change orders (the prototype proposeChange and setChange).
const (
	textChangeNotFound  = "Допработа не найдена."
	textChangeChanged   = "Допработу уже изменили — обновите страницу"
	textChangeForeman   = "Допработу предлагает прораб объекта."
	textChangeNeedSend  = "Нужно право «Предлагать допработы»."
	textChangeDraft     = "До договора допработ нет: правки вносятся новой версией сметы."
	textChangeHanded    = "Объект сдан: допработы по нему не принимаются."
	textChangeTitle     = "Опишите, что нужно сделать."
	textChangeQty       = "Укажите объём больше нуля."
	textChangePhoto     = "Приложите хотя бы одно фото."
	textChangePhotoGone = "Файл фото не найден: загрузите его заново."
	textChangeReason    = "Выберите причину отказа."
)

var (
	rejectReasons = []string{rejectAlready, rejectRefused, rejectWarranty, rejectNotAgreed}
	units         = []string{unitHour, unitM2, unitM3, unitM, unitPiece, unitSet, unitTrip, unitMesh, unitLiter}
)

// changeRecord is a change order (repairs.change_orders).
type changeRecord struct {
	id, project             uuid.UUID
	seq                     int
	title                   string
	qty                     milli
	unit, note              string
	photos                  []uuid.UUID
	status                  string
	reject                  *string
	agreementNo, estimateOf *int
	revision                int64
	createdAt               time.Time
}

const changeCols = `id, project_id, seq, title, (quantity * 1000)::bigint, unit, note, photo_file_ids, status, reject_reason, agreement_no, estimate_version, revision, created_at`

func (c *changeRecord) scan(row interface{ Scan(...any) error }) error {
	var qty int64
	err := row.Scan(&c.id, &c.project, &c.seq, &c.title, &qty, &c.unit, &c.note, &c.photos, &c.status, &c.reject, &c.agreementNo, &c.estimateOf, &c.revision, &c.createdAt)
	c.qty = milli(qty)
	return err
}

func changeOut(c changeRecord) rapi.ChangeOrder {
	out := rapi.ChangeOrder{Id: c.id, ProjectId: c.project, Number: "ДР-" + strconv.Itoa(c.seq), Title: c.title, Quantity: c.qty.String(), Unit: rapi.RepairUnit(c.unit),
		Note: c.note, PhotoFileIds: append([]uuid.UUID{}, c.photos...), Status: rapi.ChangeOrderStatus(c.status), CreatedAt: c.createdAt, Revision: c.revision,
		AgreementNo: c.agreementNo, EstimateVersion: c.estimateOf}
	if c.reject != nil {
		out.RejectReason = new(rapi.RepairRejectReason(*c.reject))
	}
	return out
}

func (r *req) changeOf(ctx context.Context, id uuid.UUID) (*changeRecord, error) {
	c := &changeRecord{}
	if err := c.scan(r.tx.QueryRow(ctx, `select `+changeCols+` from repairs.change_orders where id = $1`, id)); err != nil {
		if noRows(err) {
			return nil, nil
		}
		return nil, store("change order", err)
	}
	return c, nil
}

// ChangeOrders answers listChangeOrders: the change orders of an object the member sees, in the order of their numbers.
func (s *Service) ChangeOrders(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (rapi.ChangeOrderList, error) {
	out := rapi.ChangeOrderList{Items: []rapi.ChangeOrder{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		p, err := r.visibleProject(ctx, id, false)
		if err != nil {
			return err
		}
		rows, err := r.tx.Query(ctx, `select `+changeCols+` from repairs.change_orders where project_id = $1 order by seq`, p.id)
		if err != nil {
			return store("change orders", err)
		}
		defer rows.Close()
		for rows.Next() {
			var c changeRecord
			if err := c.scan(rows); err != nil {
				return store("change orders", err)
			}
			out.Items = append(out.Items, changeOut(c))
		}
		return store("change orders", rows.Err())
	})
	return out, err
}

// checkChange checks the body of a change order.
func (r *req) checkChange(ctx context.Context, b rapi.ChangeOrderCreate) (title string, qty milli, err error) {
	title = strings.TrimSpace(b.Title)
	if n := utf8.RuneCountInString(title); n < 1 || n > 300 {
		return "", 0, invalid("title", textChangeTitle, "required")
	}
	q, ok := parseQty(b.Quantity)
	if !ok || q == 0 || q > maxQty {
		return "", 0, invalid("quantity", textChangeQty, "positive")
	}
	if !slices.Contains(units, string(b.Unit)) {
		return "", 0, invalid("unit", "Неизвестная единица.", "unknown")
	}
	if b.Note != nil && utf8.RuneCountInString(*b.Note) > 2000 {
		return "", 0, invalid("note", "Комментарий — не больше 2000 знаков.", "max")
	}
	if len(b.PhotoFileIds) == 0 {
		return "", 0, invalid("photoFileIds", textChangePhoto, "required")
	}
	if len(b.PhotoFileIds) > 20 {
		return "", 0, invalid("photoFileIds", "Не больше 20 фото.", "max")
	}
	uniq := slices.Clone(b.PhotoFileIds)
	slices.SortFunc(uniq, func(a, b uuid.UUID) int { return bytes.Compare(a[:], b[:]) })
	uniq = slices.Compact(uniq)
	var n int
	if err := r.tx.QueryRow(ctx, `select count(*) from files.objects where id = any($1) and state = 'ready'`, uniq).Scan(&n); err != nil {
		return "", 0, store("photos", err)
	}
	if n != len(uniq) {
		return "", 0, invalid("photoFileIds", textChangePhotoGone, "unknown")
	}
	return title, q, nil
}

// ProposeChangeOrder answers proposeChangeOrder: the foreman of an object describes extra work (without prices). Before
// the contract (a draft object) and after the hand over there are none: change_order_closed.
func (s *Service) ProposeChangeOrder(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b rapi.ChangeOrderCreate) (rapi.ChangeOrder, error) {
	var out rapi.ChangeOrder
	err := s.run(ctx, tc, true, func(r *req) error {
		p, err := r.visibleProject(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actChanges, textChangeNeedSend); err != nil {
			return err
		}
		switch {
		case p.status == statusDraft:
			return failureOf(codeChangeClosed, textChangeDraft)
		case p.status == statusHandedOver:
			return failureOf(codeChangeClosed, textChangeHanded)
		case !p.isForeman(r.me()):
			return forbidden(textChangeForeman)
		}
		title, qty, err := r.checkChange(ctx, b)
		if err != nil {
			return err
		}
		var seq int
		if err := r.tx.QueryRow(ctx, `select coalesce(max(seq), 0) + 1 from repairs.change_orders where project_id = $1`, p.id).Scan(&seq); err != nil {
			return store("change number", err)
		}
		note := ""
		if b.Note != nil {
			note = *b.Note
		}
		var c changeRecord
		if err := c.scan(r.tx.QueryRow(ctx, `insert into repairs.change_orders (project_id, seq, title, quantity, unit, note, photo_file_ids, created_by, created_at, updated_at)
			values ($1, $2, $3, $4::bigint::numeric / 1000, $5, $6, $7, $8, $9, $9) returning `+changeCols,
			p.id, seq, title, int64(qty), string(b.Unit), note, b.PhotoFileIds, r.me(), r.now)); err != nil {
			return store("insert change order", err)
		}
		if err := r.event(ctx, p.id, evChangeProposed, "предложена допработа ДР-"+strconv.Itoa(seq)+": "+truncate(title, 200)); err != nil {
			return err
		}
		out = changeOut(c)
		return nil
	})
	return out, err
}

// truncate cuts a text to n characters.
func truncate(s string, n int) string {
	if utf8.RuneCountInString(s) <= n {
		return s
	}
	return string([]rune(s)[:n])
}

// RejectChangeOrder answers rejectChangeOrder: the office rejects a change order with a reason the foreman sees. A
// signed or rejected one is closed; one at the client is first recalled with its agreement. A priced one leaves the draft.
func (s *Service) RejectChangeOrder(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, reason rapi.RepairRejectReason) (rapi.ChangeOrder, error) {
	var out rapi.ChangeOrder
	err := s.run(ctx, tc, true, func(r *req) error {
		first, err := r.changeOf(ctx, id)
		if err != nil {
			return err
		}
		if first == nil {
			return notFound(textChangeNotFound)
		}
		p, err := r.visibleProject(ctx, first.project, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, p, actEstimates, textNeedEstimates); err != nil {
			return err
		}
		c, err := r.changeOf(ctx, id)
		if err != nil {
			return err
		}
		if err := checkRev(ifMatch, c.revision, textChangeChanged); err != nil {
			return err
		}
		if err := rejectable(c, reason); err != nil {
			return err
		}
		if err := r.reject(ctx, p, c, reason); err != nil {
			return err
		}
		next, err := r.changeOf(ctx, id)
		if err != nil {
			return err
		}
		out = changeOut(*next)
		return nil
	})
	return out, err
}

// rejectable refuses a change order that cannot be rejected (closed, or at the client) and a reason out of the list.
func rejectable(c *changeRecord, reason rapi.RepairRejectReason) error {
	label := "Допработа ДР-" + strconv.Itoa(c.seq) + " уже "
	switch c.status {
	case stateSigned:
		return failureOf(codeChangeClosed, label+"подписана.")
	case stateRejected:
		return failureOf(codeChangeClosed, label+"отклонена.")
	case stateSent:
		return failureOf(codeAgreementWaits, textAgreementPending)
	}
	if !slices.Contains(rejectReasons, string(reason)) {
		return invalid("reason", textChangeReason, "unknown")
	}
	return nil
}

// reject writes the rejection; a priced change order also leaves the draft that holds it.
func (r *req) reject(ctx context.Context, p *projectRow, c *changeRecord, reason rapi.RepairRejectReason) error {
	if _, err := r.tx.Exec(ctx, `update repairs.change_orders set status = 'rejected', reject_reason = $2, revision = revision + 1, updated_at = $3 where id = $1`, c.id, string(reason), r.now); err != nil {
		return store("reject change order", err)
	}
	if c.status == "priced" {
		if _, err := r.tx.Exec(ctx, `update repairs.estimates set change_order_ids = array_remove(change_order_ids, $1), revision = revision + 1
			where project_id = $2 and state = 'draft'`, c.id, p.id); err != nil {
			return store("take out of the draft", err)
		}
	}
	return r.event(ctx, p.id, evChangeRejected, "отклонена допработа ДР-"+strconv.Itoa(c.seq))
}
