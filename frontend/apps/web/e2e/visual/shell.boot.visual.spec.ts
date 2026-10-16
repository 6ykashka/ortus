// W1.20 · Визуальная сверка кадра загрузки `shell` со снимком design-stage-1 (verification-protocol.md §3, PD-22:
// 0,01). Эталон держит кадр загрузки, пока не пришли модули прототипа (boot :2397–2409, VM :2821–2823): запрос
// `ortus/api.js` задерживается маршрутом Playwright, страница перезагружается. Реализация — сценарий
// `getMyContext=loading` сценарного сервера (ответ не приходит). Анимация скелетона снимается в начальном кадре
// (`animations: 'disabled'`) на обеих целях.
import { hidePanel } from '@ortus/e2e-kit';

import { expect, test } from '../fixtures/index.ts';
import { devScenario } from '../shell.helpers.ts';
import { compareShots } from './shell.compare.ts';

const LOADING = { name: 'Загрузка' } as const;

test.describe('shell — кадр загрузки по эталону @mock', () => {
  test.skip(({ harness }) => harness.mode !== 'mock', 'пиксельная сверка — режим mock');

  test('кадр загрузки: шапка, меню и скелетон в допуске 0,01', async ({
    app,
    page,
    reference,
  }, testInfo) => {
    const ref = await reference(undefined, { persona: 'owner' });
    // Модули прототипа не приходят: эталон остаётся в кадре загрузки.
    await ref.page.route('**/ortus/api.js', () => new Promise<void>(() => undefined));
    await ref.page.reload();
    await expect(ref.page.getByRole('status', LOADING)).toBeVisible();
    await hidePanel(ref);
    await ref.page.mouse.move(0, 0);

    const impl = await app('/', { persona: 'owner' });
    await devScenario(page, { scenario: 'getMyContext=loading' });
    await page.reload();
    await expect(page.getByRole('status', LOADING)).toBeVisible();
    await page.mouse.move(0, 0);

    const r = await compareShots(
      { target: impl },
      { target: ref },
      `shell-boot-${testInfo.project.name}`,
      testInfo,
    );
    testInfo.annotations.push({ type: 'ratio', description: String(r.ratio) });
    console.log(`visual shell-boot ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
    expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
  });
});
