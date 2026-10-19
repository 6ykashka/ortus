// W2.50 · e2e выгрузки CSV на `logistics-review` «Приёмка смен» и `logistics-earnings` «Начисления водителям»
// (exportDataset, D-11 комплекта — заменитель интеграции учёта, ответ владельца 17.10; бриф W2.50 §1 п. 2, §5).
// Кнопки «Выгрузить расходы» и «Выгрузить рейсы» — только при Dataset.exportAllowed (data.export и право набора);
// файл — UTF-8 с BOM, «;», CRLF, имя сервера. В эталоне выгрузка — кнопка «Выгрузить» в «Данных» (pg.data :1845);
// на этих экранах кнопок нет (no-reference, allowlist logistics-review.md, logistics-earnings.md).
import { readFile } from 'node:fs/promises';

import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics.helpers.ts';
import { logisticsOn } from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { devScenario, tenantId } from './shell.helpers.ts';

const group = (page: Page) => page.getByRole('group', { name: 'Выгрузка CSV' });

/** Две кнопки по порядку: имя — подпись, перед ней значок download, как у «Выгрузить» в «Данных» (ревью W2.50-r2). */
async function expectExportButtons(page: Page): Promise<void> {
  const buttons = group(page).getByRole('button');
  await expect(buttons).toHaveCount(2);
  await expect(buttons.nth(0)).toHaveAccessibleName('Выгрузить расходы');
  await expect(buttons.nth(1)).toHaveAccessibleName('Выгрузить рейсы');
  for (const i of [0, 1]) {
    await expect(buttons.nth(i).locator('.material-symbols-rounded')).toHaveText('download');
  }
}

async function openPage(
  app: (route: string, o?: { persona?: 'owner' | 'manager' }) => Promise<unknown>,
  page: Page,
  segment: 'review' | 'earnings',
  persona: 'owner' | 'manager' = 'manager',
): Promise<string> {
  await app('/', { persona: 'owner' });
  const alta = await tenantId(page);
  await devScenario(page, { preset: 'logistics-ready' });
  await app(`/t/${alta}/${segment}`, { persona });
  await expect(
    h1(page, segment === 'review' ? 'Приёмка смен' : 'Начисления водителям'),
  ).toBeVisible();
  return alta;
}

/**
 * Скачанный файл: имя и содержимое (UTF-8 как есть, с BOM). Тост (живёт 4,2 с) проверяется сразу после события
 * download — до чтения файла с диска, иначе под нагрузкой он успевает исчезнуть (ревью W2.50-r1).
 */
async function download(
  page: Page,
  name: string,
  toastText?: RegExp,
): Promise<{ file: string; text: string }> {
  const wait = page.waitForEvent('download');
  await group(page).getByRole('button', { name }).click();
  const d = await wait;
  if (toastText) await expect(toast(page)).toHaveText(toastText);
  const path = await d.path();
  return { file: d.suggestedFilename(), text: await readFile(path, 'utf8') };
}

test.describe('logistics-review — выгрузка CSV @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');

  test('«Приёмка смен»: «Выгрузить расходы» и «Выгрузить рейсы»; файл расходов — BOM, «;», CRLF, тост', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'review');
    await expectExportButtons(page);
    const r = await download(
      page,
      'Выгрузить расходы',
      /^Выгружено строк: \d+ · Расходы-\d{4}-\d{2}-\d{2}\.csv$/,
    );
    expect(r.file).toMatch(/^Расходы-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(r.text.charCodeAt(0)).toBe(0xfeff);
    const [header] = r.text.slice(1).split('\r\n');
    expect(header).toContain('Дата');
    expect(header).toContain(';');
  });

  test('«Выгрузить рейсы»: файл «Поездки-….csv» с заголовком полей набора', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'review');
    const r = await download(page, 'Выгрузить рейсы');
    expect(r.file).toMatch(/^Поездки-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(r.text.slice(1).split('\r\n')[0]).toContain(';');
  });

  test('«Начисления водителям» (владелец): кнопки выгрузки есть', async ({ app, page }) => {
    await openPage(app, page, 'earnings', 'owner');
    await expectExportButtons(page);
    const r = await download(page, 'Выгрузить рейсы');
    expect(r.file).toMatch(/^Поездки-/);
  });

  test('нет связи: тост «Нет связи с сервером. Операция не выполнена.», кнопка снова доступна', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'review');
    await devScenario(page, { scenario: 'exportDataset=offline', once: true });
    const btn = group(page).getByRole('button', { name: 'Выгрузить расходы' });
    await btn.click();
    await expect(toast(page)).toHaveText('Нет связи с сервером. Операция не выполнена.');
    await expect(btn).toBeEnabled();
  });

  test('клавиатура: Tab доходит до «Выгрузить расходы», Enter — выгрузка; фокус виден', async ({
    app,
    page,
  }) => {
    await openPage(app, page, 'review');
    const btn = group(page).getByRole('button', { name: 'Выгрузить расходы' });
    await expect(btn).toBeVisible();
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await btn.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await btn.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    const wait = page.waitForEvent('download');
    await page.keyboard.press('Enter');
    expect((await wait).suggestedFilename()).toMatch(/^Расходы-/);
  });

  test('axe без serious/critical; 390 — без прокрутки вбок, цели ≥ 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await openPage(app, page, 'review');
    await expect(group(page)).toBeVisible();
    const serious = (await axe(page)).violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => v.id);
    expect(serious).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) {
      for (const name of ['Выгрузить расходы', 'Выгрузить рейсы']) {
        expect(await hitHeight(group(page).getByRole('button', { name }))).toBeGreaterThanOrEqual(
          44,
        );
      }
    }
  });
});

// Backend выгрузки (W2.50: fleet/csv поверх движка «Данных» W2.08, cmd/api) — в ветке W2.50.
test.describe('logistics-review — выгрузка CSV стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('логист на стенде: «Выгрузить расходы» — файл CSV с BOM в области логиста', async ({
    app,
    page,
    session,
    undo,
  }) => {
    test.slow();
    const s = await logisticsOn(session, undo);
    await app(`/t/${s.tenant}/review`, { persona: 'manager' });
    await expect(h1(page, 'Приёмка смен')).toBeVisible({ timeout: 15_000 });
    const r = await download(page, 'Выгрузить расходы');
    expect(r.file).toMatch(/^Расходы-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(r.text.charCodeAt(0)).toBe(0xfeff);
    expect(r.text.slice(1).split('\r\n')[0]).toContain(';');
  });
});
