// W5.11 · e2e страницы `inventory` «Склад» (экран inventory-stock, no-reference: склада в эталоне нет, B-6; D-20 комплекта —
// остатки по партиям в порядке FEFO). Страница вне меню (Q-W5.11-4): прямой URL. Обязательные пункты
// verification-protocol §1.3: прямой URL, загрузка, ошибка, только чтение, нет права, нет связи, клавиатура, axe,
// раскладка 390 / 1440. Стенд — после вливания backend W5.10 (в main его нет).
import type { Persona } from '@ortus/e2e-kit';
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { phone } from './logistics-review.helpers.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { devScenario, tenantId } from './shell.helpers.ts';

const H1 = 'Склад';
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
const NB = ' ';

const stock = (page: Page) => page.getByRole('list', { name: 'Остатки', exact: true });
const rowOf = (page: Page, name: string, where = 'Склад салона') =>
  stock(page)
    .getByRole('listitem')
    .filter({ has: page.locator('.ox-inv-name', { hasText: new RegExp(`^${name}$`) }) })
    .filter({ hasText: where });

async function open(
  app: (route: string, o?: { persona?: Persona }) => Promise<unknown>,
  page: Page,
  query = '',
) {
  await app('/', { persona: 'owner' });
  const alta = await tenantId(page);
  await devScenario(page, { preset: 'inventory-ready' });
  await app(`/t/${alta}/inventory${query}`, { persona: 'owner' });
  await expect(h1(page, H1)).toBeVisible();
  return alta;
}

test.describe('inventory — склад: остатки и резервы @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('прямой URL и перезагрузка: заголовок, крошка владельца, вход в «Движения склада»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await expect(page.locator('section[aria-labelledby="h-inventory"] .ox-inv-crumb')).toHaveText(
      'Альта Групп · все подразделения',
    );
    await expect(page.getByRole('button', { name: 'Движения склада' })).toBeVisible();
    await page.reload();
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Движения склада' }).click();
    await expect(page).toHaveURL(/\/inventory-movements$/);
    await expect(h1(page, 'Движения склада')).toBeVisible();
  });

  test('остатки: пять строк со складом; масло — 250 мл, резерв 30, доступно 220, минимум 100', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await expect(stock(page).getByRole('listitem')).toHaveCount(5);
    const oil = rowOf(page, 'Масло массажное');
    await expect(oil).toContainText(`В наличии250${NB}мл`);
    await expect(oil).toContainText(`В резерве30${NB}мл`);
    await expect(oil).toContainText(`Доступно220${NB}мл`);
    await expect(oil).toContainText(`Минимум: 100${NB}мл`);
    await expect(rowOf(page, 'Крем восстанавливающий')).toContainText('Ниже минимума');
    await expect(rowOf(page, 'Полотенца одноразовые')).toContainText('Без партий');
  });

  test('партии позиции в порядке FEFO: ближайший срок первым, у просроченной — «Срок истёк»', async ({
    app,
    page,
  }) => {
    await open(app, page);
    const oil = rowOf(page, 'Масло массажное');
    await oil.getByRole('button', { name: 'Партии (2)' }).click();
    const lots = oil.getByRole('list', { name: 'Партии: Масло массажное' }).getByRole('listitem');
    await expect(lots).toHaveCount(2);
    await expect(lots.nth(0)).toContainText('до 15.11.2026');
    await expect(lots.nth(0)).toContainText('Спишется первой');
    await expect(lots.nth(1)).toContainText('до 01.03.2027');
    await oil.getByRole('button', { name: 'Скрыть партии' }).click();
    await expect(lots).toHaveCount(0);
    const main = rowOf(page, 'Масло массажное', 'Склад № 1');
    await main.getByRole('button', { name: 'Партии (2)' }).click();
    await expect(main.getByRole('listitem').first()).toContainText('Срок истёк');
  });

  test('фильтры: «Ниже минимума» и «Склад»; адрес хранит выбор', async ({ app, page }) => {
    await open(app, page);
    await page.getByRole('checkbox', { name: 'Ниже минимума' }).check();
    await expect(stock(page).getByRole('listitem')).toHaveCount(2);
    await expect(page).toHaveURL(/low=1/);
    await page.getByRole('checkbox', { name: 'Ниже минимума' }).uncheck();
    await page.getByRole('combobox', { name: 'Склад' }).selectOption({ label: 'Склад № 1' });
    await expect(stock(page).getByRole('listitem')).toHaveCount(1);
    await expect(page).toHaveURL(/warehouse=/);
    await page.reload();
    await expect(stock(page).getByRole('listitem')).toHaveCount(1);
  });

  test('правка позиции: минимум 120,5 — тост и новое значение; пустое название — ошибка поля', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await rowOf(page, 'Масло массажное')
      .getByRole('button', { name: 'Изменить позицию: Масло массажное' })
      .click();
    const dlg = page.getByRole('dialog', { name: 'Позиция «Масло массажное»' });
    await dlg.getByLabel('Название').fill('');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dlg.getByText('Укажите название позиции')).toBeVisible();
    await dlg.getByLabel('Название').fill('Масло массажное');
    await dlg.getByLabel('Минимальный уровень').fill('120,5');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText('Позиция «Масло массажное» сохранена');
    await expect(rowOf(page, 'Масло массажное')).toContainText(`Минимум: 120,5${NB}мл`);
  });

  test('новая позиция и новый склад: ошибки полей, дубли под полем, тосты', async ({
    app,
    page,
  }) => {
    await open(app, page);
    await page.getByRole('button', { name: 'Новая позиция' }).click();
    const item = page.getByRole('dialog', { name: 'Новая позиция' });
    await item.getByRole('button', { name: 'Добавить' }).click();
    for (const t of [
      'Выберите подразделение',
      'Укажите название позиции',
      'Укажите артикул',
      'Выберите единицу',
    ]) {
      await expect(item.getByText(t)).toBeVisible();
    }
    await item.getByLabel('Подразделение').selectOption({ index: 1 });
    await item.getByLabel('Название').fill('Скраб солевой');
    await item.getByLabel('Артикул').fill('oil-500');
    await item.getByLabel('Единица').selectOption('g');
    await item.getByRole('button', { name: 'Добавить' }).click();
    await expect(item.getByText('Позиция с таким артикулом уже есть')).toBeVisible();
    await item.getByLabel('Артикул').fill('SCR-1');
    await item.getByRole('button', { name: 'Добавить' }).click();
    await expect(toast(page)).toHaveText('Позиция «Скраб солевой» добавлена');
    await expect(item).toBeHidden();
    await page.getByRole('button', { name: 'Новый склад' }).click();
    const wh = page.getByRole('dialog', { name: 'Новый склад' });
    await wh.getByRole('button', { name: 'Создать склад' }).click();
    await expect(wh.getByText('Укажите название склада')).toBeVisible();
    await wh.getByLabel('Подразделение').selectOption({ index: 1 });
    await wh.getByLabel('Название').fill('Склад прачечной');
    await wh.getByLabel('Код').fill('S1');
    await wh.getByRole('button', { name: 'Создать склад' }).click();
    await expect(wh.getByText('Склад с таким кодом уже есть')).toBeVisible();
    await wh.getByLabel('Код').fill('LND');
    await wh.getByRole('button', { name: 'Создать склад' }).click();
    await expect(toast(page)).toHaveText('Склад «Склад прачечной» создан');
    await expect(page.getByRole('combobox', { name: 'Склад' })).toContainText('Склад прачечной');
  });

  test('вкладка «Резервы»: список и «Снять резерв» с подтверждением', async ({ app, page }) => {
    await open(app, page);
    await page.getByRole('tab', { name: 'Резервы' }).click();
    await expect(page).toHaveURL(/view=reservations/);
    const list = page.getByRole('list', { name: 'Резервы', exact: true });
    await expect(list.getByRole('listitem')).toHaveCount(2);
    await expect(list).toContainText('Салон и SPA · запись');
    await list.getByRole('button', { name: 'Снять резерв' }).click();
    const dlg = page.getByRole('dialog', { name: 'Снять резерв?' });
    await expect(dlg).toContainText('Остаток склада не меняется.');
    await dlg.getByRole('button', { name: 'Снять резерв' }).click();
    await expect(toast(page)).toHaveText('Резерв снят');
    await expect(list.getByRole('button', { name: 'Снять резерв' })).toHaveCount(0);
    await page.getByRole('tab', { name: 'Остатки' }).click();
    await expect(rowOf(page, 'Масло массажное')).toContainText(`Доступно250${NB}мл`);
  });

  test('загрузка — скелетон; ошибка — «Повторить»; нет связи — тост, форма остаётся', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'inventory-ready' });
    await devScenario(page, { scenario: 'listInventoryBalances=delay=1500' });
    await app(`/t/${alta}/inventory`, { persona: 'owner' });
    await expect(page.getByRole('main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: 'listInventoryBalances=rate_limited' });
    await page.reload();
    await expect(page.getByText(/^Не удалось загрузить данные склада: /)).toHaveText(
      'Не удалось загрузить данные склада: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(stock(page).getByRole('listitem')).toHaveCount(5);
    await page.getByRole('button', { name: 'Новый склад' }).click();
    const wh = page.getByRole('dialog', { name: 'Новый склад' });
    await wh.getByLabel('Подразделение').selectOption({ index: 1 });
    await wh.getByLabel('Название').fill('Склад прачечной');
    await devScenario(page, { scenario: 'createWarehouse=offline' });
    await wh.getByRole('button', { name: 'Создать склад' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(wh.getByLabel('Название')).toHaveValue('Склад прачечной');
  });

  test('организация только для чтения: остатки видны, действий нет; водитель — гейт', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'inventory-ready' });
    await devScenario(page, { preset: 'trial-ended' });
    await app(`/t/${alta}/inventory`, { persona: 'owner' });
    await expect(stock(page).getByRole('listitem')).toHaveCount(5);
    await expect(page.getByRole('button', { name: 'Новая позиция' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Новый склад' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Изменить позицию/ })).toHaveCount(0);
    await expect(
      page.getByText('Организация только для чтения: остатки и движения доступны для просмотра.'),
    ).toBeVisible();
    await app(`/t/${alta}/inventory`, { persona: 'driver' });
    await expect(page.getByRole('heading', { name: /^Нет доступа к разделу/ })).toBeVisible();
    await expect(stock(page)).toHaveCount(0);
  });

  test('клавиатура: Tab до «Изменить», Enter — окно, Escape закрывает и возвращает фокус; axe', async ({
    app,
    page,
    axe,
  }) => {
    await open(app, page);
    const btn = rowOf(page, 'Полотенца одноразовые').getByRole('button', {
      name: 'Изменить позицию: Полотенца одноразовые',
    });
    let reached = false;
    for (let i = 0; i < 120 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await btn.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await btn.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'Позиция «Полотенца одноразовые»' });
    await expect(dlg).toBeVisible();
    const bad = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(bad.map((v) => v.id)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(btn).toBeFocused();
  });

  test('390: цели не меньше 44 px, без горизонтальной прокрутки; axe без serious', async ({
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
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeHidden();
      expect(
        await hitHeight(page.getByRole('button', { name: 'Новая позиция' })),
      ).toBeGreaterThanOrEqual(44);
      expect(
        await hitHeight(page.getByRole('combobox', { name: 'Склад' }).locator('..')),
      ).toBeGreaterThanOrEqual(44);
      expect(
        await hitHeight(
          rowOf(page, 'Масло массажное').getByRole('button', {
            name: 'Изменить позицию: Масло массажное',
          }),
        ),
      ).toBeGreaterThanOrEqual(44);
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeHidden();
    }
  });
});

// Стенд: backend склада — W5.10 (в main его нет), строка включается после вливания W5.10 и миграции tenant 0043.
test.describe('inventory — склад @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('W5.10: склад на стенде — остатки FEFO, правка позиции, резерв', () => {});
});
