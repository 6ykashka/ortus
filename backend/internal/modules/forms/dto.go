package forms

import (
	"context"
	"strconv"

	"github.com/google/uuid"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// etag is the ETag of a revision.
func etag(revision int64) string { return `"rev-` + strconv.FormatInt(revision, 10) + `"` }

// memberRef is FormMemberRef of a person.
func (r *req) memberRef(ctx context.Context, id *uuid.UUID) (fapi.FormMemberRef, error) {
	if id == nil || *id == uuid.Nil {
		return fapi.FormMemberRef{DisplayName: textGuest}, nil
	}
	name, err := r.nameOf(ctx, id)
	if err != nil {
		return fapi.FormMemberRef{}, err
	}
	return fapi.FormMemberRef{MemberId: new(*id), DisplayName: name}, nil
}

// counts fills the visible responses and the enabled rules of f.
func (r *req) counts(ctx context.Context, f *formRow) error {
	rs, err := r.responses(ctx, f.id)
	if err != nil {
		return err
	}
	if f.responses, err = r.countVisible(ctx, f, rs); err != nil {
		return err
	}
	return r.tx.QueryRow(ctx, `select count(*) from forms.rules where form_id = $1 and enabled`, f.id).Scan(&f.rulesOn)
}

// countVisible is the number of the responses rs of f the member reads.
func (r *req) countVisible(ctx context.Context, f *formRow, rs []*responseRow) (int, error) {
	vs, err := r.visibleResponses(ctx, f, rs)
	return len(vs), err
}

// visibleResponses are the responses rs of f the member reads (their objects are asked from the port at once).
func (r *req) visibleResponses(ctx context.Context, f *formRow, rs []*responseRow) ([]*responseRow, error) {
	if ok, err := r.can(ctx, f, actRespRead); err != nil || ok {
		return rs, err
	}
	if ok, err := r.anywhere(ctx, actRespRead); err != nil || !ok {
		return nil, err
	}
	var refs []fapi.ObjectRef
	for _, x := range rs {
		if x.subject != nil {
			refs = append(refs, x.subject.Ref)
		}
	}
	if err := r.lookObjects(ctx, refs); err != nil {
		return nil, err
	}
	var out []*responseRow
	for _, x := range rs {
		ok, err := r.sees(ctx, f, x)
		if err != nil {
			return nil, err
		}
		if ok {
			out = append(out, x)
		}
	}
	return out, nil
}

// formDTO is the form f as the member sees it (counts — filled by counts).
func (r *req) formDTO(ctx context.Context, f *formRow) (fapi.Form, error) {
	owner, err := r.memberRef(ctx, &f.owner)
	if err != nil {
		return fapi.Form{}, err
	}
	my, err := r.formMy(ctx, f)
	if err != nil {
		return fapi.Form{}, err
	}
	out := fapi.Form{
		Id: f.id, OrgUnitId: f.unit, Name: f.name, Status: fapi.FormStatus(f.status), Revision: f.revision, ModuleKey: f.module,
		TemplateId: f.template, GroupId: f.group, Owner: owner, UpdatedAt: f.updated, PublishedVersionNumber: f.current,
		VersionCount: len(f.versionIDs), HasUnpublishedChanges: f.current != nil && f.draftChanged, QuestionCount: questionCount(f.draft),
		ResponseCount: f.responses, EnabledRuleCount: f.rulesOn, Settings: f.set.api(), My: my,
	}
	if f.latest > 0 {
		out.LatestVersionId = new(f.versionIDs[f.latest])
	}
	if f.current != nil {
		out.PublishedVersionId = new(f.versionIDs[*f.current])
	}
	if my.Publish && f.current != nil && f.set.access == accessPublic && f.publicLink != nil {
		if key, ok := r.s.Keys.ByVer[f.publicKeyVer]; ok {
			out.Share.PublicToken = new(linkToken(key, r.tc.TenantID, *f.publicLink))
		}
	}
	return out, nil
}

// formMy is FormMy: the rights of the member in the area of f and whether he may answer now.
func (r *req) formMy(ctx context.Context, f *formRow) (fapi.FormMy, error) {
	var my fapi.FormMy
	var err error
	for _, x := range []struct {
		to     *bool
		action string
	}{{&my.Create, actCreate}, {&my.Manage, actManage}, {&my.Publish, actPublish}, {&my.PublishPublic, actPublishPublic}} {
		if *x.to, err = r.can(ctx, f, x.action); err != nil {
			return my, err
		}
	}
	if my.ReadResponses, err = r.anywhere(ctx, actRespRead); err != nil {
		return my, err
	}
	if my.ReviewResponses, err = r.can(ctx, f, actRespReview); err != nil {
		return my, err
	}
	if !my.ReviewResponses && f.unit == nil {
		if my.ReviewResponses, err = r.anywhere(ctx, actRespReview); err != nil {
			return my, err
		}
	}
	closed, err := r.closedReason(ctx, f)
	if err != nil || closed {
		return my, err
	}
	answered, err := r.answered(ctx, f)
	my.Respond = !answered
	return my, err
}

// draftDTO is the draft of f with its issues.
func (r *req) draftDTO(ctx context.Context, f *formRow) (fapi.FormDraft, error) {
	out := fapi.FormDraft{FormId: f.id, Definition: cloneDef(f.draft), Revision: f.draftRev, HasChanges: f.draftChanged,
		BaseVersionNumber: f.current, Issues: issuesOf(f.set.access == accessPublic, f.draft), SavedAt: f.draftSavedAt}
	if f.draftSavedBy != nil {
		by, err := r.memberRef(ctx, f.draftSavedBy)
		if err != nil {
			return out, err
		}
		out.SavedBy = &by
	}
	return out, nil
}

// versionDTO is a version of f.
func (r *req) versionDTO(ctx context.Context, f *formRow, v versionRow) (fapi.FormVersion, error) {
	by, err := r.memberRef(ctx, v.by)
	if err != nil {
		return fapi.FormVersion{}, err
	}
	return fapi.FormVersion{Id: v.id, FormId: f.id, Number: int64(v.number), Definition: cloneDef(v.def), CreatedAt: v.at,
		CreatedBy: by, QuestionCount: v.count, Current: f.current != nil && *f.current == v.number}, nil
}

// numberOf is «R-0001».
func numberOf(n int) string {
	s := strconv.Itoa(n)
	for len(s) < 4 {
		s = "0" + s
	}
	return "R-" + s
}
