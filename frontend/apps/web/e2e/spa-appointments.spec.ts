// W5.21 · e2e страницы `spa-appointments` «Салон и SPA» — визиты (no-reference, B-6; эталон design-2026-10-19
// «Ортус CRM.dc.html» pg.spa :1870–1900, spaVM :4242–4262, completeAppointment/resolveIssue ortus/api.js;
// чек-лист docs/plan/analysis/06-calendar-kb-data-files-spa-cash-repair.md §SPA). Режим mock — MSW W5.21 на сиде
// «Альты» (ap-1 10:00 «Классический массаж · Мария К.», ap-2 11:30 «SPA-ритуал · Ольга Р.» со столом, ap-3 14:00;
// масло 250 мл, крем 12 г; «сейчас» сервера 10:30 МСК). Обязательные пункты verification-protocol §1.3: меню и URL,
// состояния (загрузка, ошибка, нет связи, пусто, гейт), клавиатура, axe, 390 / 1440. Режим stand — backend W5.20 (@stand, W2.103).
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { dialog, h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { dateIn, stockFixture } from './inventory.stand.ts';
import { devScenario, tenantId } from './shell.helpers.ts';
import {
  pastDay,
  spaResources,
  spaService,
  spaVisit,
  standDay,
  stockSalonWarehouse,
} from './spa.stand.ts';

const H1 = 'Салон и SPA';
const DAY = 'Четверг, 1 октября 2026';
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
const CLASSIC = 'Классический массаж, Мария К.';
const RITUAL = 'SPA-ритуал, Ольга Р.';
const BACK = 'Массаж спины, Екатерина Л.';

const section = (page: Page): Locator => page.locator('section[aria-labelledby="h-spa"]');
const card = (page: Page, name: string): Locator => section(page).getByRole('article', { name });
const cards = (page: Page): Locator => section(page).locator('article.ox-spa-card');
const issue = (page: Page): Locator => section(page).locator('.ox-spa-issue');
const stock = (page: Page): Locator => section(page).getByRole('complementary');

async function open(
  app: Parameters<typeof openPage>[0],
  page: Page,
  o: {
    persona?: 'owner' | 'manager' | 'therapist' | 'driver';
    search?: string;
    tenant?: string;
  } = {},
): Promise<void> {
  await openPage(app, page, `spa${o.search ?? ''}`, {
    persona: o.persona ?? 'owner',
    ...(o.tenant ? { tenant: o.tenant } : {}),
  });
  if (o.persona !== 'driver')
    await expect(h1(page, o.persona === 'therapist' ? 'Мой день' : H1)).toBeVisible({
      timeout: 15_000,
    });
}

test.describe('spa-appointments — «Салон и SPA», визиты @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и сид — сценарный сервер mock');
  test.setTimeout(90_000);

  test('открывается из меню и по URL: строка организации, заголовок, три визита дня', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home');
    if (phone(page)) {
      await page
        .getByRole('navigation', { name: 'Навигация', exact: true })
        .getByRole('button', { name: 'Ещё' })
        .click();
      await page
        .getByRole('dialog', { name: 'Все разделы' })
        .getByRole('button', { name: H1 })
        .click();
    } else {
      await page
        .getByRole('navigation', { name: 'Основная навигация' })
        .getByRole('button', { name: H1 })
        .click();
    }
    await expect(h1(page, H1)).toBeVisible();
    await expect(page).toHaveURL(/\/spa$/);
    await expect(section(page).locator('.ox-spa-crumb')).toHaveText(
      'Альта Групп · все специалисты',
    );
    await expect(section(page).locator('.ox-spa-date')).toHaveText(DAY);
    await expect(cards(page)).toHaveCount(3);
    await page.reload();
    await expect(cards(page)).toHaveCount(3, { timeout: 15_000 });
  });

  test('карточка визита: время, услуга, статус, клиент · кабинет · оборудование, буферы, техкарта', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const c = card(page, CLASSIC);
    await expect(c).toContainText('10:00');
    await expect(c).toContainText('Классический массаж · 60 мин');
    await expect(c).toContainText('Подтверждено');
    await expect(c).toContainText('Мария К. · Кабинет № 2 · без оборудования');
    await expect(c).toContainText('уборка 15 мин');
    await expect(c).toContainText('Масло массажное 30 мл');
    const r = card(page, RITUAL);
    await expect(r).toContainText('SPA-ритуал · 90 мин');
    await expect(r).toContainText('Ольга Р. · Кабинет № 2 · Стол с подогревом');
    await expect(r).toContainText('подготовка 15 мин · уборка 15 мин');
    await expect(r).toContainText('Крем восстанавливающий 20 г · в наличии 12');
    await expect(stock(page)).toContainText('Остатки кабинета');
    await expect(stock(page)).toContainText('Масло массажное250 мл');
    await expect(stock(page)).toContainText('Крем восстанавливающий12 г');
  });

  test('«Завершить процедуру» списывает по техкарте один раз: масло 250 → 220 мл', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await card(page, CLASSIC)
      .getByRole('button', { name: /^Завершить процедуру/ })
      .click();
    await expect(toast(page)).toHaveText('Процедура завершена, материалы списаны по техкарте');
    await expect(card(page, CLASSIC)).toContainText('Завершено · списано');
    await expect(
      card(page, CLASSIC).getByRole('button', { name: /^Завершить процедуру/ }),
    ).toHaveCount(0);
    await expect(stock(page)).toContainText('Масло массажное220 мл');
    await expect(issue(page)).toHaveCount(0);
  });

  test('нехватка крема: баннер «Учёт материалов не завершён», решение владельца «Списать остаток из резерва»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await card(page, RITUAL)
      .getByRole('button', { name: /^Завершить процедуру/ })
      .click();
    await expect(toast(page)).toHaveText(
      'Услуга выполнена. Материала не хватило — учёт ждёт решения владельца',
    );
    await expect(card(page, RITUAL)).toContainText('Выполнено · учёт не завершён');
    await expect(issue(page)).toContainText(
      'Учёт материалов не завершён. Не хватило «Крем восстанавливающий»: нужно 20 г, в наличии 12 г · SPA-ритуал (Ольга Р.)',
    );
    await expect(issue(page).getByRole('button')).toHaveText([
      'Списать остаток из резерва',
      'Принять фактический расход',
    ]);
    // Списания не было: склад прежний.
    await expect(stock(page)).toContainText('Крем восстанавливающий12 г');
    await issue(page).getByRole('button', { name: 'Списать остаток из резерва' }).click();
    await expect(toast(page)).toHaveText('Остаток списан из резерва');
    await expect(issue(page)).toHaveCount(0);
    await expect(card(page, RITUAL)).toContainText('Завершено · списано');
    await expect(stock(page)).toContainText('Крем восстанавливающий0 г');
  });

  test('«Принять фактический расход» — тот же итог, свой текст', async ({ app, page }) => {
    await open(app, page);
    await card(page, RITUAL)
      .getByRole('button', { name: /^Завершить процедуру/ })
      .click();
    await expect(issue(page)).toBeVisible();
    await issue(page).getByRole('button', { name: 'Принять фактический расход' }).click();
    await expect(toast(page)).toHaveText('Принят фактический расход');
    await expect(card(page, RITUAL)).toContainText('Завершено · списано');
  });

  test('запись клиента: по умолчанию «сейчас» занято — конфликт ресурсов; свободное время — визит появляется', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await section(page).getByRole('button', { name: 'Записать клиента' }).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Записать клиента' })).toBeVisible();
    await d.getByLabel('Услуга').selectOption({ label: 'Классический массаж' });
    await d.getByLabel('Клиент').selectOption({ label: 'Мария К.' });
    await d.getByLabel('Специалист').selectOption({ label: 'Анна Морозова · массажист' });
    await d.getByLabel('Кабинет').selectOption({ label: 'Кабинет № 2' });
    await d.getByLabel('Начало').selectOption({ label: '10:30' });
    await d.getByRole('button', { name: 'Записать', exact: true }).click();
    await expect(d.getByRole('alert').first()).toContainText(
      'Конфликт ресурсов: Анна Морозова · массажист занят',
    );
    await expect(toast(page)).toHaveCount(0);
    await d.getByLabel('Начало').selectOption({ label: '15:15' });
    await d.getByRole('button', { name: 'Записать', exact: true }).click();
    await expect(toast(page)).toHaveText('Клиент записан');
    await expect(dialog(page)).toHaveCount(0);
    await expect(cards(page)).toHaveCount(4);
    await expect(cards(page).last()).toContainText('15:15');
  });

  test('запись: услуга со столом без оборудования — ошибка под полем', async ({ app, page }) => {
    await open(app, page);
    await section(page).getByRole('button', { name: 'Записать клиента' }).click();
    const d = dialog(page);
    await d.getByLabel('Услуга').selectOption({ label: 'SPA-ритуал' });
    await d.getByLabel('Клиент').selectOption({ label: 'Ольга Р.' });
    await d.getByLabel('Специалист').selectOption({ label: 'Анна Морозова · массажист' });
    await d.getByLabel('Кабинет').selectOption({ label: 'Кабинет № 3' });
    await d.getByLabel('Начало').selectOption({ label: '16:30' });
    await d.getByRole('button', { name: 'Записать', exact: true }).click();
    await expect(d).toContainText('Для услуги нужно оборудование');
    await d.getByLabel('Стол с подогревом').check();
    await d.getByRole('button', { name: 'Записать', exact: true }).click();
    await expect(toast(page)).toHaveText('Клиент записан');
  });

  test('перенос визита «Массаж спины» на 16:00', async ({ app, page }) => {
    await open(app, page);
    await card(page, BACK)
      .getByRole('button', { name: /^Перенести/ })
      .click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Перенести визит' })).toBeVisible();
    await d.getByLabel('Начало').selectOption({ label: '16:00' });
    await d.getByRole('button', { name: 'Перенести', exact: true }).click();
    await expect(toast(page)).toHaveText('Визит перенесён');
    await expect(card(page, BACK)).toContainText('16:00');
  });

  test('перенос на занятое время — конфликт ресурсов в диалоге, визит на месте', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await card(page, CLASSIC)
      .getByRole('button', { name: /^Перенести/ })
      .click();
    const d = dialog(page);
    await d.getByLabel('Начало').selectOption({ label: '11:00' });
    await d.getByRole('button', { name: 'Перенести', exact: true }).click();
    await expect(d.getByRole('alert').first()).toContainText('Конфликт ресурсов');
    await d.getByRole('button', { name: 'Отмена' }).click();
    await expect(card(page, CLASSIC)).toContainText('10:00');
  });

  test('отмена: причина обязательна; «Клиент не пришёл» — отдельный статус', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await card(page, BACK)
      .getByRole('button', { name: /^Отменить визит/ })
      .click();
    const d = dialog(page);
    await d.getByRole('button', { name: 'Отменить визит' }).click();
    await expect(d).toContainText('Укажите причину');
    await d.getByLabel('Причина').fill('Клиент перенёс запись');
    await d.getByRole('button', { name: 'Отменить визит' }).click();
    await expect(toast(page)).toHaveText('Визит отменён');
    await expect(card(page, BACK)).toContainText('Отменено');
    await card(page, CLASSIC)
      .getByRole('button', { name: /^Отменить визит/ })
      .click();
    await dialog(page).getByLabel('Клиент не пришёл').check();
    await dialog(page).getByRole('button', { name: 'Отменить визит' }).click();
    await expect(toast(page)).toHaveText('Отмечено: клиент не пришёл');
    await expect(card(page, CLASSIC)).toContainText('Не пришёл');
  });

  test('день: следующий и предыдущий, «Сегодня»; ?date= сохраняется; пустой день', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await section(page).getByRole('button', { name: 'Следующий день', exact: true }).click();
    await expect(page).toHaveURL(/[?&]date=2026-10-02/);
    await expect(section(page).locator('.ox-spa-date')).toHaveText('Пятница, 2 октября 2026');
    await expect(section(page).getByText('На этот день записей нет')).toBeVisible();
    await page.reload();
    await expect(section(page).locator('.ox-spa-date')).toHaveText('Пятница, 2 октября 2026', {
      timeout: 15_000,
    });
    await section(page).getByRole('button', { name: 'Сегодня', exact: true }).click();
    await expect(cards(page)).toHaveCount(3);
  });

  test('фильтр по статусу', async ({ app, page }) => {
    await open(app, page);
    await card(page, BACK)
      .getByRole('button', { name: /^Отменить визит/ })
      .click();
    await dialog(page).getByLabel('Причина').fill('Перенос');
    await dialog(page).getByRole('button', { name: 'Отменить визит' }).click();
    await expect(toast(page)).toHaveText('Визит отменён');
    await section(page).getByLabel('Статус').selectOption({ label: 'Подтверждённые' });
    await expect(cards(page)).toHaveCount(2);
    await section(page).getByLabel('Статус').selectOption({ label: 'Завершённые' });
    await expect(section(page).getByText('Нет визитов с таким статусом')).toBeVisible();
  });

  test('нет связи — тост, визит не изменился', async ({ app, page }) => {
    await open(app, page);
    await devScenario(page, { scenario: 'recordAppointmentPerformance=offline' });
    await card(page, CLASSIC)
      .getByRole('button', { name: /^Завершить процедуру/ })
      .click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(card(page, CLASSIC)).toContainText('Подтверждено');
  });

  test('специалист: «Мой день», свои визиты, без вкладки услуг и без завершения (нет ключа perform)', async ({
    app,
    page,
  }) => {
    // Каталог 0.12.0: роль «Массажист» (spa view, create) не получает spa.appointments.perform и spa.services.read —
    // «Завершить процедуру» и техкарта у специалиста появятся после решения Q-W5.21-6 (стюард каталога).
    await open(app, page, { persona: 'therapist' });
    await expect(section(page).locator('.ox-spa-crumb')).toContainText('· Четверг, 1 октября 2026');
    await expect(cards(page)).toHaveCount(3);
    await expect(section(page).getByRole('tab', { name: 'Услуги и техкарты' })).toHaveCount(0);
    await expect(section(page).getByRole('button', { name: /^Завершить процедуру/ })).toHaveCount(
      0,
    );
    await expect(card(page, 'SPA-ритуал, Ольга Р.')).toBeVisible();
    await expect(section(page).getByRole('button', { name: /^Перенести/ })).toHaveCount(3);
  });

  test('водитель — гейт «Нет доступа к разделу «Салон и SPA»»', async ({ app, page }) => {
    await open(app, page, { persona: 'driver' });
    await expect(page.getByText('Нет доступа к разделу «Салон и SPA»')).toBeVisible({
      timeout: 15_000,
    });
    await expect(section(page)).toHaveCount(0);
  });

  test('ошибка загрузки — «Повторить»; загрузка — скелетон', async ({ app, page }) => {
    await openPage(app, page, 'home');
    const tenant = page.url().match(/\/t\/([^/]+)\//)?.[1] ?? '';
    await devScenario(page, { scenario: 'listAppointments=rate_limited' });
    await app(`/t/${tenant}/spa`, { persona: 'owner' });
    await expect(section(page).getByRole('alert').first()).toContainText('Слишком много запросов');
    await devScenario(page, { scenario: 'listAppointments=delay=1500' });
    await section(page).getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByRole('main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(cards(page)).toHaveCount(3, { timeout: 15_000 });
  });

  test('1440 — боковая панель, 390 — нижняя навигация; без горизонтальной прокрутки', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await expect(cards(page)).toHaveCount(3);
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('клавиатура: Tab доходит до «Завершить процедуру», Enter завершает; фокус виден', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const target = card(page, CLASSIC).getByRole('button', { name: /^Завершить процедуру/ });
    await expect(target).toBeVisible();
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(toast(page)).toHaveText('Процедура завершена, материалы списаны по техкарте');
  });

  test('диалог записи: Escape закрывает, фокус возвращается на кнопку', async ({ app, page }) => {
    await open(app, page);
    const add = section(page).getByRole('button', { name: 'Записать клиента' });
    await add.click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog(page)).toHaveCount(0);
    await expect(add).toBeFocused();
  });

  test('axe без serious (страница и диалог); 390 — цели не меньше 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    await expect(cards(page)).toHaveCount(3);
    await card(page, RITUAL)
      .getByRole('button', { name: /^Завершить процедуру/ })
      .click();
    await expect(issue(page)).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const bad = async (): Promise<string[]> =>
      (await axe(page)).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(await bad()).toEqual([]);
    if (phone(page)) {
      expect(await hitHeight(issue(page).getByRole('button').first())).toBeGreaterThanOrEqual(44);
      expect(
        await hitHeight(section(page).getByRole('button', { name: 'Предыдущий день' })),
      ).toBeGreaterThanOrEqual(44);
      expect(
        await hitHeight(card(page, CLASSIC).getByRole('button', { name: /^Перенести/ })),
      ).toBeGreaterThanOrEqual(44);
      expect(await noHorizontalScroll(page)).toBe(true);
    }
    await section(page).getByRole('button', { name: 'Записать клиента' }).click();
    await expect(dialog(page)).toBeVisible();
    expect(await bad()).toEqual([]);
  });
});

test.describe('spa-appointments — «Салон и SPA», визиты @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(180_000);

  /** Услуга с техкартой и визит на свой день; страница читает их настоящим backend. */
  async function setup(
    app: Parameters<typeof openPage>[0],
    page: Page,
    project: string,
    o: { stocked?: boolean; table?: boolean; past?: boolean } = {},
  ) {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    const res = await spaResources(page, alta);
    const f = await stockFixture(page, alta, project, {
      lots: [{ qty: '500', expiresOn: dateIn(300) }],
    });
    if (o.stocked) await stockSalonWarehouse(page, alta, f.item.id, '500', dateIn(300));
    const svc = await spaService(page, alta, res, {
      name: `Массаж ${f.label}`,
      itemId: f.item.id,
      qty: '30',
      ...(o.table ? { equipmentIds: [res.table.id] } : {}),
    });
    const day = o.past ? pastDay() : standDay();
    const visit = await spaVisit(page, alta, res, svc, {
      date: day,
      time: '10:00',
      ...(o.table ? { equipmentIds: [res.table.id] } : {}),
    });
    return { alta, res, f, svc, day, visit };
  }

  const openDay = async (
    app: Parameters<typeof openPage>[0],
    page: Page,
    alta: string,
    day: string,
    persona: 'owner' | 'therapist' = 'owner',
  ): Promise<void> => {
    await app(`/t/${alta}/spa?date=${day}`, { persona });
    await expect(h1(page, persona === 'therapist' ? 'Мой день' : H1)).toBeVisible({
      timeout: 20_000,
    });
  };
  const visitCard = (page: Page, service: string): Locator =>
    cards(page).filter({ hasText: service });

  test('владелец на стенде: карточка визита — время, услуга, статус, кабинет, буфер, техкарта; остатки кабинета', async ({
    app,
    page,
  }, testInfo) => {
    const { alta, svc, f, day } = await setup(app, page, testInfo.project.name);
    await openDay(app, page, alta, day);
    await expect(section(page).locator('.ox-spa-crumb')).toHaveText(
      'Альта Групп · все специалисты',
    );
    const c = visitCard(page, svc.name);
    await expect(cards(page)).toHaveCount(1);
    await expect(c).toContainText('10:00');
    await expect(c).toContainText(`${svc.name} · 60 мин`);
    await expect(c).toContainText('Подтверждено');
    await expect(c).toContainText('Кабинет № 2 · без оборудования');
    await expect(c).toContainText('уборка 15 мин');
    await expect(c).toContainText(`${f.item.name} 30 мл`);
    await expect(stock(page)).toContainText('Остатки кабинета');
    await expect(stock(page)).toContainText(f.item.name);
    await page.reload();
    await expect(cards(page)).toHaveCount(1, { timeout: 20_000 });
  });

  test('владелец на стенде: «Завершить процедуру» списывает по техкарте один раз', async ({
    app,
    page,
  }, testInfo) => {
    const { alta, svc, day } = await setup(app, page, testInfo.project.name, {
      stocked: true,
      past: true,
    });
    await openDay(app, page, alta, day);
    await visitCard(page, svc.name)
      .getByRole('button', { name: /^Завершить процедуру/ })
      .click();
    await expect(visitCard(page, svc.name)).toContainText('Завершено · списано', {
      timeout: 20_000,
    });
    await expect(
      visitCard(page, svc.name).getByRole('button', { name: /^Завершить процедуру/ }),
    ).toHaveCount(0);
    await expect(issue(page).filter({ hasText: svc.name })).toHaveCount(0);
  });

  test('владелец на стенде: нехватка материала — баннер «Учёт материалов не завершён», после прихода «Завершить учёт» списывает', async ({
    app,
    page,
  }, testInfo) => {
    const { alta, svc, f, day } = await setup(app, page, testInfo.project.name, { past: true });
    await openDay(app, page, alta, day);
    await visitCard(page, svc.name)
      .getByRole('button', { name: /^Завершить процедуру/ })
      .click();
    // Сообщение о нехватке — тост, он гаснет за секунды; устойчивый признак — карточка и баннер.
    await expect(visitCard(page, svc.name)).toContainText('Выполнено · учёт не завершён', {
      timeout: 20_000,
    });
    // Баннер общий для всех визитов с незавершённым учётом на стенде — свой находим по названию услуги.
    const mine = issue(page).filter({ hasText: svc.name });
    await expect(mine).toContainText('Учёт материалов не завершён.');
    await expect(mine.getByRole('button')).toHaveText(['Завершить учёт']);
    // Остаток не списан. Приход на склад салона — и «Завершить учёт» доводит визит до конца.
    await stockSalonWarehouse(page, alta, f.item.id, '100', dateIn(300));
    await mine.getByRole('button', { name: 'Завершить учёт' }).click();
    await expect(visitCard(page, svc.name)).toContainText('Завершено · списано', {
      timeout: 20_000,
    });
    await expect(mine).toHaveCount(0);
  });

  test('владелец на стенде: запись клиента — конфликт ресурсов, затем свободное время', async ({
    app,
    page,
  }, testInfo) => {
    const { alta, svc, day } = await setup(app, page, testInfo.project.name);
    await openDay(app, page, alta, day);
    await section(page).getByRole('button', { name: 'Записать клиента' }).click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Записать клиента' })).toBeVisible();
    await d.getByLabel('Услуга').selectOption({ label: svc.name });
    await d.getByLabel('Клиент').selectOption({ index: 1 });
    await d.getByLabel('Специалист').selectOption({ index: 1 });
    await d.getByLabel('Кабинет').selectOption({ label: 'Кабинет № 2' });
    await d.getByLabel('Начало').selectOption({ label: '10:30' });
    await d.getByRole('button', { name: 'Записать', exact: true }).click();
    await expect(d.getByRole('alert').first()).toContainText('Время занято', {
      timeout: 20_000,
    });
    await expect(toast(page)).toHaveCount(0);
    await d.getByLabel('Начало').selectOption({ label: '15:15' });
    await d.getByRole('button', { name: 'Записать', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0, { timeout: 20_000 });
    await expect(cards(page)).toHaveCount(2);
    await expect(cards(page).last()).toContainText('15:15');
  });

  test('владелец на стенде: услуга со столом — без оборудования ошибка под полем, затем запись', async ({
    app,
    page,
  }, testInfo) => {
    const { alta, svc, res, day } = await setup(app, page, testInfo.project.name, { table: true });
    await openDay(app, page, alta, day);
    await section(page).getByRole('button', { name: 'Записать клиента' }).click();
    const d = dialog(page);
    await d.getByLabel('Услуга').selectOption({ label: svc.name });
    await d.getByLabel('Клиент').selectOption({ index: 1 });
    await d.getByLabel('Специалист').selectOption({ index: 1 });
    await d.getByLabel('Кабинет').selectOption({ label: 'Кабинет № 3' });
    await d.getByLabel('Начало').selectOption({ label: '16:30' });
    await d.getByRole('button', { name: 'Записать', exact: true }).click();
    await expect(d).toContainText('Для услуги нужно оборудование');
    await d.getByLabel(res.table.name).check();
    await d.getByRole('button', { name: 'Записать', exact: true }).click();
    await expect(dialog(page)).toHaveCount(0, { timeout: 20_000 });
    await expect(cards(page)).toHaveCount(2);
  });

  test('владелец на стенде: перенос визита на 16:00 переживает перезагрузку', async ({
    app,
    page,
  }, testInfo) => {
    const { alta, svc, day } = await setup(app, page, testInfo.project.name);
    await openDay(app, page, alta, day);
    await visitCard(page, svc.name)
      .getByRole('button', { name: /^Перенести/ })
      .click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Перенести визит' })).toBeVisible();
    await d.getByLabel('Начало').selectOption({ label: '16:00' });
    await d.getByRole('button', { name: 'Перенести', exact: true }).click();
    await expect(visitCard(page, svc.name)).toContainText('16:00', { timeout: 20_000 });
    await page.reload();
    await expect(visitCard(page, svc.name)).toContainText('16:00', { timeout: 20_000 });
  });

  test('владелец на стенде: отмена — причина обязательна; «Клиент не пришёл» — отдельный статус', async ({
    app,
    page,
  }, testInfo) => {
    const { alta, svc, res, day } = await setup(app, page, testInfo.project.name);
    await spaVisit(page, alta, res, svc, { date: day, time: '14:00', roomIndex: 1 });
    await openDay(app, page, alta, day);
    await expect(cards(page)).toHaveCount(2);
    await cards(page)
      .filter({ hasText: '14:00' })
      .getByRole('button', { name: /^Отменить визит/ })
      .click();
    const d = dialog(page);
    await d.getByRole('button', { name: 'Отменить визит' }).click();
    await expect(d).toContainText('Укажите причину');
    await d.getByLabel('Причина').fill('Клиент перенёс запись');
    await d.getByRole('button', { name: 'Отменить визит' }).click();
    await expect(cards(page).filter({ hasText: '14:00' })).toContainText('Отменено', {
      timeout: 20_000,
    });
    await cards(page)
      .filter({ hasText: '10:00' })
      .getByRole('button', { name: /^Отменить визит/ })
      .click();
    await dialog(page).getByLabel('Клиент не пришёл').check();
    await dialog(page).getByRole('button', { name: 'Отменить визит' }).click();
    await expect(cards(page).filter({ hasText: '10:00' })).toContainText('Не пришёл', {
      timeout: 20_000,
    });
    await section(page).getByLabel('Статус').selectOption({ label: 'Завершённые' });
    await expect(section(page).getByText('Нет визитов с таким статусом')).toBeVisible();
  });

  test('владелец на стенде: день — следующий и предыдущий, «Сегодня»; ?date= переживает перезагрузку', async ({
    app,
    page,
  }, testInfo) => {
    const { alta, svc, day } = await setup(app, page, testInfo.project.name);
    await openDay(app, page, alta, day);
    await expect(visitCard(page, svc.name)).toBeVisible();
    await section(page).getByRole('button', { name: 'Следующий день', exact: true }).click();
    await expect(page).toHaveURL(/[?&]date=\d{4}-\d{2}-\d{2}/);
    await expect(section(page).getByText('На этот день записей нет')).toBeVisible();
    await page.reload();
    await expect(section(page).getByText('На этот день записей нет')).toBeVisible({
      timeout: 20_000,
    });
    await section(page).getByRole('button', { name: 'Сегодня', exact: true }).click();
    await expect(section(page).locator('.ox-spa-date')).toHaveText('Четверг, 1 октября 2026');
  });

  test('специалист на стенде: «Мой день», свои визиты, без вкладки услуг и без завершения', async ({
    app,
    page,
  }, testInfo) => {
    const { alta, svc, day } = await setup(app, page, testInfo.project.name);
    await openDay(app, page, alta, day, 'therapist');
    await expect(section(page).locator('.ox-spa-crumb')).toContainText('·');
    await expect(visitCard(page, svc.name)).toBeVisible();
    await expect(section(page).getByRole('tab', { name: 'Услуги и техкарты' })).toHaveCount(0);
    await expect(section(page).getByRole('button', { name: /^Завершить процедуру/ })).toHaveCount(
      0,
    );
    await expect(
      section(page)
        .getByRole('button', { name: /^Перенести/ })
        .first(),
    ).toBeVisible();
  });

  test('водитель на стенде: гейт «Нет доступа к разделу «Салон и SPA»»', async ({ app, page }) => {
    await open(app, page, { persona: 'driver' });
    await expect(page.getByText('Нет доступа к разделу «Салон и SPA»')).toBeVisible({
      timeout: 20_000,
    });
    await expect(section(page)).toHaveCount(0);
  });
});
