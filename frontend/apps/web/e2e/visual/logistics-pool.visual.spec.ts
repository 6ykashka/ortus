// W2.23 · Визуальная сверка `logistics-pool` «Ресурсный пул» со снимком design-stage-2 (verification-protocol.md §3,
// порог 0,01). Предмет — основная область; шапку и меню сверяет ключ `shell` (маска). Персонаж — владелец: на эталоне
// «Логистика» изначально не подключена — владелец подключает её в «Модули и место» (шаг 1 «Пути проверки»), затем
// открывает «Ресурсный пул» из меню (Водитель #104 и #117 «Свободен», «Запросить на рейс Р-211»). Логист Котова на
// эталоне без роли — её экран сверяют e2e по подписям. Тост подключения модуля эталона закрывается до снимка.
// Отличия — allowlist/logistics-pool.md.
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { driverCard, openPool, POOL_H1 } from '../logistics-pool.helpers.ts';
import { connectLogisticsOnReference } from './logistics-pool.compare.ts';
import { openOnReference } from './modules.compare.ts';
import { compareShots } from './shell.compare.ts';

const CHROME = ['header', 'nav'];

test('logistics-pool: «Ресурсный пул» владельца, два свободных водителя, в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  test.slow();
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await connectLogisticsOnReference(ref.page);
  await openOnReference(ref.page, POOL_H1, 'Пул');
  await ref.page.getByText('Модуль «Логистика» подключён').waitFor({ state: 'detached' });
  const alta = await openPool(app, page, { persona: 'owner', route: 'home' });
  const impl = await app(`/t/${alta}/pool`, { persona: 'owner' });
  await driverCard(page, 'Водитель #117').getByRole('button').waitFor();
  await page.waitForLoadState('networkidle');
  const r = await compareShots(
    { target: impl, mask: CHROME.map((s) => page.locator(s)) },
    { target: ref, mask: CHROME.map((s) => ref.page.locator(s)) },
    `logistics-pool-owner-${testInfo.project.name}`,
    testInfo,
  );
  console.log(
    `visual logistics-pool owner ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`,
  );
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
});

/** Начертание диалога: кнопки, поле комментария, заголовок (вычисленные стили). */
async function dialogType(page: Page): Promise<Record<string, Record<string, string>>> {
  const d = page.getByRole('dialog');
  const css = (l: Locator, props: string[]) =>
    l.evaluate((el, ps) => {
      const s = getComputedStyle(el);
      return Object.fromEntries(ps.map((k) => [k, s.getPropertyValue(k)]));
    }, props);
  const font = ['font-size', 'font-weight'];
  return {
    cancel: await css(d.getByRole('button', { name: 'Отмена', exact: true }), font),
    submit: await css(d.getByRole('button', { name: 'Отправить запрос' }), font),
    textarea: await css(d.locator('textarea'), font),
    title: await css(d.getByRole('heading', { name: 'Запросить водителя' }), [
      ...font,
      'line-height',
    ]),
  };
}

test('modal-driver-request: начертание кнопок, поля и заголовка — как у эталона @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'сверка со снимком эталона — режим mock');
  test.slow();
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await connectLogisticsOnReference(ref.page);
  await openOnReference(ref.page, POOL_H1, 'Пул');
  await ref.page.getByRole('button', { name: 'Запросить на рейс Р-211' }).first().click();
  await ref.page.getByRole('dialog').waitFor();
  const alta = await openPool(app, page, { persona: 'owner', route: 'home' });
  await app(`/t/${alta}/pool`, { persona: 'owner' });
  await driverCard(page, 'Водитель #104').getByRole('button').click();
  await page.getByRole('dialog').waitFor();
  expect(await dialogType(page)).toEqual(await dialogType(ref.page));
});

test('modal-driver-request: диалог «Запросить водителя» Водителя #104 на Р-211, в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  test.slow();
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  await connectLogisticsOnReference(ref.page);
  await openOnReference(ref.page, POOL_H1, 'Пул');
  await ref.page.getByText('Модуль «Логистика» подключён').waitFor({ state: 'detached' });
  await ref.page.getByRole('button', { name: 'Запросить на рейс Р-211' }).first().click();
  await ref.page.getByRole('dialog').waitFor();
  const alta = await openPool(app, page, { persona: 'owner', route: 'home' });
  const impl = await app(`/t/${alta}/pool`, { persona: 'owner' });
  await driverCard(page, 'Водитель #104').getByRole('button').click();
  await page.getByRole('dialog').waitFor();
  await page.waitForLoadState('networkidle');
  // Курсор и фокус: каретка поля и кольцо фокуса не входят в сверку.
  for (const p of [page, ref.page])
    await p.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const r = await compareShots(
    { target: impl, mask: CHROME.map((s) => page.locator(s)) },
    { target: ref, mask: CHROME.map((s) => ref.page.locator(s)) },
    `modal-driver-request-owner-${testInfo.project.name}`,
    testInfo,
  );
  console.log(
    `visual modal-driver-request owner ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`,
  );
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
});
