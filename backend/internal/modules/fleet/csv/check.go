package csv

import (
	"context"
	"errors"
	"strconv"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.50: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Actions of the catalog (api/permissions.yaml).
const (
	actionManage    = "fleet.vehicles.manage"
	actionUnitsRead = "org_units.read"
)

// Row actions of the contract (VehicleImportRow.action).
const (
	actCreate = "create"
	actUpdate = "update"
	actSkip   = "skip"
	actError  = "error"
)

// textUnknownUnit is the answer to a company that does not exist or is outside the scope (createVehicle, W1.05).
const textUnknownUnit = "Подразделение не найдено."

var (
	// errNoUnit is the row error of a company that is unknown or outside the scope: one text (Q-W2.52-17).
	errNoUnit = violation{Field: colOrgUnit, Code: "unknown", Message: textUnknownUnit}
	// errUnavailable is the row error of a vehicle outside the scope: it names neither the vehicle nor its company.
	errUnavailable = violation{Field: colPlate, Code: "unavailable", Message: "Строку нельзя импортировать"}
	errDuplicate   = violation{Field: colPlate, Code: "duplicate", Message: "Номер повторяется в файле"}
	errMove        = violation{Field: colOrgUnit, Code: "move", Message: "Перемещение машины — отдельной командой"}
	errOdometer    = violation{Field: colOdometer, Code: "odometer_decrease", Message: "Пробег не может уменьшиться"}
	errArchived    = violation{Field: colOrgUnit, Code: "archived", Message: "Подразделение в архиве."}
	errAmbiguous   = violation{Field: colOrgUnit, Code: "ambiguous", Message: "Несколько подразделений с таким названием — укажите id"}
)

// checked is a row of the file with its checked values, its action and errors, its company (the new vehicle's or
// the matched one's) and the matched or created vehicle.
type checked struct {
	record
	P       parsed
	Action  string
	Errors  []violation
	Unit    uuid.UUID
	Vehicle uuid.UUID
}

// querier is a pool or the transaction of a command.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// isDecision reports whether err is a denial of the evaluator rather than a failure.
func isDecision(err error) bool {
	return problem.Is(err, problem.CodeForbiddenAction) || problem.Is(err, problem.CodeNotFound) ||
		problem.Is(err, authz.CodeFunctionBlocked)
}

// checker checks the rows of an import against the data and fleet.vehicles.manage of the actor.
type checker struct {
	tc     tenantctx.TenantContext
	az     kit.Authorizer
	q      querier
	def    uuid.UUID
	manage map[uuid.UUID]bool
}

func newChecker(tc tenantctx.TenantContext, az kit.Authorizer, q querier, def uuid.UUID) *checker {
	return &checker{tc: tc, az: az, q: q, def: def, manage: map[uuid.UUID]bool{}}
}

// manages reports whether the actor holds fleet.vehicles.manage over unit.
func (k *checker) manages(ctx context.Context, unit uuid.UUID) (bool, error) {
	if ok, seen := k.manage[unit]; seen {
		return ok, nil
	}
	err := k.az.Permit(ctx, k.tc, actionManage, authz.Resource{Unit: unit})
	if err != nil && !isDecision(err) {
		return false, err
	}
	k.manage[unit] = err == nil
	return err == nil, nil
}

// checkAll checks every row: the static checks, then the company, the numbers repeated in the file and the vehicle
// matched by its number.
func (k *checker) checkAll(ctx context.Context, recs []record) ([]checked, error) {
	out := make([]checked, 0, len(recs))
	seen := map[string]bool{}
	for _, r := range recs {
		c := checked{record: r}
		c.P, c.Errors = checkRecord(r)
		if err := k.resolveUnit(ctx, &c); err != nil {
			return nil, err
		}
		if key := plateKey(c.P.Plate); key != "" {
			if seen[key] {
				c.Errors = append(c.Errors, errDuplicate)
			}
			seen[key] = true
		}
		if len(c.Errors) == 0 {
			if err := k.match(ctx, &c); err != nil {
				return nil, err
			}
		}
		c.Action = actCreate
		switch {
		case len(c.Errors) > 0:
			c.Action, c.Unit, c.Vehicle = actError, uuid.Nil, uuid.Nil
		case c.Vehicle != uuid.Nil:
			c.Action = actUpdate
		}
		out = append(out, c)
	}
	return out, nil
}

// resolveUnit finds the company of the row: org_unit by id or by name (case-insensitive) among the companies the actor
// manages the fleet of, else the default company of the import. An unknown company and one outside the scope are the
// same error; an archived company of the scope — its own error.
func (k *checker) resolveUnit(ctx context.Context, c *checked) error {
	raw := c.P.OrgUnit
	if raw == "" {
		c.Unit = k.def
		return nil
	}
	sql := `select id, archived_at is not null from org.units where lower(name) = lower($1)`
	arg := any(raw)
	if u, err := uuid.Parse(raw); err == nil {
		sql, arg = `select id, archived_at is not null from org.units where id = $1`, u
	}
	rows, err := k.q.Query(ctx, sql, arg)
	if err != nil {
		return err
	}
	type unit struct {
		ID       uuid.UUID
		Archived bool
	}
	units, err := pgx.CollectRows(rows, pgx.RowToStructByPos[unit])
	if err != nil {
		return err
	}
	var mine []unit
	for _, u := range units {
		ok, err := k.manages(ctx, u.ID)
		if err != nil {
			return err
		}
		if ok {
			mine = append(mine, u)
		}
	}
	switch {
	case len(mine) == 0:
		c.Errors = append(c.Errors, errNoUnit)
	case len(mine) > 1:
		c.Errors = append(c.Errors, errAmbiguous)
	case mine[0].Archived:
		c.Errors = append(c.Errors, errArchived)
	default:
		c.Unit = mine[0].ID
	}
	return nil
}

// match finds a vehicle of the tenant with the number of the row (as vehicles_plate_uq: upper case, not archived): one
// outside the scope is an error that names nothing; one of another company — moveVehicle; a lower odometer — an error.
func (k *checker) match(ctx context.Context, c *checked) error {
	var (
		vid, unit uuid.UUID
		odometer  string
	)
	err := k.q.QueryRow(ctx, `select id, unit_id, odometer_km::text from fleet.vehicles
		where upper(regexp_replace(btrim(plate), '\s+', ' ', 'g')) = $1 and archived_at is null
		order by created_at limit 1`, plateKey(c.P.Plate)).Scan(&vid, &unit, &odometer)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	ok, err := k.manages(ctx, unit)
	switch {
	case err != nil:
		return err
	case !ok:
		c.Errors = append(c.Errors, errUnavailable)
	case c.Unit != unit:
		c.Errors = append(c.Errors, errMove)
	case less(c.P.Odometer, odometer):
		c.Errors = append(c.Errors, errOdometer)
	default:
		c.Vehicle, c.Unit = vid, unit
	}
	return nil
}

// less compares two exact decimals of at most six decimals (float64 orders them exactly enough).
func less(a, b string) bool {
	x, errA := strconv.ParseFloat(strings.TrimSpace(a), 64)
	y, errB := strconv.ParseFloat(strings.TrimSpace(b), 64)
	return errA == nil && errB == nil && x < y
}
