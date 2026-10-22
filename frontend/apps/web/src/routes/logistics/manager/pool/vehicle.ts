// W2.73 · Модель S2-20 «Машина для временного водителя» (D-35; эталон design-2026-10-19b · «Временный водитель -
// варианты.dc.html», DoR docs/plan/v2/analysis/dor/s2-20-temporary-driver-vehicle.md §1.2, §1.3, §1.7) на контракте
// 0.6.3-stage2 (W2.71):
// - 1a — строки диалога «Запросить водителя» и блок «Машина» (renderVals :516–569): обычная машина публикации
//   (`DriverAvailability.usualVehicle`, правило 1) с проверкой подбора (правило 2: сервер `fit`/`freeForWindow`,
//   подпись причины — правила домена `compat`), подходящие свободные машины фирмы рейса, режим «Наша + можно свою» /
//   «Только наша» / «Своя машина водителя», итог «Что произойдёт после одобрения», тело `vehicle` запроса;
// - 1b — входящий запрос фирмы водителя (b :571–576);
// - 1f — итог запроса у логиста: «Машины рейса», «Журнал», сноска о сроке, «Оставить …» до выбора (f :609–625).
// Срок выбора — начало окна рейса минус 30 минут (TD-02). Тексты эталона — logisticsManager.request / pool,
// без эталона — POOL_TEXT.vehicle.
import type { components } from '@ortus/api-client';
import { num } from '@ortus/domain';
import {
  compat,
  type CompatResult,
  tempLabel,
  type Vehicle as DomainVehicle,
} from '@ortus/domain/modules';
import { format, home as homeText, logisticsManager } from '@ortus/texts';

import { clockOf, dayOf, tripOf, vehicleOf } from '../fleet/model.ts';
import { FLEET_TEXT } from '../fleet/texts.ts';
import { type Chip, tripLabel, untilText, windowText } from './model.ts';
import { POOL_TEXT } from './texts.ts';

type S = components['schemas'];

const R = logisticsManager.request;
const P = logisticsManager.pool;
const T = POOL_TEXT.vehicle;

/** Срок выбора — за 30 минут до начала окна рейса (правило 4, TD-02). */
const CHOOSE_BEFORE_MS = 30 * 60_000;

export type Mode = 'choice' | 'host' | 'home';

/** Машина фирмы рейса, подходящая рейсу и свободная (вариант «Ставим нашу машину»). */
export interface HostCar {
  id: string;
  model: string;
  plate: string;
  /** Рефрижератор — иконка `ac_unit` поля выбора (:170). */
  cold: boolean;
}

/** Обычная машина водителя (вариант «Едет на своей обычной», :154–164). */
export interface UsualCar {
  id: string;
  model: string;
  plate: string;
  firm: string;
  specs: string;
  fits: boolean;
  fitText: string;
  approve: string;
  /** Короткая причина для подсказки галочки (`choiceHint` :559); пусто, если подходит. */
  short: string;
}

export interface CarBlock {
  /** Фирма водителя («Доступ водителя … остаются в {фирма}»). */
  home: string;
  usual: UsualCar | null;
  hosts: HostCar[];
  hostHint: string;
  initial: Mode;
}

export interface CarState {
  block: CarBlock;
  mode: Mode;
  hostId: string | null;
}

export interface SumLine {
  icon: string;
  text: string;
  danger: boolean;
}

export interface CarView {
  homeOn: boolean;
  hostOn: boolean;
  choiceOn: boolean;
  choiceDisabled: boolean;
  blocked: boolean;
  eff: Mode | null;
  choiceHint: string;
  summary: SumLine[];
}

export interface IncomingCar {
  when: string;
  car?: string;
  usual?: { name: string; plate: string; free: string; hold: string };
  opens: string;
  opensDriver: string;
  hidden: string;
  note: string;
  /** Запрошена обычная машина: «Одобрить с машиной» / «Только водителя» / «Отклонить» (:222–224). */
  withUsual: boolean;
}

export interface TransferCar {
  key: string;
  name: string;
  plate: string;
  firm: string;
  chip: Chip;
}

export interface TransferView {
  trip: string;
  access: string;
  cars: TransferCar[];
  none: string | null;
  journal: { t: string; x: string }[];
  note: string | null;
  keep: { reservationId: string; label: string } | null;
}

const ms = (iso: string): number => Date.parse(iso);
const shortDay = (iso: string, tz: string): string => dayOf(iso, tz).slice(0, 5);
const chooseUntil = (startsAt: string): string =>
  new Date(ms(startsAt) - CHOOSE_BEFORE_MS).toISOString();
/** «18:00» в день начала рейса, иначе «06:00 02.10». */
const until = (iso: string, from: string, tz: string): string =>
  dayOf(iso, tz) === dayOf(from, tz) ? clockOf(iso, tz) : untilText(iso, tz);
/** Марка — первое слово модели («Hyundai» в «До рейса Hyundai работает…», :534). */
const brand = (model: string): string => model.split(/\s+/)[0] ?? model;

const pair = (min?: string, max?: string): [number, number] | null =>
  min !== undefined && max !== undefined ? [Number(min), Number(max)] : null;

/** Строки диалога 1a (:146–151): «Рейс» с датой, «Груз», «Доступ», «Согласует». */
export function requestRows(
  trip: S['TripPlan'],
  req: S['TimeWindow'],
  home: string,
): { term: string; value: string }[] {
  const tz = trip.plannedWindow.timeZone;
  const c = trip.cargo;
  const temp = pair(c.temperatureMinC, c.temperatureMaxC);
  const end = until(req.endsAt, trip.plannedWindow.startsAt, tz);
  const access =
    ms(req.startsAt) <= ms(trip.plannedWindow.startsAt)
      ? format(R.accessValue, { until: end })
      : format(T.accessFrom, {
          from: until(req.startsAt, trip.plannedWindow.startsAt, tz),
          until: end,
        });
  return [
    {
      term: R.trip,
      value: format(R.tripDateValue, {
        trip: trip.number,
        title: trip.title,
        date: shortDay(trip.plannedWindow.startsAt, tz),
        window: windowText(trip.plannedWindow),
      }),
    },
    {
      term: R.cargo,
      value: format(R.cargoValue, {
        mass: num(Number(c.weightKg) / 1000),
        volume: num(Number(c.volumeM3)),
        length: num(Number(c.lengthM)),
        temp: temp ? tempLabel(temp) : 'none',
      }),
    },
    { term: R.access, value: access },
    { term: R.approver, value: format(R.approverValue, { firm: home }) },
  ];
}

/** Причина «не подходит» по первой непройденной проверке подбора (правила домена, как у сервера). */
function reasonOf(c: CompatResult, cold: boolean): { long: string; short: string } | null {
  const bad = c.checks.slice(1).find((x) => !x.ok);
  if (!bad) return null;
  if (bad.key === 'temp' && !cold) {
    return { long: `${R.noCoolingReason} ${bad.need ?? ''}`.trim(), short: R.noCoolingReason };
  }
  const check = bad.label.toLowerCase();
  const long = bad.need
    ? format(T.reason, { check, value: bad.value, need: bad.need })
    : format(T.reasonPlain, { check, value: bad.value });
  return { long, short: long };
}

function usualOf(u: S['PoolUsualVehicle'], trip: S['TripPlan'], home: string): UsualCar {
  const temp = pair(u.temperatureMinC, u.temperatureMaxC);
  const free = u.freeForWindow ?? true;
  const dv: DomainVehicle = {
    id: u.vehicleId,
    unit: '',
    model: u.displayName,
    plate: u.registrationNumber,
    body: FLEET_TEXT.bodyTypes[u.bodyType],
    payloadT: Number(u.capacity.payloadKg) / 1000,
    volumeM3: Number(u.capacity.volumeM3),
    lengthM: Number(u.capacity.cargoLengthM),
    temp,
    odometer: 0,
    state: free ? 'free' : 'reserved',
    depot: '',
    heldBy: null,
  };
  const c = compat(dv, tripOf(trip));
  const fitOk = u.fit ? u.fit.ok : c.fit;
  const fits = fitOk && free;
  const why = fitOk
    ? free
      ? null
      : { long: T.busy, short: T.busy }
    : (reasonOf(c, !!temp) ?? { long: u.fit?.reasons[0] ?? '', short: u.fit?.reasons[0] ?? '' });
  return {
    id: u.vehicleId,
    model: u.displayName,
    plate: u.registrationNumber,
    firm: home,
    specs: format(R.homeSpecs, {
      body: dv.body,
      mass: num(dv.payloadT),
      volume: num(dv.volumeM3),
      length: num(dv.lengthM),
      // Минус эталона — U+2212 («−10…+10 °C», cars.home :504); tempLabel домена пишет дефис.
      temp: temp ? tempLabel(temp).replace(/-/g, '−') : R.noCooling,
    }),
    fits,
    fitText: fits
      ? format(R.homeFits, { window: windowText(trip.plannedWindow) })
      : format(R.homeNoFit, { reason: why?.long ?? '' }),
    approve: format(R.homeApprove, { firm: home }),
    short: why?.short ?? '',
  };
}

/**
 * Блок «Машина» (:152–176): обычная машина (нет — варианта «своя» нет, правило 1), подходящие свободные машины фирмы
 * рейса (своя бронь рейса — первой) и подсказка «Рейсу подходит N из M свободных машин {фирма}.», режим по умолчанию:
 * «Наша + можно свою», без подходящей нашей — «своя» (если подходит), иначе «Только наша».
 */
export function carBlock(o: {
  trip: S['TripPlan'];
  vehicles: readonly S['Vehicle'][];
  usual?: S['PoolUsualVehicle'];
  home: string;
  unit: string;
}): CarBlock {
  const dt = tripOf(o.trip);
  const own = o.vehicles.filter((v) => v.orgUnitId === o.trip.orgUnitId).map(vehicleOf);
  const free = own.filter((v) => v.state === 'free' || v.heldBy === o.trip.id);
  const hosts = own
    .filter((v) => compat(v, dt).ok)
    .sort((a, b) => +(b.heldBy === o.trip.id) - +(a.heldBy === o.trip.id))
    .map((v) => ({ id: v.id, model: v.model, plate: v.plate, cold: !!v.temp }));
  const usual = o.usual ? usualOf(o.usual, o.trip, o.home) : null;
  const initial: Mode = usual ? (hosts.length ? 'choice' : usual.fits ? 'home' : 'host') : 'host';
  return {
    home: o.home,
    usual,
    hosts,
    hostHint: format(R.hostCount, {
      fit: hosts.length,
      free: free.length,
      firm: o.unit || 'none',
    }),
    initial,
  };
}

/** Действующий режим: «своя» без подходящей — блок; «можно свою» без подходящей обычной — «Только наша». */
function effOf(s: CarState): { eff: Mode | null; host: HostCar | undefined; blocked: boolean } {
  const u = s.block.usual;
  const fits = !!u?.fits;
  const host = s.block.hosts.find((h) => h.id === s.hostId) ?? s.block.hosts[0];
  const mode = u ? s.mode : 'host';
  if (mode === 'home') return { eff: fits ? 'home' : null, host, blocked: !fits };
  if (!host) return { eff: null, host, blocked: false };
  return { eff: mode === 'choice' && fits ? 'choice' : 'host', host, blocked: false };
}

/** Состояние блока и итог «Что произойдёт после одобрения» (:531–559). */
export function carView(s: CarState, trip: S['TripPlan'], req: S['TimeWindow']): CarView {
  const u = s.block.usual;
  const fits = !!u?.fits;
  const { eff, host, blocked } = effOf(s);
  const homeOn = !!u && s.mode === 'home';
  const tz = trip.plannedWindow.timeZone;
  const window = windowText(trip.plannedWindow);
  const choose = clockOf(chooseUntil(trip.plannedWindow.startsAt), tz);
  const firm = s.block.home;
  const line = (icon: string, text: string, danger = false): SumLine => ({ icon, text, danger });
  let summary: SumLine[];
  if (blocked) summary = [line('error', R.sum.blocked, true)];
  else if (eff === 'choice' && host && u) {
    summary = [
      line(
        'event_available',
        format(R.sum.choiceHolds, {
          window,
          host: host.model,
          home: u.model,
          brand: brand(u.model),
          firm,
        }),
      ),
      line('touch_app', format(R.sum.choiceUntil, { until: choose })),
      line(
        'schedule',
        format(R.sum.choiceDefault, { host: host.model, brand: brand(u.model), firm }),
      ),
    ];
  } else if (eff === 'host' && host) {
    summary = [
      line('event_available', format(R.sum.host, { host: host.model, window })),
      line('photo_camera', R.sum.hostStart),
    ];
  } else if (eff === 'home' && u) {
    summary = [
      line('event_available', format(R.sum.home, { home: u.model, window, firm })),
      line('help', R.sum.homeOnly),
    ];
  } else summary = [line('info', T.noHost)];
  summary.push(
    line(
      'lock',
      format(R.sum.access, {
        trip: trip.number,
        until: until(req.endsAt, trip.plannedWindow.startsAt, tz),
        firm,
      }),
    ),
  );
  return {
    homeOn,
    hostOn: !homeOn,
    choiceOn: eff === 'choice',
    choiceDisabled: !fits,
    blocked,
    eff,
    choiceHint: !u
      ? ''
      : fits
        ? format(R.choiceHint, { until: choose, host: host?.model ?? '', home: u.model })
        : format(R.choiceOff, { reason: u.short }),
    summary,
  };
}

/** Тело `DriverTransferCreate.vehicle`; нет машины — запрос без машины, как в 0.6.2 (Q-W2.73-1). */
export function vehicleBody(s: CarState): S['DriverTransferVehicleCreate'] | undefined {
  const { eff, host } = effOf(s);
  if (eff === 'home') return { mode: 'home' };
  if (!host || !eff) return undefined;
  return { mode: eff === 'choice' ? 'host_or_home' : 'host', hostVehicleId: host.id };
}

/** Входящий запрос фирмы водителя (1b :202–228). */
export function incomingCar(x: S['DriverTransfer']): IncomingCar {
  const tz = x.window.timeZone;
  const window = windowText(x.window);
  const end = clockOf(x.grant?.validUntil ?? x.window.endsAt, tz);
  const v = x.vehicle;
  const host = v?.hostVehicle;
  const home = v?.homeVehicle;
  const I = P.incoming;
  let car: string | undefined;
  if (v?.mode === 'host_or_home' && host && home) {
    car = format(I.carChoice, { host: host.displayName, home: home.displayName });
  } else if (v?.mode === 'host' && host) {
    car = format(I.carHost, { host: host.displayName, plate: host.registrationNumber });
  } else if (v?.mode === 'home' && home) {
    car = format(I.carHome, { home: home.displayName, plate: home.registrationNumber });
  }
  const withUsual = !!v && v.mode !== 'host' && !!home;
  const source = x.sourceOrgUnitName ?? '';
  const target = x.targetOrgUnitName ?? '';
  return {
    when: format(I.whenValue, { date: shortDay(x.window.startsAt, tz), window, until: end }),
    ...(car ? { car } : {}),
    ...(withUsual && home
      ? {
          usual: {
            name: home.displayName,
            plate: home.registrationNumber,
            free: format(I.freeFor, { window }),
            hold:
              v?.mode === 'host_or_home'
                ? format(I.holdChoice, {
                    window,
                    until: clockOf(v.chooseUntil ?? chooseUntil(x.window.startsAt), tz),
                  })
                : format(I.holdHome, { window, trip: x.tripNumber ?? '', firm: target }),
          },
        }
      : {}),
    opens: format(I.opens, { firm: target }),
    opensDriver: format(I.opensDriver, { until: end }),
    hidden: format(I.hidden, { firm: source }),
    note: format(I.note, { firm: source }),
    withUsual,
  };
}

const HELD: ReadonlySet<string> = new Set(['held']);
const KEPT: ReadonlySet<string> = new Set(['confirmed', 'consumed']);

/** Итог запроса у логиста (1f): машины рейса, журнал, сноска о сроке, «Оставить …» до выбора. */
export function transferView(
  x: S['DriverTransfer'],
  trip: S['TripPlan'] | undefined,
  vehicles: readonly S['Vehicle'][] = [],
  unit = '',
): TransferView {
  const tz = x.window.timeZone;
  const at = (iso: string | undefined): string => (iso ? clockOf(iso, tz) : '');
  const v = x.vehicle;
  const tripNo = trip?.number ?? x.tripNumber ?? '';
  const window = windowText(trip?.plannedWindow ?? x.window);
  const source = x.sourceOrgUnitName ?? '';
  const F = P.transfer;
  const assigned: Chip = {
    label: format(logisticsManager.fleet.assignedTo, { trip: tripNo }),
    tone: 'info',
    icon: 'event_available',
  };
  const offered = [
    { kind: 'home' as const, ref: v?.homeVehicle },
    { kind: 'host' as const, ref: v?.hostVehicle },
  ].filter(
    (o): o is { kind: 'home' | 'host'; ref: S['TransferVehicle'] } => !!o.ref?.reservationId,
  );
  const two = offered.length === 2;
  const chipOf = (r: S['TransferVehicle']): Chip => {
    const st = r.reservationState ?? 'held';
    if (st === 'released' || st === 'expired') {
      return {
        label: format(F.released, { time: at(r.releasedAt) }),
        tone: 'neutral',
        icon: 'event_busy',
      };
    }
    if (two && HELD.has(st)) return { label: T.pendingChip, tone: 'warn', icon: 'hourglass_top' };
    if (two && KEPT.has(st) && r.chosenAt) {
      return {
        label: format(F.chosen, { time: at(r.chosenAt) }),
        tone: 'ok',
        icon: 'check_circle',
      };
    }
    return assigned;
  };
  const cars: TransferCar[] = offered.map(({ kind, ref }) => ({
    key: ref.vehicleId,
    name: ref.displayName,
    plate: ref.registrationNumber,
    firm: format(kind === 'home' ? F.usualFirm : F.ourFirm, { firm: ref.orgUnitName ?? '' }),
    chip: chipOf(ref),
  }));
  if (!cars.length && trip?.vehicleId) {
    const own = vehicles.find((y) => y.id === trip.vehicleId);
    if (own) {
      cars.push({
        key: own.id,
        name: own.displayName,
        plate: own.registrationNumber,
        firm: format(F.ourFirm, { firm: unit }),
        chip: assigned,
      });
    }
  }
  const hostName = v?.hostVehicle?.displayName ?? '';
  const homeName = v?.homeVehicle?.displayName ?? '';
  const journal: { t: string; x: string }[] = [];
  if (v && x.requestedAt) {
    journal.push({
      t: at(x.requestedAt),
      x: format(F.requested, { mode: v.mode, host: hostName }),
    });
  }
  if (v && x.status === 'approved' && x.decidedAt) {
    const dec = at(x.decidedAt);
    const what =
      v.mode === 'host'
        ? 'other'
        : v.homeDecision === 'approved'
          ? 'both'
          : v.homeDecision === 'declined'
            ? 'driver'
            : 'other';
    journal.push({ t: dec, x: format(F.approved, { firm: source, what }) });
    if (two) {
      journal.push({ t: dec, x: format(F.holds, { window, host: hostName, home: homeName }) });
      const chosen = offered.find((o) => KEPT.has(o.ref.reservationState ?? '') && o.ref.chosenAt);
      const other = offered.find((o) => o !== chosen && o.ref.reservationState === 'released');
      if (chosen && other) {
        const names = { chosen: chosen.ref.displayName, other: other.ref.displayName };
        const reason = other.ref.releaseReason;
        const text =
          reason === 'manager'
            ? format(T.kept, names)
            : reason === 'deadline'
              ? format(T.deadline, { ...names, firm: other.ref.orgUnitName ?? '' })
              : format(F.chose, names);
        journal.push({ t: at(chosen.ref.chosenAt), x: text });
      }
    } else if (offered[0]) {
      journal.push({ t: dec, x: format(F.one, { vehicle: offered[0].ref.displayName, window }) });
    } else journal.push({ t: dec, x: F.noVehicle });
  }
  const host = v?.hostVehicle;
  const undecided = two && offered.every((o) => HELD.has(o.ref.reservationState ?? ''));
  return {
    trip: trip ? tripLabel(trip) : tripNo,
    access: format(F.accessValue, { until: at(x.grant?.validUntil ?? x.window.endsAt) }),
    cars,
    none: !cars.length && x.status === 'approved' && v ? format(F.none, { firm: source }) : null,
    journal,
    note:
      two && v?.chooseUntil
        ? format(F.deadline, {
            until: at(v.chooseUntil),
            host: hostName,
            home: homeName,
            firm: source,
          })
        : null,
    keep:
      undecided && host?.reservationId
        ? {
            reservationId: host.reservationId,
            label: format(homeText.queue.actions.keepVehicle, { vehicle: host.displayName }),
          }
        : null,
  };
}
