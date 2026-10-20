// Package authz is the permission evaluator of Ortus (W1.04, step 1.4 of plan 27, story S1-11): permit(), the
// admission of an operation at the gateway, scopeQuery() and the capabilities of GET /me/context.
//
// The model (design/docs/v0.1/02-architecture.md §5): a grant is «principal + role version + scope + conditions +
// period». A request is allowed when ONE grant allows it whole — its action, its scope covering the resource, its
// parameters (limit: amount) admitting the resource and its period containing «now». «Edit Москва-1» and «read
// Самара-2» never make «edit Самара-2».
//
// Scope kinds are a registry (ADR-0014, explicit, no init()): a kind knows whether it is object-bound and how it
// covers a resource and filters rows. Kinds: tenant, unit, self, project (tasks only — RS-08), warehouse, resource
// (stage 1) and space, page, folder, doc, account, chat, repair_project, relation (stages 4–7, W4.01). PD-53: a grant
// of an object-bound kind counts only for its own object or an object inside it (a page of its space, a subpage, a
// document of its folder — Resource.Ancestors, ObjectResolver of the module, ADR-0014 п.4); without an object it
// gives nothing. relation covers the records whose relation names the subject (Resource.Related).
//
// Containers (a project of tasks, a knowledge space) have an access level: territorial grants (tenant, unit) give
// every action in an open one, the reads its module registers (Evaluator.ContainerReads) in a limited one, nothing in
// a closed one; a role on the container gives its actions at any level and, in a project, replaces the territorial
// grants there (projAccess); a closed project is shut to the owner too (TP-03), a closed space is not (KB-04). Tree
// nodes (knowledge pages, document folders and documents) have access lists (NodeACL): «только выбранные» hides the
// branch from those not listed (except a lead through a role on the object), «читают все, правят выбранные» keeps
// editing to «edit» entries, which also give editing to those who see the node. Hooks are interfaces: ObjectACL (NodeACL by default), ACLGrant, GrantParam (LimitAmount),
// Rule (NotAuthor), ObjectResolver, GroupSource; owner_only and blocked_by_function come from the permission catalog
// (Policy).
//
// Denials: function_blocked (403) — the action is closed by a work function of the subject (driver, AC-05);
// forbidden_action (403) — no object, or the object is visible to the subject but the action is not granted on it;
// not_found (404) — the object is not visible, the same answer as for an id that does not exist (AC-01).
package authz
