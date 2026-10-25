package forms

import (
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// W4.83 (Q-W4.90-1): the Origin of a browser command of a guest is checked against the allowlist of the deployment
// (contract PublicForms, parameter Origin): an exact origin of the list passes, any other value — a foreign site, the
// opaque «null», an empty value, another port, scheme or a path — is 403 origin_not_allowed; a request without Origin
// is no browser one (Fetch sends Origin with every POST) and passes. An empty list admits no browser.
func TestOriginsAdmit(t *testing.T) {
	t.Parallel()
	list := Origins{"https://app.ortus.example", "http://127.0.0.1:5205"}
	for _, c := range []struct {
		name   string
		list   Origins
		origin *string
		ok     bool
	}{
		{"no Origin", list, nil, true},
		{"the SPA", list, new("https://app.ortus.example"), true},
		{"the Vite of the slot", list, new("http://127.0.0.1:5205"), true},
		{"a foreign site", list, new("https://evil.example"), false},
		{"opaque null", list, new("null"), false},
		{"empty", list, new(""), false},
		{"another port", list, new("https://app.ortus.example:8443"), false},
		{"another scheme", list, new("http://app.ortus.example"), false},
		{"with a path", list, new("https://app.ortus.example/"), false},
		{"another case of the host", list, new("https://APP.ortus.example"), false},
		{"a wildcard sent", list, new("*"), false},
		{"an empty list", nil, new("https://app.ortus.example"), false},
		{"an empty list without Origin", nil, nil, true},
	} {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			err := c.list.Admit(c.origin)
			if c.ok {
				if err != nil {
					t.Fatalf("Admit: %v, want nil", err)
				}
				return
			}
			if !problem.Is(err, problem.CodeOriginNotAllowed) {
				t.Fatalf("Admit: %v, want %s", err, problem.CodeOriginNotAllowed)
			}
		})
	}
}
