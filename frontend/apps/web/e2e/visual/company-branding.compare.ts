// W4.62 · Сверка «Оформления» со снимком design-2026-10-19 (verification-protocol.md §3): переход на эталоне по
// меню, одинаковые шаги кадра на обеих целях, готовность реализации. Отличия — allowlist/company-branding.md.
import type { AppTarget, Persona } from '@ortus/e2e-kit';
import type { Page } from '@playwright/test';

import { LOTOS, tenantId } from '../shell.helpers.ts';
import { openOnReference } from './modules.compare.ts';

export type Frame = 'top' | 'plum' | 'fix' | 'terms' | 'menu' | 'form' | 'mail' | 'panel';
export const FRAMES: readonly Frame[] = [
  'top',
  'plum',
  'fix',
  'terms',
  'menu',
  'form',
  'mail',
  'panel',
];

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<AppTarget>;

/** Реализация: «Оформление» организации персонажа по прямому URL, форма загружена. */
export async function openImpl(
  app: AppFn,
  page: Page,
  persona: Persona = 'owner',
): Promise<AppTarget> {
  await app('/', { persona });
  const id = await tenantId(page, persona === 'owner@t-lotos' ? LOTOS : undefined);
  const impl = await app(`/t/${id}/branding`, { persona });
  await page.getByRole('radiogroup', { name: 'Палитра' }).waitFor();
  await page.waitForLoadState('networkidle');
  return impl;
}

/** Эталон: «Оформление» через меню (на телефоне — «Ещё» → «Все разделы»). */
export const openRef = (page: Page): Promise<void> => openOnReference(page, 'Оформление');

/** Прокрутка основной области к блоку с заголовком `h2` (одинаково на обеих целях). */
async function scrollTo(page: Page, heading: string): Promise<void> {
  await page.getByRole('heading', { level: 2, name: heading, exact: true }).evaluate((el) => {
    // Прокручивается своя основная область цели (scrollIntoView на телефоне эталона двигает и окно с шапкой).
    let box: HTMLElement | null = el.parentElement;
    while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
    if (!box) return;
    box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top;
  });
}

/** Шаги кадра на цели (по ролям и подписям — одинаковые на эталоне и в реализации). */
export async function frame(page: Page, f: Frame): Promise<void> {
  const hex = page.getByLabel('Свой цвет в формате HEX');
  if (f === 'plum') {
    await page
      .getByRole('radiogroup', { name: 'Палитра' })
      .getByRole('radio', { name: 'Сливовый' })
      .click();
    await scrollTo(page, 'Акцентный цвет');
  }
  if (f === 'fix') {
    await hex.fill('#FFD400');
    await hex.blur();
    await scrollTo(page, 'Акцентный цвет');
  }
  if (f === 'terms') await scrollTo(page, 'Термины');
  if (f === 'menu') {
    await page.getByRole('button', { name: 'Сменить иконку: Главная' }).click();
    await scrollTo(page, 'Меню и иконки');
  }
  if (f === 'form' || f === 'mail') {
    await page
      .getByRole('group', { name: 'Что показать' })
      .getByRole('button', { name: f === 'form' ? 'Публичная форма' : 'Письмо', exact: true })
      .click();
    await scrollTo(page, 'Предпросмотр');
  }
  if (f === 'panel') await scrollTo(page, 'Публичные формы и письма');
  await page.mouse.move(0, 0);
}
