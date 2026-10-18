// Последствия до сохранения (knowledge.js 14.10:183–210, docs/23 принцип 7): кто получит или потеряет
// чтение и правку при смене доступа ветки и при переносе под другого родителя.
import { describe, expect, it } from 'vitest';
import type { Assignment } from '../../core/types/index.ts';
import { ED, kbDb, node, T } from './fixture.test-util.ts';
import { kbImpact, kbMoveImpact } from './impact.ts';

const ILYIN: Assignment = {
  id: 'x1',
  member: 'm-ilyin',
  role: 'r-manager',
  scope: { type: 'region', id: 'r-msk' },
};

describe('kbImpact: смена доступа ветки', () => {
  it('«Как у родителя» на финансовой странице: чтение и правка расширяются', () => {
    const db = kbDb({ extra: [ILYIN] });
    expect(kbImpact(db, 'fin', { mode: 'inherit', list: [] }, T)).toEqual({
      pages: 2,
      inherit: 1,
      own: [],
      gainView: ['Сергей Ильин · 2'],
      loseView: [],
      gainEdit: ['Вера Котельникова · 2'],
      loseEdit: [],
      ids: new Set(['fin', 'fin-1']),
    });
  });

  it('«Только выбранные: редакторы» закрывает папку водителям', () => {
    const db = kbDb();
    const r = kbImpact(db, 'f-drv', { mode: 'listed', list: [ED] }, T);
    expect(r).toMatchObject({
      pages: 3,
      inherit: 1,
      own: ['Маршруты'],
      gainView: [],
      loseView: ['Илья Васильев · 3'],
      gainEdit: [],
      loseEdit: [],
    });
  });

  it('applyOwn сбрасывает свой доступ подстраниц на «Как у родителя»', () => {
    const db = kbDb();
    const r = kbImpact(db, 'f-drv', { mode: 'listed', list: [ED], applyOwn: true }, T);
    expect(r.gainEdit).toEqual(['Вера Котельникова · 1']);
    expect(r.loseView).toEqual(['Илья Васильев · 3']);
  });

  it('БД не меняется; узла нет — пустой ответ', () => {
    const db = kbDb();
    const before = structuredClone(db.knowledge);
    kbImpact(db, 'f-drv', { mode: 'inherit', list: [], applyOwn: true }, T);
    expect(db.knowledge).toEqual(before);
    expect(kbImpact(db, 'нет', { mode: 'inherit', list: [] }, T)).toEqual({
      pages: 0,
      inherit: 0,
      own: [],
      gainView: [],
      loseView: [],
      gainEdit: [],
      loseEdit: [],
      ids: new Set(),
    });
  });

  it('срок назначения учитывается (PD-60)', () => {
    const db = kbDb({ extra: [{ ...ILYIN, until: '30.09.2026' }] });
    expect(
      kbImpact(db, 'fin', { mode: 'inherit', list: [] }, { today: '01.10.2026' }).gainView,
    ).toEqual([]);
  });
});

describe('kbMoveImpact: перенос ветки', () => {
  it('из папки «Только выбранные» в корень — читателей больше', () => {
    const db = kbDb({ extra: [ILYIN] });
    expect(kbMoveImpact(db, 'drv-1', null, T)).toEqual({
      pages: 1,
      lose: [],
      gain: ['Сергей Ильин · 1'],
    });
  });

  it('внутрь папки водителей — ветка закрывается остальным', () => {
    const db = kbDb({ extra: [ILYIN] });
    expect(kbMoveImpact(db, 'kb-1', 'f-drv', T)).toEqual({
      pages: 2,
      lose: ['Сергей Ильин · 2'],
      gain: [],
    });
    expect(node(db, 'kb-1').parent).toBe('f-reg');
  });

  it('узла нет — пустой ответ', () => {
    expect(kbMoveImpact(kbDb(), 'нет', null, T)).toEqual({ pages: 0, lose: [], gain: [] });
  });
});
