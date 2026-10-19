package csv

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.50: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// PreviewTTL is how long an uncommitted preview lives (the description of createVehicleImport).
const PreviewTTL = 24 * time.Hour

// ExpiredTTL is how long the header of an expired preview (without its rows) stays: getVehicleImport answers
// state=expired and the commit 409 instead of 404, as the import of people (Q-W1.05-17).
const ExpiredTTL = 7 * 24 * time.Hour

// importHeader is a row of fleet.vehicle_imports.
type importHeader struct {
	ID          uuid.UUID
	State       string
	FileName    string
	DefaultUnit uuid.UUID
	CreatedAt   time.Time
	ExpiresAt   time.Time
	CommittedAt *time.Time
	Totals      fleetapi.VehicleImportTotals
	Revision    int64
}

const importColumns = `i.id, i.state, i.file_name, i.default_unit_id, i.created_at, i.expires_at, i.committed_at,
       i.totals, i.revision`

const headerSelect = `select ` + importColumns + ` from fleet.vehicle_imports i`

func scanHeader(row pgx.Row) (importHeader, error) {
	var h importHeader
	err := row.Scan(&h.ID, &h.State, &h.FileName, &h.DefaultUnit, &h.CreatedAt, &h.ExpiresAt, &h.CommittedAt,
		&h.Totals, &h.Revision)
	return h, err
}

// dto is the VehicleImport of the contract; a preview past its expiry is expired.
func (h importHeader) dto(rows []fleetapi.VehicleImportRow, now time.Time) fleetapi.VehicleImport {
	state := fleetapi.VehicleImportState(h.State)
	if state == fleetapi.VehicleImportStatePreviewed && !now.Before(h.ExpiresAt) {
		state = fleetapi.VehicleImportStateExpired
	}
	if rows == nil {
		rows = []fleetapi.VehicleImportRow{}
	}
	out := fleetapi.VehicleImport{
		Id: h.ID, State: state, FileName: h.FileName, DefaultOrgUnitId: h.DefaultUnit, Totals: h.Totals, Rows: rows,
		CreatedAt: h.CreatedAt.UTC(), ExpiresAt: h.ExpiresAt.UTC(), Revision: h.Revision,
	}
	if h.CommittedAt != nil {
		at := h.CommittedAt.UTC()
		out.CommittedAt = &at
	}
	return out
}

// totals counts the actions of rows.
func totals(rows []checked) fleetapi.VehicleImportTotals {
	t := fleetapi.VehicleImportTotals{Rows: int64(len(rows))}
	for _, r := range rows {
		switch r.Action {
		case actCreate:
			t.Create++
		case actUpdate:
			t.Update++
		case actSkip:
			t.Skip++
		case actError:
			t.Error++
		}
	}
	return t
}

// storedData is fleet.vehicle_import_rows.data: the values of the file (the raw file is not stored, the rows hold no
// personal data), the extra-values flag and the company of the row; the commit checks the values again.
type storedData struct {
	Values map[string]string `json:"values"`
	Extra  bool              `json:"extra,omitempty"`
	Unit   *uuid.UUID        `json:"orgUnitId,omitempty"`
}

// stored is a row as fleet.vehicle_import_rows keeps it.
type stored struct {
	Line    int
	Action  string
	Data    storedData
	Errors  []violation
	Vehicle *uuid.UUID
}

func storedOf(c checked) stored {
	s := stored{Line: c.Line, Action: c.Action, Data: storedData{Values: c.Values, Extra: c.Extra}, Errors: c.Errors}
	if c.Unit != uuid.Nil {
		u := c.Unit
		s.Data.Unit = &u
	}
	if c.Vehicle != uuid.Nil {
		v := c.Vehicle
		s.Vehicle = &v
	}
	if s.Errors == nil {
		s.Errors = []violation{}
	}
	return s
}

// record is the record of the file kept in the row.
func (s stored) record() record {
	return record{Line: s.Line, Values: s.Data.Values, Extra: s.Data.Extra}
}

// row is the VehicleImportRow of the contract.
func (s stored) row() fleetapi.VehicleImportRow {
	r := fleetapi.VehicleImportRow{
		Line: int64(s.Line), Action: fleetapi.VehicleImportRowAction(s.Action), VehicleId: s.Vehicle,
		Errors: make([]fleetapi.ProblemViolation, 0, len(s.Errors)),
	}
	if p := cleanPlate(s.Data.Values[colPlate]); p != "" {
		r.RegistrationNumber = &p
	}
	if n := strings.TrimSpace(s.Data.Values[colName]); n != "" {
		r.DisplayName = &n
	}
	if s.Action == actCreate || s.Action == actUpdate {
		r.OrgUnitId = s.Data.Unit
	}
	for _, v := range s.Errors {
		r.Errors = append(r.Errors, fleetapi.ProblemViolation{Field: v.Field, Code: v.Code, Message: v.Message})
	}
	return r
}

// rowsDTO is the rows of the contract for checked rows (the same as a read of the stored rows gives).
func rowsDTO(rows []checked) []fleetapi.VehicleImportRow {
	out := make([]fleetapi.VehicleImportRow, 0, len(rows))
	for _, c := range rows {
		out = append(out, storedOf(c).row())
	}
	return out
}

// insertImport writes the header and the rows of a preview.
func insertImport(ctx context.Context, tx pgx.Tx, h importHeader, sum []byte, createdBy uuid.UUID, rows []checked) error {
	if _, err := tx.Exec(ctx, `insert into fleet.vehicle_imports
		(id, state, file_name, file_sha256, default_unit_id, created_by, created_at, expires_at, totals, revision)
		values ($1, 'previewed', $2, $3, $4, $5, $6, $7, $8, 1)`,
		h.ID, h.FileName, sum, h.DefaultUnit, createdBy, h.CreatedAt, h.ExpiresAt, h.Totals); err != nil {
		return fmt.Errorf("vehicle import: %w", err)
	}
	return insertRows(ctx, tx, h.ID, rows)
}

// insertRows writes the rows of an import in one statement.
func insertRows(ctx context.Context, tx pgx.Tx, id uuid.UUID, rows []checked) error {
	if len(rows) == 0 {
		return nil
	}
	lines := make([]int32, 0, len(rows))
	var actions, data, errs, vehicles []string
	for _, c := range rows {
		s := storedOf(c)
		d, err := json.Marshal(s.Data)
		if err != nil {
			return err
		}
		e, err := json.Marshal(s.Errors)
		if err != nil {
			return err
		}
		v := ""
		if s.Vehicle != nil {
			v = s.Vehicle.String()
		}
		lines = append(lines, int32(s.Line)) //nolint:gosec // G115: at most MaxRows lines of at most MaxBytes
		actions, data, errs, vehicles = append(actions, s.Action), append(data, string(d)), append(errs, string(e)), append(vehicles, v)
	}
	_, err := tx.Exec(ctx, `insert into fleet.vehicle_import_rows (import_id, line, action, data, errors, vehicle_id)
		select $1, t.l, t.a, t.d::jsonb, t.e::jsonb, nullif(t.v, '')::uuid
		  from unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[]) as t(l, a, d, e, v)`,
		id, lines, actions, data, errs, vehicles)
	if err != nil {
		return fmt.Errorf("vehicle import rows: %w", err)
	}
	return nil
}

// loadStored reads the rows of an import in the order of the file.
func loadStored(ctx context.Context, q querier, id uuid.UUID) ([]stored, error) {
	res, err := q.Query(ctx, `select line, action, data, errors, vehicle_id from fleet.vehicle_import_rows
		where import_id = $1 order by line`, id)
	if err != nil {
		return nil, err
	}
	defer res.Close()
	var out []stored
	for res.Next() {
		var (
			s          stored
			data, errs []byte
		)
		if err := res.Scan(&s.Line, &s.Action, &data, &errs, &s.Vehicle); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(data, &s.Data); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(errs, &s.Errors); err != nil {
			return nil, err
		}
		out = append(out, s)
	}
	return out, res.Err()
}

// lockPreview locks the import id in tx and checks that it is a live preview at the revision of If-Match.
func lockPreview(ctx context.Context, tx pgx.Tx, id uuid.UUID, ifMatch string, now time.Time) (importHeader, error) {
	h, err := scanHeader(tx.QueryRow(ctx, headerSelect+` where i.id = $1 for update`, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return importHeader{}, problem.New(problem.CodeNotFound, textNotFound)
	}
	if err != nil {
		return importHeader{}, err
	}
	if err := kit.CheckRevision(ifMatch, h.Revision); err != nil {
		return importHeader{}, err
	}
	switch {
	case h.State == string(fleetapi.VehicleImportStateCommitted):
		return importHeader{}, kit.Conflict("Импорт уже применён.")
	case h.State == string(fleetapi.VehicleImportStateExpired) || !now.Before(h.ExpiresAt):
		return importHeader{}, kit.Conflict("Предпросмотр устарел. Загрузите файл заново.")
	}
	return h, nil
}

// finishImport marks the import committed and replaces its rows with the result of the commit.
func finishImport(ctx context.Context, tx pgx.Tx, h importHeader, committedBy uuid.UUID, at time.Time, rows []checked) (importHeader, error) {
	out, err := scanHeader(tx.QueryRow(ctx, `update fleet.vehicle_imports i
		set state = 'committed', committed_by = $2, committed_at = $3, totals = $4, revision = revision + 1
		where i.id = $1
		returning `+importColumns, h.ID, committedBy, at, totals(rows)))
	if err != nil {
		return importHeader{}, fmt.Errorf("vehicle import: %w", err)
	}
	if _, err := tx.Exec(ctx, `delete from fleet.vehicle_import_rows where import_id = $1`, h.ID); err != nil {
		return importHeader{}, fmt.Errorf("vehicle import rows: %w", err)
	}
	return out, insertRows(ctx, tx, h.ID, rows)
}

// purge expires the previews past their day (their rows are deleted) and deletes the expired ones ExpiredTTL later;
// createVehicleImport runs it in its transaction.
func purge(ctx context.Context, tx pgx.Tx, now time.Time) error {
	if _, err := tx.Exec(ctx, `with gone as (
		update fleet.vehicle_imports set state = 'expired' where state = 'previewed' and expires_at <= $1 returning id)
		delete from fleet.vehicle_import_rows r using gone where r.import_id = gone.id`, now); err != nil {
		return fmt.Errorf("expired vehicle imports: %w", err)
	}
	if _, err := tx.Exec(ctx, `delete from fleet.vehicle_imports where state = 'expired' and expires_at <= $1`,
		now.Add(-ExpiredTTL)); err != nil {
		return fmt.Errorf("expired vehicle imports: %w", err)
	}
	return nil
}
