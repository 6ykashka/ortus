package data

import (
	"cmp"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W4.50: shared command helpers of the modules (ETag, If-Match, Tx, Audit, Complete; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W4.50 (DATA-03, contract 0.7.0-stage4 W4.06): the saved views of a dataset — a query spec, never rows. A personal
// view is seen and changed by its author only (another member — 404, as a missing view); a shared view is seen by every
// member who queries the dataset and is published, changed and deleted by its author with data.export or by the owner
// of the organization (others — 403). The fields hidden from the viewer by rights are cut out of the view he gets.

// Texts and limits of the views (the descriptions of the operations; MSW W4.06 msw/data/views.ts).
const (
	textViewNotFound = "Вид не найден."
	textViewName     = "Укажите название вида."
	textViewLong     = "Название вида — не длиннее 120 символов."
	textViewTaken    = "Вид с таким именем уже есть."
	textViewTooMany  = "Не больше 50 личных видов набора."
	personalLimit    = 50
	maxViewName      = 120
	maxViews         = 200 // DatasetViewList.items
	targetView       = "data.saved_view"
	visPersonal      = string(dataapi.DatasetViewVisibilityPersonal)
	visShared        = string(dataapi.DatasetViewVisibilityShared)
	pgUniqueViolated = "23505"
	fieldName        = "name" // the field of the violations of the name of a view
)

// viewRow is a row of data.saved_views with the name of its author.
type viewRow struct {
	ID         uuid.UUID
	Dataset    string
	Name       string
	Visibility string
	Owner      uuid.UUID
	OwnerName  string
	Query      dataapi.DatasetViewQuery
	Revision   int64
	Created    time.Time
	Updated    time.Time
}

const viewSelect = `select v.id, v.dataset_id, v.name, v.visibility, v.owner_id, coalesce(p.full_name, ''), v.query,
       v.revision, v.created_at, v.updated_at
  from data.saved_views v
  left join people.person_profiles p on p.id = v.owner_id`

// viewSeen limits viewSelect to the views of dataset $1 the person $2 sees: his personal ones and the shared ones.
const viewSeen = ` where v.dataset_id = $1 and (v.visibility = 'shared' or v.owner_id = $2)`

func scanView(r pgx.Row) (viewRow, error) {
	var (
		v   viewRow
		raw []byte
	)
	if err := r.Scan(&v.ID, &v.Dataset, &v.Name, &v.Visibility, &v.Owner, &v.OwnerName, &raw, &v.Revision, &v.Created, &v.Updated); err != nil {
		return viewRow{}, err
	}
	if err := json.Unmarshal(raw, &v.Query); err != nil {
		return viewRow{}, fmt.Errorf("data: view %s query: %w", v.ID, err)
	}
	return v, nil
}

// labelOf is the label of the field key of the dataset (the key itself for a field the dataset no longer has).
func labelOf(s Spec, key string) string {
	if i := slices.IndexFunc(s.Fields, func(f Field) bool { return f.Key == key }); i >= 0 {
		return s.Fields[i].Label
	}
	return key
}

// dto is the view as the member of v sees it: the select, filters and sort over fields closed to him (or gone from
// the dataset) are cut out and their labels listed in hiddenFieldLabels, in the order of select, filters, sort.
func (r viewRow) dto(v view) dataapi.DatasetView {
	var hidden []string
	seen := map[string]bool{}
	keep := func(k string) bool {
		if _, ok := v.field(k); ok {
			return true
		}
		if !seen[k] {
			seen[k] = true
			hidden = append(hidden, labelOf(v.spec, k))
		}
		return false
	}
	q := dataapi.DatasetViewQuery{Filters: []dataapi.QueryFilter{}, Sort: []dataapi.QuerySort{}, Search: r.Query.Search}
	if r.Query.Select != nil {
		sel := []string{}
		for _, k := range *r.Query.Select {
			if keep(k) {
				sel = append(sel, k)
			}
		}
		if len(sel) > 0 {
			q.Select = &sel
		}
	}
	for _, f := range r.Query.Filters {
		if keep(f.FieldKey) {
			q.Filters = append(q.Filters, f)
		}
	}
	for _, s := range r.Query.Sort {
		if keep(s.FieldKey) {
			q.Sort = append(q.Sort, s)
		}
	}
	out := dataapi.DatasetView{
		Id: r.ID, DatasetId: r.Dataset, Name: r.Name, Visibility: dataapi.DatasetViewVisibility(r.Visibility),
		OwnerMemberId: r.Owner, OwnerDisplayName: r.OwnerName, Query: q, Revision: r.Revision,
		CreatedAt: r.Created.UTC(), UpdatedAt: r.Updated.UTC(),
	}
	if len(hidden) > 0 {
		out.HiddenFieldLabels = &hidden
	}
	return out
}

// mayShare reports whether the member of tc publishes and changes shared views of v: the owner of the organization or
// a member with data.export (v must be opened withExport).
func mayShare(tc tenantctx.TenantContext, v view) bool { return tc.Owner || v.export }

// nameError is the 422 of the name of a view.
func nameError(code, text string) *fieldError {
	return &fieldError{Detail: text, Field: fieldName, Code: code, Message: text}
}

// viewName is the trimmed name of a view: empty — 422 required, longer than 120 characters — 422 too_long.
func viewName(name string) (string, error) {
	n := strings.TrimSpace(name)
	switch {
	case n == "":
		return "", nameError("required", textViewName)
	case utf8.RuneCountInString(n) > maxViewName:
		return "", nameError("too_long", textViewLong)
	}
	return n, nil
}

// checkViewQuery checks q as queryDataset checks a query of the same select (absent — every visible field), filters,
// search and sort: a hidden or unknown field is the same 422.
func checkViewQuery(v view, q dataapi.DatasetViewQuery, member string) (dataapi.DatasetViewQuery, error) {
	if q.Filters == nil {
		q.Filters = []dataapi.QueryFilter{}
	}
	if q.Sort == nil {
		q.Sort = []dataapi.QuerySort{}
	}
	sel := make([]string, 0, len(v.fields))
	for _, f := range v.fields {
		sel = append(sel, f.Key)
	}
	if q.Select != nil {
		sel = *q.Select
	}
	_, err := parse(v, &dataapi.DatasetQuery{Select: sel, Filters: q.Filters, Search: q.Search, Sort: q.Sort, Limit: 1}, member)
	return q, err
}

// taken maps the unique violation of the names of the views to the 422 «Вид с таким именем уже есть.».
func taken(err error) error {
	if pe, ok := errors.AsType[*pgconn.PgError](err); ok && pe.Code == pgUniqueViolated {
		return nameError("taken", textViewTaken)
	}
	return err
}

// tooMany is the 422 of the 51st personal view of a member in a dataset; the advisory lock serializes the creations of
// one member in one dataset.
func tooMany(ctx context.Context, tx pgx.Tx, owner uuid.UUID, dataset string) error {
	if _, err := tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('data.saved_views:' || $1::text || ':' || $2, 0))`, owner, dataset); err != nil {
		return err
	}
	var n int
	if err := tx.QueryRow(ctx, `select count(*) from data.saved_views where owner_id = $1 and dataset_id = $2 and visibility = 'personal'`,
		owner, dataset).Scan(&n); err != nil {
		return err
	}
	if n >= personalLimit {
		return nameError("too_many", textViewTooMany)
	}
	return nil
}

// Views lists the views of the dataset id the member of tc sees, by name without case (then id).
func (s *Service) Views(ctx context.Context, tc tenantctx.TenantContext, id string) (dataapi.DatasetViewList, error) {
	v, err := s.open(ctx, tc, id, false)
	if err != nil {
		return dataapi.DatasetViewList{}, err
	}
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return dataapi.DatasetViewList{}, dependency(err)
	}
	rows, err := pool.Query(ctx, viewSelect+viewSeen, id, tc.PersonID)
	if err != nil {
		return dataapi.DatasetViewList{}, dependency(fmt.Errorf("data: views: %w", err))
	}
	list, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (viewRow, error) { return scanView(r) })
	if err != nil {
		return dataapi.DatasetViewList{}, dependency(fmt.Errorf("data: views: %w", err))
	}
	slices.SortFunc(list, func(a, b viewRow) int {
		return cmp.Or(strings.Compare(strings.ToLower(a.Name), strings.ToLower(b.Name)), strings.Compare(a.ID.String(), b.ID.String()))
	})
	out := dataapi.DatasetViewList{Items: make([]dataapi.DatasetView, 0, min(len(list), maxViews))}
	for _, r := range list[:min(len(list), maxViews)] {
		out.Items = append(out.Items, r.dto(v))
	}
	return out, nil
}

// CreateView saves a view of the dataset id for the member of tc (createDatasetView).
func (s *Service) CreateView(ctx context.Context, tc tenantctx.TenantContext, id string, b *dataapi.DatasetViewCreate) (dataapi.DatasetView, error) {
	v, err := s.open(ctx, tc, id, true)
	if err != nil {
		return dataapi.DatasetView{}, err
	}
	if b == nil {
		return dataapi.DatasetView{}, malformed("Нет тела вида.")
	}
	vis := visPersonal
	if b.Visibility != nil {
		vis = string(*b.Visibility)
	}
	if vis == visShared && !mayShare(tc, v) {
		return dataapi.DatasetView{}, problem.New(problem.CodeForbiddenAction, "")
	}
	q, err := checkViewQuery(v, b.Query, memberOf(tc))
	if err != nil {
		return dataapi.DatasetView{}, err
	}
	name, err := viewName(b.Name)
	if err != nil {
		return dataapi.DatasetView{}, err
	}
	var body dataapi.DatasetView
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		var err error
		if body, err = insertView(ctx, tx, tc, v, viewRow{Name: name, Visibility: vis, Query: q}, s.now()); err != nil {
			return err
		}
		return kit.Complete(ctx, tx, http.StatusCreated, kit.ETag(body.Revision), body)
	})
	return body, dependency(err)
}

// insertView writes the new view r of the member of tc in tx (the 51st personal view of a member in a dataset and a
// taken name are 422) with its audit row.
func insertView(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, v view, r viewRow, now time.Time) (dataapi.DatasetView, error) {
	if r.Visibility == visPersonal {
		if err := tooMany(ctx, tx, tc.PersonID, v.spec.ID); err != nil {
			return dataapi.DatasetView{}, err
		}
	}
	raw, err := json.Marshal(r.Query)
	if err != nil {
		return dataapi.DatasetView{}, err
	}
	var vid uuid.UUID
	if err := tx.QueryRow(ctx, `insert into data.saved_views (dataset_id, name, visibility, owner_id, query, schema_version, created_at, updated_at)
		values ($1, $2, $3, $4, $5, $6, $7, $7) returning id`, v.spec.ID, r.Name, r.Visibility, tc.PersonID, raw, v.version, now).Scan(&vid); err != nil {
		return dataapi.DatasetView{}, taken(err)
	}
	row, err := scanView(tx.QueryRow(ctx, viewSelect+` where v.id = $1`, vid))
	if err != nil {
		return dataapi.DatasetView{}, err
	}
	return row.dto(v), kit.Audit(ctx, tx, audit.Event{Action: "data.view.created", TargetType: targetView, TargetID: vid,
		Diff: map[string]any{keyDataset: v.spec.ID, "name": r.Name, "visibility": r.Visibility}})
}

// lockView locks the view vid of the dataset of v the member of tc sees and checks that he may change it: a shared view
// — the owner or its author with data.export (else 403); then If-Match against its revision.
func lockView(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, v view, vid uuid.UUID, ifMatch string) (viewRow, error) {
	row, err := scanView(tx.QueryRow(ctx, viewSelect+viewSeen+` and v.id = $3 for update of v`, v.spec.ID, tc.PersonID, vid))
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return viewRow{}, problem.New(problem.CodeNotFound, textViewNotFound)
	case err != nil:
		return viewRow{}, err
	case row.Visibility == visShared && !tc.Owner && (row.Owner != tc.PersonID || !v.export):
		return viewRow{}, problem.New(problem.CodeForbiddenAction, "")
	}
	return row, checkRevision(ifMatch, row.Revision)
}

// UpdateView renames a view, changes its query or its visibility (updateDatasetView).
func (s *Service) UpdateView(ctx context.Context, tc tenantctx.TenantContext, id string, vid uuid.UUID, ifMatch string, p *dataapi.DatasetViewPatch) (dataapi.DatasetView, error) {
	v, err := s.open(ctx, tc, id, true)
	if err != nil {
		return dataapi.DatasetView{}, err
	}
	if p == nil || (p.Name == nil && p.Query == nil && p.Visibility == nil) {
		return dataapi.DatasetView{}, malformed("Нет изменений вида.")
	}
	var body dataapi.DatasetView
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		row, err := lockView(ctx, tx, tc, v, vid, ifMatch)
		if err != nil {
			return err
		}
		next, err := patched(tc, v, row, p)
		if err != nil {
			return err
		}
		if body, err = updateView(ctx, tx, v, row, next, s.now()); err != nil {
			return err
		}
		return kit.Complete(ctx, tx, http.StatusOK, kit.ETag(body.Revision), body)
	})
	return body, dependency(err)
}

// updateView writes next over the locked view row in tx with its audit row: a shared view turned personal counts in
// the 50 personal views of its author; a taken name is 422.
func updateView(ctx context.Context, tx pgx.Tx, v view, row, next viewRow, now time.Time) (dataapi.DatasetView, error) {
	if next.Visibility == visPersonal && row.Visibility != visPersonal {
		if err := tooMany(ctx, tx, row.Owner, v.spec.ID); err != nil {
			return dataapi.DatasetView{}, err
		}
	}
	raw, err := json.Marshal(next.Query)
	if err != nil {
		return dataapi.DatasetView{}, err
	}
	if _, err := tx.Exec(ctx, `update data.saved_views set name = $2, visibility = $3, query = $4, schema_version = $5,
		revision = revision + 1, updated_at = $6 where id = $1`, row.ID, next.Name, next.Visibility, raw, v.version, now); err != nil {
		return dataapi.DatasetView{}, taken(err)
	}
	if row, err = scanView(tx.QueryRow(ctx, viewSelect+` where v.id = $1`, row.ID)); err != nil {
		return dataapi.DatasetView{}, err
	}
	return row.dto(v), kit.Audit(ctx, tx, audit.Event{Action: "data.view.updated", TargetType: targetView, TargetID: row.ID,
		Diff: map[string]any{keyDataset: v.spec.ID, "name": next.Name, "visibility": next.Visibility}})
}

// patched is the view row after p: a personal view becomes shared only with mayShare; the query is checked as on
// creation; the name is trimmed.
func patched(tc tenantctx.TenantContext, v view, row viewRow, p *dataapi.DatasetViewPatch) (viewRow, error) {
	next := row
	if p.Visibility != nil {
		next.Visibility = string(*p.Visibility)
	}
	if next.Visibility == visShared && row.Visibility != visShared && !mayShare(tc, v) {
		return viewRow{}, problem.New(problem.CodeForbiddenAction, "")
	}
	if p.Query != nil {
		q, err := checkViewQuery(v, *p.Query, memberOf(tc))
		if err != nil {
			return viewRow{}, err
		}
		next.Query = q
	}
	if p.Name != nil {
		n, err := viewName(*p.Name)
		if err != nil {
			return viewRow{}, err
		}
		next.Name = n
	}
	return next, nil
}

// DeleteView deletes a view (deleteDatasetView); the export jobs started from it keep their spec (view_id → null).
func (s *Service) DeleteView(ctx context.Context, tc tenantctx.TenantContext, id string, vid uuid.UUID, ifMatch string) error {
	v, err := s.open(ctx, tc, id, true)
	if err != nil {
		return err
	}
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		row, err := lockView(ctx, tx, tc, v, vid, ifMatch)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx, `delete from data.saved_views where id = $1`, vid); err != nil {
			return err
		}
		if err := kit.Audit(ctx, tx, audit.Event{Action: "data.view.deleted", TargetType: targetView, TargetID: vid,
			Diff: map[string]any{keyDataset: id, "name": row.Name, "visibility": row.Visibility}}); err != nil {
			return err
		}
		return kit.Complete(ctx, tx, http.StatusNoContent, "", nil)
	})
	return dependency(err)
}
