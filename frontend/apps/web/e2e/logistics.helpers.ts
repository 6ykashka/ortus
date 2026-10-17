// W2.20 · Помощники e2e рабочего места логиста (`logistics-fleet`) и планирования рейса (`logistics-plan`):
// вход персонажа на «Альту» с пресетом `logistics-ready` (модуль подключён, Котова — «Менеджер логистики» в
// «Москва / Север Логистик»), пункт меню по подписи, локаторы вкладок, строк машин и счётчиков, команды API
// из страницы (подготовка конфликта). Только режим mock: пресеты — сценарный сервер W0.13.
import type { Persona } from '@ortus/e2e-kit';
import type { Locator, Page } from '@playwright/test';

import { call, devScenario, setModule, tenantId } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<unknown>;

export const FLEET_H1 = 'Рабочее место логиста';
export const PLAN_H1 = 'Планирование рейса';

export const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 640;

/**
 * Вход персонажа, пресет `logistics-ready`, затем `route` организации «Альта» (по умолчанию — рабочее место);
 * `off` — владелец отключает «Логистику» с историей (только чтение, D-23). Возвращает id организации.
 */
export async function openFleet(
  app: AppFn,
  page: Page,
  o: { persona?: Persona; route?: string; off?: boolean } = {},
): Promise<string> {
  const persona = o.persona ?? 'manager';
  await app('/', { persona: 'owner' });
  const alta = await tenantId(page);
  await devScenario(page, { preset: 'logistics-ready' });
  if (o.off) await setModule(page, alta, 'fleet', false);
  await app(`/t/${alta}/${o.route ?? 'fleet'}`, { persona });
  return alta;
}

/** Пункт меню по подписи: на телефоне — короткая подпись нижней навигации или «Ещё» → «Все разделы». */
export async function fromMenu(page: Page, label: string, short?: string): Promise<void> {
  if (phone(page)) {
    const bottom = page.getByRole('navigation', { name: 'Навигация', exact: true });
    const direct = bottom.getByRole('button', { name: short ?? label, exact: true });
    if (short && (await direct.count())) await direct.click();
    else {
      await bottom.getByRole('button', { name: 'Ещё' }).click();
      await page
        .getByRole('dialog', { name: 'Все разделы' })
        .getByRole('button', { name: label })
        .click();
    }
  } else {
    await page
      .getByRole('navigation', { name: 'Основная навигация' })
      .getByRole('button', { name: label })
      .click();
  }
}

export const fleet = (page: Page): Locator => page.locator('section[aria-labelledby="h-fleet"]');

export const tabs = (page: Page): Locator => page.getByRole('tablist', { name: 'Рейсы' });

export const tab = (page: Page, name: string | RegExp): Locator =>
  tabs(page).getByRole('tab', { name });

/** Строка машины по модели (первая строка подписи — «{модель} {номер}»). */
export const vehicleRow = (page: Page, model: string): Locator =>
  page.locator('.ox-fl-vehicle').filter({ has: page.locator('.ox-fl-model', { hasText: model }) });

export const vehicleModels = (page: Page): Locator =>
  page.locator('.ox-fl-vehicle .ox-fl-model-name');

/** Значение счётчика по подписи («свободно», «в брони или рейсе», …). */
export const stat = (page: Page, label: string): Locator =>
  page.locator('.ox-fl-stat').filter({ hasText: label }).locator('.ox-fl-stat-value');

/** Карточка рейса: значение строки `<dl>` по термину. */
export const tripValue = (page: Page, term: string): Locator =>
  page.locator('.ox-fl-trip dt', { hasText: term }).locator('xpath=following-sibling::dd[1]');

export const legs = (page: Page): Locator => page.locator('.ox-fl-legs li');

export interface TripLike {
  id: string;
  number: string;
  title: string;
  revision: number;
}

/** Рейсы организации (listTripPlans) из сессии страницы. */
export async function tripPlans(page: Page, tenant: string): Promise<TripLike[]> {
  const r = await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/trip-plans?limit=200`);
  if (r.status !== 200) throw new Error(`listTripPlans ${r.status}`);
  return (r.body as { items: TripLike[] }).items;
}

/** Машины области (listVehicles) из сессии страницы. */
export async function vehicles(
  page: Page,
  tenant: string,
): Promise<{ id: string; displayName: string; orgUnitId: string }[]> {
  const r = await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/vehicles?limit=200`);
  if (r.status !== 200) throw new Error(`listVehicles ${r.status}`);
  return (r.body as { items: { id: string; displayName: string; orgUnitId: string }[] }).items;
}

/**
 * Конфликт брони «за спиной» экрана (эталон: флажок «Конфликт брони» :2787): из сессии логиста создаётся рейс
 * «Конфликтный» под груз ГАЗели и на него назначается `model`. Экран этого не видит, пока не перечитает список.
 */
export async function holdBehindTheScreen(
  page: Page,
  tenant: string,
  model: string,
): Promise<void> {
  const list = await vehicles(page, tenant);
  const v = list.find((x) => x.displayName === model);
  if (!v) throw new Error(`нет машины «${model}»`);
  const window = {
    startsAt: '2026-10-01T15:00:00Z',
    endsAt: '2026-10-01T17:00:00Z',
    timeZone: 'Europe/Moscow',
  };
  const created = await call(page, 'POST', `/api/v1/tenants/${tenant}/fleet/trip-plans`, {
    body: {
      orgUnitId: v.orgUnitId,
      title: 'Конфликтный',
      plannedWindow: window,
      cargo: { description: 'Сухой груз', weightKg: '500', volumeM3: '5', lengthM: '2' },
      stops: [
        { sequence: 1, op: 'load', address: 'Склад № 1, Лобня', weightKg: '500', volumeM3: '5' },
        { sequence: 2, op: 'unload', address: 'Химки', weightKg: '500', volumeM3: '5' },
      ],
    },
  });
  if (created.status !== 201) throw new Error(`createTripPlan ${created.status}`);
  const trip = created.body as TripLike;
  const r = await call(page, 'PUT', `/api/v1/tenants/${tenant}/fleet/trips/${trip.id}/vehicle`, {
    body: { vehicleId: v.id },
    ifMatch: created.headers.etag ?? `"rev-${trip.revision}"`,
  });
  if (r.status !== 200) throw new Error(`assignTripVehicle ${r.status}: ${JSON.stringify(r.body)}`);
}
