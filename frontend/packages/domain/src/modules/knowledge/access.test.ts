// Доступ к «Базе знаний» (knowledge.js 14.10:71–181): цепочка организация → пространство → родители →
// узел → функция сотрудника. Отличия от эталона: PD-53 (объектные роли не дают глаголов области),
// Q-W0.11-2 (единый `entryHas` ядра), PD-60 (истёкшее назначение на ветку не действует).
import { describe, expect, it } from 'vitest';
import type { Assignment } from '../../core/types/index.ts';
import {
  isKbOwner,
  kbAccess,
  kbEntryHas,
  kbEntryPeople,
  kbEntryReach,
  kbLeads,
  kbReach,
  kbSpaceGrant,
  kbSpaceMy,
} from './access.ts';
import { kbDb, node, space, T, type KbDb } from './fixture.test-util.ts';
import { kbImpact, kbMoveImpact } from './impact.ts';
import { areaLabel, entryLabel, unitName } from './labels.ts';
import type { KbOpts } from './types.ts';
import { kbView } from './view.ts';

const acc = (db: KbDb, mid: string, id: string, today?: string) =>
  kbAccess(db, mid, node(db, id), today ? { today } : T);
const ve = (db: KbDb, mid: string, id: string): [boolean, boolean] => {
  const a = acc(db, mid, id);
  return [a.view, a.edit];
};

describe('подписи: unitName, areaLabel, entryLabel', () => {
  const db = kbDb();
  it('подразделение и область пространства', () => {
    expect(unitName(db, 'f-msk-sever')).toBe('Север Логистик');
    expect(unitName(db, 'нет')).toBe('вся организация');
    expect(unitName(db, null)).toBe('вся организация');
    expect(areaLabel(db, { unit: 'f-msk-sever' })).toBe('фирма «Север Логистик»');
    expect(areaLabel(db, { unit: 'r-msk' })).toBe('регион «Москва»');
    expect(areaLabel(db, { unit: null })).toBe('вся организация');
    expect(areaLabel(db, {})).toBe('вся организация');
  });

  it.each([
    [{ who: 'member', ref: 'm-kotova' }, 'Марина Котова'],
    [{ who: 'member', ref: 'нет' }, 'Сотрудник'],
    [{ who: 'group', ref: 'g-drv' }, 'Группа «Водители Север»'],
    [{ who: 'group', ref: 'g-x' }, 'Группа «g-x»'],
    [{ who: 'role', ref: 'r-driver', unit: 'f-msk-sever' }, 'Роль «Водитель» · «Север Логистик»'],
    [{ who: 'role', ref: 'r-driver' }, 'Роль «Водитель»'],
    [{ who: 'role', ref: 'r-kb-editor', unit: 'f-msk-sever' }, 'Роль «Редактор» в пространстве'],
    [{ who: 'role', ref: 'r-x' }, 'Роль «r-x»'],
    [
      { who: 'relation', ref: 'foreman', obj: 'obj-42' },
      'Прораб объекта «ЖК Речной · квартира 42»',
    ],
    [{ who: 'relation', ref: 'foreman', obj: 'obj-0' }, 'Прораб объекта'],
    [{ who: 'all' }, '—'],
  ] as const)('%j → %s', (e, label) => {
    expect(entryLabel(db, e)).toBe(label);
  });
});

describe('записи доступа в пространстве', () => {
  const db = kbDb();
  const log = space(db, 'sp-log');
  it('роль пространства действует только в своём пространстве', () => {
    const ed = { who: 'role', ref: 'r-kb-editor' } as const;
    expect(kbEntryHas(db, 'm-kotelnikova', ed, log)).toBe(true);
    expect(kbEntryHas(db, 'm-kotelnikova', ed, space(db, 'sp-gen'))).toBe(false);
    expect(kbEntryHas(db, 'm-kotova', ed, space(db, 'sp-gen'))).toBe(true);
  });

  it('прораб объекта — по связи; заблокированный не входит (Q-W0.11-2)', () => {
    const rel = { who: 'relation', ref: 'foreman', obj: 'obj-42' } as const;
    expect(kbEntryPeople(db, rel, log).map((m) => m.id)).toEqual(['m-sokolov']);
    const drv = { who: 'group', ref: 'g-drv' } as const;
    expect(kbEntryHas(db, 'm-gromov', drv, log)).toBe(false);
    expect(kbEntryPeople(db, drv, log).map((m) => m.id)).toEqual(['m-vasiliev']);
  });
});

describe('kbSpaceGrant, kbLeads, isKbOwner', () => {
  it('старшая роль пространства участника; нет — null', () => {
    const db = kbDb({
      extra: [
        {
          id: 'x1',
          member: 'm-kotova',
          role: 'r-kb-reader',
          scope: { type: 'space', id: 'sp-gen' },
        },
        { id: 'x2', member: 'm-kotova', role: 'r-kb-lead', scope: { type: 'space', id: 'sp-gen' } },
      ],
    });
    expect(kbSpaceGrant(db, 'm-kotova', space(db, 'sp-log'), T)?.id).toBe('akb-1');
    expect(kbSpaceGrant(db, 'm-kotova', space(db, 'sp-gen'), T)?.id).toBe('x2');
    expect(kbSpaceGrant(db, 'm-vasiliev', space(db, 'sp-log'), T)).toBeNull();
  });

  it('истёкшее назначение в пространстве не действует (PD-60)', () => {
    const db = kbDb({
      extra: [
        {
          id: 'x1',
          member: 'm-sokolov',
          role: 'r-kb-lead',
          scope: { type: 'space', id: 'sp-own' },
          until: '30.09.2026',
        },
      ],
    });
    const own = space(db, 'sp-own');
    expect(kbSpaceGrant(db, 'm-sokolov', own, { today: '30.09.2026' })?.id).toBe('x1');
    expect(kbSpaceGrant(db, 'm-sokolov', own, { today: '01.10.2026' })).toBeNull();
    expect(kbLeads(db, own, { today: '30.09.2026' }).map((m) => m.id)).toEqual(['m-sokolov']);
    expect(kbLeads(db, own, { today: '01.10.2026' })).toEqual([]);
  });

  it('PD-60: без даты часов домена функции доступа падают, а не считают назначение бессрочным', () => {
    const db = kbDb({
      extra: [
        {
          id: 'x1',
          member: 'm-sokolov',
          role: 'r-kb-lead',
          scope: { type: 'space', id: 'sp-own' },
          until: '30.09.2026',
        },
      ],
    });
    const own = space(db, 'sp-own');
    const n = node(db, 'gen-1');
    const msg = 'База знаний: нет даты часов домена (KbOpts.today) для сроков назначений, PD-60';
    const none = {} as unknown as KbOpts;
    const calls: [string, () => unknown][] = [
      ['kbSpaceGrant', () => kbSpaceGrant(db, 'm-sokolov', own, none)],
      ['kbLeads', () => kbLeads(db, own, none)],
      ['kbAccess', () => kbAccess(db, 'm-sokolov', n, none)],
      ['kbAccess без узла', () => kbAccess(db, 'm-sokolov', undefined, none)],
      ['kbReach', () => kbReach(db, 'm-sokolov', n, none)],
      ['kbEntryReach', () => kbEntryReach(db, { who: 'all' }, own, n, none)],
      ['kbSpaceMy', () => kbSpaceMy(db, 'm-sokolov', own, none)],
      ['kbImpact', () => kbImpact(db, 'нет', { mode: 'inherit', list: [] }, none)],
      ['kbMoveImpact', () => kbMoveImpact(db, 'нет', null, none)],
      ['kbView', () => kbView(db, 'm-sokolov', db.knowledge, none)],
    ];
    for (const [name, call] of calls) expect(call, name).toThrow(msg);
    // @ts-expect-error — дата обязательна и на уровне типов
    expect(() => kbAccess(db, 'm-sokolov', n)).toThrow(msg);
  });

  it('руководители пространства и владелец бизнеса', () => {
    const db = kbDb();
    expect(kbLeads(db, space(db, 'sp-log'), T).map((m) => m.name)).toEqual(['Марина Котова']);
    expect(kbLeads(db, space(db, 'sp-gen'), T)).toEqual([]);
    expect(isKbOwner(db, 'm-owner')).toBe(true);
    expect(isKbOwner(db, 'm-kotova')).toBe(false);
  });
});

describe('kbAccess: просмотр и правка (участник × узел)', () => {
  const db = kbDb();
  it.each([
    // владелец бизнеса — всё
    ['m-owner', 'own-1', true, true],
    ['m-owner', 'arch', true, true],
    // водитель: ограниченное пространство своей фирмы — чтение; папка водителей — по роли в списке
    ['m-vasiliev', 'log-home', true, false],
    ['m-vasiliev', 'kb-1', true, false],
    ['m-vasiliev', 'kb-1a', true, false],
    ['m-vasiliev', 'f-drv', true, false],
    ['m-vasiliev', 'drv-1', true, false],
    ['m-vasiliev', 'drv-4', true, false],
    ['m-vasiliev', 'fin', false, false],
    ['m-vasiliev', 'fin-1', false, false],
    ['m-vasiliev', 'arch', false, false],
    ['m-vasiliev', 'gen-1', true, false],
    ['m-vasiliev', 'gen-3', true, true],
    ['m-vasiliev', 'own-1', false, false],
    ['m-vasiliev', 'obj', false, false],
    // руководитель пространства «Логистика» и редактор «Общего»
    ['m-kotova', 'fin', true, true],
    ['m-kotova', 'drv-4', true, true],
    ['m-kotova', 'arch', true, true],
    ['m-kotova', 'gen-1', true, true],
    ['m-kotova', 'gen-3', true, false],
    ['m-kotova', 'obj', false, false],
    ['m-kotova', 'own-1', false, false],
    // редактор «Логистики»: финансовая страница в списке только на чтение
    ['m-kotelnikova', 'fin', true, false],
    ['m-kotelnikova', 'fin-1', true, false],
    ['m-kotelnikova', 'kb-1', true, true],
    ['m-kotelnikova', 'drv-1', true, true],
    ['m-kotelnikova', 'drv-4', true, false],
    // прораб: раздел объекта по связи, «Гарантия» — только редакторам
    ['m-sokolov', 'obj', true, false],
    ['m-sokolov', 'o-1', true, false],
    ['m-sokolov', 'o-2', true, true],
    ['m-sokolov', 'o-5', false, false],
    ['m-sokolov', 'log-home', false, false],
    // заблокированный — ничего
    ['m-gromov', 'gen-3', false, false],
  ] as const)('%s → %s: view %s, edit %s', (mid, id, view, edit) => {
    expect(ve(db, mid, id)).toEqual([view, edit]);
  });

  it('нет узла, участника или пространства — нет доступа', () => {
    expect(kbAccess(db, 'm-owner', undefined, T).view).toBe(false);
    expect(kbAccess(db, 'm-нет', node(db, 'gen-1'), T).view).toBe(false);
    expect(kbAccess(db, 'm-owner', { ...node(db, 'gen-1'), space: 'sp-нет' }, T).view).toBe(false);
    expect(kbAccess({ ...db, knowledge: undefined }, 'm-owner', node(db, 'gen-1'), T).view).toBe(
      false,
    );
  });
});

describe('kbAccess: цепочка причин', () => {
  const db = kbDb();
  it('владелец бизнеса', () => {
    expect(acc(db, 'm-owner', 'own-1')).toEqual({
      view: true,
      edit: true,
      lead: true,
      owner: true,
      create: true,
      fn: false,
      chain: [
        { k: 'ok', t: 'Организация', d: 'Активный сотрудник' },
        { k: 'ok', t: 'Владелец бизнеса', d: 'Видит и правит всё' },
      ],
    });
  });

  it('заблокированный и приглашённый', () => {
    expect(acc(db, 'm-gromov', 'gen-1').chain).toEqual([
      { k: 'no', t: 'Организация', d: 'Сотрудник заблокирован, доступ не действует' },
    ]);
    expect(acc(db, 'm-petrova', 'gen-1').chain).toEqual([
      {
        k: 'wait',
        t: 'Организация',
        d: 'Приглашение не принято: доступ начнёт действовать после входа',
      },
      {
        k: 'no',
        t: 'Пространство «Общее»',
        d: 'Нет роли в области «вся организация», не участник пространства',
      },
    ]);
  });

  it('читатель по уровню пространства и наследование', () => {
    const a = acc(db, 'm-vasiliev', 'kb-1');
    expect(a).toMatchObject({ view: true, edit: false, create: false, lead: false, fn: false });
    expect(a.chain).toEqual([
      { k: 'ok', t: 'Организация', d: 'Активный сотрудник' },
      {
        k: 'ok',
        t: 'Пространство «Логистика»',
        d: 'Читатель по уровню «Ограниченное»: роль «Водитель»',
      },
      { k: 'inh', t: '«Регламент приёмки смены»', d: 'Доступ как у родителя' },
    ]);
  });

  it('свой доступ узлов: «Только выбранные» и «Читают все, правят выбранные»', () => {
    expect(acc(db, 'm-vasiliev', 'drv-4').chain.slice(2)).toEqual([
      { k: 'ok', t: '«Водителям»', d: 'В списке: Роль «Водитель» · «Север Логистик» — читает' },
      { k: 'ok', t: '«Маршруты»', d: 'Читают все, правят выбранные' },
    ]);
    expect(acc(db, 'm-vasiliev', 'gen-3').chain.slice(2)).toEqual([
      { k: 'ok', t: '«Дежурства»', d: 'Читают все, правят выбранные: Группа «Водители Север»' },
    ]);
    expect(acc(db, 'm-kotova', 'o-5').chain[1]).toEqual({
      k: 'no',
      t: 'Пространство «Ремонт и стройка»',
      d: 'Нет роли в области «вся организация», не участник пространства',
    });
    expect(acc(db, 'm-kotova', 'fin').chain.slice(1)).toEqual([
      {
        k: 'ok',
        t: 'Пространство «Логистика»',
        d: 'Руководитель пространства · назначение в пространстве',
      },
      { k: 'ok', t: '«Тарифы и начисления»', d: 'В списке: Марина Котова — читает' },
    ]);
  });

  it('руководитель видит «Только выбранные» без записи в списке', () => {
    const db2 = kbDb({
      extra: [
        {
          id: 'x1',
          member: 'm-sokolov',
          role: 'r-kb-lead',
          scope: { type: 'space', id: 'sp-rep' },
        },
      ],
    });
    const a = acc(db2, 'm-sokolov', 'o-5');
    expect(a).toMatchObject({ view: true, edit: true, lead: true, create: true });
    expect(a.chain.slice(2)).toEqual([
      {
        k: 'ok',
        t: '«ЖК Речной · квартира 42»',
        d: 'В списке: Прораб объекта «ЖК Речной · квартира 42» — читает',
      },
      { k: 'ok', t: '«Гарантия»', d: 'Свой доступ; руководитель пространства видит всё' },
    ]);
  });

  it('нет в списке «Только выбранные»; закрытое пространство', () => {
    expect(acc(db, 'm-sokolov', 'o-5').chain.slice(-1)).toEqual([
      { k: 'no', t: '«Гарантия»', d: 'Свой доступ «Только выбранные»: нет в списке' },
    ]);
    expect(acc(db, 'm-vasiliev', 'own-1').chain.slice(-1)).toEqual([
      {
        k: 'no',
        t: 'Пространство «Руководство»',
        d: 'Закрытое: только участники и владелец бизнеса',
      },
    ]);
  });

  it('водитель и финансовые страницы — закрыты всегда, fn', () => {
    const db2 = kbDb({
      extra: [
        {
          id: 'x1',
          member: 'm-akhmedov',
          role: 'r-kb-lead',
          scope: { type: 'space', id: 'sp-log' },
        },
      ],
    });
    const a = acc(db2, 'm-akhmedov', 'fin-1');
    expect(a).toMatchObject({ view: false, edit: false, fn: true });
    expect(a.chain.slice(-1)).toEqual([
      { k: 'no', t: 'Функция «Водитель»', d: 'Финансовые страницы закрыты всегда' },
    ]);
    expect(acc(db, 'm-vasiliev', 'fin')).toMatchObject({ view: false, fn: true });
  });

  it('руководитель — создание; читатель — нет; архив — только с правкой', () => {
    expect(acc(db, 'm-kotova', 'kb-1')).toMatchObject({ lead: true, create: true });
    expect(acc(db, 'm-kotelnikova', 'kb-1')).toMatchObject({ lead: false, create: true });
    expect(acc(db, 'm-kotelnikova', 'arch')).toMatchObject({ view: true, edit: true });
    expect(acc(db, 'm-vasiliev', 'arch')).toMatchObject({ view: false, create: false });
  });
});

describe('kbAccess: роль с областью страницы (ветка) и её срок', () => {
  const extra: Assignment[] = [
    {
      id: 'akb-9',
      member: 'm-morozova',
      role: 'r-kb-reader',
      scope: { type: 'page', id: 'kb-1' },
      until: '31.10.2026',
      via: 'запрос доступа',
    },
  ];
  const db = kbDb({ extra });

  it('ветка открывает узел и подстраницы, но не пространство', () => {
    expect(ve(db, 'm-morozova', 'kb-1')).toEqual([true, false]);
    expect(ve(db, 'm-morozova', 'kb-1a')).toEqual([true, false]);
    expect(ve(db, 'm-morozova', 'log-home')).toEqual([false, false]);
    expect(acc(db, 'm-morozova', 'kb-1a').chain).toEqual([
      { k: 'ok', t: 'Организация', d: 'Активный сотрудник' },
      {
        k: 'ok',
        t: 'Ветка «Регламент приёмки смены»',
        d: '«Читатель» с областью этой страницы до 31.10.2026',
      },
      { k: 'inh', t: '«Чек-лист приёмки»', d: 'Доступ как у родителя' },
    ]);
  });

  it('срок истёк — назначение не действует (PD-60); в срок — действует', () => {
    expect(acc(db, 'm-morozova', 'kb-1', '31.10.2026').view).toBe(true);
    expect(acc(db, 'm-morozova', 'kb-1', '01.11.2026').view).toBe(false);
  });

  it('назначение на удалённую роль ничего не даёт', () => {
    const db2 = kbDb({
      extra: [
        { id: 'x', member: 'm-morozova', role: 'r-нет', scope: { type: 'page', id: 'kb-1' } },
      ],
    });
    expect(ve(db2, 'm-morozova', 'kb-1')).toEqual([false, false]);
  });
});

describe('kbAccess: роли области', () => {
  it('объектная роль с правами БЗ не даёт глаголов области (PD-53)', () => {
    const db = kbDb({
      extra: [
        { id: 'x1', member: 'm-sokolov', role: 'r-kbx', scope: { type: 'project', id: 'fleet' } },
      ],
    });
    db.roles.push({
      id: 'r-kbx',
      name: 'Проектная с БЗ',
      kind: 'custom',
      project: true,
      actions: { knowledge: ['view', 'create', 'edit'] },
      finance: { read: false, manage: false },
    });
    expect(ve(db, 'm-sokolov', 'gen-1')).toEqual([true, false]);
    db.assignments = db.assignments.filter((a) => a.id !== 'a4');
    expect(ve(db, 'm-sokolov', 'gen-1')).toEqual([false, false]);
  });

  it('открытое пространство: роль области с созданием правит свои страницы', () => {
    const db = kbDb({
      extra: [
        {
          id: 'x1',
          member: 'm-akhmedov',
          role: 'r-writer',
          scope: { type: 'firm', id: 'f-msk-sever' },
        },
      ],
    });
    db.roles.push({
      id: 'r-writer',
      name: 'Автор регламентов',
      kind: 'custom',
      actions: { knowledge: ['view', 'create'] },
      finance: { read: false, manage: false },
    });
    expect(acc(db, 'm-akhmedov', 'gen-2')).toMatchObject({ view: true, edit: true, create: true });
    expect(acc(db, 'm-akhmedov', 'gen-1')).toMatchObject({ view: true, edit: false, create: true });
    expect(acc(db, 'm-akhmedov', 'gen-3')).toMatchObject({
      view: true,
      edit: false,
      create: false,
    });
    // ограниченное пространство: роль области даёт только чтение
    expect(acc(db, 'm-akhmedov', 'log-home')).toMatchObject({
      view: true,
      edit: false,
      create: false,
    });
  });

  it('роль другой области в пространство фирмы не пускает', () => {
    const db = kbDb({
      extra: [
        {
          id: 'x1',
          member: 'm-ilyin',
          role: 'r-manager',
          scope: { type: 'firm', id: 'f-msk-yug' },
        },
      ],
    });
    expect(ve(db, 'm-ilyin', 'log-home')).toEqual([false, false]);
    db.assignments.push({
      id: 'x2',
      member: 'm-ilyin',
      role: 'r-manager',
      scope: { type: 'region', id: 'r-msk' },
    });
    expect(ve(db, 'm-ilyin', 'log-home')).toEqual([true, false]);
  });

  it('пространство без уровня доступа (до миграции) — закрыто', () => {
    const db = kbDb();
    const sp = space(db, 'sp-gen');
    delete sp.access;
    expect(ve(db, 'm-vasiliev', 'gen-1')).toEqual([false, false]);
    expect(acc(db, 'm-vasiliev', 'gen-1').chain.slice(-1)).toEqual([
      { k: 'no', t: 'Пространство «Общее»', d: 'Закрытое: только участники и владелец бизнеса' },
    ]);
  });
});

describe('kbReach и kbEntryReach: пропустят ли уровни выше', () => {
  const db = kbDb();
  it.each([
    ['m-gromov', 'gen-1', { ok: false, why: 'сотрудник заблокирован' }],
    ['m-owner', 'own-1', { ok: true }],
    [
      'm-vasiliev',
      'fin-1',
      { ok: false, why: 'функция «Водитель» не открывает финансовые страницы' },
    ],
    ['m-vasiliev', 'kb-1a', { ok: true }],
    ['m-sokolov', 'o-1', { ok: true }],
    ['m-kotova', 'o-1', { ok: false, why: 'не видит родителя «ЖК Речной · квартира 42»' }],
    ['m-vasiliev', 'gen-1', { ok: true }],
    ['m-vasiliev', 'own-1', { ok: false, why: 'не участник закрытого пространства' }],
    [
      'm-kotova',
      'obj',
      { ok: false, why: 'нет роли в области «вся организация» и не участник пространства' },
    ],
  ] as const)('%s → %s', (mid, id, r) => {
    expect(kbReach(db, mid, node(db, id), T)).toEqual(r);
  });

  it('нет участника или узла', () => {
    expect(kbReach(db, 'm-нет', node(db, 'gen-1'), T)).toEqual({
      ok: false,
      why: 'сотрудник заблокирован',
    });
    expect(kbReach(db, 'm-owner', undefined, T).ok).toBe(false);
  });

  it('родитель удалён — проверяется пространство', () => {
    const n = { ...node(db, 'gen-1'), parent: 'нет' };
    expect(kbReach(db, 'm-vasiliev', n, T)).toEqual({ ok: true });
  });

  it('кого из подходящих под запись пропустят уровни выше', () => {
    const r = kbEntryReach(
      db,
      { who: 'role', ref: 'r-driver' },
      space(db, 'sp-log'),
      node(db, 'fin-1'),
      T,
    );
    expect(r.ppl.map((m) => m.id)).toEqual(['m-vasiliev']);
    expect(r.ok).toEqual([]);
    expect(r.no).toEqual([
      { m: r.ppl[0], why: 'функция «Водитель» не открывает финансовые страницы' },
    ]);
    const g = kbEntryReach(
      db,
      { who: 'group', ref: 'g-disp' },
      space(db, 'sp-log'),
      node(db, 'kb-1'),
      T,
    );
    expect(g.ok.map((x) => x.m.id)).toEqual(['m-kotova']);
    expect(g.no.map((x) => [x.m.id, x.why])).toEqual([
      ['m-petrova', 'не видит родителя «Регламенты»'],
    ]);
  });
});

describe('kbSpaceMy: мои права в пространстве', () => {
  const db = kbDb();
  it.each([
    [
      'm-owner',
      'sp-own',
      { owner: true, lead: true, view: true, create: true, edit: true, role: 'Владелец бизнеса' },
    ],
    [
      'm-vasiliev',
      'sp-log',
      {
        owner: false,
        lead: false,
        view: true,
        create: false,
        edit: false,
        role: 'Читатель по уровню «Ограниченное»',
      },
    ],
    [
      'm-kotova',
      'sp-log',
      {
        owner: false,
        lead: true,
        view: true,
        create: true,
        edit: true,
        role: 'Руководитель пространства',
      },
    ],
    [
      'm-kotelnikova',
      'sp-log',
      { owner: false, lead: false, view: true, create: true, edit: true, role: 'Редактор' },
    ],
    [
      'm-kotova',
      'sp-rep',
      { owner: false, lead: false, view: false, create: false, edit: false, role: '' },
    ],
  ] as const)('%s в %s', (mid, sp, my) => {
    expect(kbSpaceMy(db, mid, space(db, sp), T)).toEqual(my);
  });
});
