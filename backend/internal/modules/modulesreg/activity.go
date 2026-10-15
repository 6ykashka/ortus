package modulesreg

import (
	"context"
	"fmt"
	"slices"

	"github.com/google/uuid"
)

// Effects of disabling on an item (ModuleDeactivationItem.effect).
const (
	EffectFinishAllowed = "finish_allowed"
	EffectPaused        = "paused"
	EffectClosed        = "closed"
)

// KindActiveProcess is a started process that can be finished after disabling (trip, visit, work log).
const KindActiveProcess = "active_process"

// Item is one thing a module is doing now (ModuleDeactivationItem).
type Item struct {
	Kind       string // active_process | form_intake | automation
	EntityType string
	EntityID   uuid.UUID
	Title      string
	State      string // module state code of the object
	Assignee   string // "" — no responsible person
	Effect     string
}

// Activity is the provider of a module: what is running in a tenant DB now. A module without a provider has no
// running processes (its draining ends at once).
type Activity interface {
	Module() string
	// Items lists at most limit items (started processes first) and the total number of items.
	Items(ctx context.Context, q Querier, limit int) ([]Item, int64, error)
	// Started reports whether processes that may still be finished keep the module draining.
	Started(ctx context.Context, q Querier) (bool, error)
}

// Registry is the explicit list of activity providers (no init()).
type Registry struct{ byModule map[string]Activity }

// NewRegistry registers providers; a duplicate or a module that is not installable is an error.
func NewRegistry(providers ...Activity) (*Registry, error) {
	r := &Registry{byModule: map[string]Activity{}}
	for _, p := range providers {
		m := p.Module()
		switch {
		case !IsInstallable(m):
			return nil, fmt.Errorf("modulesreg: activity of %q: not an installable module", m)
		case r.byModule[m] != nil:
			return nil, fmt.Errorf("modulesreg: activity of %q registered twice", m)
		}
		r.byModule[m] = p
	}
	return r, nil
}

// DefaultRegistry is the registry of stage 1: trips of the logistics module. Visits (spa, stage 5) and work logs
// (repairs, stage 6) register their providers with their modules; form intakes and automations — stage 4.
func DefaultRegistry() *Registry {
	r, err := NewRegistry(FleetTrips())
	if err != nil {
		panic(err) // a fixed list: only a programming error gets here
	}
	return r
}

func (r *Registry) of(module string) Activity {
	if r == nil {
		return nil
	}
	return r.byModule[module]
}

// FleetTrips is the activity of the logistics module (S1-18, AC-12): started trips (on route, returning, submitted
// or sent to rework) may be finished and accepted after disabling and keep the module draining; assigned trips that
// have not started (assignment, inspection, defect review) are closed by disabling.
func FleetTrips() Activity { return fleetTrips{} }

type fleetTrips struct{}

// Trip states of tenant 0002 (fleet.trips.state).
var (
	tripsStarted    = []string{"on_route", "returning", "submitted", "rework"}
	tripsNotStarted = []string{"assigned", "inspection", "defect_review"}
)

func (fleetTrips) Module() string { return KeyFleet }

const fleetItemsSQL = `
select t.id, t.number, t.state, coalesce(p.full_name, '')
  from fleet.trips t
  left join people.person_profiles p on p.id = t.driver_person_id
 where t.state = any($1)
 order by case when t.state = any($2) then 0 else 1 end, t.started_at nulls last, t.number
 limit $3`

func (fleetTrips) Items(ctx context.Context, q Querier, limit int) ([]Item, int64, error) {
	all := slices.Concat(tripsStarted, tripsNotStarted)
	var total int64
	if err := q.QueryRow(ctx, `select count(*) from fleet.trips where state = any($1)`, all).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("fleet trips: %w", err)
	}
	rows, err := q.Query(ctx, fleetItemsSQL, all, tripsStarted, limit)
	if err != nil {
		return nil, 0, fmt.Errorf("fleet trips: %w", err)
	}
	defer rows.Close()
	var out []Item
	for rows.Next() {
		it := Item{Kind: KindActiveProcess, EntityType: "fleet.trip", Effect: EffectClosed}
		var number string
		if err := rows.Scan(&it.EntityID, &number, &it.State, &it.Assignee); err != nil {
			return nil, 0, fmt.Errorf("fleet trips: %w", err)
		}
		it.Title = "Рейс " + number
		if slices.Contains(tripsStarted, it.State) {
			it.Effect = EffectFinishAllowed
		}
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, fmt.Errorf("fleet trips: %w", err)
	}
	return out, total, nil
}

func (fleetTrips) Started(ctx context.Context, q Querier) (bool, error) {
	var started bool
	err := q.QueryRow(ctx, `select exists (select 1 from fleet.trips where state = any($1))`, tripsStarted).Scan(&started)
	if err != nil {
		return false, fmt.Errorf("fleet trips: %w", err)
	}
	return started, nil
}
