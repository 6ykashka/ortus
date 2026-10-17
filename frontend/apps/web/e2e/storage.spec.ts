// W1.24 · e2e страницы `storage` «Хранилище» (S1-22, no-reference B-6 №5: design-requests.md — норма, > 85 %,
// заполнено, запрос уменьшения, резерв; разбивка по группам эталона «Модули и место» :264–266 и по модулям —
// getStorageBreakdown W1.00). Пиксельной и структурной сверки нет (allowlist/storage.md), e2e и проходка — да.
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/index.ts';
import { dialog, h1, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { call, devScenario } from './shell.helpers.ts';

const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

/** Обводка фокуса активного элемента (видимый фокус клавиатуры). */
const outline = (page: Page): Promise<string> =>
  page.evaluate(() =>
    document.activeElement ? getComputedStyle(document.activeElement).outlineStyle : 'none',
  );

test.describe('storage — «Хранилище» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');

  test('переход по ссылке «Хранилище» из «Модули и место» и прямой URL', async ({ app, page }) => {
    await openPage(app, page, 'modules');
    await page.locator('.ox-mod-storage').getByRole('link', { name: 'Хранилище' }).click();
    await expect(page).toHaveURL(/\/storage$/);
    await expect(h1(page, 'Хранилище')).toBeVisible();
    await page.reload();
    await expect(h1(page, 'Хранилище')).toBeVisible();
    await expect(page.getByText('Альта Групп / Компания')).toBeVisible();
  });

  test('занято, резерв и лимит; meter; разбивка по группам эталона и по модулям', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'storage');
    const usage = page.locator('.ox-st-usage');
    await expect(usage).toContainText('46,2 ГБ');
    await expect(usage).toContainText('из 100 ГБ');
    await expect(usage).toContainText('Резерв начатых загрузок: 0 ГБ');
    const meter = page.getByRole('meter', { name: 'Занятое место' });
    await expect(meter).toHaveAttribute('aria-valuenow', '46.2');
    const groups = page.locator('.ox-st-groups .ox-st-row');
    await expect(groups).toHaveCount(4);
    await expect(groups.nth(0)).toContainText('Фото осмотров и отчётов');
    await expect(groups.nth(0)).toContainText('31,4 ГБ');
    await expect(groups.nth(0)).toContainText(/1\s840 файлов/);
    await expect(groups.nth(3)).toContainText('Прочее');
    const modules = page.locator('.ox-st-modules .ox-st-row');
    await expect(modules).toHaveCount(4);
    await expect(modules.nth(0)).toContainText('Логистика');
    await expect(modules.nth(1)).toContainText('Файлы');
  });

  test('смена лимита: расчёт с ценой, подтверждение, тост', async ({ app, page }) => {
    await openPage(app, page, 'storage');
    await page.getByLabel('Новый лимит').selectOption('250');
    await page.getByRole('button', { name: 'Рассчитать' }).click();
    const quote = page.locator('.ox-st-quote');
    await expect(quote).toContainText('250 ГБ');
    await expect(quote).toContainText(/2\s500 ₽ в месяц/);
    await quote.getByRole('button', { name: 'Применить' }).click();
    await expect(toast(page)).toHaveText('Лимит места: 250 ГБ');
    await expect(page.locator('.ox-st-usage')).toContainText('из 250 ГБ');
  });

  test('лимит меньше занятого: сервер отклоняет расчёт, текст в карточке', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'storage');
    await page.getByLabel('Новый лимит').selectOption('25');
    await page.getByRole('button', { name: 'Рассчитать' }).click();
    await expect(page.locator('.ox-st-change').getByRole('alert')).toContainText(
      'Новый лимит меньше занятого места. Освободите место или выберите лимит больше.',
    );
    await expect(dialog(page)).toHaveCount(0);
  });

  test('место заполнено: «Новые загрузки заблокированы», полоса danger', async ({ app, page }) => {
    await openPage(app, page, 'storage', { preset: 'storage-full' });
    await expect(page.locator('.ox-st-usage').getByRole('alert')).toContainText(
      'Новые загрузки заблокированы, файлы не удалены.',
    );
    await expect(page.locator('.ox-st-usage .ox-mod-bar-fill')).toHaveAttribute(
      'data-tone',
      'danger',
    );
  });

  test('сотрудник без billing.read по прямому URL: гейт «Нет права», данных места нет', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'storage', { persona: 'manager' });
    await expect(page.locator('.ox-gate')).toContainText('Нет права');
    await expect(page.locator('.ox-st-usage')).toHaveCount(0);
  });

  test('гейт сотрудника: заголовок «Нет доступа к разделу «Хранилище»»', async ({ app, page }) => {
    // Страница вне меню: имя раздела — подпись страницы в манифесте (`label`, Q-W1.24-17).
    await openPage(app, page, 'storage', { persona: 'manager' });
    await expect(page.locator('.ox-gate')).toContainText('Нет права');
    await expect(h1(page, 'Нет доступа к разделу «Хранилище»')).toBeVisible({ timeout: 5_000 });
  });

  test('загрузка: скелетон «Загрузка», затем страница', async ({ app, page }) => {
    await openPage(app, page, 'home');
    await devScenario(page, { scenario: 'getStorageUsage=delay=1500' });
    await page.goto(page.url().replace(/\/home$/, '/storage'));
    await expect(page.getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(page.getByRole('meter', { name: 'Занятое место' })).toBeVisible();
  });

  test('ошибка getStorageUsage: alert по коду, «Повторить» перечитывает место', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home');
    await devScenario(page, { scenario: 'getStorageUsage=rate_limited' });
    await page.goto(page.url().replace(/\/home$/, '/storage'));
    await expect(h1(page, 'Хранилище')).toBeVisible();
    await expect(page.locator('.ox-st').getByRole('alert')).toHaveText(
      'Не удалось загрузить данные: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await page.locator('.ox-st').getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByRole('meter', { name: 'Занятое место' })).toBeVisible();
  });

  test('ошибка getStorageBreakdown: место есть, в блоке «По видам файлов» alert и «Повторить»', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home');
    await devScenario(page, { scenario: 'getStorageBreakdown=rate_limited' });
    await page.goto(page.url().replace(/\/home$/, '/storage'));
    await expect(page.getByRole('meter', { name: 'Занятое место' })).toBeVisible();
    const groups = page.locator('.ox-st-groups');
    await expect(groups.getByRole('alert')).toContainText(
      'Слишком много запросов. Подождите и повторите.',
    );
    await expect(groups.getByRole('heading', { level: 2, name: 'По видам файлов' })).toBeVisible();
    await expect(groups.locator('.ox-st-row')).toHaveCount(0);
    await expect(groups.getByRole('button', { name: 'Повторить' })).toHaveAccessibleDescription(
      'По видам файлов',
    );
  });

  test('офлайн на «Рассчитать» и «Применить»: тост «Нет связи…», фокус остаётся на кнопке', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'storage');
    await page.getByLabel('Новый лимит').selectOption('250');
    await devScenario(page, { scenario: 'requestStorageChange=offline' });
    const calc = page.getByRole('button', { name: 'Рассчитать' });
    await calc.focus();
    await page.keyboard.press('Enter');
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(page.locator('.ox-st-quote')).toHaveCount(0);
    await expect(calc).toBeFocused();
    await devScenario(page, { scenario: null });
    await calc.click();
    const quote = page.locator('.ox-st-quote');
    await expect(quote).toContainText('250 ГБ');
    await devScenario(page, { scenario: 'requestStorageChange=offline' });
    const apply = quote.getByRole('button', { name: 'Применить' });
    await apply.focus();
    await page.keyboard.press('Enter');
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(quote).toBeVisible();
    await expect(apply).toBeFocused();
    await expect(page.locator('.ox-st-usage')).toContainText('из 100 ГБ');
  });

  test('организация ограничена (trial-ended): «Рассчитать» недоступна', async ({ app, page }) => {
    await openPage(app, page, 'storage', { preset: 'trial-ended' });
    await page.getByLabel('Новый лимит').selectOption('250');
    await expect(page.getByRole('button', { name: 'Рассчитать' })).toBeDisabled();
  });

  test('больше 85 %: полоса warn без alert (лимит 50 ГБ при 46,2 ГБ)', async ({ app, page }) => {
    const id = await openPage(app, page, 'storage');
    const path = `/api/v1/tenants/${id}/storage/changes`;
    const q = await call(page, 'POST', path, {
      body: { requestedQuotaBytes: 50 * 2 ** 30, mode: 'quote' },
    });
    expect(q.status).toBe(201);
    const c = await call(page, 'POST', path, {
      body: {
        requestedQuotaBytes: 50 * 2 ** 30,
        mode: 'commit',
        acceptedQuoteId: (q.body as { quoteId: string }).quoteId,
      },
    });
    expect(c.status).toBe(201);
    await page.reload();
    await expect(page.locator('.ox-st-usage')).toContainText('из 50 ГБ');
    await expect(page.locator('.ox-st-usage .ox-mod-bar-fill')).toHaveAttribute(
      'data-tone',
      'warn',
    );
    await expect(page.locator('.ox-st-usage').getByRole('alert')).toHaveCount(0);
  });

  test('клавиатура: Tab и Enter — расчёт, фокус на расчёте, «Применить», фокус на «Новый лимит»', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'storage');
    const select = page.getByLabel('Новый лимит');
    await select.selectOption('250');
    await select.focus();
    await page.keyboard.press('Tab');
    const calc = page.getByRole('button', { name: 'Рассчитать' });
    await expect(calc).toBeFocused();
    expect(await outline(page)).not.toBe('none');
    await page.keyboard.press('Enter');
    const quote = page.locator('.ox-st-quote');
    await expect(quote).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(quote.getByRole('button', { name: 'Применить' })).toBeFocused();
    expect(await outline(page)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(toast(page)).toHaveText('Лимит места: 250 ГБ');
    await expect(select).toBeFocused();
  });

  test('390: нижняя навигация и цели не меньше 44 px', async ({ app, page }) => {
    test.skip((page.viewportSize()?.width ?? 0) >= 640, 'только телефон');
    await openPage(app, page, 'storage');
    await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
    await page.getByLabel('Новый лимит').selectOption('250');
    await page.getByRole('button', { name: 'Рассчитать' }).click();
    await expect(page.locator('.ox-st-quote')).toBeVisible();
    const targets = [
      page.getByLabel('Новый лимит'),
      page.getByRole('button', { name: 'Рассчитать' }),
      page.getByRole('button', { name: 'Применить' }),
      page.getByRole('button', { name: 'Отмена' }),
    ];
    for (const t of targets) {
      const box = await t.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('axe и раскладка: нет serious/critical, нет горизонтальной прокрутки', async ({
    app,
    page,
    axe,
  }) => {
    await openPage(app, page, 'storage');
    await expect(page.getByRole('meter', { name: 'Занятое место' })).toBeVisible();
    const r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

test.describe('storage — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец на стенде: место W1.09 (квота 100 ГБ), разбивка из четырёх групп', async ({
    app,
    page,
  }) => {
    test.slow();
    await openPage(app, page, 'storage');
    await expect(h1(page, 'Хранилище')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.ox-st-usage')).toContainText('из 100 ГБ');
    await expect(page.locator('.ox-st-groups .ox-st-row')).toHaveCount(4);
  });
});
