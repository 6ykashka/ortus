package pool

import (
	"context"

	fleetapi "github.com/ortus/ortus-crm/backend/internal/api/fleet"
)

// ViolationOf returns the detail and the violation of a 422 that names a field of the body (the answer of the
// strict server), for the tests of the package pool_test.
func ViolationOf(err error) (string, fleetapi.ProblemViolation, bool) {
	res, ok := validation(context.Background(), err)
	if !ok || res.Body.Detail == nil || res.Body.Violations == nil || len(*res.Body.Violations) != 1 {
		return "", fleetapi.ProblemViolation{}, false
	}
	return *res.Body.Detail, (*res.Body.Violations)[0], true
}
