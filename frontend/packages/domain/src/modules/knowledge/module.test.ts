// Модуль «База знаний» по контракту `DomainModule` ядра: установка сырой БЗ, стадия сида `knowledge`
// (миграция v2), проекция и реестр команд. Подключение к реестру и `seed/compose.ts` — интегратор.
import { describe, expect, it } from 'vitest';
import { demoClock, fixedClock, type Clock } from '../../core/clock.ts';
import {
  composeCommands,
  composeDelays,
  createModuleCtx,
  type DomainModule,
} from '../../core/module.ts';
import { createFakeTaskPort } from '../../core/testing/index.ts';
import type { TenantDb } from '../../core/types/index.ts';
import { createSeed, FUTURE_STAGE_HOOKS } from '../../seed/compose.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { createPilotModules } from '../index.ts';
import { KB_METHODS, type KnowledgeApi } from './commands.ts';
import { createKnowledgeModule, knowledgeHook, knowledgeModule } from './module.ts';
import type { KbTenantDb, KnowledgeSlice } from './types.ts';

const seeded = () =>
  createSeed({
    modules: [...createPilotModules(), knowledgeModule as DomainModule],
    hooks: { ...FUTURE_STAGE_HOOKS, knowledge: knowledgeHook },
  });

describe('knowledgeModule', () => {
  it('ключ, методы и задержки', () => {
    expect(knowledgeModule.key).toBe('knowledge');
    expect(knowledgeModule.methods).toEqual(KB_METHODS);
    const db = createAlta(createPlatform()) as TenantDb;
    const ctx = createModuleCtx({
      getDb: () => db,
      getActor: () => 'm-owner',
      clock: demoClock,
      tasks: createFakeTaskPort(),
    });
    const cmds = composeCommands([knowledgeModule as DomainModule], ctx);
    expect(Object.keys(cmds).sort()).toEqual([...KB_METHODS].sort());
    expect(composeDelays([knowledgeModule as DomainModule]).saveKbPage).toBe(400);
  });

  it('createSeed: стадия knowledge — v2 у «Альты» и «Лотоса»', () => {
    const { dbs } = seeded();
    const alta = dbs['t-alta'] as KbTenantDb;
    const lotos = dbs['t-lotos'] as KbTenantDb;
    expect(alta.knowledge?.v2).toBe(true);
    expect(alta.knowledge?.pages).toHaveLength(35);
    expect(lotos.knowledge?.pages.map((p) => p.id)).toEqual(['kb-3', 'kb-home-sp-spa']);
  });

  it('install: сырая БЗ, повтор не затирает изменённые данные', () => {
    const db = createAlta(createPlatform()) as KbTenantDb;
    knowledgeModule.install(db, { tenantId: 't-alta', clock: demoClock });
    expect(db.knowledge?.v2).toBeUndefined();
    db.knowledge?.pages.pop();
    knowledgeModule.install(db, { tenantId: 't-alta', clock: demoClock });
    expect(db.knowledge?.pages).toHaveLength(4);
    knowledgeHook(db, { tenantId: 't-alta', clock: demoClock });
    expect(db.knowledge?.v2).toBe(true);
  });

  it('view: проекция копии среза; модуль не установлен — null', () => {
    const { dbs } = seeded();
    const db = dbs['t-alta'] as KbTenantDb & { knowledge: KnowledgeSlice };
    const v = knowledgeModule.view(db, 'm-vasiliev', db.knowledge);
    expect(v?.pages.some((p) => p.id === 'kb-fin')).toBe(false);
    expect(db.knowledge.pages.some((p) => 'my' in p)).toBe(false);
    expect(knowledgeModule.view(db, 'm-vasiliev', undefined)?.pages.length).toBe(v?.pages.length);
    const bare: KbTenantDb = { ...db, knowledge: undefined };
    expect(knowledgeModule.view(bare, 'm-owner', undefined)).toBeNull();
  });

  it('view: срок назначения — по часам модуля', () => {
    const { dbs } = seeded();
    const db = dbs['t-alta'] as KbTenantDb & { knowledge: KnowledgeSlice };
    db.assignments.push({
      id: 'x1',
      member: 'm-morozova',
      role: 'r-kb-reader',
      scope: { type: 'page', id: 'kb-1' },
      until: '31.10.2026',
    });
    const sees = (m: DomainModule<KnowledgeSlice | undefined>) =>
      m.view(db, 'm-morozova', db.knowledge)?.pages.some((p) => p.id === 'kb-1');
    expect(sees(knowledgeModule)).toBe(true);
    expect(sees(createKnowledgeModule({ clock: fixedClock('2026-11-02T10:00:00+03:00') }))).toBe(
      false,
    );
  });

  it('PD-60 по одним часам: команды с другими часами, чем у проекции, не собираются', () => {
    const db = createAlta(createPlatform()) as TenantDb;
    const ctx = (clock: Clock) =>
      createModuleCtx({
        getDb: () => db,
        getActor: () => 'm-owner',
        clock,
        tasks: createFakeTaskPort(),
      });
    const real = fixedClock('2026-11-02T10:00:00+03:00');
    const msg =
      'Модуль knowledge: часы команд (ModuleCtx.clock) не совпадают с часами проекции — ' +
      'создайте модуль createKnowledgeModule({ clock }) с часами адаптера';
    expect(() => composeCommands([knowledgeModule as DomainModule], ctx(real))).toThrow(msg);
    expect(() =>
      composeCommands([createKnowledgeModule({ clock: demoClock }) as DomainModule], ctx(real)),
    ).toThrow(msg);
    expect(() =>
      composeCommands([createKnowledgeModule({ clock: real }) as DomainModule], ctx(real)),
    ).not.toThrow();
  });

  it('PD-60 по одним часам: истёкшее назначение не открывает страницу ни в проекции, ни в командах', () => {
    for (const [iso, open] of [
      ['2026-10-01T10:30:00+03:00', true],
      ['2026-11-02T10:00:00+03:00', false],
    ] as const) {
      const { dbs } = seeded();
      const db = dbs['t-alta'] as KbTenantDb & { knowledge: KnowledgeSlice };
      db.assignments.push({
        id: 'x1',
        member: 'm-morozova',
        role: 'r-kb-reader',
        scope: { type: 'page', id: 'kb-1' },
        until: '31.10.2026',
      });
      const clock = fixedClock(iso);
      const m = createKnowledgeModule({ clock });
      const cmds = m.commands(
        createModuleCtx({
          getDb: () => db,
          getActor: () => 'm-morozova',
          clock,
          tasks: createFakeTaskPort(),
        }),
      ) as unknown as KnowledgeApi;
      const inView = !!m.view(db, 'm-morozova', db.knowledge)?.pages.some((p) => p.id === 'kb-1');
      let inCommands = true;
      try {
        cmds.kbRequest('kb-1', 'edit');
      } catch {
        inCommands = false;
      }
      expect([iso, inView, inCommands]).toEqual([iso, open, open]);
    }
  });
});
