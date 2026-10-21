// W4.50 · e2e «Данных» `core-data`: сохранённые виды на сервере и выгрузка заданием с журналом (контракт
// 0.7.0-stage4 W4.06; эталон design-2026-10-19 «Ортус CRM.dc.html» pg.data :1837–1856, dataVM :4189–4222 — onSaveView,
// onExport; журнал «Выгрузки» — no-reference, allowlist core-data.md). Mock — сценарный сервер W4.06 (views.ts,
// exports.ts: «воркер» mock готовит задание к первому чтению); стенд — backend W4.50 и cmd/worker слота (MinIO).
import { readFile } from 'node:fs/promises';

import type { Locator, Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { logisticsOn } from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll, openPage, toast } from './modules.helpers.ts';
import { call, devScenario } from './shell.helpers.ts';

const H1 = 'Данные';
const SAVED = 'Вид сохранён · личный';
const QUEUED = /^Выгрузка «Поездки»: \d+ строк, фильтр и права зафиксированы\.$/;

const filter = (page: Page) => page.getByLabel('Фильтр');
const viewSelect = (page: Page) => page.getByLabel('Вид');
const bodyRows = (page: Page) => page.locator('section[aria-labelledby="h-data"] table tbody tr');
const journal = (page: Page) => page.getByRole('region', { name: 'Выгрузки' });
const jobs = (page: Page) => journal(page).getByRole('listitem');

async function open(
  app: Parameters<typeof openPage>[0],
  page: Page,
  persona: 'owner' | 'manager' = 'owner',
): Promise<string> {
  const id = await openPage(app, page, 'data', { persona, preset: 'logistics-ready' });
  await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
  await expect(bodyRows(page).first()).toBeVisible({ timeout: 15_000 });
  return id;
}

/** «Скачать» задания: событие download, имя файла и текст как есть (UTF-8 с BOM). */
async function download(page: Page, item: Locator): Promise<{ file: string; text: string }> {
  const wait = page.waitForEvent('download');
  await item.getByRole('button', { name: 'Скачать' }).click();
  const d = await wait;
  return { file: d.suggestedFilename(), text: await readFile(await d.path(), 'utf8') };
}

test.describe('core-data — виды и выгрузки @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');
  test.setTimeout(90_000);
  // Хранилище mock (файл выгрузки по подписанной ссылке) под Playwright выключено по умолчанию — включается, как у
  // проверяющего через MCP: sessionStorage `ortus:msw:storage` (W2.53).
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('ortus:msw:storage', 'on'));
  });

  test('«Сохранить вид» — вид на сервере: тост, выбран, после перезагрузки в списке «Вид»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await filter(page).fill('211');
    await expect(bodyRows(page)).toHaveCount(1);
    await page.getByRole('button', { name: 'Сохранить вид' }).click();
    await expect(toast(page)).toHaveText(SAVED);
    await expect(viewSelect(page).locator('option:checked')).toHaveText('Поездки: «211»');
    await page.reload();
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await expect(viewSelect(page).locator('option')).toHaveText([
      'Без сохранённого вида',
      'Поездки: «211»',
    ]);
    await viewSelect(page).selectOption({ label: 'Поездки: «211»' });
    await expect(filter(page)).toHaveValue('211');
    await expect(bodyRows(page)).toHaveCount(1);
  });

  test('тот же фильтр ещё раз — тот же вид обновляется (updateDatasetView), дубля нет', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const saves: string[] = [];
    for (const method of ['POST', 'PATCH']) {
      await filter(page).fill('208');
      // Ответ команды вида — до следующего шага (тост первого сохранения ещё виден при втором).
      const reply = page.waitForResponse(
        (r) => /\/datasets\/fleet\.trips\/views/.test(r.url()) && r.request().method() === method,
      );
      await page.getByRole('button', { name: 'Сохранить вид' }).click();
      saves.push(`${method} ${(await reply).status()}`);
      await expect(toast(page)).toHaveText(SAVED);
      await expect(viewSelect(page).locator('option:checked')).toHaveText('Поездки: «208»');
    }
    expect(saves).toEqual(['POST 201', 'PATCH 200']);
    await expect(viewSelect(page).locator('option', { hasText: 'Поездки: «208»' })).toHaveCount(1);
  });

  test('«Выгрузить» — тост эталона, журнал «Выгрузки»: задание готово, «Скачать» — CSV с BOM', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await expect(journal(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Выгрузить' }).click();
    await expect(toast(page)).toHaveText(QUEUED);
    await expect(jobs(page).first()).toContainText('Готова', { timeout: 15_000 });
    await expect(jobs(page).first()).toContainText('Поездки');
    await expect(jobs(page).first()).toContainText('2 строки ·');
    const r = await download(page, jobs(page).first());
    expect(r.file).toMatch(/^Поездки-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(r.text.charCodeAt(0)).toBe(0xfeff);
    expect(r.text.slice(1).split('\r\n')[0]).toContain('Рейс;');
  });

  test('«Отозвать» готовую выгрузку — «Отозвана», «Скачать» нет', async ({ app, page }) => {
    await open(app, page);
    await page.getByRole('button', { name: 'Выгрузить' }).click();
    const item = jobs(page).first();
    await expect(item).toContainText('Готова', { timeout: 15_000 });
    await item.getByRole('button', { name: 'Отозвать' }).click();
    await expect(item).toContainText('Отозвана');
    await expect(item).toContainText('Отозвана автором');
    await expect(item.getByRole('button', { name: 'Скачать' })).toHaveCount(0);
  });

  test('четвёртая выгрузка подряд — тост «Дождитесь завершения начатых выгрузок.»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await devScenario(page, { scenario: 'createDatasetExportJob=rate_limited', once: true });
    await page.getByRole('button', { name: 'Выгрузить' }).click();
    await expect(toast(page)).toHaveText('Дождитесь завершения начатых выгрузок.');
    await expect(journal(page)).toHaveCount(0);
  });

  // Возврат 1 (ревью W4.50): 409 «Скачать» — текст контракта, строка журнала перечитана.
  test('права логиста сузились — «Скачать»: тост «Права изменились…», строка «Отозвана · Права изменились»', async ({
    app,
    page,
  }) => {
    const alta = await open(app, page, 'manager');
    await page.getByRole('button', { name: 'Выгрузить' }).click();
    await expect(jobs(page).first()).toContainText('Готова', { timeout: 15_000 });
    // Владелец снимает fleet.earnings.read с роли «Менеджер логистики» (как правка роли в «Пользователи и роли»).
    await app(`/t/${alta}/data`, { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    const roles = (await call(page, 'GET', `/api/v1/tenants/${alta}/roles?limit=200`)).body as {
      items: { id: string; name: string; permissions: string[] }[];
    };
    const role = roles.items.find((r) => r.name === 'Менеджер логистики');
    if (!role) throw new Error('нет роли «Менеджер логистики»');
    const cur = await call(page, 'GET', `/api/v1/tenants/${alta}/roles/${role.id}`);
    const r = await call(page, 'PATCH', `/api/v1/tenants/${alta}/roles/${role.id}`, {
      body: { permissions: role.permissions.filter((k) => k !== 'fleet.earnings.read') },
      ifMatch: cur.headers.etag ?? '',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    await app(`/t/${alta}/data`, { persona: 'manager' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    const item = jobs(page).first();
    await expect(item).toContainText('Готова', { timeout: 15_000 });
    await item.getByRole('button', { name: 'Скачать' }).click();
    await expect(toast(page)).toHaveText(
      'Права изменились — выгрузка отозвана. Запустите её снова.',
    );
    await expect(item).toContainText('Отозвана');
    await expect(item).toContainText('Права изменились');
    await expect(item.getByRole('button', { name: 'Скачать' })).toHaveCount(0);
    await expect(item.getByRole('button', { name: 'Отозвать' })).toHaveCount(0);
  });

  test('клавиатура и axe журнала; 390 — цели ≥ 44 px, без прокрутки вбок', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    await page.getByRole('button', { name: 'Выгрузить' }).focus();
    await page.keyboard.press('Enter');
    const item = jobs(page).first();
    await expect(item).toContainText('Готова', { timeout: 15_000 });
    const get = item.getByRole('button', { name: 'Скачать' });
    await get.focus();
    await expect(get).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(item.getByRole('button', { name: 'Отозвать' })).toBeFocused();
    await page.waitForLoadState('networkidle');
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(
      serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
    ).toEqual([]);
    if (!phone(page)) return;
    // Тост «Выгрузка …» над нижней навигацией закрывает журнал, пока живёт (4,2 с).
    await expect(toast(page)).toBeHidden({ timeout: 10_000 });
    expect(await hitHeight(get)).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(item.getByRole('button', { name: 'Отозвать' }))).toBeGreaterThanOrEqual(
      44,
    );
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

// W4.50: backend видов и заданий и воркер выгрузок — в этой ветке (data/views.go, data/jobs.go, cmd/worker/exports.go).
test.describe('core-data — виды и выгрузки стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец на стенде: вид сохраняется на сервере и виден после перезагрузки', async ({
    app,
    page,
    session,
    undo,
  }) => {
    test.slow();
    const s = await logisticsOn(session, undo);
    await app(`/t/${s.tenant}/data?set=fleet.vehicles`, { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    const q = `ГАЗель ${Date.now() % 100000}`;
    await filter(page).fill(q);
    await page.getByRole('button', { name: 'Сохранить вид' }).click();
    await expect(toast(page)).toHaveText(SAVED);
    const name = `Автомобили: «${q}»`;
    await expect(viewSelect(page).locator('option:checked')).toHaveText(name);
    const views = await call(
      page,
      'GET',
      `/api/v1/tenants/${s.tenant}/datasets/fleet.vehicles/views`,
    );
    const mine = (
      views.body as { items: { id: string; name: string; revision: number }[] }
    ).items.find((v) => v.name === name);
    expect(mine).toBeTruthy();
    undo(`вид «${name}»`, async () => {
      await call(
        page,
        'DELETE',
        `/api/v1/tenants/${s.tenant}/datasets/fleet.vehicles/views/${mine?.id}`,
        {
          ifMatch: `"${mine?.revision}"`,
        },
      );
    });
    await page.reload();
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await viewSelect(page).selectOption({ label: name });
    await expect(filter(page)).toHaveValue(q);
  });

  test('владелец на стенде: выгрузка заданием — воркер готовит файл, «Скачать» — CSV с BOM', async ({
    app,
    page,
    session,
    undo,
  }) => {
    test.slow();
    const s = await logisticsOn(session, undo);
    await app(`/t/${s.tenant}/data?set=fleet.vehicles`, { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await expect(bodyRows(page).first()).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Выгрузить' }).click();
    await expect(toast(page)).toHaveText(
      /^Выгрузка «Автомобили»: \d+ строк, фильтр и права зафиксированы\.$/,
    );
    const item = jobs(page).first();
    await expect(item).toContainText('Готова', { timeout: 30_000 });
    const r = await download(page, item);
    expect(r.file).toMatch(/^Автомобили-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(r.text.charCodeAt(0)).toBe(0xfeff);
    expect(r.text.slice(1).split('\r\n')[0]).toContain('Машина;Номер');
    await item.getByRole('button', { name: 'Отозвать' }).click();
    await expect(item).toContainText('Отозвана');
  });
});
