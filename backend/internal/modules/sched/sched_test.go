package sched

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestEffective(t *testing.T) {
	t.Parallel()
	now := time.Date(2026, 10, 1, 7, 30, 0, 0, time.UTC)
	before, after := now.Add(-time.Second), now.Add(time.Minute)
	cases := []struct {
		name, state string
		expires     *time.Time
		want        string
	}{
		{"hold до срока", StateHold, &after, StateHold},
		{"hold ровно в срок — истёк", StateHold, &now, StateExpired},
		{"hold после срока", StateHold, &before, StateExpired},
		{"hold без срока не истекает", StateHold, nil, StateHold},
		{"снятая", StateReleased, &before, StateReleased},
		{"потреблённая", StateConsumed, &before, StateConsumed},
		{"подтверждённая", StateConfirmed, nil, StateConfirmed},
		{"истёкшая", StateExpired, &after, StateExpired},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			t.Parallel()
			if got := Effective(c.state, c.expires, now); got != c.want {
				t.Fatalf("Effective(%s) = %s, want %s", c.state, got, c.want)
			}
		})
	}
}

func TestWindowValid(t *testing.T) {
	t.Parallel()
	at := time.Date(2026, 10, 1, 7, 0, 0, 0, time.UTC)
	for name, c := range map[string]struct {
		w    Window
		want bool
	}{
		"интервал":      {Window{at, at.Add(time.Hour)}, true},
		"пустой":        {Window{at, at}, false},
		"обратный":      {Window{at.Add(time.Hour), at}, false},
		"без начала":    {Window{time.Time{}, at}, false},
		"без обеих дат": {Window{}, false},
	} {
		if got := c.w.Valid(); got != c.want {
			t.Errorf("%s: Valid() = %v, want %v", name, got, c.want)
		}
	}
}

func TestOverlapErrorIs(t *testing.T) {
	t.Parallel()
	err := error(&OverlapError{Index: 1, Claim: Claim{Kind: KindPerson, Ref: uuid.New()}})
	if !errors.Is(err, ErrOverlap) || errors.Is(err, ErrNotHeld) {
		t.Fatalf("errors.Is: %v", err)
	}
	var oe *OverlapError
	if !errors.As(err, &oe) || oe.Index != 1 {
		t.Fatalf("errors.As: %v", err)
	}
}
