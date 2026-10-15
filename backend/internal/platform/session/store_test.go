package session

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func sess(id string, expires time.Time) Session {
	return Session{ID: id, IssuedAt: expires.Add(-time.Hour), ExpiresAt: expires}
}

// Ревью W0.09: хранилище в памяти не растёт без предела — истёкшие сессии, которые больше не предъявляют,
// удаляются при создании новых.
func TestMemStoreSweepsExpired(t *testing.T) {
	t.Parallel()
	c := &clock{now: t0}
	s := newMemStore(c.Now, 1000)
	s.sweepEvery = 1
	for i := range 10 {
		_ = s.Create(t.Context(), sess(fmt.Sprint("old-", i), t0.Add(time.Hour)))
	}
	c.now = t0.Add(2 * time.Hour)
	_ = s.Create(t.Context(), sess("fresh", c.now.Add(time.Hour)))
	if n := s.len(); n != 1 {
		t.Fatalf("%d sessions after the sweep, want 1", n)
	}
	if _, err := s.Get(t.Context(), "old-3"); !errors.Is(err, ErrNotFound) {
		t.Fatalf("expired session kept: %v", err)
	}
}

// При пределе MaxSessions живых сессий вытесняется та, что истекает раньше всех; новая сохраняется.
func TestMemStoreIsBounded(t *testing.T) {
	t.Parallel()
	c := &clock{now: t0}
	s := newMemStore(c.Now, 3)
	for i := range 5 {
		_ = s.Create(t.Context(), sess(fmt.Sprint("s-", i), t0.Add(time.Duration(i+1)*time.Hour)))
	}
	if n := s.len(); n != 3 {
		t.Fatalf("%d sessions, want 3", n)
	}
	for id, kept := range map[string]bool{"s-0": false, "s-1": false, "s-2": true, "s-4": true} {
		if _, err := s.Get(t.Context(), id); (err == nil) != kept {
			t.Errorf("%s: kept=%v, want %v", id, err == nil, kept)
		}
	}
}
