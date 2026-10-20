// W0.07 · Состояния тенанта по PLAT-02 (01-technical-spec PLAT-02; 10-data-model «Тенант»;
// control_0001_init.sql tenant_state; README комплекта v0.2 «Расхождения»; PD-35 по умолчанию).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bundle } from './lib/bundle.mjs';
import { SOURCE_0_1 } from './lib/paths.mjs';
import { readYaml } from './lib/yaml-io.mjs';

const PLAT_02 = [
  'provisioning',
  'trial',
  'active',
  'grace',
  'read_only',
  'suspended',
  'closing',
  'closed',
];

describe('Tenant.status по PLAT-02', () => {
  const schemas = bundle().components.schemas;
  const source = readYaml(SOURCE_0_1).components.schemas;

  it('Tenant.status — восемь состояний PLAT-02 в порядке жизненного цикла', () => {
    assert.deepEqual(schemas.Tenant.properties.status, { type: 'string', enum: PLAT_02 });
  });

  it('прочие поля Tenant не изменились', () => {
    const strip = (s) => {
      const c = structuredClone(s);
      delete c.properties.status;
      // W4.07: необязательные места, участники, тариф и знак для списка оператора (дельты kind: add).
      for (const k of ['seats', 'memberCount', 'tierCode', 'brand']) delete c.properties[k];
      return c;
    };
    assert.deepEqual(strip(schemas.Tenant), strip(source.Tenant));
  });

  it('оператор по-прежнему только приостанавливает и возобновляет (TenantPatch.status)', () => {
    assert.deepEqual(schemas.TenantPatch.properties.status.enum, ['active', 'suspended']);
  });

  // W2.40: аддитивный PR стюарда поднимает patch (0.5.1-stage2) — patch любой.
  it('версия контракта — 0.N.P-stageM, не ниже 0.2.0-stage0 (точную версию проверяет PR этапа)', () => {
    const m = /^0\.(\d+)\.\d+-stage(\d+)$/.exec(bundle().info.version);
    assert.ok(m, bundle().info.version);
    assert.ok(Number(m[1]) >= 2, bundle().info.version);
  });
});
