package idem

import (
	"bytes"
	"context"
	"sync"
	"time"
)

// sweepEvery is how many claims MemStore makes between sweeps of expired records.
const sweepEvery = 256

type memKey struct {
	Namespace
	key string
}

type memRow struct {
	hash    []byte
	done    bool
	out     Outcome
	expires time.Time
}

// MemStore keeps records in process memory: identity and platform operations, which have no tenant DB, and tests.
// Records live until they expire and are lost on restart (brief W1.01 §10 item 1).
type MemStore struct {
	mu     sync.Mutex
	rows   map[memKey]*memRow
	claims int
}

// NewMemStore returns an empty MemStore.
func NewMemStore() *MemStore { return &MemStore{rows: map[memKey]*memRow{}} }

func keyOf(rec Record) memKey { return memKey{Namespace: rec.Namespace, key: rec.Key} }

// Begin implements Store.
func (m *MemStore) Begin(_ context.Context, rec Record, now, leaseUntil time.Time) (*Outcome, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := keyOf(rec)
	if row, ok := m.rows[k]; ok && now.Before(row.expires) {
		switch {
		case !bytes.Equal(row.hash, rec.Hash):
			return nil, ErrKeyReused
		case !row.done:
			return nil, ErrInProgress
		}
		out := row.out
		return &out, nil
	}
	m.claims++
	if m.claims%sweepEvery == 0 {
		for key, row := range m.rows {
			if !now.Before(row.expires) {
				delete(m.rows, key)
			}
		}
	}
	m.rows[k] = &memRow{hash: bytes.Clone(rec.Hash), expires: leaseUntil}
	return nil, nil
}

// Complete implements Store.
func (m *MemStore) Complete(_ context.Context, rec Record, out Outcome, expires time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	row, ok := m.rows[keyOf(rec)]
	if !ok || row.done || !bytes.Equal(row.hash, rec.Hash) {
		return nil
	}
	row.done, row.expires = true, expires
	row.out = Outcome{Status: out.Status, Header: out.Header.Clone(), Body: bytes.Clone(out.Body)}
	return nil
}

// Release implements Store.
func (m *MemStore) Release(_ context.Context, rec Record) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	k := keyOf(rec)
	if row, ok := m.rows[k]; ok && !row.done && bytes.Equal(row.hash, rec.Hash) {
		delete(m.rows, k)
	}
	return nil
}
