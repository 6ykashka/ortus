// W2.22 · Модель экрана водителя (driverVM :3422–3531, carCards :3403–3420, photoVM :3384–3401 эталона;
// 03-logistics.md §8–§10) на строках контракта 0.5.0-stage2: смена водителя, этапы, карточка рейса, машины с
// совместимостью (compat домена — те же правила, что у сервера), черновик осмотра → InspectionCreate,
// расход → TripExpenseCreate, итоги сдачи, разделы доработки, диалог «Завершить рейс».
import type { components } from '@ortus/api-client';
import { int, num, plural, rub } from '@ortus/domain';
import {
  compat,
  DEP_CHECKS,
  EXPENSE_CAT,
  inspMissing,
  odoError,
  PHOTO_SIDES,
  RET_CHECKS,
  tempLabel,
  type TempRange,
  TRIP_STATE,
  type Trip as DomainTrip,
  type Vehicle as DomainVehicle,
  type VehicleState,
  validateExpense,
  VEHICLE_STATE,
} from '@ortus/domain/modules';
import { errors, format, logisticsDriver as L, logisticsManager as LM } from '@ortus/texts';
import type { Consequence, IconName, Tone } from '@ortus/ui';

import { DRIVER_TEXT as T } from './texts.ts';

type S = components['schemas'];
export type Plan = S['TripPlan'];
export type Vehicle = S['Vehicle'];
export type TripState = S['TripState'];

export const MSK = 'Europe/Moscow';

export interface Chip {
  label: string;
  tone: Tone;
  icon: IconName;
}

// ---------------------------------------------------------------------------------------------
// Время и даты (часовой пояс рейса; по умолчанию — Москва)

const fmt = (iso: string, tz: string, o: Intl.DateTimeFormatOptions): string =>
  new Intl.DateTimeFormat('ru-RU', { timeZone: tz, ...o }).format(new Date(iso));

/** «09:00». */
export const hhmm = (iso: string, tz = MSK): string =>
  fmt(iso, tz, { hour: '2-digit', minute: '2-digit' });

/** «01.10.2026». */
export const ddmmyyyy = (iso: string, tz = MSK): string =>
  fmt(iso, tz, { day: '2-digit', month: '2-digit', year: 'numeric' });

/** «среда, 1 октября» (крошка «Сегодня», :665). */
export const crumbDate = (iso: string, tz = MSK): string =>
  fmt(iso, tz, { weekday: 'long', day: 'numeric', month: 'long' });

/** «2026-10-01» — дата момента в поясе `tz` (значение `<input type="date">`). */
export function isoDate(iso: string, tz = MSK): string {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const v = (k: string) => p.find((x) => x.type === k)?.value ?? '';
  return `${v('year')}-${v('month')}-${v('day')}`;
}

/** Полдень даты `YYYY-MM-DD` по Москве (UTC+3) — момент расхода (`occurredAt`). */
export const noonMsk = (date: string): string => `${date}T09:00:00Z`;

// ---------------------------------------------------------------------------------------------
// Смена водителя

const ACTIVE: ReadonlySet<TripState> = new Set([
  'planned',
  'assigned',
  'inspection',
  'defect_review',
  'on_route',
  'returning',
  'submitted',
  'rework',
]);

/** Смена водителя: первый незавершённый рейс по окну, иначе последний принятый (myTrip :2554). */
export function pickTrip(plans: readonly Plan[]): Plan | undefined {
  const sorted = [...plans].sort((a, b) =>
    a.plannedWindow.startsAt.localeCompare(b.plannedWindow.startsAt),
  );
  return (
    sorted.find((p) => ACTIVE.has(p.state)) ?? sorted.filter((p) => p.state === 'accepted').at(-1)
  );
}

const STEP_INDEX: Readonly<Record<TripState, number>> = {
  planned: 0,
  assigned: 0,
  inspection: 1,
  defect_review: 1,
  on_route: 2,
  returning: 3,
  rework: 3,
  submitted: 4,
  accepted: 5,
  cancelled: 0,
};

export type StepState = 'done' | 'current' | 'todo';

/** Этапы смены (:666–673, :3435–3439). */
export function steps(state: TripState): { label: string; n: string; state: StepState }[] {
  const idx = STEP_INDEX[state];
  const S2 = L.today.steps;
  return [S2.vehicle, S2.inspection, S2.trip, S2.return, S2.review].map((label, i) => ({
    label,
    n: String(i + 1),
    state: i < idx ? 'done' : i === idx ? 'current' : 'todo',
  }));
}

const tempOf = (min?: string, max?: string): TempRange | null =>
  min !== undefined && max !== undefined ? [Number(min), Number(max)] : null;

/** «01.10.2026 · 09:00–13:00 · 3 точки · 46 км · Сухой груз · 14 паллет-мест» (:3442). */
export function tripMeta(p: Plan): string {
  const tz = p.plannedWindow.timeZone || MSK;
  const n = p.stops.length;
  const F = L.today.stopForms;
  return format(L.today.tripMeta, {
    date: ddmmyyyy(p.plannedWindow.startsAt, tz),
    window: `${hhmm(p.plannedWindow.startsAt, tz)}–${hhmm(p.plannedWindow.endsAt, tz)}`,
    stops: String(n),
    stopsWord: plural(n, F.one, F.few, F.many),
    km: num(Number(p.distanceKm ?? 0)),
    cargo: p.cargo.description,
  });
}

/** Требования рейса к машине (:3443–3444). */
export function tripReq(p: Plan): { icon: IconName; text: string }[] {
  const c = p.cargo;
  const temp = tempOf(c.temperatureMinC, c.temperatureMaxC);
  return [
    { icon: 'scale', text: format(L.today.req.weight, { n: num(Number(c.weightKg) / 1000) }) },
    { icon: 'deployed_code', text: format(L.today.req.volume, { n: num(Number(c.volumeM3)) }) },
    { icon: 'straighten', text: format(L.today.req.length, { n: num(Number(c.lengthM)) }) },
    { icon: 'thermostat', text: temp ? tempLabel(temp) : L.vehicle.noCooling },
  ];
}

/** Чип состояния рейса (TRIP_STATE models.js; cancelled водителю не показывается). */
export function tripChip(state: TripState): Chip {
  const s = TRIP_STATE[state === 'cancelled' ? 'planned' : state];
  return { label: s.label, tone: s.tone as Tone, icon: s.icon };
}

// ---------------------------------------------------------------------------------------------
// Машины и совместимость

const VSTATE: Readonly<Record<Vehicle['status'], VehicleState>> = {
  available: 'free',
  reserved: 'reserved',
  in_use: 'on_route',
  blocked: 'review',
  maintenance: 'unavailable',
};

const BODY_LABEL: Readonly<Record<Vehicle['bodyType'], string>> = {
  tent: 'Тент',
  van: 'Фургон',
  refrigerated: 'Рефрижератор',
  box: 'Фургон',
  flatbed: 'Борт',
};

export function domainVehicle(v: Vehicle): DomainVehicle {
  const out: DomainVehicle = {
    id: v.id,
    unit: v.orgUnitId,
    model: v.displayName ?? v.registrationNumber,
    plate: v.registrationNumber,
    body: BODY_LABEL[v.bodyType] ?? v.bodyType,
    payloadT: Number(v.capacity.payloadKg) / 1000,
    volumeM3: Number(v.capacity.volumeM3),
    lengthM: Number(v.capacity.cargoLengthM),
    temp: tempOf(v.temperatureMinC, v.temperatureMaxC),
    odometer: Number(v.odometerKm),
    state: VSTATE[v.status] ?? 'unavailable',
    depot: v.depot ?? '',
    heldBy: v.heldByTripId ?? null,
  };
  if (v.statusNote) out.note = v.statusNote;
  return out;
}

export function domainTrip(p: Plan): DomainTrip {
  return {
    id: p.id,
    unit: p.orgUnitId,
    title: p.title,
    date: '',
    window: '',
    distanceKm: Number(p.distanceKm ?? 0),
    driverId: p.driverMemberId ?? null,
    driverName: p.driverDisplayName ?? null,
    vehicleId: p.vehicleId ?? null,
    status: p.state === 'cancelled' ? 'planned' : p.state,
    cargo: {
      weightT: Number(p.cargo.weightKg) / 1000,
      volumeM3: Number(p.cargo.volumeM3),
      lengthM: Number(p.cargo.lengthM),
      temp: tempOf(p.cargo.temperatureMinC, p.cargo.temperatureMaxC),
      kind: p.cargo.description,
    },
    stops: [],
    dep: null,
    ret: null,
    expenses: [],
    review: null,
    defect: null,
  };
}

export type CarsFilter = 'all' | 'fit' | 'free';

export interface CarCard {
  id: string;
  model: string;
  plate: string;
  icon: IconName;
  specs: string;
  chip: Chip;
  reasons: string[];
  /** Подходит грузу (без доступности). */
  fit: boolean;
  /** Подходит и доступна (compat.ok). */
  ok: boolean;
  /** «Подходит рейсу: масса, объём, длина и температура». */
  fitOk: boolean;
  canBook: boolean;
  mine: boolean;
  bookLabel: string;
  noBookLabel: string;
}

const isPlanned = (p: Plan): boolean => p.state === 'planned' || p.state === 'assigned';

/** «{кузов} · 1,5 т · 16 м³ · кузов 4,2 м · -18…+8 °C» (:3410). */
export function vehicleSpecs(v: DomainVehicle): string {
  const base = format(L.vehicle.specs, {
    body: v.body,
    payload: num(v.payloadT),
    volume: num(v.volumeM3),
    length: num(v.lengthM),
  });
  return v.temp ? `${base} · ${tempLabel(v.temp)}` : base;
}

/** Карточки машин (carCards :3403–3420): порядок — можно забронировать, затем подходят. */
export function carCards(
  vehicles: readonly Vehicle[],
  plan: Plan,
  blocked: boolean,
  filter: CarsFilter = 'all',
): CarCard[] {
  const planned = isPlanned(plan);
  const trip = domainTrip(plan);
  return vehicles
    .map((v) => {
      const dv = domainVehicle(v);
      const c = compat(dv, trip);
      const mine = v.heldByTripId === plan.id;
      const vs = VEHICLE_STATE[dv.state];
      const canBook = planned && c.ok && !blocked;
      const chip: Chip = mine
        ? {
            label: plan.state === 'assigned' ? L.vehicle.assignedByManager : L.vehicle.yours,
            tone: 'info',
            icon: 'event_available',
          }
        : { label: vs.label, tone: vs.tone as Tone, icon: vs.icon };
      const card: CarCard = {
        id: v.id,
        model: dv.model,
        plate: dv.plate,
        icon: dv.temp ? 'ac_unit' : 'local_shipping',
        specs: vehicleSpecs(dv),
        chip,
        reasons: c.reasons,
        fit: c.fit,
        ok: c.ok,
        fitOk: c.ok && planned,
        canBook,
        mine,
        bookLabel: mine ? L.vehicle.confirmReserve : L.vehicle.reserve,
        noBookLabel: !planned
          ? mine
            ? L.vehicle.inShift
            : L.vehicle.shiftRunning
          : !c.fit
            ? L.vehicle.unfit
            : !c.checks[0]?.ok
              ? VEHICLE_STATE.unavailable.label
              : L.vehicle.unavailable,
      };
      return { card, free: dv.state === 'free' };
    })
    .filter((k) => (filter === 'fit' ? k.card.fit : filter === 'free' ? k.free : true))
    .map((k) => k.card)
    .sort((a, b) => Number(b.canBook) - Number(a.canBook) || Number(b.fit) - Number(a.fit));
}

/** Почему бронь недоступна (blockedText :3446): нет связи, пробный период, модуль отключён. */
export function reserveBlock(
  online: boolean,
  tenantReadOnly: boolean,
  readOnly: boolean,
): { text: string; icon: IconName } | null {
  if (!online) return { text: L.notes.offlineReserve, icon: 'cloud_off' };
  if (tenantReadOnly) return { text: L.notes.trialReserve, icon: 'lock_clock' };
  if (readOnly) return { text: L.notes.moduleReserve, icon: 'lock_clock' };
  return null;
}

/** «ГАЗель Next А 412 МР 77 · держится до 11:00» (:3445; срок — holdExpiresAt, Q-W2.00-4). */
export function holdDetails(v: Vehicle | undefined, p: Plan): string {
  const vehicle = v ? `${v.displayName ?? ''} ${v.registrationNumber}`.trim() : '';
  const time = p.holdExpiresAt ? hhmm(p.holdExpiresAt, p.plannedWindow.timeZone || MSK) : '';
  return format(L.today.holdUntil, { vehicle, time });
}

// ---------------------------------------------------------------------------------------------
// Осмотр

export type SideKey = 'front' | 'back' | 'left' | 'right' | 'odo';
type PhotoRole = S['InspectionPhoto']['role'];

const ROLE: Readonly<Record<SideKey, PhotoRole>> = {
  front: 'front',
  back: 'rear',
  left: 'left',
  right: 'right',
  odo: 'odometer',
};

/** Ракурсы осмотра эталона (SIDES :2334) и роли контракта (`back` → `rear`, `odo` → `odometer`). */
export const SIDES: readonly { key: SideKey; label: string; role: PhotoRole }[] = PHOTO_SIDES.map(
  ([key, label]) => ({ key: key as SideKey, label, role: ROLE[key as SideKey] }),
);

/** queued — фото на устройстве ждёт связи (W2.24, photoVM :3391). */
export type SlotState = 'empty' | 'uploading' | 'failed' | 'queued' | 'ready';

export interface Slot {
  state: SlotState;
  progress: number;
  fileId?: string;
  url?: string;
  error?: string;
  capturedAt?: string;
}

export const EMPTY_SLOT: Slot = { state: 'empty', progress: 0 };

const STRIPES = 'repeating-linear-gradient(135deg,#E9EDE6 0 8px,#E0E5DD 8px 16px)';

export interface PhotoView {
  border: string;
  icon: IconName;
  status: string;
  stFg: string;
  stIcon: IconName;
  img: string;
  fg: string;
  showIcon: boolean;
  labelBg: string;
  uploading: boolean;
  ready: boolean;
  failed: boolean;
  progress: number;
  aria: string;
}

/** Слот фото (photoVM :3384–3401) без демо; «На устройстве · ждёт связи» — фото без связи (W2.24). */
export function photoView(p: Slot, label: string): PhotoView {
  const P = L.photo;
  const map: Record<SlotState, [string, IconName, string, string, IconName]> = {
    empty: ['1.5px dashed #AEB9B2', 'photo_camera', P.empty, '#5C6964', 'radio_button_unchecked'],
    uploading: [
      '1.5px solid #9FB3A9',
      'cloud_upload',
      format(P.uploading, { progress: String(p.progress) }),
      '#2B5479',
      'cloud_upload',
    ],
    failed: ['2px solid #A13A33', 'error', P.failed, '#A13A33', 'error'],
    queued: ['2px dashed #B7791F', 'cloud_off', P.queued, '#7A5214', 'cloud_off'],
    ready: ['2px solid var(--ox-accent)', 'image', P.ready, 'var(--ox-accent)', 'cloud_done'],
  };
  const [border, icon, status, stFg, stIcon] = map[p.state];
  return {
    border,
    icon,
    status,
    stFg,
    stIcon,
    img: p.url ? `url("${p.url}")` : p.state === 'empty' ? 'none' : STRIPES,
    fg: p.state === 'failed' ? '#A13A33' : '#3A4844',
    showIcon: !p.url,
    labelBg: p.url ? 'rgba(255,255,255,.9)' : 'transparent',
    uploading: p.state === 'uploading',
    ready: p.state === 'ready',
    failed: p.state === 'failed',
    progress: p.progress,
    aria: format(P.aria, { label, status }),
  };
}

export type FuelKey = 'q' | 'h' | 'tq' | 'f';

/** Уровень топлива эталона → `fuelPercent` контракта. */
export const FUEL_PERCENT: Readonly<Record<FuelKey, number>> = { q: 25, h: 50, tq: 75, f: 100 };

export interface DefectDraft {
  zone: string;
  text: string;
  critical: boolean;
}

export interface Draft {
  photos: Record<SideKey, Slot>;
  odometer: string;
  fuel: FuelKey | null;
  checks: Record<string, boolean>;
  defects: DefectDraft[];
  comment: string;
}

export const emptyDraft = (): Draft => ({
  photos: {
    front: EMPTY_SLOT,
    back: EMPTY_SLOT,
    left: EMPTY_SLOT,
    right: EMPTY_SLOT,
    odo: EMPTY_SLOT,
  },
  odometer: '',
  fuel: null,
  checks: {},
  defects: [],
  comment: '',
});

/** Фото снято: загружено на сервер или ждёт связи на устройстве (эталон :3484, models.js inspMissing). */
const taken = (s: Slot): boolean => s.state === 'ready' || s.state === 'queued';

/** «Фото · N из 5»: готовые слоты и фото на устройстве (W2.24). */
export const photoCount = (d: Draft): number => SIDES.filter((s) => taken(d.photos[s.key])).length;

export type InspectionKind = 'dep' | 'ret';

/**
 * «Осталось: …» (inspMissing models.js): фото, пробег, топливо — правила домена; пункты чек-листа — по версии
 * чек-листа сервера (`required`).
 */
export function missingOf(
  d: Draft,
  kind: InspectionKind,
  minOdo: number,
  items: readonly { key: string; required: boolean }[],
): string[] {
  const all = Object.fromEntries(
    (kind === 'dep' ? DEP_CHECKS : RET_CHECKS).map(([k]) => [k, true]),
  );
  const photos = Object.fromEntries(
    SIDES.map((s) => [s.key, { state: taken(d.photos[s.key]) ? 'ready' : 'empty' }] as const),
  );
  const out = inspMissing(
    { photos, odometer: d.odometer, fuel: d.fuel, checks: all },
    kind,
    minOdo,
  );
  const left = items.filter((i) => i.required && !d.checks[i.key]).length;
  if (left) out.push(`${left} ${plural(left, 'пункт', 'пункта', 'пунктов')} чек-листа`);
  return out;
}

/** Подсказка под пробегом (:3487): ошибка `odoError` или пояснение по виду осмотра. */
export function odoHint(
  value: string,
  kind: InspectionKind,
  minOdo: number,
): { text: string; error: boolean } {
  const err = odoError(value, minOdo);
  if (err) return { text: err, error: true };
  const km = int(minOdo);
  return {
    text: format(kind === 'dep' ? L.inspection.lastOdometer : L.inspection.departureOdometer, {
      km,
    }),
    error: false,
  };
}

/** Есть отмеченный критический дефект (только перед выездом). */
export const hasCritical = (d: Draft, kind: InspectionKind): boolean =>
  kind === 'dep' && d.defects.some((x) => x.critical);

const quantity = (s: string): string => String(Number(s.replace(/\s/g, '').replace(',', '.')));

/** Черновик осмотра → InspectionCreate (выезд — по брони, сдача — по рейсу). */
export function inspectionBody(
  d: Draft,
  o: {
    kind: 'departure' | 'return';
    checklist: S['InspectionChecklist'];
    vehicleId: string;
    reservationId?: string;
    tripId?: string;
    now: string;
  },
): S['InspectionCreate'] {
  const fuel = d.fuel ?? 'q';
  const body: S['InspectionCreate'] = {
    checklistVersionId: o.checklist.versionId,
    vehicleId: o.vehicleId,
    kind: o.kind,
    odometerKm: quantity(d.odometer),
    fuelPercent: FUEL_PERCENT[fuel],
    checks: o.checklist.items.map((i) => ({
      key: i.key,
      result: d.checks[i.key] ? 'pass' : 'fail',
    })),
    photos: SIDES.map((s) => ({
      role: s.role,
      fileId: d.photos[s.key].fileId ?? '',
      capturedAt: d.photos[s.key].capturedAt ?? o.now,
    })),
    capturedAt: o.now,
  };
  if (o.reservationId) body.reservationId = o.reservationId;
  if (o.tripId) body.tripId = o.tripId;
  if (d.defects.length) {
    body.defects = d.defects.map((x) => ({
      zone: x.zone,
      description: x.text.trim(),
      severity: x.critical && o.kind === 'departure' ? 'blocking' : 'minor',
    }));
  }
  const comment = d.comment.trim();
  if (o.kind === 'return' && comment) body.comment = comment;
  return body;
}

// ---------------------------------------------------------------------------------------------
// Расходы

export type ExpenseKind = S['TripExpenseCreate']['kind'];

/** Вариант «Категории» формы расхода. */
export interface ExpenseKindOption {
  kind: ExpenseKind;
  label: string;
  icon: IconName;
  /** ExpenseCategory.commentRequired: без комментария расход не сохраняется (W2.41). */
  commentRequired: boolean;
}

/** Иконка категории без эталона и категории владельца (иконок в справочнике нет, W2.41). */
const KIND_FALLBACK_ICON: IconName = 'receipt_long';

/**
 * Категории посева D-12 (ADR-0013, 0.5.1-stage2): две эталона (EXPENSE_CAT) и четыре без эталона; «Прочее» —
 * комментарий обязателен. Пока справочник тенанта не загружен — варианты формы (W2.41).
 */
export const EXPENSE_KINDS: readonly ExpenseKindOption[] = [
  { kind: 'fuel', label: EXPENSE_CAT.fuel.label, icon: EXPENSE_CAT.fuel.icon },
  { kind: 'wash', label: EXPENSE_CAT.wash.label, icon: EXPENSE_CAT.wash.icon },
  { kind: 'parking', label: T.kinds.parking, icon: 'local_parking' },
  { kind: 'toll', label: T.kinds.toll, icon: 'toll' },
  { kind: 'tire_service', label: L.expenseKinds.tire_service, icon: 'tire_repair' },
  { kind: 'other', label: T.kinds.other, icon: KIND_FALLBACK_ICON },
].map((k) => ({ ...k, commentRequired: k.kind === 'other' }));

const iconOf = (code: string): IconName =>
  EXPENSE_KINDS.find((x) => x.kind === code)?.icon ?? KIND_FALLBACK_ICON;

/** W2.41 · Варианты формы из справочника тенанта (активные, порядок каталога); иконка — по коду посева. */
export const expenseKindOptions = (
  list: readonly { code: string; label: string; commentRequired: boolean }[],
): ExpenseKindOption[] =>
  list.map((c) => ({
    kind: c.code,
    label: c.label,
    icon: iconOf(c.code),
    commentRequired: c.commentRequired,
  }));

/** Подпись кода: справочник тенанта (с архивными), затем посев, затем сам код (W2.41). */
const kindOf = (k: ExpenseKind, labels?: ReadonlyMap<string, string>) => ({
  label: labels?.get(k) ?? EXPENSE_KINDS.find((x) => x.kind === k)?.label ?? k,
  icon: iconOf(k),
});

export interface ExpenseForm {
  kind: ExpenseKind;
  amount: string;
  date: string;
  liters: string;
  comment: string;
  receipt: Slot;
  /** Была попытка сохранить: ошибки пересчитываются при правке (patchExp :2609). */
  tried: boolean;
}

/** Новый расход: категория — первая активная справочника (у посева — «Топливо», как в эталоне). */
export const newExpense = (date: string, kind: ExpenseKind = 'fuel'): ExpenseForm => ({
  kind,
  amount: '',
  date,
  liters: '',
  comment: '',
  receipt: EMPTY_SLOT,
  tried: false,
});

/**
 * Ошибки формы расхода (validateExpense домена); W2.41 — комментарий у категории с commentRequired (текст 422
 * сервера, у «Прочее» — W2.40). `kinds` — варианты формы (по умолчанию посев).
 */
export function expenseErrors(
  f: ExpenseForm,
  kinds: readonly ExpenseKindOption[] = EXPENSE_KINDS,
): Partial<Record<'amount' | 'date' | 'receipt' | 'comment', string>> {
  const st = f.receipt.state;
  const errs: Partial<Record<'amount' | 'date' | 'receipt' | 'comment', string>> = validateExpense({
    amount: f.amount,
    date: f.date,
    receipt: { state: st === 'failed' ? 'error' : st },
  });
  const kind = kinds.find((k) => k.kind === f.kind);
  if (kind?.commentRequired && !f.comment.trim()) {
    errs.comment = format(errors.mock.logistics.expenseCategory.commentRequired, {
      label: kind.label,
    });
  }
  return errs;
}

const toNumber = (s: string): number => Number(s.replace(/\s/g, '').replace(',', '.'));

/** Форма → TripExpenseCreate: сумма в копейках, литры — только у топлива и только если указаны. */
export function expenseBody(f: ExpenseForm): S['TripExpenseCreate'] {
  const body: S['TripExpenseCreate'] = {
    kind: f.kind,
    occurredAt: noonMsk(f.date),
    amount: { amountMinor: Math.round(toNumber(f.amount) * 100), currency: 'RUB' },
    receiptFileIds: f.receipt.fileId ? [f.receipt.fileId] : [],
  };
  const liters = toNumber(f.liters);
  if (f.kind === 'fuel' && f.liters.trim() && Number.isFinite(liters) && liters > 0) {
    body.quantity = String(liters);
  }
  const comment = f.comment.trim();
  if (comment) body.comment = comment;
  return body;
}

export interface ExpenseRow {
  id: string;
  icon: IconName;
  title: string;
  meta: string;
  chip: Chip;
  /** «Повторить» у расхода на устройстве с ошибкой отправки (W2.24). */
  onRetry?: () => void;
}

/** Строка расхода, принятого сервером (serverExp :3462); подпись — справочник тенанта `labels` (W2.41). */
export function expenseRow(
  e: S['TripExpense'],
  tz = MSK,
  labels?: ReadonlyMap<string, string>,
): ExpenseRow {
  const k = kindOf(e.kind, labels);
  const meta = [
    ddmmyyyy(e.occurredAt, tz),
    e.comment?.trim() || null,
    e.receiptFileIds.length ? L.expenses.receiptAttached : null,
  ].filter((x): x is string => !!x);
  return {
    id: e.id,
    icon: k.icon,
    title: format(L.expenses.line, { label: k.label, amount: rub(e.amount.amountMinor / 100) }),
    meta: meta.join(' · '),
    chip: { label: L.outbox.accepted, tone: 'ok', icon: 'cloud_done' },
  };
}

// ---------------------------------------------------------------------------------------------
// Рейс, сдача, доработка

export interface StopRow {
  name: string;
  meta: string;
  done: boolean;
  mark: string;
  button: string;
  /** Ссылка внешнего навигатора на точку (W2.50). */
  nav: string;
}

/**
 * W2.50 (D-11 комплекта, Q-W2.52-12): deeplink Яндекс Карт — маршрут на машине до адреса, без внешнего API; начало
 * маршрута навигатор берёт из местоположения устройства.
 */
export const navigatorUrl = (address: string): string =>
  `https://yandex.ru/maps/?rtext=~${encodeURIComponent(address)}&rtype=auto`;

/** Остановки маршрута (:3466): отметка «Прибыл» — только на устройстве. */
export function stopRows(p: Plan, marks: Readonly<Record<number, boolean>>): StopRow[] {
  const tz = p.plannedWindow.timeZone || MSK;
  return p.stops.map((s, i) => {
    const done = !!marks[i];
    const op = format(s.op === 'load' ? L.today.load : L.today.unload, {
      volume: num(Number(s.volumeM3)),
    });
    return {
      name: s.address,
      meta: s.plannedAt ? `${hhmm(s.plannedAt, tz)} · ${op}` : op,
      done,
      mark: done ? '✓' : String(i + 1),
      button: done ? L.today.undo : L.today.arrived,
      nav: navigatorUrl(s.navigationAddress?.trim() || s.address),
    };
  });
}

/** Итоги сдачи (:3470): «Пройдено» — пробег при сдаче минус при выезде; «Расходы» — число и сумма. */
export function summary(
  dep: S['Inspection'] | undefined,
  ret: S['Inspection'] | undefined,
  expenses: readonly S['TripExpense'][],
): { label: string; value: string }[] {
  const total = expenses.reduce((a, e) => a + e.amount.amountMinor, 0) / 100;
  const driven = dep && ret ? `${int(Number(ret.odometerKm) - Number(dep.odometerKm))} км` : '—';
  return [
    { label: LM.review.stats.driven, value: driven },
    {
      label: L.expenses.title,
      value: format(L.expenses.summary, { n: String(expenses.length), sum: rub(total) }),
    },
  ];
}

/** «Исправить: Фото при сдаче, Пробег» — разделы доработки (REV_STEPS эталона; `odo` → `odometer`). */
export const reworkSteps = (s: readonly S['ReworkStep'][] | undefined): string =>
  (s ?? []).map((k) => LM.review.reworkSteps[k]).join(', ');

export interface FinishDialogModel {
  title: string;
  text: string;
  icon: IconName;
  tone: Tone;
  consequences: Consequence[];
  confirmLabel: string;
}

/** Диалог «Завершить рейс {номер}?» (finishRoute :2586–2596). */
export function finishDialog(p: Plan, done: number, total: number): FinishDialogModel {
  const D = L.finishDialog;
  return {
    title: format(D.title, { trip: p.number }),
    text: D.text,
    icon: 'flag',
    tone: 'info',
    consequences:
      done < total
        ? [
            {
              title: D.attention,
              items: [
                {
                  text: format(D.stopsMarked, { done: String(done), total: String(total) }),
                  icon: 'warning',
                  tone: 'warn',
                },
              ],
            },
          ]
        : [],
    confirmLabel: L.finish.action,
  };
}

/** Метка шапки «{водитель} · {день}» (:665). */
export const todayCrumb = (driver: string, iso: string, tz = MSK): string =>
  format(L.today.crumb, { driver, date: crumbDate(iso, tz) });
