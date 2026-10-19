// Правила межфирменного пула водителей (W2.51, контракт 0.6.0-stage2; S2-14, AUTH-06/07, D09, AC-06): время
// публикаций и запросов, временное назначение и его автозавершение. Состояние досчитывается лениво — при каждом
// обращении к пулу и при чтении рейса временным водителем (сервер сценариев не держит фоновых задач; W2.07 — воркер
// по индексам tenant 0014). W2.57 (контракт 0.6.2-stage2, решение Q-W2.07-1 «только рейс»): рейс начат с on_route;
// приёмка, отмена и снятие водителя с рейса гасят назначение сразу и в окне; отзыв начатого рейса оставляет только
// продолжение (closing) до его закрытия; просрочка — closing не сданного рейса; машина рейса — пока назначение
// scheduled/active; в продолжении водителю — только чтение, сдача, осмотр, расходы и фото этого рейса.
import type { components } from '@ortus/api-client';

import type { FleetData, PoolPublicationRow, TripRow } from './state.ts';

type S = components['schemas'];
type Transfer = S['DriverTransfer'];
type Grant = S['TemporaryDriverGrant'];
type GrantState = Grant['state'];

/**
 * Рейс начат и не закрыт (W2.57: с on_route): после конца окна или отзыва временный водитель может только его закрыть
 * (D09, AUTH-07) — довести, сдать и доделать по доработке. Сданный рейс (submitted) приёмка ещё может вернуть на
 * доработку, поэтому назначение держится (closing) до приёмки или отмены (Q-W2.51-4). Рейс на осмотре перед выездом
 * не начат: после окна выезд — новая работа.
 */
const STARTED: ReadonlySet<S['TripState']> = new Set([
  'on_route',
  'returning',
  'submitted',
  'rework',
]);
/** Рейс не начат: после конца окна временный водитель с него снимается («новая работа не допускается»). */
export const NOT_STARTED: ReadonlySet<S['TripState']> = new Set(['planned', 'assigned']);
/** Рейс закрыт — назначение гаснет моментом приёмки (или досчёта — у отмены момента нет). */
const CLOSED: ReadonlySet<S['TripState']> = new Set(['accepted', 'cancelled']);

/**
 * Права, которые продолжение начатого рейса оставляет временному водителю (D09; 08-domain-scenarios §4.6 п. 7–8):
 * видеть рейс, сдать его, осмотр сдачи, расходы и фото. Старт, бронь и решения менеджера — нет.
 */
const CONTINUATION = new Set([
  'fleet.trips.read',
  'fleet.trips.return',
  'fleet.inspections.read',
  'fleet.inspections.submit',
  'fleet.expenses.read',
  'fleet.expenses.create',
  'files.read',
  'files.upload',
]);

export const overlaps = (a: S['TimeWindow'], b: S['TimeWindow']): boolean =>
  a.startsAt < b.endsAt && b.startsAt < a.endsAt;

/** Окно `inner` целиком внутри `outer` (окно запроса — в свободном окне публикации). */
export const within = (inner: S['TimeWindow'], outer: S['TimeWindow']): boolean =>
  outer.startsAt <= inner.startsAt && inner.endsAt <= outer.endsAt;

/** Водитель перевода ведёт этот рейс. */
const drives = (trip: TripRow | undefined, x: Transfer): trip is TripRow =>
  !!trip && trip.driverMemberId === x.driverMemberId;

/** Рейс начат водителем перевода и не закрыт. */
const started = (trip: TripRow | undefined, x: Transfer): boolean =>
  drives(trip, x) && STARTED.has(trip.state);

/**
 * Состояние назначения в момент `now` (без завершения): отзыв начатого рейса — продолжение; закрытый рейс и рейс без
 * водителя перевода — конец сразу; до окна — scheduled, в окне — active, после — closing у начатого рейса.
 */
export function grantStateAt(
  x: Transfer,
  grant: Grant,
  trip: TripRow | undefined,
  now: string,
): GrantState {
  if (grant.state === 'ended') return 'ended';
  if (x.status === 'revoked') return started(trip, x) ? 'closing' : 'ended';
  if (trip && (!drives(trip, x) || CLOSED.has(trip.state))) return 'ended';
  if (now < grant.validFrom) return 'scheduled';
  if (now < grant.validUntil) return 'active';
  return started(trip, x) ? 'closing' : 'ended';
}

/** Снять временного водителя с рейса, который он не начал. */
export function unassignTemporary(trip: TripRow | undefined, x: Transfer): void {
  if (!trip || trip.driverMemberId !== x.driverMemberId || !NOT_STARTED.has(trip.state)) return;
  delete trip.driverMemberId;
  delete trip.driverDisplayName;
  trip.revision++;
}

/**
 * Момент конца назначения: рейс принят — момент приёмки; отменён или водитель снят — момент досчёта (момента рейс не
 * хранит); не начатый к концу окна — конец окна; закрытый после окна и сохранявший назначение — момент закрытия.
 */
function endOf(x: Transfer, grant: Grant, trip: TripRow | undefined, now: string): string {
  if (!trip) return grant.validUntil;
  if (drives(trip, x) && trip.state === 'accepted' && trip.acceptedAt) return trip.acceptedAt;
  const closedNow = !drives(trip, x) || trip.state === 'cancelled';
  if (closedNow && (grant.state === 'closing' || now < grant.validUntil)) return now;
  return grant.validUntil;
}

/** Завершить перевод (или продолжение отзыва): назначение кончилось в момент endOf. */
function end(x: Transfer, trip: TripRow | undefined, now: string): void {
  const grant = x.grant;
  if (!grant) return;
  const at = endOf(x, grant, trip, now);
  if (x.status === 'approved') {
    x.status = 'completed';
    x.completedAt = at;
    x.revision++;
    unassignTemporary(trip, x);
  }
  grant.state = 'ended';
  grant.endedAt = at;
  grant.endReason = x.status === 'revoked' ? 'revoked' : 'completed';
  delete grant.overdue;
  delete grant.vehicleId;
}

/** Признаки открытого назначения: просрочка в closing, машина рейса — пока scheduled или active. */
function mark(x: Transfer, grant: Grant, trip: TripRow | undefined, state: GrantState): void {
  grant.state = state;
  if (state === 'closing') grant.overdue = trip?.state !== 'submitted';
  else delete grant.overdue;
  const open = state === 'scheduled' || state === 'active';
  if (open && drives(trip, x) && trip.vehicleId) grant.vehicleId = trip.vehicleId;
  else delete grant.vehicleId;
}

/** Досчитать один перевод в момент `now`. */
export function settleTransfer(f: FleetData, x: Transfer, now: string): void {
  if (x.status === 'requested' && now >= x.window.startsAt) {
    x.status = 'expired';
    x.revision++;
    return;
  }
  if ((x.status !== 'approved' && x.status !== 'revoked') || !x.grant || x.grant.state === 'ended')
    return;
  const trip = x.tripId ? f.trips.find((t) => t.id === x.tripId) : undefined;
  const state = grantStateAt(x, x.grant, trip, now);
  if (state === 'ended') end(x, trip, now);
  else mark(x, x.grant, trip, state);
}

/** Досчитать время пула: истечение публикаций и запросов, состояние и автозавершение назначений. */
export function settlePool(f: FleetData, now: string): void {
  for (const p of f.pool) {
    if (p.state === 'active' && now >= p.freeWindow.endsAt) {
      p.state = 'expired';
      p.revision++;
    }
  }
  for (const x of f.transfers) settleTransfer(f, x, now);
}

/** Отзыв: рейс не начат — назначение кончается сейчас, водитель снимается; начат — остаётся продолжение (D09). */
export function revokeTransfer(f: FleetData, x: Transfer, now: string, by?: string): void {
  const trip = x.tripId ? f.trips.find((t) => t.id === x.tripId) : undefined;
  x.status = 'revoked';
  if (by) Object.assign(x, { revokedByMemberId: by }); // readOnly; decidedByMemberId — одобривший
  x.completedAt = now;
  if (!x.grant) return;
  if (started(trip, x)) {
    mark(x, x.grant, trip, 'closing');
    return;
  }
  x.grant.state = 'ended';
  x.grant.endedAt = now;
  x.grant.endReason = 'revoked';
  delete x.grant.overdue;
  delete x.grant.vehicleId;
  unassignTemporary(trip, x);
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
 * Рейс, на который водитель попал через пул, открыт ему только в сроке назначения (scheduled, active) по любому праву
 * `key`, в продолжении (closing, D09) — только по правам CONTINUATION; после завершения или отзыва не начатого рейса —
 * 404 (AC-06). Рейсы без запроса пула — по обычному правилу «свой рейс». Решает последний запрос водителя на рейс.
 */
export function temporaryAccessOpen(
  f: FleetData,
  trip: TripRow,
  memberId: string,
  now: string,
  key = 'fleet.trips.read',
): boolean {
  const mine = f.transfers.filter(
    (x) => x.tripId === trip.id && x.driverMemberId === memberId && x.grant,
  );
  const x = mine.at(-1);
  if (!x) return true;
  settlePool(f, now);
  if (x.status !== 'approved' && x.status !== 'revoked') return false;
  const state = x.grant?.state;
  if (state === 'closing') return CONTINUATION.has(key);
  return state === 'scheduled' || state === 'active';
}

/**
 * W2.57, возврат 3 (AC-06 по тегу Files, Q-W2.57-9; как files.Hider backend): родитель файла из рейса перевода —
 * рейс, его осмотр, расход или бронь — закрыт участнику `memberId`, когда рейс закрыт ему правом `key` (`files.read`,
 * `files.upload`). Бронь начатого рейса в продолжении закрыта тоже: фото выезда — новая работа (D09). Родитель вне
 * рейса пула и неизвестный родитель — по прежнему правилу mock W1.00.
 */
export function poolClosesParent(
  f: FleetData,
  owner: S['ObjectRef'],
  memberId: string,
  now: string,
  key: 'files.read' | 'files.upload',
): boolean {
  if (owner.moduleKey !== 'fleet') return false;
  const id = owner.entityId.toLowerCase();
  let tripId: string | undefined;
  let right: string = key;
  switch (owner.entityType) {
    case 'trip':
      tripId = id;
      break;
    case 'inspection':
      tripId = f.inspections.find((i) => i.id === id)?.tripId;
      break;
    case 'expense':
      tripId = f.expenses.find((e) => e.id === id)?.tripId;
      break;
    case 'reservation':
      tripId = f.reservations.find((r) => r.id === id)?.tripId;
      right = 'fleet.reservations.read';
      break;
    default:
      return false;
  }
  const trip = tripId === undefined ? undefined : f.trips.find((t) => t.id === tripId);
  return trip !== undefined && !temporaryAccessOpen(f, trip, memberId, now, right);
}

/** Машины фирм-получателей, открытые водителю его назначениями пула сейчас (машина рейса, область resource). */
export function loanedVehicles(f: FleetData, memberId: string, now: string): Set<string> {
  settlePool(f, now);
  const out = new Set<string>();
  for (const x of f.transfers) {
    const v = x.grant?.vehicleId;
    if (
      v &&
      x.driverMemberId === memberId &&
      x.status === 'approved' &&
      x.grant?.state === 'active'
    )
      out.add(v);
  }
  return out;
}
