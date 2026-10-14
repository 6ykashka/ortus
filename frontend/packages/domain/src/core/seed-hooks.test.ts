import { describe, expect, it } from 'vitest';
import { DEMO, fixedClock } from './clock.ts';
import {
  SEED_STAGES,
  runSeedHooks,
  seedStagesFor,
  type SeedHook,
  type SeedStage,
} from './seed-hooks.ts';
import { altaFixture } from './testing/fixture.ts';

describe('хуки сида: порядок установки модулей (api.js:37–45)', () => {
  it('порядок: normProjects → service → knowledge → docs → chats → cash', () => {
    expect([...SEED_STAGES]).toEqual([
      'normProjects',
      'service',
      'knowledge',
      'docs',
      'chats',
      'cash',
    ]);
  });

  it('«Альта» — все стадии; «Лотос» — без normProjects и service; новая организация — все', () => {
    expect(seedStagesFor('t-alta')).toEqual(SEED_STAGES);
    expect(seedStagesFor('t-lotos')).toEqual(['knowledge', 'docs', 'chats', 'cash']);
    expect(seedStagesFor('t-new')).toEqual(SEED_STAGES);
  });

  it('runSeedHooks вызывает зарегистрированные хуки по порядку и пропускает отсутствующие', () => {
    const calls: string[] = [];
    const hook =
      (name: SeedStage): SeedHook =>
      (db, opts) => {
        calls.push(name + '@' + db.tenantId + '@' + opts.tenantId);
      };
    const hooks: Partial<Record<SeedStage, SeedHook>> = {
      cash: hook('cash'),
      knowledge: hook('knowledge'),
      service: hook('service'),
      normProjects: hook('normProjects'),
    };
    const alta = altaFixture();
    const ran = runSeedHooks(alta, hooks, { tenantId: 't-alta', clock: fixedClock(DEMO.now) });
    expect(ran).toEqual(['normProjects', 'service', 'knowledge', 'cash']);
    expect(calls).toEqual([
      'normProjects@t-alta@t-alta',
      'service@t-alta@t-alta',
      'knowledge@t-alta@t-alta',
      'cash@t-alta@t-alta',
    ]);

    calls.length = 0;
    const lotos = { ...altaFixture(), tenantId: 't-lotos' };
    expect(
      runSeedHooks(lotos, hooks, { tenantId: 't-lotos', clock: fixedClock(DEMO.now) }),
    ).toEqual(['knowledge', 'cash']);
  });
});
