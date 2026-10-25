// W4.85 · Хвосты контракта этапа 4 (0.11.1-stage4): PublicFormPresentation.title (Q-W4.70-2) — название формы для
// заголовка страницы гостя; screens.yaml — владелец W4.70 у form-fill и public-form (Q-W4.70-5), без пометок
// «кандидат» у knowledge-people, knowledge-automation, modal-kb-access (Q-W4.02-5, Q-W4.32-9).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { abs, SCREENS_PATH } from './lib/paths.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const doc = bundle();
const presentation = doc.components.schemas.PublicFormPresentation;

describe('контракт 0.11.1-stage4 (W4.85): название публичной формы', () => {
  it('PublicFormPresentation.title — обязательная строка до 200 знаков', () => {
    assert.equal(presentation.properties.title?.type, 'string');
    assert.equal(presentation.properties.title.maxLength, 200);
    assert.ok(presentation.required.includes('title'));
    assert.equal(presentation.additionalProperties, false);
  });

  it('версия контракта — не ниже 0.11.1-stage4, журнал и README описывают поправку', () => {
    const m = /^0\.(\d+)\.(\d+)-stage(\d+)$/.exec(doc.info.version);
    assert.ok(m, doc.info.version);
    assert.ok(Number(m[3]) >= 4);
    assert.ok(Number(m[1]) > 11 || (Number(m[1]) === 11 && Number(m[2]) >= 1), doc.info.version);
    const log = readFileSync(abs('api/CHANGELOG.md'), 'utf8');
    assert.match(log, /^## 0\.11\.1-stage4 — W4\.85/m);
    assert.ok(log.indexOf('## 0.11.1-stage4') < log.indexOf('## 0.11.0-stage4'));
    assert.match(readFileSync(abs('api/README.md'), 'utf8'), /0\.11\.1-stage4/);
  });
});

describe('screens.yaml (W4.85): владелец публичной формы и пометки кандидатов', () => {
  const screens = readYaml(SCREENS_PATH).screens;

  it('form-fill и public-form — W4.70 (Q-W4.70-5)', () => {
    assert.equal(screens['form-fill'].ws, 'W4.70');
    assert.equal(screens['public-form'].ws, 'W4.70');
  });

  it('у knowledge-people, knowledge-automation, modal-kb-access нет «кандидат»', () => {
    for (const key of ['knowledge-people', 'knowledge-automation', 'modal-kb-access']) {
      assert.doesNotMatch(JSON.stringify(screens[key]), /кандидат/, key);
    }
  });
});
