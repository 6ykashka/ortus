package session

import (
	"context"
	"errors"
	"sync"
	"time"
)

// ErrNotFound is returned by a Store for an unknown session id.
var ErrNotFound = errors.New("session: not found")

// Store keeps sessions. The in-memory store serves unit tests (one process, sessions die with it); cmd/api keeps
// them in the control DB (oidc.PGSessionStore, W1.03).
type Store interface {
	Create(ctx context.Context, s Session) error
	Get(ctx context.Context, id string) (Session, error)
	Delete(ctx context.Context, id string) error
}

// DefaultMaxSessions bounds the in-memory store: beyond it the session that expires first is evicted.
const DefaultMaxSessions = 100_000

// sweepEvery: every this many creations the in-memory store drops the expired sessions nobody presents any more.
const sweepEvery = 256

type memStore struct {
	mu         sync.RWMutex
	m          map[string]Session
	now        func() time.Time
	max        int
	sweepEvery int
	creates    int
}

// NewMemStore returns an in-memory Store bounded by DefaultMaxSessions.
func NewMemStore() Store { return newMemStore(time.Now, DefaultMaxSessions) }

func newMemStore(now func() time.Time, maxSessions int) *memStore {
	return &memStore{m: map[string]Session{}, now: now, max: maxSessions, sweepEvery: sweepEvery}
}

func (s *memStore) Create(_ context.Context, v Session) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.creates++
	if s.creates%s.sweepEvery == 0 || len(s.m) >= s.max {
		s.sweep()
	}
	if _, exists := s.m[v.ID]; !exists && len(s.m) >= s.max {
		s.evictFirstToExpire()
	}
	s.m[v.ID] = v
	return nil
}

// sweep drops expired sessions; the caller holds the write lock.
func (s *memStore) sweep() {
	now := s.now()
	for id, v := range s.m {
		if !now.Before(v.ExpiresAt) {
			delete(s.m, id)
		}
	}
}

// evictFirstToExpire drops the live session closest to expiry; the caller holds the write lock.
func (s *memStore) evictFirstToExpire() {
	var (
		victim string
		at     time.Time
	)
	for id, v := range s.m {
		if victim == "" || v.ExpiresAt.Before(at) {
			victim, at = id, v.ExpiresAt
		}
	}
	delete(s.m, victim)
}

func (s *memStore) len() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.m)
}

func (s *memStore) Get(_ context.Context, id string) (Session, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	v, ok := s.m[id]
	if !ok {
		return Session{}, ErrNotFound
	}
	return v, nil
}

func (s *memStore) Delete(_ context.Context, id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, id)
	return nil
}
