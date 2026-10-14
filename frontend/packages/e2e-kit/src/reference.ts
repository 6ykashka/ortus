// Эталон: любой .dc.html (главный файл или модульный) на сервере design-preview --offline.
// Персонаж и ширина выбираются демо-панелью эталона; в реализации панели нет (PD-54).
import type { Locator, Page } from '@playwright/test';

import type { Net } from './net.ts';
import { type FrameWidth, MAIN_REFERENCE, PANEL, type Persona, referenceUrl } from './persona.ts';

export interface Target {
  kind: 'reference' | 'app';
  page: Page;
  /** Корень снимка и подписей: `#dc-root` у эталона, `#app` у реализации. */
  root: Locator;
  url: string;
}

export interface ReferenceTarget extends Target {
  kind: 'reference';
  file: string;
  net?: Net;
}

export interface ReferenceOptions {
  baseURL: string;
  file?: string;
  hash?: string;
  persona?: Persona;
  width?: FrameWidth;
  hidePanel?: boolean;
}

export const REFERENCE_ROOT = '#dc-root';
const LOADING = { name: 'Загрузка' } as const;

/**
 * Готовность эталона: отрисован `.sc-host`, повторный fetch шаблона (support.js:158) завершён
 * (сеть затихла), скелетон «Загрузка» исчез. Без этого два снимка одного экрана расходятся.
 */
export async function waitForReferenceReady(page: Page): Promise<void> {
  await page.locator(`${REFERENCE_ROOT} > .sc-host`).waitFor();
  await page.waitForLoadState('networkidle');
  await page.getByRole('status', LOADING).waitFor({ state: 'detached' });
}

function panelOf(t: Target): Locator {
  return t.page.locator(PANEL);
}

/** Выбирает персонажа в демо-панели по value (две опции «Массажист · Анна Морозова»). */
export async function setPersona(t: Target, persona: Persona): Promise<void> {
  const select = panelOf(t).getByLabel('Персонаж');
  if ((await select.inputValue()) === persona) return;
  await select.selectOption(persona);
  await t.page.getByRole('status', LOADING).waitFor({ state: 'detached' });
  await t.page.waitForLoadState('networkidle');
}

/** Ширина фрейма эталона: «По окну» или 390/768/1440. */
export async function setFrameWidth(t: Target, width: FrameWidth): Promise<void> {
  await panelOf(t).getByLabel('Ширина').selectOption(String(width));
}

/** Скрывает панель демонстрации (D-45 п.5): снимок и подписи берутся без неё. */
export async function hidePanel(t: Target): Promise<void> {
  if ((await panelOf(t).count()) === 0) return;
  await panelOf(t).evaluate((el) => {
    (el as HTMLElement).style.display = 'none';
  });
}

/** Открывает файл эталона на переданной странице (контекст — с часами и локалью проекта). */
export async function openReference(page: Page, o: ReferenceOptions): Promise<ReferenceTarget> {
  const file = o.file ?? MAIN_REFERENCE;
  const url = referenceUrl(o.baseURL, file, o.hash);
  await page.goto(url);
  await waitForReferenceReady(page);
  const t: ReferenceTarget = {
    kind: 'reference',
    page,
    root: page.locator(REFERENCE_ROOT),
    url,
    file,
  };
  if (o.persona || o.width !== undefined) {
    if ((await panelOf(t).count()) === 0) {
      throw new Error(`reference(${file}): нет панели демонстрации — persona/width недоступны`);
    }
  }
  if (o.persona) await setPersona(t, o.persona);
  if (o.width !== undefined) await setFrameWidth(t, o.width);
  if (o.hidePanel) await hidePanel(t);
  return t;
}
