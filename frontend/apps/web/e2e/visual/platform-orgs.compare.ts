// W1.25 · Сверка «Организаций» оператора со снимком эталона (verification-protocol.md §3): область страницы
// `#ox-main` обеих целей. W4.84: данные W4.60 (владелец, места, место, модули, участники, срок и сумма, «Квота
// места», заявка) — как в эталоне, эталон не приводится. Знак организации — по оформлению (Tenant.brand, W4.62).
// Разметка эталона — шаблон pg.tenants «Ортус CRM.dc.html» :1536–1583.
import { expect, type Locator, type Page } from '@playwright/test';

import type { Target } from '@ortus/e2e-kit';

const DASH = '—';

/** Область страницы: `#ox-main` (шапка и меню — сверка shell W1.20). */
export const mainTarget = (t: Target): Target => ({ ...t, root: t.page.locator('#ox-main') });

/** Секция «Организации-клиенты» цели (для подписей). */
export const orgsArea = (page: Page): Locator => page.locator('section[aria-labelledby="h-ten"]');

/** Карточка выбранной организации: `<aside>` в `#ox-main` обеих целей. */
export const cardTarget = (t: Target): Target => ({ ...t, root: t.page.locator('#ox-main aside') });

/** Секция «Последствия» открытого диалога: заголовок секции и список (родитель `ul`). */
export const consequencesTarget = (t: Target): Target => ({
  ...t,
  root: t.page.getByRole('dialog').locator('ul').first().locator('xpath=..'),
});

/**
 * Выбирает организацию в списке цели и ждёт её карточку: заголовок `h2` и прочитанную подписку (у реализации
 * «Тариф» — не «—»).
 */
export async function selectOrg(page: Page, name: string): Promise<void> {
  const area = orgsArea(page);
  await area.locator('button[aria-pressed]').filter({ hasText: name }).first().click();
  const aside = area.locator('aside');
  await expect(aside.locator('h2')).toHaveText(name);
  await expect(aside.locator('dt:text-is("Тариф") + dd')).not.toHaveText(DASH);
}

/**
 * Открывает диалог команды кнопкой карточки и возвращает его, когда он отрисован. На сенсорных проектах (390)
 * React Aria `ModalOverlay` держит оверлей скрытым (`opacity: 0`, `clip-path`) до 600 мс, ожидая экранную
 * клавиатуру для поля «Причина» с фокусом (`runAfterKeyboard`); `toBeVisible` прозрачность не учитывает.
 */
export async function openDialog(page: Page, action: string): Promise<Locator> {
  await orgsArea(page).locator('aside').getByRole('button', { name: action, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('ul li').first()).toBeVisible();
  await expect
    .poll(() =>
      dialog.evaluate((el) => {
        for (let n: Element | null = el; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (s.opacity === '0' || s.clipPath !== 'none') return false;
        }
        return true;
      }),
    )
    .toBe(true);
  return dialog;
}

/**
 * Текст диалога в порядке документа: заголовок, текст, заголовок секции, иконка и текст каждого последствия,
 * кнопки. Поле «Причина» (label, подсказка, ошибка) — no-reference (allowlist platform-org-card.md) и не входит.
 */
export async function dialogOutline(dialog: Locator): Promise<string[]> {
  return dialog.evaluate((el) => {
    const text = (n: Element | null | undefined) =>
      (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
    const out: string[] = [];
    const h2 = el.querySelector('h2');
    out.push(`h2:${text(h2)}`);
    const p = Array.from(el.querySelectorAll('p')).find((x) => !x.closest('label, [data-field]'));
    out.push(`p:${text(p)}`);
    const ul = el.querySelector('ul');
    out.push(`section:${text(ul?.previousElementSibling)}`);
    for (const li of Array.from(ul?.querySelectorAll('li') ?? [])) {
      const icon = li.querySelector('[aria-hidden="true"]');
      const rest = li.cloneNode(true) as HTMLElement;
      for (const h of Array.from(rest.querySelectorAll('[aria-hidden="true"]'))) h.remove();
      out.push(`li:${text(icon)} ${text(rest)} ${icon ? getComputedStyle(icon).color : ''}`);
    }
    for (const b of Array.from(el.querySelectorAll('button'))) out.push(`button:${text(b)}`);
    return out;
  });
}

/** Значения карточки: «подпись: значение» строк `dl` и «Места с входом». */
export async function cardValues(page: Page): Promise<string[]> {
  return orgsArea(page)
    .locator('aside')
    .evaluate((aside) => {
      const text = (n: Element | null | undefined) =>
        (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
      const out = Array.from(aside.querySelectorAll('dt')).map(
        (dt) => `${text(dt)}: ${text(dt.nextElementSibling)}`,
      );
      const seats = Array.from(aside.querySelectorAll('span')).find(
        (s) => text(s) === 'Места с входом',
      );
      out.push(`Места с входом: ${text(seats?.nextElementSibling)}`);
      return out;
    });
}

/**
 * Значения карточки с учётом allowlist platform-org-card.md: у подписки после неоплаченного пробного периода
 * срока нет (Subscription.termMonths — только у оплаченного периода), эталон пишет «помесячно» по plan.term сида
 * прототипа («Ремстрой Плюс»).
 */
export function comparableValues(values: readonly string[]): string[] {
  return values.map((v) => v.replace(/^(Тариф: «Старт») · помесячно(?= · цены v)/, '$1'));
}
