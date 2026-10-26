// W2.87 · e2e `driver-today` под нагрузкой ПК (mock; эталон design-stage-2 pg.today, S2-20 1c): «Моя смена» не держит «Загрузка»,
// пока хранилище устройства (IndexedDB) не отвечает. Нагрузка моделируется как на загруженном ПК: `indexedDB.open` не отвечает
// вовсе (запасное хранилище в памяти включится через 5 с) — рейс обязан появиться раньше, чем истечёт 5 с шага `departOnScreen`
// журни AC-06 (`getByText('{рейс} · {название}')` без `J.SERVER`).
import { expect, test } from './_stand/fixtures.ts';
import { openDriver } from './driver.helpers.ts';
import { h1 } from './modules.helpers.ts';
import { tenantId } from './shell.helpers.ts';

test.describe('driver-today — хранилище устройства не отвечает @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пресеты и сценарии — сценарный сервер mock');

  test('рейс показан за 4 с, без «Загрузка» (шаг 5 с по умолчанию не падает)', async ({
    app,
    page,
  }) => {
    await openDriver(app, page, 'today');
    const id = await tenantId(page);
    await page.addInitScript(() => {
      // Вечный `open`: ни `onsuccess`, ни `onerror` — как первое обращение к IndexedDB под нагрузкой.
      Object.defineProperty(window, 'indexedDB', {
        configurable: true,
        value: { open: () => ({}), cmp: () => 0, databases: () => Promise.resolve([]) },
      });
    });
    await app(`/t/${id}/today`, { persona: 'driver' });
    await expect(h1(page, 'Моя смена')).toBeVisible();
    const started = Date.now();
    await expect(page.getByText('Р-208 · Северный маршрут')).toBeVisible({ timeout: 4_000 });
    expect(Date.now() - started, 'рейс — раньше срока запасного хранилища (5 с)').toBeLessThan(
      4_000,
    );
    await expect(page.getByRole('status', { name: 'Загрузка' })).toHaveCount(0);
  });
});
