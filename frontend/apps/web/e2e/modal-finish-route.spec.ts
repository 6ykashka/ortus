// W2.22 · e2e диалога `modal-finish-route` «Завершить рейс {номер}?» (эталон design-stage-2, confirm :2179–2201,
// finishRoute :2586–2596; 03-logistics.md §8.6, §14 п. 38): заголовок, текст, «Внимание» при неотмеченных точках,
// «Отмена», Escape и подложка, фокус, подтверждение, отказ команды, 390, axe.
import { actionBar, depart, finishDialog, openDriver } from './driver.helpers.ts';
import { expect, test } from './fixtures/index.ts';
import { toast } from './modules.helpers.ts';
import { devScenario } from './shell.helpers.ts';

test.describe('modal-finish-route — «Завершить рейс» @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');
  // Путь с пятью загрузками и проверкой файлов — дольше 30 с под нагрузкой общего ПК.
  test.describe.configure({ timeout: 90_000 });

  test.beforeEach(async ({ app, page }) => {
    await openDriver(app, page, 'today');
    await depart(page);
  });

  const open = async (page: import('@playwright/test').Page) => {
    await actionBar(page).getByRole('button', { name: 'Завершить рейс' }).click();
    const dlg = finishDialog(page);
    await expect(dlg).toBeVisible();
    return dlg;
  };

  test('1 из 3 точек: заголовок, текст, «Внимание»; «Отмена» закрывает', async ({ page }) => {
    await page.getByRole('button', { name: 'Прибыл' }).first().click();
    const dlg = await open(page);
    await expect(dlg.getByRole('heading', { name: 'Завершить рейс Р-208?' })).toBeVisible();
    await expect(dlg).toContainText(
      'Дальше — осмотр при сдаче: 5 фото, пробег, топливо и чек-лист.',
    );
    await expect(dlg).toContainText('Внимание');
    await expect(dlg).toContainText('Отмечено точек: 1 из 3. Убедитесь, что доставка выполнена.');
    await dlg.getByRole('button', { name: 'Отмена' }).click();
    await expect(dlg).toBeHidden();
  });

  test('все точки отмечены: раздела «Внимание» нет', async ({ page }) => {
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Прибыл' }).first().click();
    await expect(page.getByText('Отмечено 3 из 3')).toBeVisible();
    const dlg = await open(page);
    await expect(dlg).not.toContainText('Внимание');
  });

  test('Escape закрывает, фокус возвращается на «Завершить рейс»; подложка закрывает', async ({
    page,
  }) => {
    const opener = actionBar(page).getByRole('button', { name: 'Завершить рейс' });
    await opener.focus();
    await page.keyboard.press('Enter');
    const dlg = finishDialog(page);
    await expect(dlg).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
    await expect(opener).toBeFocused();
    await open(page);
    await page.locator('.ox-backdrop').click({ position: { x: 5, y: 5 } });
    await expect(dlg).toBeHidden();
  });

  test('подтверждение: тост, «Осмотр при сдаче», чек-лист сдачи, «Сдать машину»', async ({
    page,
  }) => {
    const dlg = await open(page);
    await dlg.getByRole('button', { name: 'Завершить рейс' }).click();
    await expect(toast(page)).toHaveText('Рейс завершён. Заполните осмотр при сдаче');
    await expect(dlg).toBeHidden();
    await expect(page.getByRole('heading', { level: 2, name: 'Осмотр при сдаче' })).toBeVisible();
    await expect(page.getByLabel('Груз выгружен полностью')).toBeVisible();
    await expect(actionBar(page).getByRole('button', { name: 'Сдать машину' })).toBeDisabled();
  });

  test('отказ команды: тост, диалог открыт', async ({ page }) => {
    await devScenario(page, { scenario: 'finishTripRoute=offline', once: true });
    const dlg = await open(page);
    await dlg.getByRole('button', { name: 'Завершить рейс' }).click();
    await expect(toast(page)).toHaveText('Нет связи с сервером. Операция не выполнена.');
    await expect(dlg).toBeVisible();
    await dlg.getByRole('button', { name: 'Завершить рейс' }).click();
    await expect(page.getByRole('heading', { level: 2, name: 'Осмотр при сдаче' })).toBeVisible();
  });

  test('390: лист снизу, axe без serious/critical', async ({ page, axe }) => {
    const dlg = await open(page);
    const serious = (await axe(page)).violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    expect(serious).toEqual([]);
    const width = page.viewportSize()?.width ?? 0;
    if (width < 640) {
      const box = await dlg.boundingBox();
      const vh = page.viewportSize()?.height ?? 0;
      expect(box && Math.round(box.y + box.height)).toBeGreaterThanOrEqual(vh - 2);
    }
  });
});

test.describe('modal-finish-route — стенд @stand', () => {
  test.skip(({ harness }) => harness.mode !== 'stand', 'режим stand');
  // Backend рейса (W2.05, finishTripRoute) не в main.
  test.fixme('водитель на стенде завершает рейс', async () => {});
});
