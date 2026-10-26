// Примеры W4.81 (0.11.1-stage4, FollowUp выхода этапа 4): задачи на «Главной» — виды tasks.* «Требует решения» и сводка
// задач getMyTaskSummary (карточка «Задачи», бейдж меню). Подключается в tools/gen/examples-seed.mjs последним: к
// очередям getMyDecisionQueue этапа 2 (W2.00) добавляются карточки источника задач. Сюжет — сид задач «Альты» W4.10
// (mock-data.js :276–287, api.js :27–30), его воспроизводят кейсы conformance adapter/test/conformance/cases/fleet.ts:
// — владелец (Дарья Зимина): T-63 «На проверке» (LOG, срок 03.10) и заявка L-31 «Новая» воронки «Заявки · Ремонт»;
//   видит все задачи «Альты» — «Новые» T-64 и L-31, «В работе» T-66 и T-58, «На проверке» T-65 и T-63, своих новых
//   задач проектов с процессом нет;
// — логист (Марина Котова, роль проекта LOG): T-64 «Новая», срочная (danger), срок 01.10; воронки не видит.
// Срок «ДД.ММ» эталона — конец этого дня по Москве.

/** «ДД.ММ» → конец дня по Москве 2026 года (UTC). */
const dueOf = (dd, mm) =>
  new Date(Date.UTC(2026, mm - 1, dd + 1, -3)).toISOString().replace('.000Z', 'Z');

/**
 * @param {{ id: (scope: string, x: string) => string, problem: Function, NOW: string,
 *   prior: Record<string, Record<string, any>> }} deps примеры, собранные раньше (W2.00)
 * @returns {Record<string, Record<string, unknown>>} operationId → имя примера → тело
 */
export function stage4w481Examples({ id, problem, NOW, prior }) {
  const ex = {};
  const add = (op, name, body) => ((ex[op] ??= {})[name] = body);
  const A = (x) => id('t-alta', x);
  const alta = id('platform', 't-alta');

  const task = (kind, tone, proto, params) => ({
    key: `${kind}:${A(proto)}`,
    kind,
    moduleKey: 'tasks',
    tone,
    object: { moduleKey: 'tasks', entityType: 'task', entityId: A(proto) },
    params,
  });
  const t63 = task('tasks.task_review', 'neutral', 'T-63', {
    taskKey: 'T-63',
    title: 'Обновить регламент приёмки смены',
    projectId: A('fleet'),
    dueAt: dueOf(3, 10),
  });
  const l31 = task('tasks.task_new', 'neutral', 'L-31', {
    taskKey: 'L-31',
    title: 'Квартира 64 м², Химки',
    projectId: A('leads'),
    dueAt: dueOf(3, 10),
    funnel: 'true',
  });
  const t64 = task('tasks.task_new', 'danger', 'T-64', {
    taskKey: 'T-64',
    title: 'Найти водителя на рейс Р-211',
    projectId: A('fleet'),
    dueAt: dueOf(1, 10),
  });

  // Очереди этапа 2 с карточками задач: тон — danger → warn → info → neutral, внутри тона — порядок источников
  // (логистика → организация → задачи).
  const owner = prior.getMyDecisionQueue.ok;
  add('getMyDecisionQueue', 'ok', {
    ...owner,
    items: [...owner.items, t63, l31],
    total: owner.total + 2,
  });
  const manager = prior.getMyDecisionQueue.manager;
  add('getMyDecisionQueue', 'manager', {
    ...manager,
    items: [t64, ...manager.items],
    total: manager.total + 1,
  });

  add('getMyTaskSummary', 'ok', {
    tenantId: alta,
    new: 2,
    inProgress: 2,
    review: 2,
    myNew: 0,
    generatedAt: NOW,
  });
  add('getMyTaskSummary', 'manager', {
    tenantId: alta,
    new: 1,
    inProgress: 2,
    review: 2,
    myNew: 1,
    generatedAt: NOW,
  });
  add('getMyTaskSummary', 'not_found', problem('not_found', 'Организация не найдена.'));
  return ex;
}
