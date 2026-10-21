package knowledge

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// Register gives the evaluator what the objects of the knowledge base mean to it (ADR-0014 п.4, W4.01): the places
// of spaces (their unit and level) and pages (the space, the ancestors and the branch with its access lists), the
// actions of the lists of pages and the reads a limited space keeps for the roles of its area. The access module
// explains with them (explainAccess of a space or a node); the module itself decides by its own chain (access.go).
func Register(e *authz.Evaluator, pools Pools, rel Relations) {
	if e.Places == nil {
		e.Places = map[string]authz.ObjectResolver{}
	}
	if e.NodeRules == nil {
		e.NodeRules = map[string]authz.NodeRule{}
	}
	if e.ContainerReads == nil {
		e.ContainerReads = map[string][]string{}
	}
	e.Places[authz.KindSpace] = SpaceResolver{Pools: pools}
	e.Places[authz.KindPage] = PageResolver{Pools: pools, Relations: rel}
	e.NodeRules[authz.KindPage] = authz.NodeRule{Edit: []string{actionUpdate, actionPublish, actionOrganize}, Manage: actionAccess,
		Create: actionCreate}
	e.ContainerReads[authz.KindSpace] = []string{actionRead}
}

// SpaceResolver places a knowledge space: its unit and its level (the container of its pages).
type SpaceResolver struct{ Pools Pools }

var _ authz.ObjectResolver = SpaceResolver{}

// Place implements authz.ObjectResolver; a space that does not exist has no place.
func (s SpaceResolver) Place(ctx context.Context, tenantID, id uuid.UUID) (authz.Place, error) {
	pool, err := s.Pools.For(ctx, tenantID)
	if err != nil {
		return authz.Place{}, err
	}
	var (
		unitID uuid.UUID
		level  string
	)
	err = pool.QueryRow(ctx, `select coalesce(org_unit_id, '00000000-0000-0000-0000-000000000000'), access from kb.spaces where id = $1`,
		id).Scan(&unitID, &level)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return authz.Place{}, nil
	case err != nil:
		return authz.Place{}, fmt.Errorf("knowledge: place of a space: %w", err)
	}
	return authz.Place{Unit: unitID, Container: authz.SpaceContainer(authz.Level(level))}, nil
}

// PageResolver places a knowledge node: its space with its unit and level, its ancestors (nearest first) and the
// branch from the top node down to it with the own access of each node (the relation «прораб объекта» names the
// foreman of the object of Relations).
type PageResolver struct {
	Pools     Pools
	Relations Relations // nil: no objects of repairs (until stage 6)
}

var _ authz.ObjectResolver = PageResolver{}

// branchSQL reads the node $1 and its ancestors with their space, depth, mode and entries.
const branchSQL = `
with recursive branch as (
  select n.id, n.parent_id, n.space_id, n.depth, n.access_mode from kb.nodes n where n.id = $1
  union all
  select p.id, p.parent_id, p.space_id, p.depth, p.access_mode
    from kb.nodes p join branch b on p.id = b.parent_id and p.space_id = b.space_id
)
select b.id, b.space_id, b.depth, b.access_mode, coalesce(s.org_unit_id, '00000000-0000-0000-0000-000000000000'), s.access,
       coalesce(a.who, ''), coalesce(a.ref_id, '00000000-0000-0000-0000-000000000000'),
       coalesce(a.org_unit_id, '00000000-0000-0000-0000-000000000000'), coalesce(a.object_id, '00000000-0000-0000-0000-000000000000'),
       coalesce(a.can, '')
  from branch b
  join kb.spaces s on s.id = b.space_id
  left join kb.node_access a on a.node_id = b.id
 order by b.depth, a.position`

// Place implements authz.ObjectResolver; a node that does not exist has no place.
func (p PageResolver) Place(ctx context.Context, tenantID, id uuid.UUID) (authz.Place, error) {
	pool, err := p.Pools.For(ctx, tenantID)
	if err != nil {
		return authz.Place{}, err
	}
	rows, err := pool.Query(ctx, branchSQL, id)
	if err != nil {
		return authz.Place{}, fmt.Errorf("knowledge: place of a node: %w", err)
	}
	defer rows.Close()
	var out authz.Place
	for rows.Next() {
		if err := scanBranch(rows, &out); err != nil {
			return authz.Place{}, fmt.Errorf("knowledge: place of a node: %w", err)
		}
	}
	if err := rows.Err(); err != nil {
		return authz.Place{}, fmt.Errorf("knowledge: place of a node: %w", err)
	}
	for i := len(out.Nodes) - 2; i >= 0; i-- {
		out.Ancestors = append(out.Ancestors, out.Nodes[i].ID)
	}
	return out, p.relations(ctx, tenantID, &out)
}

// relations names the foremen of the objects of the relation entries of the branch.
func (p PageResolver) relations(ctx context.Context, tenantID uuid.UUID, out *authz.Place) error {
	if p.Relations == nil {
		return nil
	}
	var objs []RepairObject
	for i := range out.Nodes {
		for j := range out.Nodes[i].Entries {
			e := &out.Nodes[i].Entries[j]
			if e.Kind != authz.EntryRelation {
				continue
			}
			if objs == nil {
				var err error
				if objs, err = p.Relations.Objects(ctx, tenantID); err != nil {
					return fmt.Errorf("knowledge: objects of repairs: %w", err)
				}
			}
			for _, o := range objs {
				if o.ID == e.Ref && o.Foreman != uuid.Nil {
					e.People = []uuid.UUID{o.Foreman}
				}
			}
			e.Ref = uuid.Nil
		}
	}
	return nil
}

// scanBranch adds a row of branchSQL to the place: a new node of the branch or another entry of the last one.
func scanBranch(rows pgx.Rows, out *authz.Place) error {
	var (
		nodeID, spaceID, unitID, ref, entryUnit, obj uuid.UUID
		depth                                        int
		mode, level, who, can                        string
	)
	if err := rows.Scan(&nodeID, &spaceID, &depth, &mode, &unitID, &level, &who, &ref, &entryUnit, &obj, &can); err != nil {
		return err
	}
	if out.Container == nil {
		out.Unit, out.Container = unitID, authz.SpaceContainer(authz.Level(level))
		out.Containers = map[string]uuid.UUID{authz.KindSpace: spaceID}
	}
	if len(out.Nodes) == 0 || out.Nodes[len(out.Nodes)-1].ID != nodeID {
		out.Nodes = append(out.Nodes, authz.Node{ID: nodeID, Kind: authz.KindPage, Mode: nodeModes[mode]})
	}
	if who == "" {
		return nil
	}
	n := &out.Nodes[len(out.Nodes)-1]
	e := authz.Entry{Kind: authz.EntryKind(who), Ref: ref, Edit: can == canEdit}
	switch who {
	case whoRole:
		e.Unit = entryUnit
	case whoRelation:
		e.Ref = obj // the object; people are named by placeRelations
	}
	n.Entries = append(n.Entries, e)
	return nil
}

// nodeModes maps the access mode of kb.nodes to the mode of the evaluator.
var nodeModes = map[string]authz.NodeMode{"inherit": authz.NodeInherit, "edit_listed": authz.NodeEdit, "listed": authz.NodeListed}
