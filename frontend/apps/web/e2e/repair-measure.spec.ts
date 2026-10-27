// W6.21 · e2e страницы `repair-measure` — вкладка «Замер» карточки объекта (эталон design-2026-10-19
// «Ремонт и стройка.dc.html» :74–100, логика :1645–1679; DoR docs/plan/v2/analysis/dor/repair.md §1.3, §5 п. 22,
// Q-W4.00-repair-17, -24). Данные — MSW W6.00 (пресет repairs-ready, «сегодня» 20.10.2026); backend замера — W6.12
// (режим stand — @stand-spec, test.fixme до него). Вкладка открывается хостом-заглушкой `repair.page.tsx`
// (`?obj=&tab=`), карточку объекта делает W6.20.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { OBJ, openRepair } from './repair.tabs.helpers.ts';
import { devScenario } from './shell.helpers.ts';

const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

const section = (page: Page): Locator => page.locator('section[aria-labelledby="h-meas"]');
const table = (page: Page): Locator =>
  section(page).getByRole('table', { name: 'Замер помещений' });
const field = (page: Page, label: string): Locator =>
  section(page).getByRole('textbox', { name: label, exact: true });
const rowOf = (page: Page, name: string): Locator =>
  table(page)
    .getByRole('row')
    .filter({ has: page.getByRole('cell', { name, exact: true }) });
const cell = (row: Locator, n: number): Locator => row.getByRole('cell').nth(n);
const totals = (page: Page): Locator =>
  table(page).getByRole('row').filter({ hasText: 'Итого' }).getByRole('cell');
const saved = (page: Page) =>
  page.waitForResponse(
    (r) => r.request().method() === 'PUT' && r.url().includes('/measurement') && r.status() === 200,
  );

test.describe('repair-measure — «Замер» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('открывается из меню «Объекты» и по прямому URL; заголовок и пояснение', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'home', { preset: 'repairs-ready' });
    if (phone(page)) {
      await page
        .getByRole('navigation', { name: 'Навигация', exact: true })
        .getByRole('button', { name: 'Ещё' })
        .click();
      await page
        .getByRole('dialog', { name: 'Все разделы' })
        .getByRole('button', { name: 'Объекты' })
        .click();
    } else {
      await page
        .getByRole('navigation', { name: 'Основная навигация' })
        .getByRole('button', { name: 'Объекты' })
        .click();
    }
    await expect(h1(page, 'Объекты')).toBeVisible();
    await expect(page).toHaveURL(/\/repair$/);
    await openRepair(app, page, { obj: OBJ.kv42 });
    await expect(section(page).getByRole('heading', { level: 2, name: 'Замер' })).toBeVisible();
    await expect(section(page)).toContainText(
      'Замерщик или прораб заполняет на объекте с телефона. Площади пола и стен за вычетом проёмов пересчитывают объёмы в черновике сметы; согласованная версия не меняется.',
    );
    await expect(section(page)).toContainText(
      'Фото и план помещения прикладываются к замеру через «Файлы».',
    );
  });

  test('таблица помещений кв. 42: размеры, пол и стены по помещению, итоги 46,8 и 134,2', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42 });
    await expect(table(page).getByRole('columnheader')).toHaveText([
      'Помещение',
      'Длина, м',
      'Ширина, м',
      'Высота, м',
      'Проёмы, м²',
      'Пол, м²',
      'Стены, м²',
    ]);
    await expect(table(page).getByRole('row')).toHaveCount(6);
    await expect(field(page, 'Длина: Гостиная')).toHaveValue('5,2');
    await expect(field(page, 'Проёмы: Гостиная')).toHaveValue('3,6');
    await expect(cell(rowOf(page, 'Гостиная'), 5)).toHaveText('19,8');
    await expect(cell(rowOf(page, 'Гостиная'), 6)).toHaveText('45');
    await expect(totals(page).nth(1)).toHaveText('46,8');
    await expect(totals(page).nth(2)).toHaveText('134,2');
  });

  test('правка размера пересчитывает помещение и итоги и сохраняет новую версию замера', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42 });
    const len = field(page, 'Длина: Кухня');
    await len.fill('4');
    await expect(cell(rowOf(page, 'Кухня'), 5)).toHaveText('12');
    await expect(cell(rowOf(page, 'Кухня'), 6)).toHaveText('35,8');
    await expect(totals(page).nth(1)).toHaveText('48,6');
    const put = saved(page);
    await len.press('Tab');
    await put;
    await page.reload();
    await expect(field(page, 'Длина: Кухня')).toHaveValue('4');
    await expect(totals(page).nth(1)).toHaveText('48,6');
    await expect(totals(page).nth(2)).toHaveText('137,5');
  });

  test('«Добавить помещение» добавляет «Коридор» 3,0 × 1,4 × 2,7 и сохраняет сразу', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42 });
    const put = saved(page);
    await section(page).getByRole('button', { name: 'Добавить помещение' }).click();
    await put;
    await expect(rowOf(page, 'Коридор')).toBeVisible();
    await expect(field(page, 'Длина: Коридор')).toHaveValue('3');
    await expect(field(page, 'Ширина: Коридор')).toHaveValue('1,4');
    await expect(field(page, 'Высота: Коридор')).toHaveValue('2,7');
    await expect(field(page, 'Проёмы: Коридор')).toHaveValue('3,2');
    await expect(cell(rowOf(page, 'Коридор'), 5)).toHaveText('4,2');
    await page.reload();
    await expect(rowOf(page, 'Коридор')).toBeVisible();
  });

  test('ввод и сразу «Добавить помещение» без Tab: щелчок не теряется, сохраняются обе версии', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42 });
    await field(page, 'Длина: Кухня').fill('4');
    const puts: string[] = [];
    page.on('response', (r) => {
      if (r.request().method() === 'PUT' && r.url().includes('/measurement'))
        puts.push(String(r.status()));
    });
    // click = mousedown (blur → сохранение) + mouseup + click, как у человека
    await section(page).getByRole('button', { name: 'Добавить помещение' }).click();
    await expect(rowOf(page, 'Коридор')).toBeVisible();
    await expect.poll(() => puts).toEqual(['200', '200']);
    await page.reload();
    await expect(field(page, 'Длина: Кухня')).toHaveValue('4');
    await expect(rowOf(page, 'Коридор')).toBeVisible();
  });
  test('запятая — десятичный разделитель; нечисло считается нулём и не портит замер', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42 });
    await field(page, 'Ширина: Спальня').fill('3,6');
    await expect(cell(rowOf(page, 'Спальня'), 5)).toHaveText('14,8');
    await field(page, 'Высота: Санузел').fill('abc');
    await expect(cell(rowOf(page, 'Санузел'), 6)).toHaveText('0');
    await expect(cell(rowOf(page, 'Санузел'), 5)).toHaveText('3,7');
  });

  test('«Открыть смету» ведёт на вкладку «Смета»', async ({ app, page }) => {
    await openRepair(app, page, { obj: OBJ.kv42 });
    await section(page).getByRole('button', { name: 'Открыть смету' }).click();
    await expect(page.locator('section[aria-labelledby="h-est"]')).toBeVisible();
    await expect(page).toHaveURL(/tab=estimate/);
  });

  test('прораб: правит замер, «Открыть смету» и вкладки «Смета» нет (нет права на финансы)', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42, persona: 'foreman' });
    await expect(field(page, 'Длина: Кухня')).toBeEnabled();
    await expect(section(page).getByRole('button', { name: 'Открыть смету' })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Смета' })).toHaveCount(0);
  });

  test('сданный объект — только чтение; нет права правки — поля текстом', async ({ app, page }) => {
    await openRepair(app, page, { obj: OBJ.mytishchi });
    await expect(section(page)).toContainText('Объект сдан: замер закрыт для правки.');
    await expect(section(page).getByRole('textbox')).toHaveCount(0);
    await expect(section(page).getByRole('button', { name: 'Добавить помещение' })).toHaveCount(0);
  });

  test('ошибка загрузки с «Повторить»; нет связи и конфликт версии при сохранении', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42, scenario: 'getMeasurement=rate_limited' });
    await expect(page.getByRole('alert')).toHaveText(
      'Не удалось загрузить замер: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(section(page).getByRole('heading', { level: 2, name: 'Замер' })).toBeVisible();
    await devScenario(page, { scenario: 'putMeasurement=offline' });
    await field(page, 'Длина: Кухня').fill('9');
    await field(page, 'Длина: Кухня').press('Tab');
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(field(page, 'Длина: Кухня')).toHaveValue('3,4');
    await devScenario(page, { scenario: 'putMeasurement=revision_mismatch' });
    await field(page, 'Длина: Кухня').fill('9');
    await field(page, 'Длина: Кухня').press('Tab');
    await expect(toast(page)).toBeVisible();
    await expect(field(page, 'Длина: Кухня')).toHaveValue('3,4');
  });

  test('клавиатура: Tab обходит поля таблицы и кнопки; фокус виден', async ({ app, page }) => {
    await openRepair(app, page, { obj: OBJ.kv42 });
    const target = section(page).getByRole('button', { name: 'Открыть смету' });
    await expect(target).toBeVisible();
    let reached = false;
    const seen = new Set<string>();
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      seen.add(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? ''));
      reached = await target.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(seen.has('Длина: Гостиная')).toBe(true);
    expect(seen.has('Проёмы: Санузел')).toBe(true);
    expect(await target.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  });

  test('axe без serious; 390 — без горизонтальной прокрутки, цели не меньше 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await openRepair(app, page, { obj: OBJ.kv42 });
    await expect(table(page)).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
      const wrap = section(page).locator('.ox-rp-tablewrap');
      expect(await wrap.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
      expect(
        await hitHeight(section(page).getByRole('button', { name: 'Добавить помещение' })),
      ).toBeGreaterThanOrEqual(44);
      expect(
        await hitHeight(section(page).getByRole('button', { name: 'Открыть смету' })),
      ).toBeGreaterThanOrEqual(44);
      expect(await hitHeight(field(page, 'Длина: Кухня'))).toBeGreaterThanOrEqual(44);
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    }
  });
});

// Backend замера — W6.12 (ws/W6.12 не в main на 26.10.2026): getMeasurement, putMeasurement. До него — fixme.
test.describe('repair-measure — стенд @stand-spec', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('замер на стенде: правка → новая версия, итоги пересчитаны сервером', () => {
    // Причина: backend замера и смет (W6.12) не влит в main; MSW-сценарий этого spec — в @mock выше.
    expect(true).toBe(true);
  });
});
