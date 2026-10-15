// Package groups is the groups of the access module (W1.06, «Группы и владельцы», Q-W0.08-2): listGroups, getGroup,
// createGroup, updateGroup, deleteGroup (archive), setGroupMembers. A group is only a principal of role assignments:
// it never merges the data of several firms (AUTH-04). Its managers are the managers of its home unit (members.read
// and members.manage over it; a tenant-wide group needs a grant of the whole tenant); members outside the read scope
// of the actor are counted, not listed, and kept on a replacement of the member list. A new member of a group with
// roles is checked as a direct assignment of those roles (delegation, D-10).
package groups

import (
	"context"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	accessapi "github.com/ortus/ortus-crm/backend/internal/api/access"
	"github.com/ortus/ortus-crm/backend/internal/modules/access/assignments/kit" //nolint:depguard // the shared kit of the access module (W1.06)
	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// Actions of the operations (Q-W0.08-2: no separate keys for groups).
const (
	actionRead   = "members.read"
	actionManage = "members.manage"
	targetGroup  = "access.group"
)

// Handler implements the group operations of accessapi.StrictServerInterface.
type Handler struct{ d kit.Deps }

// New returns the handler over d.
func New(d kit.Deps) *Handler { return &Handler{d: d} }

// group is a live group with its counters.
type group struct {
	ID          uuid.UUID
	Name        string
	Description string
	Home        *uuid.UUID
	Revision    int64
	Created     time.Time
	sortKey     string
	Assignments int64
	Members     []uuid.UUID // visible to the actor
	Hidden      int64
}

func (g group) home() uuid.UUID {
	if g.Home == nil {
		return uuid.Nil
	}
	return *g.Home
}

func (g group) api() accessapi.Group {
	members := g.Members
	if members == nil {
		members = []uuid.UUID{}
	}
	return accessapi.Group{Id: g.ID, Name: g.Name, Description: g.Description, HomeUnitId: g.Home, MemberIds: members,
		HiddenMemberCount: g.Hidden, AssignmentCount: g.Assignments, Revision: g.Revision, CreatedAt: g.Created.UTC()}
}

// liveAssignments counts the active and dormant assignments of a group that have not ended at $1.
const liveAssignments = `(select count(*) from access.role_assignments ra where ra.principal_kind = 'group' and ra.principal_id = g.id
	and ra.state <> 'revoked' and (upper_inf(ra.valid) or upper(ra.valid) > $1))`

const selectGroups = `select g.id, g.name, g.description, g.home_unit_id, g.revision, g.created_at, lower(g.name) collate "C", ` +
	liveAssignments + `
  from access.groups g
 where g.archived_at is null and {{scope}}`

func scanGroup(row pgx.Row) (group, error) {
	var g group
	err := row.Scan(&g.ID, &g.Name, &g.Description, &g.Home, &g.Revision, &g.Created, &g.sortKey, &g.Assignments)
	return g, err
}

// columns: a group is seen through its home unit (null — the tenant).
var columns = authz.Columns{Unit: "g.home_unit_id"}

// withMembers fills the visible members and the hidden count of groups (members.read over the home unit of each
// person).
func withMembers(ctx context.Context, conn kit.Scoped, groups []group) error {
	if len(groups) == 0 {
		return nil
	}
	ids := make([]uuid.UUID, 0, len(groups))
	at := map[uuid.UUID]int{}
	for i, g := range groups {
		ids = append(ids, g.ID)
		at[g.ID] = i
	}
	rows, err := conn.Query(ctx, actionRead, authz.Columns{Unit: "p.home_unit_id"}, `select gm.group_id, gm.person_id, {{scope}}
		  from access.group_members gm join people.person_profiles p on p.id = gm.person_id
		 where gm.group_id = any($1)
		 order by gm.group_id, gm.added_at, gm.person_id`, ids)
	if err != nil {
		return kit.Store("group members", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			gid, person uuid.UUID
			visible     bool
		)
		if err := rows.Scan(&gid, &person, &visible); err != nil {
			return kit.Store("group members", err)
		}
		g := &groups[at[gid]]
		if visible {
			g.Members = append(g.Members, person)
		} else {
			g.Hidden++
		}
	}
	return kit.Store("group members", rows.Err())
}

// ListGroups implements accessapi.StrictServerInterface: live groups whose home unit the actor reads, by name;
// orgUnitId narrows to a subtree (groups of the whole tenant are not in any subtree).
func (h *Handler) ListGroups(ctx context.Context, req accessapi.ListGroupsRequestObject) (accessapi.ListGroupsResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	limit, err := kit.Limit(req.Params.Limit)
	if err != nil {
		return nil, err
	}
	after, err := kit.DecodeCursor(req.Params.Cursor)
	if err != nil {
		return nil, err
	}
	key, id := "", uuid.Nil
	if after != nil {
		key, id = after.Key, after.ID
	}
	conn, err := h.d.Scoped(ctx, tc, h.d.Evaluator)
	if err != nil {
		return nil, err
	}
	rows, err := conn.Query(ctx, actionRead, columns, selectGroups+`
		and ($2::uuid is null or g.home_unit_id in (select descendant_id from org.unit_closure where ancestor_id = $2))
		and (lower(g.name) collate "C", g.id) > ($3, $4)
		order by lower(g.name) collate "C", g.id limit $5`, h.d.Clock(), req.Params.OrgUnitId, key, id, limit+1)
	if err != nil {
		return nil, kit.Store("groups", err)
	}
	items, err := pgx.CollectRows(rows, func(r pgx.CollectableRow) (group, error) { return scanGroup(r) })
	if err != nil {
		return nil, kit.Store("groups", err)
	}
	var next *string
	if len(items) > limit {
		last := items[limit-1]
		c := kit.Cursor{Key: last.sortKey, ID: last.ID}.Encode()
		next, items = &c, items[:limit]
	}
	if err := withMembers(ctx, conn, items); err != nil {
		return nil, err
	}
	page := accessapi.GroupPage{Items: make([]accessapi.Group, 0, len(items)), NextCursor: next}
	for _, g := range items {
		page.Items = append(page.Items, g.api())
	}
	cc, rid := kit.Meta(ctx)
	return accessapi.ListGroups200JSONResponse{Body: page, Headers: accessapi.ListGroups200ResponseHeaders{CacheControl: cc, XRequestId: rid}}, nil
}

// read returns a group the actor sees with its members; an invisible or missing one is 404.
func (h *Handler) read(ctx context.Context, conn kit.Scoped, id uuid.UUID) (group, error) {
	g, err := scanGroup(conn.QueryRow(ctx, actionRead, columns, selectGroups+` and g.id = $2`, h.d.Clock(), id))
	switch {
	case kit.NoRows(err):
		return group{}, kit.NotFound()
	case err != nil:
		return group{}, kit.Store("group", err)
	}
	gs := []group{g}
	if err := withMembers(ctx, conn, gs); err != nil {
		return group{}, err
	}
	return gs[0], nil
}

// GetGroup implements accessapi.StrictServerInterface.
func (h *Handler) GetGroup(ctx context.Context, req accessapi.GetGroupRequestObject) (accessapi.GetGroupResponseObject, error) {
	tc, err := kit.Tenant(ctx)
	if err != nil {
		return nil, err
	}
	conn, err := h.d.Scoped(ctx, tc, h.d.Evaluator)
	if err != nil {
		return nil, err
	}
	g, err := h.read(ctx, conn, req.GroupId)
	if err != nil {
		return nil, err
	}
	cc, rid := kit.Meta(ctx)
	tag := kit.ETag(g.Revision)
	return accessapi.GetGroup200JSONResponse{Body: g.api(), Headers: accessapi.GetGroup200ResponseHeaders{CacheControl: cc, ETag: &tag, XRequestId: rid}}, nil
}
