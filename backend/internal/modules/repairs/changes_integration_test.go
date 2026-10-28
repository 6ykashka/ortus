//go:build integration

package repairs

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// fieldKit is an active object of the foreman a.manager-msk1 whose estimate is in force (4 005 000 kopecks).
func fieldKit(t *testing.T, name string) kit {
	t.Helper()
	me := person("a.manager-msk1")
	k := newKit(t, name, seedOpts{foreman: &me})
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	est := must(s.EstimateFromTemplate(ctx, office, k.project, k.template)).of(t)
	must(s.SendEstimate(ctx, office, k.project, 1, rev(est.Revision))).of(t)
	approve(t, k.project, 1)
	return k
}

func propose(title, qty string, unit rapi.RepairUnit) rapi.ChangeOrderCreate {
	return rapi.ChangeOrderCreate{Title: title, Quantity: qty, Unit: unit, PhotoFileIds: slices.Clone(photos), Note: new("В коридоре")}
}

func statusOf(t *testing.T, id uuid.UUID) string {
	t.Helper()
	var s string
	if err := superA.QueryRow(t.Context(), `select status from repairs.change_orders where id = $1`, id).Scan(&s); err != nil {
		t.Fatal(err)
	}
	return s
}

func TestProposeChangeOrder(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, foreman := t.Context(), service(), as(t, "a.manager-msk1")
	k := fieldKit(t, "ДР/предложение")
	c1 := must(s.ProposeChangeOrder(ctx, foreman, k.project, propose("Доп. розетки", "6", rapi.RepairUnitPiece))).of(t)
	if c1.Number != "ДР-1" || c1.Status != rapi.ChangeOrderStatusProposed || c1.Revision != 1 || c1.Title != "Доп. розетки" || c1.Quantity != "6" ||
		c1.Unit != rapi.RepairUnitPiece || c1.Note != "В коридоре" || len(c1.PhotoFileIds) != 2 || c1.ProjectId != k.project || c1.AgreementNo != nil || c1.RejectReason != nil {
		t.Fatalf("proposed: %+v", c1)
	}
	c2 := must(s.ProposeChangeOrder(ctx, foreman, k.project, rapi.ChangeOrderCreate{Title: "  Штроба ", Quantity: "12.5", Unit: rapi.RepairUnitM, PhotoFileIds: photos[:1]})).of(t)
	if c2.Number != "ДР-2" || c2.Title != "Штроба" || c2.Note != "" {
		t.Fatalf("second: %+v", c2)
	}
	for _, who := range []string{"a.manager-msk1", "a.region-msk", "a.owner"} {
		list := must(s.ChangeOrders(ctx, as(t, who), k.project)).of(t)
		if len(list.Items) != 2 || list.Items[0].Number != "ДР-1" || list.Items[1].Number != "ДР-2" {
			t.Fatalf("%s sees %+v", who, list.Items)
		}
	}
	if n := count(t, `select count(*) from repairs.project_events where project_id = $1 and kind = 'change_order.proposed'`, k.project); n != 2 {
		t.Fatalf("feed rows %d", n)
	}

	good := propose("Что-то", "1", rapi.RepairUnitPiece)
	for field, mod := range map[string]func(*rapi.ChangeOrderCreate){
		"title":        func(b *rapi.ChangeOrderCreate) { b.Title = "   " },
		"quantity":     func(b *rapi.ChangeOrderCreate) { b.Quantity = "0" },
		"unit":         func(b *rapi.ChangeOrderCreate) { b.Unit = "parsec" },
		"photoFileIds": func(b *rapi.ChangeOrderCreate) { b.PhotoFileIds = nil },
	} {
		b := good
		mod(&b)
		_, err := s.ProposeChangeOrder(ctx, foreman, k.project, b)
		wantField(t, err, field, "")
	}
	b := good
	b.PhotoFileIds = []uuid.UUID{uuid.New()}
	_, err := s.ProposeChangeOrder(ctx, foreman, k.project, b)
	wantField(t, err, "photoFileIds", "")

	// only the foreman of the object; the office reads and decides but does not propose
	_, err = s.ProposeChangeOrder(ctx, as(t, "a.region-msk"), k.project, good)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.ProposeChangeOrder(ctx, as(t, "a.owner"), k.project, good)
	wantCode(t, err, "forbidden_action", "Допработу предлагает прораб объекта.")
	other := project(t, "ДР/чужой объект", seedOpts{foreman: new(person("a.driver-msk1"))})
	_, err = s.ProposeChangeOrder(ctx, foreman, other, good)
	wantCode(t, err, "not_found", "")
	_, err = s.ProposeChangeOrder(ctx, foreman, uuid.New(), good)
	wantCode(t, err, "not_found", "")
	// before the contract and after the handover there are no change orders
	draft := project(t, "ДР/черновик", seedOpts{status: "draft"})
	_, err = s.ProposeChangeOrder(ctx, as(t, "a.owner"), draft, good)
	wantCode(t, err, "change_order_closed", "До договора допработ нет: правки вносятся новой версией сметы.")
	handed := project(t, "ДР/сдан", seedOpts{status: "handed_over", foreman: new(person("a.manager-msk1"))})
	_, err = s.ProposeChangeOrder(ctx, foreman, handed, good)
	wantCode(t, err, "change_order_closed", "")
}

func TestRejectChangeOrder(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, foreman, office := t.Context(), service(), as(t, "a.manager-msk1"), as(t, "a.region-msk")
	k := fieldKit(t, "ДР/отказ")
	c := must(s.ProposeChangeOrder(ctx, foreman, k.project, propose("Лишнее", "3", rapi.RepairUnitM2))).of(t)
	_, err := s.RejectChangeOrder(ctx, office, c.Id, rev(c.Revision+2), rapi.RepairRejectReasonWarranty)
	wantCode(t, err, "revision_mismatch", "")
	_, err = s.RejectChangeOrder(ctx, foreman, c.Id, rev(c.Revision), rapi.RepairRejectReasonWarranty)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.RejectChangeOrder(ctx, office, c.Id, rev(c.Revision), "because")
	wantField(t, err, "reason", "")
	_, err = s.RejectChangeOrder(ctx, office, uuid.New(), rev(1), rapi.RepairRejectReasonWarranty)
	wantCode(t, err, "not_found", "")
	_, err = s.RejectChangeOrder(ctx, as(t, "ab.member"), c.Id, rev(c.Revision), rapi.RepairRejectReasonWarranty) // no repairs.estimates.edit
	wantCode(t, err, "forbidden_action", "")

	r := must(s.RejectChangeOrder(ctx, office, c.Id, rev(c.Revision), rapi.RepairRejectReasonAlreadyInEstimate)).of(t)
	if r.Status != rapi.ChangeOrderStatusRejected || r.RejectReason == nil || *r.RejectReason != rapi.RepairRejectReasonAlreadyInEstimate || r.Revision != c.Revision+1 {
		t.Fatalf("rejected: %+v", r)
	}
	// the foreman sees the reason
	got := must(s.ChangeOrders(ctx, foreman, k.project)).of(t)
	if len(got.Items) != 1 || got.Items[0].RejectReason == nil || *got.Items[0].RejectReason != rapi.RepairRejectReasonAlreadyInEstimate {
		t.Fatalf("foreman: %+v", got.Items)
	}
	_, err = s.RejectChangeOrder(ctx, office, c.Id, rev(r.Revision), rapi.RepairRejectReasonWarranty)
	wantCode(t, err, "change_order_closed", "Допработа ДР-1 уже отклонена.")
	// a rejected change order does not go into an agreement
	_, err = s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindChange, ChangeOrderIds: &[]uuid.UUID{c.Id}})
	wantCode(t, err, "change_order_closed", "")

	// priced (in a draft): rejection takes it out of the draft; sent (at the client): first recall the agreement
	p := must(s.ProposeChangeOrder(ctx, foreman, k.project, propose("В черновике", "2", rapi.RepairUnitM2))).of(t)
	est := must(s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindChange, ChangeOrderIds: &[]uuid.UUID{p.Id}})).of(t)
	if statusOf(t, p.Id) != "priced" {
		t.Fatalf("status %s", statusOf(t, p.Id))
	}
	cur := must(s.ChangeOrders(ctx, office, k.project)).of(t)
	pr := cur.Items[1]
	must(s.RejectChangeOrder(ctx, office, p.Id, rev(pr.Revision), rapi.RepairRejectReasonClientRefused)).of(t)
	if e := must(s.Estimate(ctx, office, k.project, est.Version)).of(t); len(e.ChangeOrderIds) != 0 {
		t.Fatalf("a rejected change order remains in the draft: %+v", e.ChangeOrderIds)
	}
	q := must(s.ProposeChangeOrder(ctx, foreman, k.project, propose("У заказчика", "2", rapi.RepairUnitM2))).of(t)
	if err := s.DeleteEstimate(ctx, office, k.project, est.Version, rev(must(s.Estimate(ctx, office, k.project, est.Version)).of(t).Revision)); err != nil {
		t.Fatal(err)
	}
	est = must(s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindChange, ChangeOrderIds: &[]uuid.UUID{q.Id}})).of(t)
	est = must(s.PatchEstimate(ctx, office, k.project, est.Version, rev(est.Revision), rapi.EstimateDraftPatch{
		AddLines: &[]rapi.EstimateLineAdd{{SectionId: est.Sections[len(est.Sections)-1].Id, PriceItemId: k.plaster, Quantity: new("2")}}})).of(t)
	must(s.SendEstimate(ctx, office, k.project, est.Version, rev(est.Revision))).of(t)
	qs := must(s.ChangeOrders(ctx, office, k.project)).of(t).Items
	last := qs[len(qs)-1]
	if last.Status != rapi.ChangeOrderStatusSent || last.AgreementNo == nil || *last.AgreementNo != 1 {
		t.Fatalf("sent: %+v", last)
	}
	_, err = s.RejectChangeOrder(ctx, office, q.Id, rev(last.Revision), rapi.RepairRejectReasonClientRefused)
	wantCode(t, err, "agreement_pending", "")
}

func TestAgreementChain(t *testing.T) { //nolint:gocyclo // the whole path of a change order: one scenario
	t.Parallel()
	ctx, s, foreman, office := t.Context(), service(), as(t, "a.manager-msk1"), as(t, "a.region-msk")
	k := fieldKit(t, "ДР/цепочка")
	phone := clientPhone(t, k.project)
	socket := catalogItem(t, "ДР/цепочка/Розетка", "piece", "work", 120_000)
	chase := catalogItem(t, "ДР/цепочка/Штроба", "m", "work", 45_000)
	c1 := must(s.ProposeChangeOrder(ctx, foreman, k.project, propose("Доп. розетки", "6", rapi.RepairUnitPiece))).of(t)
	c2 := must(s.ProposeChangeOrder(ctx, foreman, k.project, propose("Штроба под кабель", "12", rapi.RepairUnitM))).of(t)

	// unknown and foreign change orders are refused before anything is created
	_, err := s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindChange, ChangeOrderIds: &[]uuid.UUID{c1.Id, uuid.New()}})
	wantField(t, err, "changeOrderIds[1]", "")
	_, err = s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindRevision}) // after the contract
	wantField(t, err, "kind", "")

	est := must(s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindChange, ChangeOrderIds: &[]uuid.UUID{c1.Id, c2.Id}})).of(t)
	if est.Version != 2 || est.Kind != rapi.EstimateKindChange || est.BaseVersion == nil || *est.BaseVersion != 1 || len(est.ChangeOrderIds) != 2 || len(est.Lines) != 3 ||
		len(est.Sections) != 5 || est.Sections[3].Name != "Допработы · ДР-1" || est.Sections[4].Name != "Допработы · ДР-2" || est.Total.AmountMinor != 4_005_000 {
		t.Fatalf("agreement draft: %+v", est)
	}
	if statusOf(t, c1.Id) != "priced" || statusOf(t, c2.Id) != "priced" {
		t.Fatal("the change orders are not priced")
	}
	_, err = s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindChange})
	wantCode(t, err, "estimate_draft_exists", "")

	est = must(s.PatchEstimate(ctx, office, k.project, 2, rev(est.Revision), rapi.EstimateDraftPatch{AddLines: &[]rapi.EstimateLineAdd{
		{SectionId: est.Sections[3].Id, PriceItemId: socket, Quantity: new("6")}, {SectionId: est.Sections[4].Id, PriceItemId: chase, Quantity: new("12")}}})).of(t)
	if est.Total.AmountMinor != 4_005_000+720_000+540_000 {
		t.Fatalf("total %d", est.Total.AmountMinor)
	}

	sent := must(s.SendEstimate(ctx, office, k.project, 2, rev(est.Revision))).of(t)
	if sent.State != rapi.EstimateStateSent || sent.AgreementNo == nil || *sent.AgreementNo != 1 {
		t.Fatalf("sent: %+v", sent)
	}
	if statusOf(t, c1.Id) != "sent" || statusOf(t, c2.Id) != "sent" {
		t.Fatal("the change orders are not sent")
	}
	var doc uuid.UUID
	var title, state string
	var amount int64
	var version int
	if err := superA.QueryRow(ctx, `select id, title, state, amount_minor, estimate_version from repairs.documents where project_id = $1 and kind = 'agreement'`, k.project).
		Scan(&doc, &title, &state, &amount, &version); err != nil {
		t.Fatal(err)
	}
	if title != "Допсоглашение № 1 · ДР-1, ДР-2" || state != "wait" || amount != 1_260_000 || version != 2 {
		t.Fatalf("agreement document: %q %s %d v%d", title, state, amount, version)
	}
	// while the agreement is with the client nothing is added to it
	_, err = s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindChange})
	wantCode(t, err, "agreement_pending", "")
	_, err = s.PatchEstimate(ctx, office, k.project, 2, rev(sent.Revision), rapi.EstimateDraftPatch{DiscountPct: new(5)})
	wantCode(t, err, "estimate_version_locked", "")

	// a recall returns the change orders to «priced» and takes the document away; the agreement keeps its number
	back := must(s.RecallEstimate(ctx, office, k.project, 2, rev(sent.Revision))).of(t)
	if back.State != rapi.EstimateStateDraft || back.AgreementNo != nil || statusOf(t, c1.Id) != "priced" {
		t.Fatalf("recalled: %+v", back)
	}
	if n := count(t, `select count(*) from repairs.documents where project_id = $1`, k.project); n != 0 {
		t.Fatalf("the document of a recalled agreement remains: %d", n)
	}
	sent = must(s.SendEstimate(ctx, office, k.project, 2, rev(back.Revision))).of(t)
	if sent.AgreementNo == nil || *sent.AgreementNo != 1 {
		t.Fatalf("agreement number after the second send: %+v", sent.AgreementNo)
	}
	if err := superA.QueryRow(ctx, `select id from repairs.documents where project_id = $1 and kind = 'agreement'`, k.project).Scan(&doc); err != nil {
		t.Fatal(err)
	}

	// the code from SMS: the foreman cannot send it, the office does, the client enters it
	_, err = s.RequestSignature(ctx, foreman, doc)
	wantCode(t, err, "forbidden_action", "")
	asked := must(s.RequestSignature(ctx, office, doc)).of(t)
	if asked.Document.State != rapi.RepairDocumentStateSms || asked.DeliveredTo != "+7 *** ***-11-22" || asked.CodeExpiresAt.IsZero() || asked.Document.Amount == nil || asked.Document.Amount.AmountMinor != 1_260_000 {
		t.Fatalf("requested: %+v", asked)
	}
	code := inbox.last(phone)
	if len(code) != 6 {
		t.Fatalf("the code of the inbox %q", code)
	}
	client := tenantctx.TenantContext{TenantID: ref("tenant:a")}
	_, err = s.SignDocument(ctx, client, k.project, doc, "000000")
	wantField(t, err, "smsCode", "sms_code_invalid")
	_, err = s.SignDocument(ctx, client, uuid.New(), doc, code) // a document of another object
	wantCode(t, err, "not_found", "")
	signed := must(s.SignDocument(ctx, client, k.project, doc, code)).of(t)
	if signed.State != rapi.RepairDocumentStateSigned || signed.SignedAt == nil {
		t.Fatalf("signed: %+v", signed)
	}
	_, err = s.SignDocument(ctx, client, k.project, doc, code)
	wantReason(t, err, "repair_document_state")

	// the version is in force, the change orders are signed, the works reach the foreman, the contract sum changes
	v1, v2 := must(s.Estimate(ctx, office, k.project, 1)).of(t), must(s.Estimate(ctx, office, k.project, 2)).of(t)
	if v1.State != rapi.EstimateStateReplaced || v2.State != rapi.EstimateStateApproved || v2.ApprovedAt == nil {
		t.Fatalf("v1 %s, v2 %s", v1.State, v2.State)
	}
	for _, id := range []uuid.UUID{c1.Id, c2.Id} {
		if statusOf(t, id) != "signed" {
			t.Fatalf("change order %s is %s", id, statusOf(t, id))
		}
	}
	got := must(s.ChangeOrders(ctx, office, k.project)).of(t).Items
	if got[0].EstimateVersion == nil || *got[0].EstimateVersion != 2 || got[0].AgreementNo == nil || *got[0].AgreementNo != 1 {
		t.Fatalf("signed change order: %+v", got[0])
	}
	works := must(s.Works(ctx, foreman, k.project)).of(t).Items
	if len(works) != 2 || works[0].Name != "Доп. розетки" || works[0].Plan != "6" || works[0].Fact != "0" || works[1].Name != "Штроба под кабель" || works[1].Plan != "12" {
		t.Fatalf("works: %+v", works)
	}
	if n := count(t, `select count(*) from repairs.projects where id = $1 and budget_minor = 5265000`, k.project); n != 1 {
		t.Fatal("the contract sum did not change")
	}
	if n := count(t, `select count(*) from repairs.project_events where project_id = $1 and kind in ('document.signed', 'estimate.approved')`, k.project); n != 3 { // the versions 1 and 2 and the agreement
		t.Fatalf("feed rows %d", n)
	}
	// a signed change order is closed
	_, err = s.RejectChangeOrder(ctx, office, c1.Id, rev(got[0].Revision), rapi.RepairRejectReasonWarranty)
	wantCode(t, err, "change_order_closed", "Допработа ДР-1 уже подписана.")
}

func TestDeleteAgreementDraftReturnsChangeOrders(t *testing.T) {
	t.Parallel()
	ctx, s, foreman, office := t.Context(), service(), as(t, "a.manager-msk1"), as(t, "a.region-msk")
	k := fieldKit(t, "ДР/удаление")
	c := must(s.ProposeChangeOrder(ctx, foreman, k.project, propose("Передумали", "1", rapi.RepairUnitSet))).of(t)
	est := must(s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindChange, ChangeOrderIds: &[]uuid.UUID{c.Id}})).of(t)
	if statusOf(t, c.Id) != "priced" {
		t.Fatal("not priced")
	}
	if err := s.DeleteEstimate(ctx, office, k.project, est.Version, rev(est.Revision)); err != nil {
		t.Fatal(err)
	}
	if statusOf(t, c.Id) != "proposed" {
		t.Fatalf("a deleted draft returns the change order to proposed, got %s", statusOf(t, c.Id))
	}
	// the version number of a deleted draft is free again
	again := must(s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindChange, ChangeOrderIds: &[]uuid.UUID{c.Id}})).of(t)
	if again.Version != est.Version {
		t.Fatalf("version %d, want %d", again.Version, est.Version)
	}
}
