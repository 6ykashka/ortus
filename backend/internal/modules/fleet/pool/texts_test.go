package pool

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/google/uuid"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// TestLimitsAnswerWithTheCanonicalText: the limits of the bodies the schema validator checks first (maxItems,
// maxLength) answer 422 validation_failed without a detail of the module — the interface shows the canonical text of
// the code (errors.ts); the module invents no texts the MSW of W2.51 and the prototype do not have.
func TestLimitsAnswerWithTheCanonicalText(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	tc := tenantctx.TenantContext{TenantID: uuid.New()}
	long := strings.Repeat("я", maxComment+1)
	many := make([]string, maxQualifications+1)
	for i := range many {
		many[i] = "Кат. C"
	}
	_, publishErr := checkPublish(fleetapi.DriverPoolPublicationCreate{Qualifications: many})
	_, labelErr := checkPublish(fleetapi.DriverPoolPublicationCreate{Qualifications: []string{strings.Repeat("я", maxQualification+1)}})
	terms := strings.Repeat("я", maxTerms+1)
	_, termsErr := checkPublish(fleetapi.DriverPoolPublicationCreate{Terms: &terms})
	s := &Service{}
	_, reasonErr := s.Request(ctx, tc, fleetapi.DriverTransferCreate{Reason: long})
	_, commentErr := s.Decide(ctx, tc, uuid.New(), `"1"`, fleetapi.DriverTransferDecision{
		Decision: fleetapi.DriverTransferDecisionDecisionReject, Comment: &long,
	})
	for name, err := range map[string]error{
		"qualifications": publishErr, "qualification": labelErr, "terms": termsErr, "reason": reasonErr, "comment": commentErr,
	} {
		pe, ok := errors.AsType[*problem.Error](err)
		if !ok || pe.Code != "validation_failed" || pe.Detail != "" {
			t.Errorf("%s over the limit: %v, want validation_failed without a detail of the module", name, err)
		}
	}
}
