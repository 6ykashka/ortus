// Типы логистики (models.js 14.10:8–9, mock-data.js:189–229, api.js:193–198). Срезы добавляются в
// БД организации расширением `ModuleSlices` ядра.

export type VehicleState = 'free' | 'reserved' | 'on_route' | 'review' | 'unavailable';

export type TripState =
  | 'planned'
  | 'assigned'
  | 'inspection'
  | 'defect_review'
  | 'on_route'
  | 'returning'
  | 'submitted'
  | 'rework'
  | 'accepted';

/** Диапазон температуры кузова или груза, °C: `[от, до]`. */
export type TempRange = readonly [number, number];

export interface Vehicle {
  id: string;
  unit: string;
  model: string;
  plate: string;
  body: string;
  payloadT: number;
  volumeM3: number;
  lengthM: number;
  temp: TempRange | null;
  odometer: number;
  state: VehicleState;
  depot: string;
  note?: string;
  /** Рейс, за которым машина забронирована. */
  heldBy?: string | null;
}

export interface Cargo {
  weightT: number;
  volumeM3: number;
  lengthM: number;
  temp: TempRange | null;
  kind: string;
}

export interface Stop {
  time: string;
  name: string;
  op: 'load' | 'unload';
  /** Масса, т. */
  w: number;
  /** Объём, м³. */
  v: number;
}

/** Рейс. Поля осмотров, расходов и приёмки наполняют команды этапа 2. */
export interface Trip {
  id: string;
  unit: string;
  title: string;
  date: string;
  window: string;
  distanceKm: number;
  driverId: string | null;
  driverName: string | null;
  vehicleId: string | null;
  status: TripState;
  /** Начисление водителю, ₽ (видно только с правом финансов). */
  earnings?: number;
  cargo: Cargo;
  stops: Stop[];
  dep: unknown;
  ret: unknown;
  expenses: unknown[];
  review: unknown;
  defect: unknown;
}

export interface PoolDriver {
  id: string;
  code: string;
  qual: string;
  home: string;
  unit: string;
  window: string;
  terms: string;
}

export interface PoolRequest {
  id: string;
  [key: string]: unknown;
}

export interface Pool {
  drivers: PoolDriver[];
  requests: PoolRequest[];
}

export interface Earning {
  id: string;
  [key: string]: unknown;
}

export type PhotoState = 'empty' | 'queued' | 'uploading' | 'ready' | 'error';

/** Черновик осмотра (выезд или сдача) на устройстве водителя. */
export interface InspectionDraft {
  photos: Partial<Record<string, { state: PhotoState } | undefined>>;
  odometer: string | number;
  fuel: string | null | undefined;
  checks: Partial<Record<string, boolean>>;
}

export interface ExpenseDraft {
  amount: string | number | null | undefined;
  date: string | null | undefined;
  receipt?: { state: PhotoState } | null;
}

export interface CompatCheck {
  key: 'avail' | 'payload' | 'volume' | 'length' | 'temp';
  label: string;
  icon: string;
  ok: boolean;
  value: string;
  need?: string;
}

export interface CompatResult {
  /** Машина подходит грузу (без учёта доступности). */
  fit: boolean;
  /** Подходит и доступна. */
  ok: boolean;
  checks: CompatCheck[];
  reasons: string[];
}

export interface Leg extends Stop {
  wAfter: number;
  vAfter: number;
  wPct: number | null;
  vPct: number | null;
}

export type ExpenseErrors = Partial<Record<'amount' | 'date' | 'receipt', string>>;

export interface LogisticsSlices {
  vehicles?: Vehicle[];
  trips?: Trip[];
  pool?: Pool;
  earnings?: Earning[];
}

declare module '../../core/types/entities-core.ts' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ModuleSlices extends LogisticsSlices {}
}
