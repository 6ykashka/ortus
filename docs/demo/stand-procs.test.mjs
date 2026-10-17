// Показ 18.10 · разбор аргументов и план процессов стенда показа (docs/demo/stand-procs.mjs).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  MOCK_PORT,
  NAMES,
  parseArgs,
  plan,
  REFERENCE_PORT,
  RESEED_STEPS,
} from './stand-procs.mjs';

test('reseed: down -v → up → bucket → migrate → сид показа (не базовый)', () => {
  assert.deepEqual(RESEED_STEPS[0], ['down', '-v']);
  assert.deepEqual(RESEED_STEPS.at(-1), ['seed', 'demo']);
});

test('команда обязательна; слот 0 по умолчанию, логи — .claude/tmp/demo', () => {
  const o = parseArgs(['start', '--env', 'x.env']);
  assert.equal(o.slot, 0);
  assert.deepEqual(o.only, NAMES);
  assert.ok(o.out.endsWith(join('.claude', 'tmp', 'demo')));
  const s = parseArgs(['stop', '--slot', '12', '--only', 'vite,api']);
  assert.deepEqual(s.only, ['vite', 'api']);
  assert.ok(s.out.endsWith(join('.claude', 'tmp', 'demo', 's12')));
});

test('ошибки аргументов: без команды, start без --env, слот вне 0…20, неизвестный процесс', () => {
  assert.throws(() => parseArgs([]), /команда/);
  assert.throws(() => parseArgs(['start']), /--env/);
  assert.throws(() => parseArgs(['reseed']), /--env/);
  assert.equal(parseArgs(['reseed', '--env', 'x.env']).cmd, 'reseed');
  assert.throws(() => parseArgs(['status', '--slot', '21']), /--slot/);
  assert.throws(() => parseArgs(['stop', '--only', 'db']), /неизвестные/);
});

test('порты по слоту: Vite 5200+slot с адаптером http на API 8100+slot, mock 5180, эталон 4173', () => {
  const standEnv = { PG_WORKER_PASS: 'p', CONTROL_DB_URL: 'postgres://a:b@h/c', TENANT_DB_URL: 'postgres://a:b@h/t' };
  const ctx = { slot: 0, standEnv, out: 'o' };
  const vite = plan('vite', ctx);
  assert.equal(vite.ready, 'http://127.0.0.1:5200/');
  assert.equal(vite.env.VITE_ADAPTER, 'http');
  assert.equal(vite.env.ORTUS_API_ORIGIN, 'http://127.0.0.1:8100');
  const api = plan('api', ctx);
  assert.equal(api.env.HTTP_ADDR, '127.0.0.1:8100');
  assert.equal(api.env.APP_ENV, 'e2e');
  assert.equal(api.ready, 'http://127.0.0.1:8100/readyz');
  assert.match(plan('worker', ctx).env.CONTROL_DB_URL, /ortus_worker/);
  assert.equal(plan('mock', ctx).env.VITE_ADAPTER, 'mock');
  assert.equal(plan('mock', ctx).ready, `http://127.0.0.1:${MOCK_PORT}/`);
  assert.ok(plan('reference', ctx).args.includes(String(REFERENCE_PORT)));
});
