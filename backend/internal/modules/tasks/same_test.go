package tasks

import (
	"reflect"
	"testing"
)

// same reports a difference between got and want (deep equality) as an error of the test.
func same(t *testing.T, what string, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s:\n got %+v\nwant %+v", what, got, want)
	}
}
