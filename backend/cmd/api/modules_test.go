package main

import (
	"testing"
	"time"

	"github.com/ortus/ortus-crm/backend/internal/control/subscriptions"
)

// SUBSCRIPTION_SWEEP_INTERVAL (W1.08): по умолчанию жизненный цикл подписок идёт только в prod (стенд держит
// состояние сида 01.10.2026), значение — длительность Go, 0 выключает; мусор — ошибка конфигурации.
func TestSweepInterval(t *testing.T) {
	t.Parallel()
	for _, c := range []struct {
		raw, env string
		want     time.Duration
		bad      bool
	}{
		{"", envProd, time.Minute, false},
		{"", envDev, 0, false},
		{"", envE2E, 0, false},
		{"30s", envDev, 30 * time.Second, false},
		{"0", envProd, 0, false},
		{"soon", envDev, 0, true},
		{"-1m", envProd, 0, true},
	} {
		got, err := sweepInterval(func(k string) string {
			if k == sweepEnv {
				return c.raw
			}
			return ""
		}, c.env)
		if got != c.want || (err != nil) != c.bad {
			t.Errorf("%q in %s: %v %v", c.raw, c.env, got, err)
		}
	}
	if lifecycle(subscriptions.Store{}, 0, nil) != nil {
		t.Error("lifecycle with interval 0 must be off")
	}
}
