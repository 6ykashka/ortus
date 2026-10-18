// Документ профиля docs/plan/v2/load-profile.md согласован с profile.json и моделью (W0.16 → W2.47).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import * as model from '../lib/model.js';

const { STAGE_NAMES, buildVolumeThresholds, deriveRates, requestsPerShift } = model;

const profile = JSON.parse(readFileSync(new URL('../profile.json', import.meta.url), 'utf8'));
const docUrl = new URL('../../../../docs/plan/v2/load-profile.md', import.meta.url);
const K6_IMAGE =
  'grafana/k6:2.3.0@sha256:9c2dee7f8ed74d317e4027c06a10f169b625638189de8d4555d0b3486a5aeb34';

let doc = '';
try {
  doc = readFileSync(docUrl, 'utf8');
} catch {
  doc = '';
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fmt = (x) => String(Math.round(x * 1000) / 1000);
/** Строка таблицы: | `key` | v1 | v2 | … */
const rowRe = (key, ...values) =>
  new RegExp(
    `^\\|\\s*\`${esc(key)}\`\\s*\\|${values.map((v) => `\\s*${esc(v)}\\s*\\|`).join('')}`,
    'm',
  );

describe('load-profile.md', () => {
  it('документ существует', () => {
    assert.ok(doc.length > 0, `нет ${docUrl.pathname}`);
  });

  it('ссылается на D-08, ADR-0009, S0-09, шаг 0.11, NFR-03, W2.47 и W3.01', () => {
    for (const ref of ['D-08', '0009', 'S0-09', '0.11', 'NFR-03', 'W2.47', 'W3.01']) {
      assert.ok(doc.includes(ref), ref);
    }
  });

  it(`версия профиля ${profile.version}; D-08 принято, заглушек больше нет`, () => {
    assert.ok(doc.includes(`Версия профиля ${profile.version}`), profile.version);
    assert.ok(doc.includes('D-08 принято 17.10.2026'));
    assert.doesNotMatch(doc, /D-08 не отвечен/);
  });

  it('ответ владельца приведён дословно: 60 пользователей, 600 загрузок в час, 250 МБ в день', () => {
    for (const s of [
      'профиль k6 — 60 пользователей, 600 загрузок в час в пике',
      '60 смен × 10 фото в день ≈ 250 МБ/день при сжатии на клиенте (≈ 8 ГБ/мес)',
    ]) {
      assert.ok(doc.includes(s), s);
    }
  });

  for (const [key, p] of Object.entries(profile.params)) {
    it(`параметр ${key} = ${p.value} совпадает с profile.json`, () => {
      assert.match(doc, rowRe(key, String(p.value)));
    });
    if (p.status === 'assumption') {
      it(`параметр ${key} помечен допущением ${p.assumption}`, () => {
        assert.match(doc, new RegExp(`^\\|\\s*\`${key}\`.*${p.assumption}.*\\|`, 'm'));
      });
    }
  }

  it('допущения A-19…A-21, A-24 и новые A-25…A-27 описаны', () => {
    for (const id of ['A-19', 'A-20', 'A-21', 'A-24', 'A-25', 'A-26', 'A-27']) {
      assert.ok(doc.includes(id), id);
    }
  });

  const pilot = deriveRates(profile, 'pilot');
  const stress = deriveRates(profile, 'stress');
  for (const key of Object.keys(pilot)) {
    it(`производная ${key}: pilot ${fmt(pilot[key])}, stress ${fmt(stress[key])}`, () => {
      assert.match(doc, rowRe(key, fmt(pilot[key]), fmt(stress[key])));
    });
  }

  {
    const all = Object.fromEntries(STAGE_NAMES.map((s) => [s, buildVolumeThresholds(profile, s)]));
    const n = (stage, key) => String(all[stage][key]?.[0] ?? '—').replace('count>=', '');
    for (const key of [
      'flow_completed{flow:driverShift}',
      'flow_completed{flow:managerShift}',
      'flow_completed{flow:noisyExport}',
      'flow_completed{flow:noisyUploads}',
      'trips_reviewed',
    ]) {
      it(`порог объёма ${key}: smoke, stand, pilot, stress совпадают с моделью`, () => {
        assert.match(doc, rowRe(key, ...STAGE_NAMES.map((s) => n(s, key))));
      });
    }
  }

  it('состав смены водителя: чтения, записи, передачи файлов, паузы', () => {
    const s = requestsPerShift(profile, 'pilot');
    assert.match(doc, rowRe('shift.read', String(s.read)));
    assert.match(doc, rowRe('shift.write', String(s.write)));
    assert.match(doc, rowRe('shift.transfer', String(s.transfer)));
    assert.match(doc, rowRe('shift.thinkPoints', String(s.thinkPoints)));
  });

  it('цели p95 и пороги k6 записаны дословно', () => {
    for (const s of [
      'p(95)<500',
      'p(95)<800',
      `rate<${profile.targets.errorRate}`,
      `rate>${profile.targets.checksRate}`,
      'http_req_duration{tenant:pilot,kind:read}',
      'http_req_duration{tenant:pilot,kind:write}',
    ]) {
      assert.ok(doc.includes(s), s);
    }
  });

  it('«шумный» тенант, сценарии, setup, образ k6 с digest', () => {
    for (const s of [
      'шумный',
      'driverShift',
      'managerShift',
      'noisyExport',
      'noisyUploads',
      'setup()',
      K6_IMAGE,
    ]) {
      assert.ok(doc.includes(s), s);
    }
  });

  it('прогон-дым на стенде и описание полного прогона для W3.01', () => {
    for (const s of [
      'node backend/test/load/stand-smoke.mjs --slot',
      '## 7. Полный прогон (W3.01)',
      'LOAD_STAGE=pilot',
      'LOAD_STAGE=stress',
    ]) {
      assert.ok(doc.includes(s), s);
    }
  });
});
