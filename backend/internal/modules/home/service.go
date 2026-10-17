package home

import (
	"cmp"
	"context"
	"errors"
	"slices"
	"time"

	"github.com/google/uuid"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Limits of the queue (api/openapi/paths/home.yaml: limit 1…50, the home page shows 8).
const (
	DefaultLimit = 8
	MaxLimit     = 50
)

// Modules reports the state of the installable modules of a tenant, keyed by module key (modulesreg: active,
// draining, read_only, disabled; a module without a row is not installed).
type Modules interface {
	States(ctx context.Context, tenantID uuid.UUID) (map[string]string, error)
}

// Service builds the queue of a member from the sources of the registry.
type Service struct {
	Dir      tenantctx.Directory // the memberships of the control DB
	Registry *Registry
	Modules  Modules          // nil: no installable module is installed
	Now      func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

// askedStates are the module states whose sources give cards: an installed module that is not disabled (read_only
// and draining keep the history and the started work, MSW W2.00).
var askedStates = []string{"active", "read_only", "draining"}

// toneRank orders the cards (homeVM of the prototype); a tone outside the enum goes last.
var toneRank = map[homeapi.DecisionItemTone]int{homeapi.Danger: 0, homeapi.Warn: 1, homeapi.Info: 2, homeapi.Neutral: 3}

func rank(t homeapi.DecisionItemTone) int {
	if r, ok := toneRank[t]; ok {
		return r
	}
	return len(toneRank)
}

// errNoTenant is the answer to a tenant that is not an active membership of a readable business (S2-18 п. 4).
func errNoTenant() error {
	return problem.New(problem.CodeNotFound, "Организация не найдена.")
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// Queue returns the queue of accountID in tenantID with at most limit cards (getMyDecisionQueue).
func (s *Service) Queue(ctx context.Context, accountID, tenantID uuid.UUID, limit int) (homeapi.DecisionQueue, error) {
	if limit < 1 || limit > MaxLimit {
		return homeapi.DecisionQueue{}, problem.New(problem.CodeMalformedRequest, "limit: 1…50")
	}
	tc, err := s.tenant(ctx, accountID, tenantID)
	if err != nil {
		return homeapi.DecisionQueue{}, err
	}
	now := s.now()
	all, err := s.cards(ctx, Query{Tenant: tc, Now: now})
	if err != nil {
		return homeapi.DecisionQueue{}, err
	}
	// Stable: equal tones keep the registration order of the sources and the order of each source.
	slices.SortStableFunc(all, func(a, b homeapi.DecisionItem) int { return cmp.Compare(rank(a.Tone), rank(b.Tone)) })
	return homeapi.DecisionQueue{
		TenantId: tc.TenantID, Items: all[:min(limit, len(all))], Total: int64(len(all)), GeneratedAt: now,
	}, nil
}

// tenant resolves the membership of accountID in tenantID as the gateway does for a tenant path; a suspended business
// is the same 404 as a foreign one here (MSW W2.00: «Организация не найдена.»).
func (s *Service) tenant(ctx context.Context, accountID, tenantID uuid.UUID) (tenantctx.TenantContext, error) {
	tc, err := tenantctx.Resolve(ctx, s.Dir, accountID, tenantID.String(), false)
	if problem.Is(err, problem.CodeNotFound) || problem.Is(err, problem.CodeTenantSuspended) {
		return tenantctx.TenantContext{}, errNoTenant()
	}
	return tc, err
}

// cards asks every source of the registry in order; the module states are read once, and only when a source of an
// installable module is registered.
func (s *Service) cards(ctx context.Context, base Query) ([]homeapi.DecisionItem, error) {
	all := []homeapi.DecisionItem{}
	var states map[string]string
	for _, src := range s.Registry.Sources() {
		q := base
		if m := src.Module(); m != "" {
			if states == nil {
				var err error
				if states, err = s.states(ctx, base.Tenant.TenantID); err != nil {
					return nil, err
				}
			}
			if q.ModuleState = states[m]; !slices.Contains(askedStates, q.ModuleState) {
				continue
			}
		}
		items, err := src.Cards(ctx, q)
		if err != nil {
			return nil, dependency(err)
		}
		all = append(all, items...)
	}
	return all, nil
}

func (s *Service) states(ctx context.Context, tenantID uuid.UUID) (map[string]string, error) {
	if s.Modules == nil {
		return map[string]string{}, nil
	}
	states, err := s.Modules.States(ctx, tenantID)
	if err != nil {
		return nil, dependency(err)
	}
	if states == nil {
		states = map[string]string{}
	}
	return states, nil
}

// dependency keeps a Problem error and reports anything else as dependency_unavailable (the cause stays in the log).
func dependency(err error) error {
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}
