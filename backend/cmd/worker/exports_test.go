package main

import (
	"testing"
	"time"
)

// W4.50: WORKER_EXPORT_INTERVAL — how often the worker takes the export jobs of «Данные»: 2s by default, 0 — off, a
// malformed or negative value stops the start.
func TestExportInterval(t *testing.T) {
	t.Parallel()
	for raw, want := range map[string]time.Duration{"": 2 * time.Second, "500ms": 500 * time.Millisecond, "0": 0, "1m": time.Minute} {
		got, err := exportInterval(func(string) string { return raw })
		if err != nil || got != want {
			t.Errorf("WORKER_EXPORT_INTERVAL=%q: %v, %v; want %v", raw, got, err, want)
		}
	}
	for _, raw := range []string{"-1s", "soon", "5"} {
		if _, err := exportInterval(func(string) string { return raw }); err == nil {
			t.Errorf("WORKER_EXPORT_INTERVAL=%q: no error", raw)
		}
	}
}
