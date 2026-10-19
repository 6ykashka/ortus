//go:build integration

package csv

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	harness "github.com/ortus/ortus-crm/backend/test"            //nolint:depguard // integration test: the clock of the suites
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// lines joins the header of the required columns and rows into a file.
func lines(head string, rows ...string) string { return head + "\n" + strings.Join(rows, "\n") + "\n" }

// row is a data row of the required columns with «;».
func row(number, name, body, odometer string) string {
	return strings.Join([]string{number, name, body, "1200", "11,5", "3,2", "1,8", "1,9", odometer}, ";")
}

func (e env) create(ctx context.Context, csv string, unit uuid.UUID) (fleetapi.CreateVehicleImportResponseObject, error) {
	return Server{Imports: e.imp}.CreateVehicleImport(ctx, fleetapi.CreateVehicleImportRequestObject{
		Body: &fleetapi.VehicleImportCreate{FileName: "mashiny.csv", Csv: csv, DefaultOrgUnitId: unit},
	})
}

func (e env) preview(ctx context.Context, t *testing.T, csv string, unit uuid.UUID) fleetapi.VehicleImport {
	t.Helper()
	res, err := e.create(ctx, csv, unit)
	require.NoError(t, err)
	ok, is := res.(fleetapi.CreateVehicleImport201JSONResponse)
	require.True(t, is, "201, got %T %+v", res, res)
	require.NotNil(t, ok.Headers.ETag)
	assert.Equal(t, `"1"`, *ok.Headers.ETag)
	return ok.Body
}

func (e env) commit(ctx context.Context, imp uuid.UUID, ifMatch string, skip bool) (fleetapi.CommitVehicleImportResponseObject, error) {
	return Server{Imports: e.imp}.CommitVehicleImport(ctx, fleetapi.CommitVehicleImportRequestObject{
		ImportId: imp, Params: fleetapi.CommitVehicleImportParams{IfMatch: ifMatch},
		Body: &fleetapi.VehicleImportCommit{SkipInvalidRows: skip},
	})
}

func (e env) get(ctx context.Context, imp uuid.UUID) (fleetapi.GetVehicleImportResponseObject, error) {
	return Server{Imports: e.imp}.GetVehicleImport(ctx, fleetapi.GetVehicleImportRequestObject{ImportId: imp})
}

func rowAt(t *testing.T, imp fleetapi.VehicleImport, line int64) fleetapi.VehicleImportRow {
	t.Helper()
	for _, r := range imp.Rows {
		if r.Line == line {
			return r
		}
	}
	t.Fatalf("no line %d in %+v", line, imp.Rows)
	return fleetapi.VehicleImportRow{}
}

func errorsOf(r fleetapi.VehicleImportRow) []violation {
	out := make([]violation, 0, len(r.Errors))
	for _, v := range r.Errors {
		out = append(out, violation{Field: v.Field, Code: v.Code, Message: v.Message})
	}
	return out
}

var (
	noUnit      = violation{Field: colOrgUnit, Code: "unknown", Message: "Подразделение не найдено."}
	unavailable = violation{Field: colPlate, Code: "unavailable", Message: "Строку нельзя импортировать"}
)

// D-11 комплекта, Q-W2.52-10, Q-W2.52-17: the preview checks every row against the scope of fleet.vehicles.manage of
// the manager of Москва-1 without changing data; a company outside the scope and an unknown one, a vehicle outside the
// scope — row errors that name nothing.
func TestCreateVehicleImportPreview(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1", fixtures.TenantA)
	msk1 := id(t, "unit:a.msk1")
	mine, foreign, worn := plate(), plate(), plate()
	vMine := e.addVehicle(t, "msk1", mine, "1000")
	e.addVehicle(t, "smr2", foreign, "0")
	e.addVehicle(t, "msk1", worn, "5000")
	fresh := plate()
	head := header + ";org_unit"
	imp := e.preview(ctx, t, lines(head,
		row(fresh, "Ford Transit Custom", "van", "0")+";",                    // 2: create in the default company
		row(strings.ToLower(mine), "ГАЗель Next", "Тент", "1500")+";",        // 3: update of a vehicle of Москва-1
		row(plate(), "Самосвал", "Самосвал", "0")+";",                        // 4: unknown body
		row(fresh, "Дубль", "van", "0")+";",                                  // 5: the same number twice in the file
		row(plate(), "Самара", "van", "0")+";Самара-2",                       // 6: a company outside the scope
		row(plate(), "Нет такой", "van", "0")+";Нет такой фирмы",             // 7: an unknown company — the same error
		row(foreign, "Чужая", "van", "0")+";",                                // 8: a vehicle of Самара-2
		row(worn, "Пробег", "van", "4999,9")+";",                             // 9: a lower odometer
		row(plate(), "По id", "van", "0")+";"+strings.ToUpper(msk1.String()), // 10: the company by id
	), msk1)

	assert.Equal(t, fleetapi.VehicleImportStatePreviewed, imp.State)
	assert.Equal(t, msk1, imp.DefaultOrgUnitId)
	assert.Equal(t, fleetapi.VehicleImportTotals{Rows: 9, Create: 2, Update: 1, Error: 6}, imp.Totals)
	assert.Equal(t, harness.Now().Add(24*time.Hour).UTC(), imp.ExpiresAt)

	r := rowAt(t, imp, 2)
	assert.Equal(t, fleetapi.Create, r.Action)
	assert.Equal(t, fresh, *r.RegistrationNumber)
	assert.Equal(t, msk1, *r.OrgUnitId)
	assert.Nil(t, r.VehicleId)
	assert.Empty(t, r.Errors)

	r = rowAt(t, imp, 3)
	assert.Equal(t, fleetapi.Update, r.Action)
	assert.Equal(t, vMine, *r.VehicleId)
	assert.Equal(t, msk1, *r.OrgUnitId)

	assert.Equal(t, []violation{{colBody, "unknown", "Неизвестный тип кузова"}}, errorsOf(rowAt(t, imp, 4)))
	assert.Equal(t, []violation{{colPlate, "duplicate", "Номер повторяется в файле"}}, errorsOf(rowAt(t, imp, 5)))
	assert.Equal(t, []violation{noUnit}, errorsOf(rowAt(t, imp, 6)))
	assert.Equal(t, []violation{noUnit}, errorsOf(rowAt(t, imp, 7)), "unknown and outside the scope — one text")
	r = rowAt(t, imp, 8)
	assert.Equal(t, []violation{unavailable}, errorsOf(r))
	assert.Nil(t, r.VehicleId, "a vehicle outside the scope is never named")
	assert.Nil(t, r.OrgUnitId)
	assert.Equal(t, []violation{{colOdometer, "odometer_decrease", "Пробег не может уменьшиться"}}, errorsOf(rowAt(t, imp, 9)))
	assert.Equal(t, fleetapi.Create, rowAt(t, imp, 10).Action)

	var n int
	require.NoError(t, e.pool(t, fixtures.TenantA).QueryRow(t.Context(),
		`select count(*) from fleet.vehicles where upper(plate) = upper($1)`, fresh).Scan(&n))
	assert.Zero(t, n, "the preview changes no data")
}

// An update never moves a vehicle: another company of the row (or of the default) is a row error (moveVehicle).
func TestCreateVehicleImportMoveIsARowError(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	number := plate()
	e.addVehicle(t, "msk1", number, "0")
	imp := e.preview(e.as(t, "a.owner", fixtures.TenantA), t, lines(header, row(number, "Машина", "van", "10")),
		id(t, "unit:a.msk2"))
	assert.Equal(t, []violation{{colOrgUnit, "move", "Перемещение машины — отдельной командой"}}, errorsOf(rowAt(t, imp, 2)))
}

// Q-W2.52-17: an unknown default company and one the actor cannot see — the same 422; a visible company without
// fleet.vehicles.manage — 403.
func TestCreateVehicleImportDefaultUnit(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	file := lines(header, row(plate(), "Машина", "van", "0"))
	unknown := func(ctx context.Context, unit uuid.UUID) fleetapi.Problem {
		t.Helper()
		res, err := e.create(ctx, file, unit)
		require.NoError(t, err)
		v, ok := res.(fleetapi.CreateVehicleImport422ApplicationProblemPlusJSONResponse)
		require.True(t, ok, "422, got %T", res)
		v.Body.RequestId = ""
		return v.Body
	}
	manager := e.as(t, "a.manager-msk1", fixtures.TenantA)
	hidden := unknown(manager, id(t, "unit:a.smr2"))
	missing := unknown(manager, uuid.New())
	assert.Equal(t, missing, hidden, "an unknown and an invisible company answer the same")
	require.NotNil(t, hidden.Violations)
	assert.Equal(t, []fleetapi.ProblemViolation{{Field: "defaultOrgUnitId", Code: "unknown", Message: "Подразделение не найдено"}},
		*hidden.Violations)
	assert.Equal(t, "Подразделение не найдено.", *hidden.Detail)

	_, err := e.create(e.as(t, "a.two-roles", fixtures.TenantA), file, id(t, "unit:a.smr2"))
	assert.True(t, problem.Is(err, problem.CodeForbiddenAction), "a visible company without the right — 403: %v", err)
}

func TestCreateVehicleImportRejectsTheFile(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.owner", fixtures.TenantA)
	res, err := e.create(ctx, "display_name\nМашина\n", id(t, "unit:a.msk1"))
	require.NoError(t, err)
	v, ok := res.(fleetapi.CreateVehicleImport422ApplicationProblemPlusJSONResponse)
	require.True(t, ok, "422, got %T", res)
	assert.Equal(t, "В файле нет обязательной колонки registration_number.", *v.Body.Detail)
	assert.Equal(t, []fleetapi.ProblemViolation{{Field: "csv", Code: "missing_column", Message: "Нет колонки registration_number (госномер)"}},
		*v.Body.Violations)

	_, err = e.create(ctx, header+"\n"+strings.Repeat("x", MaxBytes), id(t, "unit:a.msk1"))
	assert.True(t, problem.Is(err, codeTooLarge), "413: %v", err)

	_, err = Server{Imports: e.imp}.CreateVehicleImport(ctx, fleetapi.CreateVehicleImportRequestObject{
		Body: &fleetapi.VehicleImportCreate{FileName: " ", Csv: header, DefaultOrgUnitId: id(t, "unit:a.msk1")},
	})
	assert.True(t, problem.Is(err, codeValidation), "a blank file name — 422: %v", err)
}

// getVehicleImport: the import of a company outside fleet.vehicles.manage of the actor is 404, as a missing one.
func TestGetVehicleImport(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	imp := e.preview(e.as(t, "a.manager-msk1", fixtures.TenantA), t, lines(header, row(plate(), "Машина", "van", "0")),
		id(t, "unit:a.msk1"))

	res, err := e.get(e.as(t, "a.owner", fixtures.TenantA), imp.Id)
	require.NoError(t, err)
	got, ok := res.(fleetapi.GetVehicleImport200JSONResponse)
	require.True(t, ok, "200, got %T", res)
	assert.Equal(t, imp.Rows, got.Body.Rows)
	assert.Equal(t, `"1"`, *got.Headers.ETag)

	for _, actor := range []string{"a.manager-msk2", "a.driver-msk1"} {
		_, err = e.get(e.as(t, actor, fixtures.TenantA), imp.Id)
		assert.True(t, problem.Is(err, problem.CodeNotFound), "%s: %v", actor, err)
	}
	_, err = e.get(e.as(t, "a.owner", fixtures.TenantA), uuid.New())
	assert.True(t, problem.Is(err, problem.CodeNotFound), "a missing import: %v", err)
}

// commitVehicleImport applies the valid rows in one transaction by If-Match: a new vehicle with its first period of
// fleet.vehicle_assignments (opened by the database, Q-W2.52-19), an update of a matched one (the odometer only
// upward), invalid rows skipped only with skipInvalidRows; a committed import is 409.
func TestCommitVehicleImport(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1", fixtures.TenantA)
	msk1 := id(t, "unit:a.msk1")
	fresh, mine := plate(), plate()
	vMine := e.addVehicle(t, "msk1", mine, "1000")
	imp := e.preview(ctx, t, lines(header+";depot;temperature_min_c;temperature_max_c;equipment",
		row(fresh, "Ford Transit Custom", "Рефрижератор", "120")+";Склад № 2;-18;+8;refrigerator",
		row(mine, "ГАЗель Next", "tent", "1500,5")+";;;;",
		row(plate(), "Самосвал", "Самосвал", "0")+";;;;",
	), msk1)

	_, err := e.commit(ctx, imp.Id, "", true)
	assert.True(t, problem.Is(err, "revision_required"), "no If-Match — 428: %v", err)
	_, err = e.commit(ctx, imp.Id, `"7"`, true)
	assert.True(t, problem.Is(err, "revision_mismatch"), "a stale revision — 412: %v", err)

	res, err := e.commit(ctx, imp.Id, `"1"`, false)
	require.NoError(t, err)
	bad, ok := res.(fleetapi.CommitVehicleImport422ApplicationProblemPlusJSONResponse)
	require.True(t, ok, "422 without skipInvalidRows, got %T", res)
	assert.Equal(t, []fleetapi.ProblemViolation{{Field: "rows[4]", Code: "invalid", Message: "Неизвестный тип кузова"}},
		*bad.Body.Violations)

	res, err = e.commit(ctx, imp.Id, `"1"`, true)
	require.NoError(t, err)
	done, ok := res.(fleetapi.CommitVehicleImport200JSONResponse)
	require.True(t, ok, "200, got %T", res)
	out := done.Body
	assert.Equal(t, fleetapi.VehicleImportStateCommitted, out.State)
	assert.Equal(t, int64(2), out.Revision)
	assert.Equal(t, `"2"`, *done.Headers.ETag)
	require.NotNil(t, out.CommittedAt)
	assert.Equal(t, fleetapi.VehicleImportTotals{Rows: 3, Create: 1, Update: 1, Skip: 1}, out.Totals)

	created := rowAt(t, out, 2)
	require.NotNil(t, created.VehicleId)
	assert.Equal(t, vMine, *rowAt(t, out, 3).VehicleId)
	skipped := rowAt(t, out, 4)
	assert.Equal(t, fleetapi.Skip, skipped.Action)
	assert.Equal(t, []violation{{colBody, "unknown", "Неизвестный тип кузова"}}, errorsOf(skipped))

	db := e.pool(t, fixtures.TenantA)
	var (
		unit, period         uuid.UUID
		body, odo, tmin, dep string
		revision             int
	)
	require.NoError(t, db.QueryRow(t.Context(), `select v.unit_id, v.body_type, trim_scale(v.odometer_km)::text,
		trim_scale(v.temp_min_c)::text, v.depot, a.unit_id
		from fleet.vehicles v join fleet.vehicle_assignments a on a.vehicle_id = v.id and a.valid_to is null
		where v.id = $1`, *created.VehicleId).Scan(&unit, &body, &odo, &tmin, &dep, &period))
	assert.Equal(t, []any{msk1, "reefer", "120", "-18", "Склад № 2", msk1}, []any{unit, body, odo, tmin, dep, period})
	require.NoError(t, db.QueryRow(t.Context(), `select display_name, body_type, trim_scale(odometer_km)::text, depot, revision
		from fleet.vehicles where id = $1`, vMine).Scan(&tmin, &body, &odo, &dep, &revision))
	assert.Equal(t, []any{"ГАЗель Next", "tent", "1500.5", "Площадка", 2}, []any{tmin, body, odo, dep, revision},
		"name, body and odometer updated, a blank depot keeps the old one")
	var audits int
	require.NoError(t, db.QueryRow(t.Context(), `select count(*) from audit.events
		where (action in ('fleet.vehicle.create', 'fleet.vehicle.update') and target_id = any($1))
		   or (action = 'fleet.vehicle_import.commit' and target_id = $2)`,
		[]uuid.UUID{*created.VehicleId, vMine}, imp.Id).Scan(&audits))
	assert.Equal(t, 3, audits, "an audit row per created or updated vehicle and one of the commit")

	_, err = e.commit(ctx, imp.Id, `"2"`, true)
	assert.True(t, problem.Is(err, "invalid_transition"), "a committed import — 409: %v", err)

	res2, err := e.get(ctx, imp.Id)
	require.NoError(t, err)
	got, ok := res2.(fleetapi.GetVehicleImport200JSONResponse)
	require.True(t, ok, "200, got %T", res2)
	assert.Equal(t, out.Rows, got.Body.Rows)
}

// Review W2.50-r1: a matched vehicle the file does not change keeps its revision and gets no fleet.vehicle.update audit
// row — the journal shows only changes that happened.
func TestCommitVehicleImportUnchangedVehicleNoAudit(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1", fixtures.TenantA)
	msk1 := id(t, "unit:a.msk1")
	file := lines(header, row(plate(), "Повтор", "tent", "1000"))
	first := e.preview(ctx, t, file, msk1)
	res, err := e.commit(ctx, first.Id, `"1"`, false)
	require.NoError(t, err)
	done, ok := res.(fleetapi.CommitVehicleImport200JSONResponse)
	require.True(t, ok, "200, got %T", res)
	vid := *rowAt(t, done.Body, 2).VehicleId

	again := e.preview(ctx, t, file, msk1)
	require.Equal(t, fleetapi.Update, rowAt(t, again, 2).Action)
	res, err = e.commit(ctx, again.Id, `"1"`, false)
	require.NoError(t, err)
	_, ok = res.(fleetapi.CommitVehicleImport200JSONResponse)
	require.True(t, ok, "200, got %T", res)

	db := e.pool(t, fixtures.TenantA)
	var revision, updates int
	require.NoError(t, db.QueryRow(t.Context(), `select revision from fleet.vehicles where id = $1`, vid).Scan(&revision))
	assert.Equal(t, 1, revision, "an unchanged vehicle keeps its revision")
	require.NoError(t, db.QueryRow(t.Context(), `select count(*) from audit.events
		where action = 'fleet.vehicle.update' and target_id = $1`, vid).Scan(&updates))
	assert.Zero(t, updates, "no audit row of an update that changed nothing")
}

// The scope is checked again at the commit: a vehicle moved out of the scope after the preview is a skipped row that
// names nothing, and the vehicle is not changed.
func TestCommitVehicleImportRechecksTheScope(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1", fixtures.TenantA)
	number := plate()
	vid := e.addVehicle(t, "msk1", number, "0")
	imp := e.preview(ctx, t, lines(header, row(number, "Переименована", "van", "10")), id(t, "unit:a.msk1"))
	require.Equal(t, fleetapi.Update, rowAt(t, imp, 2).Action)

	tx, err := e.pool(t, fixtures.TenantA).Begin(t.Context())
	require.NoError(t, err)
	msk2 := id(t, "unit:a.msk2")
	for _, sql := range []string{
		`update fleet.vehicle_assignments set valid_to = now() where vehicle_id = $1 and valid_to is null`,
		`insert into fleet.vehicle_assignments (vehicle_id, unit_id, valid_from) values ($1, $2, now() + interval '1 microsecond')`,
		`update fleet.vehicles set unit_id = $2 where id = $1`,
	} {
		args := []any{vid}
		if strings.Contains(sql, "$2") {
			args = append(args, msk2)
		}
		_, err = tx.Exec(t.Context(), sql, args...)
		require.NoError(t, err)
	}
	require.NoError(t, tx.Commit(t.Context()))

	res, err := e.commit(ctx, imp.Id, `"1"`, true)
	require.NoError(t, err)
	done, ok := res.(fleetapi.CommitVehicleImport200JSONResponse)
	require.True(t, ok, "200, got %T", res)
	out := done.Body
	r := rowAt(t, out, 2)
	assert.Equal(t, fleetapi.Skip, r.Action)
	assert.Equal(t, []violation{unavailable}, errorsOf(r))
	assert.Nil(t, r.VehicleId)
	var name string
	require.NoError(t, e.pool(t, fixtures.TenantA).QueryRow(t.Context(),
		`select display_name from fleet.vehicles where id = $1`, vid).Scan(&name))
	assert.Equal(t, "Машина", name)
}

// A preview past its day: getVehicleImport shows expired, the commit is 409.
func TestCommitExpiredVehicleImport(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.owner", fixtures.TenantA)
	imp := e.preview(ctx, t, lines(header, row(plate(), "Машина", "van", "0")), id(t, "unit:a.msk1"))
	_, err := e.pool(t, fixtures.TenantA).Exec(t.Context(),
		`update fleet.vehicle_imports set created_at = $2, expires_at = $3 where id = $1`,
		imp.Id, harness.Now().Add(-48*time.Hour), harness.Now().Add(-time.Hour))
	require.NoError(t, err)
	res, err := e.get(ctx, imp.Id)
	require.NoError(t, err)
	got, ok := res.(fleetapi.GetVehicleImport200JSONResponse)
	require.True(t, ok, "200, got %T", res)
	assert.Equal(t, fleetapi.VehicleImportStateExpired, got.Body.State)
	_, err = e.commit(ctx, imp.Id, `"1"`, true)
	assert.True(t, problem.Is(err, "invalid_transition"), "an expired preview — 409: %v", err)
}
