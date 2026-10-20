package calendar

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Pools reaches the database of a tenant (tenantctx.Pools: sentinel-checked, never a fallback database).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// Modules reports the states of the installable modules of a tenant by module key (modulesreg: active, draining,
// read_only, disabled; a module without a row is not installed).
type Modules interface {
	States(ctx context.Context, tenantID uuid.UUID) (map[string]string, error)
}

// Service answers the operations of the tag Calendar.
type Service struct {
	Pools   Pools
	Authz   *authz.Evaluator
	Modules Modules          // nil: no installable module is installed
	Now     func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

// Actions of the catalog (api/permissions.yaml) the calendar decides on.
const (
	actionRead          = "calendar.bookings.read"
	actionManage        = "calendar.bookings.manage"
	actionAvailability  = "calendar.availability.read"
	actionVehiclesRead  = "fleet.vehicles.read"
	actionTripsRead     = "fleet.trips.read"
	actionHoldsRead     = "fleet.reservations.read"
	actionAppointments  = "spa.appointments.read"
	moduleFleet         = "fleet"
	moduleSpa           = "spa"
	stateActive         = "active"
	defaultZone         = "Europe/Moscow"
	textBookingNotFound = "Бронь не найдена."
	textUnitNotFound    = "Подразделение не найдено."
)

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// request is one operation of a member: its transaction, the evaluator reading through it with the clock frozen at
// the start, the module states and the instant of the operation.
type request struct {
	tc     tenantctx.TenantContext
	tx     pgx.Tx
	ev     *authz.Evaluator
	states map[string]string
	now    time.Time
}

func (r *request) active(module string) bool { return r.states[module] == stateActive }

// run runs fn in one transaction of the tenant DB of tc (read only unless write) with the evaluator over it; an error
// rolls it back, a Problem error keeps its code and anything else is dependency_unavailable.
func (s *Service) run(ctx context.Context, tc tenantctx.TenantContext, write bool, fn func(*request) error) error {
	if tc.TenantID == uuid.Nil {
		return problem.New(problem.CodeNotFound, "")
	}
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	opts := pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}
	if write {
		opts = pgx.TxOptions{}
	}
	tx, err := pool.BeginTx(ctx, opts)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }() // after Commit — a no-op
	r := &request{tc: tc, tx: tx, now: s.now(), states: map[string]string{}}
	if s.Modules != nil {
		states, err := s.Modules.States(ctx, tc.TenantID)
		if err != nil {
			return dependency(err)
		}
		if states != nil {
			r.states = states
		}
	}
	r.ev = s.within(tx, r.now)
	if err := fn(r); err != nil {
		return dependency(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return dependency(err)
	}
	return nil
}

// within is the evaluator of s reading through q with the clock frozen at now (W1.47): an operation holds one
// connection of the tenant DB at most.
func (s *Service) within(q authz.Querier, now time.Time) *authz.Evaluator {
	cp := *s.Authz
	src := authz.TxSource{Q: q}
	cp.Now = func() time.Time { return now }
	cp.Source = src
	if s.Authz.Units != nil {
		cp.Units = src
	}
	return &cp
}

// dependency keeps a Problem error (with or without violations) and reports anything else as dependency_unavailable
// (the cause stays in the log).
func dependency(err error) error {
	if _, ok := asFields(err); ok {
		return err
	}
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

// scoped runs sql with the scope predicate of action over cols in place of {{scope}} (the rule of scopeddb: no
// statement of a tenant module without the predicate of the evaluator); the predicate's arguments follow args.
func (r *request) scoped(ctx context.Context, action string, cols authz.Columns, sql string, args ...any) (pgx.Rows, error) {
	if strings.Count(sql, scopePlaceholder) != 1 {
		return nil, errNoScope
	}
	p, err := r.ev.ScopeQuery(ctx, r.tc, action, cols, len(args))
	if err != nil {
		return nil, err
	}
	return r.tx.Query(ctx, strings.Replace(sql, scopePlaceholder, "("+p.SQL+")", 1), append(args, p.Args...)...)
}

const scopePlaceholder = "{{scope}}"

var errNoScope = errors.New("calendar: the statement must contain exactly one " + scopePlaceholder)

// zoneOf is the time zone of the organization for the member of r: the zone of its home unit, else of the first root
// unit, else Europe/Moscow (as the export of W2.50).
func (r *request) zoneOf(ctx context.Context) (*time.Location, error) {
	name := defaultZone
	err := r.tx.QueryRow(ctx, `select coalesce(
		(select u.time_zone from people.person_profiles p join org.units u on u.id = p.home_unit_id where p.id = $1),
		(select u.time_zone from org.units u where u.parent_id is null and u.archived_at is null order by u.name, u.id limit 1),
		$2)`, r.tc.PersonID, defaultZone).Scan(&name)
	if err != nil {
		return nil, fmt.Errorf("calendar: zone: %w", err)
	}
	return location(name), nil
}

// location loads an IANA zone; an unknown name falls back to Europe/Moscow (the pilot is in Moscow).
func location(name string) *time.Location {
	if loc, err := time.LoadLocation(name); err == nil && name != "" && !strings.EqualFold(name, "local") {
		return loc
	}
	loc, err := time.LoadLocation(defaultZone)
	if err != nil {
		return time.UTC
	}
	return loc
}

// codeExclusionViolation is the SQLSTATE of a violated EXCLUDE constraint (reservations_no_overlap).
const codeExclusionViolation = "23P01"

func isOverlap(err error) bool {
	pe, ok := errors.AsType[*pgconn.PgError](err)
	return ok && pe.Code == codeExclusionViolation
}
