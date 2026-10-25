// Очереди «Обращений» (Обращения.dc.html:386–431 `listVM`): счётчики навигации, фильтры, поиск и
// сортировка по главному сроку. Чистые функции над срезом или проекцией участника.
import type { WorkCalendar } from './calendar.ts';
import { isOpen, slaHead } from './sla.ts';
import type { Rating, Sla, SlaHeadInfo } from './types.ts';

export type QueueKey = 'open' | 'noreply' | 'mine' | 'risk' | 'late' | 'wait' | 'low' | 'done';

export interface QueueDef {
  key: QueueKey;
  label: string;
  icon: string;
  /** Тон счётчика, когда он не нулевой. */
  tone?: 'warn' | 'danger';
}

export const QUEUES: readonly QueueDef[] = [
  { key: 'open', label: 'Открытые', icon: 'inbox' },
  { key: 'noreply', label: 'Без ответа', icon: 'mark_email_unread' },
  { key: 'mine', label: 'Мои', icon: 'person' },
  { key: 'risk', label: 'Срок под угрозой', icon: 'schedule', tone: 'warn' },
  { key: 'late', label: 'Срок нарушен', icon: 'error', tone: 'danger' },
  { key: 'wait', label: 'Ждут клиента', icon: 'hourglass_top' },
  { key: 'low', label: 'Низкие оценки', icon: 'sentiment_dissatisfied' },
  { key: 'done', label: 'Решено и закрыто', icon: 'task_alt' },
];

export interface QueueRequest {
  id: string;
  key: string;
  dir: string;
  kind: string;
  channel: string;
  title: string;
  status: string;
  assignee: string | null;
  at: number;
  sla: Sla;
  outcome?: string | null | undefined;
  resolvedAt?: number | null | undefined;
  oldKeys?: string[] | undefined;
  client: { name: string; org?: string | undefined };
}

export interface QueueSource<R extends QueueRequest> {
  directions: { id: string; cal: WorkCalendar }[];
  requests: R[];
  ratings: Rating[];
}

export interface QueueQuery {
  /** Ключ очереди; неизвестный — как «Открытые». */
  queue: string;
  /** Идентификатор направления или `'all'`. */
  dir: string;
  type?: string;
  channel?: string;
  /** Поиск: ключ, заголовок, имя клиента, компания, старые номера. */
  q?: string;
  /** Имя участника (очередь «Мои» сравнивает исполнителя по имени, как эталон). */
  me: string;
  now: number;
}

export interface QueueRow<R> {
  request: R;
  head: SlaHeadInfo;
}

const inDir = (dir: string, x: { dir: string }): boolean => dir === 'all' || x.dir === dir;

function heads<R extends QueueRequest>(S: QueueSource<R>, now: number): Map<string, SlaHeadInfo> {
  const out = new Map<string, SlaHeadInfo>();
  for (const r of S.requests) {
    const d = S.directions.find((x) => x.id === r.dir);
    if (d) out.set(r.id, slaHead(r, d, now));
  }
  return out;
}

type Pred<R> = (r: R) => boolean;

function predicates<R extends QueueRequest>(
  hd: Map<string, SlaHeadInfo>,
  me: string,
): Record<Exclude<QueueKey, 'low'>, Pred<R>> {
  const state = (r: R): string | undefined => hd.get(r.id)?.state;
  return {
    open: (r) => isOpen(r),
    noreply: (r) => isOpen(r) && !!r.sla.first && !r.sla.first.stopped,
    mine: (r) => isOpen(r) && r.assignee === me,
    risk: (r) => isOpen(r) && state(r) === 'risk',
    late: (r) => isOpen(r) && state(r) === 'late',
    wait: (r) => r.status === 'wait',
    done: (r) => !isOpen(r),
  };
}

const lowRatings = (S: { ratings: Rating[] }, dir: string): Rating[] =>
  S.ratings.filter((x) => inDir(dir, x) && x.status === 'open');

/** Счётчики очередей навигации для выбранного направления (без фильтров типа, канала и поиска). */
export function queueCounts<R extends QueueRequest>(
  S: QueueSource<R>,
  o: Pick<QueueQuery, 'dir' | 'me' | 'now'>,
): Record<QueueKey, number> {
  const pred = predicates<R>(heads(S, o.now), o.me);
  const reqs = S.requests.filter((r) => inDir(o.dir, r));
  const out = {} as Record<QueueKey, number>;
  for (const q of QUEUES) {
    out[q.key] = q.key === 'low' ? lowRatings(S, o.dir).length : reqs.filter(pred[q.key]).length;
  }
  return out;
}

/** Число открытых обращений по направлениям и во всех (`all`), не зависит от выбранного направления. */
export function directionCounts<R extends QueueRequest>(S: QueueSource<R>): Record<string, number> {
  const open = S.requests.filter((r) => isOpen(r));
  const out: Record<string, number> = { all: open.length };
  for (const d of S.directions) out[d.id] = open.filter((r) => r.dir === d.id).length;
  return out;
}

/** Строки очереди, отсортированные по срочности, и оценки очереди «Низкие оценки». */
export function requestQueue<R extends QueueRequest>(
  S: QueueSource<R>,
  o: QueueQuery,
): { rows: QueueRow<R>[]; ratings: Rating[] } {
  if (o.queue === 'low') return { rows: [], ratings: lowRatings(S, o.dir) };
  const hd = heads(S, o.now);
  const pred = predicates<R>(hd, o.me);
  const key = (QUEUES.find((x) => x.key === o.queue)?.key ?? 'open') as Exclude<QueueKey, 'low'>;
  const q = (o.q ?? '').trim().toLowerCase();
  const rows: QueueRow<R>[] = [];
  for (const r of S.requests) {
    const head = hd.get(r.id);
    if (!head || !inDir(o.dir, r) || !pred[key](r)) continue;
    if (o.type && r.kind !== o.type) continue;
    if (o.channel && r.channel !== o.channel) continue;
    if (q) {
      const hay = [r.key, r.title, r.client.name, r.client.org ?? '', ...(r.oldKeys ?? [])]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) continue;
    }
    rows.push({ request: r, head });
  }
  rows.sort((a, b) => a.head.rank - b.head.rank);
  return { rows, ratings: [] };
}

/** «Взять себе»: открыто, без исполнителя, есть право «Отвечать» и участник — в команде направления. */
export function takeable(
  r: Pick<QueueRequest, 'assignee' | 'status'>,
  d: { team?: string[] },
  me: string,
  canEdit: boolean,
): boolean {
  return !r.assignee && isOpen(r) && canEdit && (d.team ?? []).includes(me);
}
