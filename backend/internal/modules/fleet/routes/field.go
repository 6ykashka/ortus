package routes

import (
	"context"
	"errors"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
	"github.com/ortus/ortus-crm/backend/internal/modules/org/kit" //nolint:depguard // W2.03: shared command helpers of the modules (Q-W1.05-18)
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// fieldError is a 422 validation_failed that names the field of the body (Problem.violations; the violations of the
// MSW of W2.71, fleet/trips.ts): Error is the detail of the answer, Unwrap — the problem of the code.
type fieldError struct {
	detail string
	fleetapi.ProblemViolation
}

func (e *fieldError) Error() string { return e.detail }

func (e *fieldError) Unwrap() error { return kit.Invalid(e.detail) }

// invalidField is the 422 of detail with the violation v.
func invalidField(detail string, v fleetapi.ProblemViolation) *fieldError {
	return &fieldError{detail: detail, ProblemViolation: v}
}

// validation returns the 422 answer of err when it names a field of the body.
func validation(ctx context.Context, err error) (fleetapi.ValidationApplicationProblemPlusJSONResponse, bool) {
	e, ok := errors.AsType[*fieldError](err)
	if !ok {
		return fleetapi.ValidationApplicationProblemPlusJSONResponse{}, false
	}
	const code = kit.CodeValidationFailed
	p := catalog.Problems[code]
	rid, detail := requestid.FromContext(ctx), e.detail
	violations := []fleetapi.ProblemViolation{e.ProblemViolation}
	return fleetapi.ValidationApplicationProblemPlusJSONResponse{
		Body: fleetapi.Problem{
			Type: problem.TypeBase + code, Title: p.Title, Status: int64(p.Status), Code: fleetapi.ProblemCode(code),
			Detail: &detail, RequestId: rid, Violations: &violations,
		},
		Headers: fleetapi.ValidationResponseHeaders{XRequestId: &rid},
	}, true
}
