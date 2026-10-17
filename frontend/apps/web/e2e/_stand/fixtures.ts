// W1.30 · Фикстуры стенд-e2e (режим stand): фикстуры харнесса (fixtures/index.ts) + второй пользователь в своём
// контексте браузера (своя cookie-сессия, часы и сеть харнесса, viewport проекта). Сценарий выхода этапа 1 ведёт
// двоих одновременно: владелец меняет права, сотрудник видит это у себя без перезагрузки (S1-15).
//   import { expect, test } from '../../_stand/fixtures.ts';
import { createNet, installClock, openApp, type Persona } from '@ortus/e2e-kit';
import type { BrowserContext, BrowserContextOptions, Page } from '@playwright/test';

import { test as base } from '../fixtures/index.ts';

export { expect } from '../fixtures/index.ts';

/** Параметры контекста по настройкам проекта (как у фикстуры reference). */
function contextOptions(use: Record<string, unknown>): BrowserContextOptions {
  const keys = [
    'viewport',
    'deviceScaleFactor',
    'isMobile',
    'hasTouch',
    'userAgent',
    'locale',
    'timezoneId',
    'colorScheme',
  ] as const;
  return Object.fromEntries(keys.filter((k) => use[k] !== undefined).map((k) => [k, use[k]]));
}

/** Второй пользователь: страница в новом контексте; `open` — маршрут приложения (с dev-входом персонажа). */
export interface Session {
  page: Page;
  open: (route: string, persona?: Persona) => Promise<void>;
}

/**
 * Возврат общего сида: `undo(label, fn)` регистрирует уборку и возвращает «выполнить сейчас» (один раз).
 * Невыполненные уборки идут в обратном порядке при завершении теста — и после падения или таймаута, пока
 * страницы `page` и `session` ещё открыты (фикстура зависит от них и снимается раньше).
 */
export type Undo = (label: string, fn: () => Promise<unknown>) => () => Promise<void>;

interface StandFixtures {
  /** Новый пользователь в своём контексте; контексты закрываются после теста. */
  session: () => Promise<Session>;
  undo: Undo;
}

export const test = base.extend<StandFixtures>({
  undo: async ({ page, session }, use) => {
    void page;
    void session;
    const pending: { label: string; fn: () => Promise<unknown>; done: boolean }[] = [];
    await use((label, fn) => {
      const item = { label, fn, done: false };
      pending.push(item);
      return async () => {
        if (item.done) return;
        item.done = true;
        await fn();
      };
    });
    const errors: string[] = [];
    for (const item of pending.reverse()) {
      if (item.done) continue;
      item.done = true;
      try {
        await item.fn();
      } catch (e) {
        errors.push(`${item.label}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (errors.length) throw new Error(`уборка сида стенда не прошла:\n${errors.join('\n')}`);
  },
  session: async ({ browser, harness }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      const context = await browser.newContext({
        ...contextOptions(testInfo.project.use as Record<string, unknown>),
        baseURL: harness.appURL,
      });
      contexts.push(context);
      await installClock(context);
      await createNet(context, harness.allowHosts);
      const page = await context.newPage();
      return {
        page,
        open: async (route, persona) => {
          await openApp(page, { baseURL: harness.appURL, route, ...(persona ? { persona } : {}) });
        },
      };
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
});
