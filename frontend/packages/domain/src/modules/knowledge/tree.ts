// Дерево «Базы знаний» (knowledge.js 14.10:8, 64–69): путь от корня, дети по позиции, ветка, корни.
import type { KbNode, KnowledgeSlice } from './types.ts';

/** Защита от цикла в `parent`: путь не длиннее 40 узлов (как в эталоне). */
const PATH_GUARD = 40;

export const nodeOf = (K: KnowledgeSlice, id: string | null | undefined): KbNode | undefined =>
  id ? K.pages.find((p) => p.id === id) : undefined;

const byPos = (a: KbNode, b: KbNode): number => (a.pos ?? 0) - (b.pos ?? 0);

/** Путь от корня до узла включительно. */
export function kbPath(K: KnowledgeSlice, n: KbNode | undefined): KbNode[] {
  const out: KbNode[] = [];
  let x = n;
  let g = 0;
  while (x && g++ < PATH_GUARD) {
    out.unshift(x);
    x = nodeOf(K, x.parent);
  }
  return out;
}

/** Уровень узла: корень пространства — 1. */
export const kbDepth = (K: KnowledgeSlice, n: KbNode | undefined): number => kbPath(K, n).length;

/** Высота ветки с архивом: лист — 1. */
export function kbHeight(K: KnowledgeSlice, n: KbNode, guard = 0): number {
  if (guard >= PATH_GUARD) return 1;
  const kids = K.pages.filter((p) => p.parent === n.id);
  return 1 + Math.max(0, ...kids.map((c) => kbHeight(K, c, guard + 1)));
}

/** Дети узла (или корни при `id` пустом) по позиции; архив — только с `all`. */
export const kbKids = (K: KnowledgeSlice, id: string | null | undefined, all?: boolean): KbNode[] =>
  K.pages.filter((p) => (p.parent ?? null) === (id ?? null) && (all || !p.archived)).sort(byPos);

/** Узел и все его потомки в глубину (порядок хранения); архив — только с `all`. */
export function kbSubtree(K: KnowledgeSlice, n: KbNode, all?: boolean): KbNode[] {
  const out = [n];
  for (const c of K.pages) {
    if (c.parent === n.id && (all || !c.archived)) out.push(...kbSubtree(K, c, all));
  }
  return out;
}

/** Корни пространства по позиции. */
export const kbTop = (K: KnowledgeSlice, spaceId: string, all?: boolean): KbNode[] =>
  K.pages.filter((p) => p.space === spaceId && !p.parent && (all || !p.archived)).sort(byPos);

/** `ДД.ММ.ГГГГ…` → число ГГГГММДД для сравнения; иначе 0. */
export function dval(s: string | undefined): number {
  const m = /^(\d\d)\.(\d\d)\.(\d{4})/.exec(s ?? '');
  return m ? Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) : 0;
}
