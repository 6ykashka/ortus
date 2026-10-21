package tasks

import (
	"errors"

	tasksapi "github.com/ortus/ortus-crm/backend/internal/api/tasks"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// failure is a refusal whose Problem carries more than a code and a detail: the violations of a 422
// validation_failed or the reason of a 409 (invalid_transition with not_in_status, checklist_open, …). The strict
// server writes it as the typed 422 or 409 of the operation; any other code goes through problem.Write.
type failure struct {
	code       string
	detail     string
	reason     string
	violations []tasksapi.ProblemViolation
}

func (f *failure) Error() string { return f.code + ": " + f.detail }

// invalid is 422 validation_failed with one violation of field (the texts of the prototype).
func invalid(field, code, message string) *failure {
	return &failure{code: codeValidation, detail: message, violations: []tasksapi.ProblemViolation{{Field: field, Code: code, Message: message}}}
}

// conflict is 409 invalid_transition with a reason ("" — none) and the text of the prototype.
func conflict(reason, detail string) *failure {
	return &failure{code: codeTransition, detail: detail, reason: reason}
}

// delegation is 409 delegation_exceeds_grant.
func delegation(detail string) *failure { return &failure{code: codeDelegation, detail: detail} }

// forbidden is 403 forbidden_action with the text of the prototype.
func forbidden(detail string) error { return problem.New(codeForbidden, detail) }

// notFound is 404 not_found with a detail.
func notFound(detail string) error { return problem.New(codeNotFound, detail) }

// asFailure returns the failure carried by err.
func asFailure(err error) (*failure, bool) {
	return errors.AsType[*failure](err)
}

// codeOf is the Problem.code of an error of the module ("" — none).
func codeOf(err error) string {
	if f, ok := asFailure(err); ok {
		return f.code
	}
	if p, ok := errors.AsType[*problem.Error](err); ok {
		return p.Code
	}
	return ""
}

// detailOf is the detail of an error of the module.
func detailOf(err error) string {
	if f, ok := asFailure(err); ok {
		return f.detail
	}
	if p, ok := errors.AsType[*problem.Error](err); ok {
		return p.Detail
	}
	return ""
}
