package kit

import (
	"context"
	"slices"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// DB is a pgx pool or transaction.
type DB interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// TemplateDriver is the role template with the work function driver (api/permissions.yaml role_templates.driver).
const TemplateDriver = "driver"

// Details of separation_of_duties_conflict — the texts of the server of the prototype (ortus/api.js:412–443).
const (
	DetailDriverGetsEarnings = "Функция «Водитель» несовместима с правом на начисления (правило MVP)."
	DetailEarningsGetsDriver = "У сотрудника есть финансовые права. Совмещение с функцией «Водитель» в MVP запрещено."
	DetailDriverRole         = "Роль с функцией «Водитель» не может содержать начисления"
	DetailRoleHeldByDriver   = "Роль назначена водителю — финансовые права недоступны"
)

// ClosedByDriver returns the actions of the catalog the work function driver closes (blocked_by_function), sorted.
func ClosedByDriver(p authz.Policy) []string {
	var out []string
	for a := range p.BlockedBy {
		if p.Blocked(a, []string{authz.FunctionDriver}) {
			out = append(out, a)
		}
	}
	slices.Sort(out)
	return out
}

// DriverClosed returns the actions of actions the work function driver closes (AUTH-05: earnings).
func DriverClosed(p authz.Policy, actions []string) []string {
	var out []string
	for _, a := range actions {
		if p.Blocked(a, []string{authz.FunctionDriver}) {
			out = append(out, a)
		}
	}
	return out
}

// LockPeople takes FOR UPDATE of the cards of persons (people.person_profiles) and of their driver work functions
// (people.work_profiles), in the order of ids: createWorkProfile of W1.05 locks the card before it checks the
// earnings, updateWorkProfile — the work function. Holding them, a check of D-10 waits for such a command to commit
// and sees its function, and the command waits for this transaction and sees its grant.
func LockPeople(ctx context.Context, q DB, persons []uuid.UUID) error {
	if len(persons) == 0 {
		return nil
	}
	ids := Distinct(persons)
	if _, err := q.Exec(ctx, `select 1 from people.person_profiles where id = any($1) order by id for update`, ids); err != nil {
		return Store("lock people", err)
	}
	_, err := q.Exec(ctx, `select 1 from people.work_profiles where person_id = any($1) and function = 'driver'
		order by id for update`, ids)
	return Store("lock driver work profiles", err)
}

// DriverConflict reports whether one of persons has the work function driver for a moment of [from, until)
// (until nil — open-ended): such a person cannot get an earnings permission (D-10, AUTH-05).
func DriverConflict(ctx context.Context, q DB, persons []uuid.UUID, from time.Time, until *time.Time) (bool, error) {
	if len(persons) == 0 {
		return false, nil
	}
	var found bool
	err := q.QueryRow(ctx, `select exists (select 1 from people.work_profiles
		where person_id = any($1) and function = 'driver' and valid && tstzrange($2::timestamptz, $3::timestamptz))`,
		persons, from, until).Scan(&found)
	return found, Store("driver work profiles", err)
}

// EarningsConflict reports whether one of persons holds, directly or through a live group, an assignment that is not
// revoked, overlaps [from, until) and whose role version carries one of closed (ClosedByDriver): such a person cannot
// get the work function driver or a driver role (D-10). W1.05 calls it before createWorkProfile(driver).
func EarningsConflict(ctx context.Context, q DB, persons []uuid.UUID, closed []string, from time.Time, until *time.Time) (bool, error) {
	if len(persons) == 0 || len(closed) == 0 {
		return false, nil
	}
	var found bool
	err := q.QueryRow(ctx, `select exists (
		select 1 from access.role_assignments ra
		  join access.roles r on r.id = ra.role_id and r.archived_at is null
		  join access.role_versions rv on rv.role_id = ra.role_id and rv.version = ra.role_version
		 where ra.state <> 'revoked' and ra.valid && tstzrange($2::timestamptz, $3::timestamptz) and rv.actions && $4::text[]
		   and ((ra.principal_kind = 'person' and ra.principal_id = any($1))
		     or (ra.principal_kind = 'group' and ra.principal_id in (
		          select gm.group_id from access.group_members gm
		            join access.groups g on g.id = gm.group_id and g.archived_at is null
		           where gm.person_id = any($1)))))`,
		persons, from, until, closed).Scan(&found)
	return found, Store("earnings grants", err)
}

// Separation checks D-10 for a role (its actions and template) given to people during [from, until): a role with
// earnings to a person with the work function driver, and the role «Водитель» to a person with earnings — 409
// separation_of_duties_conflict with the text of the prototype. Before it reads the work functions it locks people
// (LockPeople; already held under InPeopleTx).
func Separation(ctx context.Context, q DB, p authz.Policy, actions []string, template string, people []uuid.UUID, from time.Time, until *time.Time) error {
	if len(DriverClosed(p, actions)) > 0 {
		if err := LockPeople(ctx, q, people); err != nil {
			return err
		}
		conflict, err := DriverConflict(ctx, q, people, from, until)
		if err != nil {
			return err
		}
		if conflict {
			return Conflict(CodeSeparationOfDuties, DetailDriverGetsEarnings)
		}
	}
	if template != TemplateDriver {
		return nil
	}
	conflict, err := EarningsConflict(ctx, q, people, ClosedByDriver(p), from, until)
	if err != nil {
		return err
	}
	if conflict {
		return Conflict(CodeSeparationOfDuties, DetailEarningsGetsDriver)
	}
	return nil
}

// RoleHeldByDriver reports whether a not revoked, not ended assignment of role reaches, directly or through a live
// group, a person with the work function driver during the assignment. It locks the holders of the role first
// (LockPeople; already held under InPeopleTx).
func RoleHeldByDriver(ctx context.Context, q DB, role uuid.UUID, now time.Time) (bool, error) {
	holders, err := Holders(ctx, q, role)
	if err != nil {
		return false, err
	}
	if err := LockPeople(ctx, q, holders); err != nil {
		return false, err
	}
	var found bool
	err = q.QueryRow(ctx, `select exists (
		select 1 from access.role_assignments ra
		  join people.work_profiles wp on wp.function = 'driver' and wp.valid && ra.valid
		 where ra.role_id = $1 and ra.state <> 'revoked' and (upper_inf(ra.valid) or upper(ra.valid) > $2)
		   and ((ra.principal_kind = 'person' and wp.person_id = ra.principal_id)
		     or (ra.principal_kind = 'group' and wp.person_id in (
		          select gm.person_id from access.group_members gm
		            join access.groups g on g.id = gm.group_id and g.archived_at is null
		           where gm.group_id = ra.principal_id))))`, role, now).Scan(&found)
	return found, Store("role holders", err)
}
