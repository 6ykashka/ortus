// W4.50 · Модель видов на сервере и журнала «Выгрузки» страницы «Данные» (контракт 0.7.0-stage4 W4.06;
// 07-ux-and-data §3; журнал — no-reference, B-6). Строка журнала: набор, момент постановки в поясе задания, состояние,
// строки и срок файла, автор чужого задания (журнал владельца); «Скачать» — только автору готовой выгрузки (сервер
// отдаёт файл только ему), «Отменить» — у очереди, «Отозвать» — у готовой.
import type { components } from '@ortus/api-client';
import { int } from '@ortus/domain';
import { format } from '@ortus/texts';

import { querySort, type Sort } from './model.ts';
import { DATA_TEXT } from './texts.ts';

type S = components['schemas'];
type Job = S['DatasetExportJob'];

const T = DATA_TEXT.jobs;

export type JobTone = 'info' | 'ok' | 'warn' | 'error' | 'muted';

export interface JobView {
  id: string;
  title: string;
  /** Момент постановки «ДД.ММ, ЧЧ:ММ» в поясе задания. */
  at: string;
  state: string;
  tone: JobTone;
  /** Строки и срок файла, причина сбоя или отзыва, автор чужого задания — через « · ». */
  detail: string;
  download: boolean;
  stop: 'cancel' | 'revoke' | null;
  revision: number;
}

const TONES: Readonly<Record<Job['state'], JobTone>> = {
  queued: 'info',
  running: 'info',
  ready: 'ok',
  failed: 'error',
  expired: 'muted',
  revoked: 'warn',
};

const formats = new Map<string, Intl.DateTimeFormat>();

/** «01.10, 10:30» в поясе timeZone (пояс неизвестен браузеру — пояс браузера). */
function stamp(iso: string, timeZone: string): string {
  let f = formats.get(timeZone);
  if (!f) {
    const o: Intl.DateTimeFormatOptions = {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    };
    try {
      f = new Intl.DateTimeFormat('ru-RU', { ...o, timeZone });
    } catch {
      f = new Intl.DateTimeFormat('ru-RU', o);
    }
    formats.set(timeZone, f);
  }
  return f.format(new Date(iso));
}

function rowsText(j: Job): string | null {
  if (j.rowCount === undefined) return null;
  return format(j.truncated ? T.truncated : T.rows, { c: j.rowCount, n: int(j.rowCount) });
}

function reason(j: Job): string | null {
  if (j.state === 'failed' && j.failureCode) return T.failures[j.failureCode];
  if (j.state === 'revoked' && j.revokeReason) return T.reasons[j.revokeReason];
  return null;
}

/** Строка журнала; own — задание участника (его выгрузку можно скачать). */
export function jobView(j: Job, own: boolean): JobView {
  const parts: (string | null)[] = [];
  if (j.state === 'ready' || j.state === 'expired') parts.push(rowsText(j));
  if (j.state === 'ready' && j.expiresAt)
    parts.push(format(T.keep, { at: stamp(j.expiresAt, j.timeZone) }));
  parts.push(reason(j));
  if (!own) parts.push(j.requestedByDisplayName);
  let stop: JobView['stop'] = null;
  if (j.state === 'queued' || j.state === 'running') stop = 'cancel';
  else if (j.state === 'ready') stop = 'revoke';
  return {
    id: j.id,
    title: j.datasetName,
    at: stamp(j.createdAt, j.timeZone),
    state: T.states[j.state],
    tone: TONES[j.state],
    detail: parts.filter((p): p is string => !!p).join(' · '),
    download: own && j.state === 'ready',
    stop,
    revision: j.revision,
  };
}

/** Момент RFC 3339 для сравнения: миллисекунды и дробь секунды до наносекунд (сервер стенда держит микросекунды). */
function moment(iso: string): [number, string] {
  const frac = /\.(\d+)/.exec(iso)?.[1] ?? '';
  return [Date.parse(iso.replace(/\.\d+/, '')), frac.padEnd(9, '0')];
}

/**
 * Журнал «новые сверху»: позже поставлено — выше. Тот же момент (часы mock и стенда стоят): задание, которого не было в
 * прошлом ответе (prev), выше прежних; два прежних — в порядке прошлого ответа; два новых — в порядке сервера.
 */
export function orderJobs(next: readonly Job[], prev: readonly Job[]): Job[] {
  const was = new Map(prev.map((j, i) => [j.id, i]));
  const at = new Map(next.map((j, i) => [j.id, { m: moment(j.createdAt), i }]));
  return [...next].sort((a, b) => {
    const x = at.get(a.id);
    const y = at.get(b.id);
    if (!x || !y) return 0;
    if (x.m[0] !== y.m[0]) return y.m[0] - x.m[0];
    if (x.m[1] !== y.m[1]) return x.m[1] < y.m[1] ? 1 : -1;
    const pa = was.get(a.id);
    const pb = was.get(b.id);
    if (pa === undefined && pb !== undefined) return -1;
    if (pa !== undefined && pb === undefined) return 1;
    if (pa !== undefined && pb !== undefined) return pa - pb;
    return x.i - y.i;
  });
}

/** В журнале есть задание в очереди или в работе — журнал опрашивается до готовности. */
export const activeJobs = (list: readonly Job[]): boolean =>
  list.some((j) => j.state === 'queued' || j.state === 'running');

/** Профиль участника (id автора заданий и видов) по его аккаунту из /me/context. */
export function ownPerson(
  members: readonly { id: string; userId?: string }[],
  userId: string,
): string | undefined {
  return members.find((m) => m.userId === userId)?.id;
}

/** Запрос вида страницы: фильтр таблицы — поиск (фильтров по полям на странице нет), сортировка таблицы. */
export interface PageViewQuery {
  filters: [];
  search?: string;
  sort: S['QuerySort'][];
}

/** Запрос вида: поиск фильтра (пусто — без поиска) и сортировка таблицы. */
export function viewQuery(q: string, sort: Sort | null): PageViewQuery {
  const search = q.trim();
  return { filters: [], ...(search ? { search } : {}), sort: querySort(sort) };
}

/** Сортировка таблицы по первому ключу сортировки вида. */
export function viewSort(q: S['DatasetViewQuery']): Sort | null {
  const s = q.sort[0];
  return s ? { key: s.fieldKey, dir: s.direction } : null;
}
