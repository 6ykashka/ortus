package chats

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// Pools reaches the database of a tenant (tenantctx.Pools: sentinel-checked, never a fallback database).
type Pools interface {
	For(ctx context.Context, tenantID uuid.UUID) (*pgxpool.Pool, error)
}

// Membership is the status of a person in the organization and whether they own the business (control DB).
type Membership struct {
	Status string // active, invited, suspended, ended
	Owner  bool
}

// Memberships reads the memberships of the people of a tenant by their ids (people.person_profiles.membership_id).
type Memberships interface {
	Memberships(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]Membership, error)
}

// Perm decides the actions of the evaluator of W1.04 (authz.Evaluator.Permit). The grants of the organization and of the
// unit add to the actions the role of a chat gives inside it.
type Perm interface {
	Permit(ctx context.Context, tc tenantctx.TenantContext, action string, r authz.Resource) error
}

// ObjectRef names a record a chat belongs to.
type ObjectRef struct {
	Module string
	Type   string // trip, repair_object
	ID     uuid.UUID
}

// Relations resolves the sources «relation» of the roster: the people a record names now (the foreman of a repair
// object). nil: no relation gives anybody (stage 6 brings the objects of repairs, Q-W7.11-3).
type Relations interface {
	Related(ctx context.Context, tx pgx.Tx, ref ObjectRef) ([]uuid.UUID, error)
}

// TaskDraft is a task made of a message (chatToTask).
type TaskDraft struct {
	Project uuid.UUID // uuid.Nil: the port picks the project of the unit of the chat
	Title   string
	Unit    uuid.UUID
	ChatID  uuid.UUID
	Message uuid.UUID
	Link    string // «Чат «…»»
}

// TaskResult is the task created.
type TaskResult struct {
	ID  uuid.UUID
	Key string
}

// Tasks creates a task from a message with the rights of the actor (tasks.Service.CreateTask, W4.11).
type Tasks interface {
	Create(ctx context.Context, tc tenantctx.TenantContext, d TaskDraft) (TaskResult, error)
}

// Files is what the chats ask of the files of the organization. nil: the files stay where they are (the storage frees
// itself with the term of the files module).
type Files interface {
	// Move gives the file to a record (files.objects.owner) — «Сохранить в запись».
	Move(ctx context.Context, tx pgx.Tx, fileID uuid.UUID, owner ObjectRef) error
	// Remove releases the files of cleaned attachments and expired view-once files in tx (the bytes go back to the quota of the
	// organization). The returned func, if any, deletes their objects from the storage and runs after the commit.
	Remove(ctx context.Context, tx pgx.Tx, fileIDs []uuid.UUID) (func(context.Context), error)
	// ViewURL is the short link to see a view-once file: with a watermark, without a download.
	ViewURL(ctx context.Context, tenantID, fileID uuid.UUID, ttl time.Duration) (string, error)
	// Save stores the file of an export of a chat as a file of the organization owned by the export owner and returns its id.
	Save(ctx context.Context, tx pgx.Tx, tenantID, by uuid.UUID, owner ObjectRef, name, contentType string, data []byte) (uuid.UUID, error)
}

// Hints tells the clients a chat changed: the hint chat.changed {chatId, lastSeq} without data (ADR-0015, W7.12). It is
// called after the commit. nil: no hints.
type Hints interface {
	ChatChanged(ctx context.Context, tenantID, chatID uuid.UUID, lastSeq int64, members []uuid.UUID)
}

// Service answers the operations of the tag Chats.
type Service struct {
	Pools       Pools
	Memberships Memberships      // nil: every person is an active member, none is an owner
	Perm        Perm             // nil: only the roles of the chats and the owner of the business act
	Relations   Relations        // nil: no relation gives anybody
	Tasks       Tasks            // nil: «Задача из сообщения» answers dependency_unavailable
	Files       Files            // nil: see Files
	Hints       Hints            // nil: no hints
	PollKey     []byte           // CHAT_POLL_VOTER_KEY: the key of voter_hash of anonymous polls; empty: anonymous polls are off
	Now         func() time.Time // the clock of the application (APP_FIXED_NOW outside prod); nil: time.Now
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

// req is one operation of a member: its transaction, the person and the instant.
type req struct {
	s       *Service
	tc      tenantctx.TenantContext
	tx      pgx.Tx
	now     time.Time
	me      uuid.UUID
	driver  *bool
	granted map[string]bool
	kinds   map[Kind]Policy
	// relatedTo marks the chats of records the actor is in through the record (the trip they drive, the object they foreman).
	relatedTo map[uuid.UUID]bool
	after     []func() // run after the commit (hints)
}

// run runs fn in one transaction of the tenant DB of tc (read only unless write); an error rolls it back, a Problem error
// keeps its code and anything else is dependency_unavailable.
func (s *Service) run(ctx context.Context, tc tenantctx.TenantContext, write bool, fn func(*req) error) error {
	if tc.TenantID == uuid.Nil {
		return notFound("")
	}
	pool, err := s.Pools.For(ctx, tc.TenantID)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	opts := pgx.TxOptions{AccessMode: pgx.ReadOnly, IsoLevel: pgx.RepeatableRead}
	if write {
		opts = pgx.TxOptions{}
	}
	tx, err := pool.BeginTx(ctx, opts)
	if err != nil {
		return problem.Wrap(problem.CodeDependencyUnavailable, err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }() // after Commit — a no-op
	r := &req{s: s, tc: tc, tx: tx, now: s.now(), me: tc.PersonID, granted: map[string]bool{}, kinds: map[Kind]Policy{}}
	if err := fn(r); err != nil {
		return dependency(err)
	}
	if err := tx.Commit(ctx); err != nil {
		return dependency(err)
	}
	for _, f := range r.after {
		f()
	}
	return nil
}

// dependency keeps a Problem error and reports anything else as dependency_unavailable (the cause stays in the log).
func dependency(err error) error {
	if _, ok := errors.AsType[*problem.Error](err); ok {
		return err
	}
	return problem.Wrap(problem.CodeDependencyUnavailable, err)
}

// can asks the evaluator whether the actor has action on chat; the answer is kept for the operation.
func (r *req) can(ctx context.Context, action string, c *chatRec) bool {
	key := action
	if c != nil {
		key += "@" + c.ID.String()
	}
	if v, ok := r.granted[key]; ok {
		return v
	}
	ok := false
	switch {
	case r.tc.Owner:
		ok = true
	case r.s.Perm != nil:
		res := authz.Resource{}
		if c != nil {
			res.Objects = map[string]uuid.UUID{authz.KindChat: c.ID}
			if c.Unit != nil {
				res.Unit = *c.Unit
			}
			if r.relatedTo[c.ID] {
				res.Persons, res.Related = []uuid.UUID{r.me}, []uuid.UUID{r.me}
			}
		}
		ok = r.s.Perm.Permit(ctx, r.tc, action, res) == nil
	}
	r.granted[key] = ok
	return ok
}

// canIn is can for an organization unit (a chat to be created, a person of the area).
func (r *req) canIn(ctx context.Context, action string, unit uuid.UUID) bool {
	key := action + "@unit:" + unit.String()
	if v, ok := r.granted[key]; ok {
		return v
	}
	ok := r.tc.Owner
	if !ok && r.s.Perm != nil {
		ok = r.s.Perm.Permit(ctx, r.tc, action, authz.Resource{Unit: unit}) == nil
	}
	r.granted[key] = ok
	return ok
}

// afterCommit queues f for after the commit of the operation.
func (r *req) afterCommit(f func()) { r.after = append(r.after, f) }
