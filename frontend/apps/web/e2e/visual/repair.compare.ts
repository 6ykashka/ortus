// W6.21 · Помощник сверки вкладок «Замер» и «Смета» с эталоном design-2026-10-19: эталон — модульный файл
// «Ремонт и стройка.dc.html» (объект obj-42 «ЖК Речной · квартира 42», вкладки в навигации «Разделы модуля»),
// реализация — прямой URL хоста-заглушки `repair?obj=&tab=` (карточку объекта делает W6.20). Сверяется область
// вкладки (section) — шапку объекта и оболочку сверяют ключи W6.20 и `shell`.
import { mkdirSync, writeFileSync } from 'node:fs';

import { comparePng } from '@ortus/e2e-kit';
import type { Locator, Page, TestInfo } from '@playwright/test';

export const REPAIR_REFERENCE = 'Ремонт и стройка.dc.html';

/** Эталон: переход на вкладку модуля по подписи («Замер», «Смета») и ожидание её области. */
export async function openRepairTabOnReference(
  page: Page,
  tab: 'Замер' | 'Смета',
  sectionId: 'h-meas' | 'h-est',
): Promise<void> {
  await page
    .locator('nav[aria-label="Разделы модуля"]')
    .getByRole('button', { name: tab, exact: true })
    .click();
  await page.locator(`section[aria-labelledby="${sectionId}"]`).waitFor();
  await page.waitForLoadState('networkidle');
}

/**
 * Шрифты загружены и раскладка устоялась: под нагрузкой снимок раньше брал запасной шрифт, строки переносились
 * иначе, и высоты областей расходились (1935 / 1825 на 390; ревью W6.21 возврат 2). Ждём `document.fonts.ready`
 * и два кадра отрисовки на обеих страницах.
 */
async function settle(...pages: Page[]): Promise<void> {
  for (const page of pages) {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
    });
  }
}

/** Область вкладки на странице (эталон или реализация). */
export const tabArea = (page: Page, sectionId: 'h-meas' | 'h-est') =>
  page.locator(`section[aria-labelledby="${sectionId}"]`);
/**
 * Хосты вкладки у эталона (модуль на всю страницу) и реализации (заглушка W6.20) имеют разные поля, поэтому
 * ширина области выравнивается: обе получают меньшую из двух. Внутренняя вёрстка вкладки не меняется.
 */
export async function equalizeWidth(a: Locator, b: Locator): Promise<number> {
  const wa = (await a.boundingBox())?.width ?? 0;
  const wb = (await b.boundingBox())?.width ?? 0;
  const w = Math.floor(Math.min(wa, wb));
  for (const el of [a, b]) {
    await el.evaluate((n, px) => {
      const s = (n as HTMLElement).style;
      s.boxSizing = 'border-box';
      s.width = `${px}px`;
      s.maxWidth = 'none';
      s.margin = '0';
    }, w);
  }
  return w;
}

/**
 * Числа в полях ввода эталона записаны с точкой и хвостовым нулём («3.0»), реализация показывает российский формат
 * («3», «5,2»): значения полей эталона заменяются значениями реализации по подписи поля (allowlist/repair-measure.md,
 * Q-W6.21-6). Остальной текст не трогается.
 */
export async function syncInputValues(ref: Locator, impl: Locator): Promise<number> {
  const values = await impl
    .locator('input')
    .evaluateAll((els) =>
      els.map((e) => [e.getAttribute('aria-label') ?? '', (e as HTMLInputElement).value] as const),
    );
  await ref.locator('input').evaluateAll((els, vals) => {
    for (const e of els) {
      // Телефон: поле ввода — цель нажатия 44 px (PD-28), у эталона 36 px.
      if (window.innerWidth < 640 && !(e as HTMLInputElement).type.match(/checkbox|radio/)) {
        (e as HTMLElement).style.minHeight = '44px';
      }
      const hit = vals.find(([label]) => label === e.getAttribute('aria-label'));
      if (hit) (e as HTMLInputElement).value = hit[1];
    }
  }, values);
  return values.length;
}

/**
 * Известные отличия подписей, закрытые allowlist/repair-estimate.md: автор допработы («Алексей Соколов · 18.10 …»,
 * Q-W6.21-1) и автор версии в пояснении («… № 42 · Дарья Зимина, 29.09», Q-W6.21-3) — в контракте их нет. Тексты
 * эталона приводятся к виду реализации до снимка; остальное не трогается.
 */
export async function dropContractGaps(ref: Locator): Promise<void> {
  await ref.evaluate((root) => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.nodeValue ?? '';
      const next = text.replace(/^Алексей Соколов · (?=\d)/, '').replace('Дарья Зимина, ', '');
      if (next !== text) n.nodeValue = next;
    }
  });
}

/** Снимок области по целочисленному прямоугольнику (дробные поля хоста не меняют размер снимка). */
async function shootArea(area: Locator, width: number, height: number): Promise<Buffer> {
  const box = await area.boundingBox();
  if (!box) throw new Error('область вкладки не видна');
  const page = area.page();
  const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
  return page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    scale: 'css',
    fullPage: true,
    clip: { x: Math.round(box.x + scroll.x), y: Math.round(box.y + scroll.y), width, height },
  });
}

/**
 * Сверка областей вкладки: ширины выравниваются (equalizeWidth), снимки берутся по целым пикселям, разница высот
 * не больше 1 px (сглаживание строк). Вложения — снимки и разница.
 */
export async function compareAreas(
  actual: Locator,
  expected: Locator,
  key: string,
  testInfo: TestInfo,
  maxDiffPixelRatio = 0.01,
): Promise<{ pass: boolean; ratio: number; diffPixels: number; heights: [number, number] }> {
  await settle(expected.page(), actual.page());
  // Закреплённые панели (нижняя навигация телефона) перекрывали бы нижний край области в снимке страницы.
  for (const area of [expected, actual]) {
    await area.page().evaluate(() => {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        if (getComputedStyle(el).position === 'fixed') el.style.visibility = 'hidden';
      }
    });
  }
  // Область целиком в окне: прокрутка внутри оболочки не даёт снимку страницы выйти за нижний край.
  for (const area of [expected, actual]) {
    const page = area.page();
    for (let i = 0; i < 3; i++) {
      const box = await area.boundingBox();
      const size = page.viewportSize();
      if (!box || !size) break;
      const height = Math.max(size.height, Math.ceil(box.y + box.height + 400));
      if (height === size.height) break;
      await page.setViewportSize({ width: size.width, height });
      await page.waitForTimeout(100);
    }
  }
  // Указатель после клика остаётся над кнопкой и включает её hover; в снимке указателя нет.
  for (const area of [expected, actual]) await area.page().mouse.move(0, 0);
  const width = await equalizeWidth(expected, actual);
  // Дробные координаты областей (поля хоста) сдвигают сглаживание текста: область ставится на целый пиксель.
  for (const area of [expected, actual]) {
    const box = await area.boundingBox();
    const page = area.page();
    const scroll = await page.evaluate(() => ({ x: window.scrollX, y: window.scrollY }));
    if (box) {
      const fx = box.x + scroll.x - Math.round(box.x + scroll.x);
      const fy = box.y + scroll.y - Math.round(box.y + scroll.y);
      await area.evaluate(
        (n, d) => {
          (n as HTMLElement).style.translate = `${-d.fx}px ${-d.fy}px`;
        },
        { fx, fy },
      );
    }
  }
  await settle(expected.page(), actual.page());
  const hExp = Math.round((await expected.boundingBox())?.height ?? 0);
  const hAct = Math.round((await actual.boundingBox())?.height ?? 0);
  const h = Math.min(hExp, hAct);
  const exp = await shootArea(expected, width, h);
  const act = await shootArea(actual, width, h);
  const r = comparePng(act, exp, { maxDiffPixelRatio });
  const png = 'image/png';
  const dump = process.env.E2E_DUMP_DIR;
  if (dump) {
    mkdirSync(dump, { recursive: true });
    writeFileSync(`${dump}/${key}-expected.png`, exp);
    writeFileSync(`${dump}/${key}-actual.png`, act);
    writeFileSync(`${dump}/${key}-diff.png`, r.diff);
  }
  await testInfo.attach(`${key}-expected.png`, { body: exp, contentType: png });
  await testInfo.attach(`${key}-actual.png`, { body: act, contentType: png });
  if (!r.pass) await testInfo.attach(`${key}-diff.png`, { body: r.diff, contentType: png });
  return {
    pass: r.pass && Math.abs(hExp - hAct) <= 1,
    ratio: r.ratio,
    diffPixels: r.diffPixels,
    heights: [hAct, hExp],
  };
}
