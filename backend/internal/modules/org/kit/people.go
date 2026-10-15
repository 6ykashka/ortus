package kit

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// States of a work function (WorkProfile.state), derived from its period and the clock.
const (
	StateScheduled = "scheduled"
	StateActive    = "active"
	StateEnded     = "ended"
)

// FunctionDriver is the work function that closes the earnings (AUTH-05, ADR-0011).
const FunctionDriver = "driver"

// functions maps the work functions of the contract to people.work_profiles.function (tenant 0001). The function
// worker of the table has no function of the contract and is not shown.
var functions = map[string]string{
	"driver":       "driver",
	"foreman":      "foreman",
	"practitioner": "therapist",
	"manager":      "dispatcher",
}

// FunctionToDB returns the function of people.work_profiles for a function of the contract.
func FunctionToDB(api string) (string, bool) {
	db, ok := functions[api]
	return db, ok
}

// FunctionFromDB returns the function of the contract for a function of people.work_profiles.
func FunctionFromDB(db string) (string, bool) {
	for api, v := range functions {
		if v == db {
			return api, true
		}
	}
	return "", false
}

// WorkState is the state of a period [from, until) at now.
func WorkState(from time.Time, until *time.Time, now time.Time) string {
	switch {
	case now.Before(from):
		return StateScheduled
	case until != nil && !now.Before(*until):
		return StateEnded
	}
	return StateActive
}

// DayStart is the midnight of the day of now in loc.
func DayStart(now time.Time, loc *time.Location) time.Time {
	y, m, d := now.In(loc).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, loc)
}

// TextPeriod is the error of an end of a work function out of range: the detail of the mock (people.ts badUntil);
// the message of the field («Окончание должно быть позже начала», «… не может быть в прошлом») waits for violations
// in problem.Body (Q-W1.05-14).
const TextPeriod = "Проверьте срок функции."

// CheckPeriod checks a new period of a work function: it starts today (a correction of the current day in the zone
// of the unit) or later — history is never rewritten; its end, if any, is after the start and not in the past.
func CheckPeriod(from time.Time, until *time.Time, now time.Time, loc *time.Location) error {
	switch {
	case from.Before(DayStart(now, loc)):
		return Invalid("Функция может начаться не раньше сегодняшнего дня.")
	case until != nil && (!until.After(from) || until.Before(now)):
		return Invalid(TextPeriod)
	}
	return nil
}

// DriverBlockedActions are the actions the driver function closes (blocked_by_function of api/permissions.yaml).
func DriverBlockedActions() []string {
	p := authz.DefaultPolicy()
	var out []string
	for _, a := range p.Actions {
		if p.Blocked(a, []string{FunctionDriver}) {
			out = append(out, a)
		}
	}
	slices.Sort(out)
	return out
}

// Querier is a pool or a transaction.
type Querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// earningsSQL: an active assignment of a live role of the person (directly or through a live group) whose period
// overlaps [$2, $3) and whose role version carries an action of $4.
const earningsSQL = `
select exists (
  select 1
    from access.role_assignments ra
    join access.roles r on r.id = ra.role_id and r.archived_at is null
    join access.role_versions rv on rv.role_id = ra.role_id and rv.version = ra.role_version
   where ra.state = 'active' and ra.valid && tstzrange($2::timestamptz, $3::timestamptz)
     and rv.actions && $4::text[]
     and ((ra.principal_kind = 'person' and ra.principal_id = $1)
       or (ra.principal_kind = 'group' and ra.principal_id in (
             select gm.group_id from access.group_members gm
               join access.groups g on g.id = gm.group_id and g.archived_at is null
              where gm.person_id = $1))))`

// DriverConflict reports whether the driver function of person over [from, until) meets an earnings grant: an
// owner has every action (the earnings included), a member — any direct, group or temporary assignment with an
// action the driver function closes, at any moment of the period (x-separation-of-duties, 409).
func DriverConflict(ctx context.Context, q Querier, person uuid.UUID, owner bool, from time.Time, until *time.Time) (bool, error) {
	if owner {
		return true, nil
	}
	var conflict bool
	if err := q.QueryRow(ctx, earningsSQL, person, from, until, DriverBlockedActions()).Scan(&conflict); err != nil {
		return false, fmt.Errorf("earnings grants: %w", err)
	}
	return conflict, nil
}

// CleanName trims a name and checks that it has 1…limit characters.
func CleanName(s string, limit int) (string, error) {
	n := strings.TrimSpace(s)
	if n == "" || utf8.RuneCountInString(n) > limit {
		return "", Invalid(fmt.Sprintf("Укажите имя (до %d символов).", limit))
	}
	return n, nil
}

// ValidEmail is a light check of an e-mail address: one @, a local part and a domain with a dot, no spaces.
func ValidEmail(s string) bool {
	local, domain, ok := strings.Cut(s, "@")
	return ok && local != "" && strings.Contains(domain, ".") && !strings.ContainsAny(s, " \t\r\n") &&
		!strings.Contains(domain, "@") && !strings.HasPrefix(domain, ".") && !strings.HasSuffix(domain, ".") && len(s) <= 254
}

// SetString sets *dst to a new value of its string type (generated e-mail types of the contract).
func SetString[T ~string](dst **T, s string) {
	v := T(s)
	*dst = &v
}

// Membership is what the people of a tenant DB need of their membership in the control DB.
type Membership struct {
	AccountID uuid.UUID
	Status    string // invited | active | suspended | ended
	Owner     bool   // an active owner binding
}

// Directory reads the memberships of person profiles (people.person_profiles.membership_id) in the control DB.
type Directory interface {
	Memberships(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]Membership, error)
}

// ControlDirectory is Directory over the control DB (role ortus_api: memberships, owner_bindings).
type ControlDirectory struct{ DB *pgxpool.Pool }

// Memberships implements Directory: the memberships of the tenant with these ids.
func (d ControlDirectory) Memberships(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]Membership, error) {
	out := make(map[uuid.UUID]Membership, len(ids))
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := d.DB.Query(ctx, `select m.id, m.account_id, m.status::text,
		       exists (select 1 from owner_bindings ob where ob.membership_id = m.id and ob.revoked_at is null)
		  from memberships m where m.tenant_id = $1 and m.id = any($2)`, tenantID, ids)
	if err != nil {
		return nil, fmt.Errorf("memberships: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			id uuid.UUID
			m  Membership
		)
		if err := rows.Scan(&id, &m.AccountID, &m.Status, &m.Owner); err != nil {
			return nil, fmt.Errorf("memberships: %w", err)
		}
		out[id] = m
	}
	return out, rows.Err()
}
