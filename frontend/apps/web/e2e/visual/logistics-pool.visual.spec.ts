// W2.23 · Визуальная сверка `logistics-pool` «Ресурсный пул» со снимком design-stage-2 (verification-protocol.md §3,
// порог 0,01). Предмет — основная область; шапку и меню сверяет ключ `shell` (маска). Персонаж — владелец: на эталоне
// «Логистика» изначально не подключена — владелец подключает её в «Модули и место» (шаг 1 «Пути проверки»), затем
// открывает «Ресурсный пул» из меню (Водитель #104 и #117 «Свободен», «Запросить на рейс Р-211»). Логист Котова на
// эталоне без роли — её экран сверяют e2e по подписям. Тост подключения модуля эталона закрывается до снимка.
// Отличия — allowlist/logistics-pool.md. W2.73: диалог «Запросить водителя» сверяется с макетом 1a S2-20 («Временный
// водитель - варианты.dc.html», design-2026-10-19b) — Водитель #104 с обычной машиной Hyundai HD-35 (правка mock).
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../fixtures/index.ts';
import { driverCard, openPool, POOL_H1 } from '../logistics-pool.helpers.ts';
import { patchUsual } from '../logistics-pool-s220.helpers.ts';
import { part, S220_FILE, setProps } from './s220.compare.ts';
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
  // Готовность — по содержимому, а не networkidle (MSW отвечает из воркера, тишина сети не значит конец отрисовки):
  // обе карточки «Свободен», входящих и скелетона нет, шрифты (иконки Material Symbols) загружены.
  await driverCard(page, 'Водитель #117').getByRole('button').waitFor();
  await expect(page.locator('article.ox-pl-driver .ox-pl-chip')).toHaveText([
    /Свободен$/,
    /Свободен$/,
  ]);
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
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

/** Начертание диалога: кнопки, поле комментария, заголовок, варианты «Машина» (вычисленные стили). */
async function dialogType(root: Locator): Promise<Record<string, Record<string, string>>> {
  const css = (l: Locator, props: string[]) =>
    l.evaluate((el, ps) => {
      const s = getComputedStyle(el);
      return Object.fromEntries(ps.map((k) => [k, s.getPropertyValue(k)]));
    }, props);
  const font = ['font-size', 'font-weight'];
  return {
    cancel: await css(root.getByRole('button', { name: 'Отмена', exact: true }), font),
    submit: await css(root.getByRole('button', { name: 'Отправить запрос' }), font),
    textarea: await css(root.locator('textarea'), font),
    title: await css(root.getByRole('heading', { name: 'Запросить водителя' }), font),
    home: await css(
      root.getByRole('radio', { name: 'Едет на своей обычной' }).locator('strong'),
      font,
    ),
    choice: await css(root.getByRole('checkbox'), ['font-size']),
  };
}

/**
 * Реализация: владелец, «Ресурсный пул», диалог Водителя #104 (Олег Тарасов, Hyundai HD-35 «Юг Транс»); `fits=false` —
 * обычная машина без охлаждения (tweak homeCarFits).
 */
async function openDialog(
  app: Parameters<typeof openPool>[0],
  page: Page,
  fits = true,
): Promise<Locator> {
  const alta = await openPool(app, page, { persona: 'owner', route: 'home' });
  await patchUsual(page, alta, fits);
  await app(`/t/${alta}/pool`, { persona: 'owner' });
  await driverCard(page, 'Водитель #104').getByRole('button').click();
  const dlg = page.getByRole('dialog');
  await dlg.waitFor();
  await page.waitForLoadState('networkidle');
  return dlg;
}

test('modal-driver-request: начертание кнопок, поля, заголовка и вариантов — как у макета 1a @mock', async ({
  app,
  page,
  reference,
  harness,
}) => {
  test.skip(harness.mode !== 'mock', 'сверка со снимком эталона — режим mock');
  test.slow();
  const ref = await reference(S220_FILE);
  const dlg = await openDialog(app, page);
  expect(await dialogType(dlg)).toEqual(
    await dialogType(ref.page.locator('[id="1a"] [role="dialog"]')),
  );
});

test('modal-driver-request: диалог 1a «Запросить водителя» с блоком «Машина», в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  // Макет 1a — диалог 600 px на холсте вариантов; на 390 реализация — лист снизу во всю ширину (PD-27, allowlist).
  test.skip((page.viewportSize()?.width ?? 0) < 640, 'макет 1a — диалог 600 px');
  test.slow();
  const ref = await reference(S220_FILE);
  // Диалог 1a выше окна 900 px: окно выше диалога, чтобы в снимок вошла вся модалка без прокрутки. Высота нечётная:
  // модалка по центру получает ту же дробную долю отступа, что блок макета на холсте (снимок — целые пиксели).
  await page.setViewportSize({ width: 1440, height: 1201 });
  const dlg = await openDialog(app, page);
  // Курсор и фокус: каретка поля и кольцо фокуса не входят в сверку.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const r = await compareShots(
    { target: part({ kind: 'app', page, root: dlg, url: page.url() }, dlg) },
    { target: part(ref, ref.page.locator('[id="1a"] [role="dialog"]')) },
    `modal-driver-request-1a-${testInfo.project.name}`,
    testInfo,
  );
  console.log(
    `visual modal-driver-request 1a ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`,
  );
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
});

test('modal-driver-request: 1a «обычная не подходит» + «Едет на своей обычной» — серая «Отправить запрос», в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  test.skip((page.viewportSize()?.width ?? 0) < 640, 'макет 1a — диалог 600 px');
  test.slow();
  const ref = await reference(S220_FILE);
  // Tweaks макета: vehicleMode «Своя машина водителя», homeCarFits=false (renderVals :516–569).
  await setProps(ref.page, { vehicleMode: 'Своя машина водителя', homeCarFits: false });
  await page.setViewportSize({ width: 1440, height: 1201 });
  const dlg = await openDialog(app, page, false);
  await dlg.getByRole('radio', { name: 'Едет на своей обычной' }).click();
  await expect(dlg.getByRole('button', { name: 'Отправить запрос' })).toBeDisabled();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.mouse.move(0, 0);
  const r = await compareShots(
    { target: part({ kind: 'app', page, root: dlg, url: page.url() }, dlg) },
    { target: part(ref, ref.page.locator('[id="1a"] [role="dialog"]')) },
    `modal-driver-request-1a-home-unfit-${testInfo.project.name}`,
    testInfo,
  );
  console.log(
    `visual modal-driver-request 1a home unfit ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`,
  );
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
});
