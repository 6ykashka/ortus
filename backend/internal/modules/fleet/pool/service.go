// Package pool is the inter-company driver pool of the tag Fleet (W2.07, S2-14, AUTH-06/07, D09, AC-06; contract
// 0.6.0-stage2 of W2.51). The releasing company publishes a free driver of its own for a bounded window
// (publishDriverToPool) under a pseudonymous label «Водитель #N»; other companies see only the minimal catalog
// (listAvailableDrivers) and request the driver for a trip of their own inside the free window (requestDriverTransfer);
// the releasing manager or the owner decides (decideDriverTransfer). An approval puts the driver on the trip and gives
// him a temporary assignment (W2.57, Q-W2.07-1 «только рейс») of the system role «Временный водитель» — a row of
// access.role_assignments with source transfer in scope self, valid for the window: the trips he drives, their
// inspections, expenses, reservations (read) and files, no tasks, knowledge, calendar, earnings or vehicles of the
// company; the vehicle of the trip — a second row of the role in scope resource while the window lasts. The
// revocation ends the grant at once; of a started trip it keeps only the continuation (D09). The releasing side may
// extend the window (decision extend).
//
// Time settles itself (Settle): an open request expires at the start of its window, an approved transfer completes at
// its end; a started trip (from on_route) keeps its temporary driver (closing, overdue until it is handed over) until
// it is accepted or cancelled, a trip he did not start loses him; the acceptance, the cancellation and taking the
// driver off the trip end the grant at once. Reads show the settled state at the clock of the application; the worker
// persists it for the tenant (SettleTenant), the commands of the base that move a trip for that trip (SettleTrip). Lock
// order: the trip, then its transfers. The gateway closes the access of a trip not started at the end of the window by
// the validity of the grant alone; the overlay (Server) narrows the trip of a transfer to its state for its driver
// whatever other grant he has (TripAccess: none before and after, the continuation only while closing).
//
// Access: publications — fleet.driver_transfers.read and .approve over the home company of the driver; the catalog
// and the request — fleet.driver_transfers.request over the requesting company; the transfers — read over either
// company, the decision — approve over the releasing one (the owner — any). Another tenant, another company and a
// missing id get the same 404 (AC-01, AC-02).
package pool

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"log/slog"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.07: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Actions of the catalog (api/permissions.yaml; Q-W2.51-1: publication and withdrawal are approve — the power of the
// source company to release a driver).
const (
	actionRead        = "fleet.driver_transfers.read"
	actionRequest     = "fleet.driver_transfers.request"
	actionApprove     = "fleet.driver_transfers.approve"
	actionUnitsRead   = "org_units.read"
	actionTripsRead   = "fleet.trips.read"
	functionDriver    = "driver"
	sourceTransfer    = "transfer"
	targetPublication = "fleet.pool_publication"
	targetTransfer    = "fleet.driver_transfer"
)

// Keys of the audit rows and the events of a transfer.
const (
	keyPublication = "publicationId"
	keySource      = "sourceOrgUnitId"
	keyTarget      = "targetOrgUnitId"
)

// Outbox events of the module.
const (
	eventPublished = "fleet.pool.published.v1"
	eventWithdrawn = "fleet.pool.withdrawn.v1"
	eventRequested = "fleet.driver_transfer.requested.v1"
	eventDecided   = "fleet.driver_transfer.decided.v1"
	eventSettled   = "fleet.driver_transfer.settled.v1"
	// W2.57: the temporary assignment (12-errors-and-events «fleet.transfer.approved.v1 / .revoked.v1 / .expired.v1»).
	eventApproved = "fleet.transfer.approved.v1"
	eventRevoked  = "fleet.transfer.revoked.v1"
	eventExpired  = "fleet.transfer.expired.v1"
)

// The system role «Временный водитель» (api/permissions.yaml role_templates.temporary_driver, Q-W2.07-1): the approval
// creates it in the tenant once and assigns it; it is never assigned by hand (a system role, createAssignment — 409).
const (
	templateTemporaryDriver = "temporary_driver"
	nameTemporaryDriver     = "Временный водитель"
)

// Problem codes of the tag Fleet (api/errors.yaml).
const codeUnavailable = "resources_unavailable" // canonical driver_unavailable of 0.1

// SQLSTATE of the violations the commands translate.
const (
	codeUniqueViolation    = "23505"
	codeExclusionViolation = "23P01"
)

// Texts of the answers (the MSW of W2.51 — fleet/pool.ts).
const (
	textUnit             = "Подразделение не найдено."
	textDriver           = "Проверьте водителя."
	textWindow           = "Проверьте срок."
	textWindowPast       = "Окно уже прошло."
	textPublished        = "Водитель уже опубликован в пуле на это время."
	textDriverOnTrip     = "Водитель занят в это время: рейс "
	textPublicationFound = "Публикация не найдена."
	textWithdrawn        = "Водитель уже снят из пула."
	textNotPublished     = "Водитель не опубликован в пуле."
	textSource           = "Фирма-источник — домашняя фирма водителя."
	textOutside          = "Срок вне свободного окна водителя."
	textTripNotFound     = "Рейс не найден."
	textTripOther        = "Рейс другой фирмы."
	textTripDriver       = "У рейса уже есть водитель."
	textRequested        = "Запрос уже отправлен"
	textTransferNotFound = "Запрос не найден."
	textDecided          = "Запрос уже рассмотрен."
	textTripStarted      = "Рейс уже начат или закрыт."
	textDriverBusy       = "Водитель уже назначен в это время."
)

// Answers without a detail of the module: the interface shows the canonical text of the code (errors.ts). The schema
// validator checks the limits of the bodies first (maxItems, maxLength); MSW W2.51 has no texts for them, nor for a
// tenant whose role «Водитель» is archived.
const (
	textLimit  = ""
	textNoRole = ""
)

// Limits of the contract (DriverPoolPublicationCreate, DriverTransferCreate, DriverTransferDecision).
const (
	maxQualifications = 20
	maxQualification  = 100
	maxTerms          = 500
	maxComment        = 2000
)

// Pools reaches tenant DBs (tenantctx.Pools: sentinel-checked, never a fallback database).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// Service implements the operations of the pool. Every statement goes to the tenant DB of the request only (AC-02).
type Service struct {
	Pools      Pools
	Authz      *authz.Evaluator
	Recipients inbox.Recipients // the membership of a person (control DB) for the notifications; nil: none sent
	Owners     Owners           // the owners of a tenant (control DB), recipients besides the holders; nil: holders only
	Audience   inbox.Audience   // the check of a recipient when a notification is enqueued (W1.10); nil: none sent
	Now        func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
	Log        *slog.Logger     // nil: the failures of the settlement after a command of the base are not logged
	// SettleTimeout bounds the settlement after a command of the base (0: DefaultSettleTimeout).
	SettleTimeout time.Duration
}

// DefaultSettleTimeout is how long the overlay waits for the settlement of a trip after its command.
const DefaultSettleTimeout = 5 * time.Second

func (s *Service) settleTimeout() time.Duration {
	if s.SettleTimeout > 0 {
		return s.SettleTimeout
	}
	return DefaultSettleTimeout
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// cmd is one operation of the module in its transaction: the evaluator reads the subject, the modules and the unit
// tree through tx (authz.TxSource, W1.47) at the moment of the operation.
type cmd struct {
	s   *Service
	tx  pgx.Tx
	ev  *authz.Evaluator
	tc  tenantctx.TenantContext
	now time.Time
}

// run runs fn in one transaction of the tenant DB of tc; a context without a tenant has no data (404).
func (s *Service) run(ctx context.Context, tc tenantctx.TenantContext, fn func(c *cmd) error) error {
	if tc.TenantID == uuid.Nil {
		return problem.New(problem.CodeNotFound, "")
	}
	now := s.now()
	err := kit.Tx(ctx, s.Pools, tc.TenantID, func(tx pgx.Tx) error {
		return fn(&cmd{s: s, tx: tx, ev: s.within(tx, now), tc: tc, now: now})
	})
	return dbError(err)
}

// within is the evaluator over the transaction q with the clock frozen at at.
func (s *Service) within(q authz.Querier, at time.Time) *authz.Evaluator {
	cp := *s.Authz
	src := authz.TxSource{Q: q}
	cp.Now = func() time.Time { return at }
	cp.Source = src
	if s.Authz.Units != nil {
		cp.Units = src
	}
	return &cp
}

// dbError keeps Problem errors and hides everything else behind dependency_unavailable.
func dbError(err error) error {
	if err == nil {
		return nil
	}
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

func errNoRows(err error) bool { return errors.Is(err, pgx.ErrNoRows) }

// violates reports whether err is the violation code of the constraint named (any constraint when "").
func violates(err error, code, constraint string) bool {
	pe, ok := errors.AsType[*pgconn.PgError](err)
	return ok && pe.Code == code && (constraint == "" || pe.ConstraintName == constraint)
}

// denied maps a denial of the evaluator: an invisible object (404) becomes notFound, a visible one keeps its 403.
func denied(err error, notFound error) error {
	if problem.Is(err, problem.CodeNotFound) {
		return notFound
	}
	return err
}

// anywhere reports whether the subject holds action in some scope (the owner — always).
func (c *cmd) anywhere(ctx context.Context, action string, cols authz.Columns) (bool, error) {
	if c.tc.Owner {
		return true, nil
	}
	p, err := c.ev.ScopeQuery(ctx, c.tc, action, cols, 0)
	if err != nil {
		return false, err
	}
	return p.SQL != "false", nil
}

// lock takes a transaction-scoped advisory lock of key.
func (c *cmd) lock(ctx context.Context, key string) error {
	_, err := c.tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended($1, 0))`, key)
	return err
}

// fingerprint binds a cursor to the tenant, the actor and the filters of a list.
func (c *cmd) fingerprint(parts ...string) string {
	h := sha256.New()
	for _, p := range append([]string{c.tc.TenantID.String(), c.tc.PersonID.String(), strconv.FormatBool(c.tc.Owner)}, parts...) {
		h.Write([]byte(p))
		h.Write([]byte{0})
	}
	return hex.EncodeToString(h.Sum(nil)[:12])
}

// sqlArgs collects the positional arguments of a query and the scope predicates of the evaluator after them.
type sqlArgs struct{ vals []any }

func (a *sqlArgs) add(v any) string {
	a.vals = append(a.vals, v)
	return "$" + strconv.Itoa(len(a.vals))
}

// scope returns the scope predicate of action over cols numbered after the arguments so far.
func (a *sqlArgs) scope(ctx context.Context, c *cmd, action string, cols authz.Columns) (string, error) {
	p, err := c.ev.ScopeQuery(ctx, c.tc, action, cols, len(a.vals))
	if err != nil {
		return "", err
	}
	a.vals = append(a.vals, p.Args...)
	return p.SQL, nil
}

// Result counts what a settlement of a tenant wrote: expired requests, completed transfers, grants opened and
// closed, temporary drivers taken off trips they did not start.
type Result struct {
	Expired, Completed, Opened, Closed, Unassigned int
}
