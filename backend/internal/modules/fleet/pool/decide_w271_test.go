package pool

import (
	"testing"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// W2.71 (контракт 0.6.3-stage2, S2-20): решение «Только водителя» (approve_driver_only) объявлено в контракте, его
// обработку делает W2.72 — до неё 501 not_implemented до чтения запроса (а не 400 неизвестного решения).
func TestDecideDriverOnlyIsPending(t *testing.T) {
	t.Parallel()
	_, err := (&Service{}).Decide(t.Context(), tenantctx.TenantContext{}, uuid.New(), "",
		fleetapi.DriverTransferDecision{Decision: fleetapi.DriverTransferDecisionDecisionApproveDriverOnly})
	if !problem.Is(err, problem.CodeNotImplemented) {
		t.Fatalf("approve_driver_only: %v, want 501 not_implemented until W2.72", err)
	}
}
