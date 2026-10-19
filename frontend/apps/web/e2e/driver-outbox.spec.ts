// W2.24 · e2e страницы `driver-outbox` «Очередь отправки» — состояния «Сегодня» водителя без связи (эталон
// design-stage-2, «Ортус CRM.dc.html» pg.today :656, расходы :776, dr.sQueued :815–822, photoVM :3382, localExp :3454,
// bannersVM :3089–3090, flush :2553–2577;
// 03-logistics.md §10, §14 п. 26, 37, 40; S2-15, D-09 / ADR-0010). Связь рвёт `context.setOffline`; в режиме mock
// ответы даёт service worker MSW — очередь решает по navigator.onLine, сбой посреди отправки — сценарий offline.
import type { Page } from '@playwright/test';

import {
  actionBar,
  carCard,
  choosePhoto,
  DEP_CHECKS,
  fillInspection,
  finishDialog,
  openDriver,
  RET_CHECKS,
  reserve,
  SIDES,
} from './driver.helpers.ts';
import { expect, test } from './_stand/fixtures.ts';
import {
  closeTrip,
  driverTrip,
  label,
  logisticsOn,
  persona,
  plan,
  realClock,
  vehicle,
} from './logistics.stand.ts';
import { hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import {
  banner,
  commands,
  departed,
  expenseOffline,
  expenseRow,
  finishRoute,
  h2,
  jpeg,
  keysOf,
  net,
  photosOffline,
  photosOnline,
  savedDrafts,
  scanFor,
  shoot,
  slot,
} from './outbox.helpers.ts';
import { call, devScenario, tenantId } from './shell.helpers.ts';

const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 640;
const ready = (page: Page) => page.locator('.ox-dr-slot-status').filter({ hasText: 'Загружено' });
const queuedCard = (page: Page) =>
  page.locator('[role="status"]').filter({ has: h2(page, 'Сдача сохранена на устройстве') });

const OFFLINE_RETURN =
  'Нет связи: сдача сохранится на устройстве и отправится позже. До подтверждения сервера машина не считается сданной.';

async function expensesOnServer(page: Page): Promise<number> {
  const id = await tenantId(page);
  const plans = await call(page, 'GET', `/api/v1/tenants/${id}/fleet/trip-plans?limit=100`);
  const trip = (plans.body as { items: { id: string; number: string }[] }).items.find(
    (t) => t.number === 'Р-208',
  );
  const r = await call(page, 'GET', `/api/v1/tenants/${id}/fleet/trips/${trip?.id ?? ''}/expenses`);
  return (r.body as { items: unknown[] }).items.length;
}

test.describe('driver-outbox — офлайн-черновики и очередь отправки @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');
  // Путь с загрузками фото и проверкой файлов — дольше 30 с под нагрузкой общего ПК.
  test.describe.configure({ timeout: 120_000 });

  test('фото без связи: «На устройстве · ждёт связи», «Фото · N из 5», выезд недоступен', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await reserve(page);
    await net(page, false);
    await choosePhoto(page, slot(page, 'Спереди'));
    await expect(page.getByText('На устройстве · ждёт связи')).toBeVisible();
    await expect(page.getByText('Фото · 1 из 5')).toBeVisible();
    await expect(slot(page, 'Спереди')).toHaveAccessibleName(
      'Спереди: На устройстве · ждёт связи. Нажмите, чтобы снять или выбрать фото',
    );
    await expect(slot(page, 'Спереди')).toHaveCSS('border-top-style', 'dashed');
    await expect(slot(page, 'Спереди')).toHaveCSS('border-top-color', 'rgb(183, 121, 31)');
    await expect(actionBar(page)).toContainText(
      'Нет связи: выезд требует подтверждения сервера. Черновик сохранён на устройстве.',
    );
    await expect(actionBar(page)).toContainText('Осталось: 4 фото');
    await expect(
      actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }),
    ).toBeDisabled();
    await net(page, true);
  });

  test('связь появилась: фото загружаются сами, «Загружено», выезд доступен', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await reserve(page);
    await net(page, false);
    await photosOffline(page);
    await fillInspection(page, '84500', DEP_CHECKS);
    await expect(
      actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }),
    ).toBeDisabled();
    await net(page, true);
    await expect(async () => {
      await call(page, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } });
      await expect(ready(page)).toHaveCount(5, { timeout: 1000 });
    }).toPass({ timeout: 30_000 });
    await expect(page.getByText('На устройстве · ждёт связи')).toHaveCount(0);
    await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
    await expect(toast(page)).toHaveText('Выезд подтверждён сервером');
    await expect(h2(page, 'Маршрут')).toBeVisible();
  });

  test('черновик осмотра на устройстве: перезагрузка — фото, пробег и чек-лист на месте', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await reserve(page);
    await photosOnline(page);
    await fillInspection(page, '84500', DEP_CHECKS.slice(0, 2));
    await expect
      .poll(async () => (await savedDrafts(page)).map((d) => d.odometer))
      .toEqual(['84500']);
    await page.reload();
    await expect(h2(page, 'Осмотр перед выездом')).toBeVisible();
    await expect(page.getByLabel(/^Пробег по одометру, км/)).toHaveValue('84500');
    await expect(page.getByRole('button', { name: '½', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByLabel(DEP_CHECKS[0], { exact: true })).toBeChecked();
    await expect(page.getByLabel(DEP_CHECKS[2], { exact: true })).not.toBeChecked();
    await expect(page.getByText('Фото · 5 из 5')).toBeVisible();
    await expect(ready(page)).toHaveCount(5);
    await expect(actionBar(page)).toContainText('Осталось: 1 пункт чек-листа');
  });

  test('расход без связи: «Сохранить на устройстве», тост, «Локальный черновик», «На устройстве», баннер (ожидают отправки: 1)', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await departed(page);
    const posts = commands(page, 'POST', /\/expenses$/);
    await net(page, false);
    await expenseOffline(page);
    await expect(toast(page)).toHaveText(
      'Расход сохранён на устройстве. Отправится при появлении связи',
    );
    const row = expenseRow(page, 'Мойка · 400 ₽');
    await expect(row).toContainText('Локальный черновик');
    await expect(row.locator('.ox-dr-chip')).toContainText('На устройстве');
    await expect(banner(page, 'Нет связи.').locator('.ox-banner-body')).toHaveText(
      'Нет связи. Черновики, фото и расходы сохраняются на устройстве (ожидают отправки: 1). Бронь, выезд и приёмка требуют подтверждения сервера.',
    );
    expect(posts.list()).toEqual([]);
    await net(page, true);
  });

  test('связь появилась: «Связь восстановлена.», расход «— принято сервером», «Принято сервером»', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await departed(page);
    await net(page, false);
    await expenseOffline(page);
    // Возврат 2 (флейк :158): баннер виден, пока очередь отправляет, — ответ createTripExpense придерживается
    // сценарием, проверка баннера не зависит от скорости отправки.
    await devScenario(page, { scenario: 'createTripExpense=delay=4000' });
    await net(page, true);
    await expect(banner(page, 'Связь восстановлена.').locator('.ox-banner-body')).toHaveText(
      'Связь восстановлена. Отправляем сохранённые на устройстве операции…',
    );
    await expect(banner(page, 'Связь восстановлена.')).toHaveCSS(
      'background-color',
      'rgb(231, 238, 246)',
    );
    await scanFor(page, page.getByText('Мойка 400 ₽ — принято сервером'));
    await devScenario(page, { scenario: null });
    await expect(expenseRow(page, 'Мойка · 400 ₽').locator('.ox-dr-chip')).toContainText(
      'Принято сервером',
    );
    await expect(page.getByText('Локальный черновик')).toHaveCount(0);
    await expect(banner(page, 'Связь восстановлена.')).toHaveCount(0);
    expect(await expensesOnServer(page)).toBe(1);
  });

  test('ошибка отправки расхода: чип «Ошибка», тост «{операция}: {сообщение}», «Повторить» — тот же Idempotency-Key', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await departed(page);
    const posts = commands(page, 'POST', /\/expenses$/);
    await net(page, false);
    await expenseOffline(page);
    await devScenario(page, { scenario: 'createTripExpense=validation_failed' });
    await net(page, true);
    const row = expenseRow(page, 'Мойка · 400 ₽');
    await scanFor(page, row.locator('.ox-dr-chip', { hasText: 'Ошибка' }));
    await expect(toast(page)).toHaveText(/^Мойка 400 ₽: /);
    await devScenario(page, { scenario: null });
    await row.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Мойка 400 ₽ — принято сервером')).toBeVisible();
    const keys = await keysOf(posts.list());
    expect(keys.length).toBeGreaterThanOrEqual(2);
    expect(new Set(keys).size).toBe(1);
    expect(await expensesOnServer(page)).toBe(1);
  });

  test('сбой сети посреди отправки: расход снова «На устройстве», без тоста ошибки', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await departed(page);
    const posts = commands(page, 'POST', /\/expenses$/);
    await net(page, false);
    await expenseOffline(page);
    await devScenario(page, { scenario: 'createTripExpense=offline' });
    await net(page, true);
    const row = expenseRow(page, 'Мойка · 400 ₽');
    await expect(async () => {
      await call(page, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } });
      expect(posts.list().length).toBeGreaterThan(0);
    }).toPass({ timeout: 30_000 });
    await expect(row.locator('.ox-dr-chip')).toContainText('На устройстве');
    await expect(toast(page)).not.toHaveText(/^Мойка 400 ₽: /);
    await devScenario(page, { scenario: null });
    // Связь «моргнула» — очередь отправляет снова.
    await net(page, false);
    await net(page, true);
    await expect(page.getByText('Мойка 400 ₽ — принято сервером')).toBeVisible();
    const keys = await keysOf(posts.list());
    expect(new Set(keys).size).toBe(1);
  });

  test('сдача без связи: панель, «Сохранить сдачу на устройстве», карточка «Сдача сохранена на устройстве», «Ожидает отправки»', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await departed(page);
    await finishRoute(page);
    await net(page, false);
    await photosOffline(page);
    await fillInspection(page, '84560', RET_CHECKS);
    await expect(actionBar(page)).toContainText(OFFLINE_RETURN);
    const save = actionBar(page).getByRole('button', { name: 'Сохранить сдачу на устройстве' });
    await expect(save).toBeEnabled();
    await save.click();
    await expect(toast(page)).toHaveText('Сдача сохранена на устройстве и ещё не принята сервером');
    await expect(queuedCard(page)).toContainText(
      'Сервер ещё не принял сдачу, поэтому машина не считается сданной. Отправка начнётся автоматически, когда появится связь.',
    );
    await expect(queuedCard(page).locator('.ox-ob-chip')).toHaveText('Ожидает отправки');
    await expect(queuedCard(page)).toHaveCSS('border-top-style', 'dashed');
    await expect(h2(page, 'Осмотр при сдаче')).toHaveCount(0);
    await expect(h2(page, 'Расходы')).toHaveCount(0);
    await expect(banner(page, 'Нет связи.')).toContainText('(ожидают отправки: 1)');
    await net(page, true);
  });

  test('связь появилась: «Сдача машины — принято сервером», «Ожидает приёмки менеджером»', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await departed(page);
    await finishRoute(page);
    await net(page, false);
    await photosOffline(page);
    await fillInspection(page, '84560', RET_CHECKS);
    await actionBar(page).getByRole('button', { name: 'Сохранить сдачу на устройстве' }).click();
    await expect(queuedCard(page)).toBeVisible();
    await net(page, true);
    await scanFor(page, h2(page, 'Ожидает приёмки менеджером'));
    await expect(page.locator('.ox-dr-summary')).toContainText('Пройдено 60 км');
    await expect(queuedCard(page)).toHaveCount(0);
  });

  test('очередь переживает перезагрузку: сдача на устройстве уходит после запуска со связью', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await departed(page);
    await finishRoute(page);
    const inspections = commands(page, 'POST', /\/fleet\/inspections$/);
    const returns = commands(page, 'PATCH', /\/fleet\/trips\/[^/]+$/);
    await net(page, false);
    await photosOffline(page);
    await fillInspection(page, '84560', RET_CHECKS);
    await actionBar(page).getByRole('button', { name: 'Сохранить сдачу на устройстве' }).click();
    await expect(queuedCard(page)).toBeVisible();
    // Сдача (returnTrip) не проходит: осмотр принят, сдача остаётся на устройстве.
    await devScenario(page, { scenario: 'returnTrip=offline' });
    await net(page, true);
    await expect(async () => {
      await call(page, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } });
      expect(returns.list().length).toBeGreaterThan(0);
    }).toPass({ timeout: 30_000 });
    await expect(queuedCard(page).locator('.ox-ob-chip')).toHaveText('Ожидает отправки');
    await page.reload();
    await expect(queuedCard(page)).toBeVisible();
    await devScenario(page, { scenario: null });
    await net(page, false);
    await net(page, true);
    await expect(h2(page, 'Ожидает приёмки менеджером')).toBeVisible();
    expect(inspections.list()).toHaveLength(1);
    const keys = await keysOf(returns.list());
    expect(new Set(keys).size).toBe(1);
  });

  // Возврат 2 (minor ревью): «Завершить рейс» — повтор после сбоя с тем же Idempotency-Key, как остальные команды
  // экрана (Q-W2.22-9).
  test('«Завершить рейс»: повтор после сбоя сети — тот же Idempotency-Key', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await departed(page);
    const posts = commands(page, 'POST', /\/route-completion$/);
    await devScenario(page, { scenario: 'finishTripRoute=offline' });
    await actionBar(page).getByRole('button', { name: 'Завершить рейс' }).click();
    const dialog = finishDialog(page);
    const confirm = dialog.getByRole('button', { name: 'Завершить рейс' });
    await confirm.click();
    await expect.poll(() => posts.list().length).toBe(1);
    await expect(confirm).toBeEnabled();
    await devScenario(page, { scenario: null });
    await confirm.click();
    await expect(h2(page, 'Осмотр при сдаче')).toBeVisible();
    const keys = await keysOf(posts.list());
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  test('бронь без связи недоступна; выезд без связи недоступен (D-09)', async ({ app, page }) => {
    await openDriver(app, page, 'today');
    await expect(carCard(page, 'ГАЗель Next')).toBeVisible();
    await net(page, false);
    await expect(page.getByText('Нет связи: бронь требует подтверждения сервера.')).toBeVisible();
    await expect(
      carCard(page, 'ГАЗель Next').getByRole('button', { name: 'Бронь недоступна' }),
    ).toBeDisabled();
    await net(page, true);
    await reserve(page);
    await photosOnline(page);
    await fillInspection(page, '84500', DEP_CHECKS);
    await net(page, false);
    await expect(
      actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }),
    ).toBeDisabled();
    await net(page, true);
  });

  test('клавиатура: «Повторить» достижим Tab, Enter отправляет; фокус виден', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    await departed(page);
    await net(page, false);
    await expenseOffline(page);
    await devScenario(page, { scenario: 'createTripExpense=validation_failed' });
    await net(page, true);
    const row = expenseRow(page, 'Мойка · 400 ₽');
    const retry = row.getByRole('button', { name: 'Повторить' });
    await scanFor(page, retry);
    await devScenario(page, { scenario: null });
    // Порядок обхода: «Добавить расход» в шапке блока, затем «Повторить» строки на устройстве.
    await page.getByRole('button', { name: 'Добавить расход' }).focus();
    await page.keyboard.press('Tab');
    await expect(retry).toBeFocused();
    await expect(retry).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Мойка 400 ₽ — принято сервером')).toBeVisible();
  });

  test('axe без serious/critical: осмотр, расходы, карточка сдачи без связи; 390 — цели ≥ 44 px, без прокрутки вбок', async ({
    app,
    page,
    axe,
  }) => {
    const serious = async () =>
      (await axe(page)).violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
    await openDriver(app, page, 'today');
    await reserve(page);
    await net(page, false);
    await choosePhoto(page, slot(page, 'Спереди'));
    await expect(page.getByText('На устройстве · ждёт связи')).toBeVisible();
    expect(await serious()).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    await net(page, true);
    await scanFor(page, ready(page).first());
    for (const side of ['Сзади', 'Слева', 'Справа', 'Одометр']) {
      await choosePhoto(page, slot(page, side));
    }
    await scanFor(page, page.getByText('Фото · 5 из 5'));
    await expect(ready(page)).toHaveCount(5);
    await fillInspection(page, '84500', DEP_CHECKS);
    await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
    await expect(h2(page, 'Маршрут')).toBeVisible();
    await net(page, false);
    await expenseOffline(page);
    await expect(expenseRow(page, 'Мойка · 400 ₽')).toBeVisible();
    expect(await serious()).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    await net(page, true);
    await scanFor(page, page.getByText('Мойка 400 ₽ — принято сервером'));
    await finishRoute(page);
    await net(page, false);
    await photosOffline(page);
    await fillInspection(page, '84560', RET_CHECKS);
    const save = actionBar(page).getByRole('button', { name: 'Сохранить сдачу на устройстве' });
    if (phone(page)) {
      await expect(toast(page)).toBeHidden({ timeout: 10_000 });
      expect(await hitHeight(save)).toBeGreaterThanOrEqual(44);
    }
    await save.click();
    await expect(queuedCard(page)).toBeVisible();
    // Возврат 1 (major): карточка без команд — цель Tab, axe без исключений (scrollable-region-focusable на 390).
    expect(await serious()).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    await net(page, true);
  });

  test('сдача на устройстве без команд: карточка — цель Tab, фокус виден; axe без исключений', async ({
    app,
    page,
    axe,
  }) => {
    await openDriver(app, page, 'today');
    await departed(page);
    await finishRoute(page);
    await net(page, false);
    await photosOffline(page);
    await fillInspection(page, '84560', RET_CHECKS);
    await actionBar(page).getByRole('button', { name: 'Сохранить сдачу на устройстве' }).click();
    const card = queuedCard(page);
    await expect(card.locator('.ox-ob-chip')).toHaveText('Ожидает отправки');
    await expect(card.getByRole('button')).toHaveCount(0);
    await expect(card).toHaveAttribute('tabindex', '0');
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
    // С клавиатуры: шаг назад и снова вперёд — фокус на карточке, рамка фокуса видна.
    await card.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(card).toBeFocused();
    await expect(card).toHaveCSS('outline-style', 'solid');
    await net(page, true);
  });
});

// Возврат интегратора 1 (major): строка идёт на всех трёх проектах прогона без пропуска. Сид e2e-stand
// («Логистика» в «Альте», менеджер), свой рейс водителя на проект и уборка — logistics.stand.ts, как driver-today,
// driver-cars и modal-finish-route: после сдачи рейс принимается в уборке, следующий проект берёт новый рейс.
test.describe('driver-outbox — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('водитель на стенде без связи: расход и сдача на устройстве уходят после связи', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(400_000);
    // Стенд живёт по настоящим часам (окна рейсов — от «сейчас» сервера).
    await realClock(page);
    const s = await logisticsOn(session, undo);
    const manager = await persona(session, 'manager');
    await app('/', { persona: 'driver' });
    const trip = await driverTrip(page, manager, s, `Стенд ${label(testInfo.project.name)}`);
    // Упавшая строка могла оставить страницу без связи — уборка идёт запросами страницы водителя.
    undo(`смена рейса ${trip.number}`, async () => {
      await net(page, true);
      await closeTrip(page, manager, s.tenant, trip.id);
    });
    const gazel = await vehicle(page, s.tenant);
    const departure = Number(gazel.odometerKm) + 130;
    await app(`/t/${s.tenant}/today`, { persona: 'driver' });
    const file = await jpeg(page);
    await expect(page.getByText(`${trip.number} · ${trip.title}`)).toBeVisible({ timeout: 15_000 });
    await expect(h2(page, 'Выберите машину')).toBeVisible();
    await reserve(page);
    for (const side of SIDES) await shoot(page, slot(page, side), file, `${side}.jpg`);
    await expect(ready(page)).toHaveCount(5, { timeout: 90_000 });
    await fillInspection(page, String(departure), DEP_CHECKS);
    await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
    await expect(h2(page, 'Маршрут')).toBeVisible({ timeout: 15_000 });

    // Расход без связи — настоящий обрыв сети (на стенде нет MSW).
    await net(page, false);
    await page.getByRole('button', { name: 'Добавить расход' }).click();
    await page.getByLabel('Категория').selectOption('wash');
    await page.getByLabel(/^Сумма, ₽/).fill('400');
    await shoot(page, page.getByRole('button', { name: /^Чек: / }), file, 'receipt.jpg');
    await page.getByRole('button', { name: 'Сохранить на устройстве' }).click();
    await expect(expenseRow(page, 'Мойка · 400 ₽')).toContainText('Локальный черновик');
    await expect(banner(page, 'Нет связи.')).toContainText('(ожидают отправки: 1)');
    await net(page, true);
    await expect(expenseRow(page, 'Мойка · 400 ₽').locator('.ox-dr-chip')).toContainText(
      'Принято сервером',
      { timeout: 120_000 },
    );

    // Сдача без связи.
    await finishRoute(page);
    await net(page, false);
    for (const side of SIDES) await shoot(page, slot(page, side), file, `${side}.jpg`);
    await expect(page.getByText('Фото · 5 из 5')).toBeVisible();
    await fillInspection(page, String(departure + 60), RET_CHECKS);
    await actionBar(page).getByRole('button', { name: 'Сохранить сдачу на устройстве' }).click();
    await expect(queuedCard(page).locator('.ox-ob-chip')).toHaveText('Ожидает отправки');
    await net(page, true);
    await expect(h2(page, 'Ожидает приёмки менеджером')).toBeVisible({ timeout: 180_000 });
    await expect(page.locator('.ox-dr-summary')).toContainText('Пройдено 60 км');
    const after = await plan(manager, s.tenant, trip.id);
    expect((after.body as { state: string }).state).toBe('submitted');
  });
});
