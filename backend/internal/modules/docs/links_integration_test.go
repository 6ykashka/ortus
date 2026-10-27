//go:build integration

package docs

import (
	"testing"
	"time"

	"github.com/google/uuid"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
	harness "github.com/ortus/ortus-crm/backend/test" //nolint:depguard // integration test: the clock of the suites
)

func linkInput(days int) dapi.DocExternalLinkCreate {
	return dapi.DocExternalLinkCreate{Level: dapi.DocExternalLinkCreateLevelView, ExpiresAt: harness.Now().Add(time.Duration(days) * 24 * time.Hour)}
}

// An external link: only the owner of the business issues it, the term is at most 30 days, the token and the PIN are
// shown once, the control index and the tenant hold the digest only (createDocLink, openDocLink, revokeDocLink).
func TestExternalLinks(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	ctx, tc := as(t, "a.owner")
	folder := newFolder(t, "Ссылки")
	doc := seedDoc(t, folder, tc.PersonID, "Для заказчика", "pdf")
	seedFile(t, doc, tc.PersonID, 1, "c.pdf", "application/pdf", []byte("%PDF-1.7"))

	// the owner of the document who is not the owner of the business does not issue links
	editor := personOf(t, "a.manager-msk1")
	if err := exec(t.Context(), `insert into docs.shares (document_id, who, ref_id, level) values ($1, 'member', $2, 'manage')`, doc, editor); err != nil {
		t.Fatal(err)
	}
	eCtx, eTC := as(t, "a.manager-msk1")
	_, err := svc.CreateLink(eCtx, eTC, doc, linkInput(7))
	wantCode(t, err, "forbidden_action")
	_, err = svc.CreateLink(ctx, tc, doc, linkInput(31))
	wantCode(t, err, "validation_failed")
	_, err = svc.CreateLink(ctx, tc, doc, linkInput(-1))
	wantCode(t, err, "validation_failed")
	bad := linkInput(7)
	bad.Level = dapi.DocExternalLinkCreateLevel("fill")
	_, err = svc.CreateLink(ctx, tc, doc, bad)
	wantCode(t, err, "validation_failed")

	created, err := svc.CreateLink(ctx, tc, doc, linkInput(7))
	if err != nil || created.Token == "" || created.Pin == nil || len(*created.Pin) != pinDigits || !created.Link.Pin || !created.Link.Watermark || created.Link.Download {
		t.Fatalf("create: %v %+v, want a token, a PIN, the watermark and no download", err, created)
	}
	var stored, hash string
	if err := superA.QueryRow(t.Context(), `select token_digest, coalesce(pin_hash, '') from docs.links where id = $1`, created.Link.Id).Scan(&stored, &hash); err != nil {
		t.Fatal(err)
	}
	if stored != tokenDigest(created.Token) || stored == created.Token || hash == "" || hash == *created.Pin {
		t.Fatalf("stored %q / %q: the token or the PIN is kept in clear", stored, hash)
	}
	var indexed int
	if err := control.QueryRow(t.Context(), `select count(*) from public_doc_links where token_digest = $1 and tenant_id = $2 and link_id = $3`,
		stored, tenantA, created.Link.Id).Scan(&indexed); err != nil || indexed != 1 {
		t.Fatalf("control index: %v %d rows, want 1", err, indexed)
	}

	// unknown token 404; no PIN and a wrong PIN 403; the right PIN opens and is journaled
	if _, err := svc.OpenLink(t.Context(), "unknown-token", ""); err == nil {
		t.Fatal("unknown token opened")
	} else {
		wantCode(t, err, "not_found")
	}
	_, err = svc.OpenLink(t.Context(), created.Token, "")
	wantCode(t, err, "forbidden_action")
	_, err = svc.OpenLink(t.Context(), created.Token, "000000"[:pinDigits])
	wantCode(t, err, "forbidden_action")
	sess, err := svc.OpenLink(t.Context(), created.Token, *created.Pin)
	if err != nil || sess.Title != "Для заказчика" || sess.Config.Mode != dapi.DocSessionConfigModeView || sess.Config.FileUrl == nil || sess.Watermark == "" {
		t.Fatalf("open: %v %+v", err, sess)
	}
	links, err := svc.ListLinks(ctx, tc, doc)
	if err != nil || len(links.Items) != 1 || links.Items[0].OpenCount != 1 || links.Items[0].LastOpenedAt == nil {
		t.Fatalf("links: %v %+v, want one opening (the failed PINs are not openings)", err, links.Items)
	}
	// five wrong PINs lock the link for the window
	for range pinTries {
		_, _ = svc.OpenLink(t.Context(), created.Token, "999999"[:pinDigits])
	}
	_, err = svc.OpenLink(t.Context(), created.Token, *created.Pin)
	wantCode(t, err, "rate_limited")

	// revoked: the link stops at once
	if _, err := svc.RevokeLink(eCtx, eTC, doc, created.Link.Id); err == nil {
		t.Fatal("a member who is not the owner of the business revoked a link")
	}
	rev, err := svc.RevokeLink(ctx, tc, doc, created.Link.Id)
	if err != nil || rev.Status != dapi.DocExternalLinkStatusRevoked {
		t.Fatalf("revoke: %v %+v", err, rev)
	}
	_, err = svc.OpenLink(t.Context(), created.Token, *created.Pin)
	wantCode(t, err, "public_token_expired")
	_, err = svc.RevokeLink(ctx, tc, doc, uuid.New())
	wantCode(t, err, "not_found")
}

// A link without a PIN opens at once; a document with personal data is not given by a link.
func TestLinkWithoutPin(t *testing.T) { //nolint:paralleltest // the tests share the documents and the people of the fixtures and run in order
	ctx, tc := as(t, "a.owner")
	folder := newFolder(t, "Без PIN")
	doc := seedDoc(t, folder, tc.PersonID, "Договор", "pdf")
	in := linkInput(3)
	no := false
	in.Pin, in.Watermark = &no, &no
	created, err := svc.CreateLink(ctx, tc, doc, in)
	if err != nil || created.Pin != nil || created.Link.Pin || created.Link.Watermark {
		t.Fatalf("create: %v %+v", err, created)
	}
	sess, err := svc.OpenLink(t.Context(), created.Token, "")
	if err != nil || sess.Watermark != "" {
		t.Fatalf("open: %v %+v", err, sess)
	}
	pdn := seedDoc(t, folder, tc.PersonID, "Паспорт", "pdf")
	if err := exec(t.Context(), `update docs.documents set sensitivity = 'pdn' where id = $1`, pdn); err != nil {
		t.Fatal(err)
	}
	_, err = svc.CreateLink(ctx, tc, pdn, linkInput(3))
	wantCode(t, err, "validation_failed")
}
