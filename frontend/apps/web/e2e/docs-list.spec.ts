// W7.25 · e2e страницы `docs-list` «Документы» — список, «Новый документ», «Новая папка», архив (`docs-folders`,
// no-reference B-6). Эталон design-2026-10-19 «Документы.dc.html» :30–108, :717–739 (documents.md §1.2, §1.9).
// Режим mock — MSW Docs W7.00 на сиде «Альты» (семь документов: договор объекта на маршруте, приказ, топливная таблица,
// скан накладной, регламент, договор аренды, финансовая таблица). Пункты verification-protocol §1.3: меню и URL,
// состояния, клавиатура, axe, 390 / 1440. Режим stand — после W7.23a.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { dialog, h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';

/** Хост билета загрузки сценарного сервера (adapter/src/msw/files): хранилище mock содержимое не проверяет. */
const STORAGE = 'https://storage.example.invalid/**';

const section = (page: Page): Locator => page.locator('section[aria-labelledby="h-docs"]');
const rows = (page: Page): Locator => section(page).locator('button.ox-docs-row');
const row = (page: Page, title: string): Locator => rows(page).filter({ hasText: title });
const chip = (page: Page, name: string | RegExp): Locator =>
  section(page).getByRole('button', { name, exact: typeof name === 'string' ? false : undefined });

async function open(
  app: Parameters<typeof openPage>[0],
  page: Page,
  o: { persona?: 'owner' | 'manager' | 'driver' | 'foreman'; search?: string } = {},
): Promise<string> {
  const id = await openPage(app, page, `docs${o.search ?? ''}`, { persona: o.persona ?? 'owner' });
  await expect(h1(page, 'Документы')).toBeVisible({ timeout: 15_000 });
  return id;
}

test.describe('docs-list — «Документы», список @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и сид — сценарный сервер mock');
  test.setTimeout(90_000);

  test.beforeEach(async ({ page }) => {
    await page.context().route(STORAGE, (r) => r.fulfill({ status: 200 }));
  });

  test('владелец: плитки создания, отборы с числами, семь документов, колонки — 1440 / карточки — 390', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await expect(rows(page)).toHaveCount(7);
    await expect(
      section(page).getByText('Текст, таблицы и PDF, к которым у вас есть доступ'),
    ).toBeVisible();
    const tiles = section(page)
      .getByRole('group', { name: 'Создать документ' })
      .getByRole('button');
    await expect(tiles).toHaveText([
      /Текст.*Пустой документ/,
      /Таблица.*Пустая или из CSV/,
      /PDF.*Из файлов и фото/,
      /Из шаблона.*Приказ, доверенность, акт/,
      /Скан.*Камера телефона и распознавание/,
    ]);
    const filters = section(page).getByRole('group', { name: 'Отбор' }).getByRole('button');
    await expect(filters).toHaveText([
      'Все · 7',
      'Мои · 1',
      'Поделились со мной · 6',
      'На маршруте · 1',
      'Архив',
    ]);
    await expect(filters.first()).toHaveAttribute('aria-pressed', 'true');
    const c = row(page, 'Договор подряда № 42/26');
    await expect(c).toContainText('Согласование');
    await expect(c).toContainText('ЖК Речной · квартира 42');
    await expect(c).toContainText('Уровень: «Управляет доступом»');
    await expect(row(page, 'Начисления · октябрь')).toBeVisible();
    if (phone(page)) {
      await expect(section(page).getByText('Название и папка', { exact: true })).toHaveCount(0);
    } else {
      await expect(section(page).getByText('Название и папка', { exact: true })).toBeVisible();
      await expect(section(page).getByText('Изменён', { exact: true })).toBeVisible();
    }
    await expect(
      section(page).getByText(/Документ — запись Ортуса: владелец, папка или связь с объектом/),
    ).toBeVisible();
  });

  test('финансовый документ отмечен значком, статусы по сиду', async ({ app, page }) => {
    await open(app, page);
    await expect(row(page, 'Начисления · октябрь').getByTitle('Финансовый документ')).toBeVisible();
    await expect(row(page, 'Приказ № 14 · работа 4 ноября')).toContainText('Согласован');
    await expect(row(page, 'Накладная ТН-5581')).toContainText('Проверить 2 слова');
    await expect(row(page, 'Расход топлива · октябрь 2026')).toContainText('Черновик');
  });

  test('логист: «Ждут меня · 1» — проверка распознавания, «Проверить» открывает карточку', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'manager' });
    const waits = section(page).getByRole('region', { name: /Ждут меня · 1/ });
    await expect(waits).toBeVisible();
    await expect(waits).toContainText('то же — в «Требует решения» на «Главной»');
    await expect(waits).toContainText('Проверить распознавание');
    await expect(waits).toContainText('Накладная ТН-5581');
    await expect(waits).toContainText('2 слова под вопросом');
    await expect(row(page, 'Накладная ТН-5581').getByTitle('Ждёт вашего решения')).toBeAttached();
    await waits.getByRole('button', { name: /Проверить/ }).click();
    await expect(page).toHaveURL(/[?&]doc=/);
    await expect(h1(page, 'Накладная ТН-5581')).toBeVisible({ timeout: 15_000 });
  });

  test('прораб: «Ждут меня» — согласование договора своего объекта', async ({ app, page }) => {
    await open(app, page, { persona: 'foreman' });
    const waits = section(page).getByRole('region', { name: /Ждут меня · 1/ });
    await expect(waits).toContainText('Согласовать');
    await expect(waits).toContainText('Договор подряда № 42/26');
    await expect(waits).toContainText(/Шаг «Согласовать» · до 02\.10/);
  });

  test('поиск по названию и по тексту скана, пустой результат, отбор и папка в адресе', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const search = section(page).getByRole('searchbox', { name: 'Поиск по документам' });
    expect(await search.evaluate((el: HTMLInputElement) => el.scrollWidth <= el.clientWidth)).toBe(
      true,
    );
    await search.fill('накладная');
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, 'Накладная ТН-5581')).toBeVisible();
    await search.fill('ТН-5581');
    await expect(rows(page)).toHaveCount(1);
    await search.fill('ГАЗелъ');
    await expect(rows(page)).toHaveCount(1);
    await search.fill('такого нет');
    await expect(section(page).getByText('Под условия отбора ничего не попало.')).toBeVisible();
    await search.fill('');
    await expect(rows(page)).toHaveCount(7);
    await chip(page, /^На маршруте/).click();
    await expect(page).toHaveURL(/[?&]filter=route/);
    await expect(rows(page)).toHaveCount(1);
    await expect(chip(page, /^На маршруте/)).toHaveAttribute('aria-pressed', 'true');
    await chip(page, /^Мои/).click();
    await expect(page).toHaveURL(/[?&]filter=mine/);
    await chip(page, /^Все/).click();
    await expect(page).not.toHaveURL(/filter=/);
    await section(page)
      .getByRole('combobox', { name: 'Папка' })
      .selectOption({ label: 'Север Логистик › Договоры' });
    await expect(page).toHaveURL(/[?&]folder=/);
    await expect(rows(page)).toHaveCount(2);
    await page.reload();
    await expect(rows(page)).toHaveCount(2, { timeout: 15_000 });
  });

  test('«Новый документ»: ошибки полей, затем создание текста — переход в карточку', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await section(page)
      .getByRole('button', { name: /^Текст/ })
      .click();
    const d = dialog(page);
    await expect(d.getByRole('heading', { name: 'Новый документ' })).toBeVisible();
    await expect(d.getByRole('button', { name: 'Закрыть' })).toBeVisible();
    await d.getByRole('button', { name: 'Создать' }).click();
    await expect(d).toContainText('Название — не короче 2 символов');
    await d.getByLabel('Название').fill('Приказ № 15');
    await d.getByLabel('Папка').selectOption({ label: 'Север Логистик › Приказы' });
    await d.getByRole('button', { name: 'Создать' }).click();
    await expect(toast(page)).toHaveText('Документ «Приказ № 15» создан');
    await expect(page).toHaveURL(/[?&]doc=/);
    await expect(h1(page, 'Приказ № 15')).toBeVisible({ timeout: 15_000 });
  });

  test('«Новый документ» — таблица из CSV и скан без файла', async ({ app, page }) => {
    await open(app, page);
    await section(page)
      .getByRole('button', { name: /^Таблица/ })
      .click();
    const d = dialog(page);
    await d.getByLabel('Название').fill('Смета октябрь');
    await d.getByLabel('Папка').selectOption({ label: 'Север Логистик' });
    await d.getByLabel('Импорт из CSV, необязательно').setInputFiles({
      name: 'smeta.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from('a;b\n1;2\n'),
    });
    await expect(d).toContainText('smeta.csv');
    await d.getByRole('button', { name: 'Создать' }).click();
    await expect(h1(page, 'Смета октябрь')).toBeVisible({ timeout: 15_000 });
    await page.goBack();
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
    await section(page).getByRole('button', { name: /^Скан/ }).click();
    await dialog(page).getByLabel('Название').fill('Акт сверки');
    await dialog(page).getByLabel('Папка').selectOption({ label: 'Север Логистик' });
    await dialog(page).getByRole('button', { name: 'Создать' }).click();
    await expect(dialog(page)).toContainText('Добавьте файлы или фото');
  });

  test('«Новый документ» из шаблона: нужен объект, затем создание с полями', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await section(page)
      .getByRole('button', { name: /^Из шаблона/ })
      .click();
    const d = dialog(page);
    await d.getByLabel('Шаблон', { exact: true }).selectOption({ label: 'Договор подряда' });
    await expect(d).toContainText('Поля из объекта: заказчик, адрес, площадь, цена по смете');
    await d.getByRole('button', { name: 'Создать' }).click();
    await expect(d).toContainText('Выберите рейс / объект для полей шаблона');
  });

  test('«Новый документ»: PDF из файла загружается и создаётся', async ({ app, page }) => {
    await open(app, page);
    await section(page).getByRole('button', { name: /^PDF/ }).click();
    const d = dialog(page);
    await d.getByLabel('Название').fill('Накладная ТН-9000');
    await d.getByLabel('Папка').selectOption({ label: 'Север Логистик › Договоры' });
    await d.getByRole('button', { name: 'Создать' }).click();
    await expect(d).toContainText('Добавьте файлы или фото');
    await d.getByLabel('Выбрать файлы PDF или фото').setInputFiles({
      name: 'tn.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 test'),
    });
    await d.getByRole('button', { name: 'Создать' }).click();
    await expect(h1(page, 'Накладная ТН-9000')).toBeVisible({ timeout: 20_000 });
  });

  test('«Новая папка»: ошибка длины, затем папка появляется в выборе', async ({ app, page }) => {
    await open(app, page);
    await section(page).getByRole('button', { name: 'Новая папка' }).click();
    const d = dialog(page);
    await d.getByRole('button', { name: 'Создать папку' }).click();
    await expect(d).toContainText('Название — не короче 2 символов');
    await d.getByLabel('Название').fill('я'.repeat(201));
    await d.getByRole('button', { name: 'Создать папку' }).click();
    await expect(d).toContainText('Название — не длиннее 200 символов');
    await d.getByLabel('Название').fill('Акты 2026');
    await d.getByLabel('Внутри папки').selectOption({ label: 'Север Логистик' });
    await d.getByRole('button', { name: 'Создать папку' }).click();
    await expect(toast(page)).toHaveText('Папка «Акты 2026» создана');
    await expect(dialog(page)).toHaveCount(0);
    await expect(
      section(page)
        .getByRole('combobox', { name: 'Папка' })
        .locator('option', { hasText: 'Север Логистик › Акты 2026' }),
    ).toHaveCount(1);
  });

  test('архив: в архив из карточки, отбор «Архив», возврат', async ({ app, page }) => {
    await open(app, page);
    await row(page, 'Регламент приёмки смены').click();
    await expect(h1(page, 'Регламент приёмки смены')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Действия с документом' }).click();
    await page.getByRole('menuitem', { name: 'В архив' }).click();
    await expect(toast(page)).toHaveText('Документ в архиве');
    await page.getByRole('button', { name: 'К списку документов' }).click();
    await expect(rows(page)).toHaveCount(6, { timeout: 15_000 });
    await chip(page, 'Архив').click();
    await expect(rows(page)).toHaveCount(1);
    await expect(row(page, 'Регламент приёмки смены')).toContainText('В архиве');
  });

  test('водитель: видит только адресованное, финансовых документов и плиток создания нет', async ({
    app,
    page,
  }) => {
    await open(app, page, { persona: 'driver' });
    await expect(row(page, 'Приказ № 14 · работа 4 ноября')).toBeVisible();
    await expect(row(page, 'Начисления · октябрь')).toHaveCount(0);
    await expect(section(page).getByRole('group', { name: 'Создать документ' })).toHaveCount(0);
    await expect(section(page).getByRole('button', { name: 'Новая папка' })).toHaveCount(0);
  });

  test('ошибка загрузки — «Повторить»; загрузка — скелетон', async ({ app, page }) => {
    await openPage(app, page, 'home');
    const tenant = page.url().match(/\/t\/([^/]+)\//)?.[1] ?? '';
    await devScenario(page, { scenario: 'listDocuments=rate_limited' });
    await app(`/t/${tenant}/docs`, { persona: 'owner' });
    await expect(section(page).getByRole('alert').first()).toContainText('Слишком много запросов');
    await devScenario(page, { scenario: 'listDocuments=delay=1500' });
    await section(page).getByRole('button', { name: 'Повторить' }).first().click();
    await expect(
      page.getByRole('main').getByRole('status', { name: 'Загрузка' }).first(),
    ).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(rows(page).first()).toBeVisible({ timeout: 15_000 });
  });

  test('клавиатура: Tab доходит до строки, Enter открывает документ', async ({ app, page }) => {
    await open(app, page);
    const target = row(page, 'Договор подряда № 42/26');
    await expect(target).toBeVisible();
    let reached = false;
    for (let i = 0; i < 80 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/[?&]doc=/);
    await expect(h1(page, 'Договор подряда № 42/26')).toBeVisible({ timeout: 15_000 });
  });

  test('1440 — боковая панель, 390 — нижняя навигация; axe без serious; цели не меньше 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    await expect(rows(page)).toHaveCount(7);
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const bad = async (): Promise<string[]> =>
      (await axe(page)).violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
    expect(await bad()).toEqual([]);
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
      for (const name of [/^Текст/, /^Таблица/]) {
        expect(await hitHeight(section(page).getByRole('button', { name }))).toBeGreaterThanOrEqual(
          44,
        );
      }
      expect(await hitHeight(chip(page, /^Мои/))).toBeGreaterThanOrEqual(44);
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    await section(page)
      .getByRole('button', { name: /^Текст/ })
      .click();
    await expect(dialog(page)).toBeVisible();
    expect(await bad()).toEqual([]);
  });
});

test.describe('docs-list — «Документы», список @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('@stand-spec список на настоящем backend (причина: backend документов — W7.23a, ещё не в main)', () => {});
});
