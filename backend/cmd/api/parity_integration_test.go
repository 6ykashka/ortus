//go:build integration

package main

// П-14 критики этапа 0 (docs/plan/v2/critique/stage-0.md): возможности /me/context на стенде и в mock должны
// совпадать. Mock (MSW W0.13) отвечает примерами api/openapi/examples/getMyContext/<persona>.json (conformance
// адаптера), стенд — оценщик W1.04 на Go-сиде. Сравнивается мультимножество «право | вид области | id области» у
// владельца, менеджера и водителя «Альты». includeDescendants не сравнивается: mehttp ставит его только org_unit,
// пример — ещё и tenant (решение по умолчанию брифа W1.04 §10 п.10, правка mehttp — интегратору).

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

type capability struct {
	Permission string `json:"permission"`
	Scope      struct {
		Kind        string   `json:"kind"`
		ResourceIDs []string `json:"resourceIds"`
	} `json:"scope"`
}

type tenantCaps struct {
	TenantID     string       `json:"tenantId"`
	Capabilities []capability `json:"capabilities"`
}

func capabilityKeys(caps []capability) []string {
	out := make([]string, 0, len(caps))
	for _, c := range caps {
		ids := slices.Clone(c.Scope.ResourceIDs)
		slices.Sort(ids)
		out = append(out, c.Permission+"|"+c.Scope.Kind+"|"+strings.Join(ids, ","))
	}
	slices.Sort(out)
	return out
}

// altaCapabilities returns the capabilities of «Альта» in a /me/context body.
func altaCapabilities(t *testing.T, raw []byte) []string {
	t.Helper()
	var me struct {
		Tenants []tenantCaps `json:"tenants"`
	}
	if err := json.Unmarshal(raw, &me); err != nil {
		t.Fatal(err)
	}
	for _, tc := range me.Tenants {
		if tc.TenantID == seedAlta.String() {
			return capabilityKeys(tc.Capabilities)
		}
	}
	t.Fatalf("no «Альта» in %s", raw)
	return nil
}

func TestStackCapabilitiesParity(t *testing.T) { //nolint:paralleltest // one seeded stack
	srv := server(t)
	for _, persona := range []string{"owner", "manager", "driver"} {
		t.Run(persona, func(t *testing.T) {
			t.Parallel()
			root, err := os.OpenRoot(filepath.Join("..", "..", "..", "api", "openapi", "examples", "getMyContext"))
			if err != nil {
				t.Fatal(err)
			}
			defer root.Close()
			want, err := root.ReadFile(persona + ".json")
			if err != nil {
				t.Fatal(err)
			}
			status, body := newBrowser(t, srv).login(persona).call(http.MethodGet, "/api/v1/me/context", "")
			raw, _ := json.Marshal(body)
			if status != http.StatusOK {
				t.Fatalf("/me/context: %d %s", status, raw)
			}
			got, exp := altaCapabilities(t, raw), altaCapabilities(t, want)
			if !slices.Equal(got, exp) {
				t.Errorf("%s: stand %d capabilities, mock %d\n%s", persona, len(got), len(exp), diff(got, exp))
			}
		})
	}
}

// diff lists what only the stand and only the mock have.
func diff(got, want []string) string {
	var b strings.Builder
	for _, g := range got {
		if !slices.Contains(want, g) {
			fmt.Fprintf(&b, "  only stand: %s\n", g)
		}
	}
	for _, w := range want {
		if !slices.Contains(got, w) {
			fmt.Fprintf(&b, "  only mock:  %s\n", w)
		}
	}
	return b.String()
}
