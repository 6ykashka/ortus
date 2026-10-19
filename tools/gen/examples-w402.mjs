// Примеры контрактного PR 1 этапа 4 (W4.02, 0.7.0-stage4). Подключается в tools/gen/examples-seed.mjs после примеров
// W2.57. Сюжеты на сиде 14.10:
//   - explainAccess/project — «Почему доступно» с объектом (x-explain-objects): Марина Котова («Руководитель проекта»
//     на проекте «Автопарк») и tasks.update по объекту tasks/project этого проекта — роль на объект засчитана (PD-53),
//     шаги permission и resource-scope пройдены. Без объекта тот же запрос — explainAccess/ok (W0.08). Пример
//     воспроизводит кейс conformance adapter/test/conformance/cases/access.ts (PD-43);
//   - transitionTask/invalid_transition — условие перехода не выполнено: Problem.reason checklist_open и текст
//     прототипа trCheck «Сначала закройте чек-лист» (Q-W4.00-tasks-12).

/** Текст trCheck прототипа (design/ortus/models.js) для причины checklist_open. */
export const CHECKLIST_OPEN = 'Сначала закройте чек-лист';

/**
 * @param {{ problem: Function, prior: Record<string, Record<string, unknown>> }} deps примеры, собранные раньше (W0.08)
 * @returns {Record<string, Record<string, unknown>>} operationId → имя примера → тело
 */
export function stage4w402Examples({ problem, prior }) {
  const ok = prior.explainAccess?.ok;
  if (!ok) throw new Error('examples-w402: нет explainAccess/ok (W0.08)');
  const grant = ok.grants[0];
  if (grant?.scope?.kind !== 'project')
    throw new Error('examples-w402: у explainAccess/ok нет роли на проект');
  const pass = (check) => ({ check, passed: true });
  const project = {
    memberId: ok.memberId,
    permission: ok.permission,
    object: { moduleKey: 'tasks', entityType: 'project', entityId: grant.scope.resourceIds[0] },
    allowed: true,
    decisiveCheck: 'permission',
    checks: [
      ...ok.checks.filter((c) => c.check !== 'permission').map((c) => pass(c.check)),
      pass('permission'),
      pass('resource-scope'),
    ],
    grants: [
      {
        assignmentId: grant.assignmentId,
        roleId: grant.roleId,
        roleName: grant.roleName,
        via: grant.via,
        scope: structuredClone(grant.scope),
        matches: true,
      },
    ],
    hiddenGrants: false,
    policyVersion: ok.policyVersion,
  };
  return {
    explainAccess: { project },
    transitionTask: {
      invalid_transition: problem('invalid_transition', CHECKLIST_OPEN, {
        reason: 'checklist_open',
      }),
    },
  };
}
