package kit

import (
	"context"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Within is Request for a command that checks access in its transaction q, after its locks (W1.47, Q-W1.41-9): the
// evaluator reads the subject, the installed modules and the unit tree through q (authz.TxSource), never through
// another connection of the pool of the tenant. A command that holds access.policy_state and waits for a second
// connection deadlocks with the commands that hold the rest of the pool waiting for that row; reading in q, every
// command of the module holds one connection of the tenant DB at most.
//
// The subject of a member is read at once: Within is called before the first write of the command, so that its checks
// see the grants as its locks found them and never its own uncommitted writes (an actor that adds itself to a group
// with roles does not delegate those roles), as the checks over another connection did. The owner has no grants to
// read; its work functions are read when an action needs them (no command of the module writes work functions).
func Within(ctx context.Context, ev *authz.Evaluator, tc tenantctx.TenantContext, q authz.Querier) (*authz.Evaluator, error) {
	src := authz.TxSource{Q: q}
	cp := request(ev, src)
	if ev.Units != nil {
		cp.Units = src
	}
	if !tc.Owner {
		if _, err := cp.Source.Subject(ctx, tc, cp.Now(), true); err != nil {
			return nil, Unavailable(err)
		}
	}
	return cp, nil
}
