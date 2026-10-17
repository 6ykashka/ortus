//go:build integration

package vehicles

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/require"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/test/isolation/fixtures" //nolint:depguard // integration test: fixtures of W1.04
)

// requireDetail requires err to be a Problem with code and exactly the detail want.
func requireDetail(t *testing.T, err error, code, want string) {
	t.Helper()
	pe, ok := errors.AsType[*problem.Error](err)
	require.True(t, ok, "not a Problem: %v", err)
	require.Equal(t, [2]string{code, want}, [2]string{pe.Code, pe.Detail})
}

// teamOf registers a team under parent (a key of tenant A) with the rows of the unit closure.
func (e env) teamOf(t *testing.T, parent string) uuid.UUID {
	t.Helper()
	ctx, pool := t.Context(), e.pool(t, fixtures.TenantA)
	var u uuid.UUID
	require.NoError(t, pool.QueryRow(ctx, `insert into org.units (parent_id, kind, name, time_zone)
		values ($1, 'team', 'Бригада ' || left(gen_random_uuid()::text, 8), 'Europe/Moscow') returning id`,
		id(t, "unit:a."+parent)).Scan(&u))
	_, err := pool.Exec(ctx, `insert into org.unit_closure (ancestor_id, descendant_id, depth)
		select ancestor_id, $1::uuid, depth + 1 from org.unit_closure where descendant_id = $2
		union all select $1::uuid, $1::uuid, 0`, u, id(t, "unit:a."+parent))
	require.NoError(t, err)
	return u
}

// An archived unit takes no new vehicle; a plate of the fleet is not registered twice.
func TestCreateVehicleArchivedUnitAndDuplicate(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx := e.as(t, "a.manager-msk1", fixtures.TenantA)
	archived := e.teamOf(t, "msk1")
	_, err := e.pool(t, fixtures.TenantA).Exec(t.Context(), `update org.units set archived_at = now() where id = $1`, archived)
	require.NoError(t, err)
	_, err = e.create(ctx, createBody(archived, "AR "+uuid.NewString()[:6]))
	requireDetail(t, err, "validation_failed", textUnitArchived)

	plate := "DU " + uuid.NewString()[:6]
	_, err = e.create(ctx, createBody(id(t, "unit:a.msk1"), plate))
	require.NoError(t, err)
	_, err = e.create(ctx, createBody(id(t, "unit:a.msk1"), plate))
	requireDetail(t, err, "validation_failed", textDuplicate)
}

// createVehicle checks its unit in its own transaction, under a lock of the unit row: a vehicle is not registered in a
// unit an archiving transaction is about to commit (the check outside the transaction saw the unit live and the
// insert went on — the foreign key does not wait for an update of the archive column).
func TestCreateVehicleWaitsForAnArchiveInProgress(t *testing.T) {
	t.Parallel()
	e := newEnv(t)
	ctx, pool := t.Context(), e.pool(t, fixtures.TenantA)
	u := e.teamOf(t, "msk1")
	archive, err := pool.Begin(ctx)
	require.NoError(t, err)
	defer func() { _ = archive.Rollback(context.WithoutCancel(ctx)) }()
	var pid int
	require.NoError(t, archive.QueryRow(ctx, `select pg_backend_pid()`).Scan(&pid))
	_, err = archive.Exec(ctx, `update org.units set archived_at = now(), revision = revision + 1 where id = $1`, u)
	require.NoError(t, err)

	type result struct {
		resp fleetapi.CreateVehicleResponseObject
		err  error
	}
	done, manager := make(chan result, 1), e.as(t, "a.manager-msk1", fixtures.TenantA)
	b := createBody(u, "AW "+uuid.NewString()[:6])
	go func() {
		resp, err := e.create(manager, b)
		done <- result{resp, err}
	}()
	deadline := time.Now().Add(10 * time.Second)
	for blocked := false; !blocked; {
		select {
		case r := <-done:
			t.Fatalf("createVehicle did not wait for the archive in progress: %T %v", r.resp, r.err)
		default:
		}
		require.True(t, time.Now().Before(deadline), "createVehicle neither waits nor finishes")
		var n int
		require.NoError(t, pool.QueryRow(ctx, `select count(*) from pg_stat_activity
			where datname = current_database() and $1 = any(pg_blocking_pids(pid))`, pid).Scan(&n))
		blocked = n > 0
		time.Sleep(20 * time.Millisecond)
	}
	require.NoError(t, archive.Commit(ctx))
	select {
	case r := <-done:
		requireDetail(t, r.err, "validation_failed", textUnitArchived)
	case <-time.After(30 * time.Second):
		t.Fatal("createVehicle did not finish after the archive")
	}
}
