//go:build integration

package repairs

import (
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
)

// tokenOf is the token in the address the link gave.
func tokenOf(t *testing.T, url string) string {
	t.Helper()
	token, ok := strings.CutPrefix(url, "https://crm.suites.example/c/")
	if !ok || len(token) != 43 {
		t.Fatalf("address of the cabinet %q", url)
	}
	return token
}

func TestClientLinkLifecycle(t *testing.T) { //nolint:gocyclo // one operation: its successes and each refusal in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Ссылка/объект", seedOpts{})
	phone := clientPhone(t, id)

	none := must(s.ClientLink(ctx, office, id)).of(t)
	if none.Active || none.SentAt != nil {
		t.Fatalf("before the issue: %+v", none)
	}
	err := s.RevokeClientLink(ctx, office, id)
	wantCode(t, err, "not_found", "")

	issued := must(s.IssueClientLink(ctx, office, id)).of(t)
	token := tokenOf(t, issued.Url)
	if !issued.Link.Active || issued.Link.SentAt == nil || issued.Link.SentTo == nil || *issued.Link.SentTo != "+7 *** ***-11-22" {
		t.Fatalf("issued: %+v", issued)
	}
	if inbox.lastLink(phone) != issued.Url {
		t.Errorf("the link did not go to the phone of the client: %q", inbox.lastLink(phone))
	}
	// only the digest is kept, in the tenant and in the control index
	digest := clientDigest(token)
	if n := count(t, `select count(*) from repairs.client_links where project_id = $1 and token_digest = $2 and revoked_at is null`, id, digest); n != 1 {
		t.Errorf("rows of the tenant %d", n)
	}
	if n := count(t, `select count(*) from repairs.client_links where token_digest like '%' || $1 || '%'`, token); n != 0 {
		t.Error("the token itself is stored")
	}
	var idx int
	if err := control.QueryRow(ctx, `select count(*) from public_client_links where token_digest = $1 and tenant_id = $2 and project_id = $3 and revoked_at is null`,
		digest, ref("tenant:a"), id).Scan(&idx); err != nil || idx != 1 {
		t.Errorf("control index: %d %v", idx, err)
	}
	if got := must(s.ClientLink(ctx, office, id)).of(t); !got.Active {
		t.Errorf("link: %+v", got)
	}

	// the cabinet opens by the token
	if c := must(s.Cabinet(ctx, token)).of(t); c.ProjectName != "Ссылка/объект" {
		t.Errorf("cabinet: %+v", c)
	}

	// a new link replaces the old one: the old address is gone
	second := must(s.IssueClientLink(ctx, office, id)).of(t)
	_, err = s.Cabinet(ctx, token)
	wantCode(t, err, "public_token_expired", "")
	if n := count(t, `select count(*) from repairs.client_links where project_id = $1 and revoked_at is null`, id); n != 1 {
		t.Errorf("active links %d", n)
	}
	if err := control.QueryRow(ctx, `select count(*) from public_client_links where token_digest = $1 and revoked_at is not null`, digest).Scan(&idx); err != nil || idx != 1 {
		t.Errorf("the old line of the index is not revoked: %d %v", idx, err)
	}
	must(s.Cabinet(ctx, tokenOf(t, second.Url))).of(t)

	// the revoke closes it
	if err := s.RevokeClientLink(ctx, office, id); err != nil {
		t.Fatal(err)
	}
	_, err = s.Cabinet(ctx, tokenOf(t, second.Url))
	wantCode(t, err, "public_token_expired", "")
	if got := must(s.ClientLink(ctx, office, id)).of(t); got.Active || got.RevokedAt == nil {
		t.Errorf("revoked link: %+v", got)
	}
	err = s.RevokeClientLink(ctx, office, id)
	wantCode(t, err, "not_found", "")

	// no phone - the link is issued, nothing is sent
	bare := project(t, "Ссылка/без телефона", seedOpts{})
	b := must(s.IssueClientLink(ctx, office, bare)).of(t)
	if !b.Link.Active || b.Link.SentAt != nil || b.Link.SentTo != nil {
		t.Errorf("without a phone: %+v", b.Link)
	}
	// the draft has a cabinet (the client approves the estimate there), the handed over object has none
	must(s.IssueClientLink(ctx, office, project(t, "Ссылка/черновик", seedOpts{status: "draft"}))).of(t)
	_, err = s.IssueClientLink(ctx, office, project(t, "Ссылка/сдан", seedOpts{status: "handed_over"}))
	wantReason(t, err, "project_handed_over")

	// the right repairs.client_link.manage and the visibility of the object
	_, err = s.IssueClientLink(ctx, as(t, "ab.member"), id)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.ClientLink(ctx, as(t, "ab.member"), id)
	wantCode(t, err, "forbidden_action", "")
	err = s.RevokeClientLink(ctx, as(t, "ab.member"), id)
	wantCode(t, err, "forbidden_action", "")
	_, err = s.IssueClientLink(ctx, as(t, "a.manager-msk1"), id)
	wantCode(t, err, "not_found", "")
	_, err = s.ClientLink(ctx, office, uuid.New())
	wantCode(t, err, "not_found", "")
}

func TestClientCabinet(t *testing.T) { //nolint:gocyclo // one operation: its successes and each refusal in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Кабинет/Квартира 42", seedOpts{})
	if _, err := superA.Exec(ctx, `update repairs.projects set client_name = 'Ольга Смирнова', budget_minor = 500000 where id = $1`, id); err != nil {
		t.Fatal(err)
	}
	clientPhone(t, id)
	estimate(t, id, "sent") // 99 000
	for i, st := range []struct{ name, status string }{{"Демонтаж", "done"}, {"Электрика", "started"}, {"Стены", "planned"}} {
		if _, err := superA.Exec(ctx, `insert into repairs.schedule_stages (project_id, name, duration_wd, status, sort) values ($1, $2, 3, $3, $4)`, id, st.name, st.status, i); err != nil {
			t.Fatal(err)
		}
	}
	acceptedMark(t, id, work(t, id, "Стяжка", "m2", "10", "5"), crew(t, id, "Иван"))
	submitted := uuid.New()
	if _, err := superA.Exec(ctx, `insert into repairs.work_logs (id, number, project_id, submitted_by, work_date, time_zone, evidence_file_ids)
		values ($1, $2, $3, $4, '2026-10-13', 'Europe/Moscow', $5)`, submitted, "T-"+submitted.String()[:8], id, person("a.owner"), []uuid.UUID{photos[1]}); err != nil {
		t.Fatal(err)
	}
	actDoc(t, id, "signed", rubles(100))
	actDoc(t, id, "wait", rubles(100))
	document(t, id, "agreement", "draft") // a draft is not shown to the client
	invoiceDoc(t, id, "paid", 200_000)
	invoiceDoc(t, id, "wait", 50_000)

	token := tokenOf(t, must(s.IssueClientLink(ctx, office, id)).of(t).Url)
	c := must(s.Cabinet(ctx, token)).of(t)
	if c.ProjectName != "Кабинет/Квартира 42" || c.Address != "ул. Лесная, 1" || c.ClientName != "Ольга Смирнова" {
		t.Errorf("header: %+v", c)
	}
	if c.ReadinessPct != 50 { // 1 signed act of 2
		t.Errorf("readiness %d", c.ReadinessPct)
	}
	if len(c.Stages) != 3 || c.Stages[0].State != rapi.ClientCabinetStagesStateDone || c.Stages[1].State != rapi.ClientCabinetStagesStateStarted || c.Stages[2].State != rapi.ClientCabinetStagesStatePlanned {
		t.Errorf("stages: %+v", c.Stages)
	}
	// the photos of the accepted marks only
	if len(c.Photos) != 1 || c.Photos[0].FileId != photos[0] {
		t.Errorf("photos: %+v", c.Photos)
	}
	// the documents without drafts, with sums
	if len(c.Documents) != 4 {
		t.Errorf("documents %d: %+v", len(c.Documents), c.Documents)
	}
	for _, d := range c.Documents {
		if d.State == rapi.RepairDocumentStateDraft {
			t.Errorf("a draft is shown: %+v", d)
		}
	}
	if c.Paid.AmountMinor != 200_000 || c.Contract.AmountMinor != 99_000 {
		t.Errorf("money: paid %d contract %d", c.Paid.AmountMinor, c.Contract.AmountMinor)
	}
	if c.Estimate == nil || c.Estimate.Version != 1 || c.Estimate.State != rapi.ClientCabinetEstimateStateSent || c.Estimate.Total.AmountMinor != 99_000 {
		t.Errorf("estimate: %+v", c.Estimate)
	}

	// no estimate is shown but the sent or approved one; with none the contract is the sum of the object
	bare := project(t, "Кабинет/без сметы", seedOpts{})
	if _, err := superA.Exec(ctx, `update repairs.projects set budget_minor = 777 where id = $1`, bare); err != nil {
		t.Fatal(err)
	}
	b := must(s.Cabinet(ctx, tokenOf(t, must(s.IssueClientLink(ctx, office, bare)).of(t).Url))).of(t)
	if b.Estimate != nil || b.Contract.AmountMinor != 777 || b.Paid.AmountMinor != 0 || len(b.Stages) != 0 || len(b.Photos) != 0 || len(b.Documents) != 0 {
		t.Errorf("bare cabinet: %+v", b)
	}

	// the refusals of the public route
	_, err := s.Cabinet(ctx, "no-such-token")
	wantCode(t, err, "not_found", "")
	_, err = s.Cabinet(ctx, "")
	wantCode(t, err, "not_found", "")
	// the term of the link
	if _, err := superA.Exec(ctx, `update repairs.client_links set expires_at = $2 where project_id = $1 and revoked_at is null`, id, clock().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	_, err = s.Cabinet(ctx, token)
	wantCode(t, err, "public_token_expired", "")
	// the hand over closes the cabinet, whatever the link says
	if _, err := superA.Exec(ctx, `update repairs.client_links set expires_at = null where project_id = $1 and revoked_at is null`, id); err != nil {
		t.Fatal(err)
	}
	must(s.Cabinet(ctx, token)).of(t)
	if _, err := superA.Exec(ctx, `update repairs.projects set status = 'handed_over', handed_over_on = '2026-10-20' where id = $1`, id); err != nil {
		t.Fatal(err)
	}
	_, err = s.Cabinet(ctx, token)
	wantCode(t, err, "public_token_expired", "")
	// a line of the index without the line of the tenant: gone, not found
	orphan := clientDigest("orphan-token")
	if _, err := control.Exec(ctx, `insert into public_client_links (token_digest, tenant_id, project_id, link_id) values ($1, $2, $3, $4)`,
		orphan, ref("tenant:a"), id, uuid.New()); err != nil {
		t.Fatal(err)
	}
	_, err = s.Cabinet(ctx, "orphan-token")
	wantCode(t, err, "public_token_expired", "")
}

func TestApproveEstimateByClient(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Кабинет/согласование", seedOpts{status: "draft"})
	token := tokenOf(t, must(s.IssueClientLink(ctx, office, id)).of(t).Url)

	_, err := s.ApproveByClient(ctx, token, 1)
	wantCode(t, err, "not_found", "")
	estimate(t, id, "draft")
	_, err = s.ApproveByClient(ctx, token, 1) // not sent
	wantCode(t, err, "invalid_transition", "")
	if _, err := superA.Exec(ctx, `update repairs.estimates set state = 'sent', sent_at = now() where project_id = $1`, id); err != nil {
		t.Fatal(err)
	}
	got := must(s.ApproveByClient(ctx, token, 1)).of(t)
	if got.Version != 1 || got.State != rapi.ClientEstimateApprovalStateApproved {
		t.Errorf("approved: %+v", got)
	}
	if n := count(t, `select count(*) from repairs.projects where id = $1 and budget_minor = 99000`, id); n != 1 {
		t.Error("the sum of the contract is not the total of the version")
	}
	_, err = s.ApproveByClient(ctx, token, 1)
	wantCode(t, err, "invalid_transition", "")
	_, err = s.ApproveByClient(ctx, "no-such-token", 1)
	wantCode(t, err, "not_found", "")
	// the estimate of another object is not reachable by this token
	other := project(t, "Кабинет/чужая смета", seedOpts{status: "draft"})
	estimate(t, other, "sent")
	_, err = s.ApproveByClient(ctx, token, 2)
	wantCode(t, err, "not_found", "")
	if n := count(t, `select count(*) from repairs.estimates where project_id = $1 and state = 'sent'`, other); n != 1 {
		t.Error("the estimate of another object was touched")
	}
}

func TestSignDocumentByClient(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Кабинет/подпись", seedOpts{})
	phone := clientPhone(t, id)
	token := tokenOf(t, must(s.IssueClientLink(ctx, office, id)).of(t).Url)

	doc := actDoc(t, id, "draft", rubles(100))
	_, err := s.SignByClient(ctx, token, doc, "123456") // no code asked
	wantReason(t, err, "repair_document_state")
	must(s.RequestSignature(ctx, office, doc)).of(t)
	good := inbox.last(phone)
	wrong := "000000"
	if good == wrong {
		wrong = "000001"
	}
	_, err = s.SignByClient(ctx, token, doc, wrong)
	wantField(t, err, "smsCode", "sms_code_invalid")
	signed := must(s.SignByClient(ctx, token, doc, good)).of(t)
	if signed.State != rapi.RepairDocumentStateSigned || signed.SignedAt == nil || signed.Id != doc {
		t.Errorf("signed: %+v", signed)
	}

	// the document of another object, a missing one, a wrong token
	other := project(t, "Кабинет/чужой документ", seedOpts{})
	_, err = s.SignByClient(ctx, token, actDoc(t, other, "sms", rubles(1)), good)
	wantCode(t, err, "not_found", "")
	_, err = s.SignByClient(ctx, token, uuid.New(), good)
	wantCode(t, err, "not_found", "")
	_, err = s.SignByClient(ctx, "no-such-token", doc, good)
	wantCode(t, err, "not_found", "")

	// an agreement signed by the code puts its version in force
	est := project(t, "Кабинет/допсоглашение", seedOpts{})
	ephone := clientPhone(t, est)
	etoken := tokenOf(t, must(s.IssueClientLink(ctx, office, est)).of(t).Url)
	estimate(t, est, "sent")
	if _, err := superA.Exec(ctx, `update repairs.estimates set kind = 'change', agreement_no = 1 where project_id = $1`, est); err != nil {
		t.Fatal(err)
	}
	agr := uuid.New()
	if _, err := superA.Exec(ctx, `insert into repairs.documents (id, project_id, kind, title, state, estimate_version) values ($1, $2, 'agreement', 'Допсоглашение № 1', 'wait', 1)`, agr, est); err != nil {
		t.Fatal(err)
	}
	must(s.RequestSignature(ctx, office, agr)).of(t)
	must(s.SignByClient(ctx, etoken, agr, inbox.last(ephone))).of(t)
	if n := count(t, `select count(*) from repairs.estimates where project_id = $1 and state = 'approved'`, est); n != 1 {
		t.Error("the signed agreement did not put its version in force")
	}

	// a revoked link signs nothing
	if err := s.RevokeClientLink(ctx, office, id); err != nil {
		t.Fatal(err)
	}
	_, err = s.SignByClient(ctx, token, doc, good)
	wantCode(t, err, "public_token_expired", "")
}

func TestHandOverClosesTheCabinet(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Кабинет/сдача", seedOpts{})
	token := tokenOf(t, must(s.IssueClientLink(ctx, office, id)).of(t).Url)
	handover := document(t, id, "handover_act", "signed")
	p := must(s.Project(ctx, office, id)).of(t)
	must(s.HandOver(ctx, office, id, rev(p.Revision), rapi.RepairHandOver{ActDocumentId: handover})).of(t)
	if n := count(t, `select count(*) from repairs.client_links where project_id = $1 and revoked_at is not null`, id); n != 1 {
		t.Errorf("revoked links %d", n)
	}
	_, err := s.Cabinet(ctx, token)
	wantCode(t, err, "public_token_expired", "")
	if got := must(s.ClientLink(ctx, office, id)).of(t); got.Active {
		t.Errorf("link of a handed over object: %+v", got)
	}
}
