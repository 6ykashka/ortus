// Страницы списков (W0.13): курсор непрозрачен (`c<смещение>` в base64url), без offset-пагинации в контракте;
// limit 1…200, по умолчанию 50 (параметры Cursor и Limit контракта).
import { fail } from './problem.ts';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const encode = (n: number): string => btoa(`c${n}`).replace(/=+$/, '');

function decode(cursor: string): number {
  try {
    const m = /^c(\d+)$/.exec(atob(cursor));
    if (m) return Number(m[1]);
  } catch {
    // ниже — 400
  }
  return fail('malformed_request', 'Неверный курсор страницы.');
}

/** Лимит из query или 400 malformed_request. */
export function limitOf(query: URLSearchParams): number {
  const raw = query.get('limit');
  if (raw === null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!/^\d+$/.test(raw) || n < 1 || n > MAX_LIMIT) fail('malformed_request');
  return n;
}

/** Страница `items` по cursor/limit запроса: `{ items, nextCursor }`. */
export function page<T>(
  items: readonly T[],
  query: URLSearchParams,
): { items: T[]; nextCursor: string | null } {
  const limit = limitOf(query);
  const cursor = query.get('cursor');
  const from = cursor ? decode(cursor) : 0;
  const slice = items.slice(from, from + limit);
  const next = from + limit < items.length ? encode(from + limit) : null;
  return { items: slice, nextCursor: next };
}

/** Обязательный UUID в query или 400 malformed_request. */
export function uuidParam(
  query: URLSearchParams,
  name: string,
  required = true,
): string | undefined {
  const v = query.get(name);
  if (v === null)
    return required ? fail('malformed_request', `Нужен параметр ${name}.`) : undefined;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
    fail('malformed_request', `Параметр ${name} — не UUID.`);
  }
  return v.toLowerCase();
}
