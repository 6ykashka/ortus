// Package problem is the single place where errors become application/problem+json responses (W0.09,
// design/docs/14-engineering.md: typed errors → Problem.code in one place). Codes, statuses and titles come from
// api/errors.yaml through the generated catalog; an error the registry does not know never leaks its text.
package problem

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/ortus/ortus-crm/backend/internal/api/catalog"
	"github.com/ortus/ortus-crm/backend/internal/platform/requestid"
)

// Codes produced by the platform packages (api/errors.yaml).
const (
	CodeMalformedRequest      = "malformed_request"
	CodeUnknownField          = "unknown_field"
	CodeSessionExpired        = "session_expired"
	CodeForbiddenAction       = "forbidden_action"
	CodeTenantReadOnly        = "tenant_read_only"
	CodeTenantSuspended       = "tenant_suspended"
	CodeCSRFFailed            = "csrf_failed"
	CodeOriginNotAllowed      = "origin_not_allowed"
	CodeNotFound              = "not_found"
	CodeDependencyUnavailable = "dependency_unavailable"
	CodeNotImplemented        = "not_implemented"
)

// TypeBase prefixes Problem.type: https://docs.ortus.example/errors/<code>.
const TypeBase = "https://docs.ortus.example/errors/"

// ContentType of every error response.
const ContentType = "application/problem+json"

// internalDetail replaces the text of errors that have no Problem.code. The registry has no 500 code yet
// (brief W0.09 §10 item 3): until the contract steward adds one, they are reported as dependency_unavailable.
const internalDetail = "Внутренняя ошибка"

// Error is an error with a canonical Problem.code.
type Error struct {
	Code   string
	Detail string // shown to the user; never internal details
	cause  error
}

// New returns an error with code and an optional user-facing detail.
func New(code, detail string) *Error { return &Error{Code: code, Detail: detail} }

// Wrap returns an error with code that keeps err for logs and errors.Is; err's text is not sent to the client.
func Wrap(code string, err error) *Error { return &Error{Code: code, cause: err} }

func (e *Error) Error() string {
	if e.cause != nil {
		return e.Code + ": " + e.cause.Error()
	}
	if e.Detail != "" {
		return e.Code + ": " + e.Detail
	}
	return e.Code
}

// Unwrap returns the wrapped cause.
func (e *Error) Unwrap() error { return e.cause }

// Is reports whether err carries Problem.code code.
func Is(err error, code string) bool {
	pe, ok := errors.AsType[*Error](err)
	return ok && pe.Code == code
}

// Body is the Problem schema of the contract (fields in the order of the schema, no extra fields).
type Body struct {
	Type      string `json:"type"`
	Title     string `json:"title"`
	Status    int    `json:"status"`
	Code      string `json:"code"`
	Detail    string `json:"detail,omitempty"`
	RequestID string `json:"requestId"`
}

// From maps err to a Problem body: a known *Error keeps its code; anything else (including unknown codes and
// context deadlines) becomes dependency_unavailable without the error text.
func From(ctx context.Context, err error) Body {
	code, detail := CodeDependencyUnavailable, internalDetail
	if pe, ok := errors.AsType[*Error](err); ok {
		if _, known := catalog.Problems[pe.Code]; known {
			code, detail = pe.Code, pe.Detail
		}
	}
	p := catalog.Problems[code]
	return Body{
		Type:      TypeBase + code,
		Title:     p.Title,
		Status:    p.Status,
		Code:      code,
		Detail:    detail,
		RequestID: requestid.FromContext(ctx),
	}
}

type reporterKey struct{}

// WithReporter returns ctx whose server errors (status ≥ 500) Write passes to report with their cause, so the
// request log can name what failed while the client only sees the Problem body (httpx.Logging installs it).
func WithReporter(ctx context.Context, report func(err error)) context.Context {
	return context.WithValue(ctx, reporterKey{}, report)
}

// Write sends err as application/problem+json. The body ends with '\n' (json.Encoder), so equal errors give
// byte-equal bodies.
func Write(w http.ResponseWriter, r *http.Request, err error) {
	b := From(r.Context(), err)
	if report, ok := r.Context().Value(reporterKey{}).(func(error)); ok && b.Status >= http.StatusInternalServerError {
		report(err)
	}
	w.Header().Set("Content-Type", ContentType)
	w.WriteHeader(b.Status)
	_ = json.NewEncoder(w).Encode(b) // the client is gone if the write fails; nothing left to report
}
