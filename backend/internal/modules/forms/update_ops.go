package forms

import (
	"context"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Texts of 412 revision_mismatch (the form — the example updateForm/revision_mismatch; the rule and the response —
// no-reference, the same wording).
const (
	textFormChanged     = "Форму уже изменили — обновите страницу"
	textRuleChanged     = "Действие уже изменили — обновите страницу"
	textResponseChanged = "Ответ уже изменили — обновите страницу"
)

// checkRev requires If-Match to name the revision current ("rev-N", quoted or not): 412 revision_mismatch with text.
func checkRev(ifMatch string, current int64, text string) error {
	tag := strings.Trim(strings.TrimPrefix(strings.TrimSpace(ifMatch), "W/"), `"`)
	if n, err := strconv.ParseInt(strings.TrimPrefix(tag, "rev-"), 10, 64); err != nil || n != current || !strings.HasPrefix(tag, "rev-") {
		return problem.New(codeRevision, text)
	}
	return nil
}

// Nulls are the fields of a body sent as an explicit null (Nulls middleware): the generated pointers do not tell a
// null from an absent field.
type Nulls map[string]bool

// UpdateForm answers updateForm: the name, «Закрыть / Возобновить приём», the area, the group and the settings.
func (s *Service) UpdateForm(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, ifMatch string, b fapi.FormPatch, nulls Nulls) (fapi.Form, error) {
	var out fapi.Form
	err := s.runOn(ctx, tc, true, id, func(r *req) error {
		f, err := r.visibleForm(ctx, id, true)
		if err != nil {
			return err
		}
		if err := r.need(ctx, f, actManage); err != nil {
			return err
		}
		if err := checkRev(ifMatch, f.revision, textFormChanged); err != nil {
			return err
		}
		notice, err := r.patch(ctx, f, b, nulls)
		if err != nil {
			return err
		}
		if err := r.issueLink(ctx, f); err != nil {
			return err
		}
		f.revision++
		f.updated = r.now
		if err := r.saveForm(ctx, f); err != nil {
			if unique(err) {
				return invalid("name", "Форма «"+f.name+"» уже есть", "taken")
			}
			return err
		}
		if err := r.event(ctx, evFormUpdated, f.id, nil, ""); err != nil {
			return err
		}
		if notice.typ != "" {
			if err := r.event(ctx, notice.typ, f.id, nil, notice.title); err != nil {
				return err
			}
		}
		if err := r.flushNotices(ctx); err != nil {
			return err
		}
		out, err = r.formOut(ctx, f)
		return err
	})
	return out, err
}

// statusNotice is the event and the notice of a change of the acceptance of responses.
type statusNotice struct{ typ, title string }

// patch applies the body of updateForm to f in the order of the prototype.
func (r *req) patch(ctx context.Context, f *formRow, b fapi.FormPatch, nulls Nulls) (statusNotice, error) {
	if err := r.rename(ctx, f, b.Name); err != nil {
		return statusNotice{}, err
	}
	notice, err := patchStatus(f, b.Status)
	if err != nil {
		return notice, err
	}
	if err := r.patchArea(ctx, f, b, nulls); err != nil {
		return notice, err
	}
	if b.Settings != nil {
		if err := r.patchSettings(ctx, f, *b.Settings, nulls); err != nil {
			return notice, err
		}
	}
	return notice, nil
}

// rename gives f the new name (nil — keeps it): not short, not taken.
func (r *req) rename(ctx context.Context, f *formRow, to *string) error {
	if to == nil {
		return nil
	}
	name, err := checkName(*to, textNameShort)
	if err != nil {
		return err
	}
	if taken, err := r.nameTaken(ctx, name, f.id); err != nil || taken {
		if err == nil {
			err = invalid("name", "Форма «"+name+"» уже есть", "taken")
		}
		return err
	}
	f.name = name
	return nil
}

// patchStatus opens or closes the acceptance of responses of a published f and returns its notice (none — no change).
func patchStatus(f *formRow, st *fapi.FormPatchStatus) (statusNotice, error) {
	if st == nil {
		return statusNotice{}, nil
	}
	if f.current == nil {
		return statusNotice{}, conflict(reasonNotPublished, textNotPublished)
	}
	to := statusClosed
	if *st == fapi.FormPatchStatusOpen {
		to = statusPublished
	}
	if to == f.status {
		return statusNotice{}, nil
	}
	f.status = to
	if to == statusClosed {
		return statusNotice{evFormClosed, "Закрыт приём ответов: «" + f.name + "»"}, nil
	}
	return statusNotice{evFormReopened, "Возобновлён приём ответов: «" + f.name + "»"}, nil
}

// patchArea moves f to another area (forms.manage there too) or group (null — «Без группы»).
func (r *req) patchArea(ctx context.Context, f *formRow, b fapi.FormPatch, nulls Nulls) error {
	if b.OrgUnitId != nil || nulls["orgUnitId"] {
		unit, err := r.unitOf(ctx, b.OrgUnitId)
		if err != nil {
			return err
		}
		if ok, err := r.canIn(ctx, unit, actManage); err != nil || !ok {
			if err == nil {
				err = forbidden(need[actManage])
			}
			return err
		}
		f.unit = unit
	}
	if b.GroupId != nil || nulls["groupId"] {
		g, err := r.groupOf(ctx, b.GroupId)
		if err != nil {
			return err
		}
		f.group = g
	}
	return nil
}

// patchSettings applies the changed settings (FormSettingsPatch): public access needs forms.publish_public and no
// question of CRM data; a shortened retention keeps the older responses for the grace period (Q-W4.00-forms-22).
func (r *req) patchSettings(ctx context.Context, f *formRow, p fapi.FormSettingsPatch, nulls Nulls) error {
	s := &f.set
	if err := r.patchAccess(ctx, f, p.Access); err != nil {
		return err
	}
	if p.AcceptUntil != nil {
		d := time.Date(p.AcceptUntil.Year(), p.AcceptUntil.Month(), p.AcceptUntil.Day(), 0, 0, 0, 0, time.UTC)
		s.acceptUntil = &d
	} else if nulls["settings.acceptUntil"] {
		s.acceptUntil = nil
	}
	if err := patchLimits(s, p, nulls); err != nil {
		return err
	}
	if p.RetainResponsesDays != nil {
		r.retain(s, int(*p.RetainResponsesDays))
	}
	flags := []struct {
		from *bool
		to   *bool
	}{{p.OnePerMember, &s.onePerMember}, {p.AllowEditBeforeReview, &s.extra.AllowEditBeforeReview}, {p.Scoring, &s.extra.Scoring},
		{p.ShowScore, &s.extra.ShowScore}, {p.ProgressBar, &s.extra.ProgressBar}, {p.BackButton, &s.extra.BackButton},
		{p.ShowLogo, &s.extra.ShowLogo}}
	for _, x := range flags {
		if x.from != nil {
			*x.to = *x.from
		}
	}
	return nil
}

// patchAccess sets the access of f: public access needs forms.publish_public and no question of CRM data.
func (r *req) patchAccess(ctx context.Context, f *formRow, access *fapi.FormSettingsPatchAccess) error {
	if access == nil {
		return nil
	}
	if string(*access) == accessPublic && f.set.access != accessPublic {
		if err := r.need(ctx, f, actPublishPublic); err != nil {
			return err
		}
		if q, ok, err := r.crmQuestion(ctx, f); err != nil || ok {
			if err == nil {
				err = invalid("settings.access", "Публичный доступ невозможен: вопрос «"+q.Label+"» спрашивает данные CRM")
			}
			return err
		}
	}
	f.set.access = string(*access)
	return nil
}

// patchLimits sets the limit of responses, the pass score and the text after the submission (null — none).
func patchLimits(s *settings, p fapi.FormSettingsPatch, nulls Nulls) error {
	if p.ResponseLimit != nil {
		if *p.ResponseLimit < 1 || *p.ResponseLimit > 1_000_000 {
			return invalid("settings.responseLimit", textLimit)
		}
		s.responseLimit = new(*p.ResponseLimit)
	} else if nulls["settings.responseLimit"] {
		s.responseLimit = nil
	}
	if p.PassScore != nil {
		s.extra.PassScore = new(*p.PassScore)
	} else if nulls["settings.passScore"] {
		s.extra.PassScore = nil
	}
	if p.ConfirmationText != nil {
		if utf8.RuneCountInString(*p.ConfirmationText) > 1000 {
			return invalid("settings.confirmationText", "Текст после отправки — не длиннее 1000 символов")
		}
		s.extra.ConfirmationText = *p.ConfirmationText
	}
	return nil
}

// retain sets the retention of the responses: a shortening remembers the former one for the grace period (the longest
// retention still in its grace wins), a lengthening drops it.
func (r *req) retain(s *settings, days int) {
	if days >= s.retainDays {
		if sh := s.extra.Shortened; sh != nil && days >= sh.Days {
			s.extra.Shortened = nil
		}
		s.retainDays = days
		return
	}
	former := s.retainDays
	if sh := s.extra.Shortened; sh != nil && r.now.Before(sh.At.Add(retainGrace)) && sh.Days > former {
		former = sh.Days
	}
	s.extra.Shortened = &shortened{Days: former, At: r.now}
	s.retainDays = days
}

// retainGrace is the delay of a shortened retention for the older responses (Q-W4.00-forms-22).
const retainGrace = 7 * 24 * time.Hour

// crmQuestion is the first question of CRM data of the draft or of the acting version of f.
func (r *req) crmQuestion(ctx context.Context, f *formRow) (question, bool, error) {
	defs := []def{f.draft}
	if f.current != nil {
		v, err := r.version(ctx, f.id, *f.current)
		if err != nil {
			return question{}, false, err
		}
		if v != nil {
			defs = append(defs, v.def)
		}
	}
	for _, d := range defs {
		for _, x := range d.Fields {
			if crmType(x.Type) {
				return x, true, nil
			}
		}
	}
	return question{}, false, nil
}

// Groups answers listFormGroups: the groups by name with the forms of each the member sees.
func (s *Service) Groups(ctx context.Context, tc tenantctx.TenantContext) (fapi.FormGroupList, error) {
	out := fapi.FormGroupList{Items: []fapi.FormGroup{}}
	err := s.run(ctx, tc, false, func(r *req) error {
		gs, err := r.groups(ctx)
		if err != nil {
			return err
		}
		fs, err := r.allForms(ctx)
		if err != nil {
			return err
		}
		count := map[uuid.UUID]int{}
		for _, f := range fs {
			if f.group == nil {
				continue
			}
			ok, err := r.visible(ctx, f)
			if err != nil {
				return err
			}
			if ok {
				count[*f.group]++
			}
		}
		for _, g := range gs {
			out.Items = append(out.Items, fapi.FormGroup{Id: g.id, Name: g.name, FormCount: count[g.id]})
		}
		return nil
	})
	return out, err
}

// CreateGroup answers createFormGroup (forms.manage in the organization — the gateway, x-scope tenant).
func (s *Service) CreateGroup(ctx context.Context, tc tenantctx.TenantContext, b fapi.FormGroupCreate) (fapi.FormGroup, error) {
	var out fapi.FormGroup
	err := s.run(ctx, tc, true, func(r *req) error {
		name := strings.TrimSpace(b.Name)
		if n := utf8.RuneCountInString(name); n < groupNameMin || n > groupNameMax {
			return invalid("name", textGroupShort)
		}
		if ok, err := r.canIn(ctx, nil, actManage); err != nil || !ok {
			if err == nil {
				err = forbidden(need[actManage])
			}
			return err
		}
		g := groupRow{id: uuid.New(), name: name}
		if _, err := r.tx.Exec(ctx, `insert into forms.groups (id, name, created_by, created_at) values ($1, $2, $3, $4)`,
			g.id, g.name, nullID(r.me()), r.now); err != nil {
			if unique(err) {
				return invalid("name", textGroupTaken, "taken")
			}
			return store("group", err)
		}
		out = fapi.FormGroup{Id: g.id, Name: g.name, FormCount: 0}
		return nil
	})
	return out, err
}

// DeleteGroup answers deleteFormGroup: only an empty group (any form, even one the member does not see).
func (s *Service) DeleteGroup(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID) error {
	return s.run(ctx, tc, true, func(r *req) error {
		if ok, err := r.canIn(ctx, nil, actManage); err != nil || !ok {
			if err == nil {
				err = forbidden(need[actManage])
			}
			return err
		}
		var exists, full bool
		if err := r.tx.QueryRow(ctx, `select exists (select 1 from forms.groups where id = $1),
			exists (select 1 from forms.forms where group_id = $1)`, id).Scan(&exists, &full); err != nil {
			return store("group", err)
		}
		switch {
		case !exists:
			return notFound(textGroupMissing)
		case full:
			return conflict(reasonGroupFull, textGroupFull)
		}
		_, err := r.tx.Exec(ctx, `delete from forms.groups where id = $1`, id)
		return store("delete group", err)
	})
}

// nullID is NULL for uuid.Nil.
func nullID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}
