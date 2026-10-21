package tasks

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// RegisterContainer registers the projects of tasks in ev (W4.01, RS-08) — one registration for cmd/api and cmd/worker:
// the reads a territorial grant keeps in a limited project (ContainerReads) and the place of a project (ProjectPlaces)
// for Permit on its objects wherever it is asked. It returns ev.
func RegisterContainer(ev *authz.Evaluator, pools Pools) *authz.Evaluator {
	if ev.ContainerReads == nil {
		ev.ContainerReads = map[string][]string{}
	}
	ev.ContainerReads[authz.KindProject] = ContainerReads()
	if ev.Places == nil {
		ev.Places = map[string]authz.ObjectResolver{}
	}
	ev.Places[authz.KindProject] = ProjectPlaces{Pools: pools}
	return ev
}

// ProjectPlaces places the projects of tasks for the evaluator (Evaluator.Places[project], ADR-0014 п.4, W4.01): the
// area of the project and its level of access (a funnel is open), so a Permit on an object of a project — a task or
// a file of a task — follows TP-03 wherever it is asked. A missing project has no place.
type ProjectPlaces struct{ Pools Pools }

var _ authz.ObjectResolver = ProjectPlaces{}

// Place implements authz.ObjectResolver.
func (pl ProjectPlaces) Place(ctx context.Context, tenantID, id uuid.UUID) (authz.Place, error) {
	pool, err := pl.Pools.For(ctx, tenantID)
	if err != nil {
		return authz.Place{}, err
	}
	var (
		unit      *uuid.UUID
		flow, lvl string
	)
	err = pool.QueryRow(ctx, `select org_unit_id, flow, coalesce(access, '') from tasks.projects where id = $1`, id).Scan(&unit, &flow, &lvl)
	switch {
	case noRows(err):
		return authz.Place{}, nil
	case err != nil:
		return authz.Place{}, fmt.Errorf("tasks: place of project %s: %w", id, err)
	}
	p := project{Flow: flow, Access: lvl}
	place := authz.Place{Container: authz.ProjectContainer(authz.Level(p.level()))}
	if unit != nil {
		place.Unit = *unit
	}
	return place, nil
}

// The parent «tasks/task» of the files (UploadCreate.owner, files.ParentKind of cmd/api; Q-W4.02-10: an attachment is
// uploaded after the task is created): an attachment of a task is read with tasks.read on the task — the area of its
// project, the project (its container, Evaluator.Places), the assignee (scope self) and the author; a deleted task or
// one the subject does not read (HiddenTasks through the Hider of cmd/api) has no row. «{{id}}» and «{{hidden}}» are
// files.IDPlaceholder and files.HiddenPlaceholder.
const (
	FileModule     = "tasks"
	FileEntity     = "task"
	FilePurpose    = purposeAttachment
	FileReadAction = actRead
	FileRows       = `select p.org_unit_id as unit_id, t.project_id, t.assignee_id as person_a, t.author_id as person_b,
       coalesce(t.legacy_key, p.key || '-' || t.number) as title
  from tasks.tasks t join tasks.projects p on p.id = t.project_id
 where t.id = {{id}} and t.deleted_at is null and t.id <> all({{hidden}})`
)

// HiddenTasks are the tasks of the tenant the subject of tc does not read (a closed project without a role in it —
// TP-03, the owner too; a project out of the area): the parent «tasks/task» of the files leaves them out of listFiles
// (files.Hider of cmd/api). The predicate is the scope of tasks.read of the evaluator.
type HiddenTasks struct {
	Pools Pools
	Authz *authz.Evaluator
}

// Hidden returns the ids of the tasks tc does not read.
func (h HiddenTasks) Hidden(ctx context.Context, tc tenantctx.TenantContext) ([]uuid.UUID, error) {
	pool, err := h.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return nil, err
	}
	s := &Service{Authz: h.Authz}
	var out []uuid.UUID
	err = pgx.BeginTxFunc(ctx, pool, pgx.TxOptions{AccessMode: pgx.ReadOnly}, func(tx pgx.Tx) error {
		ev := s.within(tx, h.now())
		pred, err := ev.ScopeQuery(ctx, tc, actRead, taskColumns, 0)
		if err != nil {
			return err
		}
		ids, err := collect[uuid.UUID](ctx, tx, `select t.id from tasks.tasks t join tasks.projects p on p.id = t.project_id
			where not coalesce((`+pred.SQL+`), false)`, pred.Args...)
		out = ids
		return err
	})
	if err != nil {
		return nil, fmt.Errorf("tasks: hidden tasks: %w", err)
	}
	return out, nil
}

func (h HiddenTasks) now() time.Time {
	if h.Authz != nil && h.Authz.Now != nil {
		return h.Authz.Now()
	}
	return time.Now()
}
