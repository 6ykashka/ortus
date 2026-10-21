// Package tasks is the module «Задачи и проекты» (W4.11, step 4.1 of plan 27; contract 0.10.0-stage4, tenant 0025):
// projects with a level of access whose members are roles with the scope project, a workflow with versions and a
// draft, transitions with checks and approvals («достаточно одного / нужны все»), subtasks, attachments over
// core.files, the history with comments and the automation of a project on behalf of the author of a rule.
//
// The access of a member to a project is projAccess of the prototype with TP-03: a role of the project (assigned or
// through a group) replaces the roles of the area in it; a role of the area (tenant, an org unit covering the area of
// the project) gives every action in an open project, the reads in a limited one and nothing in a closed one; the
// owner of the organization has the system role except in a closed project. The module computes it from the grants
// of the people (the descriptions of «Участники», approvers, the author of a rule) and lists rows through the scope
// predicate of the evaluator; TestAccessParity keeps both equal on the isolation fixtures.
//
// A blocking defect of the queue S2-17 becomes a task (DefectTasks, a consumer of the outbox): D-29 of the set.
package tasks
