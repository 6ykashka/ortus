package modulesreg

import (
	"context"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// tagModules maps the OpenAPI tags of installable modules to the module (TAG_MODULE of MSW W0.13).
var tagModules = map[string]string{"Fleet": KeyFleet, "Earnings": KeyFleet, "Spa": KeySpa, "Repairs": KeyRepairs}

// finishOnly are the commands that finish started work and stay open while the module drains (AC-12, «Начатые
// смены можно безопасно завершить и принять»): finishing the route, the return inspection, returning the vehicle,
// expenses on the way, acceptance and its earnings, releasing a reservation; finishing a visit. Whether the object is
// a started process is checked by the handler of the module: the gateway does not see the kind of an inspection, so
// fleet/inspections closes the departure of a new trip while the module drains (Q-W2.32-3).
var finishOnly = map[string]bool{
	"finishTripRoute": true, "submitInspection": true,
	"returnTrip": true, "createTripExpense": true, "reviewTrip": true, "reviewTripExpense": true,
	"setTripEarnings": true, "releaseReservation": true,
	"completeAppointment": true, "recordAppointmentPerformance": true,
}

// Gate is the module check of the API gateway (AC-12): operations of a module's tags need the module installed;
// read_only allows reads, draining allows reads and the operations that finish started work.
type Gate struct{ S *Service }

// Admit checks the module of op for the tenant of tc. Operations outside the tags of installable modules pass
// without reading the tenant DB.
func (g Gate) Admit(ctx context.Context, tc tenantctx.TenantContext, op catalog.Operation) error {
	module := tagModules[op.Tag]
	if module == "" {
		return nil
	}
	inst, err := g.S.Installations(ctx, tc.TenantID)
	if err != nil {
		return err
	}
	in, _ := current(inst, module)
	switch in.State {
	case StateActive:
		return nil
	case StateReadOnly:
		if op.Mutating {
			return problem.New(codeModuleReadOnly, "Модуль «"+moduleName(module)+"» отключён: история доступна только для чтения.")
		}
		return nil
	case StateDraining:
		if op.Mutating && !finishOnly[op.ID] {
			return problem.New(codeModuleReadOnly,
				"Модуль «"+moduleName(module)+"» отключается: можно только завершить начатую работу.")
		}
		return nil
	default: // uninstalled, disabled
		return notInstalled(module)
	}
}
