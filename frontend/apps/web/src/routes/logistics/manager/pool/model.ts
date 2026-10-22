// W2.23 · Модель «Ресурсного пула» (poolVM :3300–3319, модалка request :4026–4028; 03-logistics.md §6) на контракте
// 0.6.0-stage2 (W2.51): рейс запроса (эталон — всегда Р-211; здесь `?trip=` или первый не начатый без водителя),
// окна в часовом поясе окна, срок запроса — пересечение окна рейса и свободного окна водителя (Q-W2.51-10), карточки —
// каталог listAvailableDrivers, слитый по publicationId с исходящими запросами (открытый запрос на любой рейс, иначе
// последний запрос рейса задаёт чип и текст эталона; одобренный водитель уходит из каталога — карточка по запросу),
// тело requestDriverTransfer, входящие
// запросы фирмы-источника (Q-W2.51-2, no-reference).
import type { components } from '@ortus/api-client';
import { format, logisticsManager } from '@ortus/texts';

import { clockOf, dayOf } from '../fleet/model.ts';
import { POOL_TEXT as T } from './texts.ts';

type S = components['schemas'];

const P = logisticsManager.pool;
const R = logisticsManager.request;

export type Tone = 'ok' | 'info' | 'warn' | 'danger' | 'neutral';
export interface Chip {
  label: string;
  tone: Tone;
  icon: string;
}
export type PoolStatus = 'free' | 'requested' | 'approved' | 'rejected';
export interface DriverCard {
  key: string;
  publicationId?: string;
  driverMemberId: string;
  code: string;
  sub: string;
  home: string;
  homeId: string;
  chip: Chip;
  status: PoolStatus;
  rows: { term: string; value: string }[];
  canRequest: boolean;
  declined: boolean;
  pendingText?: string;
  approvedText?: string;
  freeWindow?: S['TimeWindow'];
  /** W2.73 · квалификации каталога («Кат. C · рефрижератор») — подзаголовок диалога 1a. */
  qual?: string;
  /** W2.73 · обычная машина водителя (S2-20 правило 1, 1a «Едет на своей обычной»). */
  usualVehicle?: S['PoolUsualVehicle'];
  /** W2.73 · одобренный запрос с машиной — карточка итога 1f («Машины рейса», «Журнал»). */
  transfer?: S['DriverTransfer'];
}
export interface IncomingRow {
  id: string;
  code: string;
  line: string;
  period: string;
  reason?: string;
  source: string;
  /** W2.73 · запрос целиком — машина запроса 1b (DriverTransfer.vehicle). */
  transfer: S['DriverTransfer'];
}

/** Рейс ещё не начат: водителя можно запросить и назначить (pool-rules NOT_STARTED MSW W2.51). */
const OPEN: ReadonlySet<S['TripState']> = new Set(['planned', 'assigned']);

const ms = (iso: string): number => Date.parse(iso);

/** «13:00–19:00» в часовом поясе окна; через полночь — «01.10 22:00 – 02.10 06:00». */
export function windowText(w: S['TimeWindow']): string {
  const tz = w.timeZone;
  const from = clockOf(w.startsAt, tz);
  const to = clockOf(w.endsAt, tz);
  if (dayOf(w.startsAt, tz) === dayOf(w.endsAt, tz)) return `${from}–${to}`;
  return format(T.windowDays, {
    from: untilText(w.startsAt, tz, true),
    to: untilText(w.endsAt, tz, true),
  });
}

/** Общая часть окон (строки исходных окон, часовой пояс первого); без пересечения — null. */
export function intersect(a: S['TimeWindow'], b: S['TimeWindow']): S['TimeWindow'] | null {
  const startsAt = ms(a.startsAt) >= ms(b.startsAt) ? a.startsAt : b.startsAt;
  const endsAt = ms(a.endsAt) <= ms(b.endsAt) ? a.endsAt : b.endsAt;
  return ms(startsAt) < ms(endsAt) ? { startsAt, endsAt, timeZone: a.timeZone } : null;
}

const shortDay = (iso: string, tz: string): string => dayOf(iso, tz).slice(0, 5);

/** «18:00 01.10» (q.until эталона); `dayFirst` — «01.10 18:00». */
export function untilText(iso: string, tz: string, dayFirst = false): string {
  const clock = clockOf(iso, tz);
  const day = shortDay(iso, tz);
  return dayFirst ? `${day} ${clock}` : `${clock} ${day}`;
}

/** Срок в диалоге (:4027): «Временно, до 18:00 01.10»; позже начала рейса — «Временно, с 15:00 до 18:00 01.10». */
export function periodText(trip: S['TimeWindow'], req: S['TimeWindow']): string {
  const tz = req.timeZone;
  const until = untilText(req.endsAt, tz);
  if (ms(req.startsAt) <= ms(trip.startsAt)) return format(R.periodUntil, { until });
  const sameDay = dayOf(req.startsAt, tz) === dayOf(req.endsAt, tz);
  const from = sameDay ? clockOf(req.startsAt, tz) : untilText(req.startsAt, tz);
  return format(T.periodFromUntil, { from, until });
}

/** «Р-211 · Охлаждённая продукция · 14:00–18:00» (openRequest :2816). */
export const tripLabel = (t: S['TripPlan']): string =>
  format(R.tripValue, { trip: t.number, title: t.title, window: windowText(t.plannedWindow) });

const byStart = (a: S['TripPlan'], b: S['TripPlan']): number =>
  ms(a.plannedWindow.startsAt) - ms(b.plannedWindow.startsAt) || a.number.localeCompare(b.number);

/**
 * Рейс запроса: `?trip=` (видимый рейс), иначе первый по началу окна не начатый рейс без водителя, иначе не начатый
 * рейс с одобренным исходящим запросом (временный водитель уже назначен — эталон остаётся на Р-211).
 */
export function pickTrip(
  trips: readonly S['TripPlan'][],
  outgoing: readonly S['DriverTransfer'][],
  param: string | null,
): S['TripPlan'] | null {
  if (param) {
    const t = trips.find((x) => x.id === param);
    if (t) return t;
  }
  const sorted = [...trips].sort(byStart);
  return (
    sorted.find((t) => OPEN.has(t.state) && !t.driverMemberId) ??
    sorted.find(
      (t) =>
        OPEN.has(t.state) && outgoing.some((x) => x.status === 'approved' && x.tripId === t.id),
    ) ??
    null
  );
}

/** Рейсы для выбора: не начатые, без водителя, с правом запроса на фирму рейса; по началу окна. */
export const requestTrips = (
  trips: readonly S['TripPlan'][],
  may: (unitId: string) => boolean,
): S['TripPlan'][] =>
  trips.filter((t) => OPEN.has(t.state) && !t.driverMemberId && may(t.orgUnitId)).sort(byStart);

const STATUS: ReadonlySet<S['DriverTransfer']['status']> = new Set([
  'requested',
  'approved',
  'rejected',
]);

/**
 * Запрос, статус которого показывает карточка публикации (:3305). Открытый (`requested`) запрос у публикации один на
 * любой рейс (driver_transfers_open_uq; второй — 409 «Запрос уже отправлен»): он и задаёт состояние, на каком бы рейсе
 * ни был. Иначе — последний по времени запрос; с `tripId` среди решённых — только запросы этого рейса и запросы без
 * рейса: одобрение или отказ на другом рейсе не задают состояние карточки выбранного (эталон с одним рейсом Р-211
 * смотрит все запросы водителя, Q-W2.23-1).
 */
export function latestByPublication(
  list: readonly S['DriverTransfer'][],
  tripId?: string,
): Map<string, S['DriverTransfer']> {
  const out = new Map<string, S['DriverTransfer']>();
  for (const x of list) {
    const open = x.status === 'requested';
    if (!open && tripId !== undefined && x.tripId !== undefined && x.tripId !== tripId) continue;
    const key = x.publicationId ?? `member:${x.driverMemberId}`;
    const cur = out.get(key);
    const curOpen = cur?.status === 'requested';
    const later = !cur || ms(x.requestedAt ?? '') >= ms(cur.requestedAt ?? '');
    if (open ? !curOpen || later : !curOpen && later) out.set(key, x);
  }
  return out;
}

const CHIP: Readonly<Record<PoolStatus, Chip>> = {
  requested: { label: P.chips.sent, tone: 'warn', icon: 'schedule' },
  approved: { label: P.chips.temporary, tone: 'ok', icon: 'verified' },
  rejected: { label: P.chips.rejected, tone: 'neutral', icon: 'block' },
  free: { label: P.free, tone: 'ok', icon: 'check_circle' },
};

const statusOf = (x: S['DriverTransfer'] | undefined): PoolStatus =>
  x && STATUS.has(x.status) ? (x.status as PoolStatus) : 'free';

const labelNo = (code: string): number | null => {
  const m = /#(\d+)$/.exec(code);
  return m ? Number(m[1]) : null;
};

/** Порядок карточек — по номеру псевдонима («Водитель #104» раньше «#117», как сид эталона). */
export function sortByLabel<T extends { code: string }>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const x = labelNo(a.code);
    const y = labelNo(b.code);
    if (x !== null && y !== null && x !== y) return x - y;
    return a.code.localeCompare(b.code, 'ru');
  });
}

/** Тексты статуса карточки (:536–541, :3312). */
function texts(
  x: S['DriverTransfer'] | undefined,
  code: string,
  home: string,
): Pick<DriverCard, 'pendingText' | 'approvedText'> {
  if (!x) return {};
  if (x.status === 'requested') return { pendingText: format(P.pending, { firm: home }) };
  if (x.status !== 'approved') return {};
  const until = x.grant?.validUntil ?? x.window.endsAt;
  return {
    approvedText: format(P.tempAssigned, {
      driver: code,
      trip: x.tripNumber ?? '',
      until: untilText(until, x.window.timeZone),
      firm: home,
    }),
  };
}

/**
 * W2.73 · Одобренный запрос с машиной (S2-20) показывает итог 1f вместо текста «… назначен на рейс …» эталона 14.10;
 * остальные — тексты статуса эталона.
 */
function outcome(
  x: S['DriverTransfer'] | undefined,
  code: string,
  home: string,
): Pick<DriverCard, 'pendingText' | 'approvedText' | 'transfer'> {
  if (x?.status === 'approved' && x.vehicle) return { transfer: x };
  return texts(x, code, home);
}

/**
 * Карточки пула (:3304–3317): каталог по publicationId + запросы без карточки каталога (открытые и одобренные).
 * Запросить можно свободного или отклонённого водителя, если у рейса нет водителя и одобренного запроса (busy),
 * окна пересекаются и у смотрящего есть право запроса на фирму рейса (`mayRequest`, не только чтение).
 */
export function cards(o: {
  catalog: readonly S['DriverAvailability'][];
  outgoing: readonly S['DriverTransfer'][];
  trip: S['TripPlan'] | null;
  mayRequest: boolean;
}): DriverCard[] {
  const trip = o.trip;
  const latest = latestByPublication(o.outgoing, trip?.id);
  const busy = !!trip && o.outgoing.some((x) => x.status === 'approved' && x.tripId === trip.id);
  const tripOpen = !!trip && OPEN.has(trip.state) && !trip.driverMemberId && !busy;
  const seen = new Set<string>();
  const out: DriverCard[] = o.catalog.map((d) => {
    const key = d.publicationId ?? `member:${d.driverMemberId}`;
    seen.add(key);
    const x = latest.get(key);
    const status = statusOf(x);
    const home = d.homeOrgUnitName ?? '';
    const fits = !!trip && !!intersect(trip.plannedWindow, d.freeWindow);
    return {
      key,
      ...(d.publicationId ? { publicationId: d.publicationId } : {}),
      driverMemberId: d.driverMemberId,
      code: d.displayName,
      sub: home
        ? format(P.qualHome, { qual: d.qualifications.join(' · '), home })
        : d.qualifications.join(' · '),
      home,
      homeId: d.homeOrgUnitId,
      chip: CHIP[status],
      status,
      rows: [
        { term: P.free, value: windowText(d.freeWindow) },
        ...(d.terms ? [{ term: P.terms, value: d.terms }] : []),
      ],
      canRequest: (status === 'free' || status === 'rejected') && tripOpen && fits && o.mayRequest,
      declined: status === 'rejected',
      freeWindow: d.freeWindow,
      ...(d.qualifications.length ? { qual: d.qualifications.join(' · ') } : {}),
      ...(d.usualVehicle ? { usualVehicle: d.usualVehicle } : {}),
      ...outcome(x, d.displayName, home),
    };
  });
  for (const [key, x] of latest) {
    if (seen.has(key) || (x.status !== 'requested' && x.status !== 'approved')) continue;
    const code = x.driverDisplayName ?? '';
    const home = x.sourceOrgUnitName ?? '';
    const status = statusOf(x);
    out.push({
      key,
      ...(x.publicationId ? { publicationId: x.publicationId } : {}),
      driverMemberId: x.driverMemberId,
      code,
      sub: home,
      home,
      homeId: x.sourceOrgUnitId,
      chip: CHIP[status],
      status,
      rows: [{ term: R.period, value: windowText(x.window) }],
      canRequest: false,
      declined: false,
      ...outcome(x, code, home),
    });
  }
  return sortByLabel(out);
}

/** reason запроса: комментарий для фирмы-владельца или «Запрос на рейс {номер}» (Q-W2.00-3). */
export const reasonOf = (comment: string, trip: S['TripPlan']): string =>
  comment.trim() || format(T.reasonDefault, { trip: trip.number });

/** Тело requestDriverTransfer: публикация карточки, рейс фирмы-получателя, окно — пересечение (Q-W2.51-10). */
export function requestBody(
  c: DriverCard,
  trip: S['TripPlan'],
  comment: string,
): S['DriverTransferCreate'] {
  const window =
    (c.freeWindow && intersect(trip.plannedWindow, c.freeWindow)) ?? trip.plannedWindow;
  return {
    driverMemberId: c.driverMemberId,
    sourceOrgUnitId: c.homeId,
    targetOrgUnitId: trip.orgUnitId,
    window,
    reason: reasonOf(comment, trip),
    tripId: trip.id,
    ...(c.publicationId ? { publicationId: c.publicationId } : {}),
  };
}

/** Входящие запросы фирмы-источника на решение (только `requested`), по началу срока. */
export function incomingRows(list: readonly S['DriverTransfer'][]): IncomingRow[] {
  return list
    .filter((x) => x.status === 'requested')
    .sort((a, b) => ms(a.window.startsAt) - ms(b.window.startsAt))
    .map((x) => {
      const firm = x.targetOrgUnitName ?? '';
      const tz = x.window.timeZone;
      return {
        id: x.id,
        code: x.driverDisplayName ?? '',
        line: x.tripNumber ? format(P.incoming.asks, { firm, trip: x.tripNumber }) : firm,
        period: format(logisticsManager.fleet.tripWhen, {
          date: dayOf(x.window.startsAt, tz),
          window: windowText(x.window),
        }),
        ...(x.reason ? { reason: x.reason } : {}),
        source: x.sourceOrgUnitName ?? '',
        transfer: x,
      };
    });
}
