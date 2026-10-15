package modulesreg

import (
	"slices"

	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
)

// Installation is a row of modules.installations in terms of the contract.
type Installation struct {
	Key            string // contract key
	StoredKey      string // module_key as stored (a catalog synonym for old rows)
	State          string // StateActive | StateDraining | StateReadOnly | StateDisabled
	RetainedAccess string
	Revision       int64
	Settings       []byte // jsonb; empty — defaults
}

// Tenant states whose modules are read only for everyone (tenantctx.Resolve refuses mutations in both).
var planExpired = map[string]bool{"read_only": true, "grace": true}

// Availability lists the modules of a tenant for a member (TenantContext.modules of /me/context): the core
// modules, then the installable ones, as moduleAvailability of the example generator W0.07 and of MSW W0.13.
// capabilityKeys are the permissions of the member's capabilities; a module with none of them is not available.
func Availability(tenantStatus string, installed map[string]Installation, capabilityKeys []string) []contextapi.ModuleAvailability {
	keys := append(CoreKeys(), InstallableKeys()...)
	out := make([]contextapi.ModuleAvailability, 0, len(keys))
	for _, m := range keys {
		state := StateActive
		if !isCore(m) {
			state = StateUninstalled
			if in, ok := installed[m]; ok {
				state = in.State
			}
		}
		out = append(out, availability(m, state, tenantStatus, capabilityKeys))
	}
	return out
}

// grantsOf reports whether keys hold an action of module and whether one of them changes data (level ≠ view).
func grantsOf(module string, keys []string) (mine, write bool) {
	for _, k := range keys {
		if ModuleOfAction(k) != module {
			continue
		}
		mine = true
		if l := actionLevel(k); l != "" && l != "view" {
			write = true
		}
	}
	return mine, write
}

func availability(module, state, tenantStatus string, keys []string) contextapi.ModuleAvailability {
	mine, write := grantsOf(module, keys)
	mode := modeIf(mine)
	switch {
	case !slices.Contains(installedStates, state):
		return avail(module, StateUninstalled, "none", "not_installed")
	case state == StateDisabled:
		return avail(module, StateDisabled, "none", "disabled")
	case planExpired[tenantStatus]:
		return avail(module, StateReadOnly, mode("read"), "plan_expired")
	case state == StateReadOnly:
		return avail(module, StateReadOnly, mode("read"), "disabled")
	case state == StateDraining:
		return avail(module, StateDraining, mode("finish_only"), "draining")
	case !mine:
		return avail(module, StateActive, "none", "permission_denied")
	case write:
		return avail(module, StateActive, "write", "available")
	default:
		return avail(module, StateActive, "read", "available")
	}
}

// installedStates are the states of an installed module.
var installedStates = []string{StateActive, StateDraining, StateReadOnly, StateDisabled}

// modeIf returns the access mode: the granted one when the member holds actions of the module, none otherwise.
func modeIf(mine bool) func(granted string) string {
	return func(granted string) string {
		if mine {
			return granted
		}
		return "none"
	}
}

func avail(module, state, mode, reason string) contextapi.ModuleAvailability {
	return contextapi.ModuleAvailability{
		ModuleKey: module, State: contextapi.ModuleAvailabilityState(state),
		AccessMode: contextapi.ModuleAvailabilityAccessMode(mode), Reason: contextapi.ModuleAvailabilityReason(reason),
	}
}
