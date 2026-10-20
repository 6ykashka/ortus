package authz

import (
	"testing"

	"github.com/google/uuid"
)

// ACL на узлах (knowledge.md §3.2, documents.md §3.2; kbAccess W4.30): «Только выбранные» — узел и его ветка видны
// только записям списка (иначе 404, как несуществующий); записи — участник, группа, роль (+ подразделение), связь,
// все; подстраница наследует ограничение; руководитель (действие Manage) проходит списки; владелец бизнеса — тоже.
// Список не добавляет чтения: запись без гранта на чтение не открывает узел.
func TestNodeACLListed(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	runPermit4(t, ev, []permitCase{
		{"роль фирмы не в списке", pKbReader, aKbRead, page(pageIntro, uuid.Nil), codeNotFound},
		{"роль фирмы не в списке: подстраница", pKbReader, aKbRead, page(pageDeep, uuid.Nil), codeNotFound},
		{"участник в списке", pKbListed, aKbRead, page(pageDeep, uuid.Nil), ""},
		{"группа в списке", pKbGroup, aKbRead, page(pageIntro, uuid.Nil), ""},
		{"роль в подразделении записи", pKbRole, aKbRead, page(pageIntro, uuid.Nil), ""},
		{"та же роль в другом подразделении", pKbRoleFar, aKbRead, page(pageIntro, uuid.Nil), codeNotFound},
		{"прораб объекта (связь)", pForeman, aKbRead, page(pageIntro, uuid.Nil), ""},
		{"руководитель пространства", pSpaceLead, aKbRead, page(pageDeep, uuid.Nil), ""},
		{"страница без своего доступа", pKbReader, aKbRead, page(pageOpen, uuid.Nil), ""},
		{"без гранта на чтение", pNobody, aKbRead, page(pageIntro, uuid.Nil), codeNotFound},
	})
	wantCode(t, "владелец", ev.Permit(t.Context(), as(pOwner, true), aKbUpdate, page(pageIntro, uuid.Nil)), "")
}

// Роль на узле ниже ограничения: если читать даёт только она, проверка ветки начинается под этим узлом (kbAccess,
// `from`); если читать даёт и роль области, ограничение выше действует.
func TestNodeACLRoleBelowRestriction(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	runPermit4(t, ev, []permitCase{
		{"роль на подстраницу под «Только выбранные»", pPageOnly, aKbRead, page(pageDeep, uuid.Nil), ""},
		{"та же роль не открывает родителя", pPageOnly, aKbRead, page(pageIntro, uuid.Nil), codeNotFound},
		{"роль на подстраницу и роль фирмы", pBoth, aKbRead, page(pageDeep, uuid.Nil), codeNotFound},
	})
}

// «Читают все, правят выбранные»: правка — только записям «правит» (остальным видимый узел — 403); запись «правит»
// даёт правку видящему узел и без права правки; руководитель и автор узла с правом создания правят.
func TestNodeACLEdit(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	runPermit4(t, ev, []permitCase{
		{"читать — все", pKbReader, aKbRead, page(pageEdit, uuid.Nil), ""},
		{"право правки, но не в списке", pKbEditor, aKbUpdate, page(pageEdit, uuid.Nil), codeForbidden},
		{"запись «правит» без права правки", pKbWriter, aKbUpdate, page(pageEdit, uuid.Nil), ""},
		{"руководитель", pSpaceLead, aKbUpdate, page(pageEdit, uuid.Nil), ""},
		{"автор с правом создания", pKbAuthor, aKbUpdate, page(pageEdit, pKbAuthor), ""},
		{"не автор с правом создания", pKbAuthor, aKbUpdate, page(pageEdit, pKbWriter), codeForbidden},
		{"группа «правит» в «Только выбранные»", pKbGroup, aKbUpdate, page(pageDeep, uuid.Nil), ""},
		{"участник «читает» в «Только выбранные»", pKbListed, aKbUpdate, page(pageDeep, uuid.Nil), codeForbidden},
		{"запись «правит» не даёт чужого действия", pKbWriter, aKbPublish, page(pageEdit, uuid.Nil), codeForbidden},
	})
}

// Руководитель, который проходит списки, — только роль на объекте (пространство, узел): в kbAccess это роль
// пространства r-kb-lead. Роль фирмы с тем же действием в открытом пространстве списков не проходит.
func TestNodeACLLeadIsObjectRole(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	runPermit4(t, ev, []permitCase{
		{"роль фирмы с действием руководителя: «Только выбранные»", pKbLeadUnit, aKbRead, page(pageIntro, uuid.Nil), codeNotFound},
		{"роль фирмы с действием руководителя: «Правят выбранные»", pKbLeadUnit, aKbUpdate, page(pageEdit, uuid.Nil), codeForbidden},
		{"роль фирмы: страница без своего доступа", pKbLeadUnit, aKbUpdate, page(pageOpen, uuid.Nil), ""},
		{"роль пространства проходит списки", pSpaceLead, aKbRead, page(pageIntro, uuid.Nil), ""},
	})
}

// Сбой источника групп — dependency_unavailable; источник без групп — запись группы не совпадает.
func TestNodeACLGroupsSource(t *testing.T) {
	t.Parallel()
	ev, src := newStage4World(t)
	ev.Source = fakeGroups{fakeSource: src, err: errBoom}
	wantCode(t, "сбой источника групп", ev.Permit(t.Context(), as(pKbGroup, false), aKbRead, page(pageIntro, uuid.Nil)), codeDep)
	ev.Source = src
	wantCode(t, "источник без групп", ev.Permit(t.Context(), as(pKbGroup, false), aKbRead, page(pageIntro, uuid.Nil)), codeNotFound)
}
