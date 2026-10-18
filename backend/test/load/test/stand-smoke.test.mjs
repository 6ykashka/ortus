// Прогон-дым k6 на стенде compose слота (W2.47): чистые функции stand-smoke.mjs — аргументы, окружение cmd/api,
// аргументы docker/k6 и итог сводки. Сам прогон (Docker, cmd/api, cmd/worker) проверяется запуском на слоте.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, it } from 'node:test';

import { K6_IMAGE } from '../lib/model.js';
import { apiEnvFor, k6Args, parseArgs, summaryVerdict } from '../stand-smoke.mjs';

const profile = JSON.parse(readFileSync(new URL('../profile.json', import.meta.url), 'utf8'));
const STAND_ENV = {
  S3_ENDPOINT: 'http://127.0.0.1:19700',
  SMTP_PORT: '1725',
  CONTROL_DB_URL: 'postgres://ortus_api:x@127.0.0.1:6132/ortus_control',
};

describe('parseArgs', () => {
  it('слот обязателен; env-файл и логи — в .claude/tmp/load-stand/s<слот>', () => {
    const o = parseArgs(['--slot', '7']);
    assert.equal(o.slot, 7);
    assert.equal(o.keep, false);
    assert.ok(o.out.endsWith(join('.claude', 'tmp', 'load-stand', 's7')), o.out);
    assert.equal(o.envFile, join(o.out, 'stand.env'));
    assert.equal(parseArgs(['--slot', '7', '--keep']).keep, true);
  });

  it('--out — свой каталог логов (из worktree — в .claude/tmp основного репозитория)', () => {
    const o = parseArgs(['--slot', '7', '--out', 'D:/work/repo/.claude/tmp/W2.47/stand']);
    assert.equal(o.out, resolve('D:/work/repo/.claude/tmp/W2.47/stand'));
    assert.equal(o.envFile, join(o.out, 'stand.env'));
    assert.throws(() => parseArgs(['--slot', '7', '--out']), /--out/);
  });

  it('слот 0 — общий стенд интегратора и стенд показа: отказ', () => {
    assert.throws(() => parseArgs(['--slot', '0']), /слот 0/);
  });

  it('без слота, не число или больше 20 — отказ', () => {
    assert.throws(() => parseArgs([]), /--slot/);
    assert.throws(() => parseArgs(['--slot', 'x']), /--slot/);
    assert.throws(() => parseArgs(['--slot', '21']), /--slot/);
  });
});

describe('apiEnvFor — cmd/api стенда для k6 в Docker', () => {
  const env = apiEnvFor(STAND_ENV, 7);

  it('e2e, dev-вход, адрес и Origin слота (tools/ci/e2e-stand.mjs)', () => {
    assert.equal(env.APP_ENV, 'e2e');
    assert.equal(env.AUTH_PROVIDER, 'dev');
    assert.equal(env.HTTP_ADDR, '127.0.0.1:8107');
    assert.match(env.ALLOWED_ORIGINS, /http:\/\/127\.0\.0\.1:5207/);
  });

  it('presigned URL — на host.docker.internal: PUT фото и скачивание видны из контейнера k6', () => {
    assert.equal(env.S3_ENDPOINT, 'http://127.0.0.1:19700');
    assert.equal(env.S3_PUBLIC_ENDPOINT, 'http://host.docker.internal:19700');
  });
});

describe('k6Args', () => {
  it('стадия stand, API и Origin слота, сводка в каталог прогона, образ с digest', () => {
    const args = k6Args({
      slot: 7,
      scripts: '/repo/backend/test/load',
      results: '/repo/.claude/tmp/x',
      runId: 'r1',
    });
    assert.deepEqual(args.slice(0, 3), [
      'run',
      '--rm',
      '--add-host=host.docker.internal:host-gateway',
    ]);
    assert.ok(args.includes('/repo/backend/test/load:/scripts:ro'));
    assert.ok(args.includes('/repo/.claude/tmp/x:/results'));
    assert.ok(args.includes(K6_IMAGE));
    for (const e of [
      'LOAD_STAGE=stand',
      'BASE_URL=http://host.docker.internal:8107',
      'ORIGIN=http://127.0.0.1:5207',
      'RUN_ID=r1',
    ]) {
      assert.equal(args[args.indexOf(e) - 1], '-e', e);
    }
    assert.equal(args[args.indexOf('--summary-export') + 1], '/results/stand-summary.json');
    assert.equal(args.at(-1), '/scripts/main.js');
  });
});

describe('summaryVerdict — итог сводки k6', () => {
  const green = {
    metrics: {
      checks: { passes: 150, fails: 0 },
      http_req_failed: { value: 0, passes: 0, fails: 150 },
      'flow_completed{flow:driverShift}': { count: 2 },
      'flow_completed{flow:managerShift}': { count: 9 },
      trips_reviewed: { count: 2 },
    },
  };

  it('обе смены сида, их приёмка, ни одной ошибки — зелёный', () => {
    const v = summaryVerdict(green, profile);
    assert.equal(v.ok, true, v.lines.join('\n'));
  });

  it('прерванная смена, ошибка HTTP или непринятая смена — красный с причиной', () => {
    const aborted = structuredClone(green);
    aborted.metrics.flow_aborted = { count: 1 };
    aborted.metrics['flow_completed{flow:driverShift}'].count = 1;
    assert.equal(summaryVerdict(aborted, profile).ok, false);
    const failed = structuredClone(green);
    failed.metrics.http_req_failed = { value: 0.01, passes: 2, fails: 148 };
    assert.equal(summaryVerdict(failed, profile).ok, false);
    const unreviewed = structuredClone(green);
    unreviewed.metrics.trips_reviewed.count = 1;
    const v = summaryVerdict(unreviewed, profile);
    assert.equal(v.ok, false);
    assert.ok(v.lines.some((l) => l.startsWith('FAIL') && l.includes('trips_reviewed')));
    assert.equal(summaryVerdict({}, profile).ok, false);
  });

  it('p95 чтения и записи пилота — строки наблюдения рядом с целями, на итог не влияют', () => {
    const slow = structuredClone(green);
    slow.metrics['http_req_duration{tenant:pilot,kind:read}'] = { 'p(95)': 252.15 };
    slow.metrics['http_req_duration{tenant:pilot,kind:write}'] = { 'p(95)': 1420.4 };
    const v = summaryVerdict(slow, profile);
    assert.equal(v.ok, true, v.lines.join('\n'));
    assert.ok(v.lines.includes('info p95 read: 252 мс (цель stage < 500 мс)'), v.lines.join('\n'));
    assert.ok(
      v.lines.includes('info p95 write: 1420 мс (цель stage < 800 мс)'),
      v.lines.join('\n'),
    );
  });
});
