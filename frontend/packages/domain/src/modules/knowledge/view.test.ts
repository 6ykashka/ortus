// Ответ сервера участнику (`kbView`, knowledge.js 14.10:212–222): только видимые страницы с «моими»
// правами, пространства по `kbSpaceMy` или видимым страницам, таблицы и записи видимых страниц,
// правила и журнал — только руководителю пространства.
import { describe, expect, it } from 'vitest';
import type { TenantDb } from '../../core/types/index.ts';
import { createAlta } from '../../seed/alta.ts';
import { createPlatform } from '../../seed/platform.ts';
import { migrateKnowledgeV2 } from './migrate-v2.ts';
import { knowledgeSeed } from './seed.ts';
import type { KbTenantDb, KnowledgeSlice } from './types.ts';
import { kbView } from './view.ts';
import { T } from './fixture.test-util.ts';

type Db = KbTenantDb & { knowledge: KnowledgeSlice };

function alta(): Db {
  const db = createAlta(createPlatform()) as TenantDb as Db;
  db.knowledge = knowledgeSeed('t-alta');
  migrateKnowledgeV2(db);
  db.knowledge.requests = [
    {
      id: 'kq-1',
      node: 'kb-1',
      space: 'sp-log',
      member: 'm-vasiliev',
      can: 'edit',
      at: '01.10 10:00',
      status: 'open',
    },
    {
      id: 'kq-2',
      node: 'kb-gen-1',
      space: 'sp-gen',
      member: 'm-kotova',
      can: 'edit',
      at: '01.10 10:05',
      status: 'open',
    },
  ];
  db.knowledge.entries = [
    {
      id: 'ke-1',
      page: 'kb-fin',
      at: '10:00',
      head: 'R-1',
      lines: [],
      src: { form: 'f', resp: 'R-1', fv: 1, rule: 'x', rv: 1 },
    },
    {
      id: 'ke-2',
      page: 'kb-5',
      at: '10:00',
      head: 'R-2',
      lines: [],
      src: { form: 'f', resp: 'R-2', fv: 1, rule: 'x', rv: 1 },
    },
  ];
  return db;
}

const view = (db: Db, actor: string, today?: string) =>
  kbView(db, actor, structuredClone(db.knowledge), today ? { today } : T);

describe('kbView', () => {
  it('до миграции v2 и без среза — срез как есть', () => {
    const db = createAlta(createPlatform()) as TenantDb as Db;
    db.knowledge = knowledgeSeed('t-alta');
    const C = structuredClone(db.knowledge);
    expect(kbView(db, 'm-vasiliev', C, T)).toBe(C);
    expect(kbView({ ...db, knowledge: undefined }, 'm-vasiliev', C, T)).toBe(C);
    expect(kbView(alta(), 'm-vasiliev', undefined, T)).toBeUndefined();
  });

  it('владелец: всё, у каждой страницы — права; правила и журнал всех пространств', () => {
    const db = alta();
    const v = view(db, 'm-owner');
    expect(v?.pages).toHaveLength(35);
    expect(v?.pages[0]?.my).toEqual({ edit: true, lead: true, create: true });
    expect(v?.spaces.map((s) => s.id)).toEqual(['sp-log', 'sp-spa', 'sp-own', 'sp-rep', 'sp-gen']);
    expect(v?.spaces[0]).toMatchObject({
      leads: ['Марина Котова'],
      my: { owner: true, lead: true },
    });
    expect(v?.rules).toHaveLength(5);
    expect(v?.runs).toHaveLength(3);
    expect(v?.requests?.map((r) => r.id)).toEqual(['kq-1', 'kq-2']);
    expect(v?.tables?.map((t) => t.id)).toEqual(['kt-insp']);
  });

  it('водитель: без финансов и закрытого пространства; свои запросы; без правил', () => {
    const v = view(alta(), 'm-vasiliev');
    const ids = new Set(v?.pages.map((p) => p.id));
    expect(ids.has('kb-1')).toBe(true);
    expect(ids.has('kb-drv-1')).toBe(true);
    expect(ids.has('kb-fin')).toBe(false);
    expect(ids.has('kb-fin-1')).toBe(false);
    expect(ids.has('kb-4')).toBe(false);
    expect(ids.has('kb-o-obj-42')).toBe(false);
    expect(v?.pages.find((p) => p.id === 'kb-1')?.my).toEqual({
      edit: false,
      lead: false,
      create: false,
    });
    expect(v?.spaces.map((s) => s.id)).toEqual(['sp-log', 'sp-spa', 'sp-rep', 'sp-gen']);
    expect(v?.spaces[0]?.my?.role).toBe('Читатель по уровню «Ограниченное»');
    expect(v?.entries?.map((e) => e.id)).toEqual(['ke-2']);
    expect(v?.tables?.map((t) => t.id)).toEqual(['kt-insp']);
    expect(v?.requests?.map((r) => r.id)).toEqual(['kq-1']);
    expect(v?.rules).toEqual([]);
    expect(v?.runs).toEqual([]);
  });

  it('руководитель «Логистики»: правила, журнал и запросы своего пространства', () => {
    const v = view(alta(), 'm-kotova');
    expect(v?.spaces.map((s) => s.id)).toEqual(['sp-log', 'sp-gen']);
    expect(v?.rules?.map((r) => r.id)).toEqual(['kr-1', 'kr-2']);
    expect(v?.runs?.map((r) => r.id)).toEqual(['krr-3']);
    expect(v?.requests?.map((r) => r.id)).toEqual(['kq-1', 'kq-2']);
    expect(v?.entries?.map((e) => e.id)).toEqual(['ke-1', 'ke-2']);
  });

  it('роль на ветку: пространство видно по страницам ветки; после срока — нет (PD-60)', () => {
    const db = alta();
    db.assignments.push({
      id: 'x1',
      member: 'm-morozova',
      role: 'r-kb-reader',
      scope: { type: 'page', id: 'kb-1' },
      until: '31.10.2026',
    });
    const v = view(db, 'm-morozova', '01.10.2026');
    expect(v?.pages.filter((p) => p.space === 'sp-log').map((p) => p.id)).toEqual([
      'kb-1',
      'kb-1a',
      'kb-1b',
    ]);
    expect(v?.spaces.find((s) => s.id === 'sp-log')?.my?.view).toBe(false);
    const late = view(db, 'm-morozova', '01.11.2026');
    expect(late?.spaces.some((s) => s.id === 'sp-log')).toBe(false);
  });

  it('страница среза без узла в БД проверяется сама', () => {
    const db = alta();
    const C = structuredClone(db.knowledge);
    C.pages.push({ id: 'kb-new', space: 'sp-gen', title: 'Новая', versions: [] });
    expect(kbView(db, 'm-vasiliev', C, T)?.pages.some((p) => p.id === 'kb-new')).toBe(true);
  });
});
