package accesstest

import (
	"errors"
	"testing"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

// As returns the response of a strict handler as T; an error or another type fails the test.
func As[T any](tb testing.TB, resp any, err error) T {
	tb.Helper()
	if err != nil {
		tb.Fatalf("unexpected error: %v", err)
	}
	v, ok := resp.(T)
	if !ok {
		tb.Fatalf("response %T, want %T", resp, v)
	}
	return v
}

// Code returns Problem.code of err ("" for nil, "?<text>" for an error without a code).
func Code(err error) string {
	if pe, ok := errors.AsType[*problem.Error](err); ok {
		return pe.Code
	}
	if err != nil {
		return "?" + err.Error()
	}
	return ""
}

// Problem returns «code|detail» of err.
func Problem(err error) string {
	if pe, ok := errors.AsType[*problem.Error](err); ok {
		return pe.Code + "|" + pe.Detail
	}
	return Code(err)
}
