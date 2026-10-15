package modulesreg

import (
	"encoding/json"
	"slices"
	"testing"

	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
)

type exampleTenant struct {
	Name         string                          `json:"name"`
	Modules      []contextapi.ModuleAvailability `json:"modules"`
	Capabilities []contextapi.ScopedCapability   `json:"capabilities"`
	TenantState  *contextapi.TenantState         `json:"tenantState"`
}

// altaOf returns «Альта Групп» of the getMyContext example of a persona.
func altaOf(t *testing.T, persona string) exampleTenant {
	t.Helper()
	var me struct {
		Tenants []exampleTenant `json:"tenants"`
	}
	if err := json.Unmarshal(example(t, "getMyContext", persona), &me); err != nil {
		t.Fatal(err)
	}
	for _, tn := range me.Tenants {
		if tn.Name == "Альта Групп" {
			return tn
		}
	}
	t.Fatalf("%s: no «Альта Групп»", persona)
	return exampleTenant{}
}

func keysOf(caps []contextapi.ScopedCapability) []string {
	var out []string
	for _, c := range caps {
		if !slices.Contains(out, c.Permission) {
			out = append(out, c.Permission)
		}
	}
	return out
}

// «Альта»: подключён «Салон и SPA» (сид 14.10).
var altaInstalled = map[string]Installation{"spa": {Key: "spa", StoredKey: "spa", State: StateActive, Revision: 1}}

// Паритет с mock: доступность модулей «Альты» = примеры getMyContext (moduleAvailability генератора W0.07 и MSW),
// если на вход подать возможности самого примера.
func TestAvailabilityMatchesExamples(t *testing.T) {
	t.Parallel()
	for _, persona := range []string{"owner", "manager", "driver"} {
		t.Run(persona, func(t *testing.T) {
			t.Parallel()
			alta := altaOf(t, persona)
			got := Availability("trial", altaInstalled, keysOf(alta.Capabilities))
			if !slices.Equal(got, alta.Modules) {
				t.Errorf("%s:\n got %+v\nwant %+v", persona, got, alta.Modules)
			}
		})
	}
}

func availabilityOf(list []contextapi.ModuleAvailability, key string) contextapi.ModuleAvailability {
	for _, m := range list {
		if m.ModuleKey == key {
			return m
		}
	}
	return contextapi.ModuleAvailability{}
}

func TestAvailabilityStates(t *testing.T) {
	t.Parallel()
	fleetRead := []string{"fleet.trips.read", "tasks.read"}
	fleetWrite := []string{"fleet.trips.read", "fleet.trips.start"}
	cases := []struct {
		name, tenant, state string
		keys                []string
		want                contextapi.ModuleAvailability
	}{
		{"нет установки", "active", "", fleetWrite, av("uninstalled", "none", "not_installed")},
		{"подключён, запись", "active", StateActive, fleetWrite, av("active", "write", "available")},
		{"подключён, чтение", "active", StateActive, fleetRead, av("active", "read", "available")},
		{"подключён, прав нет", "active", StateActive, []string{"tasks.read"}, av("active", "none", "permission_denied")},
		{"draining с правами", "active", StateDraining, fleetWrite, av("draining", "finish_only", "draining")},
		{"draining без прав", "active", StateDraining, nil, av("draining", "none", "draining")},
		{"отключён · только чтение", "active", StateReadOnly, fleetWrite, av("read_only", "read", "disabled")},
		{"только чтение без прав", "trial", StateReadOnly, nil, av("read_only", "none", "disabled")},
		{"выключен полностью", "active", StateDisabled, fleetWrite, av("disabled", "none", "disabled")},
		{"организация read_only", "read_only", StateActive, fleetWrite, av("read_only", "read", "plan_expired")},
		{"организация grace", "grace", StateActive, fleetWrite, av("read_only", "read", "plan_expired")},
		{"организация read_only, модуль draining", "read_only", StateDraining, nil, av("read_only", "none", "plan_expired")},
	}
	for _, c := range cases {
		inst := map[string]Installation{}
		if c.state != "" {
			inst["fleet"] = Installation{Key: "fleet", StoredKey: "logistics", State: c.state, Revision: 3}
		}
		got := availabilityOf(Availability(c.tenant, inst, c.keys), "fleet")
		c.want.ModuleKey = "fleet"
		if got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
	all := Availability("active", nil, nil)
	if len(all) != 11 || all[0].ModuleKey != "tasks" || all[10].ModuleKey != "repairs" {
		t.Errorf("order: %+v", all)
	}
	if got := availabilityOf(all, "cash"); got != (contextapi.ModuleAvailability{ModuleKey: "cash", State: "active", AccessMode: "none", Reason: "permission_denied"}) {
		t.Errorf("core without rights: %+v", got)
	}
}

func av(state, mode, reason string) contextapi.ModuleAvailability {
	return contextapi.ModuleAvailability{
		State: contextapi.ModuleAvailabilityState(state), AccessMode: contextapi.ModuleAvailabilityAccessMode(mode),
		Reason: contextapi.ModuleAvailabilityReason(reason),
	}
}
