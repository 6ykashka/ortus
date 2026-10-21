package main

import (
	"time"

	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
)

// registerTasks adds the consumers of the module of tasks to reg (W4.11): the events of the queue of blocking defects
// (S2-17, D-29 «на шаге 4.1 — задача») make, assign and finish the task of the defect in the project of the area of the
// vehicle, on the clock of the application.
func registerTasks(reg *events.Registry, pools tasks.Pools, now func() time.Time) {
	tasks.DefectTasks{Pools: pools, Now: now}.Register(reg)
}

// projectsIn registers the projects of tasks in ev as cmd/api does (W4.01, RS-08): the audience of the inbox decides by
// the same evaluator, so a notice on an object of a project follows the level of the project (TP-03) in the worker too.
func projectsIn(ev *authz.Evaluator, pools tasks.Pools) *authz.Evaluator {
	return tasks.RegisterContainer(ev, pools)
}
