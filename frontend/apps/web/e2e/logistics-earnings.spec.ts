// W2.21 · e2e страницы `logistics-earnings` «Начисления водителям» (S2-12, AC-05; no-reference, 14-stage2-dor.md §4:
// пусто, есть начисления, нет права). Начисление создаёт приёмка смены (Q-55); водителю — никогда (D-10).
// Обязательные пункты verification-protocol §1.3 и брифа §1 п. 7: загрузка, ошибка, нет связи, только чтение,
// клавиатура, раскладка 390 / 1440, крошка владельца.
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { driverShift, phone } from './logistics-review.helpers.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { call, devScenario, tenantId } from './shell.helpers.ts';

const H1 = 'Начисления водителям';
const OFFLINE = 'Нет связи с сервером. Операция не выполнена.';
const nb = (s: string): string => s.replace(/(\d) (\d{3})/g, '$1\u00a0$2');

const row = (page: Page, trip = 'Р-208') => page.getByRole('listitem').filter({ hasText: trip });

/** Смена Р-208 сдана водителем и принята владельцем (reviewTrip approve через API) — начисление 4 500 ₽. */
async function accepted(
  app: Parameters<typeof driverShift>[0],
  page: Page,
): Promise<{ tenant: string }> {
  const { tenant, tripId } = await driverShift(app, page, { expense: false });
  await app('/', { persona: 'owner' });
  const cur = await call(page, 'GET', `/api/v1/tenants/${tenant}/fleet/trip-plans/${tripId}`);
  const r = await call(page, 'POST', `/api/v1/tenants/${tenant}/fleet/trips/${tripId}/review`, {
    body: { decision: 'approve' },
    ifMatch: cur.headers.etag ?? '',
  });
  if (r.status !== 200) throw new Error(`reviewTrip ${r.status}: ${JSON.stringify(r.body)}`);
  return { tenant };
}

test.describe('logistics-earnings — начисления водителям @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('ссылка со «Приёмки смен» и прямой URL; пусто', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await app(`/t/${alta}/review`, { persona: 'owner' });
    await page
      .getByRole('navigation', { name: 'Связанные разделы' })
      .getByRole('button', { name: 'Начисления' })
      .click();
    await expect(page).toHaveURL(/\/earnings$/);
    await expect(h1(page, H1)).toBeVisible();
    await expect(page.getByText('Начислений пока нет')).toBeVisible();
    await page.reload();
    await expect(h1(page, H1)).toBeVisible({ timeout: 15_000 });
  });

  test('после приёмки: строка Р-208 «4 500 ₽», кто и когда, итог', async ({ app, page }) => {
    const { tenant } = await accepted(app, page);
    await app(`/t/${tenant}/earnings`, { persona: 'owner' });
    const r = row(page);
    await expect(r).toContainText('Р-208 · Северный маршрут');
    await expect(r).toContainText('Илья Васильев');
    await expect(r).toContainText(nb('4 500 ₽'));
    await expect(r).toContainText(/Изменено \d\d\.\d\d\.\d{4} в \d\d:\d\d · /);
    await expect(page.locator('.ox-rv-total')).toContainText(`Итого: ${nb('4 500 ₽')}`);
  });

  test('владелец правит сумму: тост, новая сумма', async ({ app, page }) => {
    const { tenant } = await accepted(app, page);
    await app(`/t/${tenant}/earnings`, { persona: 'owner' });
    await row(page).getByRole('button', { name: 'Изменить начисление по рейсу Р-208' }).click();
    const dlg = page.getByRole('dialog', { name: 'Начисление по рейсу Р-208' });
    await dlg.getByLabel('Сумма, ₽').fill('0');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Сумма должна быть больше нуля');
    await dlg.getByLabel('Сумма, ₽').fill('5000');
    await dlg.getByLabel('Как рассчитано').fill('Доплата за выходной');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText('Начисление по рейсу Р-208 изменено');
    await expect(dlg).toBeHidden();
    await expect(row(page)).toContainText(nb('5 000 ₽'));
    await expect(row(page)).toContainText('Доплата за выходной');
  });

  test('фильтр по подразделению', async ({ app, page }) => {
    const { tenant } = await accepted(app, page);
    await app(`/t/${tenant}/earnings`, { persona: 'owner' });
    await expect(row(page)).toBeVisible();
    const select = page.getByLabel('Подразделение');
    await expect(select.locator('option').first()).toHaveText('Все подразделения');
    await select.selectOption({ label: 'Москва / Север Логистик' });
    await expect(page).toHaveURL(/unit=/);
    await expect(row(page)).toContainText(nb('4 500 ₽'));
  });

  test('менеджер без fleet.earnings.manage — без правки; водитель — гейт', async ({
    app,
    page,
  }) => {
    const { tenant } = await accepted(app, page);
    await app(`/t/${tenant}/earnings`, { persona: 'manager' });
    await expect(row(page)).toContainText(nb('4 500 ₽'));
    await expect(row(page).getByRole('button', { name: /Изменить/ })).toHaveCount(0);
    await app(`/t/${tenant}/earnings`, { persona: 'driver' });
    await expect(page.getByText(/Нет роли с доступом/)).toBeVisible();
    await expect(page.getByText(nb('4 500 ₽'))).toHaveCount(0);
  });

  test('ошибка загрузки — «Повторить»', async ({ app, page }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await devScenario(page, { scenario: 'listTripEarnings=rate_limited' });
    await app(`/t/${alta}/earnings`, { persona: 'owner' });
    await expect(page.getByText(/^Не удалось загрузить начисления: /)).toHaveText(
      'Не удалось загрузить начисления: Слишком много запросов. Подождите и повторите.',
    );
    await devScenario(page, { scenario: null });
    await page.getByRole('button', { name: 'Повторить' }).click();
    await expect(page.getByText('Начислений пока нет')).toBeVisible();
  });

  test('крошка владельца; загрузка — скелетон; 1440 — боковая панель, 390 — нижняя навигация', async ({
    app,
    page,
  }) => {
    await app('/', { persona: 'owner' });
    const alta = await tenantId(page);
    await devScenario(page, { preset: 'logistics-ready' });
    await devScenario(page, { scenario: 'listTripEarnings=delay=1500' });
    await app(`/t/${alta}/earnings`, { persona: 'owner' });
    await expect(page.getByRole('main').getByRole('status', { name: 'Загрузка' })).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(page.getByText('Начислений пока нет')).toBeVisible();
    await expect(page.locator('section[aria-labelledby="h-earnings"] .ox-rv-crumb')).toHaveText(
      'Альта Групп · все подразделения',
    );
    if (phone(page)) {
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeHidden();
    } else {
      await expect(page.getByRole('navigation', { name: 'Основная навигация' })).toBeVisible();
      await expect(page.getByRole('navigation', { name: 'Навигация', exact: true })).toBeHidden();
    }
    expect(await noHorizontalScroll(page)).toBe(true);
  });

  test('нет связи: тост «нет связи» при сохранении, диалог открыт, сумма прежняя', async ({
    app,
    page,
  }) => {
    const { tenant } = await accepted(app, page);
    await app(`/t/${tenant}/earnings`, { persona: 'owner' });
    await row(page).getByRole('button', { name: 'Изменить начисление по рейсу Р-208' }).click();
    const dlg = page.getByRole('dialog', { name: 'Начисление по рейсу Р-208' });
    await dlg.getByLabel('Сумма, ₽').fill('5000');
    await devScenario(page, { scenario: 'setTripEarnings=offline' });
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(dlg).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Сохранить' })).toBeEnabled();
    await devScenario(page, { scenario: null });
    await dlg.getByRole('button', { name: 'Отмена' }).click();
    await expect(row(page)).toContainText(nb('4 500 ₽'));
  });

  test('организация только для чтения: правки нет, сумма видна', async ({ app, page }) => {
    const { tenant } = await accepted(app, page);
    await devScenario(page, { preset: 'trial-ended' });
    await app(`/t/${tenant}/earnings`, { persona: 'owner' });
    await expect(row(page)).toContainText(nb('4 500 ₽'));
    await expect(row(page).getByRole('button', { name: /Изменить/ })).toHaveCount(0);
  });

  test('клавиатура: Tab до «Изменить», фокус виден; Escape закрывает диалог, фокус возвращается', async ({
    app,
    page,
    axe,
  }) => {
    const { tenant } = await accepted(app, page);
    await app(`/t/${tenant}/earnings`, { persona: 'owner' });
    const edit = row(page).getByRole('button', { name: 'Изменить начисление по рейсу Р-208' });
    await expect(edit).toBeVisible();
    let reached = false;
    for (let i = 0; i < 60 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await edit.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    expect(await edit.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'Начисление по рейсу Р-208' });
    await expect(dlg).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))
      .toBe(true);
    // axe — в открытом диалоге (до Escape).
    const bad = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(bad.map((v) => v.id)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(edit).toBeFocused();
  });

  test('390: цели не меньше 44 px, без горизонтальной прокрутки; axe без serious', async ({
    app,
    page,
    axe,
  }) => {
    const { tenant } = await accepted(app, page);
    await app(`/t/${tenant}/earnings`, { persona: 'owner' });
    await expect(row(page)).toBeVisible();
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious.map((v) => v.id)).toEqual([]);
    if (!phone(page)) return;
    expect(
      await hitHeight(
        row(page).getByRole('button', { name: 'Изменить начисление по рейсу Р-208' }),
      ),
    ).toBeGreaterThanOrEqual(44);
    expect(await hitHeight(page.getByLabel('Подразделение'))).toBeGreaterThanOrEqual(44);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

test.describe('logistics-earnings — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  test('владелец на стенде видит начисление после приёмки', () => {
    test.fixme(
      true,
      'backend начислений и приёмки (listTripEarnings, setTripEarnings, reviewTrip — W2.06, modules/finance) не в main: на стенде — 501',
    );
  });
});
