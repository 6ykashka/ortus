package forms

import (
	"slices"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// Origins is the allowlist of the deployment for the Origin of the browser commands of the guests of public forms
// (W4.83, Q-W4.90-1; contract PublicForms, parameter Origin): exact serialized origins «scheme://host[:port]», no
// wildcard. cmd/api joins the SPA (ALLOWED_ORIGINS — the iframe «?embed=1» is a document of the SPA too), PUBLIC_ORIGIN
// and FORMS_PUBLIC_ORIGINS.
type Origins []string

// Admit checks the Origin of a command of a guest before the token, the nonce and the body: nil for an origin of the
// list or for a request without Origin — no browser one (Fetch sends Origin with every POST) while the contract
// requires the header of browser commands only; any other value, the opaque «null» and an empty one included, is 403
// origin_not_allowed and names nothing of the form. An empty list admits no browser.
func (o Origins) Admit(origin *string) error {
	if origin == nil || slices.Contains(o, *origin) {
		return nil
	}
	return problem.New(problem.CodeOriginNotAllowed, "")
}
