package forms

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/google/uuid"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Draft answers getFormDraft.
func (s *Service) Draft(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) (fapi.FormDraft, error) {
	var out fapi.FormDraft
	err := s.runOn(ctx, tc, false, id, func(r *req) error {
		f, err := r.visibleForm(ctx, id, false)
		if err != nil {
			return err
		}
		out, err = r.draftDTO(ctx, f)
		return err
	})
	return out, err
}

// draftCommand runs a command on the draft of the form id: forms.manage and If-Match of the draft (412 «Черновик
// изменил другой редактор — обновите страницу»).
func (s *Service) draftCommand(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, fn func(*req, *formRow) error) (fapi.FormDraft, error) {
	var out fapi.FormDraft
	err := s.runOn(ctx, tc, true, id, func(r *req) error {
		f, err := r.visibleForm(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, f, actManage); err != nil {
			return err
		}
		if err := checkRev(ifMatch, f.draftRev, textDraftChanged); err != nil {
			return err
		}
		if err := fn(r, f); err != nil {
			return err
		}
		f.draftRev++
		f.draftSavedAt, f.draftSavedBy, f.updated = new(r.now), nil, r.now
		if r.me() != uuid.Nil {
			f.draftSavedBy = new(r.me())
		}
		if err := r.saveDraft(ctx, f); err != nil {
			return err
		}
		if _, err := r.tx.Exec(ctx, `update forms.forms set updated_at = $2 where id = $1`, f.id, r.now); err != nil {
			return store("touch form", err)
		}
		out, err = r.draftDTO(ctx, f)
		return err
	})
	return out, err
}

// SaveDraft answers saveFormDraft: the whole draft (incomplete questions are issues, the structure — 422).
func (s *Service) SaveDraft(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b fapi.FormDraftSave) (fapi.FormDraft, error) {
	return s.draftCommand(ctx, tc, id, ifMatch, func(r *req, f *formRow) error {
		if errs := structureErrors(b.Definition); len(errs) > 0 {
			return invalidAll(errs, "")
		}
		f.draft = cloneDef(b.Definition)
		f.draftChanged = false
		if f.current != nil {
			cur, err := r.version(ctx, f.id, *f.current)
			if err != nil {
				return err
			}
			f.draftChanged = cur == nil || !sameDef(f.draft, cur.def)
		}
		return nil
	})
}

// DiscardDraft answers discardFormDraft: the draft becomes the acting version again.
func (s *Service) DiscardDraft(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string) (fapi.FormDraft, error) {
	return s.draftCommand(ctx, tc, id, ifMatch, func(r *req, f *formRow) error {
		if f.current == nil {
			return conflict(reasonNotPublished, textNoVersion)
		}
		cur, err := r.version(ctx, f.id, *f.current)
		if err != nil {
			return err
		}
		if cur == nil {
			return conflict(reasonNotPublished, textNoVersion)
		}
		f.draft, f.draftChanged = cloneDef(cur.def), false
		return nil
	})
}

// Publish answers publishForm: the draft of revision draftRevision becomes version N+1 — checks of api.js and of
// issues() first (422 «Найдено ошибок: N. Исправьте их в конструкторе.»), a key of a question whose type changed
// becomes «{key}-v{N}», the form accepts responses, a public form gets its link.
func (s *Service) Publish(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b fapi.FormPublishRequest) (fapi.Form, error) {
	var out fapi.Form
	err := s.runOn(ctx, tc, true, id, func(r *req) error {
		f, err := r.visibleForm(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.publishable(ctx, f, ifMatch, b); err != nil {
			return err
		}
		n, err := r.newVersion(ctx, f)
		if err != nil {
			return err
		}
		if err := r.issueLink(ctx, f); err != nil {
			return err
		}
		f.revision++
		f.updated = r.now
		if err := r.saveForm(ctx, f); err != nil {
			return err
		}
		if err := r.saveDraft(ctx, f); err != nil {
			return err
		}
		title := "Опубликована форма «" + f.name + "» v" + strconv.Itoa(n) + ". Старые ответы сохраняют свои версии"
		if err := r.event(ctx, evPublished, f.id, map[string]any{keyVersionNumber: n}, title); err != nil {
			return err
		}
		if err := r.flushNotices(ctx); err != nil {
			return err
		}
		out, err = r.formOut(ctx, f)
		return err
	})
	return out, err
}

// publishable checks the publication of the draft of f: forms.publish (and forms.publish_public for a public form),
// the revisions of the form and of the draft, changes since the acting version, the checks of api.js and issues().
func (r *req) publishable(ctx context.Context, f *formRow, ifMatch string, b fapi.FormPublishRequest) error {
	if err := r.need(ctx, f, actPublish); err != nil {
		return err
	}
	if err := checkRev(ifMatch, f.revision, textFormChanged); err != nil {
		return err
	}
	if b.DraftRevision != f.draftRev {
		return problem.New(codeRevision, textDraftChanged)
	}
	public := f.set.access == accessPublic
	if public {
		if err := r.need(ctx, f, actPublishPublic); err != nil {
			return err
		}
	}
	if f.current != nil && !f.draftChanged {
		return conflict(reasonNoChanges, textNoChanges)
	}
	if errs := publishViolations(public, f.draft); len(errs) > 0 {
		return invalidAll(errs, "Найдено ошибок: "+strconv.Itoa(len(errs))+". Исправьте их в конструкторе.")
	}
	return nil
}

// newVersion writes version N+1 of f from its draft and makes it acting; the draft becomes that version.
func (r *req) newVersion(ctx context.Context, f *formRow) (int, error) {
	n := f.latest + 1
	var prev *def
	if f.latest > 0 {
		v, err := r.version(ctx, f.id, f.latest)
		if err != nil {
			return 0, err
		}
		if v != nil {
			prev = &v.def
		}
	}
	d := nextVersion(f.draft, prev, n)
	raw, err := json.Marshal(d)
	if err != nil {
		return 0, err
	}
	vid := uuid.New()
	if _, err := r.tx.Exec(ctx, `insert into forms.versions (id, form_id, number, definition, question_count, published_at,
		published_by) values ($1, $2, $3, $4::jsonb, $5, $6, $7)`, vid, f.id, n, string(raw), questionCount(d), r.now,
		nullID(r.me())); err != nil {
		return 0, store("version", err)
	}
	f.versionIDs[n], f.latest, f.current, f.status = vid, n, new(n), statusPublished
	f.draft, f.draftChanged, f.draftRev, f.draftSavedAt = d, false, f.draftRev+1, new(r.now)
	if r.me() != uuid.Nil {
		f.draftSavedBy = new(r.me())
	}
	return n, nil
}

// Versions answers listFormVersions: the newest first.
func (s *Service) Versions(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, cursor *string, limit *int) (fapi.FormVersionPage, error) {
	out := fapi.FormVersionPage{Items: []fapi.FormVersion{}}
	err := s.runOn(ctx, tc, false, id, func(r *req) error {
		f, err := r.visibleForm(ctx, id, false)
		if err != nil {
			return err
		}
		vs, err := r.versions(ctx, f.id)
		if err != nil {
			return err
		}
		ids := make([]uuid.UUID, 0, len(vs))
		for _, v := range vs {
			ids = append(ids, v.id)
		}
		from, to, next, err := paginate(ids, cursor, limit)
		if err != nil {
			return err
		}
		for _, v := range vs[from:to] {
			dto, err := r.versionDTO(ctx, f, v)
			if err != nil {
				return err
			}
			out.Items = append(out.Items, dto)
		}
		out.NextCursor = next
		return nil
	})
	return out, err
}

// DraftFlow answers the deprecated createFormVersion and publishFormVersion: 409 form_draft_flow on a form the member
// sees (404 otherwise).
func (s *Service) DraftFlow(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) error {
	return s.runOn(ctx, tc, false, id, func(r *req) error {
		if _, err := r.visibleForm(ctx, id, false); err != nil {
			return err
		}
		return conflict(reasonDraftFlow, textDraftFlow)
	})
}
