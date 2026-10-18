// Дерево «Базы знаний» (knowledge.js 14.10:64–69): путь от корня, дети, ветка, корни пространства.
import { describe, expect, it } from 'vitest';
import { dval, kbDepth, kbHeight, kbKids, kbPath, kbSubtree, kbTop, nodeOf } from './tree.ts';
import type { KbNode, KnowledgeSlice } from './types.ts';

const n = (id: string, parent: string | null, pos: number, o: Partial<KbNode> = {}): KbNode => ({
  id,
  space: 'sp',
  title: id.toUpperCase(),
  parent,
  pos,
  versions: [],
  ...o,
});

const K = (): KnowledgeSlice => ({
  spaces: [{ id: 'sp', name: 'Пространство' }],
  pages: [
    n('b', null, 2),
    n('a', null, 1),
    n('a2', 'a', 2),
    n('a1', 'a', 1),
    n('a1x', 'a1', 1),
    n('arch', 'a', 3, { archived: true }),
    n('arch1', 'arch', 1),
    n('z', null, 0, { archived: true }),
    n('other', null, 1, { space: 'sp2' }),
  ],
});

describe('nodeOf и kbPath', () => {
  it('узел по id; нет — undefined', () => {
    expect(nodeOf(K(), 'a1')?.title).toBe('A1');
    expect(nodeOf(K(), 'нет')).toBeUndefined();
  });

  it('путь от корня до узла', () => {
    const k = K();
    expect(kbPath(k, nodeOf(k, 'a1x')).map((x) => x.id)).toEqual(['a', 'a1', 'a1x']);
    expect(kbPath(k, nodeOf(k, 'b')).map((x) => x.id)).toEqual(['b']);
    expect(kbPath(k, undefined)).toEqual([]);
  });

  it('родитель удалён — путь обрывается на узле; цикл — не больше 40 шагов', () => {
    expect(kbPath(K(), n('x', 'нет', 1)).map((x) => x.id)).toEqual(['x']);
    const loop: KnowledgeSlice = { spaces: [], pages: [n('p', 'q', 1), n('q', 'p', 1)] };
    expect(kbPath(loop, nodeOf(loop, 'p'))).toHaveLength(40);
  });

  it('глубина узла и высота ветки', () => {
    const k = K();
    expect(kbDepth(k, nodeOf(k, 'a1x'))).toBe(3);
    expect(kbDepth(k, nodeOf(k, 'a'))).toBe(1);
    expect(kbDepth(k, undefined)).toBe(0);
    expect(kbHeight(k, nodeOf(k, 'a') as KbNode)).toBe(3);
    expect(kbHeight(k, nodeOf(k, 'arch') as KbNode)).toBe(2);
    expect(kbHeight(k, nodeOf(k, 'b') as KbNode)).toBe(1);
  });
});

describe('kbKids, kbSubtree, kbTop', () => {
  it('дети по позиции; архив — только с all', () => {
    const k = K();
    expect(kbKids(k, 'a').map((x) => x.id)).toEqual(['a1', 'a2']);
    expect(kbKids(k, 'a', true).map((x) => x.id)).toEqual(['a1', 'a2', 'arch']);
    expect(kbKids(k, null).map((x) => x.id)).toEqual(['a', 'other', 'b']);
  });

  it('позиция по умолчанию — 0', () => {
    const k: KnowledgeSlice = {
      spaces: [],
      pages: [n('p2', 'r', 1), { id: 'p1', space: 'sp', title: 'P1', parent: 'r', versions: [] }],
    };
    expect(kbKids(k, 'r').map((x) => x.id)).toEqual(['p1', 'p2']);
  });

  it('ветка в глубину; архив — только с all', () => {
    const k = K();
    expect(kbSubtree(k, nodeOf(k, 'a') as KbNode).map((x) => x.id)).toEqual([
      'a',
      'a2',
      'a1',
      'a1x',
    ]);
    expect(kbSubtree(k, nodeOf(k, 'a') as KbNode, true).map((x) => x.id)).toEqual([
      'a',
      'a2',
      'a1',
      'a1x',
      'arch',
      'arch1',
    ]);
  });

  it('корни пространства по позиции', () => {
    const k = K();
    expect(kbTop(k, 'sp').map((x) => x.id)).toEqual(['a', 'b']);
    expect(kbTop(k, 'sp', true).map((x) => x.id)).toEqual(['z', 'a', 'b']);
    expect(kbTop(k, 'sp2').map((x) => x.id)).toEqual(['other']);
  });
});

describe('dval: дата ДД.ММ.ГГГГ для сравнения', () => {
  it.each([
    ['30.09.2026', 20260930],
    ['01.10.2026 10:42', 20261001],
    ['24.03.2027', 20270324],
    ['1.1.2026', 0],
    ['', 0],
    [undefined, 0],
  ])('%s → %s', (s, v) => {
    expect(dval(s)).toBe(v);
  });
});
