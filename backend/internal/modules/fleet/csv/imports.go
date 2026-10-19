package csv

import (
	"context"
	"crypto/sha256"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.50: shared command helpers of the modules (ETag, Tx, Audit, Complete; Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Audit target types.
const (
	targetImport  = "fleet.vehicle_import"
	targetVehicle = "fleet.vehicle" // vehicles.TargetVehicle (W2.02)
)

// Texts of the answers (MSW W2.52 fleet/imports.ts, example getVehicleImport/not_found).
const (
	textNotFound   = "Импорт не найден."
	textFileName   = "Укажите имя файла (до 255 символов)."
	textHasErrors  = "В файле есть строки с ошибками: исправьте их или пропустите."
	textPlateTaken = "Машину с этим госномером только что добавили в автопарк. Загрузите файл заново."
)

// importColumnsScope are the columns the scope predicate filters imports on: the default company of the import.
var importColumnsScope = authz.Columns{Unit: "i.default_unit_id"}

// vehicleColumns are the columns of fleet.vehicles for the scope of fleet.vehicles.manage (vehicles.Columns).
var vehicleColumns = authz.Columns{Unit: "v.unit_id"}

// Imports is the CSV import of vehicles of a tenant (createVehicleImport, getVehicleImport, commitVehicleImport).
type Imports struct {
	Pools kit.Pools
	Authz kit.Authorizer
	Now   func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

func (s *Imports) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// within is the evaluator of a command over its own transaction (W1.47): the checks read the grants, the modules and
// the unit tree through tx, with the clock frozen at the start of the command. Another Authorizer (a test double) is
// used as it is.
func (s *Imports) within(tx pgx.Tx, at time.Time) kit.Authorizer {
	ev, ok := s.Authz.(*authz.Evaluator)
	if !ok || ev == nil {
		return s.Authz
	}
	cp := *ev
	src := authz.TxSource{Q: tx}
	cp.Now = func() time.Time { return at }
	cp.Source = src
	if ev.Units != nil {
		cp.Units = src
	}
	return &cp
}

// Server overlays the import operations on a strict server of the tag Fleet; the other operations go to the base.
type Server struct {
	fleetapi.StrictServerInterface
	Imports *Imports
}

// NewServer returns the overlay of the import on base.
func NewServer(base fleetapi.StrictServerInterface, imp *Imports) Server {
	return Server{StrictServerInterface: base, Imports: imp}
}

// fieldsError is a 422 with violations: of the header of the file, of the default company, of the rows of a commit.
type fieldsError struct {
	Detail     string
	Violations []violation
}

func (e *fieldsError) Error() string { return codeValidation + ": " + e.Detail }

// asFields returns the 422 with violations err carries.
func asFields(err error) (*fieldsError, bool) {
	if he, ok := errors.AsType[*headerError](err); ok {
		return &fieldsError{Detail: he.Detail, Violations: []violation{he.Violation}}, true
	}
	return errors.AsType[*fieldsError](err)
}

// problemOf is the Problem body of a 422 with violations.
func problemOf(ctx context.Context, e *fieldsError) fleetapi.ValidationApplicationProblemPlusJSONResponse {
	p := catalog.Problems[codeValidation]
	rid, detail := requestid.FromContext(ctx), e.Detail
	vs := make([]fleetapi.ProblemViolation, 0, len(e.Violations))
	for _, v := range e.Violations {
		vs = append(vs, fleetapi.ProblemViolation{Field: v.Field, Code: v.Code, Message: v.Message})
	}
	return fleetapi.ValidationApplicationProblemPlusJSONResponse{
		Body: fleetapi.Problem{
			Type: problem.TypeBase + codeValidation, Title: p.Title, Status: int64(p.Status),
			Code: fleetapi.ProblemCode(codeValidation), Detail: &detail, RequestId: rid, Violations: &vs,
		},
		Headers: fleetapi.ValidationResponseHeaders{XRequestId: &rid},
	}
}

// dbError keeps Problem errors and violations and hides everything else behind dependency_unavailable.
func dbError(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := asFields(err); ok {
		return err
	}
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

func rid(ctx context.Context) *string {
	id := requestid.FromContext(ctx)
	return &id
}

func noStore() *string {
	v := kit.NoStore
	return &v
}

// unknownDefault is the 422 of a default company that does not exist or that the actor cannot see.
func unknownDefault() error {
	return &fieldsError{Detail: textUnknownUnit, Violations: []violation{
		{Field: "defaultOrgUnitId", Code: "unknown", Message: "Подразделение не найдено"},
	}}
}

// defaultUnit checks the default company of an import: an unknown company and a company the actor cannot see are the
// same 422; a visible company without fleet.vehicles.manage is 403; an archived company is 422.
func defaultUnit(ctx context.Context, az kit.Authorizer, tc tenantctx.TenantContext, q querier, id uuid.UUID) error {
	var archived bool
	err := q.QueryRow(ctx, `select archived_at is not null from org.units where id = $1`, id).Scan(&archived)
	if errors.Is(err, pgx.ErrNoRows) {
		return unknownDefault()
	}
	if err != nil {
		return err
	}
	err = az.Permit(ctx, tc, actionManage, authz.Resource{Unit: id, ReadAction: actionUnitsRead})
	switch {
	case problem.Is(err, problem.CodeNotFound):
		return unknownDefault()
	case err != nil:
		return err
	case archived:
		return &fieldsError{Detail: "Подразделение в архиве.", Violations: []violation{
			{Field: "defaultOrgUnitId", Code: "archived", Message: "Подразделение в архиве"},
		}}
	}
	return nil
}

// CreateVehicleImport implements fleetapi.StrictServerInterface: parses the CSV and returns the row-by-row preview.
func (h Server) CreateVehicleImport(ctx context.Context, req fleetapi.CreateVehicleImportRequestObject) (fleetapi.CreateVehicleImportResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	body, err := h.Imports.create(ctx, req)
	if fe, ok := asFields(err); ok {
		return fleetapi.CreateVehicleImport422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: problemOf(ctx, fe)}, nil
	}
	if err != nil {
		return nil, err
	}
	tag, replayed := kit.ETag(body.Revision), false
	return fleetapi.CreateVehicleImport201JSONResponse{
		Body: body,
		Headers: fleetapi.CreateVehicleImport201ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}

func (s *Imports) create(ctx context.Context, req fleetapi.CreateVehicleImportRequestObject) (fleetapi.VehicleImport, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return fleetapi.VehicleImport{}, err
	}
	if req.Body == nil {
		return fleetapi.VehicleImport{}, problem.New(problem.CodeMalformedRequest, "")
	}
	name := strings.TrimSpace(req.Body.FileName)
	if name == "" || utf8.RuneCountInString(name) > 255 {
		return fleetapi.VehicleImport{}, kit.Invalid(textFileName)
	}
	if len(req.Body.Csv) > MaxBytes {
		return fleetapi.VehicleImport{}, tooLarge()
	}
	now := s.now()
	sum := sha256.Sum256([]byte(req.Body.Csv))
	h := importHeader{
		ID: uuid.New(), State: string(fleetapi.VehicleImportStatePreviewed), FileName: name,
		DefaultUnit: req.Body.DefaultOrgUnitId, CreatedAt: now, ExpiresAt: now.Add(PreviewTTL), Revision: 1,
	}
	var body fleetapi.VehicleImport
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		az := s.within(tx, now)
		if err := defaultUnit(ctx, az, tc, tx, h.DefaultUnit); err != nil {
			return err
		}
		recs, err := parse(req.Body.Csv)
		if err != nil {
			return err
		}
		rows, err := newChecker(tc, az, tx, h.DefaultUnit).checkAll(ctx, recs)
		if err != nil {
			return err
		}
		if err := purge(ctx, tx, now); err != nil {
			return err
		}
		h.Totals = totals(rows)
		if err := insertImport(ctx, tx, h, sum[:], tc.PersonID, rows); err != nil {
			return err
		}
		if err := kit.Audit(ctx, tx, audit.Event{
			Action: "fleet.vehicle_import.create", TargetType: targetImport, TargetID: h.ID, UnitID: h.DefaultUnit,
			Diff: map[string]any{"fileName": name, "totals": h.Totals},
		}); err != nil {
			return err
		}
		body = h.dto(rowsDTO(rows), now)
		return kit.Complete(ctx, tx, http.StatusCreated, kit.ETag(h.Revision), body)
	})
	return body, dbError(err)
}

// visible reads the header of an import in the scope of fleet.vehicles.manage over its default company: another
// import is 404, as a missing one.
func visible(ctx context.Context, c *scopeddb.Conn, id uuid.UUID) (importHeader, error) {
	var h importHeader
	err := c.One(ctx, actionManage, importColumnsScope, func(r pgx.Row) error {
		var err error
		h, err = scanHeader(r)
		return err
	}, headerSelect+` where i.id = $1 and {{scope}}`, id)
	if problem.Is(err, problem.CodeNotFound) {
		return importHeader{}, problem.New(problem.CodeNotFound, textNotFound)
	}
	return h, err
}

// GetVehicleImport implements fleetapi.StrictServerInterface: an import whose default company is in the scope of
// fleet.vehicles.manage of the actor, else 404; the vehicle and the company of a row outside that scope are not shown.
func (h Server) GetVehicleImport(ctx context.Context, req fleetapi.GetVehicleImportRequestObject) (fleetapi.GetVehicleImportResponseObject, error) {
	s := h.Imports
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	c, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	hd, err := visible(ctx, c, req.ImportId)
	if err != nil {
		return nil, dbError(err)
	}
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return nil, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	all, err := loadStored(ctx, pool, hd.ID)
	if err != nil {
		return nil, dbError(err)
	}
	if err := hideOthers(ctx, c, newChecker(tc, s.Authz, pool, hd.DefaultUnit), all); err != nil {
		return nil, dbError(err)
	}
	rows := make([]fleetapi.VehicleImportRow, 0, len(all))
	for _, st := range all {
		rows = append(rows, st.row())
	}
	tag := kit.ETag(hd.Revision)
	return fleetapi.GetVehicleImport200JSONResponse{
		Body:    hd.dto(rows, s.now()),
		Headers: fleetapi.GetVehicleImport200ResponseHeaders{CacheControl: noStore(), ETag: &tag, XRequestId: rid(ctx)},
	}, nil
}

// hideOthers removes the vehicle of the rows whose vehicle is outside fleet.vehicles.manage of the actor and the
// company of the rows whose company is.
func hideOthers(ctx context.Context, c *scopeddb.Conn, k *checker, rows []stored) error {
	var ids []uuid.UUID
	for _, r := range rows {
		if r.Vehicle != nil {
			ids = append(ids, *r.Vehicle)
		}
	}
	mine := map[uuid.UUID]bool{}
	if len(ids) > 0 {
		res, err := c.Query(ctx, actionManage, vehicleColumns, `select v.id from fleet.vehicles v where v.id = any($1) and {{scope}}`, ids)
		if err != nil {
			return err
		}
		got, err := pgx.CollectRows(res, pgx.RowTo[uuid.UUID])
		if err != nil {
			return err
		}
		for _, id := range got {
			mine[id] = true
		}
	}
	for i := range rows {
		if rows[i].Vehicle != nil && !mine[*rows[i].Vehicle] {
			rows[i].Vehicle = nil
		}
		if u := rows[i].Data.Unit; u != nil {
			ok, err := k.manages(ctx, *u)
			if err != nil {
				return err
			}
			if !ok {
				rows[i].Data.Unit = nil
			}
		}
	}
	return nil
}

// CommitVehicleImport implements fleetapi.StrictServerInterface: applies a preview by If-Match in one transaction
// after checking every row again. Rows with errors are skipped only with skipInvalidRows (else 422); a committed or
// expired import is 409.
func (h Server) CommitVehicleImport(ctx context.Context, req fleetapi.CommitVehicleImportRequestObject) (fleetapi.CommitVehicleImportResponseObject, error) { //nolint:dupl // one method per operation of the strict server: the types differ
	body, err := h.Imports.commit(ctx, req)
	if fe, ok := asFields(err); ok {
		return fleetapi.CommitVehicleImport422ApplicationProblemPlusJSONResponse{ValidationApplicationProblemPlusJSONResponse: problemOf(ctx, fe)}, nil
	}
	if err != nil {
		return nil, err
	}
	// The vehicles and the companies of the rows are within the scope of the actor by the checks of the commit.
	tag, replayed := kit.ETag(body.Revision), false
	return fleetapi.CommitVehicleImport200JSONResponse{
		Body: body,
		Headers: fleetapi.CommitVehicleImport200ResponseHeaders{
			CacheControl: noStore(), ETag: &tag, IdempotencyReplayed: &replayed, XRequestId: rid(ctx),
		},
	}, nil
}

func (s *Imports) commit(ctx context.Context, req fleetapi.CommitVehicleImportRequestObject) (fleetapi.VehicleImport, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return fleetapi.VehicleImport{}, err
	}
	if req.Body == nil {
		return fleetapi.VehicleImport{}, problem.New(problem.CodeMalformedRequest, "")
	}
	c, err := scopeddb.For(ctx, s.Pools, s.Authz, tc)
	if err != nil {
		return fleetapi.VehicleImport{}, problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	if _, err := visible(ctx, c, req.ImportId); err != nil {
		return fleetapi.VehicleImport{}, dbError(err)
	}
	now := s.now()
	var body fleetapi.VehicleImport
	err = kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		var err error
		if body, err = s.commitIn(ctx, tx, tc, req, now); err != nil {
			return err
		}
		return kit.Complete(ctx, tx, http.StatusOK, kit.ETag(body.Revision), body)
	})
	return body, dbError(err)
}

// commitIn re-checks and applies the rows of the locked import of req in tx.
func (s *Imports) commitIn(ctx context.Context, tx pgx.Tx, tc tenantctx.TenantContext, req fleetapi.CommitVehicleImportRequestObject, now time.Time) (fleetapi.VehicleImport, error) {
	hd, err := lockPreview(ctx, tx, req.ImportId, req.Params.IfMatch, now)
	if err != nil {
		return fleetapi.VehicleImport{}, err
	}
	az := s.within(tx, now)
	if err := defaultUnit(ctx, az, tc, tx, hd.DefaultUnit); err != nil {
		return fleetapi.VehicleImport{}, err
	}
	all, err := loadStored(ctx, tx, hd.ID)
	if err != nil {
		return fleetapi.VehicleImport{}, err
	}
	recs := make([]record, 0, len(all))
	for _, st := range all {
		recs = append(recs, st.record())
	}
	rows, err := newChecker(tc, az, tx, hd.DefaultUnit).checkAll(ctx, recs)
	if err != nil {
		return fleetapi.VehicleImport{}, err
	}
	if bad := invalid(rows); len(bad) > 0 && !req.Body.SkipInvalidRows {
		return fleetapi.VehicleImport{}, &fieldsError{Detail: textHasErrors, Violations: bad}
	}
	if err := apply(ctx, tx, hd.ID, rows); err != nil {
		return fleetapi.VehicleImport{}, err
	}
	if hd, err = finishImport(ctx, tx, hd, tc.PersonID, now, rows); err != nil {
		return fleetapi.VehicleImport{}, err
	}
	if err := kit.Audit(ctx, tx, audit.Event{
		Action: "fleet.vehicle_import.commit", TargetType: targetImport, TargetID: hd.ID, UnitID: hd.DefaultUnit,
		Diff: map[string]any{"totals": hd.Totals},
	}); err != nil {
		return fleetapi.VehicleImport{}, err
	}
	return hd.dto(rowsDTO(rows), now), nil
}

// invalid are the violations of a commit with rows in error: one per row, its first error (rows[<line>]).
func invalid(rows []checked) []violation {
	var out []violation
	for _, r := range rows {
		if r.Action == actError && len(r.Errors) > 0 {
			out = append(out, violation{Field: fmt.Sprintf("rows[%d]", r.Line), Code: "invalid", Message: r.Errors[0].Message})
		}
	}
	return out
}

// insertVehicleSQL registers a vehicle (createVehicle, W2.02): lengths come in metres and are kept in millimetres; the
// database opens its first period of fleet.vehicle_assignments (Q-W2.52-19).
const insertVehicleSQL = `insert into fleet.vehicles (unit_id, plate, display_name, body_type, payload_kg, volume_m3,
	cargo_length_mm, cargo_width_mm, cargo_height_mm, temp_min_c, temp_max_c, odometer_km, depot)
	values ($1, $2, $3, $4, $5::text::numeric, $6::text::numeric, round($7::text::numeric * 1000)::integer,
	        round($8::text::numeric * 1000)::integer, round($9::text::numeric * 1000)::integer,
	        $10::text::numeric, $11::text::numeric, $12::text::numeric, $13)
	returning id`

// updateVehicleSQL updates a matched vehicle: the odometer only upward, a blank depot and blank temperatures keep the
// stored ones; an unchanged vehicle keeps its revision.
const updateVehicleSQL = `with n as (
	select $2::text as plate, $3::text as display_name, $4::text as body_type, $5::text::numeric as payload_kg,
	       $6::text::numeric as volume_m3, round($7::text::numeric * 1000)::integer as length_mm,
	       round($8::text::numeric * 1000)::integer as width_mm, round($9::text::numeric * 1000)::integer as height_mm,
	       $10::text::numeric as temp_min, $11::text::numeric as temp_max, $12::text::numeric as odometer, $13::text as depot)
	update fleet.vehicles v
	   set plate = n.plate, display_name = n.display_name, body_type = n.body_type, payload_kg = n.payload_kg,
	       volume_m3 = n.volume_m3, cargo_length_mm = n.length_mm, cargo_width_mm = n.width_mm,
	       cargo_height_mm = n.height_mm,
	       temp_min_c = case when n.temp_min is null then v.temp_min_c else n.temp_min end,
	       temp_max_c = case when n.temp_min is null then v.temp_max_c else n.temp_max end,
	       odometer_km = greatest(v.odometer_km, n.odometer), depot = coalesce(n.depot, v.depot),
	       revision = v.revision + 1
	  from n
	 where v.id = $1 and v.archived_at is null
	   and (v.plate, v.display_name, v.body_type, v.payload_kg, v.volume_m3, v.cargo_length_mm, v.cargo_width_mm,
	        v.cargo_height_mm, v.temp_min_c, v.temp_max_c, v.odometer_km, v.depot)
	       is distinct from
	       (n.plate, n.display_name, n.body_type, n.payload_kg, n.volume_m3, n.length_mm, n.width_mm, n.height_mm,
	        coalesce(n.temp_min, v.temp_min_c), case when n.temp_min is null then v.temp_max_c else n.temp_max end,
	        greatest(v.odometer_km, n.odometer), coalesce(n.depot, v.depot))`

// apply writes the rows of a commit: new vehicles and updates of matched ones, an audit row each change; a matched
// vehicle the file does not change keeps its revision and gets no audit row; a row in error is skipped with its errors.
func apply(ctx context.Context, tx pgx.Tx, importID uuid.UUID, rows []checked) error {
	for i := range rows {
		c := &rows[i]
		p := c.P
		args := []any{p.Plate, p.Name, p.Body, p.Payload, p.Volume, p.Length, p.Width, p.Height, p.TempMin, p.TempMax,
			p.Odometer, p.Depot}
		var (
			action  string
			changed = true
			err     error
		)
		switch c.Action {
		case actCreate:
			action = "fleet.vehicle.create"
			err = tx.QueryRow(ctx, insertVehicleSQL, append([]any{c.Unit}, args...)...).Scan(&c.Vehicle)
		case actUpdate:
			action = "fleet.vehicle.update"
			var tag pgconn.CommandTag
			tag, err = tx.Exec(ctx, updateVehicleSQL, append([]any{c.Vehicle}, args...)...)
			changed = tag.RowsAffected() > 0
		default:
			c.Action = actSkip
			continue
		}
		if pe, ok := errors.AsType[*pgconn.PgError](err); ok && pe.Code == "23505" {
			return kit.Conflict(textPlateTaken)
		}
		if err != nil {
			return fmt.Errorf("row %d: %w", c.Line, err)
		}
		if !changed {
			continue
		}
		if err := kit.Audit(ctx, tx, audit.Event{
			Action: action, TargetType: targetVehicle, TargetID: c.Vehicle, UnitID: c.Unit,
			Diff: map[string]any{"registrationNumber": p.Plate, "bodyType": p.BodyType, "importId": importID.String()},
		}); err != nil {
			return err
		}
	}
	return nil
}
