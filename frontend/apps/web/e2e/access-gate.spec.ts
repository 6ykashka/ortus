// W1.20 · e2e страницы `access-gate`: AccessGate оболочки (эталон design-stage-1, «Ортус CRM.dc.html» :195–203,
// gateVM :3053–3081; docs/plan/analysis/01-shell.md §12). Кнопки «Демо: …» не переносятся (PD-54).
import type { Page } from '@playwright/test';

import { expect, test } from './fixtures/index.ts';
import { setModule, tenantId } from './shell.helpers.ts';

const gate = (page: Page) => page.locator('.ox-gate');
const h1 = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });

/** Владелец подключает (и при `off` отключает с историей) «Логистику»; затем вход персонажа. */
async function fleetAs(
  app: (route: string, o?: { persona?: 'owner' | 'manager' | 'driver' }) => Promise<unknown>,
  page: Page,
  persona: 'manager' | 'driver',
  route: string,
  off = false,
): Promise<string> {
  await app('/', { persona: 'owner' });
  const alta = await tenantId(page);
  await setModule(page, alta, 'fleet', true);
  if (off) await setModule(page, alta, 'fleet', false);
  await app(`/t/${alta}/${route}`, { persona });
  return alta;
}

test.describe('access-gate — AccessGate @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'состояния модулей — сценарный сервер mock');

  test('водитель: «Логистика» не подключена организацией, без демо-кнопки', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'driver' });
    await expect(page).toHaveURL(/\/today$/);
    await expect(h1(page, '«Логистика» не подключена организацией')).toBeVisible();
    await expect(gate(page)).toContainText('Модуль не подключён');
    await expect(gate(page)).toContainText(
      'Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — понадобится ещё роль с областью.',
    );
    await expect(gate(page).getByRole('button')).toHaveCount(0);
    await expect(page.getByText('Демо: открыть как владелец')).toHaveCount(0);
  });

  test('прораб: «Ремонт и стройка» не подключён организацией (ветка A)', async ({ app, page }) => {
    await app('/', { persona: 'foreman' });
    await expect(page).toHaveURL(/\/repair$/);
    await expect(h1(page, '«Ремонт и стройка» не подключён организацией')).toBeVisible();
    await expect(gate(page)).toContainText(
      'Подключить модуль может владелец бизнеса. Само подключение доступа не выдаёт — нужна ещё роль.',
    );
  });

  test('владелец по прямому URL: «Открыть «Модули и место»» ведёт в «Модули и место»', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await app(`/t/${alta}/repair`, { persona: 'owner' });
    await expect(h1(page, '«Ремонт и стройка» не подключён организацией')).toBeVisible();
    await expect(gate(page)).toContainText(
      'Подключите модуль в разделе «Модули и место». Права сотрудникам выдаются отдельно.',
    );
    const open = gate(page).getByRole('button', { name: 'Открыть «Модули и место»' });
    const box = await open.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await open.click();
    await expect(page).toHaveURL(new RegExp(`/t/${alta}/modules$`));
    await expect(h1(page, 'Модули и место')).toBeVisible();
  });

  test('логист без роли: «Нет роли с доступом к модулю «Логистика»»', async ({ app, page }) => {
    await fleetAs(app, page, 'manager', 'fleet');
    await expect(h1(page, 'Нет роли с доступом к модулю «Логистика»')).toBeVisible();
    await expect(gate(page)).toContainText('Нет права');
    await expect(gate(page)).toContainText(
      'Модуль подключён, но ни одна ваша роль не разрешает это действие. Владелец бизнеса может назначить роль и область.',
    );
    await expect(gate(page).getByRole('button')).toHaveCount(0);
  });

  test('логист без права приёмки: «Нет права на приёмку смен» и «(«Проверять»)»', async ({
    app,
    page,
  }) => {
    await fleetAs(app, page, 'manager', 'review');
    await expect(h1(page, 'Нет права на приёмку смен')).toBeVisible();
    await expect(gate(page)).toContainText('(«Проверять»)');
  });

  test('сотрудник без права раздела: «Нет доступа к разделу «Формы»»', async ({ app, page }) => {
    await app('/', { persona: 'manager' });
    const alta = await tenantId(page);
    await app(`/t/${alta}/forms`, { persona: 'manager' });
    await expect(h1(page, 'Нет доступа к разделу «Формы»')).toBeVisible();
    await expect(gate(page)).toContainText(
      'Ни одна ваша роль не разрешает его просматривать. Владелец бизнеса может добавить действие в роль.',
    );
  });

  test('модуль отключён с историей: гейт пропускает, баннер «Модуль «Логистика» отключён.»', async ({
    app,
    page,
  }) => {
    await fleetAs(app, page, 'driver', 'today', true);
    await expect(gate(page)).toHaveCount(0);
    await expect(h1(page, 'Моя смена')).toBeVisible();
    await expect(
      page.getByRole('status').filter({ hasText: 'Модуль «Логистика» отключён.' }),
    ).toContainText('Новые брони и рейсы закрыты.');
  });

  test('отключённый модуль без права: чип «Модуль отключён»', async ({ app, page }) => {
    await fleetAs(app, page, 'manager', 'fleet', true);
    await expect(gate(page)).toContainText('Модуль отключён');
    await expect(h1(page, '«Логистика» не подключена организацией')).toBeVisible();
  });

  test('axe и раскладка гейта на 390 и 1440', async ({ app, page, axe }) => {
    await app('/', { persona: 'driver' });
    await expect(gate(page)).toBeVisible();
    const r = await axe(page);
    expect(r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual(
      [],
    );
    const scroll = await page.evaluate(() => document.scrollingElement?.scrollWidth ?? 0);
    expect(scroll).toBeLessThanOrEqual(page.viewportSize()?.width ?? 0);
    await expect(gate(page)).toHaveCSS('border-radius', '12px');
  });
});

// W1.49: оценщик W1.04 (возможности областей подразделения и «своё») и доступность модулей W1.08 — в main.
// W2.54: базовый сид стенда включает «Логистику» в «Альте» (Q-W2.02-5), гейта у водителя на стенде больше нет.
// Гейт «не подключена» проверяют строки @mock выше; на стенде — доступность модуля сквозь стек: «Моя смена».
test.describe('access-gate — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('водитель на стенде: «Логистика» подключена сидом — «Моя смена» без гейта', async ({
    app,
    page,
  }) => {
    // Первая строка проекта: холодные dev-вход и /me/context стенда (прогон e2e-stand слота 3, 15.10.2026: вход
    // водителя до 25 с, редирект `/` — дольше 15 с под нагрузкой машины) — тройной срок.
    test.slow();
    await app('/', { persona: 'driver' });
    await expect(page).toHaveURL(/\/today$/, { timeout: 30_000 });
    await expect(h1(page, 'Моя смена')).toBeVisible({ timeout: 30_000 });
    await expect(gate(page)).toHaveCount(0);
  });
});
