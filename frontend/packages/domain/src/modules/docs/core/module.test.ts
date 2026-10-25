// Модуль «Документы · ядро»: контракт `DomainModule`, стадия сида `docs`, проекция.
import { describe, expect, it } from 'vitest';
import { DEMO, demoClock, fixedClock } from '../../../core/clock.ts';
import { composeCommands, createModuleCtx } from '../../../core/module.ts';
import { createFakeTaskPort } from '../../../core/testing/index.ts';
import type { TenantDb } from '../../../core/types/index.ts';
import { createAlta } from '../../../seed/alta.ts';
import { createPlatform } from '../../../seed/platform.ts';
import { altaDocs, doc } from './fixture.test-util.ts';
import { createDocsCoreModule, docsCoreModule, docsHook } from './module.ts';
import type { DocsTenantDb } from './types.ts';

const OPTS = { tenantId: 't-alta', clock: demoClock };

describe('docsCoreModule', () => {
  it('ключ, нет команд (их владеют W7.22 и W7.27), установка идемпотентна', () => {
    expect(docsCoreModule.key).toBe('docs');
    expect(docsCoreModule.methods).toEqual([]);
    const db = createAlta(createPlatform()) as TenantDb;
    docsCoreModule.install(db, OPTS);
    const once = JSON.stringify(db);
    docsCoreModule.install(db, OPTS);
    expect(JSON.stringify(db)).toBe(once);
    expect((db as DocsTenantDb).docs?.v1).toBe(true);
  });

  it('commands(ctx) пуст и собирается в реестр', () => {
    const ctx = createModuleCtx({
      getDb: () => createAlta(createPlatform()) as TenantDb,
      getActor: () => 'm-owner',
      clock: demoClock,
      tasks: createFakeTaskPort(),
    });
    expect(composeCommands([docsCoreModule], ctx)).toEqual({});
  });

  it('команды с чужими часами отклоняются', () => {
    const ctx = createModuleCtx({
      getDb: () => createAlta(createPlatform()) as TenantDb,
      getActor: () => 'm-owner',
      clock: fixedClock('2026-10-02T10:00:00+03:00'),
      tasks: createFakeTaskPort(),
    });
    expect(() => docsCoreModule.commands(ctx)).toThrow(/часы/);
    expect(() => createDocsCoreModule({ clock: ctx.clock }).commands(ctx)).not.toThrow();
  });

  it('view: null без среза; проекция участника без чужих документов', () => {
    const bare = createAlta(createPlatform()) as TenantDb;
    expect(docsCoreModule.view(bare, 'm-owner', undefined)).toBeNull();
    const db = altaDocs();
    const all = docsCoreModule.view(db, 'm-owner', undefined) as { items: { id: string }[] };
    expect(all.items).toHaveLength(db.docs.items.length);
    const mine = docsCoreModule.view(db, 'm-vasiliev', undefined) as { items: { id: string }[] };
    expect(mine.items.map((d) => d.id)).not.toContain('doc-pay');
    expect(doc(db, 'doc-pay').title).toContain('Начисления');
  });

  it('view не меняет срез БД и принимает свой срез', () => {
    const db = altaDocs();
    const before = JSON.stringify(db.docs);
    docsCoreModule.view(db, 'm-vasiliev', undefined);
    expect(JSON.stringify(db.docs)).toBe(before);
    const slice = structuredClone(db.docs);
    slice.items = slice.items.slice(0, 1);
    const r = docsCoreModule.view(db, 'm-owner', slice) as { items: unknown[] };
    expect(r.items).toHaveLength(1);
  });

  it('срок назначений считается по часам модуля (PD-60)', () => {
    const db = altaDocs();
    db.assignments.push({
      id: 'a-x',
      member: 'm-vasiliev',
      role: 'r-doc-read',
      scope: { type: 'folder', id: 'fd-o42' },
      until: '01.10.2026',
    });
    const day = (iso: string) => {
      const m = createDocsCoreModule({ clock: fixedClock(iso) });
      const v = m.view(db, 'm-vasiliev', undefined) as { items: { id: string }[] };
      return v.items.some((d) => d.id === 'doc-42');
    };
    expect(day('2026-10-01T12:00:00+03:00')).toBe(true);
    expect(day('2026-10-02T12:00:00+03:00')).toBe(false);
  });
});

describe('docsHook', () => {
  it('ставит документы в стадии `docs`, DEMO.docToday — часы документов', () => {
    const db = createAlta(createPlatform()) as TenantDb;
    docsHook(db, OPTS);
    expect((db as DocsTenantDb).docs?.items.length).toBeGreaterThan(0);
    expect(DEMO.docToday).toBe('01.10.2026');
  });
});
