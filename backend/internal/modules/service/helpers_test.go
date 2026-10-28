package service

import (
	"reflect"
	"testing"
	"time"
)

// eq reports a difference of two comparable values.
func eq[T comparable](t *testing.T, name string, got, want T) {
	t.Helper()
	if got != want {
		t.Errorf("%s: got %v, want %v", name, got, want)
	}
}

// same reports a difference of two values by reflect.DeepEqual.
func same(t *testing.T, name string, got, want any) {
	t.Helper()
	if !reflect.DeepEqual(got, want) {
		t.Errorf("%s: got %v, want %v", name, got, want)
	}
}

// when reports a difference of two moments.
func sameTime(t *testing.T, name string, got, want time.Time) {
	t.Helper()
	if !got.Equal(want) {
		t.Errorf("%s: got %v, want %v", name, got, want)
	}
}
