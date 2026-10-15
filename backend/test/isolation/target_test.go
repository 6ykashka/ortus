//go:build isolation

// @stub Owner: W0.09 — replace this file as a whole: newTarget builds the API of cmd/api (router, platform
// middleware, dev session) from env.Getenv (CONTROL_DB_URL, TENANT_DB_URL as ortus_api, APP_ENV=test,
// AUTH_PROVIDER=dev), uses env.Clock as «now», and Authenticate signs a request in as the dev identity
// (fixtures.IssuerDev, actor.Subject). Contract: matrix.Factory (docs/plan/v2/ws/W0.15.md §4.4).
// When the real API answers, the positive rows with «pending: W0.09» (2xx) fail until the pending mark is removed
// from me.yaml; the negative rows already pass when the gateway answers what they expect.

package isolation

import (
	"context"

	"github.com/ortus/ortus-crm/backend/test/isolation/matrix"
)

// newTarget is the target of the suite. Until W0.09 there is no API: every request answers 501.
var newTarget matrix.Factory = func(_ context.Context, _ matrix.Env) (matrix.Target, func(), error) {
	return matrix.NotImplemented(), func() {}, nil
}
