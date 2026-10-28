// Конфиг Playwright приложения: проекты 390/768/1440, порты по слоту (§3.6), режимы mock/stand
// (§3.7), webServer эталона (design-preview --offline) и приложения (Vite --mode e2e, W0.09).
//   frontend/apps/web/playwright.config.ts:
//     export default defineHarnessConfig({ appDir: import.meta.dirname });
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { devices, type PlaywrightTestConfig } from '@playwright/test';

import { LOCALE, TIMEZONE } from './clock.ts';
import { DEFAULT_MAX_DIFF_PIXEL_RATIO } from './compare.ts';
import { type HarnessEnv, resolveHarnessEnv } from './env.ts';
import { MAIN_REFERENCE, referenceUrl } from './persona.ts';

type WebServerConfig = Exclude<NonNullable<PlaywrightTestConfig['webServer']>, readonly unknown[]>;

export interface HarnessConfigOptions {
  /** Каталог приложения (`frontend/apps/web`). */
  appDir: string;
  env?: Readonly<Record<string, string | undefined>>;
}

/** Корень репозитория по каталогу приложения `frontend/apps/<app>`. */
export const repoRootOf = (appDir: string): string => resolve(appDir, '..', '..', '..');

function hasDevScript(appDir: string): boolean {
  const file = join(appDir, 'package.json');
  if (!existsSync(file)) return false;
  const pkg = JSON.parse(readFileSync(file, 'utf8')) as { scripts?: Record<string, string> };
  return typeof pkg.scripts?.dev === 'string';
}

function referenceServer(h: HarnessEnv, repoRoot: string): WebServerConfig {
  const ref = h.referenceRef ? ` --ref ${h.referenceRef}` : '';
  return {
    command: `node tools/design-preview.js ${h.referenceDir} ${h.referencePort} --offline${ref}`,
    url: referenceUrl(h.referenceURL, MAIN_REFERENCE),
    cwd: repoRoot,
    reuseExistingServer: !h.ci && !h.freshServer,
    timeout: 30_000,
    stdout: 'ignore',
    stderr: 'pipe',
  };
}

function appServer(h: HarnessEnv, repoRoot: string): WebServerConfig {
  return {
    command: `corepack pnpm --filter @ortus/web run dev -- --mode e2e --host 127.0.0.1 --port ${h.appPort} --strictPort`,
    url: `${h.appURL}/`,
    cwd: repoRoot,
    reuseExistingServer: !h.ci && !h.freshServer,
    timeout: 180_000,
    env: {
      COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
      VITE_ADAPTER: h.mode === 'stand' ? 'http' : 'mock',
      ORTUS_API_ORIGIN: h.apiURL,
      ORTUS_SLOT: String(h.slot),
    },
  };
}

export function defineHarnessConfig(o: HarnessConfigOptions): PlaywrightTestConfig {
  const h = resolveHarnessEnv(o.env ?? process.env);
  const repoRoot = repoRootOf(o.appDir);
  const servers: WebServerConfig[] = [referenceServer(h, repoRoot)];
  if (h.startApp && hasDevScript(o.appDir)) servers.push(appServer(h, repoRoot));

  return {
    testDir: 'e2e',
    timeout: 30_000,
    expect: {
      timeout: 5_000,
      toHaveScreenshot: {
        maxDiffPixelRatio: DEFAULT_MAX_DIFF_PIXEL_RATIO,
        animations: 'disabled',
        caret: 'hide',
        scale: 'css',
      },
    },
    fullyParallel: true,
    forbidOnly: h.ci,
    retries: h.ci ? 2 : 0,
    workers: h.workers,
    reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
    outputDir: 'test-results',
    snapshotPathTemplate: '{testDir}/visual/__screenshots__/{platform}/{projectName}/{arg}{ext}',
    metadata: { harness: h },
    use: {
      baseURL: h.appURL,
      locale: LOCALE,
      timezoneId: TIMEZONE,
      colorScheme: 'light',
      trace: 'on-first-retry',
      screenshot: 'only-on-failure',
      video: 'off',
    },
    projects: [
      {
        name: 'mobile-390',
        use: {
          ...devices['Pixel 7'],
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
        },
      },
      {
        name: 'tablet-768',
        use: {
          ...devices['Desktop Chrome'],
          viewport: { width: 768, height: 1024 },
          hasTouch: true,
        },
      },
      {
        name: 'desktop-1440',
        use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
      },
    ],
    webServer: servers,
  };
}
