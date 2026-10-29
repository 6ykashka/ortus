// W6.22 · e2e вкладки «Снабжение» карточки объекта (`repair-supply-tab`, эталон `data-screen-label="Снабжение"`
// :532–545) и формы заявки прораба (`repair-supply-request`, no-reference, Q-W4.00-repair-6). Вкладку встраивает
// карточка объекта W6.20 (`TAB_PANELS.supply`). Режим mock — пресет repairs-ready (сегодня 20.10.2026).
// Режим stand: backend снабжения (W6.13) не в main — строки @stand остаются test.fixme.
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { noHorizontalScroll } from './modules.helpers.ts';
import { expectStatus } from './_stand/stand.ts';
import { repairObject } from './repair.stand.ts';
import { call, tenantId } from './shell.helpers.ts';
import { openRepair } from './repair.helpers.ts';

const OBJ = 'ЖК Северный парк · квартира 117';

async function projectId(page: Page, tenant: string, name: string): Promise<string> {
  const r = await call(page, 'GET', `/api/v1/tenants/${tenant}/repairs/projects?limit=100`);
  const items = (r.body as { items: { id: string; name: string }[] }).items;
  const p = items.find((x) => x.name === name);
  if (!p) throw new Error(`нет объекта «${name}»`);
  return p.id;
}

type AppFn = Parameters<Parameters<typeof test>[2]>[0]['app'];

async function openSupplyTab(app: AppFn, page: Page, persona: 'owner' | 'foreman'): Promise<void> {
  const tenant = await openRepair(app, page, { persona });
  const id = await projectId(page, tenant, OBJ);
  await app(`/t/${tenant}/repair?obj=${id}&tab=supply`, { persona });
  await expect(page.getByRole('heading', { level: 2, name: 'Снабжение' })).toBeVisible({
    timeout: 30_000,
  });
}

test.describe('repair-supply-tab — вкладка «Снабжение» объекта @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('заявки объекта: номера, материалы, статусы и действия', async ({ app, page }) => {
    await openSupplyTab(app, page, 'owner');
    await expect(page.getByText('З-21', { exact: true })).toBeVisible();
    await expect(page.getByText(/Плинтус МДФ · 42 м/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Решить в снабжении' }).first()).toBeVisible();
    await expect(page.getByText('Новая заявка на материал')).toHaveCount(0);
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('прораб: «Новая заявка на материал»', async ({ app, page }) => {
    await openSupplyTab(app, page, 'foreman');
    await expect(page.getByText('Новая заявка на материал').first()).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('шапка вкладки стоит слева колонкой, как в эталоне :532–545 (чужой CSS не перекрывает)', async ({
    app,
    page,
  }) => {
    await openSupplyTab(app, page, 'owner');
    const title = page.getByRole('heading', { level: 2, name: 'Снабжение' });
    const panel = page.locator('section[aria-labelledby="h-sup"]');
    const intro = panel.locator('p').first();
    const [t, p, s] = await Promise.all([
      title.boundingBox(),
      intro.boundingBox(),
      panel.boundingBox(),
    ]);
    if (!t || !p || !s) throw new Error('нет геометрии шапки');
    expect(t.x - s.x).toBeLessThan(8);
    expect(p.x - s.x).toBeLessThan(8);
    expect(p.y).toBeGreaterThan(t.y + t.height - 2);
    expect(p.width).toBeGreaterThan(s.width * 0.6);
  });

  test('axe без serious и critical', async ({ app, page, axe }) => {
    await openSupplyTab(app, page, 'foreman');
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
  });
});

// Стенд: backend снабжения (W6.13) в main. Объект, прораб и заявка — командами API; вкладка читает настоящий backend.
test.describe('repair-supply-tab — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(180_000);

  test('владелец на стенде: вкладка «Снабжение» объекта показывает заявку и действие «Решить в снабжении»', async ({
    app,
    page,
  }, testInfo) => {
    await app('/', { persona: 'owner' });
    const tenant = await tenantId(page);
    const obj = await repairObject(page, tenant, testInfo.project.name);
    const items = expectStatus(
      await call(
        page,
        'GET',
        `/api/v1/tenants/${tenant}/repairs/price-items?kind=material&limit=50`,
      ),
      200,
      'listPriceItems',
    ).body as { items: { id: string; name: string }[] };
    const material = items.items[0];
    if (!material) throw new Error('в справочнике нет материалов');
    expectStatus(
      await call(
        page,
        'POST',
        `/api/v1/tenants/${tenant}/repairs/projects/${obj.id}/supply-requests`,
        {
          body: { priceItemId: material.id, quantity: '3', needBy: '2027-01-15' },
        },
      ),
      201,
      'createSupplyRequest',
    );
    await app(`/t/${tenant}/repair?obj=${obj.id}&tab=supply`, { persona: 'owner' });
    await expect(page.getByRole('heading', { level: 2, name: 'Снабжение' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(material.name).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Решить в снабжении' })).toBeVisible();
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});
