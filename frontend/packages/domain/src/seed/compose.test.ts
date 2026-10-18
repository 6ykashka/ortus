// Сборка сида (план v2 §3.5, B §5.3): база организации → установка модулей пилота → стадии
// SEED_STAGES ядра (normProjects → service → knowledge → docs → chats → cash). Хуки стадий —
// пустые, пока модули этапов 4–7 не подключат свои.
import { describe, expect, it } from 'vitest';
import { demoClock } from '../core/clock.ts';
import { SEED_STAGES, type SeedHook, type SeedStage } from '../core/seed-hooks.ts';
import type { DomainModule } from '../core/module.ts';
import { createSeed, FUTURE_STAGE_HOOKS } from './compose.ts';

describe('createSeed', () => {
  it('две организации на одной платформе', () => {
    const s = createSeed();
    expect(Object.keys(s.dbs)).toEqual(['t-alta', 't-lotos']);
    expect(s.dbs['t-alta'].platform).toBe(s.platform);
    expect(s.dbs['t-lotos'].platform).toBe(s.platform);
    expect(s.dbs['t-alta'].vehicles).toHaveLength(7);
    expect(s.dbs['t-lotos'].members).toHaveLength(23);
    expect(s.dbs['t-lotos'].calendar.bookings).toHaveLength(6);
  });

  it('без утечек прототипа — календарь «Лотоса» только салонный', () => {
    const s = createSeed({ prototypeLeaks: false });
    expect(s.dbs['t-lotos'].calendar.resources.map((r) => r.id)).not.toContain('res-iv');
    expect(s.dbs['t-alta'].calendar.bookings).toHaveLength(6);
  });

  it('детерминирован; вызовы не делят объекты', () => {
    const a = createSeed();
    const b = createSeed();
    expect(a).toEqual(b);
    expect(a.platform).not.toBe(b.platform);
    expect(a.dbs['t-alta'].vehicles[0]).not.toBe(b.dbs['t-alta'].vehicles[0]);
  });

  it('порядок: модули пилота по реестру, затем стадии организации по порядку ядра', () => {
    const log: string[] = [];
    const mod = (key: 'logistics' | 'files'): DomainModule => ({
      key,
      install: (db) => {
        log.push(db.tenantId + ':' + key);
      },
      view: () => null,
      commands: () => ({}),
      methods: [],
      delays: {},
    });
    const hooks: Partial<Record<SeedStage, SeedHook>> = {};
    for (const st of SEED_STAGES)
      hooks[st] = (db) => {
        log.push(db.tenantId + ':' + st);
      };
    createSeed({ modules: [mod('logistics'), mod('files')], hooks });
    expect(log).toEqual([
      't-alta:logistics',
      't-alta:files',
      't-alta:normProjects',
      't-alta:service',
      't-alta:knowledge',
      't-alta:docs',
      't-alta:chats',
      't-alta:cash',
      't-lotos:logistics',
      't-lotos:files',
      't-lotos:knowledge',
      't-lotos:docs',
      't-lotos:chats',
      't-lotos:cash',
    ]);
  });

  it('хуки зарегистрированы для всех стадий; повторный прогон по готовому сиду ничего не меняет', () => {
    expect(Object.keys(FUTURE_STAGE_HOOKS)).toEqual([...SEED_STAGES]);
    const s = createSeed();
    const before = structuredClone(s.dbs['t-alta']);
    for (const st of SEED_STAGES)
      FUTURE_STAGE_HOOKS[st](s.dbs['t-alta'], { tenantId: 't-alta', clock: demoClock });
    expect(s.dbs['t-alta']).toEqual(before);
  });
});
