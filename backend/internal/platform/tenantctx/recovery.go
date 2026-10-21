package tenantctx

import (
	"context"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// ResolveRecovery builds the TenantContext of an operation the owner keeps in every state of the working lifecycle
// (W4.60, Q-W4.07-3: «the owner keeps billing access», TenantPatch «owner gets recovery/billing access»): the
// membership is checked as by Resolve, then trial and active pass, grace, read_only and suspended pass as ReadOnly
// (reads and the commands of the operation itself; its handler does not refuse ReadOnly), and a tenant outside the
// lifecycle (provisioning, closing, closed) is not_found.
func ResolveRecovery(ctx context.Context, dir Directory, accountID uuid.UUID, rawTenantID string) (TenantContext, error) {
	m, tc, err := member(ctx, dir, accountID, rawTenantID)
	if err != nil {
		return TenantContext{}, err
	}
	switch m.TenantState {
	case stateTrial, stateActive:
	case stateGrace, stateReadOnly, stateSuspended:
		tc.ReadOnly = true
	default:
		return TenantContext{}, problem.New(problem.CodeNotFound, "")
	}
	return tc, nil
}
