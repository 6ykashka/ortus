// Место чата, очистка и удержание (chats.js 14.10:335–355, 546–559). Отличия от эталона (PD-60,
// бриф W7.10 §10):
// - `planStorage` считает на копии корзин и ничего не меняет в чате (`freeFor` эталона менял корзины
//   до `throw`: режим «Сжимать медиа» оставлял чат сжатым даже при отказе);
// - `heldMsg`: удержание действительно защищает сообщения (в эталоне `m.held` не выставлялось
//   нигде и `held()` всегда был ложным) — по чату целиком, по сотрудникам или по периоду;
// - `ALL_RE`: один разбор `@все` для проверки права и для рассылки.
import { ApiError } from '../../core/errors/index.ts';
import { gb, pluralN } from '../../core/format.ts';
import type { Chat, ChatBucket, ChatMessage, ChatPolicy } from './types.ts';

/** `@все` отдельным словом: и проверка права, и рассылка используют один и тот же разбор. */
export const ALL_RE = /(^|\s)@все(\s|$|[,.!?])/i;

/** Удержано ли сообщение: по чату целиком, по сотрудникам (`members`) или за период (`range`). */
export function heldMsg(c: Pick<Chat, 'hold'>, m: Pick<ChatMessage, 'by' | 'ts'>): boolean {
  const h = c.hold;
  if (!h) return false;
  if (h.members && !h.members.includes(m.by)) return false;
  if (h.range && (m.ts < h.range.from || m.ts > h.range.to)) return false;
  return true;
}

export interface StorageNote {
  title: string;
  text: string;
  icon: string;
}

export interface StoragePlan {
  usedMb: number;
  buckets: ChatBucket[];
  archivedMb?: number;
  /** Служебное сообщение в чат, если место освобождалось. */
  note?: StorageNote;
  /** Освобождено, МБ; `null` — освобождать не пришлось. */
  freed: number | null;
}

const full = (c: Pick<Chat, 'usedMb'>, quotaMb: number): ApiError =>
  new ApiError(
    'validation',
    'Место чата заполнено: ' +
      gb(c.usedMb) +
      ' из ' +
      gb(quotaMb) +
      '. Файлы не отправляются — текст, опросы и подтверждения работают. Освободите место в «Сведения › Хранение»',
  );

/**
 * Что будет с местом чата, если добавить `add` МБ. Чат не меняется: вызывающий применяет план после
 * успеха целиком (бросает `ApiError` `validation`, если места не хватило).
 */
export function planStorage(
  c: Pick<Chat, 'usedMb' | 'buckets'>,
  P: ChatPolicy,
  add: number,
): StoragePlan {
  const quota = P.quotaMb;
  if (!quota || c.usedMb + add <= quota) {
    return { usedMb: c.usedMb + add, buckets: c.buckets ?? [], freed: null };
  }
  const over = c.usedMb + add - quota;
  const buckets = structuredClone(c.buckets ?? []);
  const old = buckets.filter((b) => !b.hold && b.mb > 0).sort((a, b) => b.ageD - a.ageD);
  if (P.onFull === 'ring' || P.onFull === 'archive') {
    let freed = 0;
    let n = 0;
    for (const b of old) {
      if (freed >= over) break;
      const take = Math.min(b.mb, over - freed);
      const k = Math.max(1, Math.round((b.n * take) / b.mb));
      b.mb -= take;
      b.n = Math.max(0, b.n - k);
      freed += take;
      n += k;
    }
    if (freed < over) {
      throw new ApiError(
        'validation',
        'Место чата заполнено, а удалить можно только сохранённое в запись или под удержанием. Освободите место вручную',
      );
    }
    const archive = P.onFull === 'archive';
    return {
      usedMb: c.usedMb + add - freed,
      buckets: buckets.filter((b) => b.mb > 0),
      ...(archive ? { archivedMb: freed } : {}),
      freed,
      note: {
        title: archive
          ? 'Старые вложения перенесены в архив'
          : 'Удалены старые вложения: место чата',
        text:
          pluralN(n, 'файл', 'файла', 'файлов') +
          ' · ' +
          gb(freed) +
          (archive
            ? ' · открываются по запросу за 1–3 минуты'
            : ' · сохранённое в запись и под удержанием не тронуто'),
        icon: archive ? 'inventory_2' : 'autorenew',
      },
    };
  }
  if (P.onFull === 'compress') {
    let freed = 0;
    for (const b of old) {
      if ((b.kind === 'photo' || b.kind === 'video') && b.ageD > 30 && !b.compressed) {
        const f = Math.round(b.mb * 0.4);
        b.mb -= f;
        b.compressed = true;
        freed += f;
      }
    }
    const usedMb = c.usedMb - freed;
    if (usedMb + add <= quota) {
      return {
        usedMb: usedMb + add,
        buckets,
        freed,
        ...(freed
          ? {
              note: {
                title: 'Медиа сжато: место чата',
                text: 'Освобождено ' + gb(freed) + ' · оригиналы удалятся через 14 дней',
                icon: 'compress',
              },
            }
          : {}),
      };
    }
  }
  throw full(c, quota);
}

const CLEANUP: Readonly<Record<string, (b: ChatBucket) => boolean>> = {
  video90: (b) => b.kind === 'video' && b.ageD > 90,
  photo180: (b) => b.kind === 'photo' && b.ageD > 180,
  voice30: (b) => b.kind === 'voice' && b.ageD > 30,
  docs30: (b) => b.kind === 'doc' && b.ageD > 30,
};

export interface CleanupResult {
  n: number;
  mb: number;
  after: number;
  quota: number | null;
  saved: number;
  held: number;
  heldMb: number;
}

/** Очистка вложений по фильтрам: корзины под удержанием не затрагиваются. */
export function cleanupPlan(
  c: Pick<Chat, 'usedMb' | 'buckets' | 'savedMb'>,
  P: ChatPolicy,
  filters: readonly string[] | undefined,
): { res: CleanupResult; hit: ChatBucket[] } {
  const fl = (filters ?? []).filter((k) => CLEANUP[k]);
  if (!fl.length) throw new ApiError('validation', 'Выберите, что удалить');
  const all = c.buckets ?? [];
  const hit = all.filter(
    (b) => !b.hold && fl.some((k) => (CLEANUP[k] as (x: ChatBucket) => boolean)(b)),
  );
  const n = hit.reduce((a, b) => a + b.n, 0);
  const mb = hit.reduce((a, b) => a + b.mb, 0);
  const heldB = all.filter((b) => b.hold);
  return {
    hit,
    res: {
      n,
      mb,
      after: c.usedMb - mb,
      quota: P.quotaMb,
      saved: c.savedMb ?? 0,
      held: heldB.reduce((a, b) => a + b.n, 0),
      heldMb: heldB.reduce((a, b) => a + b.mb, 0),
    },
  };
}
