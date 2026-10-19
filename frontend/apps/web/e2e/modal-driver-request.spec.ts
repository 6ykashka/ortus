// W2.23 · e2e диалога `modal-driver-request` «Запросить водителя» (S2-14; эталон design-stage-2 · Ортус CRM.dc.html
// модалка request :2290–2298, modalVM :4026–4028, saveRequest :2816–2820; чек-лист 03-logistics.md §14 п. 15).
// Срок — пересечение окна рейса и свободного окна водителя (Q-W2.51-10); комментарий пуст — reason «Запрос на рейс
// {номер}» (Q-W2.00-3); тост без «· уведомления в демо не отправляются» (PD-54).
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import {
  apiRequest,
  driverCard,
  OFFLINE,
  openPool,
  phone,
  POOL_H1,
} from './logistics-pool.helpers.ts';
import { poolStand } from './logistics-pool.stand.ts';
import { realClock } from './logistics.stand.ts';
import { h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { call, devScenario } from './shell.helpers.ts';

const NOTE =
  'После одобрения создаётся временное назначение только на этот рейс. История и начисления водителя остаются в его фирме.';

const open = async (page: Page, code = 'Водитель #104', trip = 'Р-211') => {
  await driverCard(page, code)
    .getByRole('button', { name: `Запросить на рейс ${trip}` })
    .click();
  const dlg = page.getByRole('dialog');
  await expect(dlg).toBeVisible();
  return dlg;
};

/** Значение строки `<dl>` диалога по термину. */
const value = (dlg: ReturnType<Page['getByRole']>, term: string) =>
  dlg.locator('dt', { hasText: new RegExp(`^${term}$`) }).locator('xpath=following-sibling::dd[1]');

interface TransferLike {
  reason?: string;
  tripNumber?: string;
  driverDisplayName?: string;
  window: { startsAt: string; endsAt: string };
}

const outgoing = async (page: Page, tenant: string): Promise<TransferLike[]> =>
  (
    (
      await call(
        page,
        'GET',
        `/api/v1/tenants/${tenant}/fleet/driver-transfer-requests?direction=outgoing&limit=200`,
      )
    ).body as { items: TransferLike[] }
  ).items;

test.describe('modal-driver-request — «Запросить водителя» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'сценарии и пресеты — сценарный сервер mock');
  test.setTimeout(90_000);

  test('поля эталона (п. 15): водитель, рейс, срок, согласует, комментарий, пояснение, кнопки', async ({
    app,
    page,
  }) => {
    await openPool(app, page);
    const dlg = await open(page);
    await expect(dlg.getByRole('heading', { name: 'Запросить водителя' })).toBeVisible();
    await expect(dlg).toContainText('Водитель #104 · Юг Транс');
    await expect(value(dlg, 'Рейс')).toHaveText('Р-211 · Охлаждённая продукция · 14:00–18:00');
    await expect(value(dlg, 'Срок')).toHaveText('Временно, до 18:00 01.10');
    await expect(value(dlg, 'Согласует')).toHaveText('Менеджер фирмы Юг Транс');
    const comment = dlg.getByLabel('Комментарий для фирмы-владельца');
    await expect(comment).toHaveAttribute('placeholder', 'Необязательно');
    await expect(dlg).toContainText(NOTE);
    await expect(dlg.getByRole('button', { name: 'Отмена' })).toBeVisible();
    await expect(dlg.getByRole('button', { name: 'Отправить запрос' })).toBeEnabled();
  });

  test('Водитель #117 свободен с 15:00: срок — «Временно, с 15:00 до 18:00 01.10» (Q-W2.51-10)', async ({
    app,
    page,
  }) => {
    const alta = await openPool(app, page);
    const dlg = await open(page, 'Водитель #117');
    await expect(value(dlg, 'Срок')).toHaveText('Временно, с 15:00 до 18:00 01.10');
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText('Запрос отправлен фирме Восток Карго');
    const [x] = await outgoing(page, alta);
    expect(x?.window).toMatchObject({
      startsAt: '2026-10-01T12:00:00Z',
      endsAt: '2026-10-01T15:00:00Z',
    });
  });

  test('«Отправить запрос» с комментарием: тост, диалог закрыт, чип «Запрос отправлен», reason — комментарий', async ({
    app,
    page,
  }) => {
    const alta = await openPool(app, page);
    const dlg = await open(page);
    await dlg.getByLabel('Комментарий для фирмы-владельца').fill('Нужен рефрижератор до 18:00');
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText('Запрос отправлен фирме Юг Транс');
    await expect(dlg).toBeHidden();
    await expect(driverCard(page, 'Водитель #104').locator('.ox-pl-chip')).toContainText(
      'Запрос отправлен',
    );
    const [x] = await outgoing(page, alta);
    expect(x).toMatchObject({
      reason: 'Нужен рефрижератор до 18:00',
      tripNumber: 'Р-211',
      driverDisplayName: 'Водитель #104',
    });
  });

  test('без комментария — reason «Запрос на рейс Р-211» (Q-W2.00-3)', async ({ app, page }) => {
    const alta = await openPool(app, page);
    const dlg = await open(page);
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText('Запрос отправлен фирме Юг Транс');
    const [x] = await outgoing(page, alta);
    expect(x?.reason).toBe('Запрос на рейс Р-211');
  });

  test('запрос уже отправлен (409): сообщение сервера в диалоге, список перечитан', async ({
    app,
    page,
  }) => {
    const alta = await openPool(app, page);
    const dlg = await open(page);
    // Другой логист «за спиной» экрана отправил запрос на того же водителя.
    await apiRequest(page, alta);
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Запрос уже отправлен');
    await dlg.getByRole('button', { name: 'Отмена' }).click();
    await expect(dlg).toBeHidden();
    await expect(driverCard(page, 'Водитель #104').locator('.ox-pl-chip')).toContainText(
      'Запрос отправлен',
    );
  });

  test('нет связи: тост «нет связи», диалог остаётся открытым', async ({ app, page }) => {
    await openPool(app, page);
    const dlg = await open(page);
    await devScenario(page, { scenario: 'requestDriverTransfer=offline' });
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText(OFFLINE);
    await expect(dlg).toBeVisible();
    await devScenario(page, { scenario: null });
    await expect(dlg.getByRole('button', { name: 'Отправить запрос' })).toBeEnabled();
  });

  test('«Отмена» и Escape закрывают диалог, фокус возвращается; axe в диалоге без serious', async ({
    app,
    page,
    axe,
  }) => {
    await openPool(app, page);
    const btn = driverCard(page, 'Водитель #104').getByRole('button', {
      name: 'Запросить на рейс Р-211',
    });
    let dlg = await open(page);
    await dlg.getByRole('button', { name: 'Отмена' }).click();
    await expect(dlg).toBeHidden();
    await btn.focus();
    await page.keyboard.press('Enter');
    dlg = page.getByRole('dialog');
    await expect(dlg).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))
      .toBe(true);
    const bad = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(bad.map((v) => v.id)).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(btn).toBeFocused();
  });

  test('390: лист снизу, кнопки ≥ 44 px, без горизонтальной прокрутки', async ({ app, page }) => {
    test.skip(!phone(page), 'только телефон');
    await openPool(app, page);
    const dlg = await open(page);
    for (const name of ['Отмена', 'Отправить запрос']) {
      expect(await hitHeight(dlg.getByRole('button', { name }))).toBeGreaterThanOrEqual(44);
    }
    const box = await dlg.boundingBox();
    const vh = page.viewportSize()?.height ?? 0;
    expect(Math.round((box?.y ?? 0) + (box?.height ?? 0))).toBeGreaterThanOrEqual(vh - 1);
    expect(await noHorizontalScroll(page)).toBe(true);
  });
});

test.describe('modal-driver-request — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test('владелец на стенде: поля диалога и запрос requestDriverTransfer стенда', async ({
    app,
    page,
    session,
    undo,
  }, testInfo) => {
    test.setTimeout(180_000);
    await realClock(page);
    const s = await poolStand(session, undo, testInfo.project.name);
    await app(`/t/${s.tenant}/pool?trip=${s.trip.id}`, { persona: 'owner' });
    await expect(h1(page, POOL_H1)).toBeVisible({ timeout: 15_000 });
    const dlg = await open(page, s.code, s.trip.number);
    await expect(dlg.getByRole('heading', { name: 'Запросить водителя' })).toBeVisible();
    await expect(dlg).toContainText(`${s.code} · Север Логистик`);
    await expect(value(dlg, 'Рейс')).toContainText(`${s.trip.number} · Пул `);
    await expect(value(dlg, 'Срок')).toHaveText(/^Временно, до \d\d:\d\d \d\d\.\d\d$/);
    await expect(value(dlg, 'Согласует')).toHaveText('Менеджер фирмы Север Логистик');
    await dlg.getByLabel('Комментарий для фирмы-владельца').fill('Стенд-e2e W2.23');
    await dlg.getByRole('button', { name: 'Отправить запрос' }).click();
    await expect(toast(page)).toHaveText('Запрос отправлен фирме Север Логистик', {
      timeout: 15_000,
    });
    await expect(dlg).toBeHidden();
    const mine = (await outgoing(page, s.tenant)).find((x) => x.tripNumber === s.trip.number);
    expect(mine?.reason).toBe('Стенд-e2e W2.23');
  });
});
