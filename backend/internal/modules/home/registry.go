package home

import (
	"context"
	"errors"
	"slices"
	"time"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Query is what a source reads its cards for.
type Query struct {
	Tenant      tenantctx.TenantContext // the member in the business of the request (an active membership)
	ModuleState string                  // the state of the module of the source: active | read_only | draining; "" — a core source
	Now         time.Time               // the clock of the application (UTC)
}

// Source is the provider of the cards of one module.
type Source interface {
	// Module is the key of the module in the module registry (fleet); "" — a core source, asked always.
	Module() string
	// Cards returns the cards of the member of q in the order of the source; it checks the permissions and the
	// scopes of the member itself and never returns data the member may not read in the module.
	Cards(ctx context.Context, q Query) ([]homeapi.DecisionItem, error)
}

// Registry is the ordered list of the sources (logistics → organization → later modules).
type Registry struct{ sources []Source }

// ErrNilSource is returned by NewRegistry for a nil source.
var ErrNilSource = errors.New("home: nil source")

// NewRegistry returns the registry of sources in the order given.
func NewRegistry(sources ...Source) (*Registry, error) {
	for _, s := range sources {
		if s == nil {
			return nil, ErrNilSource
		}
	}
	return &Registry{sources: slices.Clone(sources)}, nil
}

// Sources returns the sources in registration order.
func (r *Registry) Sources() []Source {
	if r == nil {
		return nil
	}
	return slices.Clone(r.sources)
}
