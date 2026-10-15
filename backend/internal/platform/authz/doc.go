// Package authz is the permission evaluator of Ortus (W1.04, step 1.4 of plan 27, story S1-11): permit(), the
// admission of an operation at the gateway, scopeQuery() and the capabilities of GET /me/context.
//
// The model (design/docs/v0.1/02-architecture.md §5): a grant is «principal + role version + scope + conditions +
// period». A request is allowed when ONE grant allows it whole — its action, its scope covering the resource, its
// parameters (limit: amount) admitting the resource and its period containing «now». «Edit Москва-1» and «read
// Самара-2» never make «edit Самара-2».
//
// Scope kinds are a registry (ADR-0014, explicit, no init()): a kind knows whether it is object-bound and how it
// covers a resource and filters rows. PD-53: a grant of an object-bound kind (project, warehouse, resource; later
// space, page, chat, account…) counts only for its own object; without an object it gives nothing. Hooks are
// interfaces with pilot implementations: ObjectACL (access list of an object), GrantParam (LimitAmount), Rule
// (NotAuthor); owner_only and blocked_by_function come from the permission catalog (Policy).
//
// Denials: function_blocked (403) — the action is closed by a work function of the subject (driver, AC-05);
// forbidden_action (403) — no object, or the object is visible to the subject but the action is not granted on it;
// not_found (404) — the object is not visible, the same answer as for an id that does not exist (AC-01).
package authz
