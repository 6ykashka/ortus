// W2.90 · Разбор аргументов и хост хранилища стенда показа (docs/demo/demo-stand.mjs).
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';

import { parseArgs, storageHost } from './demo-stand.mjs';

test('слот и режим обязательны; env-файл и логи — в .claude/tmp/demo-stand/s<slot>', () => {
  const o = parseArgs(['--slot', '12', '--e2e']);
  assert.equal(o.slot, 12);
  assert.equal(o.mode, 'e2e');
  assert.equal(o.keep, false);
  assert.equal(o.ownEnv, true);
  assert.ok(o.out.endsWith(join('.claude', 'tmp', 'demo-stand', 's12')));
  assert.equal(o.envFile, join(o.out, 'stand.env'));
  const s = parseArgs(['--serve', '--slot', '0', '--env', '.env', '--keep']);
  assert.equal(s.mode, 'serve');
  assert.equal(s.keep, true);
  assert.equal(s.ownEnv, false);
  assert.ok(s.envFile.endsWith('.env'));
});

test('без слота, со слотом вне 0…20 или без режима — ошибка', () => {
  assert.throws(() => parseArgs(['--e2e']), /--slot/);
  assert.throws(() => parseArgs(['--slot', '21', '--e2e']), /--slot/);
  assert.throws(() => parseArgs(['--slot', 'x', '--e2e']), /--slot/);
  assert.throws(() => parseArgs(['--slot', '3']), /режим/);
  assert.throws(() => parseArgs(['--slot', '3', '--e2e', '--serve']), /режим/);
});

test('хост MinIO — из S3_ENDPOINT стенда (presigned PUT браузера)', () => {
  assert.equal(storageHost({ S3_ENDPOINT: 'http://localhost:20200' }), 'localhost:20200');
  assert.equal(storageHost({}), '');
});
