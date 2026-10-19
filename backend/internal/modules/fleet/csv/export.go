package csv

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"
	"unicode"

	"github.com/jackc/pgx/v5"

	dataapi "github.com/ortus/ortus-crm/backend/internal/api/data"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.50: shared command helpers of the modules (Tx, Audit; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Limits of an export (DatasetExport.rowLimit; the page of queryDataset, its limit 1…200).
const (
	RowLimit  = 10000
	pageLimit = 200
)

// actionExport is the permission of «Выгрузить».
const actionExport = "data.export"

// contentType is DatasetExport.contentType.
const contentType = dataapi.DatasetExportContentType("text/csv; charset=utf-8")

// defaultZone is the time zone of an organisation whose units give none (the pilot is in Moscow).
const defaultZone = "Europe/Moscow"

// Datasets is what the export reads of the tag Data (data.Server of W2.08).
type Datasets interface {
	ListDatasets(ctx context.Context, r dataapi.ListDatasetsRequestObject) (dataapi.ListDatasetsResponseObject, error)
	QueryDataset(ctx context.Context, r dataapi.QueryDatasetRequestObject) (dataapi.QueryDatasetResponseObject, error)
}

// Export is the CSV export of the datasets of a tenant (exportDataset): the catalog says whether the member may export
// the dataset and gives the labels, types and options of its fields; the rows are read by pages of queryDataset of a
// server whose evaluator narrows the scope of the dataset permission by data.export (ExportScope).
type Export struct {
	Catalog Datasets  // the server of the tag Data
	Rows    Datasets  // the same server over ExportScope
	Pools   kit.Pools // the audit row data.exported and the time zone; nil — neither (tests)
	// Zone is the time zone of the dates of the file and of its name; nil — the zone of the home unit of the member
	// (fleet units carry the zone of their region), else Europe/Moscow.
	Zone func(ctx context.Context, tc tenantctx.TenantContext) (*time.Location, error)
	Now  func() time.Time // the clock of the application; nil: time.Now
}

func (x *Export) now() time.Time {
	if x.Now != nil {
		return x.Now().UTC()
	}
	return time.Now().UTC()
}

// DataServer overlays exportDataset on a strict server of the tag Data; the other operations go to the base.
type DataServer struct {
	dataapi.StrictServerInterface
	Export *Export
}

// NewDataServer returns the overlay of the export on base.
func NewDataServer(base dataapi.StrictServerInterface, x *Export) DataServer {
	return DataServer{StrictServerInterface: base, Export: x}
}

// ExportDataset implements dataapi.StrictServerInterface: the visible rows of the dataset as the CSV of the contract.
// A dataset the member may not read or that does not exist answers as queryDataset (403, 404); a dataset without
// export — 403; a hidden or unknown field — the 422 of queryDataset.
func (h DataServer) ExportDataset(ctx context.Context, req dataapi.ExportDatasetRequestObject) (dataapi.ExportDatasetResponseObject, error) {
	x := h.Export
	tc, ok := tenantctx.FromContext(ctx)
	if !ok {
		return nil, problem.New(problem.CodeNotFound, "")
	}
	if req.Body == nil {
		return nil, problem.New(problem.CodeMalformedRequest, "")
	}
	ds, err := x.dataset(ctx, req.DatasetId, req.Body)
	if err != nil {
		return nil, err
	}
	rows, truncated, invalid, err := x.rows(ctx, req.DatasetId, req.Body)
	if invalid != nil {
		return dataapi.ExportDataset422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: invalid.ValidationApplicationProblemPlusJSONResponse}, nil
	}
	if err != nil {
		return nil, err
	}
	loc, err := x.zone(ctx, tc)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	content, err := file(ds, req.Body.Select, rows, loc)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	now := x.now()
	if err := x.audit(ctx, tc, ds.Id, req.Body, len(rows), truncated); err != nil {
		return nil, err
	}
	cache, rid := kit.NoStore, requestid.FromContext(ctx)
	return dataapi.ExportDataset200JSONResponse{
		Body: dataapi.DatasetExport{
			DatasetId: ds.Id, FileName: ds.Name + "-" + now.In(loc).Format(time.DateOnly) + ".csv", ContentType: contentType,
			Content: content, RowCount: int64(len(rows)), RowLimit: RowLimit, Truncated: truncated, GeneratedAt: now,
		},
		Headers: dataapi.ExportDataset200ResponseHeaders{CacheControl: &cache, XRequestId: &rid},
	}, nil
}

// dataset returns the dataset id of the catalog of the member when it may be exported. A dataset outside the catalog
// is answered by queryDataset itself (404 of an unknown dataset or a closed module, 403 without its permission).
func (x *Export) dataset(ctx context.Context, id string, b *dataapi.DatasetExportCreate) (dataapi.Dataset, error) {
	res, err := x.Catalog.ListDatasets(ctx, dataapi.ListDatasetsRequestObject{})
	if err != nil {
		return dataapi.Dataset{}, err
	}
	cat, ok := res.(dataapi.ListDatasets200JSONResponse)
	if !ok {
		return dataapi.Dataset{}, problem.New(problem.CodeDependencyUnavailable, "")
	}
	for _, ds := range cat.Body.Items {
		if ds.Id != id {
			continue
		}
		if ds.ExportAllowed == nil || !*ds.ExportAllowed {
			return dataapi.Dataset{}, problem.New(problem.CodeForbiddenAction, "")
		}
		return ds, nil
	}
	if _, err := x.Catalog.QueryDataset(ctx, dataapi.QueryDatasetRequestObject{DatasetId: id, Body: &dataapi.DatasetQuery{
		Select: b.Select, Filters: []dataapi.QueryFilter{}, Sort: []dataapi.QuerySort{}, Limit: 1,
	}}); err != nil {
		return dataapi.Dataset{}, err
	}
	return dataapi.Dataset{}, problem.New(problem.CodeNotFound, "")
}

// rows reads up to RowLimit rows by pages of queryDataset; truncated — more rows match. A 422 of the query is returned
// as it is.
func (x *Export) rows(ctx context.Context, id string, b *dataapi.DatasetExportCreate) ([]dataapi.DatasetRow, bool, *dataapi.QueryDataset422ApplicationProblemPlusJSONResponse, error) {
	q := dataapi.DatasetQuery{Select: b.Select, Filters: b.Filters, Search: b.Search, Sort: b.Sort, Limit: pageLimit}
	if q.Filters == nil {
		q.Filters = []dataapi.QueryFilter{}
	}
	if q.Sort == nil {
		q.Sort = []dataapi.QuerySort{}
	}
	var out []dataapi.DatasetRow
	for {
		page := q
		res, err := x.Rows.QueryDataset(ctx, dataapi.QueryDatasetRequestObject{DatasetId: id, Body: &page})
		if err != nil {
			return nil, false, nil, err
		}
		switch r := res.(type) {
		case dataapi.QueryDataset422ApplicationProblemPlusJSONResponse:
			return nil, false, &r, nil
		case dataapi.QueryDataset200JSONResponse:
			out = append(out, r.Body.Rows...)
			if len(out) >= RowLimit {
				return out[:RowLimit], len(out) > RowLimit || r.Body.NextCursor != nil, nil, nil
			}
			if r.Body.NextCursor == nil {
				return out, false, nil, nil
			}
			q.Cursor = r.Body.NextCursor
		default:
			return nil, false, nil, problem.New(problem.CodeDependencyUnavailable, "")
		}
	}
}

// zone is the time zone of the file.
func (x *Export) zone(ctx context.Context, tc tenantctx.TenantContext) (*time.Location, error) {
	if x.Zone != nil {
		return x.Zone(ctx, tc)
	}
	name := defaultZone
	if x.Pools != nil {
		pool, err := x.Pools.For(ctx, tc.TenantID)
		if err != nil {
			return nil, err
		}
		err = pool.QueryRow(ctx, `select coalesce(
			(select u.time_zone from people.person_profiles p join org.units u on u.id = p.home_unit_id where p.id = $1),
			(select u.time_zone from org.units u where u.parent_id is null and u.archived_at is null order by u.name, u.id limit 1),
			$2)`, tc.PersonID, defaultZone).Scan(&name)
		if err != nil {
			return nil, err
		}
	}
	loc, err := time.LoadLocation(name)
	if err != nil {
		return time.LoadLocation(defaultZone)
	}
	return loc, nil
}

// audit writes data.exported: the dataset, the columns, the filters, the search and the number of rows — never the
// content (the description of exportDataset).
func (x *Export) audit(ctx context.Context, tc tenantctx.TenantContext, id string, b *dataapi.DatasetExportCreate, n int, truncated bool) error {
	if x.Pools == nil {
		return nil
	}
	diff := map[string]any{"datasetId": id, "select": b.Select, "filters": len(b.Filters), "rowCount": n, "truncated": truncated}
	if b.Search != nil && strings.TrimSpace(*b.Search) != "" {
		diff["search"] = true
	}
	return kit.Tx(ctx, x.Pools, tc.TenantID, func(tx pgx.Tx) error {
		return kit.Audit(ctx, tx, audit.Event{Action: "data.exported", TargetType: "data.dataset", Diff: diff})
	})
}

// file is the CSV of the contract: a header row of the labels of select, a row per dataset row; «;», CRLF.
func file(ds dataapi.Dataset, sel []string, rows []dataapi.DatasetRow, loc *time.Location) (string, error) {
	fields := make(map[string]dataapi.FieldDescriptor, len(ds.Fields))
	for _, f := range ds.Fields {
		fields[f.Key] = f
	}
	var b strings.Builder
	head := make([]string, len(sel))
	for i, k := range sel {
		label := k
		if f, ok := fields[k]; ok {
			label = f.Label
		}
		head[i] = quote(guard(label))
	}
	b.WriteString(strings.Join(head, ";") + "\r\n")
	line := make([]string, len(sel))
	for _, r := range rows {
		cells := make(map[string]dataapi.FieldValue, len(r.Cells))
		for _, c := range r.Cells {
			cells[c.FieldKey] = c.Value
		}
		for i, k := range sel {
			v, ok := cells[k]
			if !ok {
				line[i] = ""
				continue
			}
			s, err := cellText(fields[k], v, loc)
			if err != nil {
				return "", fmt.Errorf("cell %s of %s: %w", k, r.RecordId, err)
			}
			line[i] = s
		}
		b.WriteString(strings.Join(line, ";") + "\r\n")
	}
	return b.String(), nil
}

// cellText is the text of a cell of the file: labels of choices, rubles and decimals with a decimal comma, dates
// ДД.ММ.ГГГГ and instants ДД.ММ.ГГГГ ЧЧ:ММ in loc, «Да» / «Нет», an empty cell for null; text cells (text, choices,
// references, files) against formula injection; RFC 4180 quotes.
func cellText(f dataapi.FieldDescriptor, v dataapi.FieldValue, loc *time.Location) (string, error) {
	kind, err := v.Discriminator()
	if err != nil {
		return "", err
	}
	out, plain, err := plainText(kind, v, loc)
	if err != nil {
		return "", err
	}
	if !plain {
		if out, err = textOf(kind, f, v); err != nil {
			return "", err
		}
		out = guard(out)
	}
	return quote(out), nil
}

// plainText is the text of a cell that is never a formula: null, money, a decimal, a date, an instant, a flag; plain
// is false for the other kinds.
func plainText(kind string, v dataapi.FieldValue, loc *time.Location) (out string, plain bool, err error) {
	switch kind {
	case "null":
		return "", true, nil
	case "money":
		m, err := v.AsMoneyValue()
		if err != nil {
			return "", false, err
		}
		out = rubles(m.Value.AmountMinor)
	case "decimal":
		d, err := v.AsDecimalValue()
		if err != nil {
			return "", false, err
		}
		out = strings.Replace(d.Value, ".", ",", 1)
	case "date":
		d, err := v.AsDateValue()
		if err != nil {
			return "", false, err
		}
		out = d.Value.Format("02.01.2006")
	case "instant":
		d, err := v.AsInstantValue()
		if err != nil {
			return "", false, err
		}
		out = d.Value.In(loc).Format("02.01.2006 15:04")
	case "boolean":
		d, err := v.AsBooleanValue()
		if err != nil {
			return "", false, err
		}
		out = map[bool]string{true: "Да", false: "Нет"}[d.Value]
	default:
		return "", false, nil
	}
	return out, true, nil
}

// textOf is the text of a text, choices, reference or files cell.
func textOf(kind string, f dataapi.FieldDescriptor, v dataapi.FieldValue) (string, error) {
	switch kind {
	case "choices":
		c, err := v.AsChoicesValue()
		if err != nil {
			return "", err
		}
		labels := make([]string, 0, len(c.Value))
		for _, code := range c.Value {
			labels = append(labels, optionLabel(f, code))
		}
		return strings.Join(labels, ", "), nil
	case "reference":
		r, err := v.AsReferenceValue()
		if err != nil {
			return "", err
		}
		return r.Value.EntityId.String(), nil
	case "files":
		fs, err := v.AsFilesValue()
		if err != nil {
			return "", err
		}
		ids := make([]string, 0, len(fs.Value))
		for _, id := range fs.Value {
			ids = append(ids, id.String())
		}
		return strings.Join(ids, ", "), nil
	case "text":
		t, err := v.AsTextValue()
		return t.Value, err
	}
	return "", errors.New("csv: value type " + kind)
}

func optionLabel(f dataapi.FieldDescriptor, code string) string {
	if f.Options != nil {
		for _, o := range *f.Options {
			if o.Key == code {
				return o.Label
			}
		}
	}
	return code
}

// rubles is an amount in kopecks as rubles with a decimal comma: 123450 → «1234,50», -5 → «-0,05».
func rubles(minor int) string {
	sign := ""
	if minor < 0 {
		sign, minor = "-", -minor
	}
	return sign + strconv.Itoa(minor/100) + "," + fmt.Sprintf("%02d", minor%100)
}

// guard prefixes a text cell that a spreadsheet would read as a formula (=, +, -, @ also after leading whitespace,
// a tab or a carriage return) with an apostrophe (CSV formula injection, OWASP; Q-W2.52-18).
func guard(s string) string {
	if strings.HasPrefix(s, "\t") || strings.HasPrefix(s, "\r") {
		return "'" + s
	}
	if t := strings.TrimLeftFunc(s, unicode.IsSpace); t != "" && strings.ContainsRune("=+-@", rune(t[0])) {
		return "'" + s
	}
	return s
}

// quote encloses a cell with «;», a quote or a line break in quotes (RFC 4180).
func quote(s string) string {
	if strings.ContainsAny(s, ";\"\r\n") {
		return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
	}
	return s
}

// ExportScope narrows the scope of every action of a scoper by the scope of data.export over the unit column of the
// same rows: the rows of an export are those of the dataset permission AND of data.export (the description of
// exportDataset). data.export itself is passed as it is.
type ExportScope struct{ Scoper scopeddb.Scoper }

// sqlTrue and sqlFalse are the constant predicates of the evaluator.
const (
	sqlTrue  = "true"
	sqlFalse = "false"
)

// ScopeQuery implements scopeddb.Scoper.
func (s ExportScope) ScopeQuery(ctx context.Context, tc tenantctx.TenantContext, action string, c authz.Columns, start int) (authz.Predicate, error) {
	p, err := s.Scoper.ScopeQuery(ctx, tc, action, c, start)
	if err != nil || action == actionExport || p.SQL == sqlFalse {
		return p, err
	}
	e, err := s.Scoper.ScopeQuery(ctx, tc, actionExport, authz.Columns{Unit: c.Unit}, start+len(p.Args))
	switch {
	case err != nil:
		return authz.Predicate{}, err
	case e.SQL == sqlFalse:
		return e, nil
	case e.SQL == sqlTrue:
		return p, nil
	case p.SQL == sqlTrue:
		// The arguments of e are numbered after those of p, and p has none.
		return e, nil
	}
	return authz.Predicate{SQL: "((" + p.SQL + ") and (" + e.SQL + "))", Args: append(append([]any{}, p.Args...), e.Args...)}, nil
}
