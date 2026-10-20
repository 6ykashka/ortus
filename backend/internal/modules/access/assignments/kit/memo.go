package kit

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Request returns a copy of ev that reads each subject once: a command checks many actions (delegation of every
// action of a role over every unit of a subtree) against the same grants. Use it for one request only, so that a
// revoked role still stops working at the next request (AC-10). The clock is frozen at the start of the request: all
// checks of one command see the same moment. Inside the transaction of a command — Within.
func Request(ev *authz.Evaluator) *authz.Evaluator { return request(ev, ev.Source) }

// request is Request over src in place of the source of ev.
func request(ev *authz.Evaluator, src authz.Source) *authz.Evaluator {
	cp := *ev
	at := time.Now()
	if ev.Now != nil {
		at = ev.Now()
	}
	cp.Now = func() time.Time { return at }
	cp.Source = &memoSource{src: src, subjects: map[subjectKey]authz.Subject{}}
	return &cp
}

type subjectKey struct {
	tenant, person uuid.UUID
	owner, grants  bool
	at             time.Time
}

type memoSource struct {
	src      authz.Source
	mu       sync.Mutex
	subjects map[subjectKey]authz.Subject
}

// Subject implements authz.Source; only successful reads are kept.
func (m *memoSource) Subject(ctx context.Context, tc tenantctx.TenantContext, at time.Time, grants bool) (authz.Subject, error) {
	k := subjectKey{tenant: tc.TenantID, person: tc.PersonID, owner: tc.Owner, grants: grants, at: at}
	m.mu.Lock()
	defer m.mu.Unlock()
	if s, ok := m.subjects[k]; ok {
		return s, nil
	}
	s, err := m.src.Subject(ctx, tc, at, grants)
	if err == nil {
		m.subjects[k] = s
	}
	return s, err
}

// InstalledModules implements authz.Source.
func (m *memoSource) InstalledModules(ctx context.Context, tc tenantctx.TenantContext) ([]string, error) {
	return m.src.InstalledModules(ctx, tc)
}

// Groups implements authz.GroupSource when the source does (group entries of access lists of nodes, W4.01).
func (m *memoSource) Groups(ctx context.Context, tenantID, person uuid.UUID) ([]uuid.UUID, error) {
	gs, ok := m.src.(authz.GroupSource)
	if !ok {
		return nil, nil
	}
	return gs.Groups(ctx, tenantID, person)
}
