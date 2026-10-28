package main

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/modules/service"
	"github.com/ortus/ortus-crm/backend/internal/modules/tasks"
)

// «Обращения» part of the seed (W7.31, service.js 19.10:123–213): the four directions of «Альта Групп» — МАС, КОС, ОТД, ГРЗ —
// each a service project of «Задачи», with 21 types, four reply templates, eight requests, three ratings (two of them
// low and open), the role «Специалист по обращениям» of the dispatchers of ГРЗ and the personal links and the pages of
// the directions in the control index. The time is the Moscow time of the prototype (1 October 2026), the ids are
// those of PD-30, so the stand shows the same rows as the mock.

// svcProjects are the service projects of the directions (the prototype ids of the projects: svc-mas…).
var svcProjects = []seedProject{
	{proto: "svc-mas", key: "МАС", name: "Обращения · Массаж", unit: homeAlta, owner: zimina, workflow: tasks.SeedSimple},
	{proto: "svc-kos", key: "КОС", name: "Обращения · Косметология", unit: homeAlta, owner: zimina, workflow: tasks.SeedSimple},
	{proto: "svc-otd", key: "ОТД", name: "Обращения · Отделка", unit: homeAlta, owner: zimina, workflow: tasks.SeedSimple},
	{proto: "svc-grz", key: "ГРЗ", name: "Обращения · Грузоперевозки", unit: homeAlta, owner: zimina, workflow: tasks.SeedSimple},
}

// roleAgent is the template «Специалист по обращениям» (r-agent of the prototype).
var roleAgent = roleDef{"r-agent", "Специалист по обращениям", kindTemplate, "", actions(
	"service.requests.read,service.requests.create,service.requests.reply,service.requests.resolve")}

// svcAssignments are the dispatchers of ГРЗ: the role with the scope of the project of the direction (as1, as2 of the prototype).
var svcAssignments = []assignmentDef{
	{"as-svc1", memberKotova, roleAgent.proto, scopeProject, "svc-grz"},
	{"as-svc2", "m-kotelnikova", roleAgent.proto, scopeProject, "svc-grz"},
}

// writeService writes the module of «Альта Групп»; the other businesses have no requests. A second run changes nothing.
func writeService(ctx context.Context, tx *sql.Tx, td tenantData) error {
	if td.tenant.proto != protoAlta {
		return nil
	}
	id := func(proto string) uuid.UUID { return seedID(td.tenant.proto, proto) }
	wf, err := tasks.SeedWorkflowOf(tasks.SeedSimple, nil)
	if err != nil {
		return err
	}
	for _, p := range svcProjects {
		if err := writeSeedProject(ctx, tx, id, p, wf); err != nil {
			return err
		}
	}
	var exec execFunc = func(what, q string, args ...any) error {
		if _, err := tx.ExecContext(ctx, q, args...); err != nil {
			return fmt.Errorf("%s: %w", what, err)
		}
		return nil
	}
	if err := writeRoles(exec, id, id(memberOwner), []roleDef{roleAgent}); err != nil {
		return err
	}
	for _, as := range svcAssignments {
		if err := writeAssignment(ctx, tx, id, id(memberOwner), as); err != nil {
			return err
		}
	}
	ex := func(ctx context.Context, q string, args ...any) error {
		_, err := tx.ExecContext(ctx, q, args...)
		return err
	}
	return service.WriteDemo(ctx, ex, func(proto string) uuid.UUID { return id(proto) })
}

// writeServiceIndex writes the control index of the portal of «Альта Групп»: the digests of the personal links and the
// slugs of the pages of the directions (control 0011); the tokens themselves are not kept anywhere.
func writeServiceIndex(ctx context.Context, control *sql.DB, td tenantData) error {
	if td.tenant.proto != protoAlta {
		return nil
	}
	id := func(proto string) uuid.UUID { return seedID(td.tenant.proto, proto) }
	for _, t := range service.DemoTokens(func(proto string) uuid.UUID { return id(proto) }) {
		if _, err := control.ExecContext(ctx, `insert into public_service_tokens (token_digest, tenant_id, request_id, token_id, key_version, expires_at)
			values ($1, $2, $3, $4, $5, $6) on conflict (token_digest) do nothing`, t.Digest, td.tenant.id(), t.Request, t.ID, t.KeyVersion, t.ExpiresAt); err != nil {
			return fmt.Errorf("service: token index: %w", err)
		}
	}
	for _, slug := range []string{"mas", "kos", "otd", "grz"} {
		if _, err := control.ExecContext(ctx, `insert into public_service_slugs (slug, tenant_id, direction_id) values ($1, $2, $3) on conflict (slug) do nothing`,
			slug, td.tenant.id(), id("d-"+slug)); err != nil {
			return fmt.Errorf("service: slug %s: %w", slug, err)
		}
	}
	return nil
}
