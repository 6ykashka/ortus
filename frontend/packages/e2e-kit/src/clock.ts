// Фиксированные часы обеих сторон сверки (D-45 п.2): 1 октября 2026, 10:30 по Москве.
import type { BrowserContext } from '@playwright/test';

export const CLOCK = '2026-10-01T10:30:00+03:00';
export const TIMEZONE = 'Europe/Moscow';
export const LOCALE = 'ru-RU';

/** Ставит часы контекста до первого goto; время идёт дальше от CLOCK. */
export async function installClock(context: BrowserContext, iso: string = CLOCK): Promise<void> {
  await context.clock.install({ time: new Date(iso) });
}
