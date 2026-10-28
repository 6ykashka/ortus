package main

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	publicserviceapi "github.com/ortus/ortus-crm/backend/internal/api/publicservice"
	serviceapi "github.com/ortus/ortus-crm/backend/internal/api/service"
	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	homeservice "github.com/ortus/ortus-crm/backend/internal/modules/home/service"
	"github.com/ortus/ortus-crm/backend/internal/modules/service"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// newService is the module «Обращения» (W7.31): the tags Service and PublicService over the tenant pools, the evaluator
// and the clock of the application (APP_FIXED_NOW outside prod). The control DB gives the memberships (who owns the
// business, who works) and the index of the portal (the tokens of the personal links and the slugs of the pages); the
// tasks of a request and the service project of a new direction are made through the module «Задачи». A refund of a
// compensation stays a record in the request: the contract has no sum for the proposal to the cash (Q-W7.31-4).
func newService(pools service.Pools, ev *authz.Evaluator, control service.ControlDB, now func() time.Time) *service.Service {
	taskSvc := &tasks.Service{Pools: pools, Authz: ev, Directory: tasks.ControlDirectory{DB: control}, Audience: inbox.AuthzAudience{E: ev}, Now: now}
	s := &service.Service{Pools: pools, Authz: ev, Tasks: serviceTasks{S: taskSvc}, Projects: serviceProjects{S: taskSvc}, Audience: inbox.AuthzAudience{E: ev}, Now: now}
	if control != nil { // without the control DB (tests of the wiring) the portal and the memberships are off
		s.Directory, s.Index = service.ControlDirectory{DB: control}, service.PGIndex{DB: control}
	}
	return s
}

// serviceServers are the strict servers of the two tags; origins is the allowlist of the Origin of the clients of the portal.
func serviceServers(s *service.Service, origins []string) (serviceapi.StrictServerInterface, publicserviceapi.StrictServerInterface) {
	return service.Server{S: s}, service.PublicServer{S: s, Origins: service.Origins(origins)}
}

// serviceWiring is «Обращения» as build assembles it: the service, the strict servers of both tags and the period of
// the worker of the terms.
type serviceWiring struct {
	svc    *service.Service
	every  time.Duration
	staff  serviceapi.StrictServerInterface
	public publicserviceapi.StrictServerInterface
}

// newServiceWiring makes the module with its servers (the portal answers to the allowlist of the guests of public forms)
// and reads SERVICE_SWEEP_INTERVAL.
func newServiceWiring(pools service.Pools, ev *authz.Evaluator, control service.ControlDB, cfg config, getenv func(string) string) (serviceWiring, error) {
	every, err := serviceSweepEvery(getenv, cfg.AppEnv)
	if err != nil {
		return serviceWiring{}, err
	}
	origins, err := publicFormOrigins(cfg.AllowedOrigins, getenv, cfg.AppEnv)
	if err != nil {
		return serviceWiring{}, err
	}
	s := newService(pools, ev, control, cfg.clock())
	staff, public := serviceServers(s, origins)
	return serviceWiring{svc: s, every: every, staff: staff, public: public}, nil
}

// serviceTasks adapts the port of «Задачи» of the forms (tasks.Service.CreateFormTask) to service.TaskPort: the task is
// made in the transaction of the command on behalf of its author, the request is among its related objects.
type serviceTasks struct{ S *tasks.Service }

var _ service.TaskPort = serviceTasks{}

// CreateTask implements service.TaskPort.
func (a serviceTasks) CreateTask(ctx context.Context, tx pgx.Tx, tenant uuid.UUID, t service.TaskInput) (service.TaskResult, error) {
	r, err := a.S.CreateFormTask(ctx, tx, tenant, tasks.FormTask{Project: t.Project, Author: t.Author, Assignee: t.Assignee, AuthorOwner: t.AuthorOwner,
		AuthorName: t.AuthorName, Title: t.Title, Description: t.Description, Response: t.Request, Origin: t.Origin,
		Related: []tasksapi.ObjectRef{{ModuleKey: "service", EntityType: "request", EntityId: t.Request}}})
	return service.TaskResult{ID: r.ID, Key: r.Key, Status: r.Status, Refused: r.Refused}, err
}

// serviceProjects adapts the creation of a project of «Задачи» to service.ProjectPort: a direction is a service project.
type serviceProjects struct{ S *tasks.Service }

var _ service.ProjectPort = serviceProjects{}

// projectBudget is how long the creation of a project may take: it runs outside the idempotency lease of the command.
const projectBudget = 30 * time.Second

// CreateServiceProject implements service.ProjectPort. The project is made by the module «Задачи» in a transaction of its
// own and — a fresh context — outside the Idempotency-Key of createServiceDirection, whose outcome the module would
// otherwise store as its own.
func (a serviceProjects) CreateServiceProject(_ context.Context, tc tenantctx.TenantContext, key, name string, unit *uuid.UUID) (uuid.UUID, error) {
	fresh, cancel := context.WithTimeout(context.Background(), projectBudget)
	defer cancel()
	p, err := a.S.CreateProject(fresh, tc, tasksapi.ProjectCreate{Key: key, Name: name, OrgUnitId: unit, WorkflowKey: tasksapi.Simple})
	return p.Id, err
}

// serviceHome adapts the port of «Главная» of the module (service.Service.Home) to the source of requests.
type serviceHome struct{ S *service.Service }

var _ homeservice.Reader = serviceHome{}

// Home implements homeservice.Reader.
func (a serviceHome) Home(ctx context.Context, tc tenantctx.TenantContext) ([]homeservice.Card, error) {
	list, err := a.S.Home(ctx, tc)
	if err != nil {
		return nil, err
	}
	out := make([]homeservice.Card, 0, len(list))
	for _, c := range list {
		out = append(out, homeservice.Card{Request: c.Request, Key: c.Key, Title: c.Title, Direction: c.Direction, Client: c.Client, Situation: c.Kind,
			Term: c.Term, Text: c.Text, Until: c.Until, Assignee: c.Assignee, At: c.At})
	}
	return out, nil
}

// serviceSweepEnv sets the interval of the worker of the terms of requests (Go duration; 0 — off). Default: every
// minute in prod; off elsewhere, so that the stand keeps the seed state of 01.10.2026.
const serviceSweepEnv = "SERVICE_SWEEP_INTERVAL"

// serviceSweepEvery reads serviceSweepEnv.
func serviceSweepEvery(getenv func(string) string, appEnv string) (time.Duration, error) {
	raw := getenv(serviceSweepEnv)
	if raw == "" {
		if appEnv == envProd {
			return time.Minute, nil
		}
		return 0, nil
	}
	d, err := time.ParseDuration(raw)
	if err != nil || d < 0 {
		return 0, fmt.Errorf("%s=%q: want a Go duration ≥ 0 (1m, 30s; 0 — off)", serviceSweepEnv, raw)
	}
	return d, nil
}

// serviceSweep returns the background job of the terms of requests (nil when off): the warnings, the breaches and the
// closing of what was resolved five days ago, for every working tenant.
func serviceSweep(s *service.Service, control service.ControlDB, every time.Duration, log *slog.Logger) func(context.Context) {
	if every <= 0 {
		return nil
	}
	w := service.Worker{S: s, Every: every, Log: log, Tenants: func(ctx context.Context) ([]uuid.UUID, error) {
		rows, err := control.Query(ctx, `select id from tenants where state in ('trial', 'active', 'grace')`)
		if err != nil {
			return nil, fmt.Errorf("tenants: %w", err)
		}
		defer rows.Close()
		var ids []uuid.UUID
		for rows.Next() {
			var id uuid.UUID
			if err := rows.Scan(&id); err != nil {
				return nil, fmt.Errorf("tenant: %w", err)
			}
			ids = append(ids, id)
		}
		return ids, rows.Err()
	}}
	return w.Run
}
