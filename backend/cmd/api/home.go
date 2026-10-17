package main

import (
	"context"
	"time"

	"github.com/google/uuid"

	homeapi "github.com/ortus/ortus-crm/backend/internal/api/home"
	"github.com/ortus/ortus-crm/backend/internal/modules/home"
	homefleet "github.com/ortus/ortus-crm/backend/internal/modules/home/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/modulesreg"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/scopeddb"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// homeServer is the server of the tag Home (W2.09, S2-18 «Требует решения»): the registry of sources in the order
// of the queue (logistics; the organization and the modules of later stages register theirs here), the memberships
// of the control DB for the tenant of the query, the module states of the registry W1.08 and the clock of the
// application (APP_FIXED_NOW outside prod).
func homeServer(dir tenantctx.Directory, pools scopeddb.Pools, ev *authz.Evaluator, states home.Modules, now func() time.Time) homeapi.StrictServerInterface {
	reg, err := home.NewRegistry(homefleet.Source{Pools: pools, Authz: ev})
	if err != nil { // the sources above are never nil: a programming error
		panic(err)
	}
	return home.Server{S: &home.Service{Dir: dir, Registry: reg, Modules: states, Now: now}}
}

// moduleStates are the states of the installable modules of the registry W1.08 by contract key (home.Modules): a
// draining module without started work is settled first, as for the module gate.
type moduleStates struct{ S *modulesreg.Service }

var _ home.Modules = moduleStates{}

// States implements home.Modules.
func (m moduleStates) States(ctx context.Context, tenantID uuid.UUID) (map[string]string, error) {
	inst, err := m.S.Installations(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(inst))
	for key, in := range inst {
		out[key] = in.State
	}
	return out, nil
}
