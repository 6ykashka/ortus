package authz

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/google/uuid"
)

// explainAccess с объектом (x-explain-objects): грант на содержащий объект совпадает (пространство узла, страница-
// предок — ADR-0014 п. 4), на другой объект — other_object, объектный грант, который до объекта не достаёт, —
// object_scope_without_object (PD-53).
func TestExplainObjectHierarchy(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	for _, tc := range []struct {
		name    string
		person  uuid.UUID
		action  string
		r       Resource
		allowed bool
		want    []string
	}{
		{"пространство узла", pSpaceLead, aKbUpdate, page(pageDeep, uuid.Nil), true, []string{"space:"}},
		{"страница-предок", pPageReader, aKbRead, page(pageDeep, uuid.Nil), true, []string{"page:"}},
		{"другая ветка", pPageReader, aKbRead, page(pageOpen, uuid.Nil), false, []string{"page:other_object"}},
		{"пространство без страницы", pSpaceLead, aKbRead, Resource{Objects: objects(KindSpace, spaceOther)}, false, []string{"space:other_object"}},
		{"страница, а спрашивают пространство", pPageReader, aKbRead, Resource{Objects: objects(KindSpace, spaceRules)}, false,
			[]string{"page:object_scope_without_object"}},
		{"объект ремонта, а спрашивают проект (RS-08)", pRepair, aProjectsRead, Resource{Objects: objects(KindProject, projFleet)}, false,
			[]string{"repair_project:object_scope_without_object"}},
		{"роль фирмы в закрытом проекте", pUnitTasks, aTasksRead, task(projOther, LevelClosed), false, []string{"unit:out_of_scope"}},
		{"список узла скрывает", pKbReader, aKbRead, page(pageIntro, uuid.Nil), false, []string{"unit:"}},
	} {
		x, err := ev.Explain(t.Context(), as(tc.person, false), tc.action, tc.r)
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if x.Allowed != tc.allowed || !slices.Equal(verdicts(x), tc.want) {
			t.Errorf("%s: allowed %v %v, want %v %v", tc.name, x.Allowed, verdicts(x), tc.allowed, tc.want)
		}
	}
}

// Explain говорит, что отказ владельцу — закрытый проект без его роли (TP-03): «Почему доступно» называет причину.
func TestExplainOwnerShut(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	for _, tc := range []struct {
		name   string
		person uuid.UUID
		r      Resource
		shut   bool
	}{
		{"закрытый проект", pOwner, task(projOther, LevelClosed), true},
		{"закрытый проект с ролью в нём", pOwnerInProj, task(projClosed, LevelClosed), true},
		{"открытый проект", pOwner, task(projOther, LevelOpen), false},
		{"закрытое пространство", pOwner, Resource{Objects: objects(KindSpace, spaceRules), Container: SpaceContainer(LevelClosed)}, false},
	} {
		x, err := ev.Explain(t.Context(), as(tc.person, true), aTasksRead, tc.r)
		if err != nil || x.OwnerShut != tc.shut {
			t.Errorf("%s: OwnerShut %v %v, want %v", tc.name, x.OwnerShut, err, tc.shut)
		}
	}
	if x, _ := ev.Explain(t.Context(), as(pUnitTasks, false), aTasksRead, task(projOther, LevelClosed)); x.OwnerShut {
		t.Error("member: OwnerShut is the owner's")
	}
}

// brokenKind fails to cover: a kind of a module whose resolver or table is unavailable.
type brokenKind struct{ objectKind }

func (brokenKind) Covers(context.Context, Scope, Subject, Resource) (bool, error) {
	return false, errBoom
}

// Q-W1.04-21: ошибка зависимости при выборе ответа на отказ (видимость объекта через грант вида с ошибкой) не
// превращается молча в «запрещено» — Explain её возвращает, как Permit.
func TestExplainPropagatesFailures(t *testing.T) {
	t.Parallel()
	reg, err := NewRegistry(append(PilotKinds(), brokenKind{objectKind{key: "broken"}})...)
	if err != nil {
		t.Fatal(err)
	}
	broken := tid("broken:1")
	src := &fakeSource{subjects: map[uuid.UUID]Subject{pReader: {Grants: []Grant{grant([]string{aTasksRead}, "broken", broken, false)}}}}
	ev := New(src, fakeTree{}, func() time.Time { return now })
	ev.Registry = reg
	r := Resource{Objects: objects("broken", broken), ReadAction: aTasksRead}
	wantCode(t, "Permit", ev.Permit(t.Context(), member(pReader), aTasksApprove, r), codeDep)
	_, err = ev.Explain(t.Context(), member(pReader), aTasksApprove, r)
	if err == nil {
		t.Fatal("Explain: the failure became a denial (Q-W1.04-21)")
	}
	wantCode(t, "Explain", err, codeDep)
}
