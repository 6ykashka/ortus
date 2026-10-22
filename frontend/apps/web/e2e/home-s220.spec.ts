// W2.73 · e2e «Главной» логиста: два пункта «Требует решения» S2-20 (D-35; эталон design-2026-10-19b ·
// «Временный водитель - варианты.dc.html» 1g :466–494): водитель ещё не выбрал машину (за 15 минут до срока) и
// нет машины (фирма выдала водителя без машины). Вместе для одного рейса не встречаются. Запрос и решение — владелец
// через API (обычная машина Водителя #104 — правка состояния mock), часы сервера — dev/scenario `now`.
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { card, openHome } from './home.helpers.ts';
import { driverCard, POOL_H1, tripByNumber } from './logistics-pool.helpers.ts';
import {
  apiDecideVehicle,
  apiRequestVehicle,
  patchUsual,
  serverClock,
  tripCars,
} from './logistics-pool-s220.helpers.ts';
import { s220Stand, standRequest, YUG } from './logistics-pool-s220.stand.ts';
import { realClock } from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll } from './modules.helpers.ts';

type AppFn = Parameters<typeof openHome>[0];

const CHOICE = 'Р-211: водитель ещё не выбрал машину';
const NO_VEHICLE = 'Р-211: нет машины';

/** Владелец: Водитель #104 с обычной машиной запрошен на Р-211 (`mode`) и одобрен (`decision`); затем — логист. */
async function decided(
  app: AppFn,
  page: Page,
  mode: 'host_or_home' | 'home',
  decision: 'approve' | 'approve_driver_only',
  now?: string,
): Promise<string> {
  const alta = await openHome(app, page, { persona: 'owner', preset: 'logistics-ready' });
  await patchUsual(page, alta);
  await app(`/t/${alta}/pool`, { persona: 'owner' });
  await driverCard(page, 'Водитель #104').waitFor();
  const x = await apiRequestVehicle(page, alta, mode);
  await apiDecideVehicle(page, alta, x.id, decision);
  if (now) await serverClock(page, now);
  await app(`/t/${alta}/home`, { persona: 'manager' });
  await page.locator('section[aria-labelledby="h-home"]').waitFor();
  return alta;
}

test.describe('home — «Требует решения» S2-20 (1g) @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('за 15 минут до срока: «Р-211: водитель ещё не выбрал машину» → «Оставить Ford Transit»', async ({
    app,
    page,
  }) => {
    // 13:20 по Москве: срок выбора 13:30, пункт — с 13:15.
    const alta = await decided(app, page, 'host_or_home', 'approve', '2026-10-01T10:20:00Z');
    const c = card(page, CHOICE);
    await expect(c).toBeVisible();
    await expect(c).toContainText('до 13:30');
    await expect(c).toContainText(
      'Олег Тарасов, Юг Транс. Не выберет — останется Ford Transit, Hyundai HD-35 вернётся в Юг Транс. Написать водителю можно в чате рейса.',
    );
    await expect(card(page, NO_VEHICLE)).toHaveCount(0);
    const trip = await tripByNumber(page, alta);
    await c.getByRole('button', { name: 'Оставить Ford Transit' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/pool\\?trip=${trip.id}$`));
    const pool = driverCard(page, 'Водитель #104');
    await pool.getByRole('button', { name: 'Оставить Ford Transit' }).click();
    await expect(tripCars(pool).locator('.ox-pl-chip')).toHaveText([
      /Освобождена · 13:20$/,
      /Выбрана · 13:20$/,
    ]);
    await app(`/t/${alta}/home`, { persona: 'manager' });
    await page.locator('section[aria-labelledby="h-home"]').waitFor();
    await page.waitForLoadState('networkidle');
    await expect(card(page, CHOICE)).toHaveCount(0);
  });

  test('до 13:15 пункта о выборе нет (срок выбора 13:30)', async ({ app, page }) => {
    await decided(app, page, 'host_or_home', 'approve');
    await page.waitForLoadState('networkidle');
    await expect(card(page, CHOICE)).toHaveCount(0);
  });

  test('«Только водителя»: «Р-211: нет машины», «рейс в 14:00» → «Поставить машину»', async ({
    app,
    page,
  }) => {
    const alta = await decided(app, page, 'home', 'approve_driver_only');
    const c = card(page, NO_VEHICLE);
    await expect(c).toBeVisible();
    await expect(c).toContainText('рейс в 14:00');
    await expect(c).toContainText(
      'Юг Транс выдал Олега Тарасова без обычной машины. Водитель получит уведомление и сразу начнёт осмотр.',
    );
    await expect(card(page, CHOICE)).toHaveCount(0);
    const trip = await tripByNumber(page, alta);
    await c.getByRole('button', { name: 'Поставить машину' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/fleet\\?trip=${trip.id}$`));
  });

  test('390: пункты без горизонтальной прокрутки, кнопки ≥ 44 px', async ({ app, page }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 640, 'только телефон');
    await decided(app, page, 'home', 'approve_driver_only');
    const c = card(page, NO_VEHICLE);
    await expect(c).toBeVisible();
    expect(
      await hitHeight(c.getByRole('button', { name: 'Поставить машину' })),
    ).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

// Стенд (контракт 0.6.3-stage2, источник «Главной» fleet W2.72): Котова запрашивает водителя «Юг Транс» на свой рейс
// с его обычной машиной («Своя машина водителя», API), владелец одобряет только водителя — рейс без машины попадает в
// «Требует решения» логиста. Пункт «водитель ещё не выбрал машину» — за 15 минут до срока выбора: рейсы стенда — через
// 4–7 суток, часов сервера стенд не двигает (его проверяют mock-строки выше и интеграционные тесты W2.72).
test.describe('home — «Требует решения» S2-20 на стенде @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(180_000);

  test('логист на стенде: «{рейс}: нет машины» после «Только водителя» → «Поставить машину»', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    await realClock(page);
    const s = await s220Stand(session, undo, testInfo.project.name);
    await app(`/t/${s.tenant}/pool?trip=${s.trip.id}`, { persona: 'manager' });
    await expect(h1(page, POOL_H1)).toBeVisible({ timeout: 15_000 });
    const x = await standRequest(page, s, 'home');
    await apiDecideVehicle(s.owner, s.tenant, x.id, 'approve_driver_only');
    await app(`/t/${s.tenant}/home`, { persona: 'manager' });
    await page.locator('section[aria-labelledby="h-home"]').waitFor();
    const title = `${s.trip.number}: нет машины`;
    const c = card(page, title);
    await expect(c).toBeVisible({ timeout: 15_000 });
    await expect(c).toContainText(/рейс в \d\d:\d\d/);
    await expect(c).toContainText(`${YUG} выдал`);
    await expect(c).toContainText(
      'без обычной машины. Водитель получит уведомление и сразу начнёт осмотр.',
    );
    await expect(card(page, `${s.trip.number}: водитель ещё не выбрал машину`)).toHaveCount(0);
    await c.getByRole('button', { name: 'Поставить машину' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${s.tenant}/fleet\\?trip=${s.trip.id}$`));
  });
});
