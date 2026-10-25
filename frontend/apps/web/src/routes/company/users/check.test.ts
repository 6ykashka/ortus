// W1.23 · «Проверка доступа» на explainAccess (S1-14): действие эталона → ключ каталога (accessVM :3218–3247,
// ACTIONS :2339), решение сервера → причина эталона (models.js REASON), основание, рабочее место.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { CHECK_ACTIONS, checkObjects, reasonOf, resultOf, workplaceOf } from './check.ts';
import { unitsOf } from './model.ts';

type S = components['schemas'];
type X = S['AccessExplanation'];

const units = unitsOf([
  { id: 'r-msk', name: 'Москва', kind: 'region', parentId: null, status: 'active', revision: 1 },
  {
    id: 'f-sever',
    name: 'Север Логистик',
    kind: 'company',
    parentId: 'r-msk',
    status: 'active',
    revision: 1,
  },
  {
    id: 'f-yug',
    name: 'Юг Транс',
    kind: 'company',
    parentId: 'r-msk',
    status: 'active',
    revision: 1,
  },
]);

const base: X = {
  memberId: 'm',
  permission: 'fleet.vehicles.read',
  allowed: false,
  decisiveCheck: 'permission',
  checks: [],
  grants: [],
  hiddenGrants: false,
  policyVersion: '1',
};

const trace = (o: Partial<S['AccessGrantTrace']>): S['AccessGrantTrace'] => ({
  roleId: 'r',
  roleName: 'Водитель',
  via: 'group',
  groupId: 'g-drv',
  scope: { kind: 'org_unit', resourceIds: ['f-sever'], includeDescendants: true },
  matches: true,
  ...o,
});

const groups = new Map([['g-drv', 'Водители Север']]);

const first = <T>(xs: readonly T[], i: number): T => {
  const x = xs[i];
  if (x === undefined) throw new Error(`нет элемента ${i}`);
  return x;
};

describe('действия «Проверки доступа»', () => {
  it('шесть действий эталона с ключами каталога', () => {
    expect(CHECK_ACTIONS.map((a) => [a.label, a.permission])).toEqual([
      ['Просматривать машины', 'fleet.vehicles.read'],
      ['Бронировать машину', 'fleet.reservations.create'],
      ['Принимать смены', 'fleet.trips.review'],
      ['Видеть начисления', 'fleet.earnings.read'],
      ['Открыть расписание SPA', 'spa.appointments.read'],
      ['Отмечать работы на объекте', 'repairs.work_logs.submit'],
    ]);
  });
});

describe('причина отказа по решению сервера', () => {
  it('модуль не подключён, только чтение, водитель, объект, нет права', () => {
    expect(reasonOf({ ...base, allowed: true })).toBeNull();
    expect(
      reasonOf({ ...base, decisiveCheck: 'module-installation', denyCode: 'module_not_installed' }),
    ).toBe('module_off');
    expect(
      reasonOf({ ...base, decisiveCheck: 'module-installation', denyCode: 'module_read_only' }),
    ).toBe('module_readonly');
    expect(reasonOf({ ...base, decisiveCheck: 'separation-of-duties' })).toBe('driver_block');
    expect(reasonOf({ ...base, decisiveCheck: 'resource-scope' })).toBe('no_scope');
    expect(
      reasonOf({ ...base, grants: [trace({ matches: false, mismatch: 'out_of_scope' })] }),
    ).toBe('no_scope');
    expect(reasonOf(base)).toBe('no_permission');
  });
});

describe('результат', () => {
  const ctx = {
    memberName: 'Илья Васильев',
    action: first(CHECK_ACTIONS, 0),
    objectLabel: 'Москва / Юг Транс',
    units,
    groups,
  };

  it('разрешено: основание — роль, область, группа', () => {
    const r = resultOf({ ...base, allowed: true, grants: [trace({})] }, ctx);
    expect(r).toMatchObject({
      tone: 'ok',
      chip: 'Разрешено',
      icon: 'check_circle',
      title: 'Илья Васильев может: просматривать машины',
      text: 'Основание · роль «Водитель» · Москва / Север Логистик · через группу «Водители Север».',
    });
  });

  it('разрешено без видимого назначения (начисления) — «Основание: финансовое разрешение в области.»', () => {
    const r = resultOf({ ...base, allowed: true }, { ...ctx, action: first(CHECK_ACTIONS, 3) });
    expect(r.text).toBe('Основание: финансовое разрешение в области.');
  });

  it('отказы: текст REASON и добавки «Объект: …», «Модуль: …»', () => {
    const scoped = resultOf(
      { ...base, grants: [trace({ matches: false, mismatch: 'out_of_scope' })] },
      ctx,
    );
    expect(scoped).toMatchObject({
      tone: 'warn',
      chip: 'Нет доступа к объекту',
      title: 'Илья Васильев не может: просматривать машины',
      text: 'Право есть, но объект находится вне области назначения. Объект: Москва / Юг Транс.',
    });
    const off = resultOf(
      { ...base, decisiveCheck: 'module-installation', denyCode: 'module_not_installed' },
      ctx,
    );
    expect(off).toMatchObject({
      tone: 'neutral',
      chip: 'Модуль не подключён',
      icon: 'extension_off',
      text: 'Модуль не подключён организацией. Подключить его может владелец бизнеса. Модуль: Логистика.',
    });
    const drv = resultOf({ ...base, decisiveCheck: 'separation-of-duties' }, ctx);
    expect(drv).toMatchObject({
      tone: 'danger',
      chip: 'Запрещено функцией «Водитель»',
      icon: 'block',
    });
  });
});

describe('рабочее место сотрудника', () => {
  it('модули с правом просмотра, приёмка, начисления', () => {
    expect(
      workplaceOf({ fleet: true, spa: false, repairs: false, review: true, earnings: false }),
    ).toEqual([
      { icon: 'local_shipping', label: 'Логистика' },
      { icon: 'fact_check', label: 'Приёмка смен' },
    ]);
    expect(
      workplaceOf({ fleet: false, spa: false, repairs: false, review: false, earnings: false }),
    ).toEqual([]);
  });
});

// W4.85 · Q-W1.23-8: «Объект» проверки — машины и рейсы логистики (OBJECTS эталона :2344); подразделение объекта —
// у самой машины и рейса, запрос explainAccess идёт с его orgUnitId.
describe('объекты «Проверки доступа»: машины и рейсы', () => {
  const vehicle = (id: string, displayName: string, orgUnitId: string) =>
    ({ id, displayName, orgUnitId }) as S['Vehicle'];
  const trip = (id: string, number: string, orgUnitId: string) =>
    ({ id, number, orgUnitId }) as S['TripPlan'];

  it('машина и рейс — «{название} · {регион / фирма}» с подразделением объекта', () => {
    const objects = checkObjects(
      [vehicle('v1', 'ГАЗель Next', 'f-sever'), vehicle('v5', 'Isuzu Elf', 'f-yug')],
      [trip('t1', 'Р-208', 'f-sever')],
      units,
    );
    expect(objects.map((o) => [o.label, o.orgUnitId])).toEqual([
      ['ГАЗель Next · Москва / Север Логистик', 'f-sever'],
      ['Isuzu Elf · Москва / Юг Транс', 'f-yug'],
      ['Рейс Р-208 · Москва / Север Логистик', 'f-sever'],
    ]);
    expect(new Set(objects.map((o) => o.value)).size).toBe(3);
  });

  it('подразделение вне области вошедшего — подпись без него; без машин и рейсов список пуст', () => {
    expect(checkObjects([vehicle('v9', 'КамАЗ', 'f-gone')], [], units)[0]?.label).toBe('КамАЗ');
    expect(checkObjects([], [], units)).toEqual([]);
  });
});
