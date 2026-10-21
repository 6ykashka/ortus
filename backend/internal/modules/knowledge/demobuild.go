package knowledge

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// demoBase is the moment the demo spaces and nodes are created (the migration v2 of the prototype runs before the
// «today» of 01.10.2026): spaces a minute apart in the order of the demo, so «as created» is the order of the
// prototype.
var demoBase = time.Date(2026, 9, 20, 9, 0, 0, 0, moscow)

// demoGrantsSince is the start of the roles of spaces of the seed, as the other assignments of the seed.
var demoGrantsSince = time.Date(2026, 9, 1, 0, 0, 0, 0, moscow)

// demoParts is a demo with the ids of a tenant: what the seed writes and what the tests read.
type demoParts struct {
	roles       []*role
	spaces      []*space
	nodes       []*node // in the order of the demo
	assignments []assignment
	rules       []*rule
	runs        map[uuid.UUID][]run
	tables      []*table
}

// demoDay is the moment of the day «ДД.ММ.ГГГГ» (midnight in Moscow).
func demoDay(s string) time.Time {
	t, err := time.ParseInLocation("02.01.2006", s, moscow)
	if err != nil {
		panic("knowledge: demo day " + s) // the days are constants of demo.go
	}
	return t
}

// demoClock is the moment of «ДД.ММ ЧЧ:ММ» of 2026 in Moscow.
func demoClock(s string) time.Time {
	t, err := time.ParseInLocation("02.01 15:04", s, moscow)
	if err != nil {
		panic("knowledge: demo time " + s) // the times are constants of demo.go
	}
	return t.AddDate(2026-t.Year(), 0, 0)
}

// build makes the rows of d: id is the UUID of a prototype id of the tenant, name — the name of a member.
func (d Demo) build(id func(string) uuid.UUID, name func(string) string) demoParts {
	p := demoParts{runs: map[uuid.UUID][]run{}}
	for _, r := range DemoRoles() {
		p.roles = append(p.roles, &role{id: id(r.ID), name: r.Name, kind: kindSystem, template: r.Template, actions: r.Actions,
			verbs: verbsOf(r.Actions)})
	}
	for i, s := range d.Spaces {
		p.spaces = append(p.spaces, &space{id: id(s.ID), name: s.Name, icon: s.Icon, color: s.Color, unit: optID(id, s.Unit),
			access: s.Access, revision: 1, created: demoBase.Add(time.Duration(i) * time.Minute)})
	}
	parents := map[string]string{}
	for _, x := range d.Nodes {
		parents[x.ID] = x.Parent
	}
	for i, x := range d.Nodes {
		p.nodes = append(p.nodes, x.build(id, name, depthOf(parents, x.ID), demoBase.Add(time.Duration(i)*time.Second)))
	}
	for _, a := range d.Assignments {
		p.assignments = append(p.assignments, assignment{id: id(a.ID), person: id(a.Member), role: id(a.Role), kind: scopeSpace,
			ref: id(a.Space), from: demoGrantsSince, by: id(demoOwner), reason: "seed 14.10"})
	}
	for _, r := range d.Rules {
		p.rules = append(p.rules, &rule{id: id(r.ID), space: id(r.Space), kind: r.Kind, name: r.Name, trigger: r.Trigger, on: r.On})
	}
	for _, r := range d.Runs {
		sp := id(r.Space)
		p.runs[sp] = append(p.runs[sp], run{id: id(r.ID), rule: id(r.Rule), at: demoClock(r.At), res: r.Res, text: r.Text})
	}
	for _, t := range d.Tables {
		p.tables = append(p.tables, t.build(id))
	}
	return p
}

// optID is the id of a prototype id, uuid.Nil for "".
func optID(id func(string) uuid.UUID, proto string) uuid.UUID {
	if proto == "" {
		return uuid.Nil
	}
	return id(proto)
}

// depthOf is the level of node proto in the tree of parents: a top node is 1.
func depthOf(parents map[string]string, proto string) int {
	d := 0
	for x, g := proto, 0; x != "" && g < pathGuard; x, g = parents[x], g+1 {
		d++
	}
	return d
}

func (x DemoNode) build(id func(string) uuid.UUID, name func(string) string, depth int, created time.Time) *node {
	n := &node{
		id: id(x.ID), space: id(x.Space), parent: optID(id, x.Parent), pos: x.Pos, depth: depth, kind: x.Kind, title: x.Title,
		status: x.Status, mode: x.Mode, accessRev: 1, finance: x.Finance, owner: id(demoOwner), obj: optID(id, x.Obj),
		created: created,
	}
	n.home = x.Parent == "" && x.Kind == kindPage && x.Title == homeTitle
	if n.status == "" {
		n.status = statusActive
	}
	if n.mode == "" {
		n.mode = modeInherit
	}
	if x.Owner != "" {
		n.owner = id(x.Owner)
	}
	if x.ReviewBy != "" {
		r := dateOf(x.ReviewBy)
		n.reviewBy = &r
	}
	for _, e := range x.List {
		n.list = append(n.list, e.build(id))
	}
	for i, v := range x.Versions {
		n.versions = append(n.versions, version{v: i + 1, at: demoDay(v.At), by: id(v.By), author: name(v.By), body: v.Body})
	}
	x.extras(n, id)
	return n
}

// extras sets the diagram, the file, the link and the acknowledgement of a node of the demo.
func (x DemoNode) extras(n *node, id func(string) uuid.UUID) {
	if len(x.Steps) > 0 {
		n.diagram = &diagram{Steps: x.Steps, Outcomes: []outcome{}}
		for _, o := range x.Outcomes {
			n.diagram.Outcomes = append(n.diagram.Outcomes, outcome{Text: o[0], Tone: o[1]})
		}
	}
	if x.FileBytes > 0 {
		n.file = &fileMeta{id: id("file:" + x.ID), bytes: x.FileBytes, pages: x.FilePages}
	}
	if x.Link != nil {
		n.link = &linkMeta{Label: x.Link[0], ModuleKey: x.Link[1], Icon: x.Link[2]}
	}
	if x.Ack != nil {
		a := &ack{v: x.Ack.V, audience: x.Ack.Audience.build(id)}
		at := n.versions[min(x.Ack.V, len(n.versions))-1].at
		for _, m := range x.Ack.Done {
			a.log = append(a.log, ackLog{member: id(m), v: x.Ack.V, at: at})
		}
		n.ack = a
	}
}

func (e DemoEntry) build(id func(string) uuid.UUID) entry {
	out := entry{who: e.Who, ref: optID(id, e.Ref), unit: optID(id, e.Unit), obj: optID(id, e.Obj), can: e.Can}
	if out.who == "" {
		out.who = whoAll
	}
	return out
}

// dateOf parses «ДД.ММ.ГГГГ» as a date (midnight UTC, the form of a date column).
func dateOf(s string) time.Time {
	t, err := time.Parse("02.01.2006", s)
	if err != nil {
		panic("knowledge: demo date " + s) // the dates are constants of demo.go
	}
	return t
}

func (t DemoTable) build(id func(string) uuid.UUID) *table {
	out := &table{id: id(t.ID), node: id(t.Node), title: t.Title}
	for _, c := range t.Columns {
		out.columns = append(out.columns, column{ID: id(c[0]), Name: c[1], Type: c[2]})
	}
	for _, r := range t.Rows {
		cells := map[string]string{}
		for k, v := range r.Cells {
			cells[id(k).String()] = v
		}
		out.rows = append(out.rows, row{id: id(r.ID), at: demoClock(r.At), cells: cells,
			src: &source{form: id(r.Form), resp: r.Resp, version: r.FormVersion}})
	}
	return out
}

// WriteDemo writes the knowledge base of the prototype tenant into its tenant DB through ex: the roles of spaces,
// the spaces with their nodes, versions, lists and acknowledgements, the file of the file node, the roles of the
// spaces of the members, the rules, the runs and the tables. id is the UUID of a prototype id of the tenant, name —
// the name of a member. Rows already there are kept: a second run changes nothing. A tenant without a demo — nothing.
func WriteDemo(ctx context.Context, ex Exec, tenant string, id func(string) uuid.UUID, name func(string) string, opts ...DemoOption) error {
	d, ok := DemoOf(tenant)
	if !ok {
		return nil
	}
	p := d.build(id, name)
	var o demoOptions
	for _, opt := range opts {
		opt(&o)
	}
	if o.noMembers {
		p.assignments = nil
	}
	wr := writer{ex: ex, seed: true}
	owner := id(demoOwner)
	for _, r := range p.roles {
		if err := wr.role(ctx, r, owner); err != nil {
			return err
		}
	}
	for _, sp := range p.spaces {
		if err := wr.space(ctx, sp, owner); err != nil {
			return err
		}
	}
	for _, n := range p.nodes {
		if n.file != nil {
			if err := wr.file(ctx, n, "seed/"+tenant+"/"+n.id.String()+".pdf", owner); err != nil {
				return err
			}
		}
		if err := wr.node(ctx, n); err != nil {
			return err
		}
	}
	return p.writeRest(ctx, wr, owner)
}

// DemoOption changes what WriteDemo writes.
type DemoOption func(*demoOptions)

type demoOptions struct{ noMembers bool }

// WithoutSpaceMembers writes the roles of spaces without the members of the demo (their assignments): the stand keeps
// /me/context equal to the examples of getMyContext (П-14) until they carry the roles of spaces.
func WithoutSpaceMembers() DemoOption { return func(o *demoOptions) { o.noMembers = true } }

// writeRest writes the assignments, rules, runs and tables of the demo.
func (p demoParts) writeRest(ctx context.Context, wr writer, owner uuid.UUID) error {
	for _, a := range p.assignments {
		if err := wr.assignment(ctx, a); err != nil {
			return err
		}
	}
	for i, r := range p.rules {
		if err := wr.rule(ctx, r.space, r, owner, demoBase.Add(time.Duration(i)*time.Second)); err != nil {
			return err
		}
	}
	for sp, runs := range p.runs {
		for _, x := range runs {
			if err := wr.run(ctx, sp, x); err != nil {
				return err
			}
		}
	}
	for i, t := range p.tables {
		if err := wr.table(ctx, t, demoBase.Add(time.Duration(i)*time.Second)); err != nil {
			return err
		}
	}
	return nil
}

// role writes a role of a space with its first version.
func (wr writer) role(ctx context.Context, r *role, by uuid.UUID) error {
	if err := wr.exec(ctx, "role", `insert into access.roles (id, name, kind, template_key) values ($1, $2, $3, $4)`+wr.keep(),
		r.id, r.name, r.kind, r.template); err != nil {
		return err
	}
	return wr.exec(ctx, "role version", `insert into access.role_versions (role_id, version, actions, created_by)
		values ($1, 1, $2, $3)`+wr.keep(), r.id, r.actions, by)
}
