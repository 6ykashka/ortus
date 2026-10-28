package docs

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

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

// load reads the snapshot of the documents of the tenant at now through q.
func load(ctx context.Context, q querier, tenant uuid.UUID, now time.Time, dir Memberships, rel Relations) (*world, error) {
	l := &loader{q: q, w: newWorld(now), tenant: tenant, dir: dir, rel: rel}
	for _, step := range []func(context.Context) error{
		l.units, l.people, l.roles, l.groups, l.grants, l.folders, l.documents, l.shares, l.tempGrants, l.routes, l.waiting, l.objects,
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
		return fmt.Errorf("docs: %s: %w", what, err)
	}
	defer rows.Close()
	for rows.Next() {
		if err := scan(rows); err != nil {
			return fmt.Errorf("docs: %s: %w", what, err)
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("docs: %s: %w", what, err)
	}
	return nil
}

const nilUUID = "'00000000-0000-0000-0000-000000000000'"

func (l *loader) units(ctx context.Context) error {
	return l.each(ctx, "units", `select id, coalesce(parent_id, `+nilUUID+`), kind, name from org.units`, func(r pgx.Rows) error {
		var u unit
		if err := r.Scan(&u.id, &u.parent, &u.kind, &u.name); err != nil {
			return err
		}
		l.w.units[u.id] = &u
		return nil
	})
}

// statuses maps the status of a membership to the status of a member.
var statuses = map[string]string{"active": memberActive, "invited": memberInvited, "suspended": memberBlocked, "ended": memberBlocked}

// people reads the person profiles (names of all, members — the live ones with a membership) and the drivers.
func (l *loader) people(ctx context.Context) error {
	type person struct {
		id, membership uuid.UUID
		name           string
	}
	var live []person
	err := l.each(ctx, "people", `select id, coalesce(membership_id, `+nilUUID+`), full_name, archived_at is null
		from people.person_profiles`, func(r pgx.Rows) error {
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
		return nil, fmt.Errorf("docs: memberships: %w", err)
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
	return l.each(ctx, "roles", `select r.id, r.name, coalesce(r.template_key, ''), coalesce(v.actions, '{}')
		  from access.roles r left join access.role_versions v on v.role_id = r.id and v.version = r.current_version
		 where r.archived_at is null`, func(r pgx.Rows) error {
		var x role
		if err := r.Scan(&x.id, &x.name, &x.template, &x.actions); err != nil {
			return err
		}
		x.finish()
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
	return l.each(ctx, "group members", `select group_id, person_id from access.group_members order by person_id`, func(r pgx.Rows) error {
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
select a.principal_kind, a.principal_id, a.role_id, v.actions, a.scope_kind, coalesce(a.scope_ref, ` + nilUUID + `),
       a.include_descendants, upper(a.valid)
  from access.role_assignments a
  join access.roles r on r.id = a.role_id and r.archived_at is null
  join access.role_versions v on v.role_id = a.role_id and v.version = a.role_version
 where a.state = 'active' and a.valid @> $1::timestamptz
 order by a.created_at, a.id`

// grants reads the grants of people, those of a group given to each of its members. The actions of the version of an
// assignment replace the actions of the role (a role changed after the assignment does not change it).
func (l *loader) grants(ctx context.Context) error {
	return l.each(ctx, "grants", grantsSQL, func(r pgx.Rows) error {
		var (
			g         grant
			principal string
			who, rid  uuid.UUID
			actions   []string
		)
		if err := r.Scan(&principal, &who, &rid, &actions, &g.kind, &g.ref, &g.descendants, &g.until); err != nil {
			return err
		}
		base := l.w.roles[rid]
		if base == nil {
			return nil
		}
		versioned := *base
		versioned.actions = actions
		versioned.finish()
		g.role = &versioned
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

func (l *loader) folders(ctx context.Context) error {
	return l.each(ctx, "folders", `select id, name, coalesce(parent_id, `+nilUUID+`), coalesce(org_unit_id, `+nilUUID+`), mode, owner_id,
		icon, sensitivity, link_ref, revision, created_at, updated_at from docs.folders`, func(r pgx.Rows) error {
		var f folder
		if err := r.Scan(&f.id, &f.name, &f.parent, &f.unit, &f.mode, &f.owner, &f.icon, &f.sens, &f.linkRef, &f.revision,
			&f.created, &f.updated); err != nil {
			return err
		}
		l.w.addFolder(&f)
		return nil
	})
}

func (l *loader) documents(ctx context.Context) error {
	return l.each(ctx, "documents", `select id, kind, title, folder_id, owner_id, status, sensitivity, mode, current_version, revision,
		coalesce(template_id, `+nilUUID+`), links, fields, frozen, pdfa_copy, scan, protected_ranges, ocr, coalesce(lock_key, ''),
		created_at, updated_at, archived_at from docs.documents`, func(r pgx.Rows) error {
		var d document
		if err := r.Scan(&d.id, &d.kind, &d.title, &d.folder, &d.owner, &d.status, &d.sens, &d.mode, &d.version, &d.revision,
			&d.template, &d.links, &d.fields, &d.frozen, &d.pdfa, &d.scan, &d.protect, &d.ocr, &d.lockKey, &d.created, &d.updated,
			&d.archived); err != nil {
			return err
		}
		d.lock = d.status == statusInRoute
		l.w.addDoc(&d)
		return nil
	})
}

// lastDayOf is the date (midnight UTC) of the last day of a term stored as the exclusive upper bound in Moscow time.
func lastDayOf(until time.Time) time.Time { return dayOf(until.Add(-time.Nanosecond)) }

// dayEnd is the exclusive upper bound of a term whose last day is the date d: midnight of the next day in Moscow.
func dayEnd(d time.Time) time.Time {
	return time.Date(d.Year(), d.Month(), d.Day()+1, 0, 0, 0, 0, moscow)
}

func (l *loader) shares(ctx context.Context) error {
	return l.each(ctx, "shares", `select id, coalesce(folder_id, document_id), who, coalesce(ref_id, `+nilUUID+`),
		coalesce(org_unit_id, `+nilUUID+`), coalesce((object_ref->>'entityId')::uuid, `+nilUUID+`), level, until,
		coalesce(by_id, `+nilUUID+`), at from docs.shares order by at, id`, func(r pgx.Rows) error {
		var (
			e      entry
			target uuid.UUID
			lv     string
			until  *time.Time
		)
		if err := r.Scan(&e.id, &target, &e.who, &e.ref, &e.unit, &e.obj, &lv, &until, &e.by, &e.at); err != nil {
			return err
		}
		e.level, _ = parseLevel(lv)
		if until != nil {
			day := lastDayOf(*until)
			e.until = &day
		}
		l.w.shares[target] = append(l.w.shares[target], e)
		return nil
	})
}

func (l *loader) tempGrants(ctx context.Context) error {
	return l.each(ctx, "temporary accesses", `select document_id, member_id, level, why, coalesce(only_version, 0), keep
		from docs.temp_grants where revoked_at is null order by granted_at`, func(r pgx.Rows) error {
		var (
			id uuid.UUID
			t  tempGrant
			lv string
		)
		if err := r.Scan(&id, &t.member, &lv, &t.why, &t.onlyVersion, &t.keep); err != nil {
			return err
		}
		t.level, _ = parseLevel(lv)
		if d := l.w.docs[id]; d != nil {
			d.tmp = append(d.tmp, t)
		}
		return nil
	})
}

// routes reads the last route of every document that has one (any status: the card shows a finished route) and, for an
// active one, who waits at its step; an active route closes the document for editing.
func (l *loader) routes(ctx context.Context) error {
	err := l.each(ctx, "routes", `select distinct on (r.document_id) r.document_id, r.id, r.status, r.current_step, r.version,
		r.started_by, coalesce(s.name, ''), s.due_at, coalesce(r.back->>'name', '') from docs.routes r
		left join docs.route_steps s on s.route_id = r.id and s.position = r.current_step
		order by r.document_id, (r.status in ('active', 'returned')) desc, r.started_at desc, r.id`,
		func(r pgx.Rows) error {
			var (
				id  uuid.UUID
				b   routeBrief
				due *time.Time
			)
			if err := r.Scan(&id, &b.id, &b.status, &b.current, &b.version, &b.started, &b.stepName, &due, &b.backBy); err != nil {
				return err
			}
			if due != nil {
				day := dayOf(*due)
				b.due = &day
			}
			if d := l.w.docs[id]; d != nil {
				d.route = &b
				d.lock = d.lock || b.status == routeActive
			}
			return nil
		})
	if err != nil {
		return err
	}
	if err := l.waitingAtSteps(ctx); err != nil {
		return err
	}
	return l.each(ctx, "route templates", `select folder_id from docs.route_templates`, func(r pgx.Rows) error {
		var id uuid.UUID
		if err := r.Scan(&id); err != nil {
			return err
		}
		l.w.routeTpl[id] = true
		return nil
	})
}

// waiting reads what waits for members in the comments and in the text layers: the mentions the mentioned member has
// not answered, the doubtful words of scans.
func (l *loader) waiting(ctx context.Context) error {
	err := l.each(ctx, "mentions", `select c.id, c.document_id, c.author_id, c.text, m from docs.comments c, unnest(c.mention) m
		where not c.resolved and not exists (select 1 from docs.replies p where p.comment_id = c.id and p.author_id = m)
		order by c.created_at`, func(r pgx.Rows) error {
		var (
			doc uuid.UUID
			x   mention
		)
		if err := r.Scan(&x.comment, &doc, &x.by, &x.text, &x.member); err != nil {
			return err
		}
		l.w.mentions[doc] = append(l.w.mentions[doc], x)
		return nil
	})
	if err != nil {
		return err
	}
	return l.each(ctx, "doubtful words", `select document_id, count(*) from docs.ocr_words where state = 'doubtful' group by document_id`,
		func(r pgx.Rows) error {
			var (
				id uuid.UUID
				n  int
			)
			if err := r.Scan(&id, &n); err != nil {
				return err
			}
			l.w.ocrOpen[id] = n
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
		return fmt.Errorf("docs: objects of repairs: %w", err)
	}
	for _, o := range objs {
		l.w.objects[o.ID] = o
	}
	return nil
}

// waitingAtSteps computes who waits at the current step of every active route (stepWaiting): the approvers who have not
// agreed, the signer, the addressees who have not acknowledged.
func (l *loader) waitingAtSteps(ctx context.Context) error {
	return l.each(ctx, "route waits", `select r.document_id, s.kind, s.mode, s.who,
		coalesce((select array_agg(d.member_id) from docs.route_decisions d
			where d.route_id = s.route_id and d.position = s.position and d.decision = 'ok'), '{}'),
		coalesce((select array_agg(a.member_id) from docs.acks a where a.document_id = r.document_id and a.version = r.version), '{}')
		from docs.routes r join docs.route_steps s on s.route_id = r.id and s.position = r.current_step
		where r.status = 'active'`, func(r pgx.Rows) error {
		var (
			doc    uuid.UUID
			agreed []uuid.UUID
			st     = routeStep{status: stepStatusActive}
		)
		if err := r.Scan(&doc, &st.kind, &st.mode, &st.who, &agreed, &st.acked); err != nil {
			return err
		}
		for _, m := range agreed {
			st.decisions = append(st.decisions, decision{member: m, kind: decisionOK})
		}
		if d := l.w.docs[doc]; d != nil && d.route != nil {
			d.route.waiting, d.route.kind = st.waiting(), st.kind
		}
		return nil
	})
}
