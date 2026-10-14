// Allowlist расхождений с эталоном: формат D-50 + виды out-of-stage и no-reference (план v2 §3.7).
// Бриф W0.05 §4.5, §6 п.3.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type * as Allow from '../src/allowlist.ts';
import { load } from './_load.ts';

const m = await load<typeof Allow>('../src/allowlist.ts');

function need<K extends keyof typeof Allow>(k: K): (typeof Allow)[K] {
  assert.equal(typeof m[k], 'function', `${String(k)} экспортирован`);
  return m[k] as (typeof Allow)[K];
}

const parse = (text: string) => need('parseAllowlist')(text, 'home.md');
const lint = (text: string, stage: number) => need('lintAllowlist')(parse(text).entries, { stage });

const LABEL =
  '- kind: label · target: button:Демо: открыть как владелец · mode: mock · reason: демо-кнопка · decision: PD-54 · owner: W1.20';

describe('parseAllowlist', () => {
  it('строка D-50 → запись с 6 полями и номером строки', () => {
    const { entries, errors } = parse(`# home\n\n${LABEL}\n`);
    assert.deepEqual(errors, []);
    assert.equal(entries.length, 1);
    assert.deepEqual(
      { ...entries[0], file: undefined },
      {
        kind: 'label',
        target: 'button:Демо: открыть как владелец',
        mode: 'mock',
        reason: 'демо-кнопка',
        decision: 'PD-54',
        owner: 'W1.20',
        expires: undefined,
        file: undefined,
        line: 3,
      },
    );
  });

  it('target с « · » внутри подписи не режется', () => {
    const { entries, errors } = parse(
      '- kind: label · target: option:Владелец · Дарья Зимина · mode: both · reason: r · decision: D-44 · owner: W1.20',
    );
    assert.deepEqual(errors, []);
    assert.equal(entries[0]?.target, 'option:Владелец · Дарья Зимина');
  });

  it('прочие строки (заголовки, текст) игнорируются', () => {
    const { entries, errors } = parse('# Заголовок\n\nТекст.\n- просто пункт\n');
    assert.equal(entries.length, 0);
    assert.equal(errors.length, 0);
  });

  it('kind: pixel без decision → ошибка с номером строки', () => {
    const { errors } = parse(
      'x\n- kind: pixel · target: #dc-root · mode: mock · reason: r · owner: W1.20',
    );
    assert.equal(errors.length, 1);
    assert.equal(errors[0]?.line, 2);
    assert.equal(errors[0]?.level, 'error');
    assert.match(errors[0]?.message ?? '', /decision/);
  });

  it('неизвестный вид, режим, поле, формат decision/owner/expires → ошибки', () => {
    const bad = [
      '- kind: color · target: t · mode: mock · reason: r · decision: PD-1 · owner: W1.20',
      '- kind: label · target: t · mode: prod · reason: r · decision: PD-1 · owner: W1.20',
      '- kind: label · target: t · mode: mock · reason: r · decision: PD-1 · owner: W1.20 · color: red',
      '- kind: label · target: t · mode: mock · reason: r · decision: потом · owner: W1.20',
      '- kind: label · target: t · mode: mock · reason: r · decision: PD-1 · owner: WS-10',
      '- kind: label · target: t · mode: mock · reason: r · decision: PD-1 · owner: W1.20 · expires: скоро',
    ];
    const { errors, entries } = parse(bad.join('\n'));
    assert.equal(entries.length, 0);
    assert.deepEqual(
      errors.map((e) => e.line),
      [1, 2, 3, 4, 5, 6],
    );
    assert.match(errors[0]?.message ?? '', /kind/);
    assert.match(errors[1]?.message ?? '', /mode/);
    assert.match(errors[2]?.message ?? '', /color/);
    assert.match(errors[3]?.message ?? '', /decision/);
    assert.match(errors[4]?.message ?? '', /owner/);
    assert.match(errors[5]?.message ?? '', /expires/);
  });

  it('decision допускает PD-, D-, RS-, Q-, B- с пояснением', () => {
    for (const d of ['PD-60', 'D-29 П27', 'RS-08', 'Q-103', 'B-6']) {
      const { errors } = parse(
        `- kind: state · target: t · mode: mock · reason: r · decision: ${d} · owner: W2.22`,
      );
      assert.deepEqual(errors, [], d);
    }
  });

  it('expires: stage-N → число этапа', () => {
    const { entries } = parse(
      '- kind: out-of-stage · target: button:Касса · mode: both · reason: меню · decision: PD-55 · owner: W1.20 · expires: stage-5',
    );
    assert.equal(entries[0]?.expires, 5);
  });
});

describe('lintAllowlist', () => {
  const OOS =
    '- kind: out-of-stage · target: button:Касса · mode: both · reason: пункт меню этапа 5 · decision: PD-55 · owner: W1.20';

  it('out-of-stage без expires → ошибка', () => {
    const errs = lint(OOS, 1);
    assert.equal(errs.length, 1);
    assert.equal(errs[0]?.level, 'error');
    assert.match(errs[0]?.message ?? '', /expires/);
  });

  it('срок снятия: этап > N — ошибка, = N — предупреждение, < N — чисто', () => {
    const text = `${OOS} · expires: stage-4`;
    assert.match(lint(text, 5)[0]?.message ?? '', /срок снятия истёк/);
    assert.equal(lint(text, 5)[0]?.level, 'error');
    assert.equal(lint(text, 4)[0]?.level, 'warning');
    assert.deepEqual(lint(text, 3), []);
  });

  it('no-reference с decision — допустим', () => {
    const text =
      '- kind: no-reference · target: inbox · mode: both · reason: экрана нет в прототипе · decision: B-6 · owner: W1.22';
    assert.deepEqual(lint(text, 1), []);
  });

  it('дубликат kind+target+mode → предупреждение', () => {
    const errs = lint(`${LABEL}\n${LABEL}`, 1);
    assert.equal(errs.length, 1);
    assert.equal(errs[0]?.level, 'warning');
    assert.equal(errs[0]?.line, 2);
  });
});

describe('applyAllowlist', () => {
  it('удаляет цели label/out-of-stage своего режима; both — в обоих', () => {
    assert.equal(typeof m.applyAllowlist, 'function');
    const { entries } = parse(
      [
        LABEL,
        '- kind: out-of-stage · target: button:Касса · mode: both · reason: r · decision: PD-55 · owner: W1.20 · expires: stage-5',
        '- kind: label · target: h1:Стенд · mode: stand · reason: r · decision: PD-1 · owner: W1.20',
        '- kind: pixel · target: button:Главная · mode: both · reason: r · decision: PD-1 · owner: W1.20',
      ].join('\n'),
    );
    const labels = [
      'button:Главная',
      'button:Демо: открыть как владелец',
      'button:Касса',
      'h1:Стенд',
    ];
    assert.deepEqual(need('applyAllowlist')(labels, entries, 'mock'), [
      'button:Главная',
      'h1:Стенд',
    ]);
    assert.deepEqual(need('applyAllowlist')(labels, entries, 'stand'), [
      'button:Главная',
      'button:Демо: открыть как владелец',
    ]);
  });
});

describe('formatAllowError', () => {
  it('файл:строка: уровень: сообщение', () => {
    assert.equal(typeof m.formatAllowError, 'function');
    assert.equal(
      need('formatAllowError')({
        file: 'a/home.md',
        line: 3,
        level: 'error',
        message: 'нет decision',
      }),
      'a/home.md:3: ошибка: нет decision',
    );
  });
});
