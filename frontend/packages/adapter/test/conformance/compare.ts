// Сравнение ответа с примером контракта (W0.13, PD-43). UUID, которых нет в свежем состоянии сервера (новые
// объекты примеров: область `<организация>:example`, `t-example-new`), совпадают с любыми новыми UUID ответа —
// по порядку появления, в том числе внутри строк (ссылки загрузки). UUID сида сравниваются точно.
// Отклонения deviations.ts: ignore, subset, ids.
import { createScenarioState } from '../../src/msw/core/state.ts';
import type { Deviation } from './deviations.ts';

const UUID_G = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

/** UUID свежего состояния сервера (сид W0.12 и снимки примеров). */
const KNOWN = new Set(JSON.stringify(createScenarioState()).match(UUID_G) ?? []);

function mask(node: unknown, isNew: (u: string) => boolean, seen: Map<string, string>): unknown {
  if (typeof node === 'string') {
    return node.replace(UUID_G, (u) => {
      if (!isNew(u)) return u;
      if (!seen.has(u)) seen.set(u, `<new #${seen.size + 1}>`);
      return seen.get(u) ?? u;
    });
  }
  if (Array.isArray(node)) return node.map((x) => mask(x, isNew, seen));
  if (node && typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, mask(v, isNew, seen)]));
  }
  return node;
}

/** Удаляет путь вида `a.b[1].c` (в копии). */
function drop(node: unknown, path: string): unknown {
  const copy = structuredClone(node) as Record<string, unknown>;
  const parts = path.match(/[^.[\]]+/g) ?? [];
  let cur: unknown = copy;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = (cur as Record<string, unknown> | undefined)?.[parts[i] ?? ''];
  }
  const last = parts.at(-1) ?? '';
  if (Array.isArray(cur)) cur.splice(Number(last), 1);
  else if (cur && typeof cur === 'object') Reflect.deleteProperty(cur, last);
  return copy;
}

function sort(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sort);
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.keys(node)
        .sort()
        .map((k) => [k, sort((node as Record<string, unknown>)[k])]),
    );
  }
  return node;
}

const equal = (a: unknown, b: unknown): boolean =>
  JSON.stringify(sort(a)) === JSON.stringify(sort(b));

const fresh = (u: string): boolean => !KNOWN.has(u);

/** Новые UUID узла в порядке первого появления. */
function freshIds(node: unknown): string[] {
  const out: string[] = [];
  JSON.stringify(node).replace(UUID_G, (u) => {
    if (fresh(u) && !out.includes(u)) out.push(u);
    return u;
  });
  return out;
}

/**
 * Снимок ответа для записи в пример (пересъёмка PD-43): новые UUID ответа заменяются UUID примера в том же
 * порядке появления — пример остаётся в карте seed-ids; лишние новые UUID ответа остаются как есть.
 */
export function snapshot(example: unknown, actual: unknown): unknown {
  const from = freshIds(actual);
  const to = freshIds(example);
  const map = new Map(from.map((u, i) => [u, to[i] ?? u]));
  return JSON.parse(JSON.stringify(actual).replace(UUID_G, (u) => map.get(u) ?? u)) as unknown;
}

/** Приведённые к сравнению пример и ответ (для `expect(actual).toEqual(expected)`). */
export function prepare(
  example: unknown,
  actual: unknown,
  d?: Deviation,
): { expected: unknown; actual: unknown } {
  let e = example;
  let a = actual;
  for (const p of d?.kind === 'ignore' ? (d.paths ?? []) : []) {
    e = drop(e, p);
    a = drop(a, p);
  }
  if (d?.kind === 'subset') {
    const ei = ((e as { items?: unknown[] }).items ?? []).map((x) => mask(x, fresh, new Map()));
    const ai = ((a as { items?: unknown[] }).items ?? []).map((x) => mask(x, fresh, new Map()));
    const missing = ei.filter((x) => !ai.some((y) => equal(x, y)));
    e = { ...(e as object), items: missing.length ? missing : '<subset>' };
    a = { ...(a as object), items: '<subset>' };
  }
  const isNew = d?.kind === 'ids' ? () => true : fresh;
  return { expected: mask(e, isNew, new Map()), actual: mask(a, isNew, new Map()) };
}
