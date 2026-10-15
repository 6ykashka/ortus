package kit

import (
	"context"
	"errors"
	"log/slog"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// ErrNoControl is the failure of a command that needs the control DB in a deployment without one.
var ErrNoControl = errors.New("access: no control DB")

// Undo compensates the change a command made in the control DB, in a new control transaction under the lock of the
// tenant row, when the tenant DB failed to commit after the control DB had committed.
type Undo func(ctx context.Context, ctl pgx.Tx) error

// LockTenant takes FOR UPDATE of the tenant row of the control DB: the first lock of every command that changes the
// owners or the invitations of a business, or depends on them (AUTH-08, Q-W1.03-12).
func LockTenant(ctx context.Context, ctl pgx.Tx, tenant uuid.UUID) error {
	var locked uuid.UUID
	err := ctl.QueryRow(ctx, `select id from tenants where id = $1 for update`, tenant).Scan(&locked)
	return Store("lock tenant", err)
}

// InControlTx runs fn for a command that reads or changes the control DB together with the tenant DB of tc. Locks
// go in one order for every such command: FOR UPDATE of the tenant row (control DB) first, then LockPolicy (tenant
// DB). The control transaction commits first, the tenant one next. PostgreSQL has no commit across the two
// databases: when the tenant commit fails after the control one, the undo fn returned runs (nil — nothing to undo)
// and the command fails with 503; a failed undo is logged for manual repair (Q-W1.06-11), and so is a failed control
// commit (on a broken connection its outcome is unknown, the tenant DB rolls back).
func (d Deps) InControlTx(ctx context.Context, tc tenantctx.TenantContext, fn func(tx, ctl pgx.Tx) (Undo, error)) error {
	return d.inControl(ctx, tc, nil, true, fn)
}

// InControlPeopleTx is InControlTx for a command that may change the rights of people (updateMember, W1.43): after the
// tenant row of the control DB it locks people (LockPeople) and only then the policy row — the order tenants → people
// → policy of every command of the module (Q-W1.03-12, Q-W1.06-14).
func (d Deps) InControlPeopleTx(ctx context.Context, tc tenantctx.TenantContext, people []uuid.UUID, fn func(tx, ctl pgx.Tx) (Undo, error)) error {
	return d.inControl(ctx, tc, people, true, fn)
}

// InControlNoPolicyTx is InControlTx without the policy row: the tenant transaction of a command of another module
// (the commit of a people import, W1.43) that takes its own locks — its people first — and raises policy_version
// itself at its end, as the commands of W1.05 do. The control DB is locked first, as for every command of a business.
func (d Deps) InControlNoPolicyTx(ctx context.Context, tc tenantctx.TenantContext, fn func(tx, ctl pgx.Tx) (Undo, error)) error {
	return d.inControl(ctx, tc, nil, false, fn)
}

func (d Deps) inControl(ctx context.Context, tc tenantctx.TenantContext, people []uuid.UUID, policy bool, fn func(tx, ctl pgx.Tx) (Undo, error)) error {
	if d.Control == nil {
		return Unavailable(ErrNoControl)
	}
	pool, err := d.Pool(ctx, tc)
	if err != nil {
		return err
	}
	ctl, err := d.Control.Begin(ctx)
	if err != nil {
		return Unavailable(err)
	}
	defer func() { _ = ctl.Rollback(context.WithoutCancel(ctx)) }() // no-op after Commit
	if err := LockTenant(ctx, ctl, tc.TenantID); err != nil {
		return err
	}
	tx, err := pool.Begin(ctx)
	if err != nil {
		return Unavailable(err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := LockPeople(ctx, tx, people); err != nil {
		return err
	}
	if policy {
		if err := LockPolicy(ctx, tx); err != nil {
			return err
		}
	}
	undo, err := fn(tx, ctl)
	if err != nil {
		return err
	}
	if err := ctl.Commit(ctx); err != nil {
		// A COMMIT that failed on the wire may still have committed on the server: the tenant DB rolls back without
		// a compensation, and the record keeps the possible gap for manual repair.
		d.log().ErrorContext(context.WithoutCancel(ctx), "access: the control DB commit failed, its outcome is unknown; the tenant DB change is rolled back",
			slog.String("tenant_id", tc.TenantID.String()), slog.String("error", err.Error()))
		return Unavailable(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return Unavailable(errors.Join(err, d.compensate(ctx, tc, undo)))
	}
	return nil
}

// compensate runs undo after a failed tenant commit.
func (d Deps) compensate(ctx context.Context, tc tenantctx.TenantContext, undo Undo) error {
	if undo == nil {
		return nil
	}
	ctx = context.WithoutCancel(ctx)
	err := func() error {
		ctl, err := d.Control.Begin(ctx)
		if err != nil {
			return err
		}
		defer func() { _ = ctl.Rollback(ctx) }()
		if err := LockTenant(ctx, ctl, tc.TenantID); err != nil {
			return err
		}
		if err := undo(ctx, ctl); err != nil {
			return err
		}
		return ctl.Commit(ctx)
	}()
	if err != nil {
		d.log().ErrorContext(ctx, "access: the control DB change is not compensated after a failed tenant commit",
			slog.String("tenant_id", tc.TenantID.String()), slog.String("error", err.Error()))
	}
	return err
}
