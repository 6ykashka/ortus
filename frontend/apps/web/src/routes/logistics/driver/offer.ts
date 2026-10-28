// W2.74 · Модель машин на выбор водителю (S2-20, D-35; макеты «Временный водитель - варианты.dc.html» 1c–1e,
// renderVals :516–628; DoR S2-20 §1.4–§1.6, правила 4, 5, 8, 9) на броням контракта 0.7.1-stage4: брони рейса смены с
// `offerGroupId`, предложенные водителю — две `held` до `chooseUntil` (выбор), `confirmed` (выбрана водителем, логистом
// или сервером к сроку, или единственная), `released` (`releasedAt`, `releaseReason`). Подписи с фирмами — по
// названиям подразделений, если водителю их видно, иначе — нейтральные (OFFER_NO_REFERENCE).
import { type components, ProblemError } from '@ortus/api-client';
import { compat } from '@ortus/domain/modules';
import { format, logisticsDriver as L } from '@ortus/texts';
import type { IconName, Tone } from '@ortus/ui';

import {
  type CarCard,
  type Chip,
  domainTrip,
  domainVehicle,
  hhmm,
  MSK,
  type Plan,
  SIDES,
  type Vehicle,
  vehicleSpecs,
} from './model.ts';
import { OFFER as O, OFFER_NO_REFERENCE as N } from './offer-texts.ts';

type S = components['schemas'];
type Reservation = S['Reservation'];

export type OfferKind = 'host' | 'usual';

/** Карточка предложенной машины (1c `card` :578–581). */
export interface OfferCar {
  reservationId: string;
  vehicleId: string;
  kind: OfferKind;
  model: string;
  plate: string;
  icon: IconName;
  specs: string;
  place: string;
  /** «Подходит рейсу: масса, объём, длина, температура» — те же проверки, что у сервера (compat домена). */
  fits: boolean;
  tag: Chip;
  orgUnitId?: string;
}

export interface Released {
  model: string;
  plate: string;
  at: string;
}

export type Offer =
  | { state: 'two'; cars: OfferCar[]; chooseUntil: string; groupId: string }
  | {
      state: 'one';
      /** Группа предложения выбранной (или единственной) брони — по ней сообщение 409 offer_closed. */
      groupId: string;
      car: OfferCar;
      /** Выбрал водитель («Взять и начать осмотр»): сразу осмотр, без «Машина на сегодня». */
      chosen: boolean;
      /** Снятая бронь той же группы (выбор, срок, логист) — строка 1e «… освобождена в …». */
      released: Released | null;
    };

/** Имена машин предложения по id машины — то, что водитель видел до выбора. */
export type NameBook = Readonly<Record<string, { model: string; plate: string }>>;

const TAG: Readonly<Record<OfferKind, Chip>> = {
  usual: { label: O.tag.usual, tone: 'neutral', icon: 'history' },
  host: { label: O.tag.host, tone: 'info', icon: 'assignment_ind' },
};

const LIVE: ReadonlySet<Reservation['state']> = new Set(['held', 'confirmed']);

const kindOf = (r: Reservation): OfferKind => (r.offerKind === 'usual' ? 'usual' : 'host');

function carOf(
  r: Reservation,
  plan: Plan,
  vehicles: readonly Vehicle[],
  names: NameBook,
): OfferCar {
  const v = vehicles.find((x) => x.id === r.vehicleId);
  const kind = kindOf(r);
  if (!v) {
    const n = names[r.vehicleId];
    return {
      reservationId: r.id,
      vehicleId: r.vehicleId,
      kind,
      model: n?.model || '—',
      plate: n?.plate ?? '',
      icon: 'local_shipping',
      specs: '',
      place: '',
      fits: false,
      tag: TAG[kind],
    };
  }
  const dv = domainVehicle(v);
  return {
    reservationId: r.id,
    vehicleId: v.id,
    kind,
    model: dv.model,
    plate: dv.plate,
    icon: dv.temp ? 'ac_unit' : 'local_shipping',
    specs: vehicleSpecs(dv),
    place: v.depot ?? '',
    fits: compat(dv, domainTrip(plan)).fit,
    tag: TAG[kind],
    orgUnitId: v.orgUnitId,
  };
}

/** Брони рейса смены из предложения водителю рейса. */
function offered(reservations: readonly Reservation[], plan: Plan): Reservation[] {
  return reservations.filter(
    (r) =>
      r.tripId === plan.id &&
      !!r.offerGroupId &&
      (!plan.driverMemberId || !r.offeredToMemberId || r.offeredToMemberId === plan.driverMemberId),
  );
}

/**
 * Состояние предложения: `two` — две и больше `held` одной группы (выбор до `chooseUntil`); `one` — подтверждённая
 * (выбрана или единственная) или одна `held`. Брони сняты (перевод кончился) или предложения нет — `null`.
 */
export function offerOf(
  reservations: readonly Reservation[],
  plan: Plan,
  vehicles: readonly Vehicle[],
  names: NameBook = {},
): Offer | null {
  const mine = offered(reservations, plan);
  const live = mine.filter((r) => LIVE.has(r.state));
  if (!live.length) return null;
  const confirmed = live.find((r) => r.state === 'confirmed');
  const group = (confirmed ?? live[0])?.offerGroupId ?? '';
  const order = (a: Reservation, b: Reservation) =>
    Number(kindOf(a) === 'host') - Number(kindOf(b) === 'host');
  if (!confirmed) {
    const held = live.filter((r) => r.offerGroupId === group).sort(order);
    if (held.length > 1) {
      return {
        state: 'two',
        groupId: group,
        chooseUntil: held.find((r) => r.chooseUntil)?.chooseUntil ?? '',
        cars: held.map((r) => carOf(r, plan, vehicles, names)),
      };
    }
  }
  const pick = confirmed ?? live[0];
  if (!pick) return null;
  const other = mine.find(
    (r) =>
      r.offerGroupId === pick.offerGroupId &&
      r.id !== pick.id &&
      r.state === 'released' &&
      r.releaseReason !== 'transfer_ended',
  );
  let released: Released | null = null;
  if (other) {
    const v = vehicles.find((x) => x.id === other.vehicleId);
    const n = names[other.vehicleId];
    released = {
      model: v?.displayName ?? n?.model ?? '',
      plate: v?.registrationNumber ?? n?.plate ?? '',
      at: other.releasedAt ?? pick.chosenAt ?? '',
    };
  }
  return {
    state: 'one',
    groupId: pick.offerGroupId ?? '',
    car: carOf(pick, plan, vehicles, names),
    chosen: !!pick.chosenAt && other?.releaseReason === 'chosen',
    released,
  };
}

/**
 * 409 offer_closed: сообщение «Выбор машины уже закрыт …» — пока на рейсе предложение той же группы (после
 * перечитывания — машина на сегодня). Новое предложение логиста (другая группа) или конец перевода его снимают.
 */
export const offerClosedShown = (closedGroup: string | null, offer: Offer | null): boolean =>
  !!closedGroup && !!offer && offer.groupId === closedGroup;

// ---------------------------------------------------------------------------------------------
// Фирмы

export interface Firms {
  trip?: string | undefined;
  home?: string | undefined;
  unit: (id: string | undefined) => string | undefined;
}

/** Названия фирм рейса, водителя и машин — из подразделений, если они видны водителю (`org_units.read`). */
export function firmsOf(
  units: readonly { id: string; name: string }[] | undefined,
  plan: Plan,
  homeUnitId: string | undefined,
): Firms {
  const unit = (id: string | undefined) => (id ? units?.find((u) => u.id === id)?.name : undefined);
  return { trip: unit(plan.orgUnitId), home: unit(homeUnitId), unit };
}

/** Машина другой фирмы, чем рейс: её осмотр увидит и её фирма (правило 6). */
const foreign = (car: OfferCar, plan: Plan): boolean =>
  car.orgUnitId ? car.orgUnitId !== plan.orgUnitId : car.kind === 'usual';

// ---------------------------------------------------------------------------------------------
// Подписи 1c–1e

const tz = (plan: Plan): string => plan.plannedWindow.timeZone || MSK;

/** Чип рейса 1c (c.chip :582–584). */
export function offerChip(state: 'two' | 'one' | 'none'): Chip {
  const map: Record<'two' | 'one' | 'none', [Tone, IconName]> = {
    two: ['warn', 'touch_app'],
    one: ['info', 'event_available'],
    none: ['warn', 'hourglass_top'],
  };
  const [tone, icon] = map[state];
  return { label: O.chip[state], tone, icon };
}

/** 1c: срок выбора и строка о чате рейса (без ссылки, Q-W2.70-4). */
export function twoLines(offer: Extract<Offer, { state: 'two' }>, plan: Plan) {
  return {
    sub: format(O.chooseUntil, {
      time: offer.chooseUntil ? hhmm(offer.chooseUntil, tz(plan)) : '',
    }),
    footer: format(O.otherCar, { trip: plan.number }),
  };
}

export interface SheetItem {
  icon: IconName;
  tone?: 'warn';
  text: string;
}

/** 1d: лист «Берёте {модель}?» — что станет со второй машиной и кто увидит осмотр (d :592–596). */
export function sheetOf(
  pick: OfferCar,
  other: OfferCar | undefined,
  plan: Plan,
  firms: Firms,
): { title: string; sub: string; items: SheetItem[] } {
  const items: SheetItem[] = [];
  if (other) {
    const firm = firms.unit(other.orgUnitId);
    items.push({
      icon: 'event_busy',
      tone: 'warn',
      text: format(O.release, {
        model: other.model,
        plate: other.plate,
        to: firm ? format(O.releaseTo, { firm }) : N.releaseToOwn,
      }).replace(/\s+/g, ' '),
    });
  }
  items.push({ icon: 'photo_camera', text: format(N.next, { n: String(SIDES.length) }) });
  const car = firms.unit(pick.orgUnitId);
  const who = foreign(pick, plan)
    ? firms.trip && car
      ? format(O.whoBoth, { trip: firms.trip, car })
      : N.whoBothUnknown
    : firms.trip
      ? format(O.whoTrip, { trip: firms.trip })
      : N.whoTripUnknown;
  items.push({ icon: 'visibility', text: who });
  items.push({ icon: 'undo', text: O.onlyLogist });
  return {
    title: format(O.sheetTitle, { model: pick.model }),
    sub: format(O.sheetSub, { plate: pick.plate, mine: O.mine[pick.kind] }),
    items,
  };
}

/** 1e: «Бронь подтверждена сервером · {модель} до {конец окна}» и «{модель} {номер} освобождена в {время}». */
export function heldBanner(
  offer: Extract<Offer, { state: 'one' }>,
  plan: Plan,
): { held: string; released: string | null } {
  const zone = tz(plan);
  const r = offer.released;
  const at = r?.at ? hhmm(r.at, zone) : '';
  return {
    held: format(O.held, { model: offer.car.model, time: hhmm(plan.plannedWindow.endsAt, zone) }),
    released: r
      ? r.model
        ? format(O.released, { model: r.model, plate: r.plate, time: at }).replace(/\s+/g, ' ')
        : format(N.releasedUnknown, { time: at })
      : null,
  };
}

/** 1e: подзаголовок осмотра «{модель} · {номер} · {ваша обычная / поставил логист}». */
export const offerInspectionSub = (car: OfferCar): string =>
  format(O.inspectionSub, { model: car.model, plate: car.plate, mine: O.mine[car.kind] });

/** 1e: кто увидит осмотр (e.who :606). */
export function whoInspects(car: OfferCar, plan: Plan, firms: Firms): string {
  const name = firms.unit(car.orgUnitId);
  if (foreign(car, plan)) {
    return firms.trip && name
      ? format(O.inspectWhoBoth, { trip: firms.trip, car: name })
      : N.inspectWhoBothUnknown;
  }
  return firms.trip ? format(O.whoTrip, { trip: firms.trip }) : N.whoTripUnknown;
}

/** 1c, одна машина: кто поставил машину и что подтверждать не нужно (c.singleNote :589). */
export function oneNote(car: OfferCar, firms: Firms): string {
  const firm = firms.unit(car.orgUnitId);
  const who =
    car.kind === 'usual' ? (firm ? format(O.oneUsual, { firm }) : N.oneUsualUnknown) : O.oneHost;
  return who + O.oneNoConfirm;
}

/** 1c, машины нет: фирма водителя выдала его без обычной машины (:297). */
export function noneText(firms: Firms): string {
  return firms.home && firms.trip
    ? format(O.noneText, { home: firms.home, trip: firms.trip })
    : N.noneTextUnknown;
}

/** Почему выбор недоступен: нет связи (правило 5, D-09), пробный период, модуль отключён. */
export function offerBlock(
  online: boolean,
  tenantReadOnly: boolean,
  readOnly: boolean,
): { text: string; icon: IconName } | null {
  if (!online) return { text: N.offline, icon: 'cloud_off' };
  if (tenantReadOnly) return { text: L.notes.trialReserve, icon: 'lock_clock' };
  if (readOnly) return { text: L.notes.moduleReserve, icon: 'lock_clock' };
  return null;
}

// ---------------------------------------------------------------------------------------------
// Временный рейс и «Автомобили»

interface CapLike {
  permission: string;
  scope: { kind: string; resourceIds: readonly string[] };
}

/**
 * Рейс, на котором водитель не бронирует сам: есть предложение (выбор вместо брони, правила 4 и 9) или рейс чужой
 * фирмы — подразделения нет среди подразделений участника, и бронь (`fleet.reservations.create`) в нём не выдана ни
 * на организацию, ни на себя, ни на эту фирму (у роли «Временный водитель» брони нет — вариант (a) D-35 отклонён).
 * Подразделения участника в контексте бывают пустыми (сид mock) — решают права.
 */
export function isTemporaryTrip(
  plan: Plan,
  who: { orgUnitIds: readonly string[]; caps: readonly CapLike[] },
  hasOffer: boolean,
): boolean {
  if (hasOffer) return true;
  if (who.orgUnitIds.includes(plan.orgUnitId)) return false;
  return !who.caps.some(
    (c) =>
      c.permission === 'fleet.reservations.create' &&
      (c.scope.kind === 'tenant' ||
        c.scope.kind === 'self' ||
        (c.scope.kind === 'org_unit' && c.scope.resourceIds.includes(plan.orgUnitId))),
  );
}

/** Код отказа по праву из api/errors.yaml; другого общего имени в клиенте нет (строка в каждом модуле). */
const FORBIDDEN_ACTION = 'forbidden_action';

/**
 * Q-W2.92-1 (Q-W2.75-1): до окна рейса у временного водителя без предложенных машин listVehicles отвечает 403
 * forbidden_action (узкая роль, строк машин нет) — это «машины ещё нет», а не ошибка списка. Любая другая ошибка и
 * 403 у водителя своей фирмы остаются ошибкой.
 */
function carsListDenied(temporary: boolean, error: unknown): boolean {
  return (
    temporary &&
    error instanceof ProblemError &&
    error.status === 403 &&
    error.code === FORBIDDEN_ACTION
  );
}

/**
 * Q-W2.92-1: идёт выбор из двух машин — строки обеих открыты при согласовании, так что 403 списка машин здесь ошибка.
 * Одна поставленная машина («Поставить машину» логиста до окна) строку машины получает с начала окна: 403 — её названия
 * ещё нет («—»), но не ошибка смены.
 */
function choosingOffer(reservations: readonly Reservation[] | undefined, plan: Plan): boolean {
  return !!reservations && offerOf(reservations, plan, [])?.state === 'two';
}

/**
 * Ошибка списка машин «Моей смены» и «Автомобилей» временного водителя, которую показывать не нужно: 403
 * `forbidden_action` вне выбора из двух машин (Q-W2.92-1) — одна функция для обеих страниц.
 */
export function listDeniedForTrip(
  foreign: boolean,
  reservations: readonly Reservation[] | undefined,
  plan: Plan | null,
  error: unknown,
): boolean {
  return !!plan && !choosingOffer(reservations, plan) && carsListDenied(foreign, error);
}

/**
 * «Автомобили» временного водителя, список машин закрыт (403): карточка поставленной машины по брони — модель и номер
 * из запомненных имён или «—», как в «Машине на сегодня» («Моя смена»), без обещаний «Подходит рейсу».
 */
export function placedCard(car: OfferCar): CarCard {
  return {
    id: car.vehicleId,
    model: car.model,
    plate: car.plate,
    icon: car.icon,
    specs: car.specs,
    chip: car.tag,
    reasons: [],
    fit: false,
    ok: false,
    fitOk: false,
    canBook: false,
    mine: true,
    bookLabel: '',
    noBookLabel: '',
  };
}

/** Машины действующих броней предложения рейса («Автомобили» временного водителя — только предложенные). */
export function offeredVehicleIds(reservations: readonly Reservation[], plan: Plan): Set<string> {
  return new Set(
    offered(reservations, plan)
      .filter((r) => LIVE.has(r.state))
      .map((r) => r.vehicleId),
  );
}

// ---------------------------------------------------------------------------------------------
// Имена машин предложения (переживают перезагрузку вкладки)

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const NAMES_KEY = (group: string) => `ortus:driver-offer:${group}`;

/**
 * Запомнить имена машин предложения: после выбора невыбранную машину сервер водителю не показывает. Имена
 * дописываются к запомненным: после выбора список машин бывает перечитан раньше броней — карточка машины логиста
 * тогда без номера, и её имя, увиденное до выбора, не затирается (стенд, возврат 1).
 */
export function rememberNames(store: Store | null, group: string, cars: readonly OfferCar[]): void {
  if (!store || !group) return;
  const book: Record<string, { model: string; plate: string }> = { ...recallNames(store, group) };
  let changed = false;
  for (const c of cars) {
    if (!c.plate) continue;
    const was = book[c.vehicleId];
    if (was?.model === c.model && was.plate === c.plate) continue;
    book[c.vehicleId] = { model: c.model, plate: c.plate };
    changed = true;
  }
  if (!changed) return;
  try {
    store.setItem(NAMES_KEY(group), JSON.stringify(book));
  } catch {
    // хранилище недоступно (приватное окно, запрет сайта) — строка 1e без имени
  }
}

export function recallNames(store: Store | null, group: string): NameBook {
  if (!store || !group) return {};
  try {
    const raw = store.getItem(NAMES_KEY(group));
    return raw ? (JSON.parse(raw) as NameBook) : {};
  } catch {
    return {};
  }
}

/** sessionStorage вкладки или null (доступ к нему может бросить). */
export function sessionStore(): Store | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}
