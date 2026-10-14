// Реализация: маршрут с dev-входом ?persona= (PD-54). Контракт для W0.09/W1.20 (бриф W0.05 §4.4):
// в сборке --mode e2e приложение входит под персонажем и ставит <html data-e2e-persona="<id>">.
import type { Page } from '@playwright/test';

import { type Persona, personaUrl } from './persona.ts';
import type { Target } from './reference.ts';

export const APP_ROOT = '#app';
export const PERSONA_READY_ATTR = 'data-e2e-persona';

export interface AppOptions {
  baseURL: string;
  route: string;
  persona?: Persona;
}

export interface AppTarget extends Target {
  kind: 'app';
  route: string;
}

export async function openApp(page: Page, o: AppOptions): Promise<AppTarget> {
  const path = o.persona ? personaUrl(o.route, o.persona) : o.route;
  const url = new URL(path, `${o.baseURL.replace(/\/+$/, '')}/`).href;
  await page.goto(url);
  if (o.persona) {
    await page.locator(`html[${PERSONA_READY_ATTR}="${o.persona}"]`).waitFor({ state: 'attached' });
  }
  const root = page.locator(APP_ROOT);
  await root.waitFor();
  return { kind: 'app', page, root, url, route: o.route };
}
