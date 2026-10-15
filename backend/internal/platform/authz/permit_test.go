package authz

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ortus/ortus-crm/backend/internal/platform/problem"
)

const (
	codeForbidden = problem.CodeForbiddenAction
	codeNotFound  = problem.CodeNotFound
	codeBlocked   = CodeFunctionBlocked
	codeDep       = problem.CodeDependencyUnavailable
)

type permitCase struct {
	name   string
	person uuid.UUID
	action string
	r      Resource
	code   string
}

func runPermit(t *testing.T, ev *Evaluator, cases []permitCase) {
	t.Helper()
	for _, tc := range cases {
		wantCode(t, tc.name, ev.Permit(t.Context(), member(tc.person), tc.action, tc.r), tc.code)
	}
}

func inUnit(u uuid.UUID, read string) Resource { return Resource{Unit: u, ReadAction: read} }

// 02-architecture §5: «Редактировать Москва-1» плюс «читать Самара-2» не превращается в «редактировать Москва-1 и
// Самара-2». WS-03 B3: PATCH объекта Самара-2 → 403 forbidden_action, чтение — 200; объект, которого субъект не
// видит, — 404 (AC-01).
func TestPermitEachGrantIsWhole(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	runPermit(t, ev, []permitCase{
		{"изменить в Москва-1", pTwoRoles, aVehiclesManage, inUnit(uMsk1, aVehiclesRead), ""},
		{"читать в Самара-2", pTwoRoles, aVehiclesRead, inUnit(uSmr2, aVehiclesRead), ""},
		{"изменить в Самара-2 (видит)", pTwoRoles, aVehiclesManage, inUnit(uSmr2, aVehiclesRead), codeForbidden},
		{"изменить в Москва-2 (не видит)", pTwoRoles, aVehiclesManage, inUnit(uMsk2, aVehiclesRead), codeNotFound},
		{"читать в Москва-2", pTwoRoles, aVehiclesRead, inUnit(uMsk2, aVehiclesRead), codeNotFound},
		{"без объекта", pTwoRoles, aVehiclesManage, Resource{}, codeForbidden},
		{"без ReadAction видимость решает само действие", pTwoRoles, aVehiclesManage, Resource{Unit: uSmr2}, codeNotFound},
	})
}

// Область «подразделение»: с потомками — поддерево через org.unit_closure, без — только само подразделение.
func TestPermitUnitSubtree(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	runPermit(t, ev, []permitCase{
		{"регион → фирма региона", pRegion, aVehiclesManage, inUnit(uMsk1, ""), ""},
		{"регион → сам регион", pRegion, aVehiclesManage, inUnit(uMsk, ""), ""},
		{"регион → чужой регион", pRegion, aVehiclesManage, inUnit(uSmr2, ""), codeNotFound},
		{"без потомков → регион", pFirmOnly, aVehiclesManage, inUnit(uMsk, ""), ""},
		{"без потомков → фирма региона", pFirmOnly, aVehiclesManage, inUnit(uMsk1, ""), codeNotFound},
		{"путь подразделения задан хендлером", pRegion, aVehiclesManage, Resource{Unit: uSmr2, UnitPath: []uuid.UUID{uSmr2, uMsk}}, ""},
	})
}

// Область «своё»: водитель видит свои рейсы, чужой рейс его подразделения — 404.
func TestPermitSelf(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	runPermit(t, ev, []permitCase{
		{"свой рейс", pDriver, aTripsRead, Resource{Unit: uMsk1, Persons: []uuid.UUID{pDriver}}, ""},
		{"чужой рейс", pDriver, aTripsRead, Resource{Unit: uMsk1, Persons: []uuid.UUID{pTemp}}, codeNotFound},
		{"список без объекта", pDriver, aTripsRead, Resource{}, codeForbidden},
	})
}

// PD-53: роль, выданная на проект, даёт права только в этом проекте; без объекта — ничего (B факт 6: Котова
// получала tasks.settings во всей организации).
func TestPermitObjectScopePD53(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	project := func(id uuid.UUID) Resource {
		return Resource{Objects: map[string]uuid.UUID{KindProject: id}, ReadAction: aProjectsRead}
	}
	runPermit(t, ev, []permitCase{
		{"без объекта", pLead, aProjectsManage, Resource{}, codeForbidden},
		{"свой проект", pLead, aProjectsManage, project(projFleet), ""},
		{"другой проект", pLead, aProjectsManage, project(projOther), codeNotFound},
		{"объект в подразделении, без проекта", pLead, aProjectsManage, inUnit(uMsk1, aProjectsRead), codeNotFound},
		{"другой вид объекта с тем же id", pLead, aProjectsManage,
			Resource{Objects: map[string]uuid.UUID{KindWarehouse: projFleet}}, codeNotFound},
		{"задача проекта в подразделении", pLead, aTasksRead,
			Resource{Unit: uMsk1, Objects: map[string]uuid.UUID{KindProject: projFleet}}, ""},
		{"владелец без объекта", pOwner, aProjectsManage, Resource{}, ""},
	})
}

// Период назначения сверяется с часами приложения, а не базы (Q-W0.09-11).
func TestPermitGrantPeriodByClock(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	trip := inUnit(uMsk1, "")
	runPermit(t, ev, []permitCase{
		{"временное назначение действует", pTemp, aTripsRead, trip, ""},
		{"закончилось и не началось", pExpired, aVehiclesRead, inUnit(uMsk1, ""), codeNotFound},
		{"не началось", pExpired, aVehiclesRead, inUnit(uMsk2, ""), codeNotFound},
	})
	ev.Now = func() time.Time { return now.Add(8 * 24 * time.Hour) }
	runPermit(t, ev, []permitCase{
		{"временное назначение закончилось", pTemp, aTripsRead, trip, codeNotFound},
		{"второе назначение началось", pExpired, aVehiclesRead, inUnit(uMsk2, ""), ""},
	})
}

// Параметр гранта limit: amount — часть гранта: лимит одной фирмы не переносится на другую.
func TestPermitLimitAmount(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	post := func(u uuid.UUID, value int64, currency string) Resource {
		r := inUnit(u, aCashRead)
		if currency != "" {
			r.Amount = &Amount{Value: value, Currency: currency}
		}
		return r
	}
	runPermit(t, ev, []permitCase{
		{"в лимите", pCashier, aCashPost, post(uMsk1, 5_000_00, "RUB"), ""},
		{"на лимите", pCashier, aCashPost, post(uMsk1, 10_000_00, "RUB"), ""},
		{"сверх лимита (касса видна)", pCashier, aCashPost, post(uMsk1, 20_000_00, "RUB"), codeForbidden},
		{"другая валюта", pCashier, aCashPost, post(uMsk1, 100, "USD"), codeForbidden},
		{"без лимита в другой фирме", pCashier, aCashPost, post(uMsk2, 20_000_00, "RUB"), ""},
		{"без суммы", pCashier, aCashPost, post(uMsk1, 0, ""), ""},
	})
	if (LimitAmount{}).Key() != "limit" {
		t.Error("LimitAmount key")
	}
}

// Правило «не автор» действует и для владельца (02-architecture §5: владелец не обходит серверные инварианты).
func TestPermitRuleNotAuthor(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	ev.Rules = map[string][]Rule{aTasksApprove: {NotAuthor{}}}
	task := func(author uuid.UUID) Resource {
		return Resource{Objects: map[string]uuid.UUID{KindProject: projFleet}, Author: author, ReadAction: aTasksRead}
	}
	runPermit(t, ev, []permitCase{
		{"владелец — своя задача", pOwner, aTasksApprove, task(pOwner), codeForbidden},
		{"владелец — чужая задача", pOwner, aTasksApprove, task(pLead), ""},
		{"руководитель проекта — своя", pLead, aTasksApprove, task(pLead), codeForbidden},
		{"руководитель проекта — чужая", pLead, aTasksApprove, task(pOwner), ""},
		{"правило другого действия не мешает", pLead, aTasksRead, task(pLead), ""},
	})
	if (NotAuthor{}).Key() != "not_author" {
		t.Error("NotAuthor key")
	}
}

// fakeACL: проект «Автопарк» ограничен (restricted), в списке — только руководитель проекта.
type fakeACL struct{ err error }

func (f fakeACL) Admit(_ context.Context, sub Subject, _ string, r Resource) (Admission, error) {
	if f.err != nil {
		return Inherited, f.err
	}
	if r.Object(KindProject) != projFleet {
		return Inherited, nil
	}
	if sub.PersonID == pLead {
		return Admitted, nil
	}
	return Denied, nil
}

func (fakeACL) Predicate(_ Subject, _ string, c Columns, _ *Args) string {
	return c.Objects[KindProject] + " is distinct from 'restricted'"
}

// Список доступа объекта: ограниченный проект скрыт от не допущенных (404), допуск не добавляет действие,
// владелец проходит.
func TestPermitObjectACL(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	ev.ACL = fakeACL{}
	project := func(id uuid.UUID) Resource { return Resource{Objects: map[string]uuid.UUID{KindProject: id}} }
	runPermit(t, ev, []permitCase{
		{"грант на организацию, но не в списке", pReader, aTasksRead, project(projFleet), codeNotFound},
		{"проект без списка", pReader, aTasksRead, project(projOther), ""},
		{"в списке", pLead, aTasksRead, project(projFleet), ""},
		{"в списке, но действия нет", pLead, aCashRead, project(projFleet), codeNotFound},
		{"владелец", pOwner, aTasksRead, project(projFleet), ""},
	})
	ev.ACL = fakeACL{err: errBoom}
	wantCode(t, "сбой списка доступа", ev.Permit(t.Context(), member(pReader), aTasksRead, project(projFleet)), codeDep)
}

// Отказ по действию на объекте, который список доступа скрывает, — 404, а не 403: видимость объекта решают грант на
// ReadAction и список доступа вместе, иначе 403 раскрыл бы существование ограниченного объекта (AC-01).
func TestPermitDenyHonoursObjectACL(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	ev.ACL = fakeACL{}
	task := func(id uuid.UUID) Resource {
		return Resource{Objects: map[string]uuid.UUID{KindProject: id}, ReadAction: aTasksRead}
	}
	runPermit(t, ev, []permitCase{
		{"ограниченный проект, не в списке: согласовать задачу", pReader, aTasksApprove, task(projFleet), codeNotFound},
		{"проект без списка: задача видна, действия нет", pReader, aTasksApprove, task(projOther), codeForbidden},
		{"в списке: задача видна, действия нет", pLead, aCashPost, task(projFleet), codeForbidden},
	})
	ev.ACL = fakeACL{err: errBoom}
	wantCode(t, "сбой списка доступа при выборе 403/404",
		ev.Permit(t.Context(), member(pReader), aTasksApprove, task(projFleet)), codeDep)
}

// owner_only (permissions.yaml): modules.manage, billing.manage — только OwnerBinding.
func TestPermitOwnerOnly(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	runPermit(t, ev, []permitCase{
		{"администратор: modules.manage", pAdmin, aModulesManage, Resource{}, codeForbidden},
		{"администратор: billing.manage", pAdmin, aBillingManage, Resource{}, codeForbidden},
		{"администратор: members.manage", pAdmin, aMembersManage, Resource{}, ""},
		{"владелец: modules.manage", pOwner, aModulesManage, Resource{}, ""},
	})
}

// owner_only на объекте отвечает как любой отказ: 403, когда участник видит объект, и 404, когда не видит —
// как на несуществующий id (AC-01). Действия owner_only пилота объектных ресурсов не имеют, поэтому политика
// задана в тесте.
func TestPermitOwnerOnlyOnObjectFollowsVisibility(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	ev.Policy.OwnerOnly = map[string]bool{aVehiclesManage: true}
	runPermit(t, ev, []permitCase{
		{"видит машину Москва-1", pTwoRoles, aVehiclesManage, inUnit(uMsk1, aVehiclesRead), codeForbidden},
		{"видит машину Самара-2", pTwoRoles, aVehiclesManage, inUnit(uSmr2, aVehiclesRead), codeForbidden},
		{"не видит машину Москва-2", pTwoRoles, aVehiclesManage, inUnit(uMsk2, aVehiclesRead), codeNotFound},
		{"без грантов", pNobody, aVehiclesManage, inUnit(uMsk1, aVehiclesRead), codeNotFound},
		{"без объекта", pTwoRoles, aVehiclesManage, Resource{}, codeForbidden},
		{"владелец", pOwner, aVehiclesManage, inUnit(uMsk2, aVehiclesRead), ""},
	})
}

// blocked_by_function: функция driver закрывает начисления независимо от ролей и групп (AUTH-05, AC-05).
func TestPermitFunctionBlocked(t *testing.T) {
	t.Parallel()
	ev, _ := newWorld(t)
	trip := inUnit(uMsk1, aTripsRead)
	runPermit(t, ev, []permitCase{
		{"водитель с начислениями через группу", pDriver, aEarningsRead, trip, codeBlocked},
		{"владелец с функцией водителя", pOwnerDriver, aEarningsRead, trip, codeBlocked},
		{"владелец", pOwner, aEarningsRead, trip, ""},
		{"не водитель с начислениями через группу", pEarner, aEarningsRead, trip, ""},
	})
}

// Неизвестное действие и неизвестный вид области — отказ (fail-closed).
func TestPermitFailsClosed(t *testing.T) {
	t.Parallel()
	ev, src := newWorld(t)
	runPermit(t, ev, []permitCase{
		{"действия нет в каталоге", pOwner, "fleet.teleport", Resource{}, codeForbidden},
		{"вид области не зарегистрирован", pGalaxy, aVehiclesRead, inUnit(uMsk1, ""), codeNotFound},
		{"без грантов", pNobody, aVehiclesRead, Resource{}, codeForbidden},
	})
	src.err = errBoom
	wantCode(t, "сбой источника", ev.Permit(t.Context(), member(pRegion), aVehiclesRead, inUnit(uMsk1, "")), codeDep)
	src.err = nil
	ev.Units = fakeTree{err: errBoom}
	wantCode(t, "сбой дерева подразделений", ev.Permit(t.Context(), member(pRegion), aVehiclesRead, inUnit(uMsk1, "")), codeDep)
}

// Владелец без закрытых функцией действий не читает tenant DB (как проверка владения W0.09 — по control DB).
func TestPermitOwnerReadsOnlyWhatItNeeds(t *testing.T) {
	t.Parallel()
	ev, src := newWorld(t)
	wantCode(t, "владелец", ev.Permit(t.Context(), member(pOwner), aVehiclesManage, inUnit(uMsk1, "")), "")
	if src.calls != 0 {
		t.Errorf("owner, plain action: %d source calls, want 0", src.calls)
	}
	wantCode(t, "владелец, начисления", ev.Permit(t.Context(), member(pOwner), aEarningsRead, inUnit(uMsk1, "")), "")
	if src.calls != 1 {
		t.Errorf("owner, blockable action: %d source calls, want 1 (work functions)", src.calls)
	}
}
