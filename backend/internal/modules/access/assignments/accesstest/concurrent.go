package accesstest

import (
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

// HoldPolicy opens a transaction of the tenant DB that holds the row of access.policy_state, as a concurrent command
// of the module — or createWorkProfile(driver) of W1.05 — holds it (kit.LockPolicy) until it commits. The test runs
// sql (the effect of that command) in it and commits or rolls it back.
func (w *World) HoldPolicy(sql string, args ...any) pgx.Tx {
	w.tb.Helper()
	tx, err := w.Tenant.Begin(w.ctx())
	if err != nil {
		w.tb.Fatal(err)
	}
	w.tb.Cleanup(func() { _ = tx.Rollback(w.ctx()) })
	if _, err := tx.Exec(w.ctx(), `select 1 from access.policy_state for update`); err != nil {
		w.tb.Fatalf("lock policy_state: %v", err)
	}
	if sql != "" {
		if _, err := tx.Exec(w.ctx(), sql, args...); err != nil {
			w.tb.Fatalf("held transaction: %s: %v", sql, err)
		}
	}
	return tx
}

// Pause is how long a command must keep waiting for a held lock to count as serialized behind it.
const Pause = 400 * time.Millisecond

// Async runs fn in a goroutine; Wait returns its error.
type Async struct{ done chan error }

// Go starts fn.
func Go(fn func() error) *Async {
	a := &Async{done: make(chan error, 1)}
	go func() { a.done <- fn() }()
	return a
}

// Running reports whether fn has not finished within d.
func (a *Async) Running(d time.Duration) bool {
	select {
	case err := <-a.done:
		a.done <- err
		return false
	case <-time.After(d):
		return true
	}
}

// Wait returns the error of fn.
func (a *Async) Wait() error { return <-a.done }

// HoldTenantRow opens a transaction of the control DB that holds FOR UPDATE of the tenant row, as a concurrent owner
// change, invitation or acceptance holds it; the test commits or rolls it back.
func (w *World) HoldTenantRow() pgx.Tx {
	w.tb.Helper()
	tx, err := w.Control.Begin(w.ctx())
	if err != nil {
		w.tb.Fatal(err)
	}
	w.tb.Cleanup(func() { _ = tx.Rollback(w.ctx()) })
	if _, err := tx.Exec(w.ctx(), `select id from tenants where id = $1 for update`, w.TenantID); err != nil {
		w.tb.Fatalf("lock tenant: %v", err)
	}
	return tx
}

// PolicyFree reports whether nobody holds the row of access.policy_state (FOR UPDATE NOWAIT succeeds).
func (w *World) PolicyFree() bool {
	w.tb.Helper()
	tx, err := w.Tenant.Begin(w.ctx())
	if err != nil {
		w.tb.Fatal(err)
	}
	defer func() { _ = tx.Rollback(w.ctx()) }()
	_, err = tx.Exec(w.ctx(), `select 1 from access.policy_state for update nowait`)
	return err == nil
}

// FailTenantCommitOn makes the COMMIT of a tenant transaction fail when it recorded an audit event of one of actions
// (a deferred constraint trigger): the failure of the tenant DB after the control DB has committed.
func (w *World) FailTenantCommitOn(actions ...string) {
	w.tb.Helper()
	w.tenantExec(`create function public.accesstest_fail_commit() returns trigger language plpgsql as $$
		begin if exists (select 1 from public.accesstest_fail_actions where action = new.action) then raise exception 'accesstest: the tenant DB refuses to commit %', new.action; end if; return null; end $$`)
	w.tenantExec(`create table public.accesstest_fail_actions (action text primary key)`)
	w.tenantExec(`insert into public.accesstest_fail_actions select unnest($1::text[])`, actions)
	w.tenantExec(`create constraint trigger accesstest_fail_commit after insert on audit.events deferrable initially deferred
		for each row when (new.action is not null) execute function public.accesstest_fail_commit()`)
}

// Break renames tables of the tenant DB (schema.table): every statement over them fails — a failure of the database
// the handlers answer with 503 dependency_unavailable.
func (w *World) Break(tables ...string) {
	w.tb.Helper()
	for _, t := range tables {
		_, name, _ := strings.Cut(t, ".")
		w.tenantExec(`alter table ` + t + ` rename to ` + name + `_broken`)
	}
}
