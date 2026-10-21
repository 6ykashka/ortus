package billing

import (
	"reflect"
	"testing"
)

// eq reports a difference of got and want (reflect.DeepEqual).
func eq[T any](t *testing.T, what string, got, want T) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n got %+v\nwant %+v", what, got, want)
	}
}

// val is the value of p, the zero value for nil.
func val[T any](p *T) T {
	if p == nil {
		var zero T
		return zero
	}
	return *p
}
