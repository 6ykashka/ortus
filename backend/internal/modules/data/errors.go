package data

import "github.com/ortus/ortus-crm/backend/internal/platform/problem"

// Texts of the answers (MSW W2.51, adapter/src/msw/data/index.ts; example queryDataset/validation_failed).
const (
	textNotFound       = "Набор не найден."
	textBadCursor      = "Неверный курсор выборки."
	textForeignCursor  = "Курсор не подходит к выборке."
	codeValidation     = "validation_failed"
	violationUnknown   = "unknown_field"
	violationOperator  = "operator"
	violationGrouped   = "not_grouped"
	violationValues    = "values"
	violationAlias     = "alias"
	messageUnknown     = "Поле недоступно"
	messageOperator    = "Оператор недоступен"
	messageNotGrouped  = "Поле не входит в группировку"
	messageValues      = "Значения не подходят к полю"
	messageAliasInUse  = "Псевдоним уже используется"
	detailUnknownField = "Поле недоступно: %s."
)

// fieldError is a 422 validation_failed of a query with its violation (ProblemViolation of the contract).
type fieldError struct {
	Detail  string // Problem.detail
	Field   string // the path in the query: select[0], filters[1].operator
	Code    string // ProblemViolation.code
	Message string // ProblemViolation.message
}

func (e *fieldError) Error() string { return codeValidation + ": " + e.Detail }

// malformed is a 400 malformed_request: the query breaks the schema of DatasetQuery.
func malformed(detail string) error { return problem.New(problem.CodeMalformedRequest, detail) }
