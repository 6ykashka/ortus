// W0.14 · data-screen-label: 6 значений эталона 14.10 дословно + схема PD-37 для страниц этапов 0–2.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { format, screenLabels, shell } from '../src/index.ts';
import { MAIN_HTML, readText } from './_util.mjs';

const inDesign = [...readText(MAIN_HTML).matchAll(/data-screen-label="([^"]+)"/g)].map((m) => m[1]);

/** Страницы этапов 0–2 (оболочка, компания, платформа, логистика, «Главная»). */
const PAGES = [
  'home',
  'modules',
  'users',
  'billing',
  'branding',
  'fleet',
  'pool',
  'review',
  'today',
  'cars',
  'tenants',
  'usage',
  'requests',
  'accounts',
  'plans',
];

describe('screenLabels.prototype — значения эталона', () => {
  it('в главном файле ровно 6 атрибутов, и все они в словаре', () => {
    assert.equal(inDesign.length, 6);
    assert.deepEqual([...inDesign].sort(), Object.values(screenLabels.prototype).sort());
  });
});

describe('screenLabels.byPage — PD-37', () => {
  it('ключи = страницы этапов 0–2', () =>
    assert.deepEqual(Object.keys(screenLabels.byPage).sort(), [...PAGES].sort()));

  it('значения эталона не переименованы', () => {
    for (const k of ['usage', 'requests', 'accounts', 'plans', 'billing', 'branding']) {
      assert.equal(screenLabels.byPage[k], screenLabels.prototype[k], k);
    }
  });

  it('tenants → «Оператор · организации» (Q-43)', () =>
    assert.equal(screenLabels.byPage.tenants, 'Оператор · организации'));

  it('остальные — «<Роль> · <подпись меню со строчной>»', () => {
    const roleOf = {
      home: 'Владелец',
      modules: 'Владелец',
      users: 'Владелец',
      fleet: 'Логист',
      pool: 'Логист',
      review: 'Логист',
      today: 'Водитель',
      cars: 'Водитель',
    };
    for (const [page, role] of Object.entries(roleOf)) {
      const label = shell.nav.items[page];
      const expected = format(screenLabels.scheme, {
        role,
        label: label.charAt(0).toLowerCase() + label.slice(1),
      });
      assert.equal(screenLabels.byPage[page], expected, page);
    }
  });

  it('значения уникальны', () => {
    const v = Object.values(screenLabels.byPage);
    assert.equal(new Set(v).size, v.length);
  });
});
