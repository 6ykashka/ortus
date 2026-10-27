// W5.33 · e2e страницы `cash-self` «Мой подотчёт» (эталон design-2026-10-19, `Касса.dc.html` selfVM :802–818,
// разметка :289–317, диалоги :449–465, :906–920; cash.md §1.4 «Мой подотчёт»): карточка остатка, «Добавить чек»,
// QR, «Переснять», «Вернуть остаток», прораб в том же макете, нет доступа, 390 и 1440, клавиатура, axe.
import type { Page } from '@playwright/test';

import { expect, test } from './_stand/fixtures.ts';
import { chooseReceiptPhoto, grantAdvanceSelf, openCashSelf } from './cash-self.helpers.ts';
import { dialog, h1, hitHeight, noHorizontalScroll, toast } from './modules.helpers.ts';
import { call } from './shell.helpers.ts';

const phone = (page: Page): boolean => (page.viewportSize()?.width ?? 0) < 640;
const cashSelfCard = (page: Page) => page.locator('.ox-cs-card');
const rows = (page: Page) => page.locator('.ox-cs-receipt');
const titles = (page: Page) => page.locator('.ox-cs-receipt-title');

/** Завершает проверку загруженных файлов сценарного сервера, пока `ready` не станет видимым. */
async function scanUntil(page: Page, ready: ReturnType<Page['getByText']>): Promise<void> {
  await expect(async () => {
    await call(page, 'POST', '/api/v1/dev/scenario', { body: { scanFiles: true } });
    await expect(ready).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 15_000 });
}

test.describe('cash-self — «Мой подотчёт» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');
  test.describe.configure({ timeout: 90_000 });

  test('меню «Подотчёт» и прямой URL: заголовок, пояснение, карточка остатка', async ({
    app,
    page,
  }) => {
    const id = await grantAdvanceSelf(app, page);
    await app(`/t/${id}/today`, { persona: 'driver' });
    const nav = phone(page)
      ? page.getByRole('navigation', { name: 'Навигация', exact: true })
      : page.getByRole('navigation', { name: 'Основная навигация' });
    await nav.getByRole('button', { name: 'Подотчёт' }).click();
    await expect(page).toHaveURL(/\/cash-self$/);
    await expect(h1(page, 'Мой подотчёт')).toBeVisible();
    await expect(page.getByText('Деньги на руках, отчёт чеками и возврат остатка')).toBeVisible();
    await expect(cashSelfCard(page).getByText('Подотчёт · на руках')).toBeVisible();
    await expect(page.locator('.ox-cs-bal')).toHaveText(/^4\s450\s₽$/);
    await expect(page.locator('.ox-cs-line')).toHaveText(
      /^Выдано 10\s000\s₽ · 28\.09 · отчитались на 5\s550\s₽$/,
    );
    await expect(titles(page)).toHaveText([
      /^Парковка · Рейс Р-203 · 400\s₽$/,
      /^Мойка · Рейс Р-203 · 600\s₽$/,
      /^Топливо · Рейс Р-201 · 3\s050\s₽$/,
      /^Топливо · Рейс Р-196 · 2\s500\s₽$/,
    ]);
    await expect(page.locator('.ox-cs-receipt-status')).toHaveText([
      'Не принят: Не видна сумма на фото — переснимите чек',
      'На проверке',
      'Принят',
      'Принят',
    ]);
    await page.reload();
    await expect(h1(page, 'Мой подотчёт')).toBeVisible();
  });

  test('«Добавить чек»: фото, сумма, статья → «Чек отправлен на проверку», строка «На проверке»', async ({
    app,
    page,
  }) => {
    await openCashSelf(app, page);
    await page.getByRole('button', { name: 'Добавить чек' }).click();
    const dlg = dialog(page);
    await expect(dlg.getByRole('heading', { name: 'Добавить чек' })).toBeVisible();
    await expect(dlg.getByText(/^На руках 4\s450\s₽$/)).toBeVisible();
    await dlg.getByRole('button', { name: 'Отправить на проверку' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Сумма: укажите число больше нуля');
    await dlg.getByLabel('Сумма, ₽').fill('1 260');
    await dlg.getByRole('button', { name: 'Отправить на проверку' }).click();
    await expect(dlg.getByRole('alert')).toContainText('Сфотографируйте чек');
    await chooseReceiptPhoto(
      page,
      dlg.getByRole('button', { name: /Сфотографировать чек|Загружаем фото…/ }),
    );
    await scanUntil(page, dlg.getByText('Фото чека добавлено'));
    await dlg.getByLabel('Статья').selectOption({ label: 'Топливо' });
    await dlg.getByLabel('К чему относится').fill('Р-208');
    await dlg.getByRole('button', { name: 'Отправить на проверку' }).click();
    await expect(toast(page)).toHaveText('Чек отправлен на проверку');
    await expect(dlg).toBeHidden();
    await expect(titles(page).first()).toHaveText(/^Топливо · Р-208 · 1\s260\s₽$/);
    await expect(page.locator('.ox-cs-receipt-status').first()).toHaveText('На проверке');
  });

  test('QR чека подставляет сумму из s=; снимок QR — фото чека', async ({ app, page }) => {
    await page.addInitScript(() => {
      class Detector {
        detect(): Promise<{ rawValue: string }[]> {
          return Promise.resolve([
            { rawValue: 't=20261001T1304&s=1260.00&fn=9960&i=1234&fp=5678&n=1' },
          ]);
        }
      }
      Object.assign(window, {
        BarcodeDetector: Detector,
        createImageBitmap: () => Promise.resolve({ close: () => undefined }),
      });
    });
    await openCashSelf(app, page);
    await page.getByRole('button', { name: 'Добавить чек' }).click();
    const dlg = dialog(page);
    await chooseReceiptPhoto(page, dlg.getByRole('button', { name: 'Сканировать QR чека' }));
    await expect(dlg.getByText('QR прочитан')).toBeVisible();
    await expect(dlg.getByLabel('Сумма, ₽')).toHaveValue('1260');
    await scanUntil(page, dlg.getByText('Фото чека добавлено'));
    await expect(
      dlg.getByText(/^Из QR взяты сумма, дата и номер чека — проверьте статью\./),
    ).toBeVisible();
  });

  test('QR не распознан: подсказка, сумма вводится вручную', async ({ app, page }) => {
    await openCashSelf(app, page);
    await page.getByRole('button', { name: 'Добавить чек' }).click();
    const dlg = dialog(page);
    await chooseReceiptPhoto(page, dlg.getByRole('button', { name: 'Сканировать QR чека' }));
    await expect(dlg.getByRole('alert')).toContainText('QR не распознан. Введите сумму вручную.');
  });

  test('отклонённый чек: «Не принят: …» и «Переснять» с данными чека', async ({ app, page }) => {
    await openCashSelf(app, page);
    const redo = page.getByRole('button', { name: 'Переснять' });
    await expect(redo).toHaveCount(1);
    await redo.click();
    const dlg = dialog(page);
    await expect(dlg.getByRole('heading', { name: 'Переснять чек' })).toBeVisible();
    await expect(dlg.getByLabel('Сумма, ₽')).toHaveValue('400');
    await expect(dlg.getByLabel('Статья')).toHaveValue('parking');
    await expect(dlg.getByLabel('К чему относится')).toHaveValue('Рейс Р-203');
    await dlg.getByRole('button', { name: 'Отменить' }).click();
    await expect(dlg).toBeHidden();
  });

  test('«Вернуть остаток» → «Возврат отправлен: ждёт приёма», в пути, остаток 0', async ({
    app,
    page,
  }) => {
    await openCashSelf(app, page);
    await page.getByRole('button', { name: /^Вернуть остаток 4\s450\s₽$/ }).click();
    const dlg = dialog(page);
    await expect(dlg.getByRole('heading', { name: 'Вернуть остаток' })).toBeVisible();
    await expect(dlg.getByLabel('Сумма, ₽')).toHaveValue('4450');
    await dlg.getByLabel('Сумма, ₽').fill('9999');
    await dlg.getByRole('button', { name: 'Вернуть' }).click();
    await expect(dlg.getByRole('alert')).toContainText(/На руках меньше: 4\s450\s₽/);
    await dlg.getByLabel('Сумма, ₽').fill('4450');
    await dlg.getByRole('button', { name: 'Вернуть' }).click();
    await expect(toast(page)).toHaveText('Возврат отправлен: ждёт приёма');
    await expect(page.locator('.ox-cs-move')).toHaveText(/Возврат 4\s450\s₽ ждёт приёма/);
    await expect(page.locator('.ox-cs-bal')).toHaveText(/^0\s₽$/);
    await expect(page.getByText('Отчитались полностью')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Вернуть остаток/ })).toHaveCount(0);
  });

  test('прораб: тот же макет «Мой подотчёт», свой подотчёт', async ({ app, page }) => {
    await openCashSelf(app, page, 'foreman');
    await expect(h1(page, 'Мой подотчёт')).toBeVisible();
    await expect(page.locator('.ox-cs-bal')).toHaveText(/^11\s270\s₽$/);
    await expect(page.locator('.ox-cs-line')).toHaveText(
      /^Выдано 30\s000\s₽ · 30\.09 · отчитались на 18\s730\s₽$/,
    );
    await expect(titles(page)).toHaveText([
      /^Материалы · Закупка З-14 · ЖК Речной, кв\. 42 · 18\s730\s₽$/,
    ]);
    await expect(rows(page)).toHaveCount(1);
  });

  test('нет права на подотчёт: «Кассы недоступны…»', async ({ app, page }) => {
    await app('/', { persona: 'driver' });
    const id = await page.evaluate(() => /\/t\/([^/]+)/.exec(location.pathname)?.[1] ?? '');
    await app(`/t/${id}/cash-self`, { persona: 'driver' });
    await expect(h1(page, 'Касса')).toBeVisible();
    await expect(page.getByText('Кассы вашей области')).toBeVisible();
    await expect(
      page.getByText(
        'Кассы недоступны: в ваших ролях нет модуля «Касса» или в вашей области ещё нет касс. Доступ выдаёт владелец в «Пользователях и ролях».',
      ),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Добавить чек' })).toHaveCount(0);
  });

  test('клавиатура, axe, 390: без горизонтальной прокрутки, цели ≥ 44 px', async ({
    app,
    page,
    axe,
  }) => {
    await openCashSelf(app, page);
    await expect(page.locator('.ox-cs-bal')).toBeVisible();
    const add = page.getByRole('button', { name: 'Добавить чек' });
    await add.focus();
    await page.keyboard.press('Enter');
    const dlg = dialog(page);
    await expect(dlg.getByRole('heading', { name: 'Добавить чек' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(add).toBeFocused();
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious).toEqual([]);
    expect(await noHorizontalScroll(page)).toBe(true);
    if (phone(page)) {
      for (const btn of [
        add,
        page.getByRole('button', { name: /^Вернуть остаток/ }),
        page.getByRole('button', { name: 'Переснять' }),
      ]) {
        expect(await hitHeight(btn)).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

// Backend кассы (W5.31 плана v2: `internal/modules/cash`) в main не влит — на стенде ни одной операции кассы нет.
// Проверка на стенде после него: выдача под отчёт владельцем → чек водителя (фото в Files) → решение выдающим →
// возврат остатка и приём. @stand-spec: причина — отсутствие backend, не страницы.
test.describe('cash-self — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');

  test.fixme('держатель подотчёта на стенде: чек, проверка выдающим, возврат остатка', async () => {});
});
