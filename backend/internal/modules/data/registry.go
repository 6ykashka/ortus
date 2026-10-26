package data

import (
	"errors"
	"fmt"
	"slices"
)

// Provider is the datasets of one module.
type Provider interface {
	// Module is the key of the module in the module registry (fleet): its datasets exist while it is installed and not
	// disabled.
	Module() string
	// Datasets returns the datasets of the module in the order of the catalog.
	Datasets() []Spec
}

// Core is implemented by the provider of a module of the core (W4.80: tasks, forms — modulesreg.CoreKeys): such a
// module is never installed, its datasets exist in every tenant whatever the registry of modules says.
type Core interface {
	Core() bool
}

// Errors of NewRegistry: programming errors of the wiring.
var (
	ErrNilProvider      = errors.New("data: nil provider")
	ErrDuplicateDataset = errors.New("data: duplicate dataset id")
)

// entry is a dataset of the registry with the module of its provider; core — the module is of the core.
type entry struct {
	module string
	core   bool
	spec   Spec
}

// Registry is the ordered list of the datasets of the providers.
type Registry struct{ entries []entry }

// NewRegistry returns the registry of the datasets of providers, in their order.
func NewRegistry(providers ...Provider) (*Registry, error) {
	r := &Registry{}
	for _, p := range providers {
		if p == nil {
			return nil, ErrNilProvider
		}
		c, ok := p.(Core)
		core := ok && c.Core()
		for _, s := range p.Datasets() {
			if _, dup := r.lookup(s.ID); dup {
				return nil, fmt.Errorf("%w: %s", ErrDuplicateDataset, s.ID)
			}
			r.entries = append(r.entries, entry{module: p.Module(), core: core, spec: s})
		}
	}
	return r, nil
}

// opened reports whether the dataset of e exists with the module states of the tenant: a module of the core always,
// an installable module while it is installed and not disabled (openStates).
func (e entry) opened(states map[string]string) bool {
	return e.core || slices.Contains(openStates, states[e.module])
}

// lookup returns the dataset id with its module.
func (r *Registry) lookup(id string) (entry, bool) {
	if r == nil {
		return entry{}, false
	}
	i := slices.IndexFunc(r.entries, func(e entry) bool { return e.spec.ID == id })
	if i < 0 {
		return entry{}, false
	}
	return r.entries[i], true
}

// all returns the datasets in the order of the catalog.
func (r *Registry) all() []entry {
	if r == nil {
		return nil
	}
	return slices.Clone(r.entries)
}

// IDs returns the ids of the datasets in the order of the catalog (the wiring of cmd/api checks them).
func (r *Registry) IDs() []string {
	out := []string{}
	for _, e := range r.all() {
		out = append(out, e.spec.ID)
	}
	return out
}
