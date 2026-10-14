// Фикстуры e2e @ortus/web (W0.05). Страничные spec-файлы импортируют test и expect отсюда:
//   import { expect, test } from './fixtures/index.ts';
// Порты и адреса — только из окружения харнесса (resolveHarnessEnv), литералов портов нет.
import { fileURLToPath } from 'node:url';

import {
  type AppTarget,
  type HarnessEnv,
  type Net,
  type Persona,
  type ReferenceOptions,
  type ReferenceTarget,
  collectLabels,
  createNet,
  installClock,
  listReferenceFiles,
  MAIN_REFERENCE,
  openApp,
  openReference,
  resolveHarnessEnv,
  runAxe,
} from '@ortus/e2e-kit';
import { test as base, type BrowserContext, type BrowserContextOptions } from '@playwright/test';

export { expect } from '@playwright/test';

const REPO_ROOT = fileURLToPath(new URL('../../../../../', import.meta.url));

type ReferenceFixture = (
  file?: string,
  o?: Omit<ReferenceOptions, 'baseURL' | 'file'>,
) => Promise<ReferenceTarget & { net: Net }>;
type AppFixture = (route: string, o?: { persona?: Persona }) => Promise<AppTarget>;

interface Fixtures {
  /** Сеть и консоль контекста страницы `page` (внешние хосты заблокированы). */
  net: Net;
  /** Эталон: каждый вызов — новый контекст с часами, локалью и viewport проекта. */
  reference: ReferenceFixture;
  /** Реализация на `page`: маршрут с dev-входом ?persona= (PD-54). */
  app: AppFixture;
  labels: typeof collectLabels;
  axe: typeof runAxe;
}

interface WorkerFixtures {
  harness: HarnessEnv;
  referenceFiles: string[];
}

const netOf = new WeakMap<BrowserContext, Net>();

/** Параметры нового контекста по настройкам проекта (viewport, touch, локаль, часовой пояс). */
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

export const test = base.extend<Fixtures, WorkerFixtures>({
  harness: [
    // eslint-disable-next-line no-empty-pattern -- Playwright требует деструктуризацию первого аргумента
    async ({}, use) => {
      await use(resolveHarnessEnv());
    },
    { scope: 'worker' },
  ],
  referenceFiles: [
    async ({ harness }, use) => {
      await use(
        listReferenceFiles({
          repoRoot: REPO_ROOT,
          dir: harness.referenceDir,
          ref: harness.referenceRef,
        }),
      );
    },
    { scope: 'worker' },
  ],
  context: async ({ context, harness }, use) => {
    await installClock(context);
    netOf.set(context, await createNet(context, harness.allowHosts));
    await use(context);
  },
  net: async ({ context }, use) => {
    const net = netOf.get(context);
    if (!net) throw new Error('net: контекст создан без фикстуры context харнесса');
    await use(net);
  },
  reference: async ({ browser, harness }, use, testInfo) => {
    const contexts: BrowserContext[] = [];
    await use(async (file = MAIN_REFERENCE, o = {}) => {
      const context = await browser.newContext(
        contextOptions(testInfo.project.use as Record<string, unknown>),
      );
      contexts.push(context);
      await installClock(context);
      const net = await createNet(context, harness.allowHosts);
      const page = await context.newPage();
      const target = await openReference(page, { ...o, baseURL: harness.referenceURL, file });
      return { ...target, net };
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
  app: async ({ page, harness }, use) => {
    await use((route, o = {}) => openApp(page, { baseURL: harness.appURL, route, ...o }));
  },
  // eslint-disable-next-line no-empty-pattern -- см. выше
  labels: async ({}, use) => {
    await use(collectLabels);
  },
  // eslint-disable-next-line no-empty-pattern -- см. выше
  axe: async ({}, use) => {
    await use(runAxe);
  },
});
