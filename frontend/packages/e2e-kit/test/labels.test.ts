// Нормализация подписей структурной сверки (collectLabels). Бриф W0.05 §4.2, §6 п.4.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type * as Labels from '../src/labels.ts';
import { load } from './_load.ts';

const m = await load<typeof Labels>('../src/labels.ts');

function norm(kind: string, text: string): string | null {
  assert.equal(typeof m.normalizeLabel, 'function', 'normalizeLabel экспортирован');
  return (m.normalizeLabel as typeof Labels.normalizeLabel)(kind, text);
}

describe('normalizeLabel', () => {
  it('схлопывает пробелы и переводы строк, обрезает края', () => {
    assert.equal(norm('button', '  Модули \n и  место '), 'button:Модули и место');
  });

  it('сохраняет U+00A0 и U+202F (разряды чисел ru-RU)', () => {
    assert.equal(norm('h1', '84\u00A0370 ₽'), 'h1:84\u00A0370 ₽');
    assert.equal(norm('h1', '1\u202F000'), 'h1:1\u202F000');
  });

  it('aria-подпись — префикс aria:', () => {
    assert.equal(norm('aria', 'Уведомления: 1 новых'), 'aria:Уведомления: 1 новых');
  });

  it('пустой текст — null', () => {
    assert.equal(norm('button', ' \n\t '), null);
  });

  it('сохраняет «ё» как есть', () => {
    assert.equal(norm('h2', 'Приёмка смен'), 'h2:Приёмка смен');
  });
});

describe('LABEL_EXCLUDE', () => {
  it('исключает панель демонстрации, data-a11y-extra и aria-hidden', () => {
    assert.ok(Array.isArray(m.LABEL_EXCLUDE));
    for (const sel of [
      '[aria-label="Панель демонстрации"]',
      '[data-a11y-extra]',
      '[aria-hidden="true"]',
    ]) {
      assert.ok(m.LABEL_EXCLUDE?.includes(sel), sel);
    }
  });
});
