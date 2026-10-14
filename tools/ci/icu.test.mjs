// W0.04 · Детерминизм ICU: полный ICU и ru-RU одинаковы на dev-машине и в CI
// (старый WS-01 §4.7, R-13…R-17; передан W0.04 отчётом W0.03).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importIfExists, runNode } from './_util.mjs';

const SCRIPT = 'tools/ci/check-icu.mjs';
const mod = await importIfExists(SCRIPT);

function need() {
  assert.ok(mod, `${SCRIPT} ещё не существует`);
  return mod;
}

/** Фейковый Intl поверх настоящего: ломает отдельные части. */
function fakeIntl({ spaceNumber = false } = {}) {
  // Свойства Intl неперечисляемые: наследуем, а не копируем spread-ом.
  const fake = Object.create(Intl);
  fake.NumberFormat = function (locale, opts) {
    const real = new Intl.NumberFormat(locale, opts);
    return {
      format: (n) => (spaceNumber ? real.format(n).replace(/\u00A0/g, ' ') : real.format(n)),
    };
  };
  return fake;
}

const sameCompare = { localeCompare: () => 0 };

describe('checkIcu', () => {
  it('настоящий Intl и process.versions → ок', () => {
    const r = need().checkIcu({ Intl, versions: process.versions });
    assert.deepEqual(r.failures, []);
    assert.equal(r.ok, true);
  });

  it('84 370 с обычным пробелом вместо U+00A0 → провал', () => {
    const r = need().checkIcu({
      Intl: fakeIntl({ spaceNumber: true }),
      versions: process.versions,
    });
    assert.deepEqual(r.failures, ['NumberFormat ru-RU: ожидался U+00A0']);
  });

  it('localeCompare без русской сортировки → провалы ё/е и числовой сортировки', () => {
    const r = need().checkIcu({ Intl, versions: process.versions, collator: sameCompare });
    assert.deepEqual(r.failures, ['ё/е: ожидался порядок е < ё', 'numeric: ожидалось 1, 9, 10']);
  });

  it('пустой versions.icu → провал small-icu', () => {
    const r = need().checkIcu({ Intl, versions: { ...process.versions, icu: undefined } });
    assert.deepEqual(r.failures, ['process.versions.icu пуст (small-icu?)']);
  });

  it('всё сломано → провалы в порядке проверок', () => {
    const r = need().checkIcu({
      Intl: fakeIntl({ spaceNumber: true }),
      versions: { icu: '' },
      collator: sameCompare,
    });
    assert.deepEqual(r.failures, [
      'process.versions.icu пуст (small-icu?)',
      'NumberFormat ru-RU: ожидался U+00A0',
      'ё/е: ожидался порядок е < ё',
      'numeric: ожидалось 1, 9, 10',
    ]);
    assert.equal(r.ok, false);
  });
});

describe('check-icu CLI', () => {
  it('на этой машине: «icu <ver> tz <ver> ok», exit 0', () => {
    const r = runNode(SCRIPT);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^icu \d+\.\d+ tz \S+ ok$/m);
  });

  it('CHECK_ICU_FAKE=1 → exit 1 и список провалов', () => {
    const r = runNode(SCRIPT, [], { env: { ...process.env, CHECK_ICU_FAKE: '1' } });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /NumberFormat ru-RU: ожидался U\+00A0/);
    assert.match(r.stderr, /process\.versions\.icu пуст/);
  });
});
