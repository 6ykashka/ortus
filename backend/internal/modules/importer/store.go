package importer

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W1.05: shared helpers of org, people, importer (integratorNotes)
)

// header is a row of people.imports.
type header struct {
	ID           uuid.UUID
	State        string
	FileName     string
	DefaultUnit  uuid.UUID
	CreatedAt    time.Time
	ExpiresAt    time.Time
	CommittedAt  *time.Time
	RowsPurgedAt *time.Time
	Totals       accessapi.PeopleImportTotals
	Revision     int64
}

const importColumns = `i.id, i.state, i.file_name, i.default_unit_id, i.created_at, i.expires_at, i.committed_at,
       i.rows_purged_at, i.totals, i.revision`

const headerSelect = `select ` + importColumns + ` from people.imports i`

func scanHeader(row pgx.Row) (header, error) {
	var h header
	err := row.Scan(&h.ID, &h.State, &h.FileName, &h.DefaultUnit, &h.CreatedAt, &h.ExpiresAt, &h.CommittedAt,
		&h.RowsPurgedAt, &h.Totals, &h.Revision)
	return h, err
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}

// dto is the PeopleImport of the contract; a preview past its expiry is expired.
func (h header) dto(rows []accessapi.PeopleImportRow, now time.Time) accessapi.PeopleImport {
	state := accessapi.PeopleImportState(h.State)
	if state == accessapi.PeopleImportStatePreviewed && !now.Before(h.ExpiresAt) {
		state = accessapi.PeopleImportStateExpired
	}
	if rows == nil {
		rows = []accessapi.PeopleImportRow{}
	}
	return accessapi.PeopleImport{
		Id: h.ID, State: state, FileName: h.FileName, DefaultOrgUnitId: h.DefaultUnit, Totals: h.Totals, Rows: rows,
		CreatedAt: h.CreatedAt.UTC(), ExpiresAt: h.ExpiresAt.UTC(), CommittedAt: utc(h.CommittedAt),
		RowsPurgedAt: utc(h.RowsPurgedAt), Revision: h.Revision,
	}
}

// storedData is people.import_rows.data: the values of the file, the resolved unit and the extra-values flag.
type storedData struct {
	rowData
	OrgUnitID *uuid.UUID `json:"orgUnitId,omitempty"`
	Extra     bool       `json:"extra,omitempty"`
}

// stored is a row as people.import_rows keeps it.
type stored struct {
	Line   int
	Action string
	Data   storedData
	Errors []violation
	Person *uuid.UUID
}

func storedOf(c checked) stored {
	s := stored{Line: c.Line, Action: string(c.Action), Data: storedData{rowData: c.Data}, Errors: c.Errors}
	if c.Unit != uuid.Nil {
		u := c.Unit
		s.Data.OrgUnitID = &u
	}
	for _, v := range c.Errors {
		if v.Code == codeExtra {
			s.Data.Extra = true
		}
	}
	if c.Person != uuid.Nil {
		p := c.Person
		s.Person = &p
	}
	return s
}

// record is the record of the file kept in the row.
func (d storedData) record(line int) record {
	return record{Line: line, Data: d.rowData, Extra: d.Extra}
}

// row is the PeopleImportRow of the contract.
func (s stored) row() accessapi.PeopleImportRow {
	r := accessapi.PeopleImportRow{
		Line: int64(s.Line), Action: accessapi.PeopleImportRowAction(s.Action), OrgUnitId: s.Data.OrgUnitID,
		MemberId: s.Person, Errors: make([]accessapi.ProblemViolation, 0, len(s.Errors)),
	}
	d := s.Data
	for _, f := range []struct {
		v   string
		dst **string
	}{{d.FullName, &r.FullName}, {d.Email, &r.Email}, {d.Phone, &r.Phone}} {
		if f.v != "" {
			v := f.v
			*f.dst = &v
		}
	}
	if fn := strings.ToLower(d.WorkProfile); fn != "" {
		if _, ok := kit.FunctionToDB(fn); ok {
			wp := accessapi.PeopleImportRowWorkProfile(fn)
			r.WorkProfile = &wp
		}
	}
	for _, v := range s.Errors {
		r.Errors = append(r.Errors, accessapi.ProblemViolation{Field: v.Field, Code: v.Code, Message: v.Message})
	}
	return r
}

// rowsDTO is the rows of the contract for checked rows (the same as a read of the stored rows gives).
func rowsDTO(rows []checked) []accessapi.PeopleImportRow {
	out := make([]accessapi.PeopleImportRow, 0, len(rows))
	for _, c := range rows {
		out = append(out, storedOf(c).row())
	}
	return out
}

// insertImport writes the header and the rows of a preview.
func insertImport(ctx context.Context, tx pgx.Tx, h header, sum []byte, createdBy uuid.UUID, rows []checked) error {
	if _, err := tx.Exec(ctx, `insert into people.imports
		(id, state, file_name, file_sha256, default_unit_id, created_by, created_at, expires_at, totals, revision)
		values ($1, 'previewed', $2, $3, $4, $5, $6, $7, $8, 1)`,
		h.ID, h.FileName, sum, h.DefaultUnit, createdBy, h.CreatedAt, h.ExpiresAt, h.Totals); err != nil {
		return fmt.Errorf("import: %w", err)
	}
	return insertRows(ctx, tx, h.ID, rows)
}

// insertRows writes the rows of an import in one statement.
func insertRows(ctx context.Context, tx pgx.Tx, id uuid.UUID, rows []checked) error {
	if len(rows) == 0 {
		return nil
	}
	lines := make([]int32, 0, len(rows))
	var actions, data, errs, persons []string
	for _, c := range rows {
		s := storedOf(c)
		d, err := json.Marshal(s.Data)
		if err != nil {
			return err
		}
		e, err := json.Marshal(append([]violation{}, s.Errors...))
		if err != nil {
			return err
		}
		p := ""
		if s.Person != nil {
			p = s.Person.String()
		}
		lines = append(lines, int32(s.Line)) //nolint:gosec // G115: at most MaxRows lines of at most MaxBytes
		actions, data, errs, persons = append(actions, s.Action), append(data, string(d)), append(errs, string(e)), append(persons, p)
	}
	_, err := tx.Exec(ctx, `insert into people.import_rows (import_id, line, action, data, errors, person_id)
		select $1, t.l, t.a, t.d::jsonb, t.e::jsonb, nullif(t.p, '')::uuid
		  from unnest($2::int[], $3::text[], $4::text[], $5::text[], $6::text[]) as t(l, a, d, e, p)`,
		id, lines, actions, data, errs, persons)
	if err != nil {
		return fmt.Errorf("import rows: %w", err)
	}
	return nil
}

// loadRows reads the rows of an import as the contract shows them.
func loadRows(ctx context.Context, q kit.Querier, id uuid.UUID) ([]accessapi.PeopleImportRow, error) {
	all, err := loadStored(ctx, q, id)
	if err != nil {
		return nil, err
	}
	out := make([]accessapi.PeopleImportRow, 0, len(all))
	for _, s := range all {
		out = append(out, s.row())
	}
	return out, nil
}

func loadStored(ctx context.Context, q kit.Querier, id uuid.UUID) ([]stored, error) {
	res, err := q.Query(ctx, `select line, action, data, errors, person_id from people.import_rows
		where import_id = $1 order by line`, id)
	if err != nil {
		return nil, err
	}
	defer res.Close()
	var out []stored
	for res.Next() {
		var (
			s         stored
			data, err []byte
		)
		if e := res.Scan(&s.Line, &s.Action, &data, &err, &s.Person); e != nil {
			return nil, e
		}
		if e := json.Unmarshal(data, &s.Data); e != nil {
			return nil, e
		}
		if e := json.Unmarshal(err, &s.Errors); e != nil {
			return nil, e
		}
		out = append(out, s)
	}
	return out, res.Err()
}

// apply writes the rows of a commit: new person cards, updates of matched people and new work functions. It
// returns the number of work functions added.
func apply(ctx context.Context, tx pgx.Tx, rows []checked) (int, error) {
	profiles := 0
	for i := range rows {
		c := &rows[i]
		var err error
		switch c.Action {
		case accessapi.Create:
			err = tx.QueryRow(ctx, `insert into people.person_profiles (full_name, email, phone, home_unit_id)
				values ($1, $2, $3, $4) returning id`, c.Data.FullName, nonEmpty(c.Email), nonEmpty(c.Data.Phone), c.Unit).Scan(&c.Person)
		case accessapi.Update:
			_, err = tx.Exec(ctx, `update people.person_profiles
				set full_name = $2, email = coalesce($3, email), phone = coalesce($4, phone), home_unit_id = $5,
				    revision = revision + 1
				where id = $1`, c.Person, c.Data.FullName, nonEmpty(c.Email), nonEmpty(c.Data.Phone), c.Unit)
		case accessapi.Skip, accessapi.Error:
			continue
		}
		if err != nil {
			return 0, fmt.Errorf("row %d: %w", c.Line, err)
		}
		if !c.NewProfile {
			continue
		}
		_, err = tx.Exec(ctx, `insert into people.work_profiles (person_id, function, unit_id, valid)
			values ($1, $2, $3, tstzrange($4::timestamptz, null))`, c.Person, c.Function, c.Unit, *c.From)
		var pe *pgconn.PgError
		if errors.As(err, &pe) && pe.Code == "23P01" {
			return 0, kit.Conflict(fmt.Sprintf("Строка %d: у сотрудника уже есть эта функция в этот период.", c.Line))
		}
		if err != nil {
			return 0, fmt.Errorf("row %d work function: %w", c.Line, err)
		}
		profiles++
	}
	return profiles, nil
}

func nonEmpty(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}

// finishImport marks the import committed and replaces its rows with the result of the commit.
func finishImport(ctx context.Context, tx pgx.Tx, h header, committedBy uuid.UUID, rows []checked) (header, error) {
	out, err := scanHeader(tx.QueryRow(ctx, `update people.imports i
		set state = 'committed', committed_by = $2, committed_at = $3, totals = $4, revision = revision + 1
		where i.id = $1
		returning `+importColumns, h.ID, committedBy, *h.CommittedAt, h.Totals))
	if err != nil {
		return header{}, fmt.Errorf("import: %w", err)
	}
	if _, err := tx.Exec(ctx, `delete from people.import_rows where import_id = $1`, h.ID); err != nil {
		return header{}, fmt.Errorf("import rows: %w", err)
	}
	return out, insertRows(ctx, tx, h.ID, rows)
}

// PurgeResult is what Purge removed.
type PurgeResult struct {
	Expired int64 // previews past their expiry: rows deleted, state expired
	Deleted int64 // expired previews deleted with their header ExpiredTTL after the expiry
	Purged  int64 // committed imports whose rows were deleted after RowsTTL
}

// TxBeginner is a pool of the tenant DB.
type TxBeginner interface {
	Begin(ctx context.Context) (pgx.Tx, error)
}

// Purge is the cleaner of imports (Q-W0.08-5, 152-FZ) at the moment now: an uncommitted preview past its expiry
// loses its rows (the personal data) at once and becomes expired; its header is deleted ExpiredTTL later, until
// then getPeopleImport shows state=expired and commitPeopleImport answers 409, as the contract says (Q-W1.05-17).
// The rows of an import committed more than RowsTTL ago are deleted, the import keeps its file name, totals and
// audit and gets rows_purged_at. It is idempotent: run it per tenant on a schedule.
func Purge(ctx context.Context, db TxBeginner, now time.Time) (PurgeResult, error) {
	tx, err := db.Begin(ctx)
	if err != nil {
		return PurgeResult{}, err
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	res, err := purge(ctx, tx, now)
	if err != nil {
		return res, err
	}
	return res, tx.Commit(ctx)
}

// purge is Purge in the transaction tx (createPeopleImport cleans the tenant up in its own transaction).
func purge(ctx context.Context, tx pgx.Tx, now time.Time) (PurgeResult, error) {
	var res PurgeResult
	expired, err := tx.Query(ctx, `update people.imports set state = 'expired'
		where state = 'previewed' and expires_at <= $1 returning id`, now)
	if err != nil {
		return res, fmt.Errorf("expired previews: %w", err)
	}
	gone, err := pgx.CollectRows(expired, pgx.RowTo[uuid.UUID])
	if err != nil {
		return res, fmt.Errorf("expired previews: %w", err)
	}
	if len(gone) > 0 {
		if _, err := tx.Exec(ctx, `delete from people.import_rows where import_id = any($1)`, gone); err != nil {
			return res, fmt.Errorf("expired preview rows: %w", err)
		}
	}
	res.Expired = int64(len(gone))
	tag, err := tx.Exec(ctx, `delete from people.imports where state = 'expired' and expires_at <= $1`, now.Add(-ExpiredTTL))
	if err != nil {
		return res, fmt.Errorf("expired imports: %w", err)
	}
	res.Deleted = tag.RowsAffected()
	rows, err := tx.Query(ctx, `select id from people.imports
		where state = 'committed' and rows_purged_at is null and committed_at <= $1
		for update skip locked`, now.Add(-RowsTTL))
	if err != nil {
		return res, fmt.Errorf("committed imports: %w", err)
	}
	ids, err := pgx.CollectRows(rows, pgx.RowTo[uuid.UUID])
	if err != nil {
		return res, fmt.Errorf("committed imports: %w", err)
	}
	if len(ids) > 0 {
		if _, err := tx.Exec(ctx, `delete from people.import_rows where import_id = any($1)`, ids); err != nil {
			return res, fmt.Errorf("import rows: %w", err)
		}
		if _, err := tx.Exec(ctx, `update people.imports set rows_purged_at = $2 where id = any($1)`, ids, now); err != nil {
			return res, fmt.Errorf("rows_purged_at: %w", err)
		}
	}
	res.Purged = int64(len(ids))
	return res, nil
}
