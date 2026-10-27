// W5.11 · Модель страниц склада (`inventory`, `inventoryMovements`; контракт 0.12.0-stage5, тег Inventory): количества —
// десятичные строки `Quantity` (показ с запятой, ввод с запятой или точкой), партии в порядке FEFO (D-20 комплекта:
// сервер уже отдаёт их в этом порядке, страница не пересортировывает), срок годности по дате Москвы, строки остатков из
// остатка + позиции + склада, подписи движений и причина отказа 409 `invalid_transition`.
import { type components, ProblemError } from '@ortus/api-client';
import { errors } from '@ortus/texts';

import { INV_TEXT as T } from './texts.ts';

type S = components['schemas'];

export type Balance = S['InventoryBalance'];
export type Item = S['InventoryItem'];
export type Warehouse = S['Warehouse'];
export type Movement = S['InventoryMovement'];
export type Reservation = S['InventoryReservation'];
export type Unit = Item['baseUnit'];
export type MoveKind = Movement['kind'];

const NB = ' ';
const MSK = 'Europe/Moscow';

export const unitLabel = (u: Unit): string => T.units[u];

/** «1 250,5 мл»: запятая, неразрывные пробелы между тысячами и перед единицей. */
export function qty(value: string, unit: Unit): string {
  const [int = '0', frac] = value.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NB);
  return `${grouped}${frac ? `,${frac}` : ''}${NB}${unitLabel(unit)}`;
}

/**
 * Ввод количества: «40,5» или «40.5» → `"40.5"`; больше нуля (с `zero` — от нуля), не более шести знаков после
 * запятой; пусто и мусор — `null`.
 */
export function parseQuantity(input: string, o: { zero?: boolean } = {}): string | null {
  const s = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const [int = '0', frac] = s.split('.');
  const clean = `${int.replace(/^0+(?=\d)/, '')}${frac ? `.${frac}` : ''}`;
  if (!o.zero && !/[1-9]/.test(clean)) return null;
  return clean;
}

const ymd = new Intl.DateTimeFormat('en-CA', {
  timeZone: MSK,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const dateTime = new Intl.DateTimeFormat('ru-RU', {
  timeZone: MSK,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

/** Сегодняшняя дата по Москве, `YYYY-MM-DD`. */
export const todayMsk = (now: number): string => ymd.format(new Date(now));

/** `YYYY-MM-DD` → `ДД.ММ.ГГГГ`. */
export function dateRu(d: string): string {
  const [y = '', m = '', day = ''] = d.split('-');
  return `${day}.${m}.${y}`;
}

/** «ДД.ММ.ГГГГ, ЧЧ:ММ» по Москве. */
export const dateTimeRu = (iso: string): string => dateTime.format(new Date(iso));

/** Партия просрочена: срок раньше сегодняшнего дня (в день срока ещё годна). */
export const isExpired = (expiresOn: string | null, today: string): boolean =>
  expiresOn !== null && expiresOn < today;

export function lotLabel(
  expiresOn: string | null,
  today: string,
): { text: string; expired: boolean } {
  return expiresOn === null
    ? { text: T.stock.noExpiry, expired: false }
    : {
        text: T.stock.expiresOn.replace('{date}', dateRu(expiresOn)),
        expired: isExpired(expiresOn, today),
      };
}

export interface StockLine {
  key: string;
  balance: Balance;
  item: Item;
  warehouse: Warehouse;
}

/** Остатки сервера с позицией и складом, в порядке ответа; остаток без известной позиции или склада пропускается. */
export function stockRows(
  balances: readonly Balance[],
  items: readonly Item[],
  warehouses: readonly Warehouse[],
): StockLine[] {
  const byItem = new Map(items.map((i) => [i.id, i]));
  const byWarehouse = new Map(warehouses.map((w) => [w.id, w]));
  return balances.flatMap((balance) => {
    const item = byItem.get(balance.itemId);
    const warehouse = byWarehouse.get(balance.warehouseId);
    return item && warehouse
      ? [{ key: `${balance.warehouseId}:${balance.itemId}`, balance, item, warehouse }]
      : [];
  });
}

/** If-Match правки позиции: `"rev-<revision>"` (MSW и сервер). */
export const itemETag = (i: Item): string => `"rev-${String(i.revision)}"`;

export const moveKindLabel = (k: MoveKind): string => T.kinds[k];

/** Знак движения; у корректировки и сторно направления в ответе нет (Q-W5.11-6). */
export function moveSign(k: MoveKind): '+' | '−' | '→' | '' {
  switch (k) {
    case 'receipt':
      return '+';
    case 'issue':
      return '−';
    case 'transfer':
      return '→';
    default:
      return '';
  }
}

/** Сторнировать можно любое движение, кроме самого сторно. */
export const canReverse = (m: Pick<Movement, 'kind'>): boolean => m.kind !== 'reversal';

/** «Салон и SPA · запись» — основание движения или резерва. */
export function sourceLabel(ref: S['ObjectRef'] | undefined): string {
  if (!ref) return '';
  return `${T.modules[ref.moduleKey] ?? ref.moduleKey} · ${T.entities[ref.entityType] ?? ref.entityType}`;
}

export type StockReason = 'insufficient_stock' | 'lot_expired' | 'reservation_not_active';
const REASONS: readonly string[] = ['insufficient_stock', 'lot_expired', 'reservation_not_active'];

/** Причина отказа проведения (`Problem.reason` при 409 `invalid_transition`); чужая причина — `null`. */
export function reasonOf(e: unknown): StockReason | null {
  if (!(e instanceof ProblemError)) return null;
  const reason = (e.problem as { reason?: string } | undefined)?.reason;
  return reason && REASONS.includes(reason) ? (reason as StockReason) : null;
}

/** 422 `validation_failed`: нарушение поля `field` (или `lines[i].…`) — текст сервера для поля формы. */
export function violationOf(e: unknown, field: string): string | null {
  if (!(e instanceof ProblemError) || e.code !== 'validation_failed') return null;
  return e.problem?.violations?.find((v) => v.field === field)?.message ?? null;
}

/**
 * Ошибки полей формы из 422: текст нарушения — под своим полем из `fields`; сервер без `violations` (`problem.Body`,
 * Возврат 1 W2.41) отдаёт только `detail` — он без точки под первым полем списка, иначе общий текст `validation_failed`
 * (тост подавлен `quiet`, отказ не должен остаться незаметным). Не 422 — пусто: ошибку показал тост `run`.
 */
export function fieldErrors(e: unknown, fields: readonly string[]): Record<string, string> {
  if (!(e instanceof ProblemError) || e.code !== 'validation_failed') return {};
  const out: Record<string, string> = {};
  for (const f of fields) {
    const text = violationOf(e, f);
    if (text) out[f] = text;
  }
  const first = fields[0];
  if (!Object.keys(out).length && first) {
    out[first] = e.problem?.detail?.trim().replace(/\.$/, '') || errors.problem.validation_failed;
  }
  return out;
}
