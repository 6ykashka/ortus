// Контракт сценарного сервера (W0.13): выжимка `contract.gen.json` (scripts/contract.mjs) и поиск операции
// по методу и пути — те же правила, что у шлюза cmd/api W0.09 (`opIndex`): сегменты сравниваются как есть,
// статический сегмент сильнее параметра, раскодируются только значения параметров.
import raw from './contract.gen.json' with { type: 'json' };
import type { Contract, OperationInfo } from './types.ts';

export type * from './types.ts';

export const contract = raw as unknown as Contract;

const byId = new Map(contract.operations.map((o) => [o.id, o]));

/** Операция по operationId; неизвестная — ошибка разработки. */
export function operation(id: string): OperationInfo {
  const o = byId.get(id);
  if (!o) throw new Error(`операции ${id} нет в контракте ${contract.version}`);
  return o;
}

interface Route {
  op: OperationInfo;
  segments: string[];
  literals: number;
}

const isParam = (s: string): boolean => s.startsWith('{') && s.endsWith('}');

const routes: Route[] = contract.operations.map((op) => {
  const segments = op.path.replace(/^\/+|\/+$/g, '').split('/');
  return { op, segments, literals: segments.filter((s) => !isParam(s)).length };
});

function bind(segments: string[], parts: string[]): Record<string, string> | undefined {
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i] ?? '';
    const part = parts[i] ?? '';
    if (isParam(s)) {
      if (part === '') return undefined;
      try {
        params[s.slice(1, -1)] = decodeURIComponent(part);
      } catch {
        return undefined;
      }
    } else if (s !== part) {
      return undefined;
    }
  }
  return params;
}

export interface OperationMatch {
  op: OperationInfo;
  params: Record<string, string>;
}

/** Операция запроса: метод и путь «как на проводе» (без раскодирования, `%2F` остаётся в сегменте). */
export function findOperation(method: string, path: string): OperationMatch | undefined {
  if (!path.startsWith('/')) return undefined;
  const parts = path.slice(1).split('/');
  let best: OperationMatch | undefined;
  let bestLiterals = -1;
  for (const r of routes) {
    if (r.op.method !== method || r.segments.length !== parts.length) continue;
    if (r.literals <= bestLiterals) continue;
    const params = bind(r.segments, parts);
    if (params) {
      best = { op: r.op, params };
      bestLiterals = r.literals;
    }
  }
  return best;
}

/** Пример операции `op/name` или undefined. */
export function example(op: string, name: string): unknown {
  return contract.examples[op]?.[name];
}
