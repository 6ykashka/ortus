package authz

import (
	"context"
	"maps"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/tenantctx"
)

// The world of stage 4 (W4.01) beside the pilot world: the knowledge space «Регламенты» of Москва-1 with the branch
// «Введение» → «Подробно» → «Глубже», the page «Правка» and «Открытая»; the document folder «Договоры» → «2026» with
// the document «Договор поставки»; a cash account, a chat, a repair object with the id of the project «Автопарк»
// (RS-08), the project «Закрытый»; people with roles on those objects, on the relation and in Москва-1.

var (
	spaceRules = tid("space:rules")
	spaceOther = tid("space:other")
	pageIntro  = tid("page:intro")
	pageSub    = tid("page:sub")
	pageDeep   = tid("page:deep")
	pageEdit   = tid("page:edit")
	pageOpen   = tid("page:open")
	pageAlien  = tid("page:alien") // a page of spaceOther
	folderTop  = tid("folder:contracts")
	folderYear = tid("folder:2026")
	docSupply  = tid("doc:supply")
	cashMsk1   = tid("account:msk1")
	chatTrip   = tid("chat:trip")
	projClosed = tid("project:closed")
	groupKb    = tid("group:kb")
	roleKb     = tid("role:kb-reader")

	pSpaceLead   = tid("person:space-lead")
	pPageReader  = tid("person:page-reader")
	pFolderRead  = tid("person:folder-reader")
	pRepair      = tid("person:repair")
	pForeman     = tid("person:foreman")
	pUnitTasks   = tid("person:unit-tasks")
	pSelfTasks   = tid("person:self-tasks")
	pOwnerInProj = tid("person:owner-in-project")
	pKbReader    = tid("person:kb-reader")
	pKbEditor    = tid("person:kb-editor")
	pKbListed    = tid("person:kb-listed")
	pKbGroup     = tid("person:kb-group")
	pKbRole      = tid("person:kb-role")
	pKbRoleFar   = tid("person:kb-role-far")
	pKbWriter    = tid("person:kb-writer")
	pKbAuthor    = tid("person:kb-author")
	pPageOnly    = tid("person:page-only")
	pBoth        = tid("person:both")
	pCash        = tid("person:cash")
	pChat        = tid("person:chat")
	pObsUnit     = tid("person:observer-and-unit") // «Наблюдатель» in «Автопарк» and a role of the firm Москва-1
	pKbLeadUnit  = tid("person:kb-lead-unit")      // the lead action through a role of the firm, not of the space
)

const (
	aKbRead    = "knowledge.read"
	aKbCreate  = "knowledge.create"
	aKbUpdate  = "knowledge.update"
	aKbPublish = "knowledge.publish" // the lead action of the tests (knowledge.access.manage comes with PR knowledge)
	aTasksUpd  = "tasks.update"
)

var (
	kbReadRole   = []string{aKbRead}
	kbEditRole   = []string{aKbRead, aKbUpdate}
	kbLeadRole   = []string{aKbRead, aKbCreate, aKbUpdate, aKbPublish}
	kbAuthorRole = []string{aKbRead, aKbCreate}
	tasksRole    = []string{aProjectsRead, aTasksRead, aTasksUpd}
	tasksWatcher = []string{aProjectsRead, aTasksRead} // «Наблюдатель» of a project
)

// roleGrant is grant with a fixed role.
func roleGrant(role uuid.UUID, actions []string, kind string, ref uuid.UUID, descendants bool) Grant {
	g := grant(actions, kind, ref, descendants)
	g.RoleID = role
	return g
}

func stage4Subjects() map[uuid.UUID]Subject {
	s := subjects()
	maps.Copy(s, map[uuid.UUID]Subject{
		pSpaceLead:   {Grants: []Grant{grant(kbLeadRole, KindSpace, spaceRules, false)}},
		pPageReader:  {Grants: []Grant{grant(kbReadRole, KindPage, pageIntro, false)}},
		pFolderRead:  {Grants: []Grant{grant(kbReadRole, KindFolder, folderTop, false)}},
		pRepair:      {Grants: []Grant{grant(projectRole, KindRepairProject, projFleet, false)}},
		pForeman:     {Grants: []Grant{grant(kbReadRole, KindRelation, uuid.Nil, false), grant(kbReadRole, KindUnit, uMsk1, true)}},
		pUnitTasks:   {Grants: []Grant{grant(tasksRole, KindUnit, uMsk1, true)}},
		pSelfTasks:   {Grants: []Grant{grant(tasksRole, KindSelf, uuid.Nil, false)}},
		pOwnerInProj: {Grants: []Grant{grant(tasksRole, KindProject, projClosed, false)}},
		pKbReader:    {Grants: []Grant{grant(kbReadRole, KindUnit, uMsk1, true)}},
		pKbEditor:    {Grants: []Grant{grant(kbEditRole, KindUnit, uMsk1, true)}},
		pKbListed:    {Grants: []Grant{grant(kbReadRole, KindUnit, uMsk1, true)}},
		pKbGroup:     {Grants: []Grant{grant(kbReadRole, KindUnit, uMsk1, true)}},
		pKbRole:      {Grants: []Grant{roleGrant(roleKb, kbReadRole, KindUnit, uMsk, true)}},
		pKbRoleFar:   {Grants: []Grant{roleGrant(roleKb, kbReadRole, KindUnit, uSmr2, true), grant(kbReadRole, KindUnit, uMsk1, true)}},
		pKbWriter:    {Grants: []Grant{grant(kbReadRole, KindUnit, uMsk1, true)}},
		pKbAuthor:    {Grants: []Grant{grant(kbAuthorRole, KindUnit, uMsk1, true)}},
		pPageOnly:    {Grants: []Grant{grant(kbReadRole, KindPage, pageSub, false)}},
		pBoth:        {Grants: []Grant{grant(kbReadRole, KindPage, pageSub, false), grant(kbReadRole, KindUnit, uMsk1, true)}},
		pCash:        {Grants: []Grant{grant(cashRole, KindAccount, cashMsk1, false)}},
		pChat:        {Grants: []Grant{grant([]string{"chat.read"}, KindChat, chatTrip, false)}},
		pObsUnit:     {Grants: []Grant{grant(tasksWatcher, KindProject, projFleet, false), grant(tasksRole, KindUnit, uMsk1, true)}},
		pKbLeadUnit:  {Grants: []Grant{grant(kbLeadRole, KindUnit, uMsk1, true)}},
	})
	return s
}

// fakePlaces resolves the knowledge, the documents and a failing kind of the stage 4 world.
type fakePlaces struct {
	kind       string
	spaceLevel Level
	err        error
}

// Nodes of the knowledge branch: «Введение» lists its readers, «Правка» — editing by entries only.
func kbNodes(id uuid.UUID) []Node {
	intro := Node{ID: pageIntro, Kind: KindPage, Mode: NodeListed, Entries: []Entry{
		{Kind: EntryMember, Ref: pKbListed},
		{Kind: EntryGroup, Ref: groupKb, Edit: true},
		{Kind: EntryRole, Ref: roleKb, Unit: uMsk1},
		{Kind: EntryRelation, People: []uuid.UUID{pForeman}},
	}}
	sub := Node{ID: pageSub, Kind: KindPage, Mode: NodeInherit}
	deep := Node{ID: pageDeep, Kind: KindPage}
	edit := Node{ID: pageEdit, Kind: KindPage, Mode: NodeEdit, Entries: []Entry{{Kind: EntryMember, Ref: pKbWriter, Edit: true}}}
	switch id {
	case pageIntro:
		return []Node{intro}
	case pageSub:
		return []Node{intro, sub}
	case pageDeep:
		return []Node{intro, sub, deep}
	case pageEdit:
		return []Node{edit}
	}
	return []Node{{ID: id, Kind: KindPage}}
}

func (f fakePlaces) Place(_ context.Context, _ uuid.UUID, id uuid.UUID) (Place, error) {
	if f.err != nil {
		return Place{}, f.err
	}
	switch f.kind {
	case KindPage:
		parents := map[uuid.UUID][]uuid.UUID{pageSub: {pageIntro}, pageDeep: {pageSub, pageIntro}}
		space := spaceRules
		if id == pageAlien {
			space = spaceOther
		}
		return Place{Containers: map[string]uuid.UUID{KindSpace: space}, Ancestors: parents[id], Nodes: kbNodes(id)}, nil
	case KindSpace:
		level := f.spaceLevel
		if level == "" {
			level = LevelOpen
		}
		return Place{Unit: uMsk1, Container: SpaceContainer(level)}, nil
	case KindDoc:
		return Place{Containers: map[string]uuid.UUID{KindFolder: folderYear}}, nil
	case KindFolder:
		if id == folderYear {
			return Place{Ancestors: []uuid.UUID{folderTop}}, nil
		}
	}
	return Place{}, nil
}

// fakeGroups: pKbGroup is in «Знания».
type fakeGroups struct {
	*fakeSource
	err error
}

func (f fakeGroups) Groups(_ context.Context, _ uuid.UUID, person uuid.UUID) ([]uuid.UUID, error) {
	if f.err != nil {
		return nil, f.err
	}
	if person == pKbGroup {
		return []uuid.UUID{groupKb}, nil
	}
	return nil, nil
}

// newStage4World is the evaluator of the stage 4 world with its resolvers and the rule of knowledge pages.
func newStage4World(t *testing.T) (*Evaluator, *fakeSource) {
	t.Helper()
	src := &fakeSource{subjects: stage4Subjects(), modules: []string{ModSpa}}
	ev := New(fakeGroups{fakeSource: src}, fakeTree{}, func() time.Time { return now })
	ev.Places = map[string]ObjectResolver{
		KindPage: fakePlaces{kind: KindPage}, KindSpace: fakePlaces{kind: KindSpace},
		KindDoc: fakePlaces{kind: KindDoc}, KindFolder: fakePlaces{kind: KindFolder},
	}
	ev.NodeRules = map[string]NodeRule{KindPage: {Edit: []string{aKbUpdate}, Manage: aKbPublish, Create: aKbCreate}}
	ev.ContainerReads = map[string][]string{KindProject: {aProjectsRead, aTasksRead}, KindSpace: {aKbRead}}
	return ev, src
}

// as is the tenant context of person, owner or not.
func as(person uuid.UUID, owner bool) tenantctx.TenantContext {
	return tenantctx.TenantContext{TenantID: tenantA, PersonID: person, Owner: owner}
}

// objects is Resource.Objects with one object.
func objects(kind string, id uuid.UUID) map[string]uuid.UUID { return map[string]uuid.UUID{kind: id} }

// page is a knowledge node to read (ReadAction knowledge.read); author — its creator.
func page(id uuid.UUID, author uuid.UUID) Resource {
	return Resource{Objects: objects(KindPage, id), ReadAction: aKbRead, Author: author}
}
