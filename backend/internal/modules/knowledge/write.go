package knowledge

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// Exec runs one statement in the transaction of a command (pgx) or of the seed (database/sql).
type Exec func(ctx context.Context, sql string, args ...any) error

// writer writes the rows of the knowledge base (schema kb, tenant 0024). A seed writer keeps the rows that are
// already there (a second run of the seed changes nothing); a command writer reports every conflict.
type writer struct {
	ex   Exec
	seed bool
}

// keep is the conflict clause of an insert of the seed.
func (wr writer) keep() string {
	if wr.seed {
		return " on conflict do nothing"
	}
	return ""
}

func (wr writer) exec(ctx context.Context, what, sql string, args ...any) error {
	if err := wr.ex(ctx, sql, args...); err != nil {
		return fmt.Errorf("knowledge: %s: %w", what, err)
	}
	return nil
}

// nullID is NULL for uuid.Nil (nullable references).
func nullID(id uuid.UUID) any {
	if id == uuid.Nil {
		return nil
	}
	return id
}

func nullText(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// jsonOf is the JSON text of v for a jsonb column (NULL for a nil pointer).
func jsonOf[T any](v *T) (any, error) {
	if v == nil {
		return nil, nil
	}
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	return string(b), nil
}

func (wr writer) space(ctx context.Context, sp *space, by uuid.UUID) error {
	return wr.exec(ctx, "space", `insert into kb.spaces (id, name, icon, color, org_unit_id, access, template_key, revision,
		created_by, created_at, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`+wr.keep(),
		sp.id, sp.name, sp.icon, sp.color, nullID(sp.unit), sp.access, nullText(sp.template), sp.revision, nullID(by), sp.created)
}

// node writes a node with its versions, access list and acknowledgement.
func (wr writer) node(ctx context.Context, n *node) error {
	diagram, err := jsonOf(n.diagram)
	if err != nil {
		return err
	}
	link, err := jsonOf(n.link)
	if err != nil {
		return err
	}
	sens := "normal"
	if n.finance {
		sens = "finance"
	}
	var fileID any
	if n.file != nil {
		fileID = n.file.id
	}
	if err := wr.exec(ctx, "node", `insert into kb.nodes (id, space_id, parent_id, position, depth, is_home, kind, title, status,
		access_mode, access_revision, sensitivity, owner_id, review_by, diagram, file_id, link, section_project, archived_at,
		created_at, updated_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16, $17::jsonb, $18, $19, $20, $20)`+wr.keep(),
		n.id, n.space, nullID(n.parent), n.pos, n.depth, n.home, n.kind, n.title, n.status, modeToDB(n.mode), n.accessRev, sens,
		nullID(n.owner), n.reviewBy, diagram, fileID, link, nullID(n.obj), archivedAt(n), n.created); err != nil {
		return err
	}
	for _, v := range n.versions {
		if err := wr.version(ctx, n, v); err != nil {
			return err
		}
	}
	if err := wr.list(ctx, n); err != nil {
		return err
	}
	return wr.ack(ctx, n)
}

func archivedAt(n *node) any {
	if n.archived {
		return n.created
	}
	return nil
}

// version writes a version of n with the current title and the steps of a diagram.
func (wr writer) version(ctx context.Context, n *node, v version) error {
	var steps any
	if n.diagram != nil {
		steps = n.diagram.Steps
	}
	return wr.exec(ctx, "version", `insert into kb.versions (node_id, version, title, body, steps, published_by, author_name,
		published_at) values ($1, $2, $3, $4, $5, $6, $7, $8)`+wr.keep(),
		n.id, v.v, n.title, v.body, steps, nullID(v.by), v.author, v.at)
}

// list writes the access list of n (the rows of the seed are kept; a command replaces the list).
func (wr writer) list(ctx context.Context, n *node) error {
	if !wr.seed {
		if err := wr.exec(ctx, "access list", `delete from kb.node_access where node_id = $1`, n.id); err != nil {
			return err
		}
	}
	for i, e := range n.list {
		var rel, module, typ any
		if e.who == whoRelation {
			rel, module, typ = foreman, "repairs", "project"
		}
		var unitID any
		if e.who == whoRole {
			unitID = nullID(e.unit)
		}
		ref := nullID(e.ref)
		if e.who == whoRelation {
			ref = nil
		}
		if err := wr.exec(ctx, "access entry", `insert into kb.node_access (node_id, position, who, ref_id, relation,
			object_module, object_type, object_id, org_unit_id, can)
			values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) on conflict do nothing`,
			n.id, i, e.who, ref, rel, module, typ, nullID(e.obj), unitID, e.can); err != nil {
			return err
		}
	}
	return nil
}

// ack writes the acknowledgement of n and its log.
func (wr writer) ack(ctx context.Context, n *node) error {
	if n.ack == nil {
		return nil
	}
	a := n.ack
	conflict := ` on conflict (node_id) do update set version = excluded.version, audience_who = excluded.audience_who,
		audience_ref = excluded.audience_ref, audience_unit = excluded.audience_unit`
	if wr.seed {
		conflict = wr.keep()
	}
	if err := wr.exec(ctx, "ack", `insert into kb.acks (node_id, version, audience_who, audience_ref, audience_unit)
		values ($1, $2, $3, $4, $5)`+conflict, n.id, a.v, a.audience.who, nullID(a.audience.ref), nullID(a.audience.unit)); err != nil {
		return err
	}
	for _, l := range a.log {
		if err := wr.ackLog(ctx, n.id, l); err != nil {
			return err
		}
	}
	return nil
}

func (wr writer) ackLog(ctx context.Context, nodeID uuid.UUID, l ackLog) error {
	return wr.exec(ctx, "ack log", `insert into kb.ack_log (node_id, member_id, version, acked_at) values ($1, $2, $3, $4)
		on conflict (node_id, member_id, version) do nothing`, nodeID, l.member, l.v, l.at)
}

// assignment writes a role assignment of a person (a role of a space, a page assignment of an approved request).
func (wr writer) assignment(ctx context.Context, a assignment) error {
	return wr.exec(ctx, "assignment", `insert into access.role_assignments (id, principal_kind, principal_id, role_id,
		role_version, scope_kind, scope_ref, include_descendants, valid, granted_by, reason)
		values ($1, 'person', $2, $3, (select current_version from access.roles where id = $3), $4, $5, false,
		        tstzrange($6::timestamptz, $7::timestamptz), $8, $9)`+wr.keep(),
		a.id, a.person, a.role, a.kind, a.ref, a.from, a.until, a.by, a.reason)
}

// assignment is a role assignment of a person the knowledge base writes.
type assignment struct {
	id, person, role uuid.UUID
	kind             string // space | page
	ref              uuid.UUID
	from             time.Time
	until            *time.Time
	by               uuid.UUID
	reason           string
}

func (wr writer) rule(ctx context.Context, sp uuid.UUID, r *rule, by uuid.UUID, at time.Time) error {
	return wr.exec(ctx, "rule", `insert into kb.rules (id, space_id, kind, name, trigger, enabled, enabled_by, created_at)
		values ($1, $2, $3, $4, $5, $6, $7, $8)`+wr.keep(), r.id, sp, r.kind, r.name, r.trigger, r.on, nullID(by), at)
}

func (wr writer) run(ctx context.Context, sp uuid.UUID, x run) error {
	return wr.exec(ctx, "run", `insert into kb.runs (id, space_id, rule_id, ran_at, result, text) values ($1, $2, $3, $4, $5, $6)`+
		wr.keep(), x.id, sp, x.rule, x.at, x.res, x.text)
}

// table writes a table of a page with its rows.
func (wr writer) table(ctx context.Context, t *table, at time.Time) error {
	cols, err := json.Marshal(t.columns)
	if err != nil {
		return err
	}
	if err := wr.exec(ctx, "table", `insert into kb.tables (id, node_id, title, columns, created_at) values ($1, $2, $3, $4::jsonb, $5)`+
		wr.keep(), t.id, t.node, t.title, string(cols), at); err != nil {
		return err
	}
	for _, x := range t.rows {
		cells, err := json.Marshal(x.cells)
		if err != nil {
			return err
		}
		var form, resp, version any
		if x.src != nil {
			form, resp, version = x.src.form, x.src.resp, x.src.version
		}
		if err := wr.exec(ctx, "table row", `insert into kb.table_rows (id, table_id, added_at, cells, form_id, response_number,
			form_version) values ($1, $2, $3, $4::jsonb, $5, $6, $7)`+wr.keep(), x.id, t.id, x.at, string(cells), form, resp, version); err != nil {
			return err
		}
	}
	return nil
}

// file writes the file of a file node of the seed (files.objects: purpose knowledge_attachment, a PDF with its
// pages in the declared type).
func (wr writer) file(ctx context.Context, n *node, key string, by uuid.UUID) error {
	f := n.file
	return wr.exec(ctx, "file", `insert into files.objects (id, object_key, state, purpose, owner_type, owner_id, declared_mime,
		detected_mime, bytes, uploaded_by, created_at, ready_at)
		values ($1, $2, 'ready', 'knowledge_attachment', 'knowledge.node', $3, $4, 'application/pdf', $5, $6, $7, $7)`+wr.keep(),
		f.id, key, n.id, fmt.Sprintf("application/pdf; pages=%d", f.pages), f.bytes, by, n.created)
}
