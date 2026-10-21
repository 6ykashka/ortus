// W2.74 · e2e `driver-today` (h1 «Моя смена») — машины на выбор временному водителю (S2-20, D-35; макеты
// «Временный водитель - варианты.dc.html» 1c–1e, тег design-2026-10-19b): «Выберите машину» из предложенных, лист
// «Берёте …?», осмотр на выбранной машине со статусом брони; одна машина — «Машина на сегодня» и «Начать осмотр»;
// машины нет — «Машину ещё не поставили»; выбор только со связью (D-09); 409 offer_closed — сообщение и перечитывание;
// «Подтвердить бронь» и «Забронировать» у временного водителя нет, «Автомобили» — только предложенные, у начатого рейса
// — без списка машин (возврат 1). Mock — сюжет driver-offer.helpers.ts (`openOffer`); стенд — backend S2-20 W2.72
// (`standOffer`); журни дня S2-20 на стенде пишет W2.75.
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { actionBar, DEP_CHECKS, fillInspection, fivePhotos } from './driver.helpers.ts';
import {
  AFTER_DEADLINE,
  ELF,
  IN_WINDOW,
  offerCard,
  offerSheet,
  openOffer,
  serverNow,
  SPRINTER,
  standOffer,
  until,
} from './driver-offer.helpers.ts';
import * as J from './journeys/stage2/journey.ts';
import { realClock } from './logistics.stand.ts';
import { hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { call, devScenario } from './shell.helpers.ts';

/** Ответ сервера под нагрузкой стенда — дольше 5 с ожидания по умолчанию. */
const STAND = { timeout: 15_000 };

const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 640;
const h2 = (page: Page, name: string) => page.getByRole('heading', { level: 2, name });
const current = (page: Page) =>
  page.getByRole('list', { name: 'Этапы смены' }).locator('[aria-current="step"]');
const take = (page: Page, model: string) =>
  offerCard(page, model).getByRole('button', { name: 'Взять эту машину' });
const OFFER_CLOSED = 'Выбор машины уже закрыт: срок прошёл или машина выбрана. Обновите смену.';

/** У временного водителя нет «Подтвердить бронь» и «Забронировать» (вариант (a) D-35 отклонён). */
async function noBooking(page: Page): Promise<void> {
  await expect(page.getByRole('button', { name: 'Подтвердить бронь' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Забронировать' })).toHaveCount(0);
}

async function seriousAxe(
  axe: (page: Page) => Promise<{ violations: { id: string; impact?: string | null }[] }>,
  page: Page,
): Promise<string[]> {
  return (await axe(page)).violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => v.id);
}

test.describe('driver-today — машины на выбор временному водителю @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и часы — сценарный сервер mock');
  test.describe.configure({ timeout: 120_000 });

  test('1c: «Выберите машину» — две предложенные машины, срок 13:30, без чужих машин и брони', async ({
    app,
    page,
    axe,
  }) => {
    const { trip } = await openOffer(app, page, 'two');
    await expect(page.getByText(`${trip.number} · ${trip.title}`)).toBeVisible();
    await expect(page.locator('.ox-dr-trip .ox-dr-chip')).toHaveText(/Выберите машину/);
    await expect(current(page)).toHaveText('1Машина');
    await expect(h2(page, 'Выберите машину')).toBeVisible();
    await expect(page.getByText('До 13:30. Вторую бронь снимем сразу после выбора.')).toBeVisible();
    await expect(page.locator('article.ox-dr-offer .ox-dr-car-model')).toHaveText([
      SPRINTER.model,
      ELF.model,
    ]);
    await expect(offerCard(page, ELF.model)).toContainText(ELF.plate);
    await expect(offerCard(page, ELF.model)).toContainText('Поставил логист');
    await expect(offerCard(page, SPRINTER.model)).toContainText('Ваша обычная');
    for (const m of [ELF.model, SPRINTER.model]) {
      await expect(offerCard(page, m)).toContainText(
        'Подходит рейсу: масса, объём, длина, температура',
      );
      await expect(take(page, m)).toBeEnabled();
    }
    await expect(
      page.getByText(`Нужна другая машина — напишите логисту в чат рейса ${trip.number}.`),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: /чат рейса/ })).toHaveCount(0);
    await noBooking(page);
    // Других машин фирмы рейса и машин своей фирмы на «Моей смене» нет.
    await expect(page.locator('article')).toHaveCount(2);
    // Возврат 1: обычная машина выделена сразу, как pick = 'home' кадра 1c (card() :578–581).
    await expect(offerCard(page, SPRINTER.model)).toHaveAttribute('data-picked', 'true');
    await expect(offerCard(page, ELF.model)).not.toHaveAttribute('data-picked', 'true');
    if (phone(page)) expect(await hitHeight(take(page, ELF.model))).toBeGreaterThanOrEqual(44);
    expect(await seriousAxe(axe, page)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('1d: «Взять эту машину» → лист «Берёте …?» с последствиями; «Назад» и Escape закрывают', async ({
    app,
    page,
    axe,
  }) => {
    await openOffer(app, page, 'two');
    await take(page, SPRINTER.model).click();
    const sheet = offerSheet(page);
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { name: `Берёте ${SPRINTER.model}?` })).toBeVisible();
    await expect(sheet).toContainText(`${SPRINTER.plate} · ваша обычная`);
    await expect(sheet.locator('li > span:last-child')).toHaveText([
      `Бронь ${ELF.model} ${ELF.plate} снимется, машина вернётся в свою фирму.`,
      'Дальше осмотр: 5 фото, пробег, топливо и чек-лист.',
      'Осмотр и дефекты увидят фирма рейса и фирма машины.',
      'Поменять машину после выбора может только логист.',
    ]);
    await expect(sheet.getByRole('button', { name: 'Взять и начать осмотр' })).toBeFocused();
    await expect(offerCard(page, SPRINTER.model)).toHaveAttribute('data-picked', 'true');
    expect(await seriousAxe(axe, page)).toEqual([]);
    await sheet.getByRole('button', { name: 'Назад' }).click();
    await expect(sheet).toBeHidden();
    await expect(take(page, SPRINTER.model)).toBeFocused();
    // Машина логиста: вторая — обычная, вернётся в свою фирму; осмотр увидит только фирма рейса.
    await take(page, ELF.model).click();
    await expect(offerSheet(page)).toContainText(`${ELF.plate} · поставил логист`);
    await expect(offerSheet(page)).toContainText(
      `Бронь ${SPRINTER.model} ${SPRINTER.plate} снимется, машина вернётся в свою фирму.`,
    );
    await expect(offerSheet(page)).toContainText('Осмотр увидит фирма рейса.');
    await page.keyboard.press('Escape');
    await expect(offerSheet(page)).toBeHidden();
    await noBooking(page);
  });

  test('1e: «Взять и начать осмотр» — бронь закреплена, вторая освобождена, осмотр и выезд', async ({
    app,
    page,
    axe,
  }) => {
    await openOffer(app, page, 'two');
    await take(page, SPRINTER.model).click();
    await offerSheet(page).getByRole('button', { name: 'Взять и начать осмотр' }).click();
    await expect(toast(page)).toHaveText('Бронь подтверждена сервером. Начните осмотр');
    await expect(h2(page, 'Осмотр перед выездом')).toBeVisible();
    const status = page.locator('.ox-dr-offer-held');
    await expect(status).toContainText(`Бронь подтверждена сервером · ${SPRINTER.model} до 18:00`);
    await expect(status).toContainText(`${ELF.model} ${ELF.plate} освобождена в 10:30`);
    await expect(page.locator('.ox-dr-insp .ox-dr-sub').first()).toHaveText(
      `${SPRINTER.model} · ${SPRINTER.plate} · ваша обычная`,
    );
    await expect(page.getByText('Осмотр увидят фирма рейса и фирма машины.')).toBeVisible();
    await expect(current(page)).toHaveText('2Осмотр');
    await expect(page.getByRole('button', { name: 'Взять эту машину' })).toHaveCount(0);
    await noBooking(page);
    expect(await seriousAxe(axe, page)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    // Перезагрузка: выбор сделан — сразу осмотр; освобождённая машина названа по памяти экрана или «Вторая машина».
    await page.reload();
    await expect(h2(page, 'Осмотр перед выездом')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.ox-dr-offer-held')).toContainText(/освобождена в 10:30/);
    await serverNow(page, IN_WINDOW);
    await fivePhotos(page);
    await fillInspection(page, '150000', DEP_CHECKS);
    await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
    await expect(toast(page)).toHaveText('Выезд подтверждён сервером');
    await expect(h2(page, 'Маршрут')).toBeVisible();
  });

  test('офлайн: «Взять эту машину» и «Взять и начать осмотр» недоступны с причиной (D-09)', async ({
    app,
    page,
  }) => {
    await openOffer(app, page, 'two');
    await take(page, ELF.model).click();
    await page.context().setOffline(true);
    const sheet = offerSheet(page);
    await expect(sheet.getByRole('button', { name: 'Взять и начать осмотр' })).toBeDisabled();
    await expect(sheet).toContainText('Нет связи: выбор машины требует подтверждения сервера.');
    await sheet.getByRole('button', { name: 'Назад' }).click();
    await expect(take(page, ELF.model)).toBeDisabled();
    await expect(take(page, SPRINTER.model)).toBeDisabled();
    await expect(page.locator('.ox-dr').getByRole('status')).toContainText(
      'Нет связи: выбор машины требует подтверждения сервера.',
    );
    await page.context().setOffline(false);
    await expect(take(page, ELF.model)).toBeEnabled();
  });

  test('409 offer_closed: срок выбора прошёл — сообщение, смена перечитана, машина логиста', async ({
    app,
    page,
  }) => {
    await openOffer(app, page, 'two');
    await take(page, SPRINTER.model).click();
    await serverNow(page, AFTER_DEADLINE);
    await offerSheet(page).getByRole('button', { name: 'Взять и начать осмотр' }).click();
    await expect(page.locator('.ox-dr').getByRole('alert')).toContainText(OFFER_CLOSED);
    await expect(offerSheet(page)).toBeHidden();
    // Срок прошёл без выбора: сервер оставил машину логиста, обычная вернулась в свою фирму.
    await expect(h2(page, 'Машина на сегодня')).toBeVisible();
    await expect(page.locator('article.ox-dr-offer .ox-dr-car-model')).toHaveText([ELF.model]);
    await noBooking(page);
  });

  test('одна машина: «Машина на сегодня» без подтверждения — «Начать осмотр» → осмотр и выезд', async ({
    app,
    page,
    axe,
  }) => {
    const { trip, tenant } = await openOffer(app, page, 'one', { now: IN_WINDOW });
    await expect(page.locator('.ox-dr-trip .ox-dr-chip')).toHaveText(/Машина назначена/);
    await expect(h2(page, 'Машина на сегодня')).toBeVisible();
    await expect(
      page.getByText(
        'Логист поставил машину при согласовании. Подтверждать бронь не нужно: первый снимок осмотра закрепит её за вами.',
      ),
    ).toBeVisible();
    await expect(offerCard(page, ELF.model)).toContainText('Поставил логист');
    // Возврат 1: у карточки «Машина на сегодня» (:281–290) нет строки «Подходит рейсу …».
    await expect(offerCard(page, ELF.model)).not.toContainText('Подходит рейсу');
    await noBooking(page);
    expect(await seriousAxe(axe, page)).toEqual([]);
    await offerCard(page, ELF.model).getByRole('button', { name: 'Начать осмотр' }).click();
    await expect(h2(page, 'Осмотр перед выездом')).toBeVisible();
    await expect(page.locator('.ox-dr-offer-held')).toContainText(
      `Бронь подтверждена сервером · ${ELF.model} до 18:00`,
    );
    await expect(page.getByText('Осмотр увидит фирма рейса.')).toBeVisible();
    await expect(current(page)).toHaveText('2Осмотр');
    await fivePhotos(page);
    await fillInspection(page, '150000', DEP_CHECKS);
    await actionBar(page).getByRole('button', { name: 'Выехать на маршрут' }).click();
    await expect(toast(page)).toHaveText('Выезд подтверждён сервером');
    await expect(h2(page, 'Маршрут')).toBeVisible();
    await expect(page.getByText(`${trip.number} · ${trip.title}`)).toBeVisible();

    // Возврат 1 (Q-W2.61-2): «Автомобили» начатого рейса временного водителя не зависят от listVehicles (после срока —
    // 403, D09; сценарий отвечает так же) — машина рейса и сдача на «Моей смене», ошибки и запроса списка нет.
    await devScenario(page, { scenario: 'listVehicles=forbidden_action' });
    const lists: string[] = [];
    page.on('request', (r) => {
      if (/\/fleet\/vehicles(\?|$)/.test(r.url())) lists.push(r.url());
    });
    await page.goto(`/t/${tenant}/cars`);
    await expect(page.getByRole('heading', { level: 1, name: 'Автомобили' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText('Машина рейса — на «Моей смене»')).toBeVisible();
    await expect(
      page.getByText(
        `Рейс ${trip.number} уже в работе: машина, маршрут и сдача — на «Моей смене». Других машин временному водителю не показывают.`,
      ),
    ).toBeVisible();
    await expect(page.getByText(/^Не удалось загрузить машины/)).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Фильтр' })).toHaveCount(0);
    expect(lists).toEqual([]);
    expect(await seriousAxe(axe, page)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    await page.getByRole('button', { name: 'Открыть «Мою смену»' }).click();
    await expect(h2(page, 'Маршрут')).toBeVisible();
    await devScenario(page, { scenario: null });
  });

  test('машины нет: «Машину ещё не поставили», без «Написать логисту» и без брони', async ({
    app,
    page,
    axe,
  }) => {
    await openOffer(app, page, 'none');
    await expect(page.locator('.ox-dr-trip .ox-dr-chip')).toHaveText(/Ждёт машину/);
    await expect(page.getByText('Машину ещё не поставили')).toBeVisible();
    await expect(
      page.getByText(
        'Ваша фирма выдала вас на рейс без обычной машины. Логист фирмы рейса поставит машину, придёт уведомление.',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Написать логисту' })).toHaveCount(0);
    await expect(page.locator('article')).toHaveCount(0);
    await noBooking(page);
    expect(await seriousAxe(axe, page)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('«Автомобили»: только предложенные машины, без «Забронировать» и «Подтвердить бронь»', async ({
    app,
    page,
  }) => {
    const { trip } = await openOffer(app, page, 'two', { segment: 'cars' });
    await expect(page.locator('.ox-dr-car-model')).toHaveText([SPRINTER.model, ELF.model]);
    await noBooking(page);
    // Возврат 1 (Q-W2.74-8): пояснение о машинах рейса, фильтра нет («Свободны» у временного водителя всегда пусто).
    await expect(
      page.getByText(
        `Машины рейса ${trip.number}: только предложенные вам. Выбор и осмотр — на «Моей смене».`,
      ),
    ).toBeVisible();
    await expect(page.getByRole('group', { name: 'Фильтр' })).toHaveCount(0);
  });

  test('«Автомобили»: ошибка listReservations (429) — «Не удалось загрузить машины» и «Повторить»', async ({
    app,
    page,
  }) => {
    await openOffer(app, page, 'two', {
      segment: 'cars',
      scenario: 'listReservations=rate_limited',
    });
    const alert = page.locator('.ox-dr').getByRole('alert');
    await expect(alert).toContainText(
      'Не удалось загрузить машины: Слишком много запросов. Подождите и повторите.',
    );
    await expect(page.getByText('По фильтру машин нет')).toHaveCount(0);
    await expect(page.locator('.ox-dr-car-model')).toHaveCount(0);
    await devScenario(page, { scenario: null });
    await alert.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.locator('.ox-dr-car-model')).toHaveText([SPRINTER.model, ELF.model]);
    await noBooking(page);
  });

  test('«Автомобили»: машины нет — «Машину ещё не поставили», не «По фильтру машин нет»', async ({
    app,
    page,
  }) => {
    await openOffer(app, page, 'none', { segment: 'cars' });
    await expect(page.getByText('Машину ещё не поставили')).toBeVisible();
    await expect(page.getByText('По фильтру машин нет')).toHaveCount(0);
    await expect(page.locator('article')).toHaveCount(0);
    await noBooking(page);
  });
});

// Стенд (backend S2-20 W2.72 в main): узкая роль «Временный водитель» — у Ахмедова в сиде своей роли нет. Часы
// настоящие: выбор — до срока (начало окна − 30 мин), поэтому окно строки с выбором — через двое суток, и осмотр с выездом в
// ней не проходят (осмотр, старт и файлы — с начала окна, Q-W2.71-3, Q-W2.72-3); выезд — в строке с одной машиной (окно
// через 90 с, одобрение уже после срока выбора — бронь одна и сразу confirmed, Q-W2.71-5). Журни дня S2-20 — W2.75.
// «Автомобилей» у узкой роли нет, как в нижней навигации кадров 1c–1e («Смена», «Чаты», «Подотчёт», «Ещё»): страница
// открыта по fleet.reservations.create (реестр навигации), а его в роли нет (Q-W2.74-9).

/** Узкая роль: пункта «Автомобили» в навигации нет, прямой адрес — отказ оболочки, список машин не запрашивается. */
async function noCarsPage(d: Page, tenant: string): Promise<void> {
  await expect(d.getByRole('navigation', { name: 'Навигация' })).toBeVisible();
  await expect(
    d.getByRole('navigation', { name: 'Навигация' }).getByRole('button', { name: 'Автомобили' }),
  ).toHaveCount(0);
  const lists: string[] = [];
  d.on('request', (r) => {
    if (/\/fleet\/vehicles(\?|$)/.test(r.url())) lists.push(r.url());
  });
  await d.goto(`/t/${tenant}/cars`);
  await expect(
    d.getByRole('heading', { level: 1, name: 'Нет роли с доступом к модулю «Логистика»' }),
  ).toBeVisible(STAND);
  expect(lists).toEqual([]);
}

test.describe('driver-today — машины на выбор временному водителю на стенде @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('две машины: «Выберите машину» → лист «Берёте …?» → «Взять и начать осмотр» — бронь подтверждена, вторая освобождена', async ({
    page,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(300_000);
    await realClock(page);
    const o = await standOffer({ session, undo }, 'two', testInfo.project.name);
    const d = o.driver;
    await d.goto(`/t/${o.tenant}/today`);
    await expect(h2(d, 'Выберите машину')).toBeVisible(STAND);
    await expect(d.getByText(`${o.trip.number} · ${o.trip.title}`)).toBeVisible();
    await expect(d.locator('.ox-dr-trip .ox-dr-chip')).toHaveText(/Выберите машину/);
    await expect(d.locator('article.ox-dr-offer .ox-dr-car-model')).toHaveText([
      SPRINTER.model,
      ELF.model,
    ]);
    await expect(offerCard(d, SPRINTER.model)).toContainText('Ваша обычная');
    await expect(offerCard(d, SPRINTER.model)).toHaveAttribute('data-picked', 'true');
    await expect(offerCard(d, ELF.model)).toContainText('Поставил логист');
    await expect(d.locator('article')).toHaveCount(2);
    await noBooking(d);

    await take(d, SPRINTER.model).click();
    const sheet = offerSheet(d);
    await expect(sheet.getByRole('heading', { name: `Берёте ${SPRINTER.model}?` })).toBeVisible();
    await expect(sheet).toContainText(
      `Бронь ${ELF.model} ${ELF.plate} снимется, машина вернётся в свою фирму.`,
    );
    await sheet.getByRole('button', { name: 'Взять и начать осмотр' }).click();
    await expect(toast(d)).toHaveText('Бронь подтверждена сервером. Начните осмотр', STAND);
    const status = d.locator('.ox-dr-offer-held');
    await expect(status).toContainText(`Бронь подтверждена сервером · ${SPRINTER.model} до`, STAND);
    await expect(status).toContainText(`${ELF.model} ${ELF.plate} освобождена в`);
    await expect(current(d)).toHaveText('2Осмотр');
    await expect(d.getByRole('button', { name: 'Взять эту машину' })).toHaveCount(0);
    await noBooking(d);
    // Сервер: рейс получил выбранную машину, предложение закрыто.
    const plan = (
      await call(o.owner, 'GET', `/api/v1/tenants/${o.tenant}/fleet/trip-plans/${o.trip.id}`)
    ).body as { vehicleId?: string; state: string };
    expect(plan.state).toBe('assigned');
    expect(plan.vehicleId).toBeTruthy();
    // Перезагрузка: выбор сделан — сразу осмотр на выбранной машине, освобождённая названа по памяти вкладки.
    await d.reload();
    await expect(d.locator('.ox-dr-offer-held')).toContainText(
      `${ELF.model} ${ELF.plate} освобождена в`,
      STAND,
    );
    await noCarsPage(d, o.tenant);
  });

  test('одна машина: «Машина на сегодня» → «Начать осмотр» → осмотр и выезд на выбранной машине', async ({
    page,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(420_000);
    await realClock(page);
    const o = await standOffer({ session, undo }, 'one', testInfo.project.name);
    const d = o.driver;
    await d.goto(`/t/${o.tenant}/today`);
    await expect(h2(d, 'Машина на сегодня')).toBeVisible(STAND);
    await expect(d.locator('.ox-dr-trip .ox-dr-chip')).toHaveText(/Машина назначена/);
    await expect(offerCard(d, ELF.model)).toContainText('Поставил логист');
    await expect(offerCard(d, ELF.model)).not.toContainText('Подходит рейсу');
    await noBooking(d);
    // Осмотр и файлы рейса — с начала окна (Q-W2.72-3).
    await until(d, o.begin);
    await offerCard(d, ELF.model).getByRole('button', { name: 'Начать осмотр' }).click();
    await expect(h2(d, 'Осмотр перед выездом')).toBeVisible(STAND);
    await expect(d.locator('.ox-dr-offer-held')).toContainText(
      `Бронь подтверждена сервером · ${ELF.model} до`,
    );
    await expect(d.getByText('Осмотр увидит фирма рейса.')).toBeVisible();
    await J.photos(d, 'stand', await J.jpeg(d, 'Ортус · S2-20'));
    await J.fillInspection(d, String(o.elfOdometer + 5), DEP_CHECKS);
    await actionBar(d).getByRole('button', { name: 'Выехать на маршрут' }).click();
    await expect(toast(d)).toHaveText('Выезд подтверждён сервером', STAND);
    await expect(h2(d, 'Маршрут')).toBeVisible(STAND);
    await expect(d.getByText(`${o.trip.number} · ${o.trip.title}`)).toBeVisible();
    await noCarsPage(d, o.tenant);
  });
});
