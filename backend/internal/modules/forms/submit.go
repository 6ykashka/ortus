package forms

import (
	"context"
	"encoding/json"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Channels of a response (forms.responses.channel).
const (
	channelMember     = "member"
	channelPublic     = "public"
	channelInspection = "inspection"
)

// Review statuses of a response.
const (
	reviewPending  = "pending"
	reviewAccepted = "accepted"
	reviewRejected = "rejected"
)

// Limits of the parameters of a link (Q-W4.00-forms-20).
const (
	linkParamsMax = 50
	linkValueMax  = 500
)

// submission is a response being submitted: the answers, the parameters of the link, the object (an employee), the
// channel, who uploads its files (the member or the nonce of a guest) and the key of deduplication.
type submission struct {
	versionID  *uuid.UUID
	answers    []fapi.FieldEntry
	linkParams *map[string]string
	subject    *fapi.ObjectRef
	channel    string
	actor      uuid.UUID
	dedup      string
}

// Submit answers submitFormResponse: the response of an employee by the acting version, accepted at once; the rules
// run in the same transaction.
func (s *Service) Submit(ctx context.Context, tc tenantctx.TenantContext, id uuid.UUID, b fapi.FormResponseCreate) (fapi.FormResponse, error) {
	var out fapi.FormResponse
	err := s.runOn(ctx, tc, true, id, func(r *req) error {
		f, err := r.visibleForm(ctx, id, true) // the row of the form serializes the limit and «Один ответ» (response_limit)
		if err != nil {
			return err
		}
		if f.current == nil {
			return notFound(textFormNotFound)
		}
		x, err := r.submit(ctx, f, submission{versionID: new(b.VersionId), answers: b.Answers, linkParams: b.LinkParams,
			subject: b.Subject, channel: channelMember, actor: r.me()})
		if err != nil {
			return err
		}
		if err := r.flushNotices(ctx); err != nil {
			return err
		}
		out, err = r.responseOut(ctx, f, x)
		return err
	})
	return out, err
}

// submit checks and writes a response to the acting version of f (its row taken by the caller), then runs its rules.
func (r *req) submit(ctx context.Context, f *formRow, in submission) (*responseRow, error) {
	if err := r.admissible(ctx, f, in); err != nil {
		return nil, err
	}
	v, err := r.version(ctx, f.id, *f.current)
	if err != nil || v == nil {
		return nil, orMissing(err)
	}
	x, err := r.checkAnswers(ctx, f, v.def, in)
	if err != nil {
		return nil, err
	}
	if x.subject, err = r.subjectOf(ctx, in.subject); err != nil {
		return nil, err
	}
	if f.set.extra.Scoring {
		sc := scoreOf(v.def, answersOf(x.answers), f.set.extra.PassScore)
		x.score = &sc
	}
	if err := r.insertResponse(ctx, f, x, in.dedup); err != nil {
		return nil, err
	}
	if err := r.responded(ctx, f, x); err != nil {
		return nil, err
	}
	return x, r.runRules(ctx, f, x)
}

// admissible checks that f accepts the response in: open, not answered already (one per member), the version the
// respondent saw is acting.
func (r *req) admissible(ctx context.Context, f *formRow, in submission) error {
	if closed, err := r.closedReason(ctx, f); err != nil || closed {
		if err == nil {
			err = conflict(reasonClosed, textClosed)
		}
		return err
	}
	if in.channel == channelMember && f.set.onePerMember {
		if done, err := r.answered(ctx, f); err != nil || done {
			if err == nil {
				err = conflict(reasonAnswered, textAnswered)
			}
			return err
		}
	}
	if in.versionID != nil && *in.versionID != f.versionIDs[*f.current] {
		return conflict(reasonVersion, textVersionMoved)
	}
	return nil
}

// subjectOf is the object of a response the member sees (nil — none; a missing one — 422).
func (r *req) subjectOf(ctx context.Context, ref *fapi.ObjectRef) (*fapi.FormResponseSubject, error) {
	if ref == nil {
		return nil, nil
	}
	label, err := r.objectLabel(ctx, *ref)
	if err != nil {
		return nil, err
	}
	if label == "" {
		return nil, invalid("subject", textObjectGone)
	}
	return &fapi.FormResponseSubject{Ref: *ref, Label: label}, nil
}

// responded publishes the events of a new response: submitted, and accepted for an accepted one.
func (r *req) responded(ctx context.Context, f *formRow, x *responseRow) error {
	payload := map[string]any{keyFormID: f.id, keyResponseID: x.id, keyVersionNumber: x.version, "channel": x.channel}
	if _, err := r.publish(ctx, evSubmitted, aggResponse, x.id, payload); err != nil {
		return store("event", err)
	}
	if x.review != reviewAccepted {
		return nil
	}
	_, err := r.publish(ctx, evAccepted, aggResponse, x.id, map[string]any{keyFormID: f.id, keyResponseID: x.id})
	return store("event", err)
}

// checkAnswers checks the answers of in against d (the visibility and the required questions of the version, pvCheck,
// the hidden questions filled by the link or their defaults, the objects of references, the files) and returns the
// response to write; every violation is a 422.
func (r *req) checkAnswers(ctx context.Context, f *formRow, d def, in submission) (*responseRow, error) {
	given, errs := givenAnswers(d, in.answers)
	keys, linkErrs := linkValues(d, in.linkParams, given)
	errs = append(errs, linkErrs...)
	vals := answers{}
	for _, q := range d.Fields {
		bad, err := r.answerOf(ctx, f, q, given, vals, in)
		if err != nil {
			return nil, err
		}
		if bad != nil {
			errs = append(errs, *bad)
		}
	}
	if len(errs) > 0 {
		return nil, invalidAll(errs, "")
	}
	return r.newResponse(f, d, vals, keys, in.channel), nil
}

// answerOf puts the answer to q into vals: a hidden question takes the link or its default, a question not shown is
// skipped; the violation of the answer otherwise (nil — none).
func (r *req) answerOf(ctx context.Context, f *formRow, q question, given, vals answers, in submission) (*violation, error) {
	if q.Type == fapi.FormQuestionTypeStatement {
		return nil, nil
	}
	if deref(q.Hidden) {
		if v, ok := given[q.Key]; ok {
			vals[q.Key] = v
		} else if dv := deref(q.DefaultValue); dv != "" {
			vals[q.Key] = textValue(dv)
		}
		return nil, nil
	}
	if !shown(q, vals) {
		return nil, nil
	}
	var v *value
	if got, ok := given[q.Key]; ok {
		v = &got
	}
	if m := pvCheck(q, v); m != "" {
		return &violation{q.Key, codeInvalid, m}, nil
	}
	if v == nil || v.Type == vNull {
		return nil, nil
	}
	checked, msg, err := r.checkValue(ctx, f, q, *v, in)
	if err != nil || msg != "" {
		if err != nil {
			return nil, err
		}
		return &violation{q.Key, "not_found", msg}, nil
	}
	vals[q.Key] = checked
	return nil, nil
}

// newResponse is the response of the checked answers vals to d by the channel.
func (r *req) newResponse(f *formRow, d def, vals answers, keys []string, channel string) *responseRow {
	x := &responseRow{id: uuid.New(), form: f.id, version: *f.current, channel: channel, review: reviewAccepted,
		revision: 1, submittedAt: r.now, linkKeys: keys}
	if channel == channelPublic {
		x.review = reviewPending
	} else if r.me() != uuid.Nil {
		x.author = new(r.me())
	}
	for _, q := range d.Fields {
		if v, ok := vals[q.Key]; ok {
			x.answers = append(x.answers, entry{FieldKey: q.Key, Value: v})
		}
	}
	return x
}

// givenAnswers are the answers by key; a key of no question of d or of a hidden one is a violation.
func givenAnswers(d def, in []fapi.FieldEntry) (answers, []violation) {
	given := answers{}
	var errs []violation
	es, err := fromAPI(in)
	if err != nil {
		return given, []violation{{"answers", codeInvalid, textWrongType}}
	}
	for _, e := range es {
		i := slices.IndexFunc(d.Fields, func(q question) bool { return q.Key == e.FieldKey })
		switch {
		case i < 0:
			errs = append(errs, violation{e.FieldKey, "unknown", textNoQuestion})
		case deref(d.Fields[i].Hidden):
			errs = append(errs, violation{e.FieldKey, "hidden", textHidden})
		default:
			given[e.FieldKey] = e.Value
		}
	}
	return given, errs
}

// linkValues puts the parameters of the link into given — only hidden questions, never CRM and file ones, text up to
// 500 characters — and returns their keys.
func linkValues(d def, params *map[string]string, given answers) ([]string, []violation) {
	if params == nil {
		return []string{}, nil
	}
	var errs []violation
	keys := []string{}
	if len(*params) > linkParamsMax {
		return keys, []violation{{"linkParams", codeInvalid, "Не больше 50 параметров ссылки"}}
	}
	names := make([]string, 0, len(*params))
	for k := range *params {
		names = append(names, k)
	}
	slices.Sort(names)
	for _, k := range names {
		val := (*params)[k]
		i := slices.IndexFunc(d.Fields, func(q question) bool { return q.Key == k })
		if i < 0 || !deref(d.Fields[i].Hidden) || crmType(d.Fields[i].Type) || d.Fields[i].Type == fapi.FormQuestionTypePhoto {
			errs = append(errs, violation{"linkParams." + k, "not_hidden", textNotHidden})
			continue
		}
		given[k] = textValue(clip(val, linkValueMax))
		keys = append(keys, k)
	}
	return keys, errs
}

// checkValue checks a reference or a file answer of q and returns it with the label the server sets ("" message — ok).
func (r *req) checkValue(ctx context.Context, f *formRow, q question, v value, in submission) (value, string, error) {
	switch v.Type {
	case vReference:
		ref, _ := v.ref()
		label, err := r.referenceLabel(ctx, q, ref)
		if err != nil || label == "" {
			msg := textObjectGone
			if q.Type == fapi.FormQuestionTypePerson {
				msg = textMemberGone
			}
			return v, msg, err
		}
		v.Label = &label
		return v, "", nil
	case vFiles:
		ok, err := r.filesOf(ctx, f, v.list(), in)
		if err != nil || !ok {
			return v, textFileGone, err
		}
	}
	return v, "", nil
}

// textFileGone is a file of an answer that is not an upload of the respondent to this form (no-reference).
const textFileGone = "Файл не найден"

// referenceLabel is the label of the object of a reference answer of q the respondent may choose ("" — none): an
// active member, a unit of the level, a CRM object he sees.
func (r *req) referenceLabel(ctx context.Context, q question, ref fapi.ObjectRef) (string, error) {
	if q.Type == fapi.FormQuestionTypePerson {
		return r.memberLabel(ctx, ref)
	}
	if q.Type == fapi.FormQuestionTypeUnit {
		return r.unitLabel(ctx, q, ref)
	}
	want, ok := refKinds[deref(q.RefKind)]
	if q.RefKind == nil {
		want, ok = refKinds[fapi.FormQuestionRefKindVehicle]
	}
	if !ok || ref.ModuleKey != want[0] || ref.EntityType != want[1] {
		return "", nil
	}
	return r.objectLabel(ctx, ref)
}

// memberLabel is the name of the active member of ref ("" — none).
func (r *req) memberLabel(ctx context.Context, ref fapi.ObjectRef) (string, error) {
	if ref.ModuleKey != moduleCore || ref.EntityType != entityMember {
		return "", nil
	}
	if _, active, err := r.activeMember(ctx, ref.EntityId); err != nil || !active {
		return "", err
	}
	return r.nameOf(ctx, &ref.EntityId)
}

// unitLabel is the name of the unit of ref of the level of q ("" — none).
func (r *req) unitLabel(ctx context.Context, q question, ref fapi.ObjectRef) (string, error) {
	if ref.ModuleKey != moduleCore || ref.EntityType != entityUnit {
		return "", nil
	}
	units, err := r.units(ctx, q, "")
	if err != nil {
		return "", err
	}
	for _, u := range units {
		if u.Ref.EntityId == ref.EntityId {
			return u.Label, nil
		}
	}
	return "", nil
}

// Kinds of the objects of the answers.
const (
	moduleCore   = "core"
	entityMember = "member"
	entityUnit   = "org_unit"
)

// refKinds are the objects of a question «Объект CRM» by refKind: the module and the entity.
var refKinds = map[fapi.FormQuestionRefKind][2]string{
	fapi.FormQuestionRefKindVehicle: {"fleet", "vehicle"},
	fapi.FormQuestionRefKindTrip:    {"fleet", "trip"},
	fapi.FormQuestionRefKindObject:  {"repairs", "repair_object"},
	fapi.FormQuestionRefKindTask:    {"tasks", "task"},
}

// filesOf reports whether every file of ids is an upload of the respondent to f (the parent forms/form): completed
// for an employee, scanned and ready for a guest. The files are locked for share until the response is written (return
// 2): «Хранить ответы» removing one of them (lockFilesSQL) is waited for, and the purged file is refused.
func (r *req) filesOf(ctx context.Context, f *formRow, ids []string, in submission) (bool, error) {
	uids, ok := parseIDs(ids)
	if !ok {
		return false, nil
	}
	states := []string{"uploaded", "scanning", "ready"}
	if in.channel == channelPublic {
		states = []string{"ready"}
	}
	var n int
	err := r.tx.QueryRow(ctx, `select count(*) from (select id from files.objects where id = any($1) and owner_type = 'forms.form'
		and owner_id = $2 and uploaded_by = $3 and state = any($4) order by id for share) x`, uids, f.id, in.actor, states).Scan(&n)
	return n == len(uids), store("files of a response", err)
}

// parseIDs are the ids of a files answer (false — one is not an id).
func parseIDs(ids []string) ([]uuid.UUID, bool) {
	out := make([]uuid.UUID, 0, len(ids))
	for _, s := range ids {
		id, err := uuid.Parse(s)
		if err != nil {
			return nil, false
		}
		out = append(out, id)
	}
	return out, true
}

// insertResponse writes x with the next number of the organization; a repeated key of deduplication (the nonce of a
// guest) is 410 nonce_used.
func (r *req) insertResponse(ctx context.Context, f *formRow, x *responseRow, dedup string) error {
	raw, err := json.Marshal(x.answers)
	if err != nil {
		return err
	}
	if x.answers == nil {
		raw = []byte("[]")
	}
	var module, typ, label any
	var subject any
	if x.subject != nil {
		module, typ, subject, label = x.subject.Ref.ModuleKey, x.subject.Ref.EntityType, x.subject.Ref.EntityId, x.subject.Label
	}
	var points, maxPts, passed any
	if x.score != nil {
		points, maxPts = x.score.Points, x.score.MaxPoints
		if x.score.Passed != nil {
			passed = *x.score.Passed
		}
	}
	var dk any
	if dedup != "" {
		dk = dedup
	}
	err = r.tx.QueryRow(ctx, `insert into forms.responses (id, form_id, version_number, channel, author_id, subject_module,
		subject_type, subject_id, subject_label, answers, link_param_keys, score_points, score_max, score_passed, review_status,
		dedup_key, revision, submitted_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, 1, $17)
		returning number`, x.id, f.id, x.version, x.channel, x.author, module, typ, subject, label, string(raw), x.linkKeys,
		points, maxPts, passed, x.review, dk, x.submittedAt).Scan(&x.number)
	if err != nil {
		if unique(err) && dedup != "" {
			return problemNonceUsed()
		}
		return store("insert response", err)
	}
	return nil
}

// closedReason reports whether f does not accept responses now: not published (closed or a draft), past «Принимать
// до» (the last day inclusive, Moscow), the limit reached (all versions), the module of the form not active.
func (r *req) closedReason(ctx context.Context, f *formRow) (bool, error) {
	if f.status != statusPublished {
		return true, nil
	}
	if f.set.acceptUntil != nil && r.now.In(moscow).Format(time.DateOnly) > f.set.acceptUntil.Format(time.DateOnly) {
		return true, nil
	}
	if f.set.responseLimit != nil {
		var n int
		if err := r.tx.QueryRow(ctx, `select count(*) from forms.responses where form_id = $1`, f.id).Scan(&n); err != nil {
			return false, store("count responses", err)
		}
		if n >= *f.set.responseLimit {
			return true, nil
		}
	}
	if f.module != nil {
		on, err := r.moduleActive(ctx, *f.module)
		return !on, err
	}
	return false, nil
}

// answered reports whether the member has answered f (any version, Q-W4.00-forms-25).
func (r *req) answered(ctx context.Context, f *formRow) (bool, error) {
	if r.me() == uuid.Nil {
		return false, nil
	}
	var done bool
	err := r.tx.QueryRow(ctx, `select exists (select 1 from forms.responses where form_id = $1 and author_id = $2)`, f.id, r.me()).
		Scan(&done)
	return done, store("answered", err)
}

// units are the units a question «Регион или фирма» offers (by unitLevel) whose name contains q.
func (r *req) units(ctx context.Context, x question, q string) ([]fapi.FormFieldOption, error) {
	rows, err := r.tx.Query(ctx, `select id, name, kind from org.units where archived_at is null order by name, id`)
	if err != nil {
		return nil, store("units", err)
	}
	defer rows.Close()
	level := fapi.FormQuestionUnitLevelAny
	if x.UnitLevel != nil {
		level = *x.UnitLevel
	}
	var out []fapi.FormFieldOption
	for rows.Next() {
		var (
			id         uuid.UUID
			name, kind string
		)
		if err := rows.Scan(&id, &name, &kind); err != nil {
			return nil, store("units", err)
		}
		region := kind == "region"
		if (level == fapi.FormQuestionUnitLevelRegion && !region) || (level == fapi.FormQuestionUnitLevelFirm && region) {
			continue
		}
		if q != "" && !strings.Contains(strings.ToLower(name), strings.ToLower(q)) {
			continue
		}
		hint := "фирма"
		if region {
			hint = "регион"
		}
		out = append(out, fapi.FormFieldOption{Ref: fapi.ObjectRef{ModuleKey: moduleCore, EntityType: entityUnit, EntityId: id},
			Label: name, Hint: new(hint)})
	}
	return out, store("units", rows.Err())
}
