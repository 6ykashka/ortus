// W1.20 · e2e страницы `shell`: оболочка на «Главной»-заглушке (эталон design-stage-1, «Ортус CRM.dc.html»
// :94–203, :2165–2174, :2274–2291; чек-лист docs/plan/analysis/01-shell.md §20 без демо-пунктов, PD-54;
// обязательные пункты verification-protocol.md §1.3). Персонаж — dev-вход ?persona= (e2e-сборка).
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/index.ts';
import { HOME_H1 } from './home.helpers.ts';
import { ALTA, call, devScenario, LOTOS, navTitles, setModule, tenantId } from './shell.helpers.ts';

const MAIN_NAV = { name: 'Основная навигация' } as const;
const BOTTOM_NAV = { name: 'Навигация', exact: true } as const;
const OWNER_MENU = [
  'Главная',
  'Модули и место',
  'Пользователи и роли',
  'Структура',
  'Подписка и места',
  'Оформление',
  'Салон и SPA',
  'Чаты',
  'Задачи',
  'Обращения',
  'Формы и опросы',
  'Календарь',
  'База знаний',
  'Документы',
  'Данные',
  'Файлы',
  'Касса',
];

const header = (page: Page) => page.getByRole('banner');
const mainNav = (page: Page) => page.getByRole('navigation', MAIN_NAV);
const desktop = (page: Page) => page.setViewportSize({ width: 1440, height: 900 });
const phone = (page: Page) => page.setViewportSize({ width: 390, height: 844 });

test.describe('shell — оболочка @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');

  test('загрузка: скелетон «Загружаем рабочее пространство…», затем оболочка', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    await devScenario(page, { scenario: 'getMyContext=delay=1500', once: true });
    await page.reload();
    const status = page.getByRole('status', { name: 'Загрузка' });
    await expect(status).toBeVisible();
    await expect(status).toContainText('Загружаем рабочее пространство…');
    await expect(header(page)).toContainText('Ортус');
    await expect(status).toBeHidden();
    await expect(header(page)).toContainText(ALTA);
  });

  test('стартовый маршрут владельца: / → /t/<«Альта»>/home, шапка и «Главная»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/home$`));
    await expect(header(page)).toContainText('пространство бизнеса');
    await expect(header(page)).toContainText(ALTA);
    await expect(page.getByRole('heading', { level: 1, name: HOME_H1 })).toBeVisible();
    await desktop(page);
    await expect(header(page)).toContainText('ортус');
    await expect(mainNav(page).getByRole('button', { name: 'Главная' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('меню владельца по D-23: группы и пункты в порядке эталона', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await desktop(page);
    await expect.poll(() => navTitles(mainNav(page))).toEqual(OWNER_MENU);
    const groups = mainNav(page).locator('.ox-nav-title');
    await expect(groups).toHaveText(['Обзор', 'Компания', 'Отрасли', 'Общие модули']);
    await expect(mainNav(page)).not.toContainText('Логистика');
    await expect(mainNav(page)).not.toContainText('Отключены · только чтение');
  });

  test('1440: боковая панель 244 px с заголовками групп и подписью изоляции', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    await desktop(page);
    const nav = mainNav(page);
    await expect(nav).toHaveCSS('width', '244px');
    await expect(nav.locator('.ox-nav-title').first()).toBeVisible();
    await expect(nav).toContainText('Данные других организаций изолированы');
    await expect(page.getByRole('navigation', BOTTOM_NAV)).toBeHidden();
  });

  test('768: рейл 68 px без заголовков, подпись пункта — в title', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await page.setViewportSize({ width: 768, height: 1024 });
    const nav = mainNav(page);
    await expect(nav).toHaveCSS('width', '68px');
    await expect(nav.locator('.ox-nav-title').first()).toBeHidden();
    const item = nav.getByRole('button', { name: 'Модули и место' });
    await expect(item).toHaveAttribute('title', 'Модули и место');
    await expect(page.getByRole('navigation', BOTTOM_NAV)).toBeHidden();
  });

  test('390: нижняя навигация «Главная», «Модули», «Люди», «Ещё», без «ортус»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    await phone(page);
    const bottom = page.getByRole('navigation', BOTTOM_NAV);
    // Текст кнопки включает лигатуру иконки (aria-hidden), сверяется окончание подписи.
    await expect(bottom.getByRole('button')).toHaveText([/Главная$/, /Модули$/, /Люди$/, /Ещё$/]);
    await expect(mainNav(page)).toBeHidden();
    await expect(header(page).getByText('ортус', { exact: true })).toBeHidden();
  });

  test('лист «Все разделы»: открыть «Ещё», перейти в «Оформление», лист закрыт', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    await phone(page);
    const more = page.getByRole('navigation', BOTTOM_NAV).getByRole('button', { name: 'Ещё' });
    await more.click();
    const sheet = page.getByRole('dialog', { name: 'Все разделы' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Закрыть' })).toBeFocused();
    await expect(sheet.locator('.ox-sheet-group')).toHaveText([
      'Обзор',
      'Компания',
      'Отрасли',
      'Общие модули',
    ]);
    await sheet.getByRole('button', { name: 'Оформление' }).click();
    await expect(sheet).toBeHidden();
    await expect(page).toHaveURL(/\/branding$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Оформление' })).toBeVisible();
    await more.click();
    await expect(sheet.getByRole('button', { name: 'Оформление' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expect(more).toBeFocused();
  });

  test('после подключения «Логистики» у владельца появляется группа «Логистика»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    await setModule(page, await tenantId(page), 'fleet', true);
    await page.reload();
    await desktop(page);
    await expect(mainNav(page).locator('.ox-nav-title')).toHaveText([
      'Обзор',
      'Компания',
      'Логистика',
      'Отрасли',
      'Общие модули',
    ]);
    await expect
      .poll(async () => (await navTitles(mainNav(page))).slice(6, 9))
      .toEqual(['Рабочее место логиста', 'Ресурсный пул', 'Приёмка смен']);
  });

  test('D-23: отключённая с историей «Логистика» — пункт в «Отключены · только чтение»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await setModule(page, alta, 'fleet', true);
    await setModule(page, alta, 'fleet', false);
    await page.reload();
    await desktop(page);
    const titles = mainNav(page).locator('.ox-nav-title');
    await expect(titles.last()).toHaveText('Отключены · только чтение');
    await expect(titles.filter({ hasText: /^Логистика$/ })).toHaveCount(0);
    await mainNav(page).getByRole('button', { name: 'Логистика' }).click();
    await expect(page).toHaveURL(/\/fleet$/);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Рабочее место логиста' }),
    ).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Модуль «Логистика» отключён.' }),
    ).toContainText(
      'Новые брони и рейсы закрыты. Начатые смены можно завершить; история доступна для чтения.',
    );
  });

  test('меню водителя: «Сегодня», «Автомобили», «Подотчёт», «Чаты», «База знаний», «Документы»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'driver' });
    await expect(page).toHaveURL(/\/today$/);
    await desktop(page);
    await expect
      .poll(() => navTitles(mainNav(page)))
      .toEqual(['Сегодня', 'Автомобили', 'Подотчёт', 'Чаты', 'База знаний', 'Документы']);
    await expect(mainNav(page).locator('.ox-nav-title')).toHaveText(['Работа']);
    await expect(page.locator('#ox-main > div')).toHaveCSS('max-width', '680px');
  });

  test('меню массажиста и прораба по рабочему месту', async ({ app, page }) => {
    await app('/', { persona: 'therapist' });
    await expect(page).toHaveURL(/\/spa$/);
    await desktop(page);
    // «Касса» массажиста — по праву cash.* (W1.49); в сиде этапа 1 его нет (allowlist shell-therapist.md, этап 5).
    await expect
      .poll(() => navTitles(mainNav(page)))
      .toEqual(['Мой день', 'Чаты', 'Календарь', 'База знаний']);
    await expect(header(page)).toContainText('Салон и SPA · мой календарь');

    await app('/', { persona: 'foreman' });
    await expect(page).toHaveURL(/\/repair$/);
    await expect
      .poll(() => navTitles(mainNav(page)))
      .toEqual(['Объекты', 'Подотчёт', 'Чаты', 'Задачи', 'База знаний', 'Документы']);
    await expect(mainNav(page).locator('.ox-nav-title')).toHaveText([
      'Ремонт и стройка',
      'Общие модули',
    ]);
    await expect(header(page)).toContainText('Назначенные объекты');
  });

  test('390: нижняя навигация водителя и прораба — как в эталоне (:3028)', async ({
    app,
    page,
  }) => {
    const bottom = page.getByRole('navigation', BOTTOM_NAV);
    await app('/', { persona: 'driver' });
    await phone(page);
    await expect(bottom.getByRole('button')).toHaveText([
      /Сегодня$/,
      /Автомобили$/,
      /Подотчёт$/,
      /Ещё$/,
    ]);
    await app('/', { persona: 'foreman' });
    await phone(page);
    await expect(bottom.getByRole('button')).toHaveText([/Объекты$/, /Подотчёт$/, /Чаты$/, /Ещё$/]);
    await bottom.getByRole('button', { name: 'Подотчёт' }).click();
    await expect(page).toHaveURL(/\/cash-self$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Подотчёт' })).toBeVisible();
  });

  // W1.49: «Касса» массажиста — по праву cash.* (core() эталона :2964); в «Лотосе» роли «Кассир салона» нет
  // (01-shell.md §8.3, §20 п. 33).
  test('массажист «Лотоса»: «Мой день», «Чаты», «Календарь», «База знаний» — без «Касса»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'therapist' });
    const lotos = await tenantId(page, LOTOS);
    await header(page).getByRole('button', { name: 'Сменить бизнес' }).click();
    await page
      .getByRole('dialog', { name: 'Бизнесы' })
      .getByRole('button', { name: LOTOS })
      .click();
    await expect(page).toHaveURL(new RegExp(`/t/${lotos}/spa$`));
    const menu = ['Мой день', 'Чаты', 'Календарь', 'База знаний'];
    if ((page.viewportSize()?.width ?? 0) < 640) {
      // Телефон: нижняя навигация — первые три пункта и «Ещё»; лист «Все разделы» — все пункты меню.
      const bottom = page.getByRole('navigation', BOTTOM_NAV);
      await expect(bottom.getByRole('button')).toHaveText([
        /Мой день$/,
        /Чаты$/,
        /Календарь$/,
        /Ещё$/,
      ]);
      await bottom.getByRole('button', { name: 'Ещё' }).click();
      const sheet = page.getByRole('dialog', { name: 'Все разделы' });
      await expect(sheet.locator('.ox-sheet-item')).toHaveText(
        menu.map((m) => new RegExp(`${m}$`)),
      );
      await expect(sheet).not.toContainText('Касса');
      await page.keyboard.press('Escape');
    }
    await desktop(page);
    await expect.poll(() => navTitles(mainNav(page))).toEqual(menu);
    await expect(mainNav(page)).not.toContainText('Касса');
  });

  test('оператор: тёмная шапка, «Управление платформой», меню «Платформа»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'operator' });
    await expect(page).toHaveURL(/\/platform\/tenants$/);
    await desktop(page);
    await expect(header(page)).toHaveCSS('background-color', 'rgb(28, 42, 38)');
    await expect(header(page)).toContainText('управление платформой');
    await expect(header(page)).toContainText('Управление платформой');
    await expect(header(page)).toContainText('Отдельный вход · без доступа к данным клиентов');
    await expect(header(page).getByRole('button', { name: /^Уведомления/ })).toHaveCount(0);
    await expect(header(page).getByRole('button', { name: 'Профиль' })).toHaveText('ОП');
    await expect
      .poll(() => navTitles(mainNav(page)))
      .toEqual([
        'Организации',
        'Использование',
        'Заявки на тариф',
        'Пользователи',
        'Тарифная сетка',
      ]);
    await expect(mainNav(page)).toContainText('Без доступа к данным клиентов');
    await expect(page.locator('#ox-main [role="status"], #ox-main [role="alert"]')).toHaveCount(0);
  });

  test('область: у владельца select «Область просмотра», у сотрудника — текст', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const select = page.getByLabel('Область просмотра');
    await expect(select.locator('option').first()).toHaveText('Все подразделения');
    await expect(select.locator('option', { hasText: 'Москва · весь регион' })).toHaveCount(1);
    await expect(select.locator('option', { hasText: 'Москва / Север Логистик' })).toHaveCount(1);
    await app('/', { persona: 'manager' });
    await expect(header(page)).toContainText('Область не назначена');
    await expect(page.getByLabel('Область просмотра')).toHaveCount(0);
  });

  test('переключатель бизнеса: две организации в порядке ru, выбор — selectTenant', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'therapist' });
    const alta = await tenantId(page, ALTA);
    const lotos = await tenantId(page, LOTOS);
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/spa$`));
    const open = header(page).getByRole('button', { name: 'Сменить бизнес' });
    await open.click();
    await expect(open).toHaveAttribute('aria-expanded', 'true');
    const list = page.getByRole('dialog', { name: 'Бизнесы' });
    await expect(list.getByRole('button')).toHaveText([ALTA, LOTOS]);
    await expect(list.getByRole('button', { name: ALTA })).toHaveAttribute('aria-current', 'true');
    const select = page.waitForResponse((r) => r.url().endsWith('/api/v1/me/selected-tenant'));
    await list.getByRole('button', { name: LOTOS }).click();
    expect((await select).status()).toBe(200);
    await expect(page).toHaveURL(new RegExp(`/t/${lotos}/spa$`));
    await expect(header(page)).toContainText(LOTOS);
    const me = (await call(page, 'GET', '/api/v1/me/context')).body as { lastTenantId?: string };
    expect(me.lastTenantId).toBe(lotos);
  });

  test('переключатель бизнеса: ошибка selectTenant — тост, организация не меняется', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'therapist' });
    await devScenario(page, { scenario: 'selectTenant=not_found' });
    const url = page.url();
    await header(page).getByRole('button', { name: 'Сменить бизнес' }).click();
    await page
      .getByRole('dialog', { name: 'Бизнесы' })
      .getByRole('button', { name: LOTOS })
      .click();
    await expect(page.getByRole('alert')).toHaveText(/Объект не найден или недоступен\./);
    expect(page.url()).toBe(url);
    await expect(header(page)).toContainText(ALTA);
  });

  test('входящие: кнопка «Уведомления» со счётчиком и поповер', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const summary = (await call(page, 'GET', '/api/v1/me/notifications/summary')).body as {
      tenants: { tenantId: string; unreadCount: number }[];
    };
    const alta = await tenantId(page);
    const n = summary.tenants.find((t) => t.tenantId === alta)?.unreadCount ?? 0;
    const bell = header(page).getByRole('button', {
      name: n ? `Уведомления: ${n} новых` : 'Уведомления',
    });
    await expect(bell).toBeVisible();
    await bell.click();
    await expect(bell).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByRole('dialog', { name: 'Уведомления' });
    await expect(panel).toContainText('Уведомления');
    // Есть непрочитанные — тело не пустое (список событий), «Прочитать все» снимает счётчик.
    expect(n).toBeGreaterThan(0);
    await expect(panel.locator('.ox-inbox-item').first()).toBeVisible();
    expect(await panel.locator('.ox-inbox-item').count()).toBeGreaterThanOrEqual(n);
    await expect(panel).not.toContainText('Новых событий нет');
    const read = page.waitForResponse((r) => r.url().endsWith('/api/v1/me/notifications/read'));
    await panel.getByRole('button', { name: 'Прочитать все' }).click();
    expect((await read).status()).toBe(200);
    await expect(
      header(page).getByRole('button', { name: 'Уведомления', exact: true }),
    ).toBeVisible();

    await app('/', { persona: 'driver' });
    await header(page).getByRole('button', { name: 'Уведомления' }).click();
    await expect(page.getByRole('dialog', { name: 'Уведомления' })).toContainText(
      'Новых событий нет',
    );
  });

  test('профиль: имя, назначения, «Выйти»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await header(page).getByRole('button', { name: 'Профиль' }).click();
    const profile = page.getByRole('dialog', { name: 'Профиль' });
    await expect(profile).toContainText('Дарья Зимина');
    await expect(profile).toContainText('Назначения');
    await expect(profile).toContainText('Владелец бизнеса · Вся организация');
    await profile.getByRole('button', { name: 'Выйти' }).click();
    await expect(page).toHaveURL(/\/auth\/login$/);
    expect((await call(page, 'GET', '/api/v1/me/context')).status).toBe(401);

    await app('/', { persona: 'manager' });
    // Клик — после редиректа / → стартовая страница: иначе поповер закрывается сменой маршрута.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await header(page).getByRole('button', { name: 'Профиль' }).click();
    const logist = page.getByRole('dialog', { name: 'Профиль' });
    await expect(logist).toContainText('Марина Котова');
    await expect(logist).toContainText('Ролей нет — доступ к модулям не выдан');
  });

  // W1.49: после «Выйти» запросы оболочки не перезапускаются — нет ответов 401 и ошибок консоли.
  test('«Выйти»: после выхода нет ответов 401 и ошибок консоли', async ({ app, page, net }) => {
    await app('/', { persona: 'owner' });
    await expect(page.getByRole('heading', { level: 1, name: HOME_H1 })).toBeVisible();
    await expect(
      header(page).getByRole('button', { name: /^Уведомления: \d+ новых$/ }),
    ).toBeVisible();
    await page.waitForLoadState('networkidle');
    const errorsBefore = net.consoleErrors().length;
    const seen: string[] = [];
    page.on('response', (r) => {
      if (new URL(r.url()).pathname.startsWith('/api/')) {
        seen.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`);
      }
    });
    await header(page).getByRole('button', { name: 'Профиль' }).click();
    await page
      .getByRole('dialog', { name: 'Профиль' })
      .getByRole('button', { name: 'Выйти' })
      .click();
    await expect(page).toHaveURL(/\/auth\/login$/);
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(500);
    expect(seen).toEqual(['200 POST /api/v1/auth/logout']);
    expect(net.consoleErrors().slice(errorsBefore)).toEqual([]);
  });

  test('поповеры исключают друг друга, Escape закрывает', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const profile = header(page).getByRole('button', { name: 'Профиль' });
    await profile.click();
    await expect(page.getByRole('dialog', { name: 'Профиль' })).toBeVisible();
    await header(page)
      .getByRole('button', { name: /^Уведомления/ })
      .click();
    await expect(page.getByRole('dialog', { name: 'Профиль' })).toBeHidden();
    await expect(page.getByRole('dialog', { name: 'Уведомления' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Уведомления' })).toBeHidden();
    await expect(profile).toHaveAttribute('aria-expanded', 'false');
  });

  test('офлайн: пилюля «Нет связи», баннер «Нет связи.» и тост', async ({ app, page, context }) => {
    await app('/', { persona: 'owner' });
    // W2.25: «Главная» — ленивая страница (не заглушка): связь рвётся, когда её модуль уже загружен.
    await expect(page.getByRole('heading', { level: 1, name: HOME_H1 })).toBeVisible();
    await context.setOffline(true);
    const toast = page.locator('.ox-toast');
    await expect(toast).toHaveText(/Нет связи\. Черновики сохраняются на устройстве/);
    await expect(toast).toHaveAttribute('aria-live', 'polite');
    await expect(header(page).getByRole('status')).toHaveText(/Нет связи/);
    await expect(page.locator('#ox-main').getByRole('status').first()).toContainText(
      'Нет связи. Черновики, фото и расходы сохраняются на устройстве. Бронь, выезд и приёмка требуют подтверждения сервера.',
    );
    const bottom = page.viewportSize()?.width === 390 ? '76px' : '20px';
    await expect(toast).toHaveCSS('bottom', bottom);
    await context.setOffline(false);
    await expect(header(page).getByRole('status')).toHaveCount(0);
    await expect(page.locator('#ox-main')).not.toContainText('Нет связи.');
    await expect(toast).toBeHidden({ timeout: 6000 });
  });

  test('баннер «Пробный период завершён.» без демо-кнопки', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await devScenario(page, { preset: 'trial-ended' });
    await page.reload();
    const banner = page.getByRole('status').filter({ hasText: 'Пробный период завершён.' });
    await expect(banner).toContainText(
      'Новые операции ограничены. История доступна для чтения и выгрузки, данные не удаляются. Начатые смены можно завершить.',
    );
    await expect(page.getByRole('button', { name: 'Демо: продлить как оператор' })).toHaveCount(0);
  });

  test('баннер «Место организации заполнено.» ведёт в «Модули и место»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await devScenario(page, { preset: 'storage-full' });
    await page.reload();
    const banner = page.getByRole('alert');
    await expect(banner).toContainText('Место организации заполнено.');
    await banner.getByRole('button', { name: 'Открыть «Модули и место»' }).click();
    await expect(page).toHaveURL(/\/modules$/);
    await expect(page.getByRole('alert')).toContainText('Место организации заполнено.');
    await expect(page.getByRole('button', { name: 'Открыть «Модули и место»' })).toHaveCount(0);
  });

  // Эталон bannersVM :3096: «Место организации заполнено.» видят все, кроме оператора; не владельцу — текст
  // сотрудника и без кнопки. Источник — tenantState.storageWriteStatus в /me/context (0.4.0-stage1).
  for (const persona of ['driver', 'foreman'] as const) {
    test(`баннер «Место организации заполнено.» у сотрудника (${persona}): текст сотрудника, без кнопки`, async ({
      app,
      page,
    }) => {
      await app('/', { persona });
      await devScenario(page, { preset: 'storage-full' });
      await page.reload();
      const banner = page.getByRole('alert');
      await expect(banner).toContainText(
        'Место организации заполнено. Новые загрузки ограничены. Фото текущей смены сохраняются в пределах временного резерва.',
      );
      await expect(banner).not.toContainText('Освободите место или увеличьте лимит.');
      await expect(banner.getByRole('button')).toHaveCount(0);
    });
  }

  test('Escape в поповере «Профиль» возвращает фокус на кнопку «Профиль» с видимым кольцом (PD-29)', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    await desktop(page);
    await expect(mainNav(page).locator('.ox-nav-item').first()).toBeVisible();
    const profile = header(page).getByRole('button', { name: 'Профиль' });
    await profile.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Профиль' });
    await dialog.getByRole('button', { name: 'Выйти' }).focus();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(profile).toBeFocused();
    await expect(profile).toHaveCSS('outline-style', 'solid');
  });

  // Кадр загрузки эталона (:2821–2823, :149–170): меню 244 px без пунктов с подписью «Данные других организаций
  // изолированы», в шапке нет знака и «ортус · пространство бизнеса».
  test('кадр загрузки: меню без пунктов с подписью изоляции, шапка без знака', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    await devScenario(page, { scenario: 'getMyContext=loading' });
    await desktop(page);
    await page.reload();
    await expect(page.getByRole('status', { name: 'Загрузка' })).toBeVisible();
    const nav = mainNav(page);
    await expect(nav).toBeVisible();
    await expect(nav).toHaveCSS('width', '244px');
    await expect(nav).toContainText('Данные других организаций изолированы');
    await expect(nav.getByRole('button')).toHaveCount(0);
    await expect(header(page)).toContainText('Загрузка…');
    await expect(header(page)).not.toContainText('пространство бизнеса');
    await expect(header(page).locator('.ox-brand-letter')).toHaveCount(0);
  });

  test('ошибка загрузки: alert «Не удалось загрузить модули прототипа: …»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    await devScenario(page, { scenario: 'getMyContext=offline' });
    await page.reload();
    await expect(page.getByRole('alert')).toHaveText(
      'Не удалось загрузить модули прототипа: Нет связи с сервером. Операция не выполнена.',
    );
  });

  test('без входа: «Нужен вход» и ссылка «Войти»', async ({ app, page }) => {
    await app('/');
    await expect(page.getByText('Нужен вход')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/auth/login');
  });

  test('прямой URL: пункт меню отмечен, неизвестная страница — «Страница не найдена»', async ({
    app,
    page,
  }) => {
    // W2.81, возврат 1: семь полных загрузок приложения (dev-сервер, MSW) — под нагрузкой дольше 30 с.
    test.slow();
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await app(`/t/${alta}/branding`, { persona: 'owner' });
    await desktop(page);
    await expect(mainNav(page).getByRole('button', { name: 'Оформление' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    await app(`/t/${alta}/planned`, { persona: 'owner' });
    await expect(
      page.getByRole('heading', { level: 1, name: 'Страница не найдена' }),
    ).toBeVisible();
    await expect(header(page)).toContainText(ALTA);
    for (const url of ['/t/00000000-0000-4000-8000-000000000000/home', '/nonsense/path']) {
      await app(url, { persona: 'owner' });
      await expect(
        page.getByRole('heading', { level: 1, name: 'Страница не найдена' }),
      ).toBeVisible();
      await expect(page.locator('body')).not.toContainText('Выберите раздел в меню.');
      await page.getByRole('link', { name: 'На стартовую страницу' }).click();
      await expect(page).toHaveURL(new RegExp(`/t/${alta}/home$`));
    }
    await app('/platform/usage', { persona: 'operator' });
    await desktop(page);
    await expect(mainNav(page).getByRole('button', { name: 'Использование' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  test('клавиатура: «К содержимому», Tab по шапке и меню, фокус виден', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await desktop(page);
    await expect(header(page)).toContainText(ALTA);
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'К содержимому' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Область просмотра')).toBeFocused();
    await page.keyboard.press('Tab');
    const bell = header(page).getByRole('button', { name: /^Уведомления/ });
    await expect(bell).toBeFocused();
    await expect(bell).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(mainNav(page).getByRole('button', { name: 'Главная' })).toBeFocused();
    await skip.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('#ox-main')).toBeFocused();
  });

  test('axe: нет serious и critical у владельца, оператора и водителя', async ({
    app,
    page,
    axe,
  }) => {
    for (const persona of ['owner', 'operator', 'driver'] as const) {
      await app('/', { persona });
      await expect(page.locator('.ox-nav-item').first()).toBeAttached();
      const r = await axe(page);
      expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
        [],
      );
    }
  });

  test('раскладка: на 390 нет горизонтальной прокрутки, цели ≥ 44 px', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await phone(page);
    const scroll = await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0);
    expect(scroll).toBeLessThanOrEqual(390);
    const bottom = page.getByRole('navigation', BOTTOM_NAV).getByRole('button');
    for (const box of await bottom.evaluateAll((els) =>
      els.map((e) => e.getBoundingClientRect()),
    )) {
      expect(box.height).toBeGreaterThanOrEqual(60);
    }
    // Иконки шапки — 40 и 36 px, как нарисовано (01-shell.md §19 п. 14, PD-28).
    const bell = await header(page)
      .getByRole('button', { name: /^Уведомления/ })
      .boundingBox();
    const profile = await header(page).getByRole('button', { name: 'Профиль' }).boundingBox();
    expect([bell?.height, profile?.height]).toEqual([40, 36]);
  });

  // W1.49, возврат 1 (проверяющий shell): переключатель бизнеса — no-reference (B-6), «как нарисовано» к нему
  // не относится: цель ≥ 44 px (verification-protocol §1 п. 3) на 390, 768 и 1440; вся цель кликабельна, в том
  // числе поверх строки области под названием; название остаётся на месте (сверка — visual shell-therapist).
  // Возврат 2: цель меряется попаданием (elementFromPoint), а не рамкой кнопки — зона нажатия может быть шире
  // рамки (псевдоэлемент), рамка же определяет кольцо фокуса (строка ниже). Цель целиком внутри шапки.
  test('раскладка: переключатель бизнеса массажиста — цель ≥ 44 px на 390, 768 и 1440', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'therapist' });
    const switcher = header(page).getByRole('button', { name: /сменить бизнес/i });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(switcher).toBeVisible();
      const target = await switcher.evaluate((el) => {
        const r = el.getBoundingClientRect();
        const banner = el.closest('header');
        if (!banner) throw new Error('переключатель вне шапки');
        const hdr = banner.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const hit = (x: number, y: number) => el.contains(document.elementFromPoint(x, y));
        // Сплошная полоса попаданий через центр названия, шаг 0,5 px, в пределах шапки и окна.
        const run = (from: number, to: number, at: (v: number) => boolean, c: number) => {
          let lo = c;
          let hi = c;
          while (lo - 0.5 >= from && at(lo - 0.5)) lo -= 0.5;
          while (hi + 0.5 <= to && at(hi + 0.5)) hi += 0.5;
          return [lo, hi] as const;
        };
        const [top, bottom] = run(Math.max(0, hdr.top), hdr.bottom - 0.5, (y) => hit(cx, y), cy);
        const [left, right] = run(0, innerWidth - 0.5, (x) => hit(x, cy), cx);
        return { top, bottom, left, right, hdrTop: hdr.top, hdrBottom: hdr.bottom };
      });
      expect(target.bottom - target.top + 0.5, `${width}: высота цели`).toBeGreaterThanOrEqual(44);
      expect(target.right - target.left + 0.5, `${width}: ширина цели`).toBeGreaterThanOrEqual(44);
      expect(target.top, `${width}: цель внутри шапки сверху`).toBeGreaterThanOrEqual(
        target.hdrTop,
      );
      expect(target.bottom, `${width}: цель внутри шапки снизу`).toBeLessThanOrEqual(
        target.hdrBottom,
      );
    }
  });

  // W1.49, возврат 2 (ревью и проверяющий shell): кольцо :focus-visible переключателя целиком внутри шапки
  // (не обрезано краем окна) и обводит только строку названия — строка области «Салон и SPA · мой календарь»
  // в элемент управления не входит (verification-protocol §1 п. 3 «фокус виден»; WCAG 2.4.7, 2.4.11).
  test('фокус: кольцо переключателя бизнеса — внутри шапки и только на строке названия', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'therapist' });
    const switcher = header(page).getByRole('button', { name: /сменить бизнес/i });
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(switcher).toBeVisible();
      await switcher.focus();
      await expect(switcher).toBeFocused();
      const ring = await switcher.evaluate((el) => {
        const s = getComputedStyle(el);
        const rect = (e: Element | null | undefined) => {
          if (!e) throw new Error('нет элемента шапки');
          return e.getBoundingClientRect();
        };
        const r = el.getBoundingClientRect();
        const hdr = rect(el.closest('header'));
        const name = rect(el.querySelector('.ox-org-name'));
        const scope = rect(el.parentElement?.querySelector('.ox-org-scope'));
        const out = parseFloat(s.outlineWidth) + Math.max(0, parseFloat(s.outlineOffset));
        return {
          style: s.outlineStyle,
          width: parseFloat(s.outlineWidth),
          top: r.top - out,
          bottom: r.bottom + out,
          boxTop: r.top,
          boxBottom: r.bottom,
          nameTop: name.top,
          nameBottom: name.bottom,
          scopeTop: scope.top,
          hdrTop: hdr.top,
          hdrBottom: hdr.bottom,
        };
      });
      expect(ring.style, `${width}: кольцо есть`).not.toBe('none');
      expect(ring.width, `${width}: кольцо есть`).toBeGreaterThanOrEqual(2);
      expect(ring.top, `${width}: верх кольца внутри шапки`).toBeGreaterThanOrEqual(
        Math.max(0, ring.hdrTop),
      );
      expect(ring.bottom, `${width}: низ кольца внутри шапки`).toBeLessThanOrEqual(ring.hdrBottom);
      // Рамка элемента управления (её обводит кольцо) — строка названия, не выше и не ниже неё; допуск 1 px —
      // значок expand_more (18 px) на 0,6 px выше строки текста (17,x px).
      expect(ring.boxTop, `${width}: рамка — от верха названия`).toBeGreaterThanOrEqual(
        ring.nameTop - 1,
      );
      expect(ring.boxBottom, `${width}: рамка не заходит на строку области`).toBeLessThanOrEqual(
        Math.min(ring.nameBottom, ring.scopeTop) + 1,
      );
      // Кольцо не перечёркивает текст строки области: заглавные 12 px при line-height 1,2 начинаются ≈ 4 px ниже
      // верха строки (проходка MCP возврата 2: при outline-offset 2px низ кольца 34,3 px — по верху «Салон и SPA»).
      // Штрих кольца заходит на строку области не глубже 2 px — запас до букв ≥ 2 px.
      expect(
        ring.bottom,
        `${width}: кольцо не заходит на текст строки области`,
      ).toBeLessThanOrEqual(ring.scopeTop + 2);
    }
  });
});

test.describe('shell — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец: оболочка «Альта Групп» по /me/context стенда', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    // Первый /me/context стенда на холодном Vite и cmd/api бывает дольше 5 с (прогон возврата 3, 390).
    await expect(page).toHaveURL(/\/t\/[0-9a-f-]{36}\/home$/, { timeout: 15_000 });
    await expect(header(page)).toContainText(ALTA);
    await expect(page.getByRole('heading', { level: 1, name: HOME_H1 })).toBeVisible();
  });

  // Признак «есть роль организации» выводится из возможностей /me/context (profile.ts, Q-W1.20-16): стенд берёт
  // возможности только из access.role_assignments (mehttp.capabilities), неявных self-прав нет. Сид стенда этапа 1
  // ролей ещё не содержит (cmd/seed/tenant.go: «Roles … are added by their steps»), поэтому сейчас «Ролей нет» —
  // у всех, кроме владельца; строка водителя с ролью — ниже, после сида ролей.
  test('профиль: «Ролей нет — доступ к модулям не выдан» у логиста без назначений', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'manager' });
    // Клик — после редиректа / → стартовая страница: иначе поповер закрывается сменой маршрута.
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await header(page).getByRole('button', { name: 'Профиль' }).click();
    const logist = page.getByRole('dialog', { name: 'Профиль' });
    await expect(logist).toContainText('Марина Котова');
    await expect(logist).toContainText('Ролей нет — доступ к модулям не выдан');
  });

  // W1.42 (Q-W1.49-2, интегратор при влитии): билет createRealtimeTicket — 201, сокет /api/v1/realtime через
  // прокси Vite (`ws: true`, Q-W1.49-4) открыт, первый кадр — `auth`, сокет держится; без тоста и без повторов.
  // Подсказка context.changed ≤ 5 с закреплена integration-тестом TestStackRealtimeS115 (cmd/api).
  test('канал реального времени: билет 201, сокет открыт — без тоста, один билет', async ({
    app,
    page,
    net,
  }) => {
    const tickets: number[] = [];
    page.on('response', (r) => {
      if (new URL(r.url()).pathname === '/api/v1/auth/realtime-tickets') tickets.push(r.status());
    });
    const sockets: { closed: boolean; sent: string[] }[] = [];
    page.on('websocket', (ws) => {
      if (new URL(ws.url()).pathname !== '/api/v1/realtime') return;
      const s = { closed: false, sent: [] as string[] };
      sockets.push(s);
      ws.on('framesent', (f) => s.sent.push(String(f.payload)));
      ws.on('close', () => {
        s.closed = true;
      });
    });
    await app('/', { persona: 'owner' });
    await expect(page).toHaveURL(/\/t\/[0-9a-f-]{36}\/home$/, { timeout: 15_000 });
    await expect.poll(() => tickets, { timeout: 10_000 }).toEqual([201]);
    await expect
      .poll(() => sockets[0]?.sent.map((p) => (JSON.parse(p) as { type?: string }).type)[0], {
        timeout: 10_000,
      })
      .toBe('auth');
    await desktop(page);
    await mainNav(page).getByRole('button', { name: 'Оформление' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Оформление' })).toBeVisible();
    await page.waitForTimeout(3_000);
    expect(tickets).toEqual([201]);
    expect(sockets.map((s) => s.closed)).toEqual([false]);
    await expect(page.locator('.ox-toast')).toHaveCount(0);
    expect(net.pageErrors()).toEqual([]);
    expect(net.consoleErrors()).toEqual([]);
  });

  // W1.49: backend W1.03 (selectTenant), W1.04 (сид ролей) и W1.08 (modules, tenantState) — в main.
  // W2.54: базовый сид стенда включает «Логистику» в «Альте» — пункты логиста в группе «Отрасли» перед «Салон и SPA».
  test('меню D-23 владельца по доступности модулей стенда (W1.08)', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    await expect(page).toHaveURL(/\/t\/[0-9a-f-]{36}\/home$/, { timeout: 15_000 });
    await desktop(page);
    const salon = OWNER_MENU.indexOf('Салон и SPA');
    const menu = [
      ...OWNER_MENU.slice(0, salon),
      'Рабочее место логиста',
      'Ресурсный пул',
      'Приёмка смен',
      ...OWNER_MENU.slice(salon),
    ];
    await expect.poll(() => navTitles(mainNav(page))).toEqual(menu);
    await expect(mainNav(page)).not.toContainText('Отключены · только чтение');
  });

  test('переключатель бизнеса: «SPA «Лотос»» — selectTenant 200, меню массажиста (W1.03)', async ({
    app,
    page,
  }) => {
    // Сид стенда общий для строк и проектов: последняя выбранная организация хранится на сервере, поэтому строка
    // начинает с «Альты» по прямому URL и в конце возвращает её последней выбранной. Два переключения и три
    // чтения /me/context стенда под нагрузкой (3–6 с каждое, отчёт W1.20) — тройной срок.
    test.slow();
    await app('/', { persona: 'therapist' });
    await expect(page).toHaveURL(/\/t\/[0-9a-f-]{36}\/spa$/, { timeout: 15_000 });
    const alta = await tenantId(page, ALTA);
    const lotos = await tenantId(page, LOTOS);
    await page.goto(`/t/${alta}/spa`);
    await expect(header(page)).toContainText(ALTA, { timeout: 15_000 });
    const switchTo = async (name: string) => {
      const select = page.waitForResponse((r) => r.url().endsWith('/api/v1/me/selected-tenant'));
      await header(page).getByRole('button', { name: 'Сменить бизнес' }).click();
      await page.getByRole('dialog', { name: 'Бизнесы' }).getByRole('button', { name }).click();
      expect((await select).status()).toBe(200);
    };
    await switchTo(LOTOS);
    await expect(page).toHaveURL(new RegExp(`/t/${lotos}/spa$`));
    await expect(header(page)).toContainText(LOTOS);
    await desktop(page);
    await expect
      .poll(() => navTitles(mainNav(page)))
      .toEqual(['Мой день', 'Чаты', 'Календарь', 'База знаний']);
    const me = (await call(page, 'GET', '/api/v1/me/context')).body as { lastTenantId?: string };
    expect(me.lastTenantId).toBe(lotos);
    await switchTo(ALTA);
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/spa$`));
  });

  test('профиль водителя с ролью «Водитель» (self) — без «Ролей нет — доступ к модулям не выдан»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'driver' });
    await expect(page).toHaveURL(/\/today$/, { timeout: 15_000 });
    await header(page).getByRole('button', { name: 'Профиль' }).click();
    const profile = page.getByRole('dialog', { name: 'Профиль' });
    await expect(profile).toContainText('Илья Васильев');
    await expect(profile).not.toContainText('Ролей нет — доступ к модулям не выдан');
  });
});
