// W0.17 · e2e-stand (П-1): стенд compose → migrate → seed → cmd/api → Playwright @stand → down -v.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { importIfExists, runNode } from './_util.mjs';

const SCRIPT = 'tools/ci/e2e-stand.mjs';
const mod = await importIfExists(SCRIPT);

function need() {
  assert.ok(mod, `${SCRIPT} ещё не существует`);
  return mod;
}

describe('слот e2e-stand', () => {
  it('--slot важнее ORTUS_SLOT; в CI без слота — 0; локально без слота — null', () => {
    const { resolveSlot } = need();
    assert.equal(resolveSlot(['--slot', '18'], { ORTUS_SLOT: '3' }), 18);
    assert.equal(resolveSlot([], { ORTUS_SLOT: '3' }), 3);
    assert.equal(resolveSlot([], { CI: 'true' }), 0);
    assert.equal(resolveSlot([], {}), null);
    assert.equal(resolveSlot([], { ORTUS_SLOT: '' }), null);
  });

  it('слот вне 0…20 — ошибка', () => {
    const { resolveSlot } = need();
    for (const bad of ['21', '-1', 'x', '1.5']) {
      assert.throws(() => resolveSlot(['--slot', bad], {}), /0…20/);
    }
  });

  it('порты приложения по §3.6: Vite 5200+N, API 8100+N, эталон 4100+N', () => {
    assert.deepEqual(need().appPorts(18), { vite: 5218, api: 8118, reference: 4118 });
    assert.deepEqual(need().appPorts(0), { vite: 5200, api: 8100, reference: 4100 });
  });

  it('env-файл стенда — во временном каталоге, по слоту (корневой .env не трогается)', () => {
    assert.equal(need().standEnvFile(18, '/tmp'), join('/tmp', 'ortus-e2e-stand-s18.env'));
  });
});

describe('окружение процессов', () => {
  it('cmd/api: env стенда + APP_ENV=e2e, dev-вход, HTTP_ADDR и ALLOWED_ORIGINS по слоту', () => {
    const env = need().apiEnv({ CONTROL_DB_URL: 'postgres://x', APP_ENV: 'dev' }, 18);
    assert.equal(env.CONTROL_DB_URL, 'postgres://x');
    assert.equal(env.APP_ENV, 'e2e');
    assert.equal(env.AUTH_PROVIDER, 'dev');
    assert.equal(env.HTTP_ADDR, '127.0.0.1:8118');
    assert.equal(env.ALLOWED_ORIGINS, 'http://127.0.0.1:5218,http://localhost:5218');
  });

  it('Playwright: режим stand, свежие серверы, явные порты; ORTUS_SLOT передаётся для слотов 0…20 (e2e-kit MAX_SLOT = 20)', () => {
    const { playwrightEnv } = need();
    const e18 = playwrightEnv({ ORTUS_SLOT: '18', PATH: 'p' }, 18, '/tmp/r.json');
    assert.equal(e18.PATH, 'p');
    assert.equal(e18.E2E_MODE, 'stand');
    assert.equal(e18.E2E_FRESH_SERVER, '1');
    assert.equal(e18.PORT, '5218');
    assert.equal(e18.HTTP_ADDR, '127.0.0.1:8118');
    assert.equal(e18.REFERENCE_PORT, '4118');
    assert.equal(e18.PLAYWRIGHT_JSON_OUTPUT_FILE, '/tmp/r.json');
    assert.equal(e18.PLAYWRIGHT_HTML_OPEN, 'never');
    assert.equal(e18.ORTUS_SLOT, '18');
    assert.equal(playwrightEnv({}, 7, '/r.json').ORTUS_SLOT, '7');
  });

  it('журнал cmd/api — в файл по дескриптору, не через канал (Q-W1.22-12: канал не читается во время spawnSync Playwright)', () => {
    const { apiStdio } = need();
    assert.equal(typeof apiStdio, 'function', 'нет apiStdio');
    const stdio = apiStdio(7);
    assert.deepEqual(stdio, ['ignore', 7, 7]);
    assert.ok(!stdio.includes('pipe'));
  });

  it('аргументы Playwright: только @stand, отчёты list, json, html', () => {
    const args = need().playwrightArgs();
    assert.deepEqual(args.slice(0, 5), ['--filter', '@ortus/web', 'exec', 'playwright', 'test']);
    assert.ok(args.includes('--grep') && args[args.indexOf('--grep') + 1] === '@stand');
    assert.ok(args.includes('--reporter=list,json,html'));
  });
});

describe('план шагов', () => {
  it('init → up postgres → migrate → seed → build api → start api → readyz → playwright; down -v всегда', () => {
    const p = need().stepsFor(18, '/tmp/s.env');
    assert.deepEqual(
      p.main.map((s) => s.id),
      ['init', 'ports', 'up', 'migrate', 'seed', 'build-api', 'start-api', 'readyz', 'playwright'],
    );
    assert.deepEqual(
      p.always.map((s) => s.id),
      ['stop-api', 'down'],
    );
    const byId = Object.fromEntries([...p.main, ...p.always].map((s) => [s.id, s]));
    assert.deepEqual(byId.init.argv.slice(-6), [
      'init',
      '--slot',
      '18',
      '--force',
      '--env',
      '/tmp/s.env',
    ]);
    assert.deepEqual(byId.up.argv.slice(-4), ['up', 'postgres', '--env', '/tmp/s.env']);
    assert.deepEqual(byId.down.argv.slice(-4), ['down', '-v', '--env', '/tmp/s.env']);
  });
});

describe('verdict — итог JSON-отчёта Playwright', () => {
  it('все пройдены → ok', () => {
    const v = need().verdict({ stats: { expected: 9, skipped: 0, unexpected: 0, flaky: 0 } });
    assert.equal(v.ok, true);
    assert.equal(v.passed, 9);
  });

  it('0 тестов, пропуски или падения → не ok с причиной', () => {
    const { verdict } = need();
    const none = verdict({ stats: { expected: 0, skipped: 0, unexpected: 0, flaky: 0 } });
    assert.equal(none.ok, false);
    assert.match(none.reason, /не найдено/);
    const skipped = verdict({ stats: { expected: 3, skipped: 6, unexpected: 0, flaky: 0 } });
    assert.equal(skipped.ok, false);
    assert.match(skipped.reason, /пропущено 6/);
    const failed = verdict({ stats: { expected: 8, skipped: 0, unexpected: 1, flaky: 0 } });
    assert.equal(failed.ok, false);
    assert.match(failed.reason, /упало 1/);
    assert.equal(verdict(null).ok, false);
  });
});

describe('CLI', () => {
  it('локально без слота — код 2 и подсказка про ORTUS_SLOT', () => {
    const env = { ...process.env, ORTUS_SLOT: '', CI: '' };
    const r = runNode(SCRIPT, [], { env });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /ORTUS_SLOT/);
  });
});
