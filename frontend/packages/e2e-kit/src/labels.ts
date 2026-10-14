// Структурная сверка: подписи интерактивных элементов, заголовков и aria-меток в порядке документа.
// Формат элемента — `<kind>:<текст>`: `button:Главная`, `h1:Модули и место`, `aria:Основная навигация`.
import type { Locator } from '@playwright/test';

import { PANEL } from './persona.ts';

/** Что не участвует в сверке: панель демонстрации (PD-54), доп. a11y (D-29), скрытое от AT. */
export const LABEL_EXCLUDE: readonly string[] = [
  PANEL,
  '[data-a11y-extra]',
  '[aria-hidden="true"]',
];

/** Элементы, чьи подписи собираются. */
export const LABEL_SELECTOR =
  'button, a[href], [role="button"], [role="link"], [role="tab"], h1, h2, h3, label, [aria-label]';

// Пробелы, которые схлопываются; U+00A0 и U+202F (разряды чисел ru-RU) сохраняются.
const SPACE_RE = /[\t\n\v\f\r \u2028\u2029]+/g;

/** `kind:текст` с нормализованными пробелами; пустой текст — null. */
export function normalizeLabel(kind: string, text: string): string | null {
  const t = text.replace(SPACE_RE, ' ').replace(/^ | $/g, '');
  return t ? `${kind}:${t}` : null;
}

/** Собирает подписи внутри root (эталон: `#dc-root`, реализация: `#app`). */
export async function collectLabels(root: Locator): Promise<string[]> {
  const raw = await root.evaluate(
    (el, { selector, exclude }) => {
      const out: [string, string][] = [];
      for (const node of Array.from(el.querySelectorAll<HTMLElement>(selector))) {
        if (exclude.some((s) => node.closest(s))) continue;
        if (typeof node.checkVisibility === 'function' && !node.checkVisibility()) continue;
        const aria = node.getAttribute('aria-label');
        if (aria) {
          out.push(['aria', aria]);
          continue;
        }
        const clone = node.cloneNode(true) as HTMLElement;
        for (const hidden of Array.from(clone.querySelectorAll('[aria-hidden="true"]')))
          hidden.remove();
        const role = node.getAttribute('role');
        out.push([role ?? node.tagName.toLowerCase(), clone.textContent ?? '']);
      }
      return out;
    },
    { selector: LABEL_SELECTOR, exclude: [...LABEL_EXCLUDE] },
  );
  return raw
    .map(([kind, text]) => normalizeLabel(kind, text))
    .filter((l): l is string => l !== null);
}
