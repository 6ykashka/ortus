// W4.41 · e2e страницы `core-calendar` «Календарь» (CAL-01…05; эталон design-2026-10-19 «Ортус CRM.dc.html»
// pg.calendar :1781–1823, calVM :4140–4180; чек-лист docs/plan/analysis/06-calendar-kb-data-files-spa-cash-repair.md
// §13 п. 1–9, 52). Ресурсы и брони — MSW W4.06 (сид календаря «Альты», пресет logistics-ready — машины и рейс);
// backend — W4.40 (режим stand). Обязательные пункты verification-protocol §1.3: меню и URL,
// состояния (загрузка, ошибка, нет связи, гейт), клавиатура, axe, 390 / 1440. Неделя и навигация по датам —
// no-reference (Q-W4.06-4).
import type { Locator, Page, Response } from '@playwright/test';

import { expect, test, type Undo } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { realClock } from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { call, devScenario, LOTOS, tenantId } from './shell.helpers.ts';

const H1 = 'Календарь ресурсов';
const DAY = 'Четверг, 1 октября 2026 · Москва (UTC+3)';
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
const CONFLICT =
  'Конфликт ресурсов: Анна Морозова · массажист занят («SPA-ритуал · Ольга Р.»); Кабинет № 2 занят («SPA-ритуал · Ольга Р.»)';
const MASSAGE = 'Классический массаж · Мария К., 10:00–11:00';
const OWNER_ROWS = [
  'ГАЗель Next · А 412 МР',
  'ГАЗон Next · Е 905 НА',
  'Mercedes Sprinter · Т 771 ЕХ',
  'Анна Морозова · массажист',
  'Илья Васильев · водитель',
  'Кабинет № 2',
  'Кабинет № 3',
  'Стол с подогревом',
];

const section = (page: Page): Locator => page.locator('section[aria-labelledby="h-cal"]');
const filters = (page: Page): Locator =>
  section(page).getByRole('group', { name: 'Тип ресурса' }).getByRole('button');
const filter = (page: Page, name: string): Locator =>
  section(page).getByRole('group', { name: 'Тип ресурса' }).getByRole('button', { name });
const rows = (page: Page): Locator => section(page).locator('.ox-cal-name');
const block = (page: Page, name: string): Locator =>
  section(page).getByRole('button', { name, exact: true });
const panel = (page: Page): Locator => section(page).locator('.ox-cal-panel');
const moveTo = (page: Page): Locator => panel(page).getByLabel('Перенести начало на');
const moveBtn = (page: Page): Locator =>
  panel(page).getByRole('button', { name: 'Проверить и перенести' });
const period = (page: Page): Locator => section(page).getByRole('group', { name: 'Период' });
const dateLine = (page: Page): Locator => section(page).locator('.ox-cal-date');
/** Ответ findCalendarAvailability (POST …/calendar/availability) — слоты после конфликта переноса. */
const availability = (page: Page): Promise<Response> =>
  page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().includes('/calendar/availability'),
  );

/** «Календарь» организации по прямому URL; владелец — на пресете logistics-ready (машины и рейс видны). */
async function open(
  app: Parameters<typeof openPage>[0],
  page: Page,
  o: {
    persona?: 'owner' | 'manager' | 'therapist';
    search?: string;
    preset?: string | null;
    tenant?: string;
  } = {},
): Promise<string> {
  const preset = o.preset === undefined ? 'logistics-ready' : (o.preset ?? undefined);
  const id = await openPage(app, page, `calendar${o.search ?? ''}`, {
    persona: o.persona ?? 'owner',
    ...(preset ? { preset } : {}),
    ...(o.tenant ? { tenant: o.tenant } : {}),
  });
  await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
  return id;
}

/** Выбрать бронь и дождаться панели. */
async function pick(page: Page, name: string, title: string): Promise<void> {
  await block(page, name).first().click();
  await expect(panel(page).getByRole('heading', { level: 2, name: title })).toBeVisible();
}

test.describe('core-calendar — «Календарь» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('открывается из меню и по прямому URL: строка даты, заголовок, фильтр', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home', { preset: 'logistics-ready' });
    if (phone(page)) {
      await page
        .getByRole('navigation', { name: 'Навигация', exact: true })
        .getByRole('button', { name: 'Ещё' })
        .click();
      await page
        .getByRole('dialog', { name: 'Все разделы' })
        .getByRole('button', { name: 'Календарь' })
        .click();
    } else {
      await page
        .getByRole('navigation', { name: 'Основная навигация' })
        .getByRole('button', { name: 'Календарь' })
        .click();
    }
    await expect(h1(page, H1)).toBeVisible();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(dateLine(page)).toHaveText(DAY);
    await expect(filters(page)).toHaveText([
      'Все ресурсы',
      'Машины',
      'Сотрудники',
      'Помещения',
      'Оборудование',
    ]);
    await expect(filter(page, 'Все ресурсы')).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(rows(page)).toHaveCount(8, { timeout: 15_000 });
  });

  test('владелец: 8 ресурсов в порядке сервера, брони дня с подписями эталона', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await expect(rows(page)).toHaveText(OWNER_ROWS);
    for (const name of [
      'Рейс Р-208, 09:00–13:00',
      'Плановое ТО, 08:00–20:00',
      'SPA-ритуал · Ольга Р., 11:30–13:00',
      MASSAGE,
      'Перерыв, 13:15–14:00',
      'Массаж спины · Екатерина Л., 14:00–14:45',
    ]) {
      await expect(block(page, name).first()).toBeVisible();
    }
    // Бронь на трёх ресурсах — три блока (по строке на ресурс).
    await expect(block(page, 'SPA-ритуал · Ольга Р., 11:30–13:00')).toHaveCount(3);
    await expect(section(page)).toContainText('подготовка и уборка — ресурс занят');
    await expect(section(page)).toContainText(
      'Срок задачи ресурс не занимает. Перенос — предложение, его подтверждает сервер.',
    );
    await expect(panel(page)).toHaveCount(0);
  });

  test('фильтр «Машины» — 3 строки; «Помещения» — кабинеты; «Все ресурсы» — снова 8', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await filter(page, 'Машины').click();
    await expect(filter(page, 'Машины')).toHaveAttribute('aria-pressed', 'true');
    await expect(filter(page, 'Все ресурсы')).toHaveAttribute('aria-pressed', 'false');
    await expect(rows(page)).toHaveText(OWNER_ROWS.slice(0, 3));
    await filter(page, 'Помещения').click();
    await expect(rows(page)).toHaveText(['Кабинет № 2', 'Кабинет № 3']);
    await filter(page, 'Все ресурсы').click();
    await expect(rows(page)).toHaveCount(8);
  });

  test('бронь визита: панель, мета, «Открыть визит», выбор времени, ?booking=', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await pick(page, MASSAGE, 'Классический массаж · Мария К.');
    await expect(page).toHaveURL(/[?&]booking=/);
    await expect(panel(page)).toContainText(
      '10:00–11:00 · уборка 15 мин · Анна Морозова · массажист, Кабинет № 2',
    );
    await expect(panel(page).getByRole('button', { name: 'Открыть визит' })).toBeVisible();
    await expect(moveTo(page).locator('option:checked')).toHaveText('10:00');
    await expect(moveTo(page).locator('option')).toHaveCount(48);
    await expect(moveBtn(page)).toBeEnabled();
    // Выбранная бронь — тёмная рамка эталона (#1C2A26).
    await expect(block(page, MASSAGE).first()).toHaveCSS('border-top-color', 'rgb(28, 42, 38)');
    await page.reload();
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(
      'Классический массаж · Мария К.',
      { timeout: 15_000 },
    );
  });

  test('перенос на 11:00 — конфликт эталона и три свободных слота; слот 08:15 переносит', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await pick(page, MASSAGE, 'Классический массаж · Мария К.');
    await moveTo(page).selectOption({ label: '11:00' });
    await moveBtn(page).click();
    const alert = panel(page).getByRole('alert');
    await expect(alert).toContainText(CONFLICT);
    await expect(alert).toContainText('Свободные слоты для всех ресурсов:');
    await expect(alert.getByRole('button')).toHaveText(['08:00', '08:15', '08:30']);
    await expect(toast(page)).toHaveCount(0);
    await alert.getByRole('button', { name: '08:15' }).click();
    await expect(toast(page)).toHaveText('Перенесено на 08:15');
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    await expect(block(page, 'Классический массаж · Мария К., 08:15–09:15').first()).toBeVisible();
  });

  test('«Проверить и перенести» на 08:00 — тост «Перенос подтверждён сервером»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await pick(page, MASSAGE, 'Классический массаж · Мария К.');
    await moveTo(page).selectOption({ label: '08:00' });
    await moveBtn(page).click();
    await expect(toast(page)).toHaveText('Перенос подтверждён сервером');
    await expect(block(page, 'Классический массаж · Мария К., 08:00–09:00').first()).toBeVisible();
    await expect(moveTo(page).locator('option:checked')).toHaveText('08:00');
  });

  test('запрет переноса: рейс, ТО и перерыв — текст эталона, кнопки источника', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await pick(page, 'Рейс Р-208, 09:00–13:00', 'Рейс Р-208');
    await expect(moveTo(page)).toHaveCount(0);
    await expect(panel(page)).toContainText(
      'Время рейса меняется в рабочем месте логиста — календарь вызывает команду исходного модуля.',
    );
    await expect(panel(page).getByRole('button', { name: 'Открыть рейс' })).toBeVisible();
    await pick(page, 'Плановое ТО, 08:00–20:00', 'Плановое ТО');
    await expect(panel(page)).toContainText('Недоступность машины задаётся в карточке машины.');
    await expect(panel(page).getByRole('button', { name: 'Открыть машину' })).toBeVisible();
    await pick(page, 'Перерыв, 13:15–14:00', 'Перерыв');
    await expect(panel(page)).toContainText('Перерыв меняется в графике специалиста.');
    await expect(panel(page).getByRole('button', { name: /^Открыть/ })).toHaveCount(0);
  });

  test('«Открыть рейс» — «Рабочее место логиста» с рейсом', async ({ app, page }) => {
    const alta = await open(app, page);
    await pick(page, 'Рейс Р-208, 09:00–13:00', 'Рейс Р-208');
    await panel(page).getByRole('button', { name: 'Открыть рейс' }).click();
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/fleet\\?trip=`));
    await expect(h1(page, 'Рабочее место логиста')).toBeVisible();
  });

  test('нет связи — тост, время брони не изменилось; вне рабочего дня — текст сервера', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await pick(page, MASSAGE, 'Классический массаж · Мария К.');
    await devScenario(page, { scenario: 'updateCalendarBooking=offline' });
    await moveTo(page).selectOption({ label: '08:00' });
    await moveBtn(page).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(block(page, MASSAGE).first()).toBeVisible();
    await devScenario(page, { scenario: null });
    await moveTo(page).selectOption({ label: '19:30' });
    await moveBtn(page).click();
    await expect(toast(page)).toHaveText('Время вне рабочего дня ресурса.');
    await expect(block(page, MASSAGE).first()).toBeVisible();
  });

  test('массажист: свои ресурсы без машин, визит переносится, перерыв — нет', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'therapist', preset: null });
    await expect(filters(page)).toHaveText([
      'Все ресурсы',
      'Сотрудники',
      'Помещения',
      'Оборудование',
    ]);
    await expect(rows(page)).toHaveText([
      'Анна Морозова · массажист',
      'Кабинет № 2',
      'Стол с подогревом',
    ]);
    await expect(section(page).getByRole('button', { name: /^Рейс Р-208/ })).toHaveCount(0);
    await expect(section(page).getByRole('button', { name: /^Плановое ТО/ })).toHaveCount(0);
    await pick(page, MASSAGE, 'Классический массаж · Мария К.');
    await expect(moveTo(page)).toBeVisible();
    await pick(page, 'Перерыв, 13:15–14:00', 'Перерыв');
    await expect(panel(page)).toContainText('Перерыв меняется в графике специалиста.');
  });

  test('массажист: перенос на 11:00 — конфликт эталона; кнопок слотов нет — нет права (Q-W4.74-1)', async ({
    app,
    page,
  }) => {
    // Расхождение с эталоном (calVM :4140–4180: «08:00 / 08:15 / 08:30» и у массажиста) до решения Q-W4.74-1:
    // роль «Массажист» (calendar ['view', 'edit'] → calendar.bookings.read, calendar.bookings.manage) без
    // calendar.availability.read — findCalendarAvailability 403 forbidden_action. Решение выдать право — вернуть
    // сюда и в @stand-строку кнопки ['08:00', '08:15', '08:30'] и перенос слотом 08:15.
    await open(app, page, { persona: 'therapist', preset: null });
    await pick(page, MASSAGE, 'Классический массаж · Мария К.');
    await moveTo(page).selectOption({ label: '11:00' });
    const slots = availability(page);
    await moveBtn(page).click();
    const alert = panel(page).getByRole('alert');
    await expect(alert).toContainText(CONFLICT);
    expect((await slots).status()).toBe(403);
    await expect(alert.getByRole('button')).toHaveCount(0);
    await expect(toast(page)).toHaveCount(0);
    await expect(block(page, MASSAGE).first()).toBeVisible();
  });

  test('массажист «Лотоса»: «Календарь ресурсов» салона без брони рейса', async ({ app, page }) => {
    await open(app, page, { persona: 'therapist', preset: null, tenant: LOTOS });
    await expect(block(page, 'SPA-ритуал · Ольга Р., 11:30–13:00').first()).toBeVisible();
    await expect(section(page).getByRole('button', { name: /^Рейс Р-208/ })).toHaveCount(0);
  });

  test('логист с ролью: машины и водитель; рейс без права «Изменять»', async ({ app, page }) => {
    await open(app, page, { persona: 'manager' });
    await expect(rows(page)).toHaveText([...OWNER_ROWS.slice(0, 3), 'Илья Васильев · водитель']);
    await pick(page, 'Рейс Р-208, 09:00–13:00', 'Рейс Р-208');
    await expect(panel(page)).toContainText('Нет права «Изменять» в календаре.');
    await expect(moveTo(page)).toHaveCount(0);
  });

  test('водитель — гейт «Нет доступа к разделу «Календарь»»', async ({ app, page }) => {
    await openPage(app, page, 'calendar', { persona: 'driver' });
    await expect(page.getByText('Нет доступа к разделу «Календарь»')).toBeVisible({
      timeout: 15_000,
    });
    await expect(section(page)).toHaveCount(0);
  });

  test('день: следующий и предыдущий, «Сегодня»; ?date= сохраняется (no-reference)', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await period(page).getByRole('button', { name: 'Следующий день', exact: true }).click();
    await expect(page).toHaveURL(/[?&]date=2026-10-02/);
    await expect(dateLine(page)).toHaveText('Пятница, 2 октября 2026 · Москва (UTC+3)');
    await expect(rows(page)).toHaveCount(8);
    await expect(section(page).getByRole('button', { name: MASSAGE })).toHaveCount(0);
    await page.reload();
    await expect(dateLine(page)).toHaveText('Пятница, 2 октября 2026 · Москва (UTC+3)', {
      timeout: 15_000,
    });
    await period(page).getByRole('button', { name: 'Предыдущий день', exact: true }).click();
    await expect(dateLine(page)).toHaveText(DAY);
    await expect(block(page, MASSAGE).first()).toBeVisible();
    await period(page).getByRole('button', { name: 'Следующий день', exact: true }).click();
    await period(page).getByRole('button', { name: 'Сегодня', exact: true }).click();
    await expect(dateLine(page)).toHaveText(DAY);
  });

  test('неделя: сетка по дням, бронь четверга, панель и перенос (no-reference)', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await period(page).getByRole('button', { name: 'Неделя', exact: true }).click();
    await expect(period(page).getByRole('button', { name: 'Неделя', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page).toHaveURL(/[?&]view=week/);
    await expect(dateLine(page)).toHaveText('28 сентября — 4 октября 2026 · Москва (UTC+3)');
    await expect(section(page).locator('.ox-cal-day')).toHaveText([
      'Пн, 28.09',
      'Вт, 29.09',
      'Ср, 30.09',
      'Чт, 01.10',
      'Пт, 02.10',
      'Сб, 03.10',
      'Вс, 04.10',
    ]);
    const thu = 'Классический массаж · Мария К., чт 01.10, 10:00–11:00';
    await pick(page, thu, 'Классический массаж · Мария К.');
    await moveTo(page).selectOption({ label: '08:00' });
    await moveBtn(page).click();
    await expect(toast(page)).toHaveText('Перенос подтверждён сервером');
    await expect(
      block(page, 'Классический массаж · Мария К., чт 01.10, 08:00–09:00').first(),
    ).toBeVisible();
    await period(page).getByRole('button', { name: 'Следующая неделя', exact: true }).click();
    await expect(dateLine(page)).toHaveText('5 октября — 11 октября 2026 · Москва (UTC+3)');
    await expect(section(page).locator('.ox-cal-track button')).toHaveCount(0);
    await period(page).getByRole('button', { name: 'День', exact: true }).click();
    await expect(page).not.toHaveURL(/view=week/);
  });

  test('ошибка загрузки — «Повторить»; загрузка — скелетон', async ({ app, page }) => {
    await openPage(app, page, 'home', { preset: 'logistics-ready' });
    const alta = page.url().match(/\/t\/([^/]+)\//)?.[1] ?? '';
    await devScenario(page, { scenario: 'listCalendarResources=rate_limited' });
    await app(`/t/${alta}/calendar`, { persona: 'owner' });
    await expect(section(page).getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: 'listCalendarBookings=delay=1500' });
    await section(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByRole('main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(rows(page)).toHaveCount(8, { timeout: 15_000 });
  });

  test('1440 — боковая панель, 390 — нижняя навигация; таймлайн прокручивается в карточке', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await expect(rows(page)).toHaveCount(8);
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
      const card = section(page).locator('.ox-cal-card');
      expect(await card.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('клавиатура: Tab до фильтра и брони, Enter открывает панель; фокус виден', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const target = block(page, MASSAGE).first();
    await expect(target).toBeVisible();
    const seen = new Set<string>();
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      seen.add(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(seen.has('Все ресурсы')).toBe(true);
    expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(panel(page).getByRole('heading', { level: 2 })).toHaveText(
      'Классический массаж · Мария К.',
    );
  });

  test('axe без serious; 390 — цели не меньше 44 px', async ({ app, page, axe }) => {
    await open(app, page);
    await pick(page, MASSAGE, 'Классический массаж · Мария К.');
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    if (!phone(page)) return;
    expect(await hitHeight(filter(page, 'Машины'))).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(block(page, MASSAGE).first())).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(moveTo(page))).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(moveBtn(page))).toBeGreaterThanOrEqual(44);
    expect(
      await hitHeight(panel(page).getByRole('button', { name: 'Открыть визит' })),
    ).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

// Backend календаря — W4.40 (в main с 499307d): listCalendarResources, listCalendarBookings, перенос, Go-сид.
test.describe('core-calendar — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец на стенде: ресурсы и брони дня по listCalendarBookings стенда', async ({
    app,
    page,
  }) => {
    // W4.40: ресурсы и брони Go-сида календаря «Альты» (Q-W4.06-3).
    test.slow();
    await openPage(app, page, 'calendar', { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await expect(rows(page).first()).toBeVisible();
  });

  test('массажист на стенде: перенос визита с проверкой всех ресурсов', async ({
    app,
    page,
    undo,
  }) => {
    // W4.40: перенос и свободные слоты — updateCalendarBooking, findCalendarAvailability стенда. W4.74
    // (Q-W4.41-12): день страницы — день визита сида, визит до и после строки — на 10:00–11:00.
    test.slow();
    await app('/', { persona: 'therapist' });
    const alta = await tenantId(page);
    const day = await seedVisit(page, alta, undo);
    await realClock(page);
    await app(`/t/${alta}/calendar?date=${day}`, { persona: 'therapist' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await pick(page, MASSAGE, 'Классический массаж · Мария К.');
    await moveTo(page).selectOption({ label: '11:00' });
    const slots = availability(page);
    await moveBtn(page).click();
    // Сервер проверяет все ресурсы брони с уборкой: 11:00–12:00 (+15 мин) задевает «SPA-ритуал» на обоих.
    // Кнопок свободных слотов у массажиста нет ни на стенде, ни в mock (строка @mock выше) — у роли «Массажист»
    // (сид access.go roleTherapist, MSW r-therapist) нет calendar.availability.read: findCalendarAvailability 403
    // до решения Q-W4.74-1, поэтому перенос — выбором времени. Выдадут право — проверить кнопки и слот 08:15.
    await expect(panel(page).getByRole('alert')).toContainText(CONFLICT);
    expect((await slots).status()).toBe(403);
    await expect(panel(page).getByRole('alert').getByRole('button')).toHaveCount(0);
    await expect(block(page, MASSAGE).first()).toBeVisible();
    await moveTo(page).selectOption({ label: '08:15' });
    await moveBtn(page).click();
    await expect(toast(page)).toHaveText('Перенос подтверждён сервером');
    await expect(panel(page).getByRole('alert')).toHaveCount(0);
    await expect(block(page, 'Классический массаж · Мария К., 08:15–09:15').first()).toBeVisible();
  });
});

// W4.74 (Q-W4.41-12) · Визит сида на стенде. Go-сид W4.40 пишет брони на день своего запуска (calendarDay), а часы
// харнесса — 01.10.2026; стенд один на три ширины, и строка переносит визит — поэтому она находит его сама, ставит на
// часы сида и возвращает их в уборке.

const HOUR = 3_600_000;
/** Москва — UTC+3 без перехода на летнее время: день и часы броней сида. */
const MSK = 3 * HOUR;
const VISIT = 'Классический массаж · Мария К.';

interface StandBooking {
  id: string;
  title: string;
  window: { startsAt: string; endsAt: string; timeZone: string };
  resources: unknown[];
}

/**
 * Визит «Классический массаж · Мария К.» сида: ищется в окне ±3,5 суток от «сейчас» (стенд мог подняться в другой
 * день), ставится на 10:00–11:00 своего дня (прошлый прогон мог оставить перенос), уборка — снова 10:00–11:00.
 * Возвращает день визита «ГГГГ-ММ-ДД» для `?date=`.
 */
async function seedVisit(page: Page, tenant: string, undo: Undo): Promise<string> {
  const base = `/api/v1/tenants/${tenant}/calendar/bookings`;
  const now = Date.now();
  const q = new URLSearchParams({
    from: new Date(now - 84 * HOUR).toISOString(),
    to: new Date(now + 84 * HOUR).toISOString(),
    limit: '200',
  });
  const list = await call(page, 'GET', `${base}?${q.toString()}`);
  expect(list.status, `listCalendarBookings ${JSON.stringify(list.body)}`).toBe(200);
  const visit = (list.body as { items: StandBooking[] }).items.find((b) => b.title === VISIT);
  if (!visit) throw new Error(`нет визита «${VISIT}» сида в окне ±3,5 суток`);
  const day = new Date(Date.parse(visit.window.startsAt) + MSK).toISOString().slice(0, 10);
  const at = (h: number): string =>
    new Date(Date.parse(`${day}T00:00:00Z`) - MSK + h * HOUR).toISOString();
  const seedHours = async (): Promise<void> => {
    const cur = await call(page, 'GET', `${base}/${visit.id}`);
    expect(cur.status, `getCalendarBooking ${JSON.stringify(cur.body)}`).toBe(200);
    const b = cur.body as StandBooking;
    if (Date.parse(b.window.startsAt) === Date.parse(at(10))) return;
    const r = await call(page, 'PATCH', `${base}/${visit.id}`, {
      body: {
        action: 'reschedule',
        window: { startsAt: at(10), endsAt: at(11), timeZone: b.window.timeZone },
        resources: b.resources,
      },
      ifMatch: cur.headers.etag ?? '',
    });
    expect(r.status, `updateCalendarBooking ${JSON.stringify(r.body)}`).toBe(200);
  };
  await seedHours();
  undo(`«${VISIT}» — снова 10:00–11:00`, seedHours);
  return day;
}
