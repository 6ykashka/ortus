package authz

import (
	"slices"
	"testing"

	"github.com/google/uuid"
)

// ADR-0014 п. 4: объектный грант засчитывается и для объекта внутри своего объекта — страница внутри пространства,
// подстраница внутри страницы, документ в папке и её подпапках. Место объекта даёт резолвер вида; без резолвера
// грант покрывает только сам объект.
func TestPermitObjectHierarchy(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	doc := Resource{Objects: objects(KindDoc, docSupply), ReadAction: aKbRead}
	runPermit4(t, ev, []permitCase{
		{"пространство → страница в нём", pSpaceLead, aKbUpdate, page(pageOpen, uuid.Nil), ""},
		{"пространство → глубокая страница", pSpaceLead, aKbUpdate, page(pageDeep, uuid.Nil), ""},
		{"пространство → страница другого пространства", pSpaceLead, aKbUpdate, page(pageAlien, uuid.Nil), codeNotFound},
		{"страница → подстраница", pPageReader, aKbRead, page(pageDeep, uuid.Nil), ""},
		{"страница → сама", pPageReader, aKbRead, page(pageIntro, uuid.Nil), ""},
		{"страница → соседняя ветка", pPageReader, aKbRead, page(pageOpen, uuid.Nil), codeNotFound},
		{"папка → документ во вложенной папке", pFolderRead, aKbRead, doc, ""},
		{"папка → сама вложенная папка", pFolderRead, aKbRead, Resource{Objects: objects(KindFolder, folderYear), ReadAction: aKbRead}, ""},
	})
	// Хендлер уже знает место объекта: резолвер не нужен.
	given := Resource{Objects: objects(KindPage, pageDeep), Ancestors: map[string][]uuid.UUID{KindPage: {pageSub, pageIntro}}, ReadAction: aKbRead}
	ev.Places = nil
	runPermit4(t, ev, []permitCase{
		{"без резолвера: пространство → страница", pSpaceLead, aKbUpdate, page(pageOpen, uuid.Nil), codeNotFound},
		{"предки заданы хендлером", pPageReader, aKbRead, given, ""},
	})
}

// Сбой резолвера — dependency_unavailable, а не отказ.
func TestPermitPlaceFailure(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	ev.Places[KindPage] = fakePlaces{err: errBoom}
	wantCode(t, "сбой резолвера", ev.Permit(t.Context(), as(pSpaceLead, false), aKbRead, page(pageDeep, uuid.Nil)), codeDep)
	_, err := ev.Explain(t.Context(), as(pSpaceLead, false), aKbRead, page(pageDeep, uuid.Nil))
	wantCode(t, "сбой резолвера в объяснении", err, codeDep)
}

// scopeQuery по иерархии: колонка-массив «объект и его предки» вместо равенства id.
func TestScopeQueryObjectPaths(t *testing.T) {
	t.Parallel()
	ev, _ := newStage4World(t)
	cols := Columns{Objects: map[string]string{KindPage: "n.id", KindSpace: "n.space_id"}, Paths: map[string]string{KindPage: "n.path"}}
	p, err := ev.ScopeQuery(t.Context(), as(pPageReader, false), aKbRead, cols, 0)
	if err != nil || p.SQL != "($1 = any(n.path))" || !slices.Equal(p.Args, []any{pageIntro}) {
		t.Errorf("page grant: %q %v %v", p.SQL, p.Args, err)
	}
	p, err = ev.ScopeQuery(t.Context(), as(pSpaceLead, false), aKbRead, cols, 0)
	if err != nil || p.SQL != "(n.space_id = $1)" || !slices.Equal(p.Args, []any{spaceRules}) {
		t.Errorf("space grant: %q %v %v", p.SQL, p.Args, err)
	}
}
