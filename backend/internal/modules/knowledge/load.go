package knowledge

import (
	"context"
	"encoding/json"
	"fmt"
	"mime"
	"strconv"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// Membership is what the knowledge base needs of the membership of a person in the control DB.
type Membership struct {
	Status string // invited | active | suspended | ended
	Owner  bool   // an active owner binding
}

// Memberships reads the memberships of person profiles (people.person_profiles.membership_id) in the control DB.
type Memberships interface {
	Memberships(ctx context.Context, tenantID uuid.UUID, ids []uuid.UUID) (map[uuid.UUID]Membership, error)
}

// Relations gives the objects of repairs of an organization with their foremen: the relation «прораб объекта»
// (KB-01) and the sections of objects. The module «Ремонт и стройка» provides it from stage 6; until then there are
// none (Q-W4.04-1).
type Relations interface {
	Objects(ctx context.Context, tenantID uuid.UUID) ([]RepairObject, error)
}

// querier is what loading needs of a transaction.
type querier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// loader reads the world of one tenant in one transaction.
type loader struct {
	q      querier
	w      *world
	tenant uuid.UUID
	dir    Memberships
	rel    Relations
}

// load reads the snapshot of the knowledge base of the tenant at now through q.
func load(ctx context.Context, q querier, tenant uuid.UUID, now time.Time, dir Memberships, rel Relations) (*world, error) {
	l := &loader{q: q, w: newWorld(now), tenant: tenant, dir: dir, rel: rel}
	for _, step := range []func(context.Context) error{
		l.units, l.people, l.roles, l.groups, l.grants, l.spaces, l.nodes, l.versions, l.lists, l.acks, l.files,
		l.requests, l.rules, l.runs, l.tables, l.records, l.objects,
	} {
		if err := step(ctx); err != nil {
			return nil, err
		}
	}
	return l.w, nil
}

// each runs sql and scans every row with scan.
func (l *loader) each(ctx context.Context, what, sql string, scan func(pgx.Rows) error, args ...any) error {
	rows, err := l.q.Query(ctx, sql, args...)
	if err != nil {
		return fmt.Errorf("knowledge: %s: %w", what, err)
	}
	defer rows.Close()
	for rows.Next() {
		if err := scan(rows); err != nil {
			return fmt.Errorf("knowledge: %s: %w", what, err)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("knowledge: %s: %w", what, err)
	}
	return nil
}

func (l *loader) units(ctx context.Context) error {
	return l.each(ctx, "units", `select id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'), kind, name from org.units`,
		func(r pgx.Rows) error {
			var u unit
			if err := r.Scan(&u.id, &u.parent, &u.kind, &u.name); err != nil {
				return err
			}
			l.w.units[u.id] = &u
			return nil
		})
}

// statuses maps the status of a membership to the status of a member of the knowledge base.
var statuses = map[string]string{
	"active": memberActive, "invited": memberInvited, "suspended": memberBlocked, "ended": memberBlocked,
}

// people reads the person profiles (names of all, members — the live ones with a membership) and the drivers.
func (l *loader) people(ctx context.Context) error {
	type person struct {
		id, membership uuid.UUID
		name           string
	}
	var live []person
	err := l.each(ctx, "people", `select id, coalesce(membership_id, '00000000-0000-0000-0000-000000000000'), full_name,
		archived_at is null from people.person_profiles`, func(r pgx.Rows) error {
		var (
			p     person
			alive bool
		)
		if err := r.Scan(&p.id, &p.membership, &p.name, &alive); err != nil {
			return err
		}
		l.w.names[p.id] = p.name
		if alive && p.membership != uuid.Nil {
			live = append(live, p)
		}
		return nil
	})
	if err != nil {
		return err
	}
	ids := make([]uuid.UUID, 0, len(live))
	for _, p := range live {
		ids = append(ids, p.membership)
	}
	ms, err := l.memberships(ctx, ids)
	if err != nil {
		return err
	}
	drivers, err := l.drivers(ctx)
	if err != nil {
		return err
	}
	for _, p := range live {
		m, ok := ms[p.membership]
		if !ok {
			continue // no membership in this tenant: not a member
		}
		l.w.addMember(&member{id: p.id, name: p.name, status: statuses[m.Status], owner: m.Owner, driver: drivers[p.id]})
	}
	return nil
}

// memberships returns the memberships of ids: without a directory every one is an active membership.
func (l *loader) memberships(ctx context.Context, ids []uuid.UUID) (map[uuid.UUID]Membership, error) {
	if l.dir == nil {
		out := make(map[uuid.UUID]Membership, len(ids))
		for _, id := range ids {
			out[id] = Membership{Status: "active"}
		}
		return out, nil
	}
	out, err := l.dir.Memberships(ctx, l.tenant, ids)
	if err != nil {
		return nil, fmt.Errorf("knowledge: memberships: %w", err)
	}
	return out, nil
}

// drivers are the people with the work function driver active now.
func (l *loader) drivers(ctx context.Context) (map[uuid.UUID]bool, error) {
	out := map[uuid.UUID]bool{}
	err := l.each(ctx, "functions", `select person_id from people.work_profiles where function = 'driver' and valid @> $1::timestamptz`,
		func(r pgx.Rows) error {
			var id uuid.UUID
			if err := r.Scan(&id); err != nil {
				return err
			}
			out[id] = true
			return nil
		}, l.w.now)
	return out, err
}

func (l *loader) roles(ctx context.Context) error {
	return l.each(ctx, "roles", `select r.id, r.name, r.kind, coalesce(r.template_key, ''), coalesce(v.actions, '{}')
		  from access.roles r left join access.role_versions v on v.role_id = r.id and v.version = r.current_version
		 where r.archived_at is null`, func(r pgx.Rows) error {
		var x role
		if err := r.Scan(&x.id, &x.name, &x.kind, &x.template, &x.actions); err != nil {
			return err
		}
		x.verbs = verbsOf(x.actions)
		l.w.roles[x.id] = &x
		return nil
	})
}

func (l *loader) groups(ctx context.Context) error {
	err := l.each(ctx, "groups", `select id, name from access.groups where archived_at is null`, func(r pgx.Rows) error {
		var g group
		if err := r.Scan(&g.id, &g.name); err != nil {
			return err
		}
		l.w.groups[g.id] = &g
		return nil
	})
	if err != nil {
		return err
	}
	return l.each(ctx, "group members", `select group_id, person_id from access.group_members order by person_id`,
		func(r pgx.Rows) error {
			var gid, pid uuid.UUID
			if err := r.Scan(&gid, &pid); err != nil {
				return err
			}
			if g := l.w.groups[gid]; g != nil {
				g.members = append(g.members, pid)
			}
			return nil
		})
}

// grantsSQL reads the active assignments in force at $1 of live roles with the actions of their versions.
const grantsSQL = `
select a.id, a.principal_kind, a.principal_id, a.role_id, v.actions, a.scope_kind,
       coalesce(a.scope_ref, '00000000-0000-0000-0000-000000000000'), a.include_descendants, upper(a.valid)
  from access.role_assignments a
  join access.roles r on r.id = a.role_id and r.archived_at is null
  join access.role_versions v on v.role_id = a.role_id and v.version = a.role_version
 where a.state = 'active' and a.valid @> $1::timestamptz
 order by a.created_at, a.id`

// grants reads the grants of people, those of a group given to each of its members.
func (l *loader) grants(ctx context.Context) error {
	return l.each(ctx, "grants", grantsSQL, func(r pgx.Rows) error {
		var (
			g         grant
			principal string
			who, rid  uuid.UUID
			actions   []string
		)
		if err := r.Scan(&g.id, &principal, &who, &rid, &actions, &g.kind, &g.ref, &g.descendants, &g.until); err != nil {
			return err
		}
		if g.role = l.w.roles[rid]; g.role == nil {
			return nil
		}
		g.verbs = verbsOf(actions)
		people := []uuid.UUID{who}
		if principal == "group" {
			gr := l.w.groups[who]
			if gr == nil {
				return nil
			}
			g.group, people = who, gr.members
		}
		for _, p := range people {
			g.person = p
			l.w.grants[p] = append(l.w.grants[p], g)
		}
		return nil
	}, l.w.now)
}

func (l *loader) spaces(ctx context.Context) error {
	return l.each(ctx, "spaces", `select id, name, icon, color, coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'),
		access, coalesce(template_key, ''), revision, created_at from kb.spaces order by created_at, id`, func(r pgx.Rows) error {
		var sp space
		if err := r.Scan(&sp.id, &sp.name, &sp.icon, &sp.color, &sp.unit, &sp.access, &sp.template, &sp.revision, &sp.created); err != nil {
			return err
		}
		l.w.addSpace(&sp)
		return nil
	})
}

// dbModes maps the access mode of kb.nodes to the mode of the prototype.
var dbModes = map[string]string{"inherit": modeInherit, "edit_listed": modeEdit, "listed": modeListed}

// modeToDB is the access mode of kb.nodes of a mode of the prototype.
func modeToDB(m string) string {
	if m == modeEdit {
		return "edit_listed"
	}
	return m
}

const nodesSQL = `
select id, space_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'), position, depth, is_home, kind, title,
       status, access_mode, access_revision, sensitivity = 'finance',
       coalesce(owner_id, '00000000-0000-0000-0000-000000000000'), review_by, diagram, link,
       coalesce(file_id, '00000000-0000-0000-0000-000000000000'),
       coalesce(section_project, '00000000-0000-0000-0000-000000000000'), archived_at is not null, created_at
  from kb.nodes`

func (l *loader) nodes(ctx context.Context) error {
	return l.each(ctx, "nodes", nodesSQL, func(r pgx.Rows) error {
		var (
			n             node
			mode          string
			diagram, link []byte
			fileID        uuid.UUID
		)
		if err := r.Scan(&n.id, &n.space, &n.parent, &n.pos, &n.depth, &n.home, &n.kind, &n.title, &n.status, &mode,
			&n.accessRev, &n.finance, &n.owner, &n.reviewBy, &diagram, &link, &fileID, &n.obj, &n.archived, &n.created); err != nil {
			return err
		}
		n.mode = dbModes[mode]
		if err := decodeJSON(diagram, &n.diagram); err != nil {
			return err
		}
		if err := decodeJSON(link, &n.link); err != nil {
			return err
		}
		if fileID != uuid.Nil {
			n.file = &fileMeta{id: fileID}
		}
		l.w.nodes[n.id] = &n
		return nil
	})
}

// decodeJSON decodes a jsonb column into *dst; null leaves it nil.
func decodeJSON[T any](raw []byte, dst **T) error {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var v T
	if err := json.Unmarshal(raw, &v); err != nil {
		return err
	}
	*dst = &v
	return nil
}

// eachOfNode reads rows of nodes: scan fills the node id and the value, add attaches the value to its node.
func eachOfNode[T any](ctx context.Context, l *loader, what, sql string, scan func(pgx.Rows, *uuid.UUID, *T) error, add func(*node, T)) error {
	return l.each(ctx, what, sql, func(r pgx.Rows) error {
		var (
			id uuid.UUID
			v  T
		)
		if err := scan(r, &id, &v); err != nil {
			return err
		}
		if n := l.w.nodes[id]; n != nil {
			add(n, v)
		}
		return nil
	})
}

// versions reads the versions of the nodes: the text of the current one only (Service.Version reads an old one on
// demand) — a request does not carry the history of texts, kept without a term (KB-08).
func (l *loader) versions(ctx context.Context) error {
	return eachOfNode(ctx, l, "versions", `select node_id, version,
		case when version = max(version) over (partition by node_id) then body else '' end,
		coalesce(published_by, '00000000-0000-0000-0000-000000000000'), author_name, published_at
		  from kb.versions order by node_id, version`,
		func(r pgx.Rows, id *uuid.UUID, v *version) error {
			return r.Scan(id, &v.v, &v.body, &v.by, &v.author, &v.at)
		},
		func(n *node, v version) { n.versions = append(n.versions, v) })
}

func (l *loader) lists(ctx context.Context) error {
	return eachOfNode(ctx, l, "access lists", `select node_id, who, coalesce(ref_id, '00000000-0000-0000-0000-000000000000'),
		coalesce(object_id, '00000000-0000-0000-0000-000000000000'),
		coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'), can from kb.node_access order by node_id, position`,
		func(r pgx.Rows, id *uuid.UUID, e *entry) error {
			return r.Scan(id, &e.who, &e.ref, &e.obj, &e.unit, &e.can)
		},
		func(n *node, e entry) { n.list = append(n.list, e) })
}
func (l *loader) acks(ctx context.Context) error {
	err := l.each(ctx, "acks", `select node_id, version, audience_who, coalesce(audience_ref, '00000000-0000-0000-0000-000000000000'),
		coalesce(audience_unit, '00000000-0000-0000-0000-000000000000') from kb.acks`, func(r pgx.Rows) error {
		var (
			id uuid.UUID
			a  ack
		)
		if err := r.Scan(&id, &a.v, &a.audience.who, &a.audience.ref, &a.audience.unit); err != nil {
			return err
		}
		if n := l.w.nodes[id]; n != nil {
			n.ack = &a
		}
		return nil
	})
	if err != nil {
		return err
	}
	return l.each(ctx, "ack log", `select node_id, member_id, version, acked_at from kb.ack_log order by acked_at, id`,
		func(r pgx.Rows) error {
			var (
				id uuid.UUID
				x  ackLog
			)
			if err := r.Scan(&id, &x.member, &x.v, &x.at); err != nil {
				return err
			}
			if n := l.w.nodes[id]; n != nil && n.ack != nil {
				n.ack.log = append(n.ack.log, x)
			}
			return nil
		})
}

// files reads the size and the pages of the files of file nodes (files.objects: bytes, the parameter pages of the
// declared type «application/pdf; pages=4»).
func (l *loader) files(ctx context.Context) error {
	byFile := map[uuid.UUID]*node{}
	ids := make([]uuid.UUID, 0)
	for _, n := range l.w.nodes {
		if n.file != nil {
			byFile[n.file.id] = n
			ids = append(ids, n.file.id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	return l.each(ctx, "files", `select id, coalesce(bytes, 0), declared_mime from files.objects where id = any($1)`,
		func(r pgx.Rows) error {
			var (
				id    uuid.UUID
				bytes int64
				typ   string
			)
			if err := r.Scan(&id, &bytes, &typ); err != nil {
				return err
			}
			if n := byFile[id]; n != nil {
				n.file.bytes, n.file.pages = bytes, pagesOf(typ)
			}
			return nil
		}, ids)
}

// pagesOf is the parameter pages of a media type (0 when absent or broken).
func pagesOf(mediaType string) int {
	_, params, err := mime.ParseMediaType(mediaType)
	if err != nil {
		return 0
	}
	n, err := strconv.Atoi(params["pages"])
	if err != nil {
		return 0
	}
	return n
}

func (l *loader) requests(ctx context.Context) error {
	return l.each(ctx, "requests", `select id, node_id, space_id, member_id, can, status, requested_at, decided_at,
		coalesce(decided_by, '00000000-0000-0000-0000-000000000000'), until from kb.requests order by requested_at desc, id`,
		func(r pgx.Rows) error {
			var x request
			if err := r.Scan(&x.id, &x.node, &x.space, &x.member, &x.can, &x.status, &x.at, &x.decidedAt, &x.decidedBy, &x.until); err != nil {
				return err
			}
			l.w.requests = append(l.w.requests, &x)
			return nil
		})
}

func (l *loader) rules(ctx context.Context) error {
	return l.each(ctx, "rules", `select id, space_id, kind, name, trigger, enabled from kb.rules order by created_at, id`,
		func(r pgx.Rows) error {
			var x rule
			if err := r.Scan(&x.id, &x.space, &x.kind, &x.name, &x.trigger, &x.on); err != nil {
				return err
			}
			l.w.rules = append(l.w.rules, &x)
			return nil
		})
}

func (l *loader) runs(ctx context.Context) error {
	return l.each(ctx, "runs", `select id, space_id, rule_id, ran_at, result, text from kb.runs order by ran_at desc, id desc`,
		func(r pgx.Rows) error {
			var (
				x  run
				sp uuid.UUID
			)
			if err := r.Scan(&x.id, &sp, &x.rule, &x.at, &x.res, &x.text); err != nil {
				return err
			}
			if len(l.w.runs[sp]) < runsKept {
				l.w.runs[sp] = append(l.w.runs[sp], x)
			}
			return nil
		})
}

func (l *loader) tables(ctx context.Context) error {
	byID := map[uuid.UUID]*table{}
	err := l.each(ctx, "tables", `select id, node_id, title, columns from kb.tables order by created_at, id`, func(r pgx.Rows) error {
		var (
			t    table
			cols []byte
		)
		if err := r.Scan(&t.id, &t.node, &t.title, &cols); err != nil {
			return err
		}
		if err := json.Unmarshal(cols, &t.columns); err != nil {
			return err
		}
		l.w.tables = append(l.w.tables, &t)
		byID[t.id] = &t
		return nil
	})
	if err != nil {
		return err
	}
	return l.each(ctx, "table rows", `select id, table_id, added_at, cells, form_id, response_number, form_version
		  from kb.table_rows order by added_at desc, id`, func(r pgx.Rows) error {
		var (
			x       row
			tid     uuid.UUID
			cells   []byte
			form    *uuid.UUID
			resp    *string
			version *int
		)
		if err := r.Scan(&x.id, &tid, &x.at, &cells, &form, &resp, &version); err != nil {
			return err
		}
		if err := json.Unmarshal(cells, &x.cells); err != nil {
			return err
		}
		if form != nil && resp != nil && version != nil {
			x.src = &source{form: *form, resp: *resp, version: *version}
		}
		if t := byID[tid]; t != nil {
			t.rows = append(t.rows, x)
		}
		return nil
	})
}

func (l *loader) records(ctx context.Context) error {
	return l.each(ctx, "entries", `select id, node_id, added_at, head, lines, form_id, response_number, form_version
		  from kb.entries order by added_at desc, id`, func(r pgx.Rows) error {
		var (
			x     record
			lines []byte
		)
		if err := r.Scan(&x.id, &x.node, &x.at, &x.head, &lines, &x.src.form, &x.src.resp, &x.src.version); err != nil {
			return err
		}
		if err := json.Unmarshal(lines, &x.lines); err != nil {
			return err
		}
		l.w.records = append(l.w.records, &x)
		return nil
	})
}

// objects reads the objects of repairs of the relations (none until stage 6).
func (l *loader) objects(ctx context.Context) error {
	if l.rel == nil {
		return nil
	}
	objs, err := l.rel.Objects(ctx, l.tenant)
	if err != nil {
		return fmt.Errorf("knowledge: objects of repairs: %w", err)
	}
	for _, o := range objs {
		l.w.objects[o.ID] = o
	}
	return nil
}
