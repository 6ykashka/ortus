// Снимок идентификаторов сида (PD-19, PD-30): общий эталон для TS-сида и Go-сида
// (`backend/cmd/seed`). Строится без утечек прототипа (на стенде их нет — Q-31).
// Пересъёмка после правки сида:
//   $env:SEED_SNAPSHOT_WRITE='1'; corepack pnpm --filter @ortus/domain exec vitest run -u src/seed/snapshot.test.ts
//   corepack pnpm exec prettier --write frontend/packages/domain/src/seed/snapshot.json
import { describe, expect, it } from 'vitest';
import { createSeed } from './compose.ts';
import { buildSnapshot } from './snapshot.ts';
import SNAPSHOT from './snapshot.json';
import { seedUuid } from './uuid.ts';

type Env = Record<string, string | undefined>;
const env = (globalThis as { process?: { env: Env } }).process?.env ?? {};

describe('snapshot.json', () => {
  const fresh = () => buildSnapshot(createSeed({ prototypeLeaks: false }));

  it('свежий: совпадает с текущим сидом', async () => {
    if (env['SEED_SNAPSHOT_WRITE'])
      await expect(JSON.stringify(fresh(), null, 2) + '\n').toMatchFileSnapshot('./snapshot.json');
    expect(SNAPSHOT).toEqual(fresh());
  });

  it('правило UUID и счётчики рейсов', () => {
    const s = fresh();
    expect(s.uuid).toEqual({
      version: 5,
      namespace: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
      name: 'ortus:<scope>:<prototype-id>',
    });
    expect(s.seq).toEqual({ 't-alta': 100, 't-lotos': 500 });
    expect(s.counters).toEqual({ 't-alta': { 'Р-208': 208, 'Р-211': 211 }, 't-lotos': {} });
  });

  it('id отсортированы; платформа — 4 организации, 58 аккаунтов, 6 операторов', () => {
    const s = fresh();
    expect(s.platform.tenants).toEqual(['t-alta', 't-cargo', 't-lotos', 't-remstroy']);
    expect(s.platform.accounts).toHaveLength(58);
    expect(s.platform.operators).toHaveLength(6);
    for (const ids of Object.values(s.tenants['t-alta'])) expect(ids).toEqual([...ids].sort());
  });

  it('участники m-owner и m-morozova есть в обеих организациях, UUID у них разные', () => {
    const s = fresh();
    for (const id of ['m-owner', 'm-morozova']) {
      expect(s.tenants['t-alta'].members).toContain(id);
      expect(s.tenants['t-lotos'].members).toContain(id);
      expect(s.uuids['t-alta']?.[id]).not.toBe(s.uuids['t-lotos']?.[id]);
    }
    expect(s.tenants['t-alta'].members).toHaveLength(10);
    expect(s.tenants['t-lotos'].members).toHaveLength(23);
    expect(s.tenants['t-alta'].trips).toEqual(['Р-208', 'Р-211']);
    expect(s.tenants['t-lotos'].bookings).toEqual(['b-a1', 'b-a2', 'b-a3', 'b-br']);
  });

  it('UUID — по правилу PD-30 для организаций, аккаунтов, операторов, подразделений и участников', () => {
    const s = fresh();
    expect(s.uuids['platform']?.['t-alta']).toBe('f04f636e-b66d-509e-ae10-9c27a18e3baa');
    expect(s.uuids['t-alta']?.['f-msk-sever']).toBe('6de355d2-b019-5bb6-b66a-ddae6a13fb65');
    for (const [scope, map] of Object.entries(s.uuids))
      for (const [id, u] of Object.entries(map)) expect(u).toBe(seedUuid(scope, id));
    expect(Object.keys(s.uuids['platform'] ?? {})).toHaveLength(4 + 58 + 6);
    expect(Object.keys(s.uuids['t-alta'] ?? {})).toHaveLength(15 + 10);
    expect(Object.keys(s.uuids['t-lotos'] ?? {})).toHaveLength(3 + 23);
  });
});
