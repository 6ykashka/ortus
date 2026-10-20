package authz

import (
	"context"
	"errors"
	"maps"
	"slices"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Place is where an object lies (ADR-0014 п.4 «Resolve»): its org unit, the objects of other kinds that contain it
// (a page — its space, a document — its folder), its ancestors of its own kind (nearest first), the container whose
// access level it inherits and the branch of nodes with access lists down to it.
type Place struct {
	Unit       uuid.UUID
	Containers map[string]uuid.UUID
	Ancestors  []uuid.UUID
	Container  *Container
	Nodes      []Node
}

// ObjectResolver places the objects of one kind. The module that owns the table of the kind registers it in
// Evaluator.Places (knowledge — space and page, documents — folder and doc); without one, a grant reaches only the
// object itself.
type ObjectResolver interface {
	Place(ctx context.Context, tenantID, id uuid.UUID) (Place, error)
}

// withPlaces completes r from the resolvers of its object kinds, the containers they name included (a page names its
// space, the space its unit and level). What the handler set is kept: a resolver fills only what is missing. The
// maps of the caller are not modified.
func (e *Evaluator) withPlaces(ctx context.Context, tc tenantctx.TenantContext, r Resource) (Resource, error) {
	if len(e.Places) == 0 || len(r.Objects) == 0 {
		return r, nil
	}
	r.Objects = maps.Clone(r.Objects)
	r.Ancestors = maps.Clone(r.Ancestors)
	done := map[string]bool{}
	for {
		kind, ok := e.nextPlace(r, done)
		if !ok {
			return r, nil
		}
		done[kind] = true
		p, err := e.Places[kind].Place(ctx, tc.TenantID, r.Objects[kind])
		if err != nil {
			return r, dependency(err)
		}
		r = r.placed(kind, p)
	}
}

// nextPlace returns the first kind of r (by key) with a resolver that has not run yet.
func (e *Evaluator) nextPlace(r Resource, done map[string]bool) (string, bool) {
	for _, kind := range slices.Sorted(maps.Keys(r.Objects)) {
		if !done[kind] && e.Places[kind] != nil && r.Objects[kind] != uuid.Nil {
			return kind, true
		}
	}
	return "", false
}

// placed fills what r lacks from the place p of its object of kind.
func (r Resource) placed(kind string, p Place) Resource {
	if r.Unit == uuid.Nil {
		r.Unit = p.Unit
	}
	for k, id := range p.Containers {
		if r.Objects[k] == uuid.Nil {
			r.Objects[k] = id
		}
	}
	if len(p.Ancestors) > 0 && len(r.Ancestors[kind]) == 0 {
		if r.Ancestors == nil {
			r.Ancestors = map[string][]uuid.UUID{}
		}
		r.Ancestors[kind] = p.Ancestors
	}
	if r.Container == nil {
		r.Container = p.Container
	}
	if len(r.Nodes) == 0 {
		r.Nodes = p.Nodes
	}
	return r
}

// dependency is err as dependency_unavailable, unless it already is a problem.
func dependency(err error) error {
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}
