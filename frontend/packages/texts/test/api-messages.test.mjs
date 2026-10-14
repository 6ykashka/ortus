// W0.14 · Сообщения mock-адаптера эталона (design/ortus/api.js, models.js) этапов 0–2 — в errors.ts.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { errors, format, gate } from '../src/index.ts';
import { extractApiMessages, fixture, leaves, lines, MODELS_JS } from './_util.mjs';

const errorValues = new Set(leaves(errors).map(([, v]) => v));

describe('статические new ApiError(…) в диапазонах этапов 0–2', () => {
  const found = extractApiMessages();
  const fx = fixture('api-messages.json');

  it('извлечённый список совпадает с фикстурой (изменение эталона — осознанная правка фикстуры)', () => {
    assert.deepEqual(found, fx);
  });

  for (const { line, code, text } of fx) {
    it(`api.js:${line} ${code} «${text}»`, () =>
      assert.ok(errorValues.has(text), `нет в errors: ${text}`));
  }
});

describe('сообщения REASON (api.js :174, :181 → M.REASON[reason].text) — gate.reason', () => {
  const src = lines(MODELS_JS).join('\n');
  for (const [k, r] of Object.entries(gate.reason)) {
    it(k, () => {
      assert.ok(src.includes(`label: '${r.label}'`), `models.js REASON: нет label «${r.label}»`);
      assert.ok(src.includes(`text: '${r.text}'`), `models.js REASON: нет text «${r.text}»`);
    });
  }
});

describe('шаблоны сообщений (конкатенации api.js и models.js)', () => {
  const m = errors.mock;
  const cases = [
    [
      'api.js:298',
      m.company.seatsExhausted,
      { used: 10, limit: 10 },
      'Свободных мест нет: занято 10 из 10. Отзовите приглашение или запросите расширение тарифа.',
    ],
    [
      'api.js:322',
      m.company.tierTooSmall,
      { name: 'Старт', seats: 10, used: 23 },
      'В тарифе «Старт» 10 мест, а занято 23',
    ],
    [
      'api.js:357',
      m.platform.scheduledAlready,
      { version: 2 },
      'Уже запланирована версия v2. Отмените её, чтобы подготовить другую.',
    ],
    [
      'api.js:455',
      m.logistics.incompatible,
      { reasons: 'грузоподъёмность; объём' },
      'Машина не подходит рейсу: грузоподъёмность; объём',
    ],
    [
      'api.js:468',
      m.logistics.cantAssign,
      { reasons: 'длина кузова' },
      'Нельзя назначить: длина кузова',
    ],
    [
      'api.js:474',
      m.logistics.inspectionIncomplete,
      { missing: '2 фото, пробег' },
      'Осмотр не завершён: 2 фото, пробег',
    ],
    [
      'api.js:512',
      m.logistics.returnIncomplete,
      { missing: 'уровень топлива' },
      'Сдача не завершена: уровень топлива',
    ],
    ['models.js:361', m.logistics.missing.odometerMin, { km: 84370 }, 'пробег не меньше 84 370 км'],
    ['models.js:365', m.logistics.missing.checks, { n: 1 }, '1 пункт чек-листа'],
    ['models.js:365', m.logistics.missing.checks, { n: 2 }, '2 пункта чек-листа'],
    ['models.js:365', m.logistics.missing.checks, { n: 5 }, '5 пунктов чек-листа'],
    ['models.js:358', m.logistics.missing.photos, { n: 3 }, '3 фото'],
    [
      'models.js:373',
      m.logistics.odometer.belowStart,
      { km: 84370 },
      'Пробег не может быть меньше 84 370 км',
    ],
    [
      'models.js:374',
      m.logistics.odometer.tooHigh,
      { km: 3200 },
      'Больше начального на 3 200 км — проверьте показания',
    ],
  ];
  for (const [src, msg, values, expected] of cases) {
    it(`${src} → ${expected}`, () => assert.equal(format(msg, values), expected));
  }
});

describe('сообщения проверок models.js (validateExpense, odoError, inspMissing) — дословно', () => {
  const src = lines(MODELS_JS).join('\n');
  const { expense, odometer, missing } = errors.mock.logistics;
  for (const v of [...Object.values(expense), odometer.notNumber, missing.odometer, missing.fuel]) {
    it(v, () => assert.ok(src.includes(`'${v}'`), `models.js: нет «${v}»`));
  }
});
