// W1.20 · Меню оболочки по /me/context: рабочее место, группы и пункты D-23, бейджи, стартовая страница,
// нижняя навигация (docs/plan/analysis/01-shell.md §8.3, §9.1, §9.5; navForBase :2950–3003).
import { describe, expect, it } from 'vitest';

import { bottomItems, buildNav, defaultPage } from './build.ts';
import { audienceOf, navContext } from './context.ts';
import {
  ACTIVE,
  DISABLED,
  ME,
  PLAN_EXPIRED,
  tenantOf,
  withCapabilities,
  withModule,
} from './fixtures.test-util.ts';
import type { NavGroup, NavTenantLike } from './types.ts';

const shape = (groups: NavGroup[]) =>
  groups.map((g) => `${g.key}: ${g.items.map((i) => i.key).join(', ')}`);

const tenantNav = (t: NavTenantLike) => buildNav(navContext(t, false));

describe('рабочее место по возможностям /me/context', () => {
  it('владелец — по праву управлять модулями', () => {
    expect(audienceOf(tenantOf(ME.owner), false)).toBe('owner');
    expect(audienceOf(tenantOf(ME.ownerLotos, 'SPA «Лотос»'), false)).toBe('owner');
  });

  it('водитель — по самообслуживанию рейса, прораб — по отметкам работ', () => {
    expect(audienceOf(tenantOf(ME.driver), false)).toBe('driver');
    expect(audienceOf(tenantOf(ME.foreman), false)).toBe('foreman');
  });

  it('массажист — записи SPA в области «своё»', () => {
    expect(audienceOf(tenantOf(ME.therapist), false)).toBe('practitioner');
  });

  it('прочие сотрудники — офис; оператор без организации — контур платформы', () => {
    expect(audienceOf(tenantOf(ME.manager), false)).toBe('office');
    expect(audienceOf(null, true)).toBe('operator');
  });
});

describe('меню владельца (D-23)', () => {
  it('старт сида: «Обзор», «Компания», «Отрасли», «Общие модули»; логистики и ремонта нет', () => {
    expect(shape(tenantNav(tenantOf(ME.owner)))).toEqual([
      'overview: home',
      'company: modules, users, billing, branding',
      'industries: spa',
      'core: chat, tasks, service, forms, calendar, knowledge, docs, data, files, cash',
    ]);
  });

  it('подписи и иконки пунктов — как в эталоне', () => {
    const groups = tenantNav(tenantOf(ME.owner));
    expect(groups.map((g) => g.title)).toEqual([
      'groups.overview',
      'groups.company',
      'groups.industries',
      'groups.core',
    ]);
    const company = groups[1]?.items.map((i) => [i.label, i.icon, i.segment]);
    expect(company).toEqual([
      ['items.modules', 'extension', 'modules'],
      ['items.users', 'group', 'users'],
      ['items.billing', 'workspace_premium', 'billing'],
      ['items.branding', 'palette', 'branding'],
    ]);
  });

  it('подключённая «Логистика» — своя группа после «Компании»', () => {
    const t = withModule(tenantOf(ME.owner), 'fleet', ACTIVE);
    expect(shape(tenantNav(t)).slice(0, 3)).toEqual([
      'overview: home',
      'company: modules, users, billing, branding',
      'logistics: fleet, pool, review',
    ]);
  });

  it('отключённая с историей — один пункт «Логистика» в последней группе «Отключены · только чтение»', () => {
    const groups = tenantNav(withModule(tenantOf(ME.owner), 'fleet', DISABLED));
    expect(groups.some((g) => g.key === 'logistics')).toBe(false);
    const last = groups.at(-1);
    expect(last?.key).toBe('readonly');
    expect(last?.title).toBe('groups.readonly');
    expect(last?.items).toEqual([
      { key: 'fleet', segment: 'fleet', label: 'groups.logistics', icon: 'local_shipping' },
    ]);
  });

  it('подключённый «Ремонт и стройка» — группа из трёх пунктов перед «Отраслями»', () => {
    const groups = tenantNav(withModule(tenantOf(ME.owner), 'repairs', ACTIVE));
    expect(shape(groups)[2]).toBe('repair: repair, repairSupply, repairCatalog');
    expect(groups[2]?.items.map((i) => i.label)).toEqual([
      'items.repair',
      'items.repairSupply',
      'items.repairCatalog',
    ]);
  });

  it('отключённые с историей идут в порядке «Логистика», «Ремонт и стройка», «Салон и SPA»', () => {
    let t = withModule(tenantOf(ME.owner), 'fleet', DISABLED);
    t = withModule(t, 'repairs', DISABLED);
    t = withModule(t, 'spa', DISABLED);
    const ro = tenantNav(t).at(-1);
    expect(ro?.items.map((i) => [i.key, i.label, i.icon])).toEqual([
      ['fleet', 'groups.logistics', 'local_shipping'],
      ['repair', 'groups.repair', 'construction'],
      ['spa', 'items.spa', 'spa'],
    ]);
  });

  it('организация только для чтения (пробный период) меню не меняет', () => {
    const t = tenantOf(ME.owner);
    const expired = {
      ...t,
      modules: t.modules.map((m) => (m.state === 'uninstalled' ? m : { ...m, ...PLAN_EXPIRED })),
    };
    expect(shape(tenantNav(expired))).toEqual(shape(tenantNav(t)));
  });

  it('«Лотос»: то же меню владельца без логистики', () => {
    expect(shape(tenantNav(tenantOf(ME.ownerLotos, 'SPA «Лотос»')))).toEqual([
      'overview: home',
      'company: modules, users, billing, branding',
      'industries: spa',
      'core: chat, tasks, service, forms, calendar, knowledge, docs, data, files, cash',
    ]);
  });
});

describe('меню сотрудников', () => {
  it('логист без роли логистики: «Главная» и общие модули по возможностям (Q-W0.11-1)', () => {
    expect(shape(tenantNav(tenantOf(ME.manager)))).toEqual([
      'overview: home',
      'core: chat, tasks, service, docs, files',
    ]);
  });

  it('логист с ролью логистики видит группу «Логистика» «как если бы модуль был включён»', () => {
    const t = withCapabilities(tenantOf(ME.manager), [
      'fleet.trips.read',
      'fleet.routes.manage',
      'fleet.driver_transfers.request',
      'fleet.trips.review',
    ]);
    expect(shape(tenantNav(t))[1]).toBe('logistics: fleet, pool, review');
  });

  it('водитель: «Сегодня», «Автомобили», «Подотчёт», «Чаты», «База знаний», «Документы» (:2998)', () => {
    // «Подотчёт» — пункт профиля рабочего места: по рабочему месту, как «Чаты» (R-2), без права cash.*.
    const groups = tenantNav(tenantOf(ME.driver));
    expect(shape(groups)).toEqual(['work: today, cars, cashSelf, chat, knowledge, docs']);
    expect(groups[0]?.items.slice(0, 2).map((i) => [i.label, i.icon])).toEqual([
      ['items.today', 'today'],
      ['items.cars', 'local_shipping'],
    ]);
  });

  it('водитель с подотчётом видит «Подотчёт» после «Автомобили»', () => {
    const t = withCapabilities(tenantOf(ME.driver), ['cash.post'], 'self');
    const work = tenantNav(t)[0];
    expect(work?.items.map((i) => i.key)).toEqual([
      'today',
      'cars',
      'cashSelf',
      'chat',
      'knowledge',
      'docs',
    ]);
    expect(work?.items[2]?.label).toBe('items.advance');
  });

  // W1.49: «Касса» массажиста — core([…, cash]) эталона (:2964, :3001): по праву cash.* участника, а не по
  // рабочему месту. В «Альте» эталона право даёт роль «Кассир салона» с областью «касса» (cash.js :263–266, этап 5),
  // в «Лотосе» её нет (01-shell.md §8.3: therapist@t-lotos — spa, chat, calendar, knowledge).
  it('массажист без права cash.*: «Мой день», «Чаты», «Календарь», «База знаний» (в обеих организациях)', () => {
    const groups = tenantNav(tenantOf(ME.therapist));
    expect(shape(groups)).toEqual(['work: spa, chat, calendar, knowledge']);
    expect(groups[0]?.items[0]?.label).toBe('items.mySpa');
    expect(shape(tenantNav(tenantOf(ME.therapist, 'SPA «Лотос»')))).toEqual([
      'work: spa, chat, calendar, knowledge',
    ]);
  });

  it('массажист с правом кассы (любая область, в том числе объектная): «Касса» последним пунктом (:3001)', () => {
    for (const kind of ['org_unit', 'self', 'project']) {
      const t = withCapabilities(tenantOf(ME.therapist), ['cash.read'], kind);
      expect(shape(tenantNav(t))).toEqual(['work: spa, chat, calendar, knowledge, cash']);
    }
  });

  it('прораб: «Ремонт и стройка» → «Объекты», затем «Подотчёт» и «Общие модули» (:3002)', () => {
    expect(shape(tenantNav(tenantOf(ME.foreman)))).toEqual([
      'repair: repair',
      'core: cashSelf, chat, tasks, knowledge, docs',
    ]);
  });

  it('«Подотчёт» и «Касса» скрыты, если модуль «Касса» не подключён — даже с правом', () => {
    const off = { state: 'uninstalled', accessMode: 'none', reason: 'not_installed' } as const;
    expect(shape(tenantNav(withModule(tenantOf(ME.driver), 'cash', off)))).toEqual([
      'work: today, cars, chat, knowledge, docs',
    ]);
    const cashier = withCapabilities(tenantOf(ME.therapist), ['cash.read']);
    expect(shape(tenantNav(withModule(cashier, 'cash', off)))).toEqual([
      'work: spa, chat, calendar, knowledge',
    ]);
  });

  it('офисному сотруднику «Касса» — только по праву cash.* (пункт не профильный)', () => {
    expect(shape(tenantNav(tenantOf(ME.manager)))[1]).not.toContain('cash');
  });

  it('оператор: группа «Платформа» из пяти пунктов', () => {
    const groups = buildNav(navContext(null, true));
    expect(shape(groups)).toEqual(['platform: tenants, usage, requests, accounts, plans']);
    expect(groups[0]?.items.map((i) => i.icon)).toEqual([
      'domain',
      'monitoring',
      'move_up',
      'badge',
      'sell',
    ]);
  });
});

describe('бейджи, стартовая страница, нижняя навигация', () => {
  it('бейдж — у пункта с положительным счётчиком, ноль бейджа не даёт', () => {
    const groups = buildNav(navContext(tenantOf(ME.owner), false), {
      badges: { chat: 5, docs: 0, service: 4 },
    });
    const core = groups.find((g) => g.key === 'core')?.items ?? [];
    expect(core.find((i) => i.key === 'chat')?.badge).toBe(5);
    expect(core.find((i) => i.key === 'service')?.badge).toBe(4);
    expect(core.find((i) => i.key === 'docs')).not.toHaveProperty('badge');
  });

  it('стартовая страница — первый пункт меню (DEFAULT_PAGE :2301)', () => {
    expect(defaultPage(tenantNav(tenantOf(ME.owner)))).toBe('home');
    expect(defaultPage(tenantNav(tenantOf(ME.manager)))).toBe('home');
    expect(defaultPage(tenantNav(tenantOf(ME.driver)))).toBe('today');
    expect(defaultPage(tenantNav(tenantOf(ME.therapist)))).toBe('spa');
    expect(defaultPage(tenantNav(tenantOf(ME.foreman)))).toBe('repair');
    expect(defaultPage(buildNav(navContext(null, true)))).toBe('tenants');
    expect(defaultPage([])).toBe('home');
  });

  it('нижняя навигация — первые три пункта с сокращениями (:3028)', () => {
    expect(bottomItems(tenantNav(tenantOf(ME.owner))).map((i) => i.label)).toEqual([
      'items.home',
      'bottom.modules',
      'bottom.users',
    ]);
    const fleet = tenantNav(withModule(tenantOf(ME.owner), 'fleet', ACTIVE)).slice(2);
    expect(bottomItems(fleet).map((i) => i.label)).toEqual([
      'bottom.fleet',
      'bottom.pool',
      'bottom.review',
    ]);
    // Водитель: «Сегодня», «Автомобили», «Подотчёт», «Ещё» (:3028); прораб: «Объекты», «Подотчёт», «Чаты».
    expect(bottomItems(tenantNav(tenantOf(ME.driver))).map((i) => i.key)).toEqual([
      'today',
      'cars',
      'cashSelf',
    ]);
    expect(bottomItems(tenantNav(tenantOf(ME.foreman))).map((i) => i.key)).toEqual([
      'repair',
      'cashSelf',
      'chat',
    ]);
  });
});

describe('доступность модулей не пришла (стенд до W1.08, Q-W0.09-7)', () => {
  it('ядро считается подключённым, отраслевые модули — не подключёнными', () => {
    const t = { ...tenantOf(ME.owner), modules: [] };
    expect(shape(tenantNav(t))).toEqual([
      'overview: home',
      'company: modules, users, billing, branding',
      'core: chat, tasks, service, forms, calendar, knowledge, docs, data, files, cash',
    ]);
  });
});
