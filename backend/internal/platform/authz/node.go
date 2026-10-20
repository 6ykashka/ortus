package authz

import (
	"context"
	"slices"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// NodeMode is the own access of a tree node (knowledge pages, document folders and documents).
type NodeMode string

// Modes of a node (KbMode of W4.30, share modes of documents).
const (
	NodeInherit NodeMode = "inherit" // «Как у родителя»: the node adds nothing
	NodeEdit    NodeMode = "edit"    // «Читают все, правят выбранные»: editing only through «edit» entries
	NodeListed  NodeMode = "listed"  // «Только выбранные»: the node and its subtree are visible only to its entries
)

// EntryKind is who an access list entry names (Entry.who of the prototype, core/entries.ts).
type EntryKind string

// Kinds of entries.
const (
	EntryAll      EntryKind = "all"      // every member
	EntryMember   EntryKind = "member"   // one person (Ref)
	EntryGroup    EntryKind = "group"    // the members of a group (Ref)
	EntryRole     EntryKind = "role"     // the holders of a role (Ref), in a unit (Unit) or on the object of the role
	EntryRelation EntryKind = "relation" // the people of a relation (People: the foreman of the object, by id)
)

// Entry is one entry of the access list of a node.
type Entry struct {
	Kind   EntryKind
	Ref    uuid.UUID   // person, group or role
	Unit   uuid.UUID   // a role entry: the unit its grant must cover (uuid.Nil: anywhere)
	People []uuid.UUID // a relation entry: the people it names now
	Edit   bool        // «правит»; otherwise «читает»
}

// Node is one node of the branch of a tree object with its own access.
type Node struct {
	ID      uuid.UUID
	Kind    string // object-bound kind of the node: page, folder, doc
	Mode    NodeMode
	Entries []Entry
}

// NodeRule is what the actions of a module mean to the access lists of its nodes (the kind of the object).
type NodeRule struct {
	Edit   []string // actions an «edit» entry gives to those who see the node and an edit or listed node restricts
	Manage string   // action of a lead through a role on the object: passes every list of the branch («руководитель видит всё»)
	Create string   // action whose holder edits the nodes it created (Resource.Author)
}

// GroupSource returns the live groups of a person (access.group_members): group entries of access lists.
type GroupSource interface {
	Groups(ctx context.Context, tenantID, person uuid.UUID) ([]uuid.UUID, error)
}

// ACLGrant is implemented by an ObjectACL whose entries give an action themselves: an «edit» entry of a knowledge
// node gives editing to those who see the node (knowledge.md §3.2).
type ACLGrant interface {
	Grants(ctx context.Context, sub Subject, action string, r Resource) (bool, error)
}

// NodeACL is the access list of tree nodes (ACL на узлах, W4.01): one model for the knowledge base and documents
// (kbAccess of W4.30, docAccess of the prototype). The branch Resource.Nodes is checked from the top node to the
// object, after the deepest node on which the subject holds the only role that lets it read (a role on a page
// below a restriction); a listed node without an entry of the subject hides the object (404), the nearest node with
// its own mode decides editing: only its «edit» entries, the lead (NodeRule.Manage) and the author holding
// NodeRule.Create edit. A list adds no reading: a grant still has to let the subject read (02-architecture §5);
// an «edit» entry gives editing to those who see the node (ACLGrant). The evaluator does not ask it for the owner.
type NodeACL struct{ E *Evaluator }

var (
	_ ObjectACL = NodeACL{}
	_ ACLGrant  = NodeACL{}
)

// nodeWalk is what the branch of an object says to a subject.
type nodeWalk struct {
	hidden  bool   // a listed node without an entry of the subject
	nearest bool   // a node of the branch has its own mode
	hit     *Entry // the entry of the subject at the nearest node with its own mode
	listed  bool   // some node of the branch lists the subject
	lead    bool   // the subject holds NodeRule.Manage on the object through a role on it (not a territorial one)
	own     bool   // the subject created the object and holds NodeRule.Create on it
	edit    bool   // the action is one of NodeRule.Edit
}

// Admit implements ObjectACL.
func (a NodeACL) Admit(ctx context.Context, sub Subject, action string, r Resource) (Admission, error) {
	w, err := a.walk(ctx, sub, action, r)
	switch {
	case err != nil:
		return Inherited, err
	case w.hidden:
		return Denied, nil
	case w.edit && w.nearest && !w.editor():
		return Forbidden, nil
	case w.listed || w.lead:
		return Admitted, nil
	}
	return Inherited, nil
}

// Grants implements ACLGrant: an «edit» entry of the nearest node with its own mode, the lead and the author give
// the edit actions of the rule.
func (a NodeACL) Grants(ctx context.Context, sub Subject, action string, r Resource) (bool, error) {
	w, err := a.walk(ctx, sub, action, r)
	if err != nil || w.hidden || !w.edit {
		return false, err
	}
	return w.editor(), nil
}

// editor reports whether the walk lets the subject edit at the nearest node with its own mode.
func (w nodeWalk) editor() bool { return w.lead || w.own || (w.hit != nil && w.hit.Edit) }

// walk checks the branch of r for sub and action.
func (a NodeACL) walk(ctx context.Context, sub Subject, action string, r Resource) (nodeWalk, error) {
	if len(r.Nodes) == 0 || a.E == nil {
		return nodeWalk{}, nil
	}
	w, err := a.roles(ctx, sub, action, r)
	if err != nil {
		return w, err
	}
	read := r.ReadAction
	if read == "" {
		read = action
	}
	from, err := a.from(ctx, sub, read, r)
	if err != nil {
		return w, err
	}
	m := entryMatcher{e: a.E, sub: sub, r: r}
	return w, w.scan(ctx, &m, r.Nodes[from:])
}

// scan goes down nodes: a listed node without an entry of the subject (and not its lead) hides the object; every
// node with its own mode becomes the nearest one.
func (w *nodeWalk) scan(ctx context.Context, m *entryMatcher, nodes []Node) error {
	for _, n := range nodes {
		if n.Mode != NodeEdit && n.Mode != NodeListed {
			continue
		}
		hit, err := m.best(ctx, n.Entries)
		if err != nil {
			return err
		}
		if n.Mode == NodeListed && hit == nil && !w.lead {
			w.hidden = true
			return nil
		}
		w.nearest, w.hit = true, hit
		w.listed = w.listed || hit != nil
	}
	return nil
}

// roles starts the walk with what the rule of the object kind gives sub: the action is an edit one, sub leads, sub
// created the object and may create.
func (a NodeACL) roles(ctx context.Context, sub Subject, action string, r Resource) (nodeWalk, error) {
	rule := a.E.NodeRules[r.Nodes[len(r.Nodes)-1].Kind]
	w := nodeWalk{edit: slices.Contains(rule.Edit, action)}
	var err error
	if w.lead, err = a.leads(ctx, sub, rule.Manage, r); err != nil || r.Author == uuid.Nil || r.Author != sub.PersonID {
		return w, err
	}
	w.own, err = a.holds(ctx, sub, rule.Create, r)
	return w, err
}

// holds reports whether a grant of sub allows action on r ("" — never).
func (a NodeACL) holds(ctx context.Context, sub Subject, action string, r Resource) (bool, error) {
	if action == "" {
		return false, nil
	}
	return a.E.allows(ctx, sub, action, r)
}

// leads reports whether sub leads r: a grant of an object-bound kind (the space, a node of the branch) allows the
// lead action on r. A territorial grant with the same action does not pass the lists (kbAccess: only the space role
// r-kb-lead leads).
func (a NodeACL) leads(ctx context.Context, sub Subject, action string, r Resource) (bool, error) {
	if action == "" {
		return false, nil
	}
	for _, g := range sub.Grants {
		if kind, ok := a.E.Registry.Kind(g.Scope.Kind); !ok || !kind.ObjectBound() || !g.Has(action) {
			continue
		}
		if ok, err := a.E.grantAllows(ctx, sub, g, action, r); err != nil || ok {
			return ok, err
		}
	}
	return false, nil
}

// from is the index of the first node of the branch to check: after the deepest node on which sub holds a role that
// lets it read, when only such roles let it read (kbAccess: a page role opens the branch below a restriction);
// otherwise the top.
func (a NodeACL) from(ctx context.Context, sub Subject, read string, r Resource) (int, error) {
	from := 0
	for _, g := range sub.Grants {
		if !g.Has(read) {
			continue
		}
		ok, err := a.E.grantAllows(ctx, sub, g, read, r)
		switch {
		case err != nil:
			return 0, err
		case !ok:
			continue
		}
		i := slices.IndexFunc(r.Nodes, func(n Node) bool { return n.Kind == g.Scope.Kind && n.ID == g.Scope.Ref })
		if i < 0 {
			return 0, nil // a grant above the branch (the space, the unit) lets it read: every list counts
		}
		from = max(from, i+1)
	}
	return from, nil
}

// entryMatcher matches the entries of access lists against a subject, reading its groups once, when needed.
type entryMatcher struct {
	e      *Evaluator
	sub    Subject
	r      Resource
	groups []uuid.UUID
	loaded bool
}

// best returns the entry of the subject among entries, an «edit» one first; nil if none.
func (m *entryMatcher) best(ctx context.Context, entries []Entry) (*Entry, error) {
	var found *Entry
	for i := range entries {
		ok, err := m.has(ctx, entries[i])
		switch {
		case err != nil:
			return nil, err
		case !ok:
			continue
		case entries[i].Edit:
			return &entries[i], nil
		case found == nil:
			found = &entries[i]
		}
	}
	return found, nil
}

// has reports whether entry names the subject (entryHas of core/entries.ts).
func (m *entryMatcher) has(ctx context.Context, en Entry) (bool, error) {
	switch en.Kind {
	case EntryAll:
		return true, nil
	case EntryMember:
		return en.Ref == m.sub.PersonID, nil
	case EntryRelation:
		return slices.Contains(en.People, m.sub.PersonID), nil
	case EntryGroup:
		if !m.loaded {
			if err := m.load(ctx); err != nil {
				return false, err
			}
		}
		return slices.Contains(m.groups, en.Ref), nil
	case EntryRole:
		return m.holdsRole(ctx, en)
	}
	return false, nil
}

func (m *entryMatcher) load(ctx context.Context) error {
	m.loaded = true
	gs, ok := m.e.Source.(GroupSource)
	if !ok {
		return nil
	}
	var err error
	m.groups, err = gs.Groups(ctx, m.sub.TenantID, m.sub.PersonID)
	return err
}

// holdsRole reports whether the subject holds the role of a role entry: a grant of the role on the object of r (a
// role of the space counts in its space only) or, for a territorial role, covering the unit of the entry.
func (m *entryMatcher) holdsRole(ctx context.Context, en Entry) (bool, error) {
	for _, g := range m.sub.Grants {
		if g.RoleID != en.Ref {
			continue
		}
		kind, ok := m.e.Registry.Kind(g.Scope.Kind)
		if !ok {
			continue
		}
		target := m.r
		switch {
		case kind.ObjectBound() && target.Object(kind.Key()) == uuid.Nil:
			continue
		case !kind.ObjectBound() && en.Unit != uuid.Nil:
			target = Resource{Unit: en.Unit}
			var err error
			if target, err = m.e.withUnitPath(ctx, tenantctx.TenantContext{TenantID: m.sub.TenantID}, target); err != nil {
				return false, err
			}
		case !kind.ObjectBound():
			return true, nil
		}
		covers, err := kind.Covers(ctx, g.Scope, m.sub, target)
		if err != nil {
			return false, err
		}
		if covers {
			return true, nil
		}
	}
	return false, nil
}
