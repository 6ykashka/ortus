// W1.23 · Каталог редактора ролей: модули и уровни действий `api/permissions.yaml` (AUTH-03, levels) в порядке
// модулей эталона (models.js ALL_MODULES, roleEditorVM :3176–3192); права роли ↔ уровни редактора.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  industryOf,
  PERMISSIONS,
  roleCatalog,
  summaryKeys,
  toDraft,
  toPermissions,
} from './catalog.ts';

type S = components['schemas'];

/** Каталог прав контракта — выжимка `api/permissions.yaml` сценарного сервера W0.13. */
const CONTRACT = JSON.parse(
  readFileSync(
    join(
      import.meta.dirname,
      '../../../../../../packages/adapter/src/msw/contract/contract.gen.json',
    ),
    'utf8',
  ),
) as {
  permissions: {
    actions: {
      key: string;
      module: string;
      level?: string;
      sensitivity?: string;
      ownerOnly?: boolean;
    }[];
  };
};

const MANAGER: S['Role'] = {
  id: 'r-manager',
  name: 'Менеджер логистики',
  description: '',
  builtIn: false,
  revision: 1,
  permissions: [
    'members.read',
    'roles.read',
    'files.read',
    'files.upload',
    'tasks.read',
    'tasks.create',
    'tasks.update',
    'tasks.transition',
    'fleet.vehicles.read',
    'fleet.vehicles.manage',
    'fleet.reservations.read',
    'fleet.reservations.manage',
    'fleet.inspections.read',
    'fleet.inspections.review',
    'fleet.trips.read',
    'fleet.trips.review',
    'fleet.routes.read',
    'fleet.routes.manage',
    'fleet.expenses.read',
    'fleet.expenses.review',
    'fleet.driver_transfers.read',
    'fleet.driver_transfers.request',
    'fleet.driver_transfers.approve',
    'fleet.earnings.read',
  ],
};

const installed = (m: string) => m !== 'fleet' && m !== 'repairs';

describe('каталог прав ↔ api/permissions.yaml', () => {
  it('ключи, модули, уровни и чувствительность совпадают с контрактом (кроме platform.*)', () => {
    const want = CONTRACT.permissions.actions
      .filter((a) => !a.key.startsWith('platform.'))
      .map((a) => [a.key, a.module, a.level, a.sensitivity ?? 'normal', Boolean(a.ownerOnly)]);
    expect(PERMISSIONS.map((p) => [p.key, p.module, p.level, p.sensitivity, p.ownerOnly])).toEqual(
      want,
    );
  });
});

describe('roleCatalog', () => {
  const cat = roleCatalog(installed);

  it('модули в порядке эталона без «Документов» и «Обращений» (вне этапа)', () => {
    expect(cat.modules.map((m) => m.name)).toEqual([
      'Логистика',
      'Салон и SPA',
      'Ремонт и стройка',
      'Календарь',
      'Задачи',
      'База знаний',
      'Формы',
      'Данные',
      'Файлы',
      'Склад и материалы',
      'Касса',
      'Чаты',
    ]);
    expect(cat.modules.find((m) => m.key === 'logistics')).toMatchObject({
      on: false,
      icon: 'local_shipping',
    });
    expect(cat.modules.find((m) => m.key === 'spa')?.on).toBe(true);
    expect(cat.modules.find((m) => m.key === 'tasks')?.on).toBe(true);
  });

  it('уровни логистики и финансовые разрешения отдельно', () => {
    const fleet = cat.modules.find((m) => m.key === 'logistics');
    expect(fleet?.verbs.map((v) => [v.key, v.label, Boolean(v.restricted)])).toEqual([
      ['view', 'Просматривать', false],
      ['create', 'Создавать', false],
      ['edit', 'Изменять', false],
      ['review', 'Проверять', false],
      ['settings', 'Настраивать', false],
      ['earnings.read', 'Видеть начисления водителям', true],
      ['earnings.manage', 'Управлять начислениями', true],
    ]);
    expect(fleet?.verbs[0]?.perms).toContain('fleet.trips.read');
    expect(fleet?.verbs[0]?.perms).not.toContain('fleet.earnings.read');
    expect(fleet?.verbs.find((v) => v.key === 'earnings.read')?.perms).toEqual([
      'fleet.earnings.read',
    ]);
  });

  it('права только владельца и вне этапа (restricted ремонта и чатов) в редакторе не выдаются', () => {
    const all = cat.modules.flatMap((m) => m.verbs.flatMap((v) => v.perms));
    for (const k of [
      'chat.hold.manage',
      'chat.policy.manage',
      'repairs.finance.read',
      'chat.pdn.read',
    ]) {
      expect(all).not.toContain(k);
    }
  });
});

describe('права роли ↔ редактор', () => {
  const cat = roleCatalog(installed);

  it('«Менеджер логистики»: полные уровни, финансы, частичный уровень задач', () => {
    const draft = toDraft(MANAGER, cat);
    expect(draft.actions.logistics).toEqual([
      'view',
      'edit',
      'review',
      'settings',
      'earnings.read',
    ]);
    expect(draft.actions.tasks).toEqual(['create', 'edit']);
    expect(draft.partial).toEqual({ tasks: ['view'] });
    expect(draft.actions.files).toEqual(['view', 'create']);
    expect(draft.system).toBe(false);
  });

  it('модуль выключен — снимаются все его ключи, кроме финансовых; прочие ключи роли сохраняются', () => {
    const draft = toDraft(MANAGER, cat);
    const next = { ...draft, actions: { ...draft.actions, logistics: ['earnings.read'] } };
    const perms = toPermissions(MANAGER.permissions, draft, next, cat);
    expect(perms.filter((k) => k.startsWith('fleet.'))).toEqual(['fleet.earnings.read']);
    expect(perms).toContain('members.read');
    // Переключатель модуля снимает и полные, и частичные уровни (RoleEditor убирает модуль из обоих).
    const noTasks = { ...draft, actions: { ...draft.actions }, partial: {} };
    delete noTasks.actions.tasks;
    expect(
      toPermissions(MANAGER.permissions, draft, noTasks, cat).filter((k) => k.startsWith('tasks.')),
    ).toEqual([]);
  });

  it('уровень включён — добавляются все ключи уровня; частичный уровень дополняется', () => {
    const draft = toDraft(MANAGER, cat);
    const next = {
      ...draft,
      actions: {
        ...draft.actions,
        logistics: [...(draft.actions.logistics ?? []), 'create'],
        tasks: ['view', 'create', 'edit'],
      },
      partial: {},
    };
    const perms = toPermissions(MANAGER.permissions, draft, next, cat);
    expect(perms).toEqual(
      expect.arrayContaining([
        'fleet.reservations.create',
        'fleet.trips.start',
        'tasks.projects.read',
      ]),
    );
    expect(perms.filter((k) => k === 'tasks.read')).toHaveLength(1);
  });

  it('финансовое разрешение снимается отдельно; системная роль', () => {
    const draft = toDraft(MANAGER, cat);
    const next = {
      ...draft,
      actions: { ...draft.actions, logistics: ['view', 'edit', 'review', 'settings'] },
    };
    expect(toPermissions(MANAGER.permissions, draft, next, cat)).not.toContain(
      'fleet.earnings.read',
    );
    expect(toDraft({ ...MANAGER, builtIn: true }, cat).system).toBe(true);
  });
});

// Возврат 16.10 №1 (blocker ревью): у «Водителя» модули только с частично выданными уровнями — правка имени или
// другого модуля не должна снимать их ключи.
describe('права роли ↔ редактор: модули только с частичными уровнями', () => {
  const cat = roleCatalog(() => true);
  const DRIVER: S['Role'] = {
    ...MANAGER,
    id: 'r-driver',
    name: 'Водитель',
    permissions: ['fleet.vehicles.read', 'tasks.read', 'calendar.availability.read'],
  };

  it('частичные уровни — в черновике (partial), полных уровней нет', () => {
    const draft = toDraft(DRIVER, cat);
    expect(draft.actions).toEqual({});
    expect(draft.partial).toEqual({
      logistics: ['view'],
      calendar: ['view'],
      tasks: ['view'],
    });
  });

  it('переименование не меняет права роли', () => {
    const draft = toDraft(DRIVER, cat);
    expect(
      toPermissions(DRIVER.permissions, draft, { ...draft, name: 'Водитель рейса' }, cat),
    ).toEqual(DRIVER.permissions);
  });

  it('выключение модуля «Задачи» снимает только его ключи; «Календарь» и «Логистика» остаются', () => {
    const draft = toDraft(DRIVER, cat);
    const next = { ...draft, partial: { logistics: ['view'], calendar: ['view'] } };
    expect(toPermissions(DRIVER.permissions, draft, next, cat)).toEqual([
      'fleet.vehicles.read',
      'calendar.availability.read',
    ]);
  });

  it('уровень другого модуля включён — частичные уровни прочих модулей сохраняются', () => {
    const draft = toDraft(DRIVER, cat);
    const next = { ...draft, actions: { files: ['view'] } };
    expect(toPermissions(DRIVER.permissions, draft, next, cat)).toEqual([
      ...DRIVER.permissions,
      'files.read',
    ]);
  });

  it('отметка частичного уровня дополняет его до целого', () => {
    const draft = toDraft(DRIVER, cat);
    const next = {
      ...draft,
      actions: { tasks: ['view'] },
      partial: { logistics: ['view'], calendar: ['view'] },
    };
    const perms = toPermissions(DRIVER.permissions, draft, next, cat);
    expect(perms).toEqual(expect.arrayContaining(['tasks.read', 'tasks.projects.read']));
    expect(perms).toContain('calendar.availability.read');
    expect(perms).toContain('fleet.vehicles.read');
  });
});

describe('отраслевые модули роли (итог назначения)', () => {
  it('по ключам роли; системная — все', () => {
    expect(industryOf(MANAGER.permissions)).toEqual(['fleet']);
    expect(industryOf(['spa.appointments.read', 'calendar.bookings.read'])).toEqual(['spa']);
    expect(industryOf(['tasks.read'])).toEqual([]);
  });
});

// Возврат 16.10 №3: «Итоговые права роли» — в порядке модулей редактора (rolePermKeys эталона: модули, уровни,
// затем начисления), а не в порядке ответа API; ключи вне редактора (`members.*`, `roles.*`) — в конце.
describe('«Итоговые права роли»: порядок ключей', () => {
  it('модули редактора, уровни, начисления, затем прочие ключи роли', () => {
    const catalog = roleCatalog(() => true);
    expect(
      summaryKeys(
        [
          'members.read',
          'tasks.read',
          'fleet.earnings.read',
          'fleet.trips.review',
          'fleet.trips.read',
          'fleet.vehicles.read',
          'roles.read',
        ],
        catalog,
      ),
    ).toEqual([
      'fleet.vehicles.read',
      'fleet.trips.read',
      'fleet.trips.review',
      'tasks.read',
      'fleet.earnings.read',
      'members.read',
      'roles.read',
    ]);
  });
});
