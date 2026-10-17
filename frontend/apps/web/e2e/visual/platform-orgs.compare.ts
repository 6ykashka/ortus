// W1.25 · Сверка «Организаций» оператора со снимком design-stage-1 (verification-protocol.md §3): область
// страницы `#ox-main` обеих целей. Перед снимком эталон приводится к данным контракта оператора этапа 1 по
// записям allowlist/platform-orgs.md (out-of-stage до W4.60–W4.62): владелец, занятые места и место, модули,
// участники — «—», полосы без заливки, знак — буква имени на акценте по умолчанию, «Квота места» убрана.
// Разметка эталона — шаблон pg.tenants «Ортус CRM.dc.html» :1536–1583 (снимок заморожен на этап).
import { expect, type Locator, type Page } from '@playwright/test';

import type { Target } from '@ortus/e2e-kit';

const DASH = '—';
const ACCENT = 'rgb(31, 107, 82)';

/** Область страницы: `#ox-main` (шапка и меню — сверка shell W1.20). */
export const mainTarget = (t: Target): Target => ({ ...t, root: t.page.locator('#ox-main') });

/** Приводит эталон «Организаций» к данным контракта этапа 1 (записи allowlist/platform-orgs.md). */
export async function normalizeReference(page: Page): Promise<void> {
  await page.locator('section[aria-labelledby="h-ten"]').evaluate(
    (section, { dash, accent }) => {
      const firstAlnum = (s: string) => (/[\p{L}\p{N}]/u.exec(s)?.[0] ?? '?').toUpperCase();
      for (const row of Array.from(section.querySelectorAll<HTMLElement>('button[aria-pressed]'))) {
        const [mark, main, , storage] = Array.from(row.children) as HTMLElement[];
        const name = main?.children[0]?.textContent ?? '';
        if (mark) {
          mark.textContent = firstAlnum(name);
          mark.style.background = accent;
        }
        const owner = main?.children[1];
        if (owner) {
          owner.textContent = (owner.textContent ?? '').replace(
            /^Владелец: .+ · мест (?:\d+\/)?(\d+)$/,
            `Владелец: ${dash} · мест ${dash}/$1`,
          );
        }
        const usage = storage?.children[0];
        if (usage)
          usage.textContent = (usage.textContent ?? '').replace(/^[\d,]+ из/, `${dash} из`);
        const fill = storage?.children[1]?.firstElementChild as HTMLElement | null | undefined;
        if (fill) fill.style.width = '0';
      }
      const aside = section.querySelector('aside');
      if (!aside) return;
      for (const dt of Array.from(aside.querySelectorAll('dt'))) {
        const dd = dt.nextElementSibling;
        if (!dd) continue;
        const label = dt.textContent;
        if (label === 'Владелец' || label === 'Модули' || label === 'Участники')
          dd.textContent = dash;
        if (label === 'Место')
          dd.textContent = (dd.textContent ?? '').replace(/^[\d,]+ из/, `${dash} из`);
      }
      const blocks = Array.from(aside.children) as HTMLElement[];
      const storageFill = blocks[2]?.firstElementChild as HTMLElement | null | undefined;
      if (storageFill) storageFill.style.width = '0';
      const seats = blocks[3];
      const seatsValue = seats?.children[0]?.children[1];
      if (seatsValue) {
        // Занятые места — этап 4: «— из 10», «— · без ограничения»; «· мест нет» считается по занятым.
        seatsValue.textContent = (seatsValue.textContent ?? '')
          .replace(/^\d+ (из|·)/, `${dash} $1`)
          .replace(/ · мест нет$/, '');
      }
      const seatsFill = seats?.children[1]?.firstElementChild as HTMLElement | null | undefined;
      if (seatsFill) seatsFill.style.width = '0';
      for (const label of Array.from(aside.querySelectorAll('label'))) {
        if (label.textContent?.startsWith('Квота места')) label.parentElement?.remove();
      }
    },
    { dash: DASH, accent: ACCENT },
  );
}

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
 * Значения карточки с учётом allowlist platform-org-card.md: срок подписки («помесячно», «12 мес») и сумма
 * оплаты эталона — этап 4 (out-of-stage); в mock версия цен — проекция MSW (label, mode mock).
 */
export function comparableValues(values: readonly string[], mode: 'mock' | 'stand'): string[] {
  return values.map((v) => {
    let out = v
      .replace(/^(Тариф: .+?) · (?:помесячно|\d+ мес)(?= · цены v)/, '$1')
      .replace(/^(Оплата: Оплачено до \d{2}\.\d{2}\.\d{4}) · .+\/мес$/, '$1');
    if (mode === 'mock') out = out.replace(/^(Тариф: .+ · цены v)\d+$/, '$1N');
    return out;
  });
}
