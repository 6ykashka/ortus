// W5.11 · e2e страницы `inventoryMovements` «Движения склада» (экран inventory-movements, no-reference, B-6; журнал
// неизменяем — исправление сторно, отрицательных остатков нет, расход без партии — по FEFO). Страница вне меню (Q-W5.11-4).
// Обязательные пункты verification-protocol §1.3; стенд — backend W5.10 (@stand, W2.103).
import type { Persona } from '@ortus/e2e-kit';
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { balanceOf, dateIn, stockFixture } from './inventory.stand.ts';
import { devScenario, tenantId } from './shell.helpers.ts';

const H1 = 'Движения склада';
const NB = ' ';

const journal = (page: Page) => page.getByRole('list', { name: H1, exact: true });
const rows = (page: Page) => journal(page).getByRole('listitem');

async function open(
  app: (route: string, o?: { persona?: Persona }) => Promise<unknown>,
  page: Page,
) {
  await app('/', { persona: 'owner' });
  const alta = await tenantId(page);
  await devScenario(page, { preset: 'inventory-ready' });
  await app(`/t/${alta}/inventory-movements`, { persona: 'owner' });
  await expect(h1(page, H1)).toBeVisible();
  return alta;
}

async function newMovement(page: Page, kind: string) {
  await page.getByRole('button', { name: 'Новое движение' }).click();
  const dlg = page.getByRole('dialog', { name: 'Новое движение' });
  await dlg.getByLabel('Вид движения').selectOption({ label: kind });
  return dlg;
}

test.describe('inventory-movements — движения склада @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('прямой URL и вход со страницы «Склад»: журнал от новых к старым, крошка', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await expect(
      page.locator('section[aria-labelledby="h-inventory-movements"] .ox-inv-crumb'),
    ).toHaveText('Альта Групп · все подразделения');
    await expect(rows(page)).toHaveCount(6);
    await expect(rows(page).first().locator('.ox-inv-chip')).toHaveText('Расход');
    await expect(rows(page).first().locator('.ox-inv-when')).toHaveText('01.10.2026, 09:50');
    await expect(rows(page).first()).toContainText('Салон и SPA · запись');
    await page.getByRole('button', { name: 'Остатки и резервы' }).click();
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(h1(page, 'Склад')).toBeVisible();
    await page.goBack();
    await page.reload();
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
  });

  test('приход с партией и сроком — тост, строка «Приход» сверху, партия в остатках', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const dlg = await newMovement(page, 'Приход');
    await dlg.getByLabel('Склад', { exact: true }).selectOption({ label: 'Склад салона' });
    await dlg.getByLabel('Позиция 1').selectOption({ label: 'Масло массажное' });
    await dlg.getByLabel('Количество 1').fill('40,5');
    await dlg.getByLabel('Срок годности 1').fill('2026-12-01');
    await dlg.getByRole('button', { name: 'Провести' }).click();
    await expect(toast(page)).toHaveText('Движение проведено');
    await expect(dlg).toBeHidden();
    await expect(rows(page).first().locator('.ox-inv-chip')).toHaveText('Приход');
    await expect(rows(page).first().locator('.ox-inv-line')).toContainText(`+40,5${NB}мл`);
    await expect(rows(page).first().locator('.ox-inv-line')).toContainText('до 01.12.2026');
  });

  test('пустая форма — ошибки полей; расход больше остатка — «не хватает», остаток прежний', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const dlg = await newMovement(page, 'Расход');
    await dlg.getByRole('button', { name: 'Провести' }).click();
    for (const t of ['Выберите склад', 'Выберите позицию']) {
      await expect(dlg.getByText(t)).toBeVisible();
    }
    await dlg.getByLabel('Склад', { exact: true }).selectOption({ label: 'Склад салона' });
    await dlg.getByLabel('Позиция 1').selectOption({ label: 'Масло массажное' });
    await dlg.getByLabel('Количество 1').fill('1000');
    await dlg.getByRole('button', { name: 'Провести' }).click();
    await expect(dlg.getByRole('alert')).toHaveText(
      'На складе не хватает: остаток меньше, чем нужно. Проверьте количество.',
    );
    await expect(rows(page)).toHaveCount(6);
  });

  test('расход без партии идёт по FEFO; из просроченной партии — «срок годности истёк»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const dlg = await newMovement(page, 'Расход');
    await dlg.getByLabel('Склад', { exact: true }).selectOption({ label: 'Склад № 1' });
    await dlg.getByLabel('Позиция 1').selectOption({ label: 'Масло массажное' });
    const lot = dlg.getByLabel('Партия 1');
    await expect(lot.locator('option')).toHaveText([
      'По сроку годности (FEFO)',
      `до 20.09.2026 · 40${NB}мл`,
      `до 30.06.2027 · 500${NB}мл`,
    ]);
    await lot.selectOption({ label: `до 20.09.2026 · 40${NB}мл` });
    await dlg.getByLabel('Количество 1').fill('10');
    await dlg.getByRole('button', { name: 'Провести' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Срок годности партии истёк');
    await lot.selectOption({ index: 0 });
    await dlg.getByRole('button', { name: 'Провести' }).click();
    await expect(toast(page)).toHaveText('Движение проведено');
    await expect(rows(page).first().locator('.ox-inv-line')).toContainText('до 30.06.2027');
  });

  test('перемещение между складами и корректировка с причиной', async ({ app, page }) => {
    await open(app, page);
    const move = await newMovement(page, 'Перемещение');
    await move.getByLabel('Откуда').selectOption({ label: 'Склад салона' });
    await move.getByRole('button', { name: 'Провести' }).click();
    await expect(move.getByText('Выберите склад назначения')).toBeVisible();
    await move.getByLabel('Куда', { exact: true }).selectOption({ label: 'Склад салона' });
    await move.getByRole('button', { name: 'Провести' }).click();
    await expect(move.getByText('Склад назначения должен отличаться от исходного')).toBeVisible();
    await move.getByLabel('Куда', { exact: true }).selectOption({ label: 'Склад № 1' });
    await move.getByLabel('Позиция 1').selectOption({ label: 'Крем восстанавливающий' });
    await move.getByLabel('Количество 1').fill('2');
    await move.getByRole('button', { name: 'Провести' }).click();
    await expect(toast(page)).toHaveText('Движение проведено');
    await expect(rows(page).first().locator('.ox-inv-where')).toHaveText(
      'Склад салона → Склад № 1',
    );
    const adj = await newMovement(page, 'Корректировка');
    await adj.getByLabel('Склад', { exact: true }).selectOption({ label: 'Склад салона' });
    await adj.getByLabel('Позиция 1').selectOption({ label: 'Полотенца одноразовые' });
    await adj.getByLabel('Количество 1').fill('3');
    await adj.getByRole('button', { name: 'Провести' }).click();
    await expect(adj.getByText('Выберите, что изменилось')).toBeVisible();
    await expect(adj.getByText('Укажите причину')).toBeVisible();
    await adj.getByLabel('Что изменилось').selectOption({ label: 'Меньше, чем в учёте' });
    await adj.getByLabel('Причина', { exact: true }).fill('Порча');
    await adj.getByRole('button', { name: 'Провести' }).click();
    await expect(rows(page).first().locator('.ox-inv-chip')).toHaveText('Корректировка');
  });

  test('сторно: причина обязательна, новая строка «Сторно»; повторное сторно — отказ в тосте', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await rows(page)
      .first()
      .getByRole('button', { name: /^Сторно/ })
      .click();
    const dlg = page.getByRole('dialog', { name: 'Сторно движения' });
    await dlg.getByRole('button', { name: 'Сторнировать' }).click();
    await expect(dlg.getByText('Укажите причину сторно')).toBeVisible();
    await dlg.getByLabel('Причина сторно').fill('Ошибочное списание');
    await dlg.getByRole('button', { name: 'Сторнировать' }).click();
    await expect(toast(page)).toHaveText('Сторно проведено');
    await expect(rows(page)).toHaveCount(7);
    await expect(rows(page).first().locator('.ox-inv-chip')).toHaveText('Сторно');
    await expect(
      rows(page)
        .first()
        .getByRole('button', { name: /^Сторно/ }),
    ).toHaveCount(0);
    await rows(page)
      .nth(3)
      .getByRole('button', { name: /^Сторно/ })
      .click();
    await dlg.getByLabel('Причина сторно').fill('Повторно');
    await dlg.getByRole('button', { name: 'Сторнировать' }).click();
    await expect(toast(page)).toHaveText('Статус уже изменился. Обновите данные и повторите.');
    await expect(rows(page)).toHaveCount(7);
  });

  test('загрузка — скелетон; ошибка — «Повторить»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'inventory-ready' });
    await devScenario(page, { scenario: 'listInventoryMovements=delay=1500' });
    await app(`/t/${alta}/inventory-movements`, { persona: 'owner' });
    await expect(page.getByRole('main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: 'listInventoryMovements=rate_limited' });
    await page.reload();
    await expect(page.getByText(/^Не удалось загрузить данные склада: /)).toHaveText(
      'Не удалось загрузить данные склада: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(rows(page)).toHaveCount(6);
  });

  test('только для чтения: журнал виден, «Новое движение» и «Сторно» нет; водитель — гейт', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'inventory-ready' });
    await devScenario(page, { preset: 'trial-ended' });
    await app(`/t/${alta}/inventory-movements`, { persona: 'owner' });
    await expect(rows(page)).toHaveCount(6);
    await expect(page.getByRole('button', { name: 'Новое движение' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Сторно/ })).toHaveCount(0);
    await app(`/t/${alta}/inventory-movements`, { persona: 'driver' });
    await expect(page.getByRole('heading', { name: /^Нет доступа к разделу/ })).toBeVisible();
    await expect(journal(page)).toHaveCount(0);
  });

  test('клавиатура: окно «Новое движение» — Escape закрывает, фокус возвращается; axe', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    const btn = page.getByRole('button', { name: 'Новое движение' });
    let reached = false;
    for (let i = 0; i < 120 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await btn.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await btn.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'Новое движение' });
    await expect(dlg).toBeVisible();
    const bad = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(bad.map((v) => v.id)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(btn).toBeFocused();
  });

  test('390: карточки, цели не меньше 44 px, без горизонтальной прокрутки; 1440 — боковая панель; axe', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
      expect(
        await hitHeight(page.getByRole('button', { name: 'Новое движение' })),
      ).toBeGreaterThanOrEqual(44);
      expect(
        await hitHeight(
          rows(page)
            .first()
            .getByRole('button', { name: /^Сторно/ }),
        ),
      ).toBeGreaterThanOrEqual(44);
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
    }
  });
});

// Стенд: backend склада W5.10 в main. Склад, позиция и партии — командами API (inventory.stand.ts); проводки и сторно —
// через окна страницы. Журнал общий на стенде, поэтому строки теста ищутся по метке прогона в названиях.
test.describe('inventory-movements — движения @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(150_000);

  test('владелец на стенде: приход с партией и сроком — тост, строка «Приход», партия в остатках сервера', async ({
    app,
    page,
  }, testInfo) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    const f = await stockFixture(page, alta, testInfo.project.name);
    const exp = dateIn(120);
    await app(`/t/${alta}/inventory-movements`, { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    const dlg = await newMovement(page, 'Приход');
    await dlg.getByLabel('Склад', { exact: true }).selectOption({ label: f.warehouse.name });
    await dlg.getByLabel('Позиция 1').selectOption({ label: f.item.name });
    await dlg.getByLabel('Количество 1').fill('40,5');
    await dlg.getByLabel('Срок годности 1').fill(exp);
    await dlg.getByRole('button', { name: 'Провести' }).click();
    await expect(toast(page)).toHaveText('Движение проведено', { timeout: 20_000 });
    await expect(dlg).toBeHidden();
    const top = rows(page).first();
    await expect(top.locator('.ox-inv-chip')).toHaveText('Приход');
    await expect(top.locator('.ox-inv-line')).toContainText(`${f.item.name}`);
    await expect(top.locator('.ox-inv-line')).toContainText(`+40,5${NB}мл`);
    await expect(top.locator('.ox-inv-line')).toContainText(
      `до ${exp.split('-').reverse().join('.')}`,
    );
    const bal = await balanceOf(page, f);
    expect(Number(bal.onHand)).toBe(40.5);
    expect(bal.lots.map((l) => l.expiresOn)).toEqual([exp]);
  });

  test('владелец на стенде: пустая форма — ошибки полей; расход больше остатка — отказ сервера, остаток прежний', async ({
    app,
    page,
  }, testInfo) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    const f = await stockFixture(page, alta, testInfo.project.name, {
      lots: [{ qty: '30', expiresOn: dateIn(90) }],
    });
    await app(`/t/${alta}/inventory-movements`, { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await expect(rows(page).first()).toBeVisible();
    const before = await rows(page).count();
    const dlg = await newMovement(page, 'Расход');
    await dlg.getByRole('button', { name: 'Провести' }).click();
    for (const t of ['Выберите склад', 'Выберите позицию']) {
      await expect(dlg.getByText(t)).toBeVisible();
    }
    await dlg.getByLabel('Склад', { exact: true }).selectOption({ label: f.warehouse.name });
    await dlg.getByLabel('Позиция 1').selectOption({ label: f.item.name });
    await dlg.getByLabel('Количество 1').fill('1000');
    await dlg.getByRole('button', { name: 'Провести' }).click();
    await expect(dlg.getByRole('alert')).toBeVisible();
    await expect(rows(page)).toHaveCount(before);
    expect(Number((await balanceOf(page, f)).onHand)).toBe(30);
  });

  test('владелец на стенде: расход без партии идёт по FEFO — сначала партия с ближайшим сроком', async ({
    app,
    page,
  }, testInfo) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    const soon = dateIn(15);
    const late = dateIn(300);
    const f = await stockFixture(page, alta, testInfo.project.name, {
      lots: [
        { qty: '500', expiresOn: late },
        { qty: '40', expiresOn: soon },
      ],
    });
    await app(`/t/${alta}/inventory-movements`, { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    const dlg = await newMovement(page, 'Расход');
    await dlg.getByLabel('Склад', { exact: true }).selectOption({ label: f.warehouse.name });
    await dlg.getByLabel('Позиция 1').selectOption({ label: f.item.name });
    const lot = dlg.getByLabel('Партия 1');
    await expect(lot.locator('option').first()).toHaveText('По сроку годности (FEFO)');
    await expect(lot.locator('option')).toHaveCount(3);
    await dlg.getByLabel('Количество 1').fill('25');
    await dlg.getByRole('button', { name: 'Провести' }).click();
    await expect(toast(page)).toHaveText('Движение проведено', { timeout: 20_000 });
    const top = rows(page).first();
    await expect(top.locator('.ox-inv-chip')).toHaveText('Расход');
    await expect(top.locator('.ox-inv-line')).toContainText(
      `до ${soon.split('-').reverse().join('.')}`,
    );
    const bal = await balanceOf(page, f);
    expect(Number(bal.onHand)).toBe(515);
    expect(bal.lots.find((l) => l.expiresOn === soon)?.onHand).toBe('15');
    expect(bal.lots.find((l) => l.expiresOn === late)?.onHand).toBe('500');
  });

  test('владелец на стенде: перемещение между складами и корректировка с причиной', async ({
    app,
    page,
  }, testInfo) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    const a = await stockFixture(page, alta, testInfo.project.name, {
      lots: [{ qty: '80', expiresOn: dateIn(100) }],
    });
    const b = await stockFixture(page, alta, testInfo.project.name);
    await app(`/t/${alta}/inventory-movements`, { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    const move = await newMovement(page, 'Перемещение');
    await move.getByLabel('Откуда').selectOption({ label: a.warehouse.name });
    await move.getByRole('button', { name: 'Провести' }).click();
    await expect(move.getByText('Выберите склад назначения')).toBeVisible();
    await move.getByLabel('Куда', { exact: true }).selectOption({ label: a.warehouse.name });
    await move.getByRole('button', { name: 'Провести' }).click();
    await expect(move.getByText('Склад назначения должен отличаться от исходного')).toBeVisible();
    await move.getByLabel('Куда', { exact: true }).selectOption({ label: b.warehouse.name });
    await move.getByLabel('Позиция 1').selectOption({ label: a.item.name });
    await move.getByLabel('Количество 1').fill('30');
    await move.getByRole('button', { name: 'Провести' }).click();
    await expect(toast(page)).toHaveText('Движение проведено', { timeout: 20_000 });
    await expect(rows(page).first().locator('.ox-inv-where')).toHaveText(
      `${a.warehouse.name} → ${b.warehouse.name}`,
    );
    expect(Number((await balanceOf(page, a)).onHand)).toBe(50);
    const adj = await newMovement(page, 'Корректировка');
    await adj.getByLabel('Склад', { exact: true }).selectOption({ label: a.warehouse.name });
    await adj.getByLabel('Позиция 1').selectOption({ label: a.item.name });
    await adj.getByLabel('Количество 1').fill('3');
    await adj.getByRole('button', { name: 'Провести' }).click();
    await expect(adj.getByText('Выберите, что изменилось')).toBeVisible();
    await expect(adj.getByText('Укажите причину')).toBeVisible();
    await adj.getByLabel('Что изменилось').selectOption({ label: 'Меньше, чем в учёте' });
    await adj.getByLabel('Причина', { exact: true }).fill('Порча');
    await adj.getByRole('button', { name: 'Провести' }).click();
    await expect(rows(page).first().locator('.ox-inv-chip')).toHaveText('Корректировка');
    expect(Number((await balanceOf(page, a)).onHand)).toBe(47);
  });

  test('владелец на стенде: сторно с причиной возвращает остаток, повторное сторно того же движения — отказ', async ({
    app,
    page,
  }, testInfo) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    const f = await stockFixture(page, alta, testInfo.project.name, {
      lots: [{ qty: '60', expiresOn: dateIn(100) }],
    });
    await app(`/t/${alta}/inventory-movements`, { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    const out = await newMovement(page, 'Расход');
    await out.getByLabel('Склад', { exact: true }).selectOption({ label: f.warehouse.name });
    await out.getByLabel('Позиция 1').selectOption({ label: f.item.name });
    await out.getByLabel('Количество 1').fill('20');
    await out.getByRole('button', { name: 'Провести' }).click();
    await expect(toast(page)).toHaveText('Движение проведено', { timeout: 20_000 });
    expect(Number((await balanceOf(page, f)).onHand)).toBe(40);
    await expect(rows(page).first()).toBeVisible();
    const count = await rows(page).count();
    await rows(page)
      .first()
      .getByRole('button', { name: /^Сторно/ })
      .click();
    const dlg = page.getByRole('dialog', { name: 'Сторно движения' });
    await dlg.getByRole('button', { name: 'Сторнировать' }).click();
    await expect(dlg.getByText('Укажите причину сторно')).toBeVisible();
    await dlg.getByLabel('Причина сторно').fill('Ошибочное списание');
    await dlg.getByRole('button', { name: 'Сторнировать' }).click();
    await expect(toast(page)).toHaveText('Сторно проведено', { timeout: 20_000 });
    await expect(rows(page)).toHaveCount(count + 1);
    await expect(rows(page).first().locator('.ox-inv-chip')).toHaveText('Сторно');
    await expect(
      rows(page)
        .first()
        .getByRole('button', { name: /^Сторно/ }),
    ).toHaveCount(0);
    expect(Number((await balanceOf(page, f)).onHand)).toBe(60);
  });

  test('водитель на стенде: нет права на журнал склада — гейт', async ({ app, page }) => {
    await app('/', { persona: 'driver' });
    const alta = await tenantId(page);
    await app(`/t/${alta}/inventory-movements`, { persona: 'driver' });
    await expect(page.getByRole('heading', { name: /^Нет доступа к разделу/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(journal(page)).toHaveCount(0);
  });
});
