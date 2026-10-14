// playwright.config поверх defineHarnessConfig: проекты, порты по слоту, webServer эталона и приложения.
// Бриф W0.05 §4.3, §6 п.6.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import type * as Config from '../src/config.ts';
import { load } from './_load.ts';

const m = await load<typeof Config>('../src/config.ts');

/** Временный «репозиторий»: <root>/frontend/apps/web/package.json со скриптами. */
function fakeApp(scripts: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'ortus-cfg-'));
  const appDir = join(root, 'frontend', 'apps', 'web');
  mkdirSync(appDir, { recursive: true });
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: '@ortus/web', scripts }));
  return appDir;
}

function cfg(env: Record<string, string>, scripts: Record<string, string> = {}) {
  assert.equal(typeof m.defineHarnessConfig, 'function', 'defineHarnessConfig экспортирован');
  return (m.defineHarnessConfig as typeof Config.defineHarnessConfig)({
    appDir: fakeApp(scripts),
    env,
  });
}

type Server = { command: string; url: string; reuseExistingServer: boolean; cwd?: string };
const servers = (c: ReturnType<typeof cfg>): Server[] => c.webServer as Server[];

describe('defineHarnessConfig', () => {
  it('три проекта: mobile-390, tablet-768, desktop-1440', () => {
    const c = cfg({ ORTUS_SLOT: '6' });
    const projects = c.projects ?? [];
    assert.deepEqual(
      projects.map((p) => [p.name, p.use?.viewport]),
      [
        ['mobile-390', { width: 390, height: 844 }],
        ['tablet-768', { width: 768, height: 1024 }],
        ['desktop-1440', { width: 1440, height: 900 }],
      ],
    );
    assert.equal(projects[0]?.use?.isMobile, true);
    assert.equal(projects[0]?.use?.hasTouch, true);
    assert.equal(projects[1]?.use?.hasTouch, true);
  });

  it('use: baseURL по слоту, ru-RU, Europe/Moscow, светлая тема', () => {
    const c = cfg({ ORTUS_SLOT: '6' });
    assert.equal(c.use?.baseURL, 'http://127.0.0.1:5206');
    assert.equal(c.use?.locale, 'ru-RU');
    assert.equal(c.use?.timezoneId, 'Europe/Moscow');
    assert.equal(c.use?.colorScheme, 'light');
    assert.equal(c.use?.trace, 'on-first-retry');
    const ref = c.metadata?.harness as { referenceURL: string; mode: string };
    assert.equal(ref.referenceURL, 'http://127.0.0.1:4173');
    assert.equal(ref.mode, 'mock');
  });

  it('PORT=3001 → baseURL 127.0.0.1:3001', () => {
    assert.equal(cfg({ PORT: '3001' }).use?.baseURL, 'http://127.0.0.1:3001');
  });

  it('эталон: design-preview --offline на порту эталона, cwd — корень репозитория', () => {
    const [ref] = servers(cfg({ ORTUS_SLOT: '6', E2E_OWN_REFERENCE: '1' }));
    assert.equal(ref?.command, 'node tools/design-preview.js design 4106 --offline');
    assert.match(ref?.url ?? '', /^http:\/\/127\.0\.0\.1:4106\/%D0%9E/);
    assert.equal(ref?.reuseExistingServer, true);
  });

  it('REFERENCE_REF → --ref, REFERENCE_DIR → каталог', () => {
    const [ref] = servers(cfg({ REFERENCE_REF: 'design-stage-1', REFERENCE_DIR: 'tmp/d' }));
    assert.equal(
      ref?.command,
      'node tools/design-preview.js tmp/d 4173 --offline --ref design-stage-1',
    );
  });

  it('без скрипта dev у @ortus/web приложение не поднимается', () => {
    assert.equal(servers(cfg({ ORTUS_SLOT: '6' })).length, 1);
  });

  it('со скриптом dev: Vite в режиме e2e на порту слота, adapter по режиму', () => {
    const list = servers(cfg({ ORTUS_SLOT: '6' }, { dev: 'vite' }));
    assert.equal(list.length, 2);
    const app = list[1] as Server & { env: Record<string, string> };
    assert.equal(
      app.command,
      'corepack pnpm --filter @ortus/web run dev -- --mode e2e --host 127.0.0.1 --port 5206 --strictPort',
    );
    assert.equal(app.url, 'http://127.0.0.1:5206/');
    assert.equal(app.env.VITE_ADAPTER, 'mock');
    const stand = servers(
      cfg({ ORTUS_SLOT: '6', E2E_MODE: 'stand' }, { dev: 'vite' }),
    )[1] as Server & {
      env: Record<string, string>;
    };
    assert.equal(stand.env.VITE_ADAPTER, 'http');
    assert.equal(stand.env.ORTUS_API_ORIGIN, 'http://127.0.0.1:8106');
  });

  it('E2E_BASE_URL: приложение не поднимается, baseURL — стенд', () => {
    const c = cfg({ E2E_MODE: 'stand', E2E_BASE_URL: 'http://stand.local:8080' }, { dev: 'vite' });
    assert.equal(servers(c).length, 1);
    assert.equal(c.use?.baseURL, 'http://stand.local:8080');
  });

  it('проверяющий: свежие серверы, порт 6100+slot', () => {
    const list = servers(cfg({ ORTUS_SLOT: '6', E2E_ROLE: 'verifier' }, { dev: 'vite' }));
    assert.ok(list.every((s) => s.reuseExistingServer === false));
    assert.equal(list[1]?.url, 'http://127.0.0.1:6106/');
  });

  it('CI: forbidOnly, retries 2, workers 1; снимки по платформе (D-32), порог 0.01 (D-22)', () => {
    const c = cfg({ CI: 'true' });
    assert.equal(c.forbidOnly, true);
    assert.equal(c.retries, 2);
    assert.equal(c.workers, 1);
    assert.equal(
      c.snapshotPathTemplate,
      '{testDir}/visual/__screenshots__/{platform}/{projectName}/{arg}{ext}',
    );
    assert.equal(c.expect?.toHaveScreenshot?.maxDiffPixelRatio, 0.01);
    assert.equal(c.testDir, 'e2e');
  });
});
