// tools/allowlist-lint.js: проверка файлов allowlist (D-50, out-of-stage, no-reference). Бриф §4.5, §6 п.9.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runNode, tempDir } from './_util.mjs';

const FIX = 'tools/__tests__/fixtures/allowlist';
const lint = (...args) =>
  runNode('tools/allowlist-lint.js', args, { env: { ...process.env, ORTUS_STAGE: '' } });

describe('allowlist-lint', () => {
  it('корректные файлы → код 0 и сводка', () => {
    const r = lint('--stage', '1', `${FIX}/ok`);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /allowlist-lint: файлов 2, записей 3, ошибок 0, предупреждений 0/);
  });

  it('ошибки → код 1, «файл:строка: ошибка: …»', () => {
    const r = lint('--stage', '1', `${FIX}/bad`);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /modules\.md:3: ошибка: .*decision/);
    assert.match(r.stdout, /ошибок 1/);
  });

  it('--stage продвигает срок out-of-stage: stage-1 при этапе 2 — истёк', () => {
    const r = lint('--stage', '2', `${FIX}/bad`);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /modules\.md:4: ошибка: срок снятия истёк/);
    assert.match(r.stdout, /ошибок 2/);
  });

  it('этап из ORTUS_STAGE, если нет --stage', () => {
    const r = runNode('tools/allowlist-lint.js', [`${FIX}/ok`], {
      env: { ...process.env, ORTUS_STAGE: '5' },
    });
    assert.equal(r.status, 0);
    assert.match(r.stderr, /home\.md:4: предупреждение: .*stage-5/);
    assert.match(r.stdout, /предупреждений 1/);
  });

  it('каталога нет → 0 файлов, код 0', () => {
    const r = lint(`${tempDir()}/missing`);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /файлов 0, записей 0/);
  });

  it('по умолчанию — frontend/apps/web/e2e/visual/allowlist', () => {
    const r = lint('--stage', '0');
    assert.equal(r.status, 0);
    assert.match(r.stdout, /allowlist-lint: файлов \d+/);
  });

  it('неверный --stage → код 2', () => {
    const r = lint('--stage', 'x');
    assert.equal(r.status, 2);
    assert.match(r.stderr, /--stage/);
  });
});
