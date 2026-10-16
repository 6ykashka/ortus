// W1.20 · Сверка оболочки с эталоном design-stage-1 (verification-protocol.md §3): пиксели корня цели с маской
// своей области (маска Playwright привязана к странице цели, поэтому маски — у каждой цели свои), подписи
// шапки и меню (collectLabels) с учётом allowlist ключа страницы.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  applyAllowlist,
  collectLabels,
  comparePng,
  parseAllowlist,
  shootRoot,
  type Target,
} from '@ortus/e2e-kit';
import type { Locator, TestInfo } from '@playwright/test';

export interface Shot {
  target: Target;
  /** Области цели, закрытые маской (содержимое страниц других WS). */
  mask?: Locator[];
}

/** Сравнивает реализацию с эталоном; при провале — снимки и разница во вложениях. */
export async function compareShots(
  actual: Shot,
  expected: Shot,
  key: string,
  testInfo: TestInfo,
  maxDiffPixelRatio = 0.01,
): Promise<{ pass: boolean; ratio: number; diffPixels: number }> {
  const exp = await shootRoot(expected.target, expected.mask ?? []);
  const act = await shootRoot(actual.target, actual.mask ?? []);
  const r = comparePng(act, exp, { maxDiffPixelRatio });
  const png = 'image/png';
  await testInfo.attach(`${key}-expected.png`, { body: exp, contentType: png });
  await testInfo.attach(`${key}-actual.png`, { body: act, contentType: png });
  if (!r.pass) await testInfo.attach(`${key}-diff.png`, { body: r.diff, contentType: png });
  return { pass: r.pass, ratio: r.ratio, diffPixels: r.diffPixels };
}

/** Записи allowlist ключей страницы (`e2e/visual/allowlist/<key>.md`), файлы применяются вместе. */
export function allowlist(keys: string | readonly string[]) {
  return [keys].flat().flatMap((key) => {
    const file = fileURLToPath(new URL(`./allowlist/${key}.md`, import.meta.url));
    const parsed = parseAllowlist(readFileSync(file, 'utf8'), file);
    if (parsed.errors.length) throw new Error(parsed.errors.map((e) => e.message).join('; '));
    return parsed.entries;
  });
}

/** Счётчик-бейдж в конце подписи пункта меню: «button:Чаты 5» → «button:Чаты». */
const BADGE = /^(button:.+?) \d+$/;

/**
 * Подписи областей (шапка, меню) с учётом allowlist режима mock. Бейджи пунктов меню снимаются с обеих
 * сторон: их числа — данные модулей будущих этапов (out-of-stage, allowlist/shell.md), механизм проверен
 * unit-тестами nav/build.test.ts домена.
 */
export async function labelsOf(
  areas: Locator[],
  key: string | readonly string[],
): Promise<string[]> {
  const out: string[] = [];
  for (const a of areas) out.push(...(await collectLabels(a)));
  return applyAllowlist(
    out.map((l) => l.replace(BADGE, '$1')),
    allowlist(key),
    'mock',
  );
}

/**
 * Карточка гейта владельца на эталоне: в design-stage-1 владелец гейта не видит (меню D-23), поэтому берётся
 * карточка прораба (ветка A, «Ремонт и стройка») и подписи владельца из gateVM (:3058–3061): текст
 * «Подключите модуль…» и кнопка «Открыть «Модули и место»» вместо «Демо: …» — та же разметка :200.
 */
export async function ownerGateCard(root: Locator, text: string, action: string): Promise<void> {
  await root.evaluate(
    (el, v) => {
      const doc = el.ownerDocument;
      const card = (doc.querySelector('#ox-main h1') ?? doc.querySelector('main h1'))
        ?.parentElement;
      const p = card?.querySelector('p');
      const b = card?.querySelector('button');
      if (!card || !p || !b) throw new Error('нет карточки гейта на эталоне');
      p.textContent = v.text;
      b.textContent = v.action;
    },
    { text, action },
  );
}

/** На эталоне — без кнопок «Демо: …» (PD-54: в реализации их нет). */
export async function dropDemoButtons(root: Locator): Promise<void> {
  await root.evaluate((el) => {
    for (const b of Array.from(el.querySelectorAll('button'))) {
      if (b.textContent?.trim().startsWith('Демо:')) b.remove();
    }
  });
}
