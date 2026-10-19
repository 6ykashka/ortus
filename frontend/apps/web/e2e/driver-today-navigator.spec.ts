// W2.50 · e2e ссылки «Передать в навигатор» на `driver-today` (D-11 комплекта: заменитель интеграции навигатора —
// deeplink Яндекс Карт по адресу остановки без внешнего API, Q-W2.52-12; бриф W2.50 §1 п. 3, §5). Адрес — адрес для
// навигатора остановки (TripStop.navigationAddress, createTripPlan), без него — адрес точки. Эталон design-stage-2:
// кнопка «Передать в навигатор · интеграция не подключена» у логиста (pg.fleet :514) — у водителя ссылки в эталоне
// нет (no-reference, allowlist driver-today.md).
import type { Page } from '@playwright/test';

import { depart, openDriver } from './driver.helpers.ts';
import { expect, test } from './_stand/fixtures.ts';
import {
  apiDeparture,
  apiStart,
  closeTrip,
  driverTrip,
  label,
  logisticsOn,
  NO_STORAGE,
  persona,
  plan,
  realClock,
  storageReachable,
} from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll } from './modules.helpers.ts';
import { call } from './shell.helpers.ts';

const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 640;
const nav = (page: Page) => page.getByRole('link', { name: /^Передать в навигатор/ });
const url = (address: string): string =>
  `https://yandex.ru/maps/?rtext=~${encodeURIComponent(address)}&rtype=auto`;
const ADDRESSES = [
  'Склад № 1, Лобня',
  'Химки, ул. Заводская, 8',
  'Долгопрудный, Лихачёвский пр., 4',
] as const;

test.describe('driver-today — «Передать в навигатор» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');
  test.setTimeout(90_000);

  test('маршрут: у каждой остановки ссылка «Передать в навигатор» — Яндекс Карты по адресу, новая вкладка', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await depart(page);
    await expect(nav(page)).toHaveCount(3);
    for (const [i, address] of ADDRESSES.entries()) {
      const link = nav(page).nth(i);
      // Новая вкладка — в доступном имени и значком (WCAG G201, ревью W2.50-r1).
      await expect(link).toHaveAccessibleName(
        `Передать в навигатор: ${address} (откроется в новой вкладке)`,
      );
      await expect(link).toHaveText('Передать в навигаторopen_in_new');
      await expect(link.locator('.material-symbols-rounded')).toHaveAttribute(
        'aria-hidden',
        'true',
      );
      await expect(link).toHaveAttribute('href', url(address));
      await expect(link).toHaveAttribute('target', '_blank');
      await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    }
  });

  test('переход по ссылке открывает новую вкладку с адресом точки; экран смены остаётся', async ({
    app,
    page,
    context,
  }) => {
    await openDriver(app, page, 'today');
    await depart(page);
    // Внешний хост в e2e не нужен: вкладка навигатора отвечает пустой страницей.
    await context.route('https://yandex.ru/**', (r) =>
      r.fulfill({ status: 200, contentType: 'text/html', body: '<title>maps</title>' }),
    );
    const opened = context.waitForEvent('page');
    await nav(page).first().click();
    const tab = await opened;
    await tab.waitForLoadState();
    expect(tab.url()).toBe(url(ADDRESSES[0]));
    await tab.close();
    await expect(page.getByRole('heading', { level: 2, name: 'Маршрут' })).toBeVisible();
    await expect(page.getByText('Отмечено 0 из 3')).toBeVisible();
  });

  test('клавиатура: Tab от «Прибыл» доходит до ссылки навигатора; фокус виден', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await depart(page);
    const arrived = page.getByRole('button', { name: 'Прибыл' }).first();
    await arrived.focus();
    const target = nav(page).nth(1);
    let reached = false;
    for (let i = 0; i < 6 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  });

  test('axe без serious/critical; 390 — цель ссылки ≥ 44 px, без прокрутки вбок', async ({
    app,
    page,
    axe,
  }) => {
    await openDriver(app, page, 'today');
    await depart(page);
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) {
      expect(await hitHeight(nav(page).first())).toBeGreaterThanOrEqual(44);
    }
  });
});

// Backend адреса для навигатора (W2.50: fleet/routes, fleet/trips) — в ветке W2.50; остановка, маршрут и выезд
// водителя на стенде — W2.02–W2.05 в main.
test.describe('driver-today — «Передать в навигатор» стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('стенд: createTripPlan хранит адрес для навигатора, getTripPlan отдаёт его', async ({
    page,
    session,
    undo,
    app,
  }, testInfo) => {
    const s = await logisticsOn(session, undo);
    const manager = await persona(session, 'manager');
    await app('/', { persona: 'manager' });
    const start = Date.now() + 30 * 24 * 3600_000;
    const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const r = await call(manager, 'POST', `/api/v1/tenants/${s.tenant}/fleet/trip-plans`, {
      body: {
        orgUnitId: s.unitId,
        title: `Навигатор ${label(testInfo.project.name)}`,
        plannedWindow: {
          startsAt: iso(start),
          endsAt: iso(start + 7200_000),
          timeZone: 'Europe/Moscow',
        },
        cargo: { description: 'Сухой груз', weightKg: '100', volumeM3: '1', lengthM: '1' },
        stops: [
          {
            sequence: 1,
            op: 'load',
            address: 'Склад № 1 · ворота 3',
            navigationAddress: '  Лобня, ул. Лейтенанта Бакина, 1 ',
            weightKg: '100',
            volumeM3: '1',
          },
          {
            sequence: 2,
            op: 'unload',
            address: 'Химки, ул. Заводская, 8',
            weightKg: '100',
            volumeM3: '1',
          },
        ],
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const id = (r.body as { id: string }).id;
    undo(`рейс навигатора ${id}`, () => closeTrip(page, manager, s.tenant, id));
    const got = (await plan(manager, s.tenant, id)).body as {
      stops: { navigationAddress?: string }[];
    };
    expect(got.stops.map((x) => x.navigationAddress ?? null)).toEqual([
      'Лобня, ул. Лейтенанта Бакина, 1',
      null,
    ]);
  });

  test('стенд: водитель в рейсе — ссылки навигатора у остановок своего рейса', async ({
    app,
    page,
    session,
    undo,
    harness,
  }, testInfo) => {
    test.setTimeout(240_000);
    await realClock(page);
    const s = await logisticsOn(session, undo);
    const manager = await persona(session, 'manager');
    await app('/', { persona: 'driver' });
    const trip = await driverTrip(page, manager, s, `Навигатор ${label(testInfo.project.name)}`);
    test.skip(!(await storageReachable(page, s.tenant, trip.id, harness.allowHosts)), NO_STORAGE);
    undo(`бронь рейса ${trip.number}`, () => closeTrip(page, manager, s.tenant, trip.id));
    await apiStart(page, s.tenant, await apiDeparture(page, s.tenant, trip));
    await app(`/t/${s.tenant}/today`, { persona: 'driver' });
    await expect(h1(page, 'Моя смена')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { level: 2, name: 'Маршрут' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(nav(page)).toHaveCount(3);
    await expect(nav(page).first()).toHaveAttribute('href', url(ADDRESSES[0]));
  });
});
