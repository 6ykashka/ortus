// W6.22 · e2e страницы `repair-supply` «Снабжение» (эталон: «Ремонт и стройка.dc.html» `data-screen-label="Снабжение и
// склады"` :724–829, CRM :1910; разбор docs/plan/v2/analysis/dor/repair.md §1.3, §7). Режим mock: сценарный сервер
// W6.00, пресет repairs-ready (7 заявок ждут решения, закупка ЗК-6, остатки на объектах). Обязательные пункты
// verification-protocol §1.3: меню и прямой URL, состояния, клавиатура, axe, 390 / 1440.
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { fromMenu } from './logistics.helpers.ts';
import { phone } from './logistics-review.helpers.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { note, openRepair, requestRow } from './repair-supply.helpers.ts';
import { expectStatus } from './_stand/stand.ts';
import { repairObject } from './repair.stand.ts';
import { call, devScenario, tenantId } from './shell.helpers.ts';

const H1 = 'Снабжение';
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';

const tab = (page: import('@playwright/test').Page, name: string | RegExp) =>
  page.getByRole('tablist', { name: 'Снабжение' }).getByRole('tab', { name });

test.describe('repair-supply — «Снабжение» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('открывается из меню «Снабжение» и по прямому URL; заголовок, крошка, описание, вкладки', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'repairs-ready' });
    await app(`/t/${alta}/home`, { persona: 'owner' });
    await fromMenu(page, 'Снабжение');
    await expect(page).toHaveURL(/\/repair-supply$/);
    await expect(h1(page, H1)).toBeVisible();
    await expect(page.locator('.ox-rps-crumb')).toHaveText('Ремонт и стройка');
    await expect(page.getByText(/^Заявки прорабов со всех объектов и склады фирм\./)).toBeVisible();
    await expect(tab(page, 'Заявки · 7')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'Закупки · 1')).toBeVisible();
    await expect(tab(page, 'Остатки')).toBeVisible();
    await expect(tab(page, 'Движения')).toBeVisible();
    await page.reload();
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
    await expect(tab(page, 'Заявки · 7')).toBeVisible();
  });

  test('«Заявки»: колонки, срок «Нужно к», «На складах», смета', async ({ app, page }) => {
    await openRepair(app, page, 'repair-supply');
    await expect(page.getByRole('heading', { level: 3, name: 'Ждут решения' })).toBeVisible();
    await expect(page.getByRole('columnheader')).toHaveText([
      'В закупку',
      'Заявка и объект',
      'Материал',
      'Нужно к',
      'На складах',
      'Решение',
    ]);
    const r = requestRow(page, 'З-21');
    await expect(r).toContainText('ЖК Северный парк · квартира 117');
    await expect(r).toContainText('Плинтус МДФ · 42 м');
    await expect(r).toContainText('по смете 13 020 ₽');
    await expect(r).toContainText('22.10');
    await expect(r).toContainText('через 2 дня');
    await expect(r).toContainText('Москва · Отрадное: 60 м');
    await expect(
      r.getByRole('button', { name: 'Выдать со склада «Москва · Отрадное»' }),
    ).toBeVisible();
    await expect(requestRow(page, 'З-14')).toContainText('На складах нет');
    await expect(requestRow(page, 'З-23')).toContainText('через 1 день');
    await expect(requestRow(page, 'З-23').getByText('остаток на «Дом на Лесной')).toHaveCount(0);
    await expect(requestRow(page, 'З-21')).toContainText(
      'остаток на «Профсоюзная, 64 · квартира 210»: 8 м',
    );
  });

  test('выдать со склада → «В работе» → «Выдать прорабу»', async ({ app, page }) => {
    await openRepair(app, page, 'repair-supply');
    await requestRow(page, 'З-21')
      .getByRole('button', { name: 'Выдать со склада «Москва · Отрадное»' })
      .click();
    await expect(note(page)).toHaveText(
      'Резерв на складе «Москва · Отрадное»: Плинтус МДФ, 42 м. Кладовщик выдаст прорабу по заявке З-21.',
    );
    await expect(tab(page, 'Заявки · 6')).toBeVisible();
    const work = page
      .locator('.ox-rps-card')
      .filter({ has: page.getByRole('heading', { name: 'В работе' }) });
    await expect(work).toContainText('К выдаче со склада');
    await expect(work).toContainText('Склад «Москва · Отрадное» · прораб забирает по заявке');
    await work.getByRole('button', { name: 'Выдать прорабу' }).click();
    await expect(note(page)).toContainText(
      'Плинтус МДФ выдан на объект «ЖК Северный парк · квартира 117»: 11 130 ₽ по средней цене склада — в расходы объекта.',
    );
    await expect(page.getByText('Выполнено: 3 заявки — см. «Движения».')).toBeVisible();
    await note(page).locator('xpath=../button').click();
    await expect(note(page)).toHaveCount(0);
  });

  test('закупка: отметить заявки, «Собрать закупку», форма, «Оформить закупку»', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, 'repair-supply');
    const buy = page.getByRole('button', { name: 'Собрать закупку', exact: true });
    await expect(buy).toBeDisabled();
    await requestRow(page, 'З-14').getByRole('checkbox').check();
    await requestRow(page, 'З-24').getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Собрать закупку · 2 заявки' }).click();
    const form = page
      .locator('.ox-rps-card-sel')
      .filter({ has: page.getByRole('heading', { name: 'Новая закупка' }) });
    await expect(form).toContainText('Одна поставка, суммы распределяются по объектам: 2');
    await expect(form.getByLabel('Поставщик')).toHaveValue('СтройБаза Север');
    await expect(form).toContainText(
      'Цена по умолчанию — средняя цена склада или последняя закупка',
    );
    await form.getByLabel('Цена закупки: Ламинат 33 класс').fill('1 300');
    await expect(form).toContainText('67 600 ₽');
    await form.getByLabel('Поставщик').selectOption('ПолМаркет');
    await form.getByRole('button', { name: 'Оформить закупку' }).click();
    await expect(note(page)).toHaveText(
      'Закупка ЗК-7 у «ПолМаркет»: 2 позиции для 2 объектов. После получения сумма каждой строки уйдёт в расходы своего объекта.',
    );
    await expect(tab(page, 'Заявки · 5')).toBeVisible();
    await expect(tab(page, 'Закупки · 2')).toBeVisible();
    await expect(form).toHaveCount(0);
    const work = page
      .locator('.ox-rps-card')
      .filter({ has: page.getByRole('heading', { name: 'В работе' }) });
    await expect(work).toContainText('В закупке ЗК-7');
  });

  test('«Отмена» закрывает форму закупки', async ({ app, page }) => {
    await openRepair(app, page, 'repair-supply');
    await requestRow(page, 'З-14').getByRole('checkbox').check();
    await page.getByRole('button', { name: /^Собрать закупку/ }).click();
    await expect(page.getByRole('heading', { name: 'Новая закупка' })).toBeVisible();
    await page.getByRole('button', { name: 'Отмена' }).click();
    await expect(page.getByRole('heading', { name: 'Новая закупка' })).toHaveCount(0);
  });

  test('«Закупки»: ЗК-6 получена; новая закупка — чек QR → «Получено»', async ({ app, page }) => {
    await openRepair(app, page, 'repair-supply?tab=purchases');
    const p6 = page.locator('article', { hasText: 'ЗК-6' });
    await expect(p6).toContainText('СтройБаза Север');
    await expect(p6).toContainText('14.10 · 1 позиция · 1 объект');
    await expect(p6).toContainText('13 200 ₽');
    await expect(p6.getByRole('button', { name: 'Получено' })).toHaveCount(0);
    await tab(page, /^Заявки/).click();
    await requestRow(page, 'З-21').getByRole('checkbox').check();
    await page.getByRole('button', { name: /^Собрать закупку/ }).click();
    await page.getByRole('button', { name: 'Оформить закупку' }).click();
    await expect(note(page)).toContainText('Закупка ЗК-7 у «СтройБаза Север»');
    await tab(page, /^Закупки/).click();
    const p7 = page.locator('article', { hasText: 'ЗК-7' });
    await expect(p7).toContainText('Заказано');
    const receive = p7.getByRole('button', { name: 'Получено' });
    await expect(receive).toBeDisabled();
    await p7.getByLabel('Чек по QR').fill('t=20261020T1010&s=11130.00');
    await receive.click();
    await expect(note(page)).toHaveText(
      'Закупка ЗК-7 получена: материалы на объектах, суммы разнесены по объектам.',
    );
    await expect(p7.getByRole('button', { name: 'Получено' })).toHaveCount(0);
    await expect(p7).toContainText('Получено');
  });

  test('«Остатки»: остатки на объектах — вернуть на склад и переместить на объект', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, 'repair-supply?tab=stock');
    await expect(
      page.getByRole('heading', { level: 3, name: 'Остатки на объектах' }),
    ).toBeVisible();
    const tile = page.locator('.ox-rps-row').filter({ hasText: 'Керамогранит 60×60 · 4 м²' });
    await expect(tile).toContainText('Дом на Лесной · Мытищи · 6 160 ₽');
    await tile.getByRole('button', { name: 'Вернуть на склад' }).click();
    await tile.getByLabel('Склад').selectOption({ label: 'Склад «Мытищи»' });
    await tile.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(note(page)).toHaveText(
      'Керамогранит 60×60, 4 м² возвращены на склад «Мытищи». Средняя цена склада пересчитана, объект «Дом на Лесной · Мытищи» уменьшил расходы на 6 160 ₽.',
    );
    await expect(tile).toHaveCount(0);
    const skirting = page.locator('.ox-rps-row').filter({ hasText: 'Плинтус МДФ · 8 м' });
    await skirting.getByRole('button', { name: 'Переместить на объект' }).click();
    const objects = skirting.getByLabel('Объект');
    await expect(objects.locator('option').first()).toHaveText(
      'ЖК Северный парк · квартира 117 · заявка З-21: 42 м',
    );
    await skirting.getByRole('button', { name: 'Отмена' }).click();
    await skirting.getByRole('button', { name: 'Переместить на объект' }).click();
    await skirting.getByRole('button', { name: 'Подтвердить' }).click();
    await expect(note(page)).toHaveText(
      'Плинтус МДФ, 8 м перемещены на «ЖК Северный парк · квартира 117». Заявка З-21 уменьшена до 34 м. Стоимость перенесена в расходы нового объекта.',
    );
  });

  test('«Остатки» и «Движения» складов из общего модуля «Склад»; подсказка о неизменяемости', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, 'repair-supply?tab=stock');
    await expect(page.getByRole('columnheader')).toContainText([
      'Материал',
      'Склад',
      'Остаток',
      'В резерве',
      'Свободно',
    ]);
    await expect(
      page.getByRole('row', { name: /Масло массажное.*Склад салона.*250 мл/ }),
    ).toBeVisible();
    await tab(page, 'Движения').click();
    await expect(page).toHaveURL(/tab=movements/);
    await expect(page.getByRole('columnheader')).toContainText([
      'Операция',
      'Материал',
      'Откуда → куда',
    ]);
    await expect(page.getByText('Приход на склад').first()).toBeVisible();
    await expect(
      page.getByText(
        'Движения не редактируются: ошибка исправляется обратным движением (модуль «Склад», см. OpenAPI 0.1).',
      ),
    ).toBeVisible();
  });
  test('загрузка — скелетон; ошибка — «Повторить»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'repairs-ready' });
    await devScenario(page, { scenario: 'listSupplyRequests=delay=1500' });
    await app(`/t/${alta}/repair-supply`, { persona: 'owner' });
    await expect(page.getByRole('main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await expect(tab(page, 'Заявки · 7')).toBeVisible({ timeout: 15_000 });
    await devScenario(page, { scenario: 'listSupplyRequests=rate_limited' });
    await page.reload();
    await expect(
      page.getByText(
        'Не удалось загрузить снабжение: Слишком много запросов. Подождите и повторите.',
      ),
    ).toBeVisible({ timeout: 15_000 });
    await devScenario(page, { scenario: null });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(tab(page, 'Заявки · 7')).toBeVisible();
  });

  test('прораб: нет доступа к разделу; нет связи — тост и заявка остаётся; только чтение', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, 'repair-supply', { persona: 'foreman' });
    await expect(page.getByText('Нет доступа к разделу «Ремонт и стройка»')).toBeVisible();
    await openRepair(app, page, 'repair-supply');
    await devScenario(page, { scenario: 'reserveSupplyRequest=offline' });
    const issue = requestRow(page, 'З-21').getByRole('button', { name: /^Выдать со склада/ });
    await issue.click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await devScenario(page, { scenario: null });
    await expect(tab(page, 'Заявки · 7')).toBeVisible();
    await expect(issue).toBeEnabled();
    await openRepair(app, page, 'repair-supply', { presets: ['repairs-ready', 'trial-ended'] });
    await expect(
      requestRow(page, 'З-21').getByRole('button', { name: /^Выдать со склада/ }),
    ).toBeDisabled();
    await expect(requestRow(page, 'З-21').getByRole('checkbox')).toBeDisabled();
  });

  test('клавиатура: Tab до вкладки, стрелки переключают и обновляют ?tab=; фокус виден', async ({
    app,
    page,
  }) => {
    await openRepair(app, page, 'repair-supply');
    const first = tab(page, /^Заявки/);
    await expect(first).toBeVisible();
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await first.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await first.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, /^Закупки/)).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, /^Закупки/)).toBeFocused();
    await expect(page).toHaveURL(/tab=purchases/);
    await page.keyboard.press('End');
    await expect(tab(page, 'Движения')).toBeFocused();
    await page.keyboard.press('Home');
    await expect(tab(page, /^Заявки/)).toHaveAttribute('aria-selected', 'true');
  });

  test('1440 — боковая панель, 390 — нижняя навигация; цели ≥ 44 px, без горизонтальной прокрутки; axe без serious', async ({
    app,
    page,
    axe,
  }) => {
    await openRepair(app, page, 'repair-supply');
    await expect(tab(page, 'Заявки · 7')).toBeVisible();
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeHidden();
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeHidden();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
    if (phone(page)) {
      for (const target of [
        tab(page, 'Остатки'),
        page.getByRole('button', { name: 'Собрать закупку', exact: true }),
        requestRow(page, 'З-21').getByRole('button', { name: /^Выдать со склада/ }),
        requestRow(page, 'З-21').locator('label.ox-rps-check'),
      ]) {
        expect(await hitHeight(target)).toBeGreaterThanOrEqual(44);
      }
    }
    await call(page, 'GET', '/api/v1/me/context');
  });
});

// Стенд: backend снабжения (W6.13) и модуль «Склад» (W5.10) в main. Объект и заявка создаются командами API из сессии
// владельца (repair.stand.ts, createSupplyRequest); страница читает настоящий backend.
test.describe('repair-supply — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test.setTimeout(180_000);

  /** Объект со своей заявкой на первый материал справочника; страница «Снабжение» по прямому URL. */
  async function openWithRequest(
    app: Parameters<Parameters<typeof test>[2]>[0]['app'],
    page: Page,
    project: string,
    search = '',
  ): Promise<{ tenant: string; name: string; material: string }> {
    await app('/', { persona: 'owner' });
    const tenant = await tenantId(page);
    const obj = await repairObject(page, tenant, project);
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
    await app(`/t/${tenant}/repair-supply${search}`, { persona: 'owner' });
    await expect(h1(page, H1)).toBeVisible({ timeout: 30_000 });
    return { tenant, name: obj.name, material: material.name };
  }

  test('владелец на стенде: заявка объекта видна в «Заявках» с материалом и сроком', async ({
    app,
    page,
  }, testInfo) => {
    const { name, material } = await openWithRequest(app, page, testInfo.project.name);
    const row = page.locator('tr, .ox-rps-row').filter({ hasText: name }).first();
    await expect(row).toContainText(material, { timeout: 30_000 });
    await expect(row).toContainText('15.01');
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('владелец на стенде: заявки в закупку — «Собрать закупку», «Оформить закупку», вкладка «Закупки»', async ({
    app,
    page,
  }, testInfo) => {
    const { name } = await openWithRequest(app, page, testInfo.project.name);
    const row = page.locator('tr').filter({ hasText: name }).first();
    await row.getByRole('checkbox').check();
    await page.getByRole('button', { name: /^Собрать закупку/ }).click();
    await page.getByRole('button', { name: 'Оформить закупку' }).click();
    await expect(note(page)).toContainText(/^Закупка .+ у «.+»: 1 позиция для 1 объекта\./, {
      timeout: 30_000,
    });
    await tab(page, /^Закупки/).click();
    await expect(page.getByRole('button', { name: 'Получено' }).first()).toBeVisible();
  });

  test('владелец на стенде: «Остатки» и «Движения» читают модуль «Склад»', async ({
    app,
    page,
  }, testInfo) => {
    await openWithRequest(app, page, testInfo.project.name, '?tab=stock');
    await expect(page.getByRole('heading', { level: 3, name: 'Остатки на объектах' })).toBeVisible({
      timeout: 30_000,
    });
    await tab(page, 'Движения').click();
    await expect(page).toHaveURL(/tab=movements/);
    await expect(
      page.getByText(/Движения не редактируются: ошибка исправляется обратным движением/),
    ).toBeVisible({ timeout: 30_000 });
  });
});
