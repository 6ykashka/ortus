package main

import (
	"time"

	cashapi "github.com/ortus/ortus-crm/backend/internal/api/cash"
	"github.com/ortus/ortus-crm/backend/internal/modules/cash"
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// newCash is the server of the tag Cash (W5.31, contract 0.12.0-stage5): cash accounts, the journal with reversals, shifts,
// transfers, proposals of the modules, advances with receipts, limits and approval requests over the tenant pools (tenant
// 0040–0042), the evaluator of W1.04 (scope «account», «self», limit: amount) and the clock of the application
// (APP_FIXED_NOW outside prod). Limits of roles come from cash.Unlimited until the roles carry them (W5.33).
func newCash(pools cash.Pools, ev *authz.Evaluator, now func() time.Time) cashapi.StrictServerInterface {
	return cash.Server{S: &cash.Service{Pools: pools, Authz: ev, Now: now}}
}
