//go:build integration

package repairs

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	rapi "github.com/ortus/ortus-crm/backend/internal/api/repairs"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// document writes a document of an object in a state (the later steps write the rest of them).
func document(t *testing.T, projectID uuid.UUID, kind, state string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	var signed, hash, expires any
	switch state {
	case "signed", "paid":
		signed = clock()
	case "sms":
		hash, expires = signHash([]byte("key-of-the-suites"), id, "111111"), clock().Add(10*time.Minute)
	}
	if _, err := superA.Exec(t.Context(), `insert into repairs.documents (id, project_id, kind, title, state, signed_at, sign_code_hash, sign_code_expires_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8)`, id, projectID, kind, "Документ "+state, state, signed, hash, expires); err != nil {
		t.Fatal(err)
	}
	return id
}

func docState(t *testing.T, id uuid.UUID) (state string, attempts int, hash *string) {
	t.Helper()
	if err := superA.QueryRow(t.Context(), `select state, sign_attempts, sign_code_hash from repairs.documents where id = $1`, id).Scan(&state, &attempts, &hash); err != nil {
		t.Fatal(err)
	}
	return state, attempts, hash
}

type brokenCodes struct{}

func (brokenCodes) SendSignCode(context.Context, string, string, time.Time) error {
	return errors.New("provider is down")
}

func TestRequestSignature(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	id := project(t, "Подпись/объект", seedOpts{})
	phone := clientPhone(t, id)

	draft := document(t, id, "agreement", "draft")
	got := must(s.RequestSignature(ctx, office, draft)).of(t)
	if got.Document.State != rapi.RepairDocumentStateSms || got.DeliveredTo != "+7 *** ***-11-22" || !got.CodeExpiresAt.After(clock()) || got.CodeExpiresAt.After(clock().Add(11*time.Minute)) {
		t.Fatalf("requested: %+v", got)
	}
	code := inbox.last(phone)
	state, attempts, hash := docState(t, draft)
	if state != "sms" || attempts != 0 || hash == nil || len(*hash) != 64 || *hash == code {
		t.Fatalf("the document keeps %q %d %v: only a hash of the code", state, attempts, hash)
	}
	if n := count(t, `select count(*) from repairs.documents where id = $1 and signer_phone_hash is not null and signer_phone_hash <> $2`, draft, phone); n != 1 {
		t.Fatal("the phone of the signer is kept as a hash")
	}
	if n := count(t, `select count(*) from repairs.project_events where project_id = $1 and kind = 'document.sign_requested'`, id); n != 1 {
		t.Fatalf("feed rows %d", n)
	}

	// a new code from the state sms: the old one stops working, the attempts start again
	if _, err := superA.Exec(ctx, `update repairs.documents set sign_attempts = 3 where id = $1`, draft); err != nil {
		t.Fatal(err)
	}
	must(s.RequestSignature(ctx, office, draft)).of(t)
	if inbox.sent(phone) != 2 {
		t.Fatalf("codes sent %d", inbox.sent(phone))
	}
	if _, attempts, _ := docState(t, draft); attempts != 0 {
		t.Fatalf("attempts %d", attempts)
	}
	wait := document(t, id, "agreement", "wait")
	if r := must(s.RequestSignature(ctx, office, wait)).of(t); r.Document.State != rapi.RepairDocumentStateSms {
		t.Fatalf("from wait: %+v", r)
	}

	// signed and paid documents are not sent again
	for _, st := range []string{"signed", "paid"} {
		_, err := s.RequestSignature(ctx, office, document(t, id, "act", st))
		wantReason(t, err, "repair_document_state")
	}
	// who: the right repairs.documents.send over the object; the foreman and the desk do not have it
	_, err := s.RequestSignature(ctx, as(t, "ab.member"), draft)
	wantCode(t, err, "forbidden_action", "")
	me := person("a.manager-msk1")
	own := project(t, "Подпись/прораб", seedOpts{foreman: &me})
	clientPhone(t, own)
	_, err = s.RequestSignature(ctx, as(t, "a.manager-msk1"), document(t, own, "agreement", "draft"))
	wantCode(t, err, "forbidden_action", "")
	_, err = s.RequestSignature(ctx, as(t, "a.manager-msk1"), draft) // not his object: as if it were not there
	wantCode(t, err, "not_found", "")
	_, err = s.RequestSignature(ctx, office, uuid.New())
	wantCode(t, err, "not_found", "")

	// the client has no phone: nobody to send the code to
	bare := project(t, "Подпись/без телефона", seedOpts{})
	_, err = s.RequestSignature(ctx, office, document(t, bare, "agreement", "draft"))
	wantField(t, err, "clientPhone", "")

	// the provider is down: nothing is changed, nothing is lost
	down := service()
	down.Codes = brokenCodes{}
	failing := document(t, id, "agreement", "draft")
	_, err = down.RequestSignature(ctx, office, failing)
	wantCode(t, err, "dependency_unavailable", "")
	if st, _, _ := docState(t, failing); st != "draft" {
		t.Fatalf("state after a failed delivery: %s", st)
	}
}

func TestSignDocumentCode(t *testing.T) { //nolint:gocyclo // one scenario of an operation: its successes and its refusals in a row
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	client := tenantctx.TenantContext{TenantID: ref("tenant:a")}
	id := project(t, "Код/объект", seedOpts{})
	phone := clientPhone(t, id)

	// a document that waits for no code
	_, err := s.SignDocument(ctx, client, id, document(t, id, "act", "draft"), "123456")
	wantReason(t, err, "repair_document_state")

	// wrong codes: every one is counted, the fifth puts out the code
	doc := document(t, id, "act", "draft")
	must(s.RequestSignature(ctx, office, doc)).of(t)
	good := inbox.last(phone)
	wrong := "000000"
	if good == wrong {
		wrong = "000001"
	}
	for i := 1; i <= 4; i++ {
		_, err = s.SignDocument(ctx, client, id, doc, wrong)
		wantField(t, err, "smsCode", "sms_code_invalid")
		if st, attempts, _ := docState(t, doc); st != "sms" || attempts != i {
			t.Fatalf("after %d wrong codes: %s, %d attempts", i, st, attempts)
		}
	}
	_, err = s.SignDocument(ctx, client, id, doc, wrong)
	wantField(t, err, "smsCode", "sms_code_expired")
	if st, _, hash := docState(t, doc); st != "wait" || hash != nil {
		t.Fatalf("after five wrong codes: %s %v", st, hash)
	}
	_, err = s.SignDocument(ctx, client, id, doc, good) // the old code is dead
	wantReason(t, err, "repair_document_state")

	// a new code signs; an act changes no estimate
	must(s.RequestSignature(ctx, office, doc)).of(t)
	signed := must(s.SignDocument(ctx, client, id, doc, inbox.last(phone))).of(t)
	if signed.State != rapi.RepairDocumentStateSigned || signed.SignedAt == nil || signed.Kind != rapi.RepairDocumentKindAct {
		t.Fatalf("signed: %+v", signed)
	}
	if st, attempts, hash := docState(t, doc); st != "signed" || attempts != 0 || hash != nil {
		t.Fatalf("the signed document keeps %s %d %v", st, attempts, hash)
	}

	// an expired code
	late := document(t, id, "act", "draft")
	must(s.RequestSignature(ctx, office, late)).of(t)
	if _, err := superA.Exec(ctx, `update repairs.documents set sign_code_expires_at = $2 where id = $1`, late, clock().Add(-time.Hour)); err != nil {
		t.Fatal(err)
	}
	_, err = s.SignDocument(ctx, client, id, late, inbox.last(phone))
	wantField(t, err, "smsCode", "sms_code_expired")
	if st, _, _ := docState(t, late); st != "sms" {
		t.Fatalf("an expired code keeps the document in sms until a new one is asked: %s", st)
	}
	must(s.RequestSignature(ctx, office, late)).of(t) // «запросите новый»
	must(s.SignDocument(ctx, client, id, late, inbox.last(phone))).of(t)

	_, err = s.SignDocument(ctx, client, id, uuid.New(), "123456")
	wantCode(t, err, "not_found", "")
	_, err = s.SignDocument(ctx, tenantctx.TenantContext{}, id, doc, "123456")
	wantCode(t, err, "not_found", "")
}

func TestApproveEstimateByLink(t *testing.T) {
	t.Parallel()
	ctx, s, office := t.Context(), service(), as(t, "a.region-msk")
	client := tenantctx.TenantContext{TenantID: ref("tenant:a")}
	k := newKit(t, "Согласование/смета", seedOpts{status: "draft"})
	_, err := s.ApproveEstimate(ctx, client, k.project, 1)
	wantCode(t, err, "not_found", "")
	est := must(s.EstimateFromTemplate(ctx, office, k.project, k.template)).of(t)
	_, err = s.ApproveEstimate(ctx, client, k.project, 1) // not sent yet
	wantCode(t, err, "invalid_transition", "")
	must(s.SendEstimate(ctx, office, k.project, 1, rev(est.Revision))).of(t)
	got := must(s.ApproveEstimate(ctx, client, k.project, 1)).of(t)
	if got.State != rapi.EstimateStateApproved || got.ApprovedAt == nil {
		t.Fatalf("approved: %+v", got)
	}
	_, err = s.ApproveEstimate(ctx, client, k.project, 1)
	wantCode(t, err, "invalid_transition", "")
	// the object does not exist in the organization
	_, err = s.ApproveEstimate(ctx, client, uuid.New(), 1)
	wantCode(t, err, "not_found", "")
}

func TestAgreementIsSignedByCodeOnly(t *testing.T) {
	t.Parallel()
	ctx, s, foreman, office := t.Context(), service(), as(t, "a.manager-msk1"), as(t, "a.region-msk")
	client := tenantctx.TenantContext{TenantID: ref("tenant:a")}
	k := fieldKit(t, "Согласование/допсоглашение")
	c := must(s.ProposeChangeOrder(ctx, foreman, k.project, propose("Ещё", "1", rapi.RepairUnitPiece))).of(t)
	est := must(s.EstimateRevision(ctx, office, k.project, rapi.EstimateRevisionCreate{Kind: rapi.EstimateRevisionCreateKindChange, ChangeOrderIds: &[]uuid.UUID{c.Id}})).of(t)
	must(s.PatchEstimate(ctx, office, k.project, 2, rev(est.Revision), rapi.EstimateDraftPatch{AddLines: &[]rapi.EstimateLineAdd{{SectionId: est.Sections[3].Id, PriceItemId: k.plaster, Quantity: new("1")}}})).of(t)
	cur := must(s.Estimate(ctx, office, k.project, 2)).of(t)
	must(s.SendEstimate(ctx, office, k.project, 2, rev(cur.Revision))).of(t)
	// the approval of the cabinet is for versions; an agreement needs the code (the cabinet shows it, but the server decides)
	_, err := s.ApproveEstimate(ctx, client, k.project, 2)
	wantCode(t, err, "invalid_transition", "")
}
