//go:build integration

package docs

import (
	"testing"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/authz"
)

// The evaluator explains an access to a folder and a document with their branch: the firm of the top folder, the folders
// above, the access lists down to the object (explainAccess, W4.01).
func TestPlaces(t *testing.T) { //nolint:gocyclo,paralleltest // the tests share the documents and the people of the fixtures and run in order
	owner := personOf(t, "a.owner")
	top := newFolder(t, "Место")
	sub := seedFolder(t, "Вложенная "+uuid.NewString()[:6], top, owner, modeListed)
	doc := seedDoc(t, sub, owner, "В ветке", "text")
	member := personOf(t, "a.manager-msk1")
	if err := exec(t.Context(), `insert into docs.shares (folder_id, who, ref_id, level) values ($1, 'member', $2, 'edit')`, sub, member); err != nil {
		t.Fatal(err)
	}
	if err := exec(t.Context(), `insert into docs.shares (document_id, who, ref_id, level) values ($1, 'all', null, 'view')`, doc); err != nil {
		t.Fatal(err)
	}
	f, err := FolderResolver{Pools: pools}.Place(t.Context(), tenantA, sub)
	if err != nil {
		t.Fatal(err)
	}
	if len(f.Nodes) != 2 || f.Nodes[0].ID != top || f.Nodes[1].ID != sub || f.Nodes[1].Mode != authz.NodeListed || len(f.Ancestors) != 1 || f.Ancestors[0] != top {
		t.Fatalf("folder place %+v, want the branch top → sub with the folder above", f)
	}
	if e := f.Nodes[1].Entries; len(e) != 1 || e[0].Kind != authz.EntryMember || e[0].Ref != member || !e[0].Edit {
		t.Fatalf("entries %+v, want the member with «правит»", e)
	}
	d, err := DocResolver{Pools: pools}.Place(t.Context(), tenantA, doc)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Nodes) != 3 || d.Nodes[2].ID != doc || d.Nodes[2].Kind != authz.KindDoc || d.Containers[authz.KindFolder] != sub ||
		len(d.Nodes[2].Entries) != 1 || d.Nodes[2].Entries[0].Kind != authz.EntryAll || d.Nodes[2].Entries[0].Edit {
		t.Fatalf("doc place %+v", d)
	}
	none, err := DocResolver{Pools: pools}.Place(t.Context(), tenantA, uuid.New())
	if err != nil || len(none.Nodes) != 0 {
		t.Fatalf("missing document: %v %+v, want no place", err, none)
	}
}
