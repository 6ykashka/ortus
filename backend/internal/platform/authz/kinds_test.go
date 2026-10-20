package authz

import (
	"slices"
	"testing"

	"github.com/google/uuid"

	contextapi "github.com/ortus/ortus-crm/backend/internal/api/context"
)

// isRegistered reports whether k is a kind of the evaluator (Kinds).
func isRegistered(k string) bool {
	return slices.ContainsFunc(Kinds(), func(s ScopeKind) bool { return s.Key() == k })
}

// Виды этапов 4–7 (ADR-0014 п. 3, контракт 0.7.0-stage4): объектные — пространство, страница, папка, документ,
// касса, чат, объект ремонта (PD-53); relation — вычисляемая связь без объекта. Ключ каталога — он же Scope.kind.
func TestModuleKinds(t *testing.T) {
	t.Parallel()
	want := []string{KindSpace, KindPage, KindFolder, KindDoc, KindAccount, KindChat, KindRepairProject, KindRelation}
	var keys []string
	for _, k := range ModuleKinds() {
		keys = append(keys, k.Key())
		if k.ObjectBound() != (k.Key() != KindRelation) {
			t.Errorf("%s: ObjectBound = %v", k.Key(), k.ObjectBound())
		}
		if k.APIKind() != k.Key() {
			t.Errorf("%s: APIKind = %q, want the key", k.Key(), k.APIKind())
		}
	}
	if !slices.Equal(keys, want) {
		t.Errorf("ModuleKinds = %v, want %v", keys, want)
	}
	reg, err := NewRegistry(Kinds()...)
	if err != nil {
		t.Fatal(err)
	}
	if got, all := reg.Keys(), append(slices.Clone([]string{KindTenant, KindUnit, KindSelf, KindProject, KindWarehouse, KindResource}), want...); !slices.Equal(got, all) {
		t.Errorf("Kinds = %v, want %v", got, all)
	}
	ev, _ := newWorld(t)
	if got := ev.Registry.Keys(); len(got) != 14 {
		t.Errorf("New registers %v, want the 14 kinds of Kinds()", got)
	}
}

// Каждый Scope.kind контракта 0.7.0-stage4 есть в реестре, «будущих» видов не осталось.
func TestEveryContractScopeKindIsRegistered(t *testing.T) {
	t.Parallel()
	api := map[string]bool{}
	for _, k := range Kinds() {
		api[k.APIKind()] = true
	}
	for _, kind := range []contextapi.ScopeKind{contextapi.Tenant, contextapi.OrgUnit, contextapi.Project, contextapi.Self,
		contextapi.ResourcePool, contextapi.Space, contextapi.Page, contextapi.Folder, contextapi.Doc, contextapi.Account,
		contextapi.Chat, contextapi.Relation, contextapi.RepairProject} {
		if !api[string(kind)] {
			t.Errorf("Scope.kind %q of the contract has no kind in the registry", kind)
		}
	}
	if len(FutureKinds) != 0 {
		t.Errorf("FutureKinds = %v, want none: W4.01 registers every kind of the catalog", FutureKinds)
	}
}

// PD-53 для каждого объектного вида этапов 4–7: без объекта — ничего, свой объект — да, другой — 404.
func TestPermitModuleObjectKinds(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	for _, tc := range []struct {
		person uuid.UUID
		kind   string
		own    uuid.UUID
		action string
	}{
		{pCash, KindAccount, cashMsk1, aCashRead},
		{pChat, KindChat, chatTrip, "chat.read"},
		{pRepair, KindRepairProject, projFleet, aProjectsRead},
		{pFolderRead, KindFolder, folderTop, aKbRead},
		{pSpaceLead, KindSpace, spaceRules, aKbRead},
	} {
		r := func(id uuid.UUID) Resource { return Resource{Objects: objects(tc.kind, id), ReadAction: tc.action} }
		runPermit4(t, ev, []permitCase{
			{tc.kind + ": без объекта", tc.person, tc.action, Resource{}, codeForbidden},
			{tc.kind + ": свой объект", tc.person, tc.action, r(tc.own), ""},
			{tc.kind + ": другой объект", tc.person, tc.action, r(uuid.New()), codeNotFound},
		})
	}
}

// RS-08 (Q-W4.00-tasks-1, Q-W4.00-repair-2): project — только проект «Задач»; объект ремонта — repair_project. Роль
// на проект не покрывает объект ремонта с тем же id, роль на объект ремонта — проект.
func TestRS08ProjectIsTasksOnly(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	runPermit4(t, ev, []permitCase{
		{"роль проекта задач → объект ремонта", pLead, aProjectsRead, Resource{Objects: objects(KindRepairProject, projFleet)}, codeNotFound},
		{"роль проекта задач → проект задач", pLead, aProjectsRead, Resource{Objects: objects(KindProject, projFleet)}, ""},
		{"роль объекта ремонта → проект задач", pRepair, aProjectsRead, Resource{Objects: objects(KindProject, projFleet)}, codeNotFound},
		{"роль объекта ремонта → объект ремонта", pRepair, aProjectsRead, Resource{Objects: objects(KindRepairProject, projFleet)}, ""},
	})
}

// relation: грант покрывает запись, связь которой называет субъекта (прораб объекта, водитель рейса, исполнитель
// задачи); без записи — ничего (Q-W4.02-1).
func TestPermitRelation(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	runPermit4(t, ev, []permitCase{
		{"связь называет субъекта", pForeman, aKbRead, Resource{Related: []uuid.UUID{pForeman}, ReadAction: aKbRead}, ""},
		{"связь называет другого", pForeman, aKbRead, Resource{Related: []uuid.UUID{pLead}, ReadAction: aKbRead}, codeNotFound},
		{"без записи", pRepair, aProjectsRead, Resource{}, codeForbidden},
	})
	p, err := ev.ScopeQuery(t.Context(), member(pForeman), aKbRead, Columns{Related: []string{"o.foreman_id", "o.driver_id"}}, 1)
	if err != nil || p.SQL != "((o.foreman_id = $2 or o.driver_id = $3))" || !slices.Equal(p.Args, []any{pForeman, pForeman}) {
		t.Errorf("relation predicate: %q %v %v", p.SQL, p.Args, err)
	}
	if p, _ := ev.ScopeQuery(t.Context(), member(pForeman), aKbRead, Columns{Unit: "t.unit_id"}, 0); p.SQL != "(t.unit_id"+closure+"$1))" {
		t.Errorf("relation without columns adds nothing: %q", p.SQL)
	}
}

// Шлюз: объектные виды этапов 4–7 засчитываются, только где x-scope их допускает (PD-53).
func TestAdmitModuleKinds(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	for _, tc := range []admitCase{
		{"касса на tenant-org-unit-account", pCash, op("tenant-org-unit-account", aCashRead), ""},
		{"касса на tenant-or-org-unit", pCash, op("tenant-or-org-unit", aCashRead), codeForbidden},
		{"пространство на tenant-org-unit-project", pSpaceLead, op("tenant-org-unit-project", aKbRead), codeForbidden},
		{"пространство на owning-object-scope", pSpaceLead, op("owning-object-scope", aKbRead), ""},
		{"связь на tenant-org-unit-project-self", pForeman, op("tenant-org-unit-project-self", "tasks.read"), codeForbidden},
	} {
		wantCode(t, tc.name, ev.Admit(t.Context(), as(tc.person, false), tc.op), tc.code)
	}
}

// /me/context: гранты видов этапов 4–7 — возможности со своей областью (меню и гейты считают canAny, Q-W0.11-1).
func TestCapabilitiesModuleKinds(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	got, err := ev.Capabilities(t.Context(), as(pSpaceLead, false))
	if err != nil {
		t.Fatal(err)
	}
	want := "knowledge.read|space|" + spaceRules.String()
	if !slices.Contains(capKeys(got), want) {
		t.Errorf("capabilities %v, want %s", capKeys(got), want)
	}
	got, _ = ev.Capabilities(t.Context(), as(pForeman, false))
	if !slices.Contains(capKeys(got), "knowledge.read|relation|") {
		t.Errorf("relation capabilities %v", capKeys(got))
	}
}

func runPermit4(t *testing.T, ev *Evaluator, cases []permitCase) {
	t.Helper()
	for _, tc := range cases {
		wantCode(t, tc.name, ev.Permit(t.Context(), as(tc.person, false), tc.action, tc.r), tc.code)
	}
}
