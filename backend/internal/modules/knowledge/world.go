package knowledge

import (
	"cmp"
	"maps"
	"slices"
	"time"

	"github.com/google/uuid"
)

// world is the snapshot of the knowledge base of an organization the access chain is computed on: the people with
// their grants, groups, functions and memberships, the roles, the org units, the spaces and nodes with their
// lists, the requests, rules, runs, tables and entries. It is read in the transaction of one request (load.go).
type world struct {
	now      time.Time
	today    time.Time // the day of now in Moscow, as a date (midnight UTC)
	units    map[uuid.UUID]*unit
	members  []*member // ordered by name
	member   map[uuid.UUID]*member
	names    map[uuid.UUID]string // every person profile, archived included (owners and authors)
	roles    map[uuid.UUID]*role
	groups   map[uuid.UUID]*group
	grants   map[uuid.UUID][]grant // person → active grants (direct and through groups), in the order of assignments
	spaces   []*space              // in the order of creation
	space    map[uuid.UUID]*space
	nodes    map[uuid.UUID]*node
	requests []*request // newest first
	rules    []*rule
	runs     map[uuid.UUID][]run // space → runs, newest first
	tables   []*table
	records  []*record
	objects  map[uuid.UUID]RepairObject // objects of repairs (Relations)
}

// newWorld returns an empty world at now.
func newWorld(now time.Time) *world {
	return &world{
		now: now, today: dayOf(now),
		units: map[uuid.UUID]*unit{}, member: map[uuid.UUID]*member{}, names: map[uuid.UUID]string{},
		roles: map[uuid.UUID]*role{}, groups: map[uuid.UUID]*group{}, grants: map[uuid.UUID][]grant{},
		space: map[uuid.UUID]*space{}, nodes: map[uuid.UUID]*node{}, runs: map[uuid.UUID][]run{},
		objects: map[uuid.UUID]RepairObject{},
	}
}

// moscow is the zone of the dates of the knowledge base (review dates, terms of page assignments): the pilot is in
// Moscow (UTC+3 without DST).
var moscow = time.FixedZone("MSK", 3*60*60)

// dayOf is the date of t in Moscow as midnight UTC (the form of a date column).
func dayOf(t time.Time) time.Time {
	y, m, d := t.In(moscow).Date()
	return time.Date(y, m, d, 0, 0, 0, 0, time.UTC)
}

// addMember adds m keeping the members ordered by name, then id.
func (w *world) addMember(m *member) {
	w.member[m.id] = m
	w.names[m.id] = m.name
	i, _ := slices.BinarySearchFunc(w.members, m, compareMembers)
	w.members = slices.Insert(w.members, i, m)
}

func compareMembers(a, b *member) int {
	if c := cmp.Compare(a.name, b.name); c != 0 {
		return c
	}
	return slices.Compare(a.id[:], b.id[:])
}

// addSpace adds a space after the others.
func (w *world) addSpace(sp *space) {
	w.spaces = append(w.spaces, sp)
	w.space[sp.id] = sp
}

// nodeOf returns the node id, nil if none.
func (w *world) nodeOf(id uuid.UUID) *node {
	if id == uuid.Nil {
		return nil
	}
	return w.nodes[id]
}

// pathGuard bounds a path against a cycle (as the prototype: 40 nodes).
const pathGuard = 40

// path is the branch from the top node of the space down to n included.
func (w *world) path(n *node) []*node {
	var out []*node
	for x, g := n, 0; x != nil && g < pathGuard; x, g = w.nodeOf(x.parent), g+1 {
		out = append(out, x)
	}
	slices.Reverse(out)
	return out
}

// depth is the level of n: a top node is 1.
func (w *world) depth(n *node) int { return len(w.path(n)) }

// kids returns the children of parent in space (the top nodes for uuid.Nil) by position; archived ones with all.
func (w *world) kids(spaceID, parent uuid.UUID, all bool) []*node {
	var out []*node
	for _, n := range w.nodes {
		if n.space == spaceID && n.parent == parent && (all || !n.archived) {
			out = append(out, n)
		}
	}
	slices.SortFunc(out, compareNodes)
	return out
}

// compareNodes orders siblings by position, then by creation and id (stable for equal positions).
func compareNodes(a, b *node) int {
	if c := cmp.Compare(a.pos, b.pos); c != 0 {
		return c
	}
	if c := a.created.Compare(b.created); c != 0 {
		return c
	}
	return slices.Compare(a.id[:], b.id[:])
}

// subtree returns n and its descendants depth-first by position; archived ones with all.
func (w *world) subtree(n *node, all bool) []*node {
	out := []*node{n}
	for _, c := range w.kids(n.space, n.id, all) {
		if c.id != n.id {
			out = append(out, w.subtree(c, all)...)
		}
	}
	return out
}

// height is the height of the branch of n with the archive: a leaf is 1.
func (w *world) height(n *node) int {
	h := 0
	for _, c := range w.kids(n.space, n.id, true) {
		h = max(h, w.height(c))
	}
	return 1 + h
}

// order returns the nodes of space depth-first by position (the whole tree when all, without the archive
// otherwise).
func (w *world) order(spaceID uuid.UUID, all bool) []*node {
	var out []*node
	var walk func(parent uuid.UUID)
	walk = func(parent uuid.UUID) {
		for _, n := range w.kids(spaceID, parent, all) {
			out = append(out, n)
			walk(n.id)
		}
	}
	walk(uuid.Nil)
	return out
}

// with returns a copy of w whose nodes and spaces are replaced by those given (the impact of a change before it is
// saved); w itself is not changed.
func (w *world) with(nodes []*node, spaces []*space) *world {
	c := *w
	c.nodes = maps.Clone(w.nodes)
	for _, n := range nodes {
		c.nodes[n.id] = n
	}
	if len(spaces) > 0 {
		c.space = maps.Clone(w.space)
		for _, sp := range spaces {
			c.space[sp.id] = sp
		}
	}
	return &c
}

// spaceOf returns the space of n.
func (w *world) spaceOf(n *node) *space {
	if n == nil {
		return nil
	}
	return w.space[n.space]
}

// ancestorsOf returns u and its ancestors.
func (w *world) ancestorsOf(id uuid.UUID) []uuid.UUID {
	var out []uuid.UUID
	for u, g := w.units[id], 0; u != nil && g < pathGuard; u, g = w.units[u.parent], g+1 {
		out = append(out, u.id)
	}
	return out
}

// covers reports whether a territorial grant covers the unit (scopeCovers of the domain core): the organization
// covers everything, a unit — itself and, with descendants, its subtree; other kinds cover no unit.
func (w *world) covers(g grant, unitID uuid.UUID) bool {
	switch g.kind {
	case scopeTenant:
		return true
	case scopeUnit:
		if g.ref == unitID {
			return true
		}
		return g.descendants && slices.Contains(w.ancestorsOf(unitID), g.ref)
	}
	return false
}

// unitName is the name of a unit, «вся организация» for none.
func (w *world) unitName(id uuid.UUID) string {
	if u := w.units[id]; u != nil {
		return u.name
	}
	return areaAll
}

// nameOf is the name of a person profile, "" if unknown.
func (w *world) nameOf(id uuid.UUID) string { return w.names[id] }

// sortRoles orders roles by name, then id.
func sortRoles(rs []*role) {
	slices.SortFunc(rs, func(a, b *role) int {
		if c := cmp.Compare(a.name, b.name); c != 0 {
			return c
		}
		return slices.Compare(a.id[:], b.id[:])
	})
}

// sortedGroups are the live groups by name.
func (w *world) sortedGroups() []*group {
	out := make([]*group, 0, len(w.groups))
	for _, g := range w.groups {
		out = append(out, g)
	}
	slices.SortFunc(out, func(a, b *group) int {
		if c := cmp.Compare(a.name, b.name); c != 0 {
			return c
		}
		return slices.Compare(a.id[:], b.id[:])
	})
	return out
}
