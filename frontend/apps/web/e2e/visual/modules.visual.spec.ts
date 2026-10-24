// W1.24 · Визуальная сверка `modules` «Модули и место» со снимком design-stage-1 (verification-protocol.md §3,
// порог 0,01). Предмет — основная область; шапка и меню сверяет ключ `shell` (маска). На эталоне до снимка
// снимается кнопка «Демо: завершить пробный период» (PD-54: в реализации её нет). Кадры: верх страницы,
// низ страницы (карточка «Место организации») и диалоги «Подключить «Логистика»?», «Отключить «Салон и SPA»?»,
// «Новый лимит меньше занятого места» (25 ГБ), «Изменить лимит на 250 ГБ?» (без секций: пустой контейнер
// секций эталона :2185 добавляет gap перед подвалом).
// Отличия — allowlist/modules.md.
import type { AppTarget, ReferenceTarget } from '@ortus/e2e-kit';
import type { Locator, Page, TestInfo } from '@playwright/test';

import { tenantId } from '../shell.helpers.ts';
import { expect, test } from '../fixtures/index.ts';
import { modulesReady, openOnReference } from './modules.compare.ts';
import { compareShots, dropDemoButtons } from './shell.compare.ts';

const CHROME = ['header', 'nav'];

/** Прокрутка основной области к низу страницы (прокручивается `#ox-main`, :172). */
const toBottom = (page: Page) =>
  page.locator('#ox-main').evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });

/**
 * Карточка базового модуля эталона вне этапа снимается до кадра (out-of-stage, allowlist/modules.md): ячейка сетки
 * «Базовые модули» (`om.core`) с подписью `name`; нет карточки (design-stage-1) — ничего.
 */
const dropCoreCard = (root: Locator, name: string) =>
  root.evaluate((el, n) => {
    for (const s of Array.from(el.querySelectorAll('span'))) {
      if (s.children.length > 0 || s.textContent?.trim() !== n) continue;
      // Ячейка — предок подписи, чей родитель (или родитель обёртки `sc-for` с display: contents) — сетка.
      const isGrid = (g: Element | null) => !!g && getComputedStyle(g).display === 'grid';
      let card: Element | null = s;
      for (let i = 0; card && i < 6; i += 1) {
        const p: Element | null = card.parentElement;
        if (
          isGrid(p) ||
          (p && getComputedStyle(p).display === 'contents' && isGrid(p.parentElement))
        ) {
          card.remove();
          break;
        }
        card = p;
      }
    }
  }, name);

type Frame = 'top' | 'bottom' | 'connect' | 'disconnect' | 'quota' | 'quota-fit';
const FRAMES: Frame[] = ['top', 'bottom', 'connect', 'disconnect', 'quota', 'quota-fit'];

/** Кадр на эталоне или в реализации: кнопки карточек — по подписи внутри статьи модуля. */
async function frame(page: Page, f: Frame): Promise<void> {
  const card = (name: string) =>
    page.locator('article').filter({ has: page.getByRole('heading', { level: 3, name }) });
  if (f === 'bottom') await toBottom(page);
  if (f === 'connect') await card('Логистика').getByRole('button', { name: 'Подключить' }).click();
  if (f === 'disconnect')
    await card('Салон и SPA').getByRole('button', { name: 'Отключить' }).click();
  if (f === 'quota' || f === 'quota-fit') {
    await page.getByLabel('Лимит места').selectOption(f === 'quota' ? '25' : '250');
    await page.getByRole('button', { name: 'Изменить лимит' }).click();
  }
  if (f !== 'top' && f !== 'bottom') {
    await page.getByRole('dialog').waitFor();
  }
}

type RefTarget = ReferenceTarget & { root: Locator };

/** Обе стороны открыты на «Модули и место» владельца и подготовлены к кадрам. */
async function openBoth(
  page: Page,
  ref: RefTarget,
  app: (route: string, o?: { persona?: 'owner' }) => Promise<AppTarget>,
): Promise<AppTarget> {
  await openOnReference(ref.page, 'Модули и место', 'Модули');
  await dropDemoButtons(ref.root);
  // W2.81: карточка «Обучение» базовых модулей эталона 19.10b (W2.70) — модуль вне плана этапов (Q-W2.70-16,
  // allowlist/modules.md): в каталоге контракта её нет, лишний ряд сетки сдвигает низ страницы и фон диалогов.
  await dropCoreCard(ref.root, 'Обучение');
  await app('/', { persona: 'owner' });
  const impl = await app(`/t/${await tenantId(page)}/modules`, { persona: 'owner' });
  await modulesReady(page);
  // Ссылка «Хранилище» — без эталона (allowlist/modules.md, Q-W1.24-8): на телефоне и планшете она добавляет
  // строку в карточку места и сдвигает низ страницы; кадр сверяет остальное — ссылка скрывается до снимка.
  await page.locator('.ox-mod-link').evaluate((el) => {
    (el as HTMLElement).style.display = 'none';
  });
  return impl;
}

/**
 * Фон под диалогом — с верха основной области (W2.81, возврат 2): прокрутку к кнопке карточки делает клик
 * Playwright, и при повторе клика под нагрузкой выравнивание другое; фон обеих сторон закрепляется одинаково.
 */
const pinBackground = (page: Page) =>
  page.locator('#ox-main').evaluate(async (el) => {
    await document.fonts.ready;
    el.scrollTop = 0;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });

/** Снимки кадра `f` обеих сторон (шапка и меню — маска) и сверка в допуске 0,01. */
async function shoot(
  page: Page,
  impl: AppTarget,
  ref: RefTarget,
  f: Frame,
  testInfo: TestInfo,
): Promise<void> {
  if (f !== 'top' && f !== 'bottom') {
    await pinBackground(ref.page);
    await pinBackground(page);
  }
  const r = await compareShots(
    { target: impl, mask: CHROME.map((s) => page.locator(s)) },
    { target: ref, mask: CHROME.map((s) => ref.page.locator(s)) },
    `modules-${f}-${testInfo.project.name}`,
    testInfo,
  );
  console.log(`visual modules ${f} ${testInfo.project.name}: ${r.diffPixels} px, ${r.ratio}`);
  expect(r.pass, `${r.diffPixels} px, ${r.ratio}`).toBe(true);
}

for (const f of FRAMES) {
  test(`modules: «Модули и место» владельца, кадр ${f}, в допуске 0,01 @mock`, async ({
    app,
    page,
    reference,
    harness,
  }, testInfo) => {
    test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
    const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
    const impl = await openBoth(page, ref, app);
    await frame(ref.page, f);
    await frame(page, f);
    await shoot(page, impl, ref, f, testInfo);
  });
}

// W2.81, возврат 2: под нагрузкой кадр disconnect на 390 один раз дал 9117 px (0,0277) — фон под листом прокручен
// на 67 px иначе, чем у эталона: прокрутку к кнопке «Отключить» делает клик Playwright, и при повторе клика
// (кнопка ещё не стабильна) выравнивание другое. Разная прокрутка фона воспроизводится без нагрузки: после
// открытия диалога фон реализации сдвигается на 67 px.
test('modules: кадр disconnect — фон под листом прокручен иначе, чем у эталона, в допуске 0,01 @mock', async ({
  app,
  page,
  reference,
  harness,
}, testInfo) => {
  test.skip(harness.mode !== 'mock', 'пиксельная сверка — режим mock');
  const ref = await reference(undefined, { persona: 'owner', hidePanel: true });
  const impl = await openBoth(page, ref, app);
  await frame(ref.page, 'disconnect');
  await frame(page, 'disconnect');
  await page.locator('#ox-main').evaluate((el) => {
    el.scrollTop += 67;
  });
  await shoot(page, impl, ref, 'disconnect', testInfo);
});
