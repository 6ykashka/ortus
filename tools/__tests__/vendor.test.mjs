// tools/vendor: React UMD 18.3.1 байт-в-байт по SRI из design/support.js (W0.05, бриф §6 п.8).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { abs, read } from './_util.mjs';

const support = read('design/support.js');
const sri = (name) => {
  const m = support.match(new RegExp(`var ${name} = "sha384-([^"]+)"`));
  assert.ok(m, `${name} найден в support.js`);
  return m[1];
};

const cases = [
  ['react.production.min.js', 'REACT_SRI'],
  ['react-dom.production.min.js', 'REACT_DOM_SRI'],
];

describe('tools/vendor', () => {
  for (const [file, name] of cases) {
    it(`${file}: sha384 = ${name} из support.js`, () => {
      const p = abs(`tools/vendor/${file}`);
      assert.ok(existsSync(p), `${file} есть`);
      const digest = createHash('sha384').update(readFileSync(p)).digest('base64');
      assert.equal(digest, sri(name));
    });
  }

  it('README.md называет источник и версию 18.3.1', () => {
    const p = abs('tools/vendor/README.md');
    assert.ok(existsSync(p));
    const text = readFileSync(p, 'utf8');
    assert.match(text, /18\.3\.1/);
    assert.match(text, /unpkg\.com/);
  });
});
