// W1.23 · Модель экрана «Пользователи и роли» над DTO контракта 0.4.0-stage1: подписи областей (models.js
// scopeLabel :258–275), назначения участника (usersVM :3146–3155), места (api.js :56–58), вид роли (:3157–3160).
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  grantLine,
  grantsOf,
  groupMembersLine,
  isDriver,
  memberChip,
  memberSubtitle,
  noRoleCount,
  peopleNote,
  roleKind,
  roleMeta,
  scopeLabel,
  scopeOf,
  seatsOf,
  unitsOf,
  untilDate,
  untilInstant,
} from './model.ts';

type S = components['schemas'];

const unit = (id: string, name: string, kind: S['OrgUnit']['kind'], parentId: string | null) =>
  ({ id, name, kind, parentId, status: 'active', revision: 1 }) as S['OrgUnit'];

const UNITS = [
  unit('r-msk', 'Москва', 'region', null),
  unit('r-smr', 'Самара', 'region', null),
  unit('f-sever', 'Север Логистик', 'company', 'r-msk'),
  unit('f-yug', 'Юг Транс', 'company', 'r-msk'),
  unit('f-volga', 'Волга Логистик', 'company', 'r-smr'),
];

const scope = (kind: S['Scope']['kind'], ids: string[] = []): S['Scope'] => ({
  kind,
  resourceIds: ids,
  includeDescendants: kind === 'org_unit',
});

const member = (id: string, o: Partial<S['Member']> = {}): S['Member'] => ({
  id,
  displayName: id,
  status: 'active',
  orgUnitIds: [],
  revision: 1,
  workProfiles: [],
  userId: `u-${id}`,
  ...o,
});

const role = (id: string, name: string, o: Partial<S['Role']> = {}): S['Role'] => ({
  id,
  name,
  description: name,
  builtIn: false,
  permissions: [],
  revision: 1,
  ...o,
});

const assignment = (
  id: string,
  principalId: string,
  roleId: string,
  sc: S['Scope'],
  o: Partial<S['Assignment']> = {},
): S['Assignment'] => ({
  id,
  principalType: 'member',
  principalId,
  roleId,
  scope: sc,
  state: 'active',
  ...o,
});

describe('подразделения и подписи областей', () => {
  const u = unitsOf(UNITS);

  it('регионы и фирмы региона в порядке API, первая фирма', () => {
    expect(u.regions.map((r) => r.name)).toEqual(['Москва', 'Самара']);
    expect(u.firmsOf('r-smr').map((f) => f.name)).toEqual(['Волга Логистик']);
    expect(u.firstFirm()?.name).toBe('Север Логистик');
  });

  it('фирма по умолчанию — домашняя фирма вошедшего, а не первая в порядке API (стенд, Q-23)', () => {
    // Go-стенд отдаёт подразделения не в порядке прототипа: «Восток Карго» раньше «Север Логистик».
    const api = [UNITS[0], UNITS[1], UNITS[3], UNITS[2], UNITS[4]] as S['OrgUnit'][];
    expect(unitsOf(api, ['f-sever']).firstFirm()?.name).toBe('Север Логистик');
    expect(unitsOf(api, ['r-msk', 'f-volga']).firstFirm()?.name).toBe('Волга Логистик');
    expect(unitsOf(api, ['r-msk']).firstFirm()?.name).toBe('Юг Транс');
    expect(unitsOf(api, ['gone']).firstFirm()?.name).toBe('Юг Транс');
    expect(unitsOf(api).firstFirm()?.name).toBe('Юг Транс');
  });

  it('организация, регион, фирма, «своё», проект', () => {
    expect(scopeLabel(scope('tenant'), u)).toBe('Вся организация');
    expect(scopeLabel(scope('org_unit', ['r-msk']), u)).toBe('Регион Москва');
    expect(scopeLabel(scope('org_unit', ['f-volga']), u)).toBe('Самара / Волга Логистик');
    expect(scopeLabel(scope('self'), u)).toBe('Только назначенное лично');
    expect(scopeLabel(scope('project', ['p1']), u)).toBe('Проект');
    expect(scopeLabel(scope('org_unit', ['x']), u)).toBe('Область не выбрана');
  });

  it('проект с известным именем — «Проект «{имя}»» (W4.85); неизвестный (нет права на проекты) — «Проект»', () => {
    const named = unitsOf(UNITS, [], new Map([['p1', 'Логистика · Север']]));
    expect(scopeLabel(scope('project', ['p1']), named)).toBe('Проект «Логистика · Север»');
    expect(scopeLabel(scope('project', ['p2']), named)).toBe('Проект');
    expect(scopeLabel(scope('project', ['p1']), u)).toBe('Проект');
  });

  it('вид области этапов 4–7 или незнакомый — «Особая область» (ADR-0014 п. 7, контракт 0.7.0-stage4)', () => {
    const later = (kind: string) => ({ ...scope('self'), kind }) as unknown as S['Scope'];
    expect(scopeLabel(later('space'), u)).toBe('Особая область');
    expect(scopeLabel(later('repair_project'), u)).toBe('Особая область');
    expect(scopeLabel(later('unknown_kind'), u)).toBe('Особая область');
  });

  it('область из выбора диалога: организация, регион, фирма', () => {
    expect(scopeOf('tenant', 'r-msk', 'f-sever')).toEqual({
      kind: 'tenant',
      resourceIds: [],
      includeDescendants: true,
    });
    expect(scopeOf('region', 'r-msk', 'f-sever')).toEqual({
      kind: 'org_unit',
      resourceIds: ['r-msk'],
      includeDescendants: true,
    });
    expect(scopeOf('firm', 'r-msk', 'f-sever').resourceIds).toEqual(['f-sever']);
  });

  it('«Действует до»: конец дня по Москве и обратно', () => {
    expect(untilInstant('2026-10-31')).toBe('2026-10-31T21:00:00Z');
    expect(untilDate('2026-10-31T21:00:00Z')).toBe('31.10.2026');
  });
});

describe('назначения участника', () => {
  const u = unitsOf(UNITS);
  const roles = [
    role('r-drv', 'Водитель'),
    role('r-exec', 'Исполнитель'),
    role('r-own', 'Владелец бизнеса'),
  ];
  const groups = [
    { id: 'g-drv', name: 'Водители Север', memberIds: ['m-v'] } as S['Group'],
    { id: 'g-disp', name: 'Диспетчеры Север', memberIds: ['m-k'] } as S['Group'],
  ];
  const list = [
    assignment('a1', 'm-z', 'r-own', scope('tenant')),
    assignment('ap2', 'g-drv', 'r-exec', scope('project', ['p']), { principalType: 'group' }),
    assignment('a2', 'g-drv', 'r-drv', scope('org_unit', ['f-sever']), { principalType: 'group' }),
    assignment('a9', 'm-v', 'r-drv', scope('self'), { state: 'expired' }),
    assignment('a10', 'm-k', 'r-drv', scope('org_unit', ['f-yug']), {
      validUntil: '2026-10-31T21:00:00Z',
    }),
  ];

  it('прямые и через группу, без истёкших', () => {
    expect(grantsOf('m-v', list, groups, roles).map((g) => g.assignment.id)).toEqual(['ap2', 'a2']);
    expect(grantsOf('m-z', list, groups, roles).map((g) => g.role?.name)).toEqual([
      'Владелец бизнеса',
    ]);
  });

  it('строка назначения: роль, область, срок, «через группу «…»»', () => {
    expect(grantsOf('m-v', list, groups, roles).map((g) => grantLine(g, u))).toEqual([
      { role: 'Исполнитель', scope: 'Проект', via: 'через группу «Водители Север»' },
      { role: 'Водитель', scope: 'Москва / Север Логистик', via: 'через группу «Водители Север»' },
    ]);
    expect(grantsOf('m-k', list, groups, roles).map((g) => grantLine(g, u))).toEqual([
      { role: 'Водитель', scope: 'Москва / Юг Транс · до 31.10.2026' },
    ]);
  });

  it('«без роли» — участники без действующих назначений', () => {
    const members = [member('m-z'), member('m-v'), member('m-k'), member('m-p')];
    expect(noRoleCount(members, list, groups)).toBe(1);
  });

  // Возврат 16.10 №3: у участника с правами в своей области listRoles — 403, роли назначения неизвестны; строка не
  // начинается с «· », а говорит, что роль скрыта (verification-protocol §1.3, состояние «нет права»).
  it('роль не видна (listRoles 403) — «Роль не видна — нет права просматривать роли»', () => {
    expect(grantsOf('m-v', list, groups, []).map((g) => grantLine(g, u))).toEqual([
      {
        role: 'Роль не видна — нет права просматривать роли',
        scope: 'Проект',
        via: 'через группу «Водители Север»',
      },
      {
        role: 'Роль не видна — нет права просматривать роли',
        scope: 'Москва / Север Логистик',
        via: 'через группу «Водители Север»',
      },
    ]);
  });
});

// Возврат 16.10 №3: участники группы вне области вошедшего скрыты (listMembers отдаёт свою область) — число
// участников группы — по составу группы, а скрытые названы, а не пропущены («0 участников:» с пустым перечнем).
describe('участники группы', () => {
  const names = new Map([
    ['m-a', 'Илья Васильев'],
    ['m-b', 'Кирилл Громов'],
  ]);
  it('все видны — «{n} участника: имена»', () => {
    expect(groupMembersLine(['m-a', 'm-b'], names)).toBe(
      '2 участника: Илья Васильев, Кирилл Громов',
    );
  });
  it('часть вне области — «ещё k — вне вашей области»', () => {
    expect(groupMembersLine(['m-a', 'm-x', 'm-y'], names)).toBe(
      '3 участника: Илья Васильев, ещё 2 — вне вашей области',
    );
  });
  it('все вне области — «не показаны — вне вашей области»', () => {
    expect(groupMembersLine(['m-x', 'm-y'], names)).toBe(
      '2 участника: не показаны — вне вашей области',
    );
  });
  it('пустая группа — «0 участников: »', () => {
    expect(groupMembersLine([], names)).toBe('0 участников: ');
  });
});

describe('места и строка «Люди»', () => {
  const members = [
    member('a'),
    member('b', { status: 'invited' }),
    member('c', { status: 'suspended' }),
    member('card', { userId: undefined }),
  ];

  it('занято: активные с аккаунтом и приглашённые; лимит — право seats', () => {
    const sub = {
      entitlements: [
        { key: 'seats', sourceType: 'trial', sourceRef: 'x', value: 10 },
        { key: 'storage_quota_bytes', sourceType: 'trial', sourceRef: 'x', value: 1 },
      ],
    } as unknown as S['Subscription'];
    expect(seatsOf(members, sub)).toEqual({ used: 2, limit: 10 });
    // Возврат 16.10 №1: подписка не загружена (загрузка, сбой, нет права) — лимит неизвестен, а не «без
    // ограничения»; тариф без права seats — без ограничения.
    expect(seatsOf(members, undefined)).toEqual({ used: 2, limit: undefined });
    expect(seatsOf(members, { entitlements: [] } as unknown as S['Subscription'])).toEqual({
      used: 2,
      limit: null,
    });
  });

  it('лимит неизвестен — строка без мест', () => {
    expect(peopleNote(10, 3, { used: 9, limit: undefined })).toBe('10 участников · без роли: 3');
  });

  it('«10 участников · без роли: 3 · мест занято 9 из 10» (несклоняемое, как :3162)', () => {
    expect(peopleNote(10, 3, { used: 9, limit: 10 })).toBe(
      '10 участников · без роли: 3 · мест занято 9 из 10',
    );
    expect(peopleNote(2, 0, { used: 2, limit: null })).toBe('2 участников');
  });
});

describe('участник', () => {
  it('статус: «Активен», «Приглашён», «Заблокирован»', () => {
    expect(memberChip('active')).toEqual({ label: 'Активен', tone: 'ok', icon: 'check_circle' });
    expect(memberChip('invited')).toEqual({ label: 'Приглашён', tone: 'warn', icon: 'schedule' });
    expect(memberChip('suspended')).toEqual({
      label: 'Заблокирован',
      tone: 'danger',
      icon: 'block',
    });
  });

  it('подпись «{имя} · {почта}» и функция «Водитель»', () => {
    const m = member('m', {
      displayName: 'Илья Васильев',
      email: 'i.v@alta.example',
      workProfiles: ['driver'],
    });
    expect(memberSubtitle(m)).toBe('Илья Васильев · i.v@alta.example');
    expect(isDriver(m)).toBe(true);
    expect(isDriver(member('x'))).toBe(false);
  });
});

describe('роли', () => {
  it('вид: системная, шаблон каталога или эталона, своя', () => {
    expect(roleKind(role('r', 'Владелец бизнеса', { builtIn: true }))).toBe('system');
    expect(roleKind(role('r', 'Менеджер логистики'))).toBe('template');
    expect(roleKind(role('r', 'Массажист'))).toBe('template');
    expect(roleKind(role('r', 'Руководитель проекта'))).toBe('template');
    expect(roleKind(role('r', 'Диспетчер'))).toBe('custom');
  });

  it('«Все права · назначена: 1» и «{n} разрешений · назначена: {k}»', () => {
    const list = [
      assignment('a', 'm', 'r1', scope('tenant')),
      assignment('b', 'g', 'r2', scope('self'), { principalType: 'group' }),
      assignment('c', 'm2', 'r2', scope('self')),
    ];
    expect(roleMeta(role('r1', 'Владелец', { builtIn: true }), list)).toBe(
      'Все права · назначена: 1',
    );
    expect(roleMeta(role('r2', 'X', { permissions: ['a.b', 'c.d'] }), list)).toBe(
      '2 разрешений · назначена: 2',
    );
  });
});
