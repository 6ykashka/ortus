package docs

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// Register gives the evaluator what the objects of «Документы» mean to it (ADR-0014 п.4, W4.01): the places of folders
// (the firm of the top folder, the folders above, the branch with the access lists) and documents (the same plus the
// own list), and what the actions mean to the lists. The access module explains with them (explainAccess of a folder or
// a document); the module itself decides by its own chain (access.go).
func Register(e *authz.Evaluator, pools Pools) {
	if e.Places == nil {
		e.Places = map[string]authz.ObjectResolver{}
	}
	if e.NodeRules == nil {
		e.NodeRules = map[string]authz.NodeRule{}
	}
	e.Places[authz.KindFolder] = FolderResolver{Pools: pools}
	e.Places[authz.KindDoc] = DocResolver{Pools: pools}
	rule := authz.NodeRule{Edit: []string{actionUpdate, actionSuggest}, Manage: actionShare, Create: actionCreate}
	e.NodeRules[authz.KindFolder], e.NodeRules[authz.KindDoc] = rule, rule
}

// FolderResolver places a folder.
type FolderResolver struct{ Pools Pools }

var _ authz.ObjectResolver = FolderResolver{}

// DocResolver places a document.
type DocResolver struct{ Pools Pools }

var _ authz.ObjectResolver = DocResolver{}

// branchSQL reads the folder $1 and the folders above it with their mode, firm and entries; the top folder first.
const branchSQL = `
with recursive branch as (
  select f.id, f.parent_id, f.mode, f.org_unit_id, 0 as up from docs.folders f where f.id = $1
  union all
  select p.id, p.parent_id, p.mode, p.org_unit_id, b.up + 1 from docs.folders p join branch b on p.id = b.parent_id
)
select b.id, b.mode, coalesce(b.org_unit_id, ` + nilUUID + `), coalesce(s.who, ''), coalesce(s.ref_id, ` + nilUUID + `),
       coalesce(s.org_unit_id, ` + nilUUID + `), coalesce(s.level, ''), coalesce((s.object_ref->>'entityId')::uuid, ` + nilUUID + `)
  from branch b left join docs.shares s on s.folder_id = b.id
 order by b.up desc, s.at, s.id`

// Place implements authz.ObjectResolver; a folder that does not exist has no place.
func (r FolderResolver) Place(ctx context.Context, tenantID, id uuid.UUID) (authz.Place, error) {
	pool, err := r.Pools.For(ctx, tenantID)
	if err != nil {
		return authz.Place{}, err
	}
	return branchPlace(ctx, pool, id, uuid.Nil)
}

// Place implements authz.ObjectResolver; a document that does not exist has no place.
func (r DocResolver) Place(ctx context.Context, tenantID, id uuid.UUID) (authz.Place, error) {
	pool, err := r.Pools.For(ctx, tenantID)
	if err != nil {
		return authz.Place{}, err
	}
	var folder uuid.UUID
	var mode string
	err = pool.QueryRow(ctx, `select folder_id, mode from docs.documents where id = $1`, id).Scan(&folder, &mode)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		return authz.Place{}, nil
	case err != nil:
		return authz.Place{}, fmt.Errorf("docs: place of a document: %w", err)
	}
	p, err := branchPlace(ctx, pool, folder, id)
	if err != nil {
		return p, err
	}
	doc := authz.Node{ID: id, Kind: authz.KindDoc, Mode: nodeModes[mode]}
	rows, err := pool.Query(ctx, `select who, coalesce(ref_id, `+nilUUID+`), coalesce(org_unit_id, `+nilUUID+`), level,
		coalesce((object_ref->>'entityId')::uuid, `+nilUUID+`) from docs.shares where document_id = $1 order by at, id`, id)
	if err != nil {
		return p, fmt.Errorf("docs: place of a document: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var who, lv string
		var ref, unit, obj uuid.UUID
		if err := rows.Scan(&who, &ref, &unit, &lv, &obj); err != nil {
			return p, fmt.Errorf("docs: place of a document: %w", err)
		}
		doc.Entries = append(doc.Entries, entryOfRow(who, ref, unit, obj, lv))
	}
	if err := rows.Err(); err != nil {
		return p, fmt.Errorf("docs: place of a document: %w", err)
	}
	p.Nodes = append(p.Nodes, doc)
	p.Containers = map[string]uuid.UUID{authz.KindFolder: folder}
	return p, nil
}

// nodeModes maps the mode of a folder or a document to the mode of the evaluator.
var nodeModes = map[string]authz.NodeMode{modeInherit: authz.NodeInherit, modeListed: authz.NodeListed}

// entryOfRow is an entry of the evaluator; the relation names the object (people are named by the module of repairs).
func entryOfRow(who string, ref, unit, obj uuid.UUID, level string) authz.Entry {
	l, _ := parseLevel(level)
	e := authz.Entry{Kind: authz.EntryKind(who), Ref: ref, Unit: unit, Edit: l >= levelEdit}
	if who == whoRelation {
		e.Ref = obj
	}
	return e
}

// branchPlace reads the branch of folders down to the folder: the firm of the top folder, the folders above (nearest
// first) and the nodes from the top down. doc is the document whose branch it is (uuid.Nil for a folder).
func branchPlace(ctx context.Context, pool interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}, folder, doc uuid.UUID) (authz.Place, error) {
	rows, err := pool.Query(ctx, branchSQL, folder)
	if err != nil {
		return authz.Place{}, fmt.Errorf("docs: place of a folder: %w", err)
	}
	defer rows.Close()
	var out authz.Place
	for rows.Next() {
		var (
			id, unit, ref, entryUnit, obj uuid.UUID
			mode, who, level              string
		)
		if err := rows.Scan(&id, &mode, &unit, &who, &ref, &entryUnit, &level, &obj); err != nil {
			return authz.Place{}, fmt.Errorf("docs: place of a folder: %w", err)
		}
		if len(out.Nodes) == 0 {
			out.Unit = unit // the firm of the top folder
		}
		if len(out.Nodes) == 0 || out.Nodes[len(out.Nodes)-1].ID != id {
			out.Nodes = append(out.Nodes, authz.Node{ID: id, Kind: authz.KindFolder, Mode: nodeModes[mode]})
		}
		if who != "" {
			n := &out.Nodes[len(out.Nodes)-1]
			n.Entries = append(n.Entries, entryOfRow(who, ref, entryUnit, obj, level))
		}
	}
	if err := rows.Err(); err != nil {
		return authz.Place{}, fmt.Errorf("docs: place of a folder: %w", err)
	}
	if doc == uuid.Nil {
		for i := len(out.Nodes) - 2; i >= 0; i-- {
			out.Ancestors = append(out.Ancestors, out.Nodes[i].ID)
		}
	}
	return out, nil
}
