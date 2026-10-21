package knowledge

import (
	"context"
	"errors"
	"fmt"
	"slices"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/audit"
	"github.com/ortus/ortus-crm/backend/internal/platform/events"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/inbox"
	"github.com/ortus/ortus-crm/backend/internal/platform/notify/realtime"
)

// Aggregates of the events of the knowledge base.
const (
	aggSpace   = "kb.space"
	aggNode    = "kb.node"
	aggRequest = "kb.request"
)

// publish writes an event of the knowledge base (outbox, in the transaction of the command) and returns its id.
func (r *req) publish(ctx context.Context, typ, aggregate string, id uuid.UUID, payload map[string]any) (uuid.UUID, error) {
	if payload == nil {
		payload = map[string]any{}
	}
	payload["actorId"] = r.me.id
	return events.Publish(ctx, r.tx, events.Event{Type: typ + ".v1", Aggregate: aggregate, AggregateID: id, Payload: payload})
}

// notify enqueues a notification for each of people about node (the texts of the domain ctx.emit): a person without
// an active membership is skipped; without recipients and an audience the service sends none.
func (r *req) notify(ctx context.Context, kind, title string, nodeID, event uuid.UUID, people []uuid.UUID) error {
	if r.s.Recipients == nil || r.s.Audience == nil {
		return nil
	}
	n := inbox.Notice{Kind: kind, Severity: inbox.SeverityInfo, Title: clip(title, 300), SourceEvent: event}
	if nodeID != uuid.Nil {
		n.Object = &inbox.Object{ModuleKey: "knowledge", EntityType: "node", EntityID: nodeID}
	}
	seen := map[uuid.UUID]bool{}
	for _, p := range people {
		if seen[p] || p == uuid.Nil {
			continue
		}
		seen[p] = true
		to, err := r.s.Recipients.Recipient(ctx, r.tc.TenantID, p)
		if errors.Is(err, inbox.ErrNoRecipient) {
			continue
		}
		if err != nil {
			return fmt.Errorf("knowledge: recipient: %w", err)
		}
		if _, _, err := inbox.Enqueue(ctx, r.tx, r.s.Audience, to, n); err != nil {
			return fmt.Errorf("knowledge: notify: %w", err)
		}
	}
	return nil
}

// clip is s cut to n characters.
func clip(s string, n int) string {
	rs := []rune(s)
	if len(rs) <= n {
		return s
	}
	return string(rs[:n-1]) + "…"
}

// owners are the owners of the business of the organization.
func (w *world) owners() []uuid.UUID {
	var out []uuid.UUID
	for _, m := range w.members {
		if m.owner {
			out = append(out, m.id)
		}
	}
	return out
}

// record writes the audit of a change of access (sensitive: knowledge.access.manage, members.manage).
func (r *req) record(ctx context.Context, action, target string, id uuid.UUID, diff map[string]any) error {
	e := audit.ForRequest(ctx)
	e.ActorKind, e.ActorID = audit.ActorPerson, r.me.id
	if e.RequestID == "" {
		e.RequestID = "kb-" + uuid.NewString()
	}
	e.Action, e.TargetType, e.TargetID, e.Sensitivity, e.Diff = action, target, id, audit.Sensitive, diff
	return audit.Record(ctx, r.tx, e)
}

// bump increments the policy version (roles of spaces and page assignments changed): the next permission check of
// the gateway sees them, and the people get context.changed.
func (r *req) bump(ctx context.Context, persons []uuid.UUID) error {
	_, err := realtime.BumpPolicy(ctx, r.tx, r.tc.TenantID, persons, "knowledge.member.changed")
	return err
}

// spaceRole returns the role of the organization with a template of a space, creating it (with the actions of the
// template of the catalog) when the organization has none yet. The creation is serialized by an advisory lock of the
// template: a role another transaction made after the snapshot was read is found by its template, not made twice.
func (r *req) spaceRole(ctx context.Context, template string) (*role, error) {
	if x := r.w.spaceRoleOf(template); x != nil {
		return x, nil
	}
	if _, err := r.tx.Exec(ctx, `select pg_advisory_xact_lock(hashtextextended('kb.space_role:' || $1, 0))`, template); err != nil {
		return nil, fmt.Errorf("knowledge: role %s: %w", template, err)
	}
	x := &role{template: template}
	err := r.tx.QueryRow(ctx, `select r.id, r.name, r.kind, coalesce(v.actions, '{}') from access.roles r
		left join access.role_versions v on v.role_id = r.id and v.version = r.current_version
		where r.template_key = $1 and r.archived_at is null order by r.name limit 1`, template).Scan(&x.id, &x.name, &x.kind, &x.actions)
	switch {
	case err == nil:
		x.verbs = verbsOf(x.actions)
		r.w.roles[x.id] = x
		return x, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return nil, fmt.Errorf("knowledge: role %s: %w", template, err)
	}
	return r.createSpaceRole(ctx, template)
}

// createSpaceRole writes the role of a space with the name and the actions of the template of the catalog (with the
// suffix «· база знаний» when the name is taken by another role of the organization).
func (r *req) createSpaceRole(ctx context.Context, template string) (*role, error) {
	def := spaceRoleDefs[template]
	x := &role{id: uuid.New(), name: def.name, kind: kindSystem, template: template, actions: slices.Clone(def.actions),
		verbs: verbsOf(def.actions)}
	for _, name := range []string{def.name, def.name + " · база знаний"} {
		var id uuid.UUID
		err := r.tx.QueryRow(ctx, `insert into access.roles (id, name, kind, template_key) values ($1, $2, 'system', $3)
			on conflict ((lower(name))) where archived_at is null do nothing returning id`, x.id, name, template).Scan(&id)
		if errors.Is(err, pgx.ErrNoRows) {
			continue // the name is taken by another role of the organization
		}
		if err != nil {
			return nil, fmt.Errorf("knowledge: role %s: %w", template, err)
		}
		x.name = name
		if err := r.wr.exec(ctx, "role version", `insert into access.role_versions (role_id, version, actions, created_by)
			values ($1, 1, $2, $3)`, x.id, x.actions, r.me.id); err != nil {
			return nil, err
		}
		r.w.roles[x.id] = x
		return x, nil
	}
	return nil, fmt.Errorf("knowledge: role %s: both names are taken", template)
}

// grantRole writes an assignment of x to person in scope kind/ref and adds it to the world.
func (r *req) grantRole(ctx context.Context, person uuid.UUID, x *role, kind string, ref uuid.UUID, a assignment) error {
	a.id, a.person, a.role, a.kind, a.ref, a.from, a.by = uuid.New(), person, x.id, kind, ref, r.now, r.me.id
	if err := r.wr.assignment(ctx, a); err != nil {
		return err
	}
	r.w.grants[person] = append(r.w.grants[person], grant{id: a.id, person: person, role: x, verbs: x.verbs, kind: kind, ref: ref,
		until: a.until})
	return nil
}
