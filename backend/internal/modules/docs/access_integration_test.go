//go:build integration

package docs

import (
	"context"
	"testing"

	"github.com/google/uuid"

	dapi "github.com/ortus/ortus-crm/backend/internal/api/docs"
)

// grantTenantRole gives a person a role of the whole organization with the actions (a custom role: no template).
func grantTenantRole(t *testing.T, person uuid.UUID, name string, actions []string) {
	t.Helper()
	role := uuid.New()
	if err := exec(t.Context(), `insert into access.roles (id, name, kind) values ($1, $2, 'custom')`, role, name+"-"+role.String()[:8]); err != nil {
		t.Fatal(err)
	}
	if err := exec(t.Context(), `insert into access.role_versions (role_id, version, actions, created_by) values ($1, 1, $2, $3)`, role, actions, person); err != nil {
		t.Fatal(err)
	}
	assignment := uuid.New()
	if err := exec(t.Context(), `insert into access.role_assignments (id, principal_kind, principal_id, role_id, role_version, scope_kind, valid, granted_by)
		values ($3, 'person', $1, $2, 1, 'tenant', tstzrange('2026-09-01 00:00+03', null), $1)`, person, role, assignment); err != nil {
		t.Fatal(err)
	}
	// the grant lives for the test only: the people of the fixtures are shared by all tests
	t.Cleanup(func() {
		_ = exec(context.Background(), `delete from access.role_assignments where id = $1`, assignment)
	})
}

func entryOf(who string, ref uuid.UUID, level dapi.DocShareEntryLevel) dapi.DocShareEntry {
	r := ref
	return dapi.DocShareEntry{Who: dapi.DocShareEntryWho(who), RefId: &r, Level: level}
}

// A member never gives more than his own level and «Только выбранные» is for the one who manages (docShare).
func TestSharesDelegation(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	ownerCtx, ownerTC := as(t, "a.owner")
	folder := newFolder(t, "Доступ")
	doc, err := svc.CreateDocument(ownerCtx, ownerTC, dapi.DocCreate{Kind: dapi.DocCreateKindText, Title: "Договор", FolderId: folder})
	if err != nil {
		t.Fatal(err)
	}
	sharer, target := personOf(t, "a.manager-msk1"), personOf(t, "a.manager-msk2")
	grantTenantRole(t, sharer, "docs-settings", []string{"docs.read", "docs.share"})
	// the document is listed: only the sharer, with «Правит»
	listed := dapi.DocSharesSet{Mode: dapi.DocSharesSetModeListed, Entries: []dapi.DocShareEntry{entryOf("member", sharer, "edit")}}
	res, err := svc.SetShares(ownerCtx, ownerTC, doc.Id, etag(doc.Revision), listed)
	if err != nil || !res.Applied || res.Shares == nil {
		t.Fatalf("owner lists the document: %v %+v", err, res)
	}
	sCtx, sTC := as(t, "a.manager-msk1")
	card, err := svc.Document(sCtx, sTC, doc.Id)
	if err != nil || !card.My.Can.Share || card.My.MaxGrant == nil || *card.My.MaxGrant != dapi.DocMyMaxGrantEdit {
		t.Fatalf("sharer card: %v %+v max %v, want share and up to «Правит»", err, card.My.Can, card.My.MaxGrant)
	}
	rev := res.Shares.Revision
	own := entryOf("member", sharer, "edit")
	_, err = svc.SetShares(sCtx, sTC, doc.Id, etag(rev), dapi.DocSharesSet{Mode: dapi.DocSharesSetModeListed, Entries: []dapi.DocShareEntry{own, entryOf("member", target, "manage")}})
	wantCode(t, err, "delegation_exceeds_grant")
	_, err = svc.SetShares(sCtx, sTC, doc.Id, etag(rev), dapi.DocSharesSet{Mode: dapi.DocSharesSetModeInherit, Entries: []dapi.DocShareEntry{own}})
	wantCode(t, err, "forbidden_action") // only one who manages turns the listing off
	dry := true
	res, err = svc.SetShares(sCtx, sTC, doc.Id, etag(rev), dapi.DocSharesSet{Mode: dapi.DocSharesSetModeListed, DryRun: &dry,
		Entries: []dapi.DocShareEntry{own, entryOf("member", target, "comment")}})
	if err != nil || res.Applied || len(res.Impact.Gain) != 1 || res.Impact.Gain[0].Member.MemberId != target {
		t.Fatalf("dryRun: %v %+v, want the target to gain access", err, res)
	}
	res, err = svc.SetShares(sCtx, sTC, doc.Id, etag(rev), dapi.DocSharesSet{Mode: dapi.DocSharesSetModeListed,
		Entries: []dapi.DocShareEntry{own, entryOf("member", target, "comment")}})
	if err != nil || !res.Applied || len(res.Shares.Entries) != 2 {
		t.Fatalf("share: %v %+v", err, res)
	}
	tCtx, tTC := as(t, "a.manager-msk2")
	got, err := svc.Document(tCtx, tTC, doc.Id)
	if err != nil || got.My.Level == nil || *got.My.Level != dapi.DocMyLevelComment {
		t.Fatalf("target: %v level %v, want comment", err, got.My.Level)
	}
	// a stale revision is refused
	_, err = svc.SetShares(sCtx, sTC, doc.Id, etag(rev), dapi.DocSharesSet{Mode: dapi.DocSharesSetModeListed, Entries: []dapi.DocShareEntry{own}})
	wantCode(t, err, "revision_mismatch")
	// a term in the past is refused
	past := dapi.DocShareEntry{Who: "member", RefId: &target, Level: "view"}
	setDate(&past.Until, testNowDate().AddDate(0, 0, -1))
	_, err = svc.SetShares(sCtx, sTC, doc.Id, etag(res.Shares.Revision), dapi.DocSharesSet{Mode: dapi.DocSharesSetModeListed, Entries: []dapi.DocShareEntry{own, past}})
	wantCode(t, err, "validation_failed")
	// a blocked or unknown member
	_, err = svc.SetShares(sCtx, sTC, doc.Id, etag(res.Shares.Revision), dapi.DocSharesSet{Mode: dapi.DocSharesSetModeListed,
		Entries: []dapi.DocShareEntry{own, entryOf("member", uuid.New(), "view")}})
	wantCode(t, err, "validation_failed")
}

// A comment with a mention of a member without access gives the author a waiting item; the access from the mention
// opens the document for him and moves the waiting item to him (docComment, docGrant, docReply, docMentionSkip).
func TestCommentsAndMentions(t *testing.T) { //nolint:gocyclo,paralleltest // a scenario of one story: the steps share the data and run in order
	ownerCtx, ownerTC := as(t, "a.owner")
	folder := newFolder(t, "Обсуждение")
	doc, err := svc.CreateDocument(ownerCtx, ownerTC, dapi.DocCreate{Kind: dapi.DocCreateKindText, Title: "План", FolderId: folder})
	if err != nil {
		t.Fatal(err)
	}
	author, mentioned, reader := personOf(t, "a.manager-msk1"), personOf(t, "a.manager-msk2"), personOf(t, "a.region-msk")
	for _, m := range []struct {
		id    uuid.UUID
		level string
	}{{author, "comment"}, {reader, "view"}} {
		if err := exec(t.Context(), `insert into docs.shares (document_id, who, ref_id, level) values ($1, 'member', $2, $3)`, doc.Id, m.id, m.level); err != nil {
			t.Fatal(err)
		}
	}
	aCtx, aTC := as(t, "a.manager-msk1")
	anchor := func(ref string) struct {
		Kind  dapi.DocCommentCreateAnchorKind `json:"kind"`
		Quote *string                         `json:"quote,omitempty"`
		Ref   string                          `json:"ref"`
	} {
		return struct {
			Kind  dapi.DocCommentCreateAnchorKind `json:"kind"`
			Quote *string                         `json:"quote,omitempty"`
			Ref   string                          `json:"ref"`
		}{Kind: dapi.DocCommentCreateAnchorKindBlock, Ref: ref}
	}
	c, err := svc.CreateComment(aCtx, aTC, doc.Id, dapi.DocCommentCreate{Text: " Сроки? ", Anchor: anchor("b1"), Mention: &mentioned})
	if err != nil || c.Text != "Сроки?" || c.Mention == nil || c.Mention.MemberId != mentioned {
		t.Fatalf("comment: %v %+v", err, c)
	}
	card, _ := svc.Document(aCtx, aTC, doc.Id)
	if len(card.My.Wait) != 1 || card.My.Wait[0].Kind != "mention" {
		t.Fatalf("the author waits: %+v, want the mention of a member without access", card.My.Wait)
	}
	// empty text, a viewer cannot comment, nobody comments a missing document
	_, err = svc.CreateComment(aCtx, aTC, doc.Id, dapi.DocCommentCreate{Text: "  ", Anchor: anchor("b1")})
	wantCode(t, err, "validation_failed")
	rCtx, rTC := as(t, "a.region-msk")
	_, err = svc.CreateComment(rCtx, rTC, doc.Id, dapi.DocCommentCreate{Text: "Да", Anchor: anchor("b1")})
	wantCode(t, err, "forbidden_action")
	// the author cannot give the access (his level is «Комментирует»); the owner of the business does
	_, err = svc.Grant(aCtx, aTC, doc.Id, dapi.DocGrantCreate{MemberId: mentioned, Level: "comment"})
	wantCode(t, err, "forbidden_action")
	shares, err := svc.Grant(ownerCtx, ownerTC, doc.Id, dapi.DocGrantCreate{MemberId: mentioned, Level: "comment"})
	if err != nil || len(shares.Entries) != 3 {
		t.Fatalf("grant: %v %+v", err, shares)
	}
	card, _ = svc.Document(aCtx, aTC, doc.Id)
	if len(card.My.Wait) != 0 {
		t.Fatalf("the author still waits: %+v", card.My.Wait)
	}
	mCtx, mTC := as(t, "a.manager-msk2")
	card, err = svc.Document(mCtx, mTC, doc.Id)
	if err != nil || len(card.My.Wait) != 1 || card.My.Wait[0].Kind != "mention" || card.OpenCommentCount != 1 {
		t.Fatalf("the mentioned member: %v wait %+v open %d", err, card.My.Wait, card.OpenCommentCount)
	}
	reply, err := svc.ReplyComment(mCtx, mTC, doc.Id, c.Id, dapi.DocReplyCreate{Text: "К пятнице"})
	if err != nil || len(reply.Replies) != 1 || reply.Replies[0].Author.MemberId != mentioned {
		t.Fatalf("reply: %v %+v", err, reply)
	}
	card, _ = svc.Document(mCtx, mTC, doc.Id)
	if len(card.My.Wait) != 0 {
		t.Fatalf("the answered mention still waits: %+v", card.My.Wait)
	}
	// resolve: a viewer who is not the author is refused; the author may
	_, err = svc.ResolveComment(rCtx, rTC, doc.Id, c.Id)
	wantCode(t, err, "forbidden_action")
	done, err := svc.ResolveComment(aCtx, aTC, doc.Id, c.Id)
	if err != nil || !done.Resolved || done.ResolvedBy == nil || done.ResolvedBy.MemberId != author {
		t.Fatalf("resolve: %v %+v", err, done)
	}
	// skip: the mention of a member without access is dropped
	noAccess := personOf(t, "a.manager-future")
	c2, err := svc.CreateComment(aCtx, aTC, doc.Id, dapi.DocCommentCreate{Text: "Ещё", Anchor: anchor("b2"), Mention: &noAccess})
	if err != nil {
		t.Fatal(err)
	}
	skipped, err := svc.SkipMentionGrant(aCtx, aTC, doc.Id, c2.Id)
	if err != nil || skipped.Mention != nil {
		t.Fatalf("skip: %v %+v", err, skipped)
	}
	list, err := svc.Comments(ownerCtx, ownerTC, doc.Id)
	if err != nil || len(list.Items) != 2 {
		t.Fatalf("list: %v %d", err, len(list.Items))
	}
}

// The journal of a document keeps what was done to it (listDocActivity).
func TestActivity(t *testing.T) { //nolint:paralleltest // the tests share the documents and the people of the fixtures and run in order
	ctx, tc := as(t, "a.owner")
	folder := newFolder(t, "Журнал")
	doc, err := svc.CreateDocument(ctx, tc, dapi.DocCreate{Kind: dapi.DocCreateKindText, Title: "Журналируемый", FolderId: folder})
	if err != nil {
		t.Fatal(err)
	}
	title := "Журналируемый 2"
	if _, err := svc.UpdateDocument(ctx, tc, doc.Id, etag(doc.Revision), dapi.DocPatch{Title: &title}); err != nil {
		t.Fatal(err)
	}
	log, err := svc.Activity(ctx, tc, doc.Id, Page{})
	if err != nil || len(log.Items) != 2 || log.Items[0].Action != "docs.document.rename" || log.Items[1].Action != "docs.document.create" {
		t.Fatalf("activity: %v %+v", err, log.Items)
	}
	if log.Items[0].By.MemberId != tc.PersonID {
		t.Fatalf("by %v, want the owner", log.Items[0].By)
	}
}
