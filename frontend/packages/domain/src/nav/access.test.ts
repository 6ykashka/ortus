// W1.20 · AccessGate страницы и баннер модуля (docs/plan/analysis/01-shell.md §11, §12; gateVM :3053–3081,
// bannersVM :3089–3091). Кнопки «Демо: …» не переносятся (PD-54): владельцу — «Открыть «Модули и место»».
import { describe, expect, it } from 'vitest';

import { moduleBanner, pageAccess } from './access.ts';
import { navContext } from './context.ts';
import {
  ACTIVE,
  DENIED,
  DISABLED,
  DISABLED_NO_ACCESS,
  ME,
  PLAN_EXPIRED,
  tenantOf,
  withCapabilities,
  withModule,
  withoutTenantState,
  withTenantState,
} from './fixtures.test-util.ts';
import type { NavTenantLike, PageKey } from './types.ts';

const access = (t: NavTenantLike, page: PageKey) => pageAccess(navContext(t, false), page);

describe('страницы без проверки', () => {
  it('«Главная» открыта всем участникам организации', () => {
    expect(access(tenantOf(ME.driver), 'home')).toEqual({ kind: 'allow', readOnly: false });
  });

  it('«Компания» открыта владельцу; страницы оператора — оператору', () => {
    expect(access(tenantOf(ME.owner), 'users')).toEqual({ kind: 'allow', readOnly: false });
    expect(pageAccess(navContext(null, true), 'tenants')).toEqual({
      kind: 'allow',
      readOnly: false,
    });
  });

  // W1.54 (Q-W1.54-1): «Структура» — владелец или право org_units.read в любой области.
  it('«Структура»: владельцу и сотруднику с org_units.read открыта, без права — «Нет доступа к разделу»', () => {
    expect(access(tenantOf(ME.owner), 'structure')).toEqual({ kind: 'allow', readOnly: false });
    expect(access(withCapabilities(tenantOf(ME.manager), ['org_units.read']), 'structure')).toEqual(
      { kind: 'allow', readOnly: false },
    );
    expect(access(tenantOf(ME.manager), 'structure')).toEqual({
      kind: 'deny',
      reason: 'no_permission',
      branch: 'A',
      chip: 'noPermission',
      title: 'noPermission',
      domainModule: null,
      label: 'items.structure',
      owner: false,
    });
  });

  it('страница другого контура — «не найдено»', () => {
    expect(pageAccess(navContext(null, true), 'home')).toEqual({ kind: 'not_found' });
    expect(access(tenantOf(ME.owner), 'tenants')).toEqual({ kind: 'not_found' });
  });

  it('модуль будущего этапа без доступности (чаты) — заглушка открыта', () => {
    expect(access(tenantOf(ME.driver), 'chat')).toEqual({ kind: 'allow', readOnly: false });
  });

  it('пункт профиля рабочего места открыт без права (заглушка до этапа 5): «Подотчёт»', () => {
    expect(access(tenantOf(ME.driver), 'cashSelf')).toEqual({ kind: 'allow', readOnly: false });
    expect(access(tenantOf(ME.foreman), 'cashSelf')).toEqual({ kind: 'allow', readOnly: false });
  });

  // W1.49: «Касса» массажиста — по праву (core() эталона :2964), как у офиса.
  it('«Касса» массажиста: без права — «Нет доступа к разделу» (ветка A), с правом — открыта', () => {
    expect(access(tenantOf(ME.therapist), 'cash')).toMatchObject({
      kind: 'deny',
      reason: 'no_permission',
      branch: 'A',
    });
    expect(access(tenantOf(ME.therapist, 'SPA «Лотос»'), 'cash')).toMatchObject({
      kind: 'deny',
      reason: 'no_permission',
    });
    const cashier = withCapabilities(tenantOf(ME.therapist), ['cash.post'], 'self');
    expect(access(cashier, 'cash')).toEqual({ kind: 'allow', readOnly: false });
  });

  it('чужой профиль и офис без права — «Нет доступа к разделу» (ветка A)', () => {
    expect(access(tenantOf(ME.driver), 'cash')).toMatchObject({
      kind: 'deny',
      reason: 'no_permission',
    });
    expect(access(tenantOf(ME.manager), 'cash')).toMatchObject({
      kind: 'deny',
      reason: 'no_permission',
    });
  });
});

describe('ветка B: логистика и рабочие места', () => {
  it('водитель, модуль не подключён: «Логистика» не подключена организацией', () => {
    expect(access(tenantOf(ME.driver), 'today')).toEqual({
      kind: 'deny',
      reason: 'module_off',
      branch: 'B',
      chip: 'moduleOff',
      title: 'moduleOff',
      domainModule: 'logistics',
      label: 'items.today',
      owner: false,
    });
  });

  it('владелец по прямому URL: тот же отказ с текстом и кнопкой владельца', () => {
    const r = access(tenantOf(ME.owner), 'fleet');
    expect(r).toMatchObject({ kind: 'deny', reason: 'module_off', branch: 'B', owner: true });
  });

  it('модуль подключён, роли нет: «Нет роли с доступом к модулю «Логистика»»', () => {
    const t = withModule(tenantOf(ME.manager), 'fleet', DENIED);
    expect(access(t, 'fleet')).toMatchObject({
      kind: 'deny',
      reason: 'no_permission',
      branch: 'B',
      chip: 'noPermission',
      title: 'noRole',
      domainModule: 'logistics',
    });
    expect(access(t, 'review')).toMatchObject({ reason: 'no_permission', title: 'noReview' });
  });

  it('роль логиста без права приёмки: «Нет права на приёмку смен»', () => {
    const t = withCapabilities(withModule(tenantOf(ME.manager), 'fleet', ACTIVE), [
      'fleet.routes.manage',
    ]);
    expect(access(t, 'fleet')).toEqual({ kind: 'allow', readOnly: false });
    expect(access(t, 'review')).toMatchObject({ kind: 'deny', title: 'noReview' });
  });

  it('модуль отключён с историей, право есть: только чтение (гейт пропускает)', () => {
    const t = withModule(tenantOf(ME.driver), 'fleet', DISABLED);
    expect(access(t, 'today')).toEqual({ kind: 'allow', readOnly: true });
  });

  it('модуль отключён с историей, права нет: чип «Модуль отключён»', () => {
    const t = withModule(tenantOf(ME.manager), 'fleet', DISABLED_NO_ACCESS);
    expect(access(t, 'fleet')).toMatchObject({
      kind: 'deny',
      reason: 'module_readonly',
      branch: 'B',
      chip: 'moduleDisabled',
      title: 'moduleOff',
    });
  });
});

describe('ветка A: страницы модулей (PAGE_MOD)', () => {
  it('прораб, «Ремонт и стройка» не подключён', () => {
    expect(access(tenantOf(ME.foreman), 'repair')).toEqual({
      kind: 'deny',
      reason: 'module_off',
      branch: 'A',
      chip: 'moduleOff',
      title: 'moduleOff',
      domainModule: 'repair',
      label: 'items.repair',
      owner: false,
    });
  });

  it('модуль ядра без права: «Нет доступа к разделу «Формы»»', () => {
    expect(access(tenantOf(ME.manager), 'forms')).toMatchObject({
      kind: 'deny',
      reason: 'no_permission',
      branch: 'A',
      chip: 'noPermission',
      title: 'noPermission',
      domainModule: 'forms',
    });
  });

  it('право в объектной области открывает раздел (canAny, Q-W0.11-1)', () => {
    expect(access(tenantOf(ME.manager), 'tasks')).toEqual({ kind: 'allow', readOnly: false });
  });

  it('ветка A при отключённом модуле без права — чип «Модуль не подключён» (:3062)', () => {
    const t = withModule(tenantOf(ME.manager), 'spa', DISABLED_NO_ACCESS);
    expect(access(t, 'spa')).toMatchObject({
      reason: 'module_readonly',
      branch: 'A',
      chip: 'moduleOff',
    });
  });

  it('«Компания» у сотрудника без права: «Нет доступа к разделу «Модули и место»»', () => {
    expect(access(tenantOf(ME.manager), 'modules')).toEqual({
      kind: 'deny',
      reason: 'no_permission',
      branch: 'A',
      chip: 'noPermission',
      title: 'noPermission',
      domainModule: null,
      label: 'items.modules',
      owner: false,
    });
  });

  // W1.24 (Q-W1.24-17): «Хранилище» — страница вне меню; имя раздела в гейте — подпись страницы манифеста.
  it('«Хранилище» у сотрудника без billing.read: «Нет доступа к разделу «Хранилище»»', () => {
    expect(access(tenantOf(ME.manager), 'storage')).toEqual({
      kind: 'deny',
      reason: 'no_permission',
      branch: 'A',
      chip: 'noPermission',
      title: 'noPermission',
      domainModule: null,
      label: 'items.storage',
      owner: false,
    });
  });
});

describe('организация только для чтения', () => {
  it('пробный период завершён: страницы с правом открыты только для чтения', () => {
    const t = withTenantState(tenantOf(ME.owner), { status: 'read_only' });
    const expired = {
      ...t,
      modules: t.modules.map((m) => (m.state === 'uninstalled' ? m : { ...m, ...PLAN_EXPIRED })),
    };
    expect(access(expired, 'tasks')).toEqual({ kind: 'allow', readOnly: true });
    expect(access(expired, 'home')).toEqual({ kind: 'allow', readOnly: true });
    expect(navContext(expired, false).tenantReadOnly).toBe(true);
  });

  // Эталон (:3088): баннер «Пробный период завершён.» — по статусу организации restricted/suspended; контракт
  // 0.4.0-stage1 отдаёт его каждому участнику в TenantContext.tenantState.status (PD-35: grace/read_only →
  // restricted). Модули приостановленной организации могут не иметь причины plan_expired.
  it('статус организации tenantState: grace, read_only и suspended — только чтение; trial и active — нет', () => {
    const t = tenantOf(ME.driver);
    for (const status of ['grace', 'read_only', 'suspended']) {
      expect(navContext(withTenantState(t, { status }), false).tenantReadOnly, status).toBe(true);
    }
    for (const status of ['trial', 'active']) {
      expect(navContext(withTenantState(t, { status }), false).tenantReadOnly, status).toBe(false);
    }
  });

  it('приостановленная организация без модулей plan_expired — только чтение', () => {
    const t = withTenantState(
      { ...tenantOf(ME.owner), modules: [], capabilities: [] },
      {
        status: 'suspended',
      },
    );
    expect(navContext(t, false).tenantReadOnly).toBe(true);
  });

  it('без tenantState (стенд до W1.08) — по причине модулей plan_expired', () => {
    const t = withoutTenantState(tenantOf(ME.owner));
    const expired = {
      ...t,
      modules: t.modules.map((m) => (m.state === 'uninstalled' ? m : { ...m, ...PLAN_EXPIRED })),
    };
    expect(navContext(t, false).tenantReadOnly).toBe(false);
    expect(navContext(expired, false).tenantReadOnly).toBe(true);
  });
});

describe('место организации заполнено (tenantState.storageWriteStatus)', () => {
  // Эталон (:3096): баннер «Место организации заполнено.» видят все, кроме оператора; контракт 0.4.0-stage1
  // отдаёт признак каждому участнику без billing.read.
  it('blocked — заполнено, allowed — нет, без tenantState — неизвестно (null)', () => {
    const t = tenantOf(ME.driver);
    const blocked = withTenantState(t, { storageWriteStatus: 'blocked' });
    expect(navContext(blocked, false).storageBlocked).toBe(true);
    expect(
      navContext(withTenantState(t, { storageWriteStatus: 'allowed' }), false).storageBlocked,
    ).toBe(false);
    const bare = withoutTenantState(t);
    expect(navContext(bare, false).storageBlocked).toBeNull();
    expect(navContext(null, true).storageBlocked).toBeNull();
  });
});

describe('баннер «Модуль «…» отключён.»', () => {
  it('на страницах отключённого с историей отраслевого модуля', () => {
    const ctx = navContext(withModule(tenantOf(ME.driver), 'fleet', DISABLED), false);
    expect(moduleBanner(ctx, 'today')).toBe('logistics');
    expect(moduleBanner(ctx, 'home')).toBeNull();
  });

  it('у подключённого и не подключённого модуля баннера нет', () => {
    expect(moduleBanner(navContext(tenantOf(ME.driver), false), 'today')).toBeNull();
    const on = navContext(withModule(tenantOf(ME.owner), 'fleet', ACTIVE), false);
    expect(moduleBanner(on, 'fleet')).toBeNull();
  });

  it('SPA и ремонт — свои тексты (RO_TEXT :3090)', () => {
    const ctx = navContext(withModule(tenantOf(ME.owner), 'spa', DISABLED), false);
    expect(moduleBanner(ctx, 'spa')).toBe('spa');
  });
});
