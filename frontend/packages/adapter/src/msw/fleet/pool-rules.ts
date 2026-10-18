// Правила межфирменного пула водителей (W2.51, контракт 0.6.0-stage2; S2-14, AUTH-06/07, D09, AC-06): время
// публикаций и запросов, временное назначение и его автозавершение. Состояние досчитывается лениво — при каждом
// обращении к пулу и при чтении рейса временным водителем (сервер сценариев не держит фоновых задач; W2.07 — воркер
// по индексам tenant 0014).
import type { components } from '@ortus/api-client';

import type { FleetData, PoolPublicationRow, TripRow } from './state.ts';

type S = components['schemas'];
type Transfer = S['DriverTransfer'];
type GrantState = S['TemporaryDriverGrant']['state'];

/**
 * Рейс начат и не закрыт: временный водитель после конца окна может только его закрыть (D09, AUTH-07) — довести,
 * сдать и доделать по доработке. Сданный рейс (submitted) приёмка ещё может вернуть на доработку, поэтому
 * назначение держится (closing) до приёмки или отмены (возврат 1, Q-W2.51-4).
 */
const RUNNING: ReadonlySet<S['TripState']> = new Set([
  'inspection',
  'defect_review',
  'on_route',
  'returning',
  'submitted',
  'rework',
]);
/** Рейс не начат: после конца окна временный водитель с него снимается («новая работа не допускается»). */
export const NOT_STARTED: ReadonlySet<S['TripState']> = new Set(['planned', 'assigned']);

export const overlaps = (a: S['TimeWindow'], b: S['TimeWindow']): boolean =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/** Окно `inner` целиком внутри `outer` (окно запроса — в свободном окне публикации). */
export const within = (inner: S['TimeWindow'], outer: S['TimeWindow']): boolean =>
  outer.startsAt <= inner.startsAt && inner.endsAt <= outer.endsAt;

/** Состояние назначения в момент `now` (без завершения). */
export function grantStateAt(
  grant: S['TemporaryDriverGrant'],
  trip: TripRow | undefined,
  now: string,
): GrantState {
  if (grant.state === 'ended') return 'ended';
  if (now < grant.validFrom) return 'scheduled';
  if (now < grant.validUntil) return 'active';
  return trip && RUNNING.has(trip.state) ? 'closing' : 'ended';
}

/** Снять временного водителя с рейса, который он не начал. */
export function unassignTemporary(trip: TripRow | undefined, x: Transfer): void {
  if (!trip || trip.driverMemberId !== x.driverMemberId || !NOT_STARTED.has(trip.state)) return;
  delete trip.driverMemberId;
  delete trip.driverDisplayName;
  trip.revision++;
}

/**
 * Момент завершения: конец окна; рейс, закрытый после окна, — момент приёмки (acceptedAt), отменённый после окна —
 * момент досчёта (отмена момента не хранит).
 */
function endOf(
  x: Transfer,
  grant: S['TemporaryDriverGrant'],
  trip: TripRow | undefined,
  now: string,
) {
  if (!trip || trip.driverMemberId !== x.driverMemberId) return grant.validUntil;
  if (trip.acceptedAt && trip.acceptedAt > grant.validUntil) return trip.acceptedAt;
  const late = grant.state === 'closing' && trip.state === 'cancelled' && now > grant.validUntil;
  return late ? now : grant.validUntil;
}

function complete(x: Transfer, trip: TripRow | undefined, now: string): void {
  const grant = x.grant;
  if (!grant) return;
  const end = endOf(x, grant, trip, now);
  x.status = 'completed';
  x.completedAt = end;
  grant.state = 'ended';
  grant.endedAt = end;
  grant.endReason = 'completed';
  x.revision++;
  unassignTemporary(trip, x);
}

/** Досчитать время пула: истечение публикаций и запросов, состояние и автозавершение назначений. */
export function settlePool(f: FleetData, now: string): void {
  for (const p of f.pool) {
    if (p.state === 'active' && now >= p.freeWindow.endsAt) {
      p.state = 'expired';
      p.revision++;
    }
  }
  for (const x of f.transfers) {
    if (x.status === 'requested' && now >= x.window.startsAt) {
      x.status = 'expired';
      x.revision++;
      continue;
    }
    if (x.status !== 'approved' || !x.grant) continue;
    const trip = x.tripId ? f.trips.find((t) => t.id === x.tripId) : undefined;
    const state = grantStateAt(x.grant, trip, now);
    if (state === 'ended') complete(x, trip, now);
    else x.grant.state = state;
  }
}

/**
 * Активная публикация водителя для запроса (описание requestDriverTransfer, возврат 2): названная карточкой каталога
 * (`publicationId`); без неё — та, чьё свободное окно содержит окно запроса, иначе пересекающаяся, иначе любая —
 * раньше начало freeWindow, затем меньший id. Окно вне выбранной отвечает 422 (поле window), 404 — только водителю
 * без активной публикации.
 */
export function publicationFor(
  f: FleetData,
  driverMemberId: string,
  window: S['TimeWindow'],
  publicationId?: string,
): PoolPublicationRow | undefined {
  const active = f.pool
    .filter((p) => p.driverMemberId === driverMemberId && p.state === 'active')
    .sort(
      (a, b) =>
        a.freeWindow.startsAt.localeCompare(b.freeWindow.startsAt) || a.id.localeCompare(b.id),
    );
  if (publicationId) return active.find((p) => p.id === publicationId.toLowerCase());
  return (
    active.find((p) => within(window, p.freeWindow)) ??
    active.find((p) => overlaps(p.freeWindow, window)) ??
    active[0]
  );
}

/**
 * Рейс, на который водитель попал через пул, виден ему только в сроке назначения (scheduled, active, closing):
 * после завершения или отзыва — 404 (AC-06). Рейсы без запроса пула — по обычному правилу «свой рейс».
 */
export function temporaryAccessOpen(
  f: FleetData,
  trip: TripRow,
  memberId: string,
  now: string,
): boolean {
  const mine = f.transfers.filter(
    (x) => x.tripId === trip.id && x.driverMemberId === memberId && x.grant,
  );
  if (!mine.length) return true;
  settlePool(f, now);
  return mine.some((x) => x.status === 'approved' && x.grant?.state !== 'ended');
}
