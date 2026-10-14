// W0.14 · Каждый канонический Problem.code и каждое клиентское состояние имеют текст.
// Источник набора: реестр docs/12 v0.2 (design/docs/12-errors-and-events.md) + PD-34;
// если стюард уже влил api/errors.yaml (W0.07) — дополнительно его `codes` и `client_states`.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { errors } from '../src/index.ts';
import { CLIENT_STATES, PD34_CODES, errorsYaml, registryCodes } from './_util.mjs';

const registry = [...registryCodes(), ...PD34_CODES];
const codes = registry.map((x) => x.code);
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;

describe('реестр кодов', () => {
  it('docs/12 v0.2 разобран: 48 кодов, с PD-34 — 52, без повторов', () => {
    assert.equal(registryCodes().length, 48);
    assert.equal(new Set(codes).size, 52);
  });
});

describe('errors.problem — текст на каждый Problem.code', () => {
  for (const code of codes) {
    it(code, () => assert.ok(nonEmpty(errors.problem[code]), `нет текста для ${code}`));
  }

  it('нет лишних ключей (код без записи в реестре)', () => {
    assert.deepEqual(
      Object.keys(errors.problem).filter((k) => !codes.includes(k)),
      [],
    );
  });
});

describe('errors.client — клиентские состояния без HTTP-ответа', () => {
  for (const s of CLIENT_STATES) {
    it(s, () => assert.ok(nonEmpty(errors.client[s]), `нет текста для ${s}`));
  }
  it('ровно три состояния', () =>
    assert.deepEqual(Object.keys(errors.client).sort(), [...CLIENT_STATES].sort()));
});

describe('errors.http — общий текст статуса для неизвестного кода', () => {
  const statuses = [...new Set([...registry.map((x) => x.status), 500])].sort();
  for (const s of statuses) {
    it(`http${s}`, () =>
      assert.ok(nonEmpty(errors.http[`http${s}`]), `нет текста для статуса ${s}`));
  }
  it('запасной текст «Ошибка» (run() эталона :2431)', () =>
    assert.equal(errors.fallback, 'Ошибка'));
});

describe('api/errors.yaml (W0.07), если уже в main', () => {
  const y = errorsYaml();
  it(
    'каждый код и клиентское состояние errors.yaml имеют текст',
    { skip: !y && 'api/errors.yaml ещё не влит' },
    () => {
      for (const c of y.codes)
        assert.ok(nonEmpty(errors.problem[c]), `errors.yaml: нет текста для ${c}`);
      for (const c of y.clientStates)
        assert.ok(nonEmpty(errors.client[c]), `errors.yaml: нет текста для ${c}`);
    },
  );
});
