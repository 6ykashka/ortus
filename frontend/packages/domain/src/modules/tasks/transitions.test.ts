import { describe, expect, it } from 'vitest';
import { altaDb, mkProject, mkTask } from './fixture.test-util.ts';
import { trCheck } from './transitions.ts';
import type { Project, Task, Transition } from './types.ts';

const trOf = (p: Project, id: string): Transition => {
  const tr = p.wf?.transitions.find((x) => x.id === id);
  if (!tr) throw new Error('нет перехода ' + id);
  return tr;
};
const custom = (o: Partial<Transition>): Transition => ({
  id: 'tx',
  name: 'Свой переход',
  from: ['s2'],
  to: 's3',
  who: [],
  notAuthor: false,
  approval: null,
  comment: false,
  checklist: false,
  assignAuthor: false,
  ...o,
});

const T65 = (o: Partial<Task> = {}) =>
  mkTask('T-65', {
    status: 'На проверке',
    authorId: 'm-vasiliev',
    author: 'Илья Васильев',
    checklist: [{ t: 'Счёт приложен', d: true }],
    ...o,
  });

describe('trCheck: процесс с согласованием (models.js:217–233)', () => {
  const p = mkProject('approval');
  const approve = trOf(p, 't3');

  it.each([
    ['m-kotelnikova', T65(), { ok: true }],
    ['m-owner', T65(), { ok: true }],
    [
      'm-vasiliev',
      T65(),
      {
        ok: false,
        why: 'Согласует роль с правом «Согласовывать»; у вас роль «Исполнитель» не даёт «Согласовывать»',
      },
    ],
    [
      'm-morozova',
      T65(),
      {
        ok: false,
        why: 'Согласует роль с правом «Согласовывать»; у вас нет роли с правом «Задачи» в области проекта',
      },
    ],
    [
      'm-kotova',
      T65({ authorId: 'm-kotova' }),
      { ok: false, why: 'Вы автор задачи — свою согласовать нельзя' },
    ],
    [
      'm-kotelnikova',
      T65({
        approval: { tr: 't3', votes: [{ tr: 't3', by: 'm-kotelnikova', name: 'В', at: '10:00' }] },
      }),
      { ok: false, why: 'Вы уже согласовали, ждём остальных' },
    ],
    [
      'm-kotelnikova',
      T65({ checklist: [{ t: 'Счёт приложен', d: false }] }),
      { ok: false, why: 'Сначала закройте чек-лист' },
    ],
    ['m-kotelnikova', T65({ status: 'В работе' }), { ok: false, hide: true }],
    ['m-kotelnikova', T65({ status: 'Нет в процессе' }), { ok: false, hide: true }],
  ] as const)('«Согласовать» · %s → %j', (member, t, want) => {
    expect(trCheck(altaDb([p], [t]), p, t, member, approve)).toEqual(want);
  });

  it('подзадачи должны быть завершены: открытые перечисляются по id', () => {
    const parent = mkTask('T-66', { status: 'На проверке', authorId: 'm-kotova' });
    const kids = [
      mkTask('T-65', { parent: 'T-66', status: 'На проверке' }),
      mkTask('T-58', { parent: 'T-66', status: 'В работе' }),
      mkTask('T-60', { parent: 'T-66', status: 'Готово' }),
    ];
    const db = altaDb([p], [parent, ...kids]);
    expect(trCheck(db, p, parent, 'm-kotelnikova', approve)).toEqual({
      ok: false,
      why: 'Сначала завершите подзадачи: T-65, T-58',
    });
    expect(trCheck(db, p, parent, 'm-kotelnikova', { ...approve, children: false })).toEqual({
      ok: true,
    });
  });

  it('«Отменить» из любого статуса, кроме самой «Отменена»; только руководитель проекта', () => {
    const cancel = trOf(p, 't5');
    const db = altaDb([p]);
    expect(trCheck(db, p, T65(), 'm-kotova', cancel)).toEqual({ ok: true });
    expect(trCheck(db, p, T65({ status: 'Отменена' }), 'm-kotova', cancel)).toEqual({
      ok: false,
      hide: true,
    });
    expect(trCheck(db, p, T65(), 'm-vasiliev', cancel)).toEqual({
      ok: false,
      why: 'Доступно: руководитель проекта',
    });
    // «*» вместе с целевым статусом в источниках — переход скрыт (как в эталоне).
    expect(trCheck(db, p, T65(), 'm-kotova', { ...cancel, from: ['*', 's5'] })).toEqual({
      ok: false,
      hide: true,
    });
  });

  it('без процесса у проекта переходов нет', () => {
    const bare = { ...p, wf: undefined };
    expect(trCheck(altaDb([bare]), bare, T65(), 'm-owner', approve)).toEqual({
      ok: false,
      hide: true,
    });
  });
});

describe('trCheck: простой процесс и «Кто может»', () => {
  const p = mkProject('simple');
  const t = (o: Partial<Task> = {}) => mkTask('LOG-101', { status: 'В работе', ...o });

  it.each([
    ['t2', 'm-vasiliev', t(), { ok: true }],
    [
      't2',
      'm-kotelnikova',
      t(),
      { ok: false, why: 'Менять статус нельзя: роль «Согласующий» не даёт «Менять статус»' },
    ],
    ['t2', 'm-gromov', t(), { ok: false, why: 'Менять статус нельзя: сотрудник заблокирован' }],
    [
      't3',
      'm-vasiliev',
      t({ status: 'На проверке' }),
      { ok: false, why: 'Доступно: руководитель проекта' },
    ],
    ['t3', 'm-kotova', t({ status: 'На проверке' }), { ok: true }],
    ['t3', 'm-owner', t({ status: 'На проверке' }), { ok: true }],
    [
      't3',
      'm-kotova',
      t({ status: 'На проверке', checklist: [{ t: 'a', d: false }] }),
      { ok: false, why: 'Сначала закройте чек-лист' },
    ],
    ['t4', 'm-kotova', t({ status: 'На проверке' }), { ok: true }],
  ] as const)('%s · %s → %j', (trId, member, task, want) => {
    expect(trCheck(altaDb([p], [task]), p, task, member, trOf(p, trId))).toEqual(want);
  });

  it.each([
    [['assignee'], 'm-vasiliev', t(), { ok: true }],
    [
      ['assignee'],
      'm-vasiliev',
      t({ assignee: 'Марина Котова' }),
      { ok: false, why: 'Доступно: исполнитель задачи' },
    ],
    [['author'], 'm-vasiliev', t({ authorId: 'm-vasiliev' }), { ok: true }],
    [
      ['author', 'r-pm'],
      'm-vasiliev',
      t(),
      { ok: false, why: 'Доступно: автор задачи, руководитель проекта' },
    ],
    [['r-exec'], 'm-vasiliev', t(), { ok: true }],
    [['r-approver'], 'm-kotova', t(), { ok: true }],
  ] as const)('кто может %j · %s', (who, member, task, want) => {
    const tr = custom({ who: [...who] });
    expect(trCheck(altaDb([p], [task]), p, task, member, tr)).toEqual(want);
  });

  it('«не автор» и подзадачи в простом процессе', () => {
    const tr = custom({ notAuthor: true, children: true });
    const parent = t({ authorId: 'm-vasiliev' });
    const db = altaDb([p], [parent, mkTask('LOG-102', { parent: 'LOG-101' })]);
    expect(trCheck(db, p, parent, 'm-vasiliev', tr)).toEqual({
      ok: false,
      why: 'Автор задачи не может выполнить этот переход',
    });
    expect(trCheck(db, p, parent, 'm-kotova', tr)).toEqual({
      ok: false,
      why: 'Сначала завершите подзадачи: LOG-102',
    });
  });
});
