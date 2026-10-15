// Package tenants is the tenant registry of the control DB and the migration controller of tenant databases
// (W1.02, S1-03): canary tenants → small batches → the rest, schema version recorded in tenant_routing, the
// sentinel checked before any migration (02-architecture §3).
package tenants

import (
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
)

// DefaultBatchSize is the batch size of a rollout when Plan.BatchSize is 0.
const DefaultBatchSize = 10

// Errors of the controller (errors.Is).
var (
	ErrUnknownTenant    = errors.New("tenants: unknown tenant")
	ErrBadTarget        = errors.New("tenants: target version out of range")
	ErrVersionAhead     = errors.New("tenants: tenant database is ahead of the target version")
	ErrSentinelMismatch = errors.New("tenants: sentinel mismatch: the database belongs to another tenant")
	ErrSchemaDrift      = errors.New("tenants: schema version drift between tenant_routing and the database")
	ErrRoutingRace      = errors.New("tenants: tenant_routing changed during the migration")
	ErrCanaryFailed     = errors.New("tenants: canary failed, batches not started")
	ErrBatchFailed      = errors.New("tenants: batch failed, next batches not started")
	ErrNoTenants        = errors.New("tenants: no tenants given")
	// ErrProvisioning: the tenant is still being created; its database belongs to the provisioner until trial.
	ErrProvisioning = errors.New("tenants: tenant is in provisioning, the provisioner migrates it")
	// ErrDatabaseOwner: a database on version 0 is not owned by the migrator; it is not adopted (no sentinel to check yet).
	ErrDatabaseOwner = errors.New("tenants: tenant database is not owned by the migrator")
)

// StateProvisioning is tenants.state of a registered tenant whose database the provisioner has not finished.
const StateProvisioning = "provisioning"

// ReasonProvisioning is Result.Reason of a tenant left out of a rollout because it is in provisioning.
const ReasonProvisioning = "provisioning"

// Ref is one tenant of tenant_routing.
type Ref struct {
	TenantID      uuid.UUID
	Slug          string
	Database      string
	SchemaVersion int64
	Sentinel      uuid.UUID
	CreatedAt     time.Time
	State         string // tenants.state
}

// Provisioning reports a tenant whose database is still created by the provisioner (the controller leaves it alone).
func (r Ref) Provisioning() bool { return r.State == StateProvisioning }

// Plan is a rollout request.
type Plan struct {
	Target            int64    // version to reach; 0: the latest tenant migration (Rollout)
	Canary            []string // slugs; empty: the first tenant (created_at, id) that needs the migration
	BatchSize         int      // 0: DefaultBatchSize
	ContinueOnFailure bool     // a failed batch tenant does not stop the next batches
	DryRun            bool     // phases only: no connection to a tenant database, no write
}

// Phase is a step of a rollout: the canary or a batch.
type Phase struct {
	Name    string // "canary", "batch 1", "batch 2", …
	Tenants []Ref
}

// Result is the outcome for one tenant.
type Result struct {
	Ref      Ref
	From, To int64
	Err      error
	Reason   string // why a skipped tenant was left out: "" (on target) or ReasonProvisioning
}

// PhaseCanary is the name of the canary phase.
const PhaseCanary = "canary"

func compareIDs(a, b uuid.UUID) int { return strings.Compare(a.String(), b.String()) }

// sortRefs orders tenants by creation, then id: the plan does not depend on the order of rows.
func sortRefs(rs []Ref) {
	slices.SortFunc(rs, func(a, b Ref) int {
		if c := a.CreatedAt.Compare(b.CreatedAt); c != 0 {
			return c
		}
		return compareIDs(a.TenantID, b.TenantID)
	})
}

// PlanPhases splits tenants into a canary phase and batches for p.Target (≥ 1). Tenants already on the target are
// skipped; tenants in provisioning are skipped with ReasonProvisioning (the provisioner creates and migrates their
// database); tenants ahead of the target fail with ErrVersionAhead and are left alone. A canary slug that is not a
// tenant is an error before anything runs.
func PlanPhases(refs []Ref, p Plan) (phases []Phase, skipped, failed []Result, err error) {
	if p.Target < 1 {
		return nil, nil, nil, fmt.Errorf("%w: %d", ErrBadTarget, p.Target)
	}
	rs := slices.Clone(refs)
	sortRefs(rs)
	for _, slug := range p.Canary {
		if !slices.ContainsFunc(rs, func(r Ref) bool { return r.Slug == slug }) {
			return nil, nil, nil, fmt.Errorf("%w: canary %q", ErrUnknownTenant, slug)
		}
	}
	var todo []Ref
	for _, r := range rs {
		switch {
		case r.Provisioning():
			skipped = append(skipped, Result{Ref: r, From: r.SchemaVersion, To: r.SchemaVersion, Reason: ReasonProvisioning})
		case r.SchemaVersion == p.Target:
			skipped = append(skipped, Result{Ref: r, From: r.SchemaVersion, To: r.SchemaVersion})
		case r.SchemaVersion > p.Target:
			failed = append(failed, Result{Ref: r, From: r.SchemaVersion, To: r.SchemaVersion,
				Err: fmt.Errorf("%w: %s on %d, target %d", ErrVersionAhead, r.Slug, r.SchemaVersion, p.Target)})
		default:
			todo = append(todo, r)
		}
	}
	if len(todo) == 0 {
		return nil, skipped, failed, nil
	}
	canary, rest := splitCanary(todo, p.Canary)
	if len(canary) > 0 {
		phases = append(phases, Phase{Name: PhaseCanary, Tenants: canary})
	}
	size := p.BatchSize
	if size <= 0 {
		size = DefaultBatchSize
	}
	for i, batch := range slices.Collect(slices.Chunk(rest, size)) {
		phases = append(phases, Phase{Name: fmt.Sprintf("batch %d", i+1), Tenants: batch})
	}
	return phases, skipped, failed, nil
}

// splitCanary picks the canary tenants out of todo: the named ones, or the first one when none is named.
func splitCanary(todo []Ref, named []string) (canary, rest []Ref) {
	if len(named) == 0 {
		return todo[:1], todo[1:]
	}
	for _, r := range todo {
		if slices.Contains(named, r.Slug) {
			canary = append(canary, r)
		} else {
			rest = append(rest, r)
		}
	}
	return canary, rest
}
