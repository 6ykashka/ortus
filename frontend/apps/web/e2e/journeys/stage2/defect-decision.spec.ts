// W2.32 · Выход этапа 2, AC-04 (design/docs/15-quality-security.md): блокирующий дефект или 4 фото из 5 —
// выезд закрыт, `startTrip` 409. Водитель на телефоне проходит осмотр, отмечает критический дефект, владелец на
// «Очереди блокирующих дефектов» назначает исполнителя и срок (W2.46, D-29), менеджер решает «разрешить выезд» —
// водитель выезжает. Анализ 08-requirements.md J3 «Критический дефект», «Незавершённый осмотр».
//   @mock  — одна вкладка (состояние сценарного сервера живёт во вкладке), пресет logistics-ready;
//   @stand — водитель — страница проекта, владелец и менеджер — свои контексты 1440; свой рейс на проект, уборка —
//            выезд, сдача и приёмка смены (logistics.stand.ts closeTrip).
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../_stand/fixtures.ts';
import { actionBar, carCard, DEP_CHECKS } from '../../driver.helpers.ts';
import {
  closeTrip,
  driverTrip,
  label,
  logisticsOn,
  NO_STORAGE,
  plan,
  realClock,
  storageReachable,
  vehicle,
} from '../../logistics.stand.ts';
import { toast } from '../../modules.helpers.ts';
import { call, devScenario, tenantId } from '../../shell.helpers.ts';
import * as J from './journey.ts';

const DEFECTS_H1 = 'Очередь блокирующих дефектов';
const card = (page: Page): Locator =>
  page
    .locator('article')
    .filter({ has: page.getByRole('heading', { level: 2, name: 'Стёкла: Скол' }) });

/** Срок решения: завтра в 12:00 по Москве от `now` — значение `datetime-local` и подпись карточки. */
function deadline(now: number): { input: string; text: string } {
  const msk = new Date(now + 3 * 3_600_000 + 24 * 3_600_000);
  const p = (n: number) => String(n).padStart(2, '0');
  const [y, m, d] = [msk.getUTCFullYear(), p(msk.getUTCMonth() + 1), p(msk.getUTCDate())];
  return { input: `${y}-${m}-${d}T12:00`, text: `${d}.${m}.${y} в 12:00` };
}

/**
 * Водитель: бронь ГАЗели → четыре фото из пяти — «Осталось: 1 фото», выезд закрыт → пятое фото → критический дефект
 * «Стёкла: Скол» → «Отправить на проверку менеджеру» → «Выезд заблокирован».
 */
async function blockingDefect(page: Page, mode: J.Mode, odometer: number): Promise<void> {
  const file = await J.jpeg(page, 'Ортус · дефект W2.32');
  await expect(J.h1(page, 'Моя смена')).toBeVisible({ timeout: 15_000 });
  await carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Забронировать' }).click();
  await expect(toast(page)).toHaveText('Бронь подтверждена сервером. Начните осмотр', J.SERVER);
  await expect(J.h2(page, 'Осмотр перед выездом')).toBeVisible(J.SERVER);
  for (const side of ['Спереди', 'Сзади', 'Слева', 'Справа']) {
    await J.shoot(page, J.slot(page, side), file, `${side}.jpg`);
  }
  await J.untilReady(page, mode, page.getByText('Фото · 4 из 5'));
  await J.fillInspection(page, String(odometer + 130), DEP_CHECKS);
  // AC-04: четыре фото из пяти — выезд закрыт, панель называет недостающее.
  await expect(actionBar(page)).toContainText('Осталось: 1 фото');
  await expect(actionBar(page).getByRole('button', { name: 'Выехать на маршрут' })).toBeDisabled();
  await J.shoot(page, J.slot(page, 'Одометр'), file, 'Одометр.jpg');
  await J.untilReady(page, mode, page.getByText('Фото · 5 из 5'));
  await expect(actionBar(page)).not.toContainText('Осталось');

  await page.getByRole('button', { name: 'Добавить дефект' }).click();
  await page.getByLabel('Где').selectOption('Стёкла');
  await page.getByLabel(/^Описание/).fill('Скол');
  await page.getByLabel('Критический — машина не может выехать').check();
  await page.getByRole('button', { name: 'Добавить', exact: true }).click();
  await expect(actionBar(page)).toContainText(
    'Отмечен критический дефект. Выезд будет заблокирован, осмотр уйдёт менеджеру.',
  );
  await actionBar(page).getByRole('button', { name: 'Отправить на проверку менеджеру' }).click();
  await expect(toast(page)).toHaveText('Выезд заблокирован: дефект отправлен менеджеру', J.SERVER);
  await expect(J.h2(page, 'Выезд заблокирован')).toBeVisible(J.SERVER);
  await expect(
    page.getByText(
      'Критический дефект «Стёкла: Скол» отправлен менеджеру на проверку. Машина недоступна для выезда.',
    ),
  ).toBeVisible();
}

/**
 * AC-04 на сервере: старт рейса по осмотру с открытым блокирующим дефектом — 409 `blocking_defect_open` (не любой
 * конфликт: `invalid_transition` неверного состояния — падение), рейс не в пути. Код — backend `fleet/trips/rules.go`
 * `startable`, MSW `adapter/src/msw/fleet/trips.ts`.
 */
async function startRefused(page: Page, tenant: string, tripId: string): Promise<void> {
  const p = (await plan(page, tenant, tripId)).body as {
    state: string;
    reservationId?: string;
    departureInspectionId?: string;
  };
  expect(p.state).toBe('defect_review');
  const r = await call(page, 'POST', `/api/v1/tenants/${tenant}/fleet/trips`, {
    body: { reservationId: p.reservationId, departureInspectionId: p.departureInspectionId },
  });
  expect([r.status, (r.body as { code?: string }).code], JSON.stringify(r.body)).toEqual([
    409,
    'blocking_defect_open',
  ]);
  expect(((await plan(page, tenant, tripId)).body as { state: string }).state).toBe(
    'defect_review',
  );
}

/** Владелец на «Очереди блокирующих дефектов»: исполнитель Марина Котова и срок решения (W2.46). */
async function assignDefect(
  owner: Page,
  tenant: string,
  trip: string,
  due: { input: string; text: string },
) {
  await owner.goto(`/t/${tenant}/defects`);
  await expect(J.h1(owner, DEFECTS_H1)).toBeVisible({ timeout: 15_000 });
  const c = card(owner).filter({ hasText: `Рейс ${trip} · Илья Васильев` });
  await expect(c).toContainText('Исполнитель не назначен');
  await c.getByLabel('Исполнитель').selectOption({ label: 'Марина Котова' });
  await c.getByLabel('Срок решения').fill(due.input);
  await c.getByRole('button', { name: 'Назначить' }).click();
  await expect(toast(owner)).toHaveText('Исполнитель назначен', J.SERVER);
  await expect(c).toContainText(`Исполнитель: Марина Котова · срок ${due.text}`);
}

/** Менеджер (исполнитель): карточка с исполнителем и сроком, «разрешить выезд» → «Решённые». */
async function allowDeparture(manager: Page, tenant: string, trip: string, due: { text: string }) {
  await manager.goto(`/t/${tenant}/defects`);
  await expect(J.h1(manager, DEFECTS_H1)).toBeVisible({ timeout: 15_000 });
  const c = card(manager).filter({ hasText: `Рейс ${trip} · Илья Васильев` });
  await expect(c).toContainText(`Исполнитель: Марина Котова · срок ${due.text}`);
  await expect(c).toContainText('Отмечен при осмотре перед выездом');
  await c.getByLabel('Комментарий к решению').fill('Скол вне зоны обзора водителя');
  await c.getByRole('button', { name: 'Дефект некритичный — разрешить выезд' }).click();
  await expect(toast(manager)).toHaveText('Выезд разрешён', J.SERVER);
  await expect(c).toHaveCount(0);
  await manager.getByRole('tab', { name: /Решённые/ }).click();
  await expect(card(manager).filter({ hasText: `Рейс ${trip}` })).toContainText('Выезд разрешён');
}

/** Водитель после решения: «Менеджер разрешил выезд…» → «Выехать на маршрут» → «Маршрут». */
async function departs(page: Page): Promise<void> {
  await expect(page.getByText('Менеджер разрешил выезд: дефект признан некритичным')).toBeVisible(
    J.SERVER,
  );
  await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
  await expect(toast(page)).toHaveText('Выезд подтверждён сервером', J.SERVER);
  await expect(J.h2(page, 'Маршрут')).toBeVisible(J.SERVER);
}

test.describe('выход этапа 2 — AC-04 блокирующий дефект @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');

  test('4 фото из 5 — «Осталось: 1 фото», выезд закрыт; критический дефект — «Выезд заблокирован», startTrip 409; исполнитель и срок; «разрешить выезд» — водитель выезжает', async ({
    app,
    page,
  }) => {
    test.setTimeout(180_000);
    await J.mockStorage(page);
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await app(`/t/${alta}/today`, { persona: 'driver' });
    await blockingDefect(page, 'mock', 84370);
    const tripId =
      (
        (await call(page, 'GET', `/api/v1/tenants/${alta}/fleet/trip-plans?limit=200`)).body as {
          items: { id: string; number: string }[];
        }
      ).items.find((p) => p.number === 'Р-208')?.id ?? '';
    await startRefused(page, alta, tripId);

    // Часы сервера сценариев — 01.10.2026 10:30 по Москве: срок — 02.10.2026 в 12:00.
    const due = deadline(Date.parse('2026-10-01T07:30:00Z'));
    await app(`/t/${alta}/home`, { persona: 'owner' });
    await assignDefect(page, alta, 'Р-208', due);
    await app(`/t/${alta}/home`, { persona: 'manager' });
    await allowDeparture(page, alta, 'Р-208', due);
    await app(`/t/${alta}/today`, { persona: 'driver' });
    await departs(page);
  });
});

test.describe('выход этапа 2 — AC-04 блокирующий дефект на стенде @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('водитель на телефоне: 4 фото из 5 и критический дефект; владелец 1440 назначает исполнителя и срок, менеджер разрешает выезд', async ({
    app,
    page,
    browser,
    harness,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(360_000);
    await realClock(page);
    const s = await logisticsOn(session, undo);
    const manager = await J.desktop(browser, harness, 'manager');
    const owner = await J.desktop(browser, harness, 'owner');
    undo('контексты 1440', async () => {
      await manager.close();
      await owner.close();
    });
    await app('/', { persona: 'driver' });
    const trip = await driverTrip(
      page,
      manager.page,
      s,
      `Дефект W2.32 ${label(testInfo.project.name)}`,
    );
    expect(await storageReachable(page, s.tenant, trip.id, harness.allowHosts), NO_STORAGE).toBe(
      true,
    );
    undo(`смена рейса ${trip.number}`, () => closeTrip(page, manager.page, s.tenant, trip.id));
    const gazel = await vehicle(page, s.tenant);

    await app(`/t/${s.tenant}/today`, { persona: 'driver' });
    await blockingDefect(page, 'stand', Number(gazel.odometerKm));
    await startRefused(page, s.tenant, trip.id);

    const due = deadline(Date.now());
    await assignDefect(owner.page, s.tenant, trip.number, due);
    await allowDeparture(manager.page, s.tenant, trip.number, due);
    await page.reload();
    await departs(page);
    expect(((await plan(page, s.tenant, trip.id)).body as { state: string }).state).toBe(
      'on_route',
    );
  });
});
