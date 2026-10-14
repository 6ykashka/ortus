// Package backend is the root of the Ortus CRM Go module.
//
// Layout (design/docs/14-engineering.md, docs/plan/v2/analysis/D-plan-reconciliation.md §2):
//
//   - cmd/api, cmd/worker, cmd/migrate, cmd/seed, cmd/provisioner — entry points;
//   - internal/platform — cross-cutting infrastructure (httpx, problem, session, authz, scopeddb…);
//   - internal/control — the control plane (tenants, subscriptions, operators);
//   - internal/modules/<m> — tenant business modules (one directory per module);
//   - internal/api/<tag> — code generated from api/openapi (make gen), never edited by hand;
//   - migrations/{control,tenant} — goose migrations, numbers are issued by the contract steward.
//
// The package itself contains no code: it keeps `go test ./...` and `go vet ./...` meaningful
// while the module is still empty.
package backend
