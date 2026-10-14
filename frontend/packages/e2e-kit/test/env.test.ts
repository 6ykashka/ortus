// Окружение харнесса по слоту (план v2 §3.6) и режимы mock/stand (§3.7). Бриф W0.05 §4.1, §6 п.1.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type * as Env from '../src/env.ts';
import { load } from './_load.ts';

const m = await load<typeof Env>('../src/env.ts');

const fn = <K extends keyof typeof Env>(k: K): (typeof Env)[K] => {
  assert.equal(typeof m[k], 'function', `${String(k)} экспортирован`);
  return m[k] as (typeof Env)[K];
};

describe('portsForSlot', () => {
  it('слот 6: Vite 5206, проверяющий 6106, Storybook 7206, API 8106, свой эталон 4106', () => {
    assert.deepEqual(fn('portsForSlot')(6), {
      vite: 5206,
      verifier: 6106,
      storybook: 7206,
      api: 8106,
      ownReference: 4106,
    });
  });

  it('слот вне 0…10 — ошибка', () => {
    assert.throws(() => fn('portsForSlot')(11), /ORTUS_SLOT/);
    assert.throws(() => fn('portsForSlot')(-1), /ORTUS_SLOT/);
  });
});

describe('resolveHarnessEnv', () => {
  it('по умолчанию: слот 0, mock, исполнитель, общий эталон 4173', () => {
    const e = fn('resolveHarnessEnv')({});
    assert.equal(e.slot, 0);
    assert.equal(e.mode, 'mock');
    assert.equal(e.role, 'executor');
    assert.equal(e.appPort, 5200);
    assert.equal(e.appURL, 'http://127.0.0.1:5200');
    assert.equal(e.referencePort, 4173);
    assert.equal(e.referenceURL, 'http://127.0.0.1:4173');
    assert.equal(e.referenceDir, 'design');
    assert.equal(e.referenceRef, undefined);
    assert.equal(e.freshServer, false);
    assert.equal(e.startApp, true);
    assert.equal(e.stage, 0);
  });

  it('ORTUS_SLOT=6: порты исполнителя и каталог MCP', () => {
    const e = fn('resolveHarnessEnv')({ ORTUS_SLOT: '6' });
    assert.equal(e.appURL, 'http://127.0.0.1:5206');
    assert.equal(e.apiURL, 'http://127.0.0.1:8106');
    assert.equal(e.storybookPort, 7206);
    assert.equal(e.mcpOutputDir, '.playwright-mcp/5206');
    assert.equal(e.referenceURL, 'http://127.0.0.1:4173');
  });

  it('E2E_ROLE=verifier: порт 6100+slot и свежий сервер', () => {
    const e = fn('resolveHarnessEnv')({ ORTUS_SLOT: '6', E2E_ROLE: 'verifier' });
    assert.equal(e.role, 'verifier');
    assert.equal(e.appPort, 6106);
    assert.equal(e.freshServer, true);
  });

  it('E2E_FRESH_SERVER=1 отключает переиспользование сервера', () => {
    assert.equal(fn('resolveHarnessEnv')({ E2E_FRESH_SERVER: '1' }).freshServer, true);
  });

  it('свой эталон: E2E_OWN_REFERENCE=1 → 4100+slot; REFERENCE_PORT побеждает', () => {
    const own = fn('resolveHarnessEnv')({ ORTUS_SLOT: '6', E2E_OWN_REFERENCE: '1' });
    assert.equal(own.referencePort, 4106);
    const prev = fn('resolveHarnessEnv')({ ORTUS_SLOT: '6', REFERENCE_PORT: '4174' });
    assert.equal(prev.referenceURL, 'http://127.0.0.1:4174');
  });

  it('PORT побеждает формулу слота', () => {
    const e = fn('resolveHarnessEnv')({ ORTUS_SLOT: '6', PORT: '3001' });
    assert.equal(e.appURL, 'http://127.0.0.1:3001');
    assert.equal(e.mcpOutputDir, '.playwright-mcp/3001');
  });

  it('E2E_MODE=stand: API исполнителя из слота или HTTP_ADDR', () => {
    const e = fn('resolveHarnessEnv')({ ORTUS_SLOT: '6', E2E_MODE: 'stand' });
    assert.equal(e.mode, 'stand');
    assert.equal(e.apiURL, 'http://127.0.0.1:8106');
    const h = fn('resolveHarnessEnv')({ E2E_MODE: 'stand', HTTP_ADDR: '127.0.0.1:9000' });
    assert.equal(h.apiURL, 'http://127.0.0.1:9000');
  });

  it('E2E_BASE_URL: готовый стенд, приложение не поднимается', () => {
    const e = fn('resolveHarnessEnv')({
      E2E_MODE: 'stand',
      E2E_BASE_URL: 'http://stand.local:8080/',
    });
    assert.equal(e.startApp, false);
    assert.equal(e.appURL, 'http://stand.local:8080');
  });

  it('REFERENCE_DIR, REFERENCE_REF, ORTUS_STAGE, CI', () => {
    const e = fn('resolveHarnessEnv')({
      REFERENCE_DIR: 'tmp/design',
      REFERENCE_REF: 'design-stage-1',
      ORTUS_STAGE: '2',
      CI: 'true',
    });
    assert.equal(e.referenceDir, 'tmp/design');
    assert.equal(e.referenceRef, 'design-stage-1');
    assert.equal(e.stage, 2);
    assert.equal(e.ci, true);
  });

  it('allowHosts: приложение, эталон, API и E2E_ALLOW_HOSTS', () => {
    const e = fn('resolveHarnessEnv')({ ORTUS_SLOT: '6', E2E_ALLOW_HOSTS: 'kc.local:8443, x:1' });
    for (const h of ['127.0.0.1:5206', 'localhost:5206', '127.0.0.1:4173', '127.0.0.1:8106']) {
      assert.ok(e.allowHosts.includes(h), h);
    }
    assert.ok(e.allowHosts.includes('kc.local:8443'));
    assert.ok(e.allowHosts.includes('x:1'));
  });

  it('неверные значения — ошибка с именем переменной', () => {
    const r = fn('resolveHarnessEnv');
    assert.throws(() => r({ E2E_MODE: 'prod' }), /E2E_MODE/);
    assert.throws(() => r({ ORTUS_SLOT: '11' }), /ORTUS_SLOT/);
    assert.throws(() => r({ ORTUS_SLOT: 'x' }), /ORTUS_SLOT/);
    assert.throws(() => r({ E2E_ROLE: 'boss' }), /E2E_ROLE/);
    assert.throws(() => r({ PORT: '0' }), /PORT/);
  });
});
