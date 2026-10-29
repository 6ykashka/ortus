// W6.22 · Помощники e2e страниц «Ремонта и стройки» на сценарном сервере: пресет repairs-ready (модуль подключён,
// сегодня 20.10.2026 на сервере) и часы браузера на тот же день — «через N дней» считается от них.
import type { Locator, Page } from '@playwright/test';
import type { Persona } from '@ortus/e2e-kit';

import type { AppTarget } from '@ortus/e2e-kit';

import { devScenario, tenantId } from './shell.helpers.ts';

type AppFn = (route: string, o?: { persona?: Persona }) => Promise<AppTarget>;

/** Сегодня сценария ремонта (Q-W4.00-repair-15): 20.10.2026, 10:30 по Москве. */
export const REPAIR_TODAY = '2026-10-20T10:30:00+03:00';

/** Открыть страницу ремонта: вход персонажа, пресет, часы, затем маршрут организации «Альта». */
export async function openRepair(
  app: AppFn,
  page: Page,
  segment: string,
  o: { persona?: Persona; presets?: string[] } = {},
): Promise<string> {
  const persona = o.persona ?? 'owner';
  await app('/', { persona });
  const id = await tenantId(page);
  for (const preset of o.presets ?? ['repairs-ready']) await devScenario(page, { preset });
  await page.clock.setSystemTime(new Date(REPAIR_TODAY));
  await app(`/t/${id}/${segment}`, { persona });
  return id;
}

/** Строка таблицы заявок по номеру («З-21»). */
export const requestRow = (page: Page, number: string): Locator =>
  page.locator('tr').filter({ has: page.locator('.ox-rps-mono', { hasText: number }) });

/** Сообщение-подтверждение страницы (`hb.note`). */
export const note = (page: Page): Locator => page.locator('.ox-rps-note .ox-rps-note-text');
