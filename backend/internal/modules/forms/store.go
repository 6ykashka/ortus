package forms

import (
	"context"
	"encoding/json"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fapi "github.com/ortus/ortus-crm/backend/internal/api/forms"
)

// formRow is a form (forms.forms) with its draft (forms.drafts) and the numbers of its versions.
type formRow struct {
	id                 uuid.UUID
	name               string
	unit               *uuid.UUID
	module, template   *string
	group              *uuid.UUID
	owner              uuid.UUID
	status             string
	current            *int
	set                settings
	revision           int64
	createdAt, updated time.Time
	draft              def
	draftChanged       bool
	draftRev           int64
	draftSavedAt       *time.Time
	draftSavedBy       *uuid.UUID
	versionIDs         map[int]uuid.UUID // number → id
	latest             int               // the number of the latest version (0 — none)
	publicLink         *uuid.UUID        // the active public link (forms.public_links)
	publicKeyVer       int
	publicDigest       string
	responses, rulesOn int // filled by the operations that show them
}

// Statuses of a form (forms.forms.status).
const (
	statusDraft     = "draft"
	statusPublished = "published"
	statusClosed    = "closed"
)

const formCols = `f.id, f.name, f.org_unit_id, f.module_key, f.template_id, f.group_id, f.owner_id, f.status, f.current_version,
	f.access, f.accept_until, f.response_limit, f.one_per_member, f.retain_days, f.settings, f.revision, f.created_at, f.updated_at,
	d.definition, d.has_changes, d.revision, d.saved_at, d.saved_by,
	coalesce((select jsonb_object_agg(v.number::text, v.id) from forms.versions v where v.form_id = f.id), '{}'),
	l.id, coalesce(l.key_version, 1), coalesce(l.token_digest, '')`

const formFrom = ` from forms.forms f join forms.drafts d on d.form_id = f.id
	left join forms.public_links l on l.form_id = f.id and l.revoked_at is null`

func scanForm(row pgx.Row) (*formRow, error) {
	var (
		f            formRow
		extra, draft []byte
		versions     []byte
		until        *time.Time
		keyVer       int16
	)
	err := row.Scan(&f.id, &f.name, &f.unit, &f.module, &f.template, &f.group, &f.owner, &f.status, &f.current,
		&f.set.access, &until, &f.set.responseLimit, &f.set.onePerMember, &f.set.retainDays, &extra, &f.revision, &f.createdAt,
		&f.updated, &draft, &f.draftChanged, &f.draftRev, &f.draftSavedAt, &f.draftSavedBy, &versions, &f.publicLink, &keyVer,
		&f.publicDigest)
	if err != nil {
		return nil, err
	}
	f.publicKeyVer = int(keyVer)
	if until != nil {
		u := time.Date(until.Year(), until.Month(), until.Day(), 0, 0, 0, 0, time.UTC)
		f.set.acceptUntil = &u
	}
	if err := json.Unmarshal(extra, &f.set.extra); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(draft, &f.draft); err != nil {
		return nil, err
	}
	f.draft = cloneDef(f.draft)
	ids := map[string]uuid.UUID{}
	if err := json.Unmarshal(versions, &ids); err != nil {
		return nil, err
	}
	f.versionIDs = map[int]uuid.UUID{}
	for k, id := range ids {
		var n int
		if err := json.Unmarshal([]byte(k), &n); err != nil {
			return nil, err
		}
		f.versionIDs[n] = id
		f.latest = max(f.latest, n)
	}
	return &f, nil
}

// form reads the form id (nil — none); lock takes its row for the transaction.
func (r *req) form(ctx context.Context, id uuid.UUID, lock bool) (*formRow, error) {
	sql := `select ` + formCols + formFrom + ` where f.id = $1`
	if lock {
		sql += ` for update of f, d`
	}
	f, err := scanForm(r.tx.QueryRow(ctx, sql, id))
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("form", err)
	}
	return f, nil
}

// visibleForm is the form id the member sees (forms.read in its area), 404 «Форма не найдена» otherwise.
func (r *req) visibleForm(ctx context.Context, id uuid.UUID, lock bool) (*formRow, error) {
	f, err := r.form(ctx, id, lock)
	if err != nil {
		return nil, err
	}
	if f == nil {
		return nil, notFound(textFormNotFound)
	}
	ok, err := r.visible(ctx, f)
	if err != nil {
		return nil, err
	}
	if !ok {
		return nil, notFound(textFormNotFound)
	}
	return f, nil
}

// allForms reads every form of the tenant, the latest change first.
func (r *req) allForms(ctx context.Context) ([]*formRow, error) {
	rows, err := r.tx.Query(ctx, `select `+formCols+formFrom+` order by f.updated_at desc, f.id`)
	if err != nil {
		return nil, store("forms", err)
	}
	defer rows.Close()
	var out []*formRow
	for rows.Next() {
		f, err := scanForm(rows)
		if err != nil {
			return nil, store("forms", err)
		}
		out = append(out, f)
	}
	return out, store("forms", rows.Err())
}

// saveForm writes the fields of a form a command changes (the revision and the moment are set by the caller).
func (r *req) saveForm(ctx context.Context, f *formRow) error {
	extra, err := json.Marshal(f.set.extra)
	if err != nil {
		return err
	}
	var until any
	if f.set.acceptUntil != nil {
		until = f.set.acceptUntil.Format(time.DateOnly)
	}
	_, err = r.tx.Exec(ctx, `update forms.forms set name = $2, org_unit_id = $3, group_id = $4, status = $5, current_version = $6,
		access = $7, accept_until = $8::date, response_limit = $9, one_per_member = $10, retain_days = $11, settings = $12::jsonb,
		revision = $13, updated_at = $14 where id = $1`,
		f.id, f.name, f.unit, f.group, f.status, f.current, f.set.access, until, f.set.responseLimit, f.set.onePerMember,
		f.set.retainDays, string(extra), f.revision, f.updated)
	return store("save form", err)
}

// saveDraft writes the draft of f.
func (r *req) saveDraft(ctx context.Context, f *formRow) error {
	b, err := json.Marshal(f.draft)
	if err != nil {
		return err
	}
	_, err = r.tx.Exec(ctx, `update forms.drafts set definition = $2::jsonb, base_version = $3, has_changes = $4, revision = $5,
		saved_at = $6, saved_by = $7 where form_id = $1`, f.id, string(b), f.current, f.draftChanged, f.draftRev, f.draftSavedAt,
		f.draftSavedBy)
	return store("save draft", err)
}

// insertForm writes a new form with its draft.
func (r *req) insertForm(ctx context.Context, f *formRow) error {
	extra, err := json.Marshal(f.set.extra)
	if err != nil {
		return err
	}
	var until any
	if f.set.acceptUntil != nil {
		until = f.set.acceptUntil.Format(time.DateOnly)
	}
	if _, err := r.tx.Exec(ctx, `insert into forms.forms (id, name, org_unit_id, module_key, template_id, group_id, owner_id, status,
		access, accept_until, response_limit, one_per_member, retain_days, settings, revision, created_at, updated_at)
		values ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9::date, $10, $11, $12, $13::jsonb, 1, $14, $14)`,
		f.id, f.name, f.unit, f.module, f.template, f.group, f.owner, f.set.access, until, f.set.responseLimit, f.set.onePerMember,
		f.set.retainDays, string(extra), f.createdAt); err != nil {
		return err // a unique name — the caller answers 422
	}
	b, err := json.Marshal(f.draft)
	if err != nil {
		return err
	}
	_, err = r.tx.Exec(ctx, `insert into forms.drafts (form_id, definition, has_changes, revision, saved_at, saved_by)
		values ($1, $2::jsonb, false, 1, $3, $4)`, f.id, string(b), f.draftSavedAt, f.draftSavedBy)
	return store("insert draft", err)
}

// versionRow is an immutable version (forms.versions).
type versionRow struct {
	id     uuid.UUID
	number int
	def    def
	count  int
	at     time.Time
	by     *uuid.UUID
}

func (r *req) versions(ctx context.Context, form uuid.UUID) ([]versionRow, error) {
	rows, err := r.tx.Query(ctx, `select id, number, definition, question_count, published_at, published_by from forms.versions
		where form_id = $1 order by number desc`, form)
	if err != nil {
		return nil, store("versions", err)
	}
	defer rows.Close()
	var out []versionRow
	for rows.Next() {
		var (
			v   versionRow
			raw []byte
		)
		if err := rows.Scan(&v.id, &v.number, &raw, &v.count, &v.at, &v.by); err != nil {
			return nil, store("versions", err)
		}
		if err := json.Unmarshal(raw, &v.def); err != nil {
			return nil, store("versions", err)
		}
		v.def = cloneDef(v.def)
		out = append(out, v)
	}
	return out, store("versions", rows.Err())
}

// version is the version number of form (nil — none).
func (r *req) version(ctx context.Context, form uuid.UUID, number int) (*versionRow, error) {
	vs, err := r.versions(ctx, form)
	if err != nil {
		return nil, err
	}
	for i := range vs {
		if vs[i].number == number {
			return &vs[i], nil
		}
	}
	return nil, nil
}

// groupRow is a group of forms.
type groupRow struct {
	id   uuid.UUID
	name string
}

func (r *req) groups(ctx context.Context) ([]groupRow, error) {
	rows, err := r.tx.Query(ctx, `select id, name from forms.groups order by lower(name), id`)
	if err != nil {
		return nil, store("groups", err)
	}
	return pgx.CollectRows(rows, func(row pgx.CollectableRow) (groupRow, error) {
		var g groupRow
		return g, row.Scan(&g.id, &g.name)
	})
}

// ruleRow is an action after a response (forms.rules).
type ruleRow struct {
	id                 uuid.UUID
	form               uuid.UUID
	kind               string
	enabled            bool
	version            int
	trigger            string
	condField, condVal *string
	config             ruleConfig
	author             uuid.UUID
	revision           int64
	createdAt, updated time.Time
}

// ruleConfig is forms.rules.config — the object of the kind of the rule.
type ruleConfig struct {
	Task   *fapi.FormRuleTask    `json:"task,omitempty"`
	Notify *fapi.FormRuleNotify  `json:"notify,omitempty"`
	Email  *fapi.FormRuleEmail   `json:"email,omitempty"`
	HTTP   *fapi.FormRuleHttp    `json:"http,omitempty"`
	KB     *fapi.FormRuleKbInput `json:"kb,omitempty"`
}

const ruleCols = `id, form_id, kind, enabled, version, trigger, condition_field, condition_value, config, author_id, revision,
	created_at, updated_at`

func scanRule(row pgx.Row) (*ruleRow, error) {
	var (
		x   ruleRow
		raw []byte
	)
	if err := row.Scan(&x.id, &x.form, &x.kind, &x.enabled, &x.version, &x.trigger, &x.condField, &x.condVal, &raw, &x.author,
		&x.revision, &x.createdAt, &x.updated); err != nil {
		return nil, err
	}
	return &x, json.Unmarshal(raw, &x.config)
}

// rules are the rules of form in the order of creation.
func (r *req) rules(ctx context.Context, form uuid.UUID) ([]*ruleRow, error) {
	rows, err := r.tx.Query(ctx, `select `+ruleCols+` from forms.rules where form_id = $1 order by created_at, id`, form)
	if err != nil {
		return nil, store("rules", err)
	}
	defer rows.Close()
	var out []*ruleRow
	for rows.Next() {
		x, err := scanRule(rows)
		if err != nil {
			return nil, store("rules", err)
		}
		out = append(out, x)
	}
	return out, store("rules", rows.Err())
}

// rule is the rule id of form (nil — none); lock takes its row.
func (r *req) rule(ctx context.Context, form, id uuid.UUID, lock bool) (*ruleRow, error) {
	sql := `select ` + ruleCols + ` from forms.rules where form_id = $1 and id = $2`
	if lock {
		sql += ` for update`
	}
	x, err := scanRule(r.tx.QueryRow(ctx, sql, form, id))
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("rule", err)
	}
	return x, nil
}

// responseRow is a response (forms.responses) with the journal of its actions.
type responseRow struct {
	id          uuid.UUID
	form        uuid.UUID
	number      int
	version     int
	channel     string
	author      *uuid.UUID
	subject     *fapi.FormResponseSubject
	answers     []entry
	linkKeys    []string
	score       *fapi.FormResponseScore
	review      string
	assignee    *uuid.UUID
	comment     *string
	revision    int64
	submittedAt time.Time
	actions     []actionRow
}

// actionRow is a line of the journal of actions of a response (forms.response_actions).
type actionRow struct {
	rule    uuid.UUID
	version int
	kind    string
	ok      bool
	at      time.Time
	text    *string
	err     *string
	node    *uuid.UUID
	task    *uuid.UUID
}

const responseCols = `x.id, x.form_id, x.number, x.version_number, x.channel, x.author_id, x.subject_module, x.subject_type,
	x.subject_id, x.subject_label, x.answers, x.link_param_keys, x.score_points, x.score_max, x.score_passed, x.review_status,
	x.assignee_id, x.review_comment, x.revision, x.submitted_at`

func scanResponse(row pgx.Row) (*responseRow, error) {
	var (
		x                  responseRow
		module, typ, label *string
		subject            *uuid.UUID
		raw                []byte
		points, maxPts     *int
		passed             *bool
	)
	if err := row.Scan(&x.id, &x.form, &x.number, &x.version, &x.channel, &x.author, &module, &typ, &subject, &label, &raw,
		&x.linkKeys, &points, &maxPts, &passed, &x.review, &x.assignee, &x.comment, &x.revision, &x.submittedAt); err != nil {
		return nil, err
	}
	if subject != nil {
		x.subject = &fapi.FormResponseSubject{Ref: fapi.ObjectRef{ModuleKey: deref(module), EntityType: deref(typ), EntityId: *subject},
			Label: deref(label)}
	}
	if points != nil && maxPts != nil {
		x.score = &fapi.FormResponseScore{Points: *points, MaxPoints: *maxPts, Passed: passed}
	}
	return &x, json.Unmarshal(raw, &x.answers)
}

// responses are the responses of form, the latest first, with their journals.
func (r *req) responses(ctx context.Context, form uuid.UUID) ([]*responseRow, error) {
	return r.responsesWhere(ctx, `x.form_id = $1`, form)
}

func (r *req) responsesWhere(ctx context.Context, where string, args ...any) ([]*responseRow, error) {
	rows, err := r.tx.Query(ctx, `select `+responseCols+` from forms.responses x where `+where+
		` order by x.submitted_at desc, x.number desc`, args...)
	if err != nil {
		return nil, store("responses", err)
	}
	var out []*responseRow
	byID := map[uuid.UUID]*responseRow{}
	for rows.Next() {
		x, err := scanResponse(rows)
		if err != nil {
			rows.Close()
			return nil, store("responses", err)
		}
		out = append(out, x)
		byID[x.id] = x
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, store("responses", err)
	}
	if len(out) == 0 {
		return out, nil
	}
	ids := make([]uuid.UUID, 0, len(out))
	for _, x := range out {
		ids = append(ids, x.id)
	}
	return out, r.journals(ctx, ids, byID)
}

// journals reads the journals of the responses ids into byID.
func (r *req) journals(ctx context.Context, ids []uuid.UUID, byID map[uuid.UUID]*responseRow) error {
	rows, err := r.tx.Query(ctx, `select response_id, rule_id, rule_version, kind, ok, at, text, error, kb_node_id, task_id
		from forms.response_actions where response_id = any($1) order by at, rule_id`, ids)
	if err != nil {
		return store("journal", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id uuid.UUID
			a  actionRow
		)
		if err := rows.Scan(&id, &a.rule, &a.version, &a.kind, &a.ok, &a.at, &a.text, &a.err, &a.node, &a.task); err != nil {
			return store("journal", err)
		}
		if x := byID[id]; x != nil {
			x.actions = append(x.actions, a)
		}
	}
	return store("journal", rows.Err())
}

// response is the response id of form (nil — none); lock takes its row.
func (r *req) response(ctx context.Context, form, id uuid.UUID, lock bool) (*responseRow, error) {
	sql := `select ` + responseCols + ` from forms.responses x where x.form_id = $1 and x.id = $2`
	if lock {
		sql += ` for update`
	}
	x, err := scanResponse(r.tx.QueryRow(ctx, sql, form, id))
	switch {
	case noRows(err):
		return nil, nil
	case err != nil:
		return nil, store("response", err)
	}
	return x, r.journals(ctx, []uuid.UUID{x.id}, map[uuid.UUID]*responseRow{x.id: x})
}
