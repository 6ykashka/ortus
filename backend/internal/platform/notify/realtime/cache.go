package realtime

import (
	"context"
	"fmt"
	"slices"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Defaults of PolicyCache.
const (
	DefaultCacheMaxAge  = time.Second // ADR-0015: «the evaluator cache — not longer than 1 second»
	DefaultCacheEntries = 10_000
)

// VersionSource reads access.policy_state.policy_version of a tenant DB.
type VersionSource interface {
	PolicyVersion(ctx context.Context, tenantID uuid.UUID) (int64, error)
}

// PGVersions reads the policy version through the tenant pools (role ortus_api).
type PGVersions struct{ Pools authz.Pools }

// PolicyVersion implements VersionSource; a tenant DB without the row has version 0.
func (v PGVersions) PolicyVersion(ctx context.Context, tenantID uuid.UUID) (int64, error) {
	pool, err := v.Pools.For(ctx, tenantID)
	if err != nil {
		return 0, fmt.Errorf("realtime: tenant DB: %w", err)
	}
	var n int64
	if err := pool.QueryRow(ctx, `select coalesce((select policy_version from access.policy_state), 0)`).Scan(&n); err != nil {
		return 0, fmt.Errorf("realtime: policy version: %w", err)
	}
	return n, nil
}

type subjectKey struct {
	tenant, person uuid.UUID
	owner, grants  bool
}

type subjectEntry struct {
	version int64
	loaded  time.Time // by Clock
	at      time.Time // the moment of the check it was loaded for
	subject authz.Subject
}

type modulesEntry struct {
	version int64
	loaded  time.Time
	keys    []string
}

type versionEntry struct {
	version int64
	read    time.Time
}

// PolicyCache is an authz.Source that reuses subjects and installed modules while the policy version of their
// tenant is unchanged and the entry is younger than MaxAge by Clock. The version is read on every check
// (VersionMaxAge = 0) or kept at most VersionMaxAge, and Invalidate drops it at once (a context.changed hint).
//
// A revocation that bumps the version (BumpPolicy) is therefore seen by the very next check; a change that does not
// (the end of a grant period) — within MaxAge. Failures are never cached and fail the check.
type PolicyCache struct {
	Inner         authz.Source
	Versions      VersionSource
	Clock         func() time.Time // the age of entries; never APP_FIXED_NOW; nil: time.Now
	MaxAge        time.Duration    // 0: DefaultCacheMaxAge
	VersionMaxAge time.Duration    // 0: read the version on every check
	MaxEntries    int              // 0: DefaultCacheEntries

	mu       sync.Mutex
	versions map[uuid.UUID]versionEntry
	subjects map[subjectKey]subjectEntry
	modules  map[uuid.UUID]modulesEntry
}

var _ authz.Source = (*PolicyCache)(nil)

func (c *PolicyCache) now() time.Time {
	if c.Clock != nil {
		return c.Clock()
	}
	return time.Now()
}

func (c *PolicyCache) maxAge() time.Duration {
	if c.MaxAge > 0 {
		return c.MaxAge
	}
	return DefaultCacheMaxAge
}

func (c *PolicyCache) maxEntries() int {
	if c.MaxEntries > 0 {
		return c.MaxEntries
	}
	return DefaultCacheEntries
}

// fresh reports whether something loaded at loaded is younger than MaxAge at now.
func (c *PolicyCache) fresh(loaded, now time.Time) bool { return now.Sub(loaded) < c.maxAge() }

// version returns the current policy version of tenant: from the database, or from the cache while it is younger
// than VersionMaxAge.
func (c *PolicyCache) version(ctx context.Context, tenant uuid.UUID) (int64, error) {
	now := c.now()
	if c.VersionMaxAge > 0 {
		c.mu.Lock()
		e, ok := c.versions[tenant]
		c.mu.Unlock()
		if ok && now.Sub(e.read) < c.VersionMaxAge {
			return e.version, nil
		}
	}
	v, err := c.Versions.PolicyVersion(ctx, tenant)
	if err != nil {
		return 0, err
	}
	if c.VersionMaxAge > 0 {
		c.mu.Lock()
		if c.versions == nil || len(c.versions) >= c.maxEntries() {
			c.versions = map[uuid.UUID]versionEntry{}
		}
		c.versions[tenant] = versionEntry{version: v, read: now}
		c.mu.Unlock()
	}
	return v, nil
}

// cloneSubject copies the slices a caller could modify.
func cloneSubject(s authz.Subject) authz.Subject {
	s.Functions = slices.Clone(s.Functions)
	s.Grants = slices.Clone(s.Grants)
	for i := range s.Grants {
		s.Grants[i].Actions = slices.Clone(s.Grants[i].Actions)
	}
	return s
}

// Subject implements authz.Source.
func (c *PolicyCache) Subject(ctx context.Context, tc tenantctx.TenantContext, at time.Time, grants bool) (authz.Subject, error) {
	v, err := c.version(ctx, tc.TenantID)
	if err != nil {
		return authz.Subject{}, err
	}
	key := subjectKey{tenant: tc.TenantID, person: tc.PersonID, owner: tc.Owner, grants: grants}
	now := c.now()
	c.mu.Lock()
	e, ok := c.subjects[key]
	c.mu.Unlock()
	if ok && e.version == v && c.fresh(e.loaded, now) && at.Sub(e.at).Abs() < c.maxAge() {
		return cloneSubject(e.subject), nil
	}
	s, err := c.Inner.Subject(ctx, tc, at, grants)
	if err != nil {
		return authz.Subject{}, err
	}
	s.Owner = tc.Owner
	c.mu.Lock()
	if c.subjects == nil || len(c.subjects) >= c.maxEntries() {
		c.subjects = c.pruned(c.subjects, now)
	}
	c.subjects[key] = subjectEntry{version: v, loaded: now, at: at, subject: cloneSubject(s)}
	c.mu.Unlock()
	return s, nil
}

// pruned returns the fresh entries of m, or an empty map when they still fill the cache; the caller holds the lock.
func (c *PolicyCache) pruned(m map[subjectKey]subjectEntry, now time.Time) map[subjectKey]subjectEntry {
	out := map[subjectKey]subjectEntry{}
	for k, e := range m {
		if c.fresh(e.loaded, now) {
			out[k] = e
		}
	}
	if len(out) >= c.maxEntries() {
		return map[subjectKey]subjectEntry{}
	}
	return out
}

// InstalledModules implements authz.Source.
func (c *PolicyCache) InstalledModules(ctx context.Context, tc tenantctx.TenantContext) ([]string, error) {
	v, err := c.version(ctx, tc.TenantID)
	if err != nil {
		return nil, err
	}
	now := c.now()
	c.mu.Lock()
	e, ok := c.modules[tc.TenantID]
	c.mu.Unlock()
	if ok && e.version == v && c.fresh(e.loaded, now) {
		return slices.Clone(e.keys), nil
	}
	keys, err := c.Inner.InstalledModules(ctx, tc)
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	if c.modules == nil || len(c.modules) >= c.maxEntries() {
		c.modules = map[uuid.UUID]modulesEntry{}
	}
	c.modules[tc.TenantID] = modulesEntry{version: v, loaded: now, keys: slices.Clone(keys)}
	c.mu.Unlock()
	return keys, nil
}

// Invalidate drops what the cache knows of tenantID.
func (c *PolicyCache) Invalidate(tenantID uuid.UUID) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.versions, tenantID)
	delete(c.modules, tenantID)
	for k := range c.subjects {
		if k.tenant == tenantID {
			delete(c.subjects, k)
		}
	}
}

// InvalidateAll empties the cache.
func (c *PolicyCache) InvalidateAll() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.versions, c.subjects, c.modules = nil, nil, nil
}

// len returns the number of cached subjects.
func (c *PolicyCache) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.subjects)
}
