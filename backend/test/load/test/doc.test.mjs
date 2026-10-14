// Документ профиля docs/plan/v2/load-profile.md согласован с profile.json и моделью (W0.16).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import * as model from '../lib/model.js';

const { deriveRates, requestsPerShift } = model;

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

  it('ссылается на D-08, S0-09, шаг 0.11, PLAT-09, NFR-03 и W3.01', () => {
    for (const ref of ['D-08', 'S0-09', '0.11', 'PLAT-09', 'NFR-03', 'W3.01']) {
      assert.ok(doc.includes(ref), ref);
    }
  });

  for (const [key, p] of Object.entries(profile.params)) {
    it(`параметр ${key} = ${p.value} совпадает с profile.json`, () => {
      assert.match(doc, rowRe(key, String(p.value)));
    });
    if (p.status === 'assumption') {
      it(`параметр ${key} помечен допущением ${p.assumption} (заглушка D-08)`, () => {
        assert.match(doc, new RegExp(`^\\|\\s*\`${key}\`.*${p.assumption}.*\\|`, 'm'));
      });
    }
  }

  it('допущения A-19…A-21 (ошибки, проверки, масштаб stress) описаны', () => {
    for (const id of ['A-19', 'A-20', 'A-21']) assert.ok(doc.includes(id), id);
  });

  const pilot = deriveRates(profile, 'pilot');
  const stress = deriveRates(profile, 'stress');
  for (const key of Object.keys(pilot)) {
    it(`производная ${key}: pilot ${fmt(pilot[key])}, stress ${fmt(stress[key])}`, () => {
      assert.match(doc, rowRe(key, fmt(pilot[key]), fmt(stress[key])));
    });
  }

  it('допущение A-24 (минимальный объём поданной нагрузки) описано', () => {
    assert.ok(doc.includes('A-24'), 'A-24');
    assert.ok(doc.includes('flow_aborted'), 'flow_aborted');
  });

  {
    const smoke = model.buildVolumeThresholds?.(profile, 'smoke') ?? {};
    const pilotMin = model.buildVolumeThresholds?.(profile, 'pilot') ?? {};
    const stressMin = model.buildVolumeThresholds?.(profile, 'stress') ?? {};
    for (const flow of ['driverShift', 'managerShift', 'noisyExport', 'noisyUploads']) {
      const key = `flow_completed{flow:${flow}}`;
      const n = (t) => String(t[key]?.[0] ?? '').replace('count>=', '');
      it(`порог объёма ${key}: smoke, pilot, stress совпадают с моделью`, () => {
        assert.ok(pilotMin[key], `${key} есть в модели`);
        assert.match(doc, rowRe(key, n(smoke), n(pilotMin), n(stressMin)));
      });
    }
  }

  it('состав смены водителя: чтения, записи, передачи файлов', () => {
    const s = requestsPerShift(profile, 'pilot');
    assert.match(doc, rowRe('shift.read', String(s.read)));
    assert.match(doc, rowRe('shift.write', String(s.write)));
    assert.match(doc, rowRe('shift.transfer', String(s.transfer)));
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

  it('«шумный» тенант, сценарии и образ k6 с digest', () => {
    for (const s of [
      'шумный',
      'driverShift',
      'managerShift',
      'noisyExport',
      'noisyUploads',
      K6_IMAGE,
    ]) {
      assert.ok(doc.includes(s), s);
    }
  });
});
