// Справочники логистики 14.10 (models.js:125–163) — дословно, порядок ключей значим для UI.
import type { ToneKey } from '../../core/types/common.ts';
import type { TripState, VehicleState } from './types.ts';

export interface StateLabel {
  label: string;
  tone: ToneKey;
  icon: string;
}

export const VEHICLE_STATE: Readonly<Record<VehicleState, StateLabel>> = {
  free: { label: 'Свободна', tone: 'ok', icon: 'check_circle' },
  reserved: { label: 'Забронирована', tone: 'info', icon: 'event_available' },
  on_route: { label: 'На маршруте', tone: 'info', icon: 'route' },
  review: { label: 'Проверяется', tone: 'warn', icon: 'pending' },
  unavailable: { label: 'Недоступна', tone: 'danger', icon: 'block' },
};

export const TRIP_STATE: Readonly<Record<TripState, StateLabel>> = {
  planned: { label: 'Запланирован', tone: 'neutral', icon: 'event' },
  assigned: { label: 'Машина назначена', tone: 'info', icon: 'event_available' },
  inspection: { label: 'Осмотр перед выездом', tone: 'info', icon: 'fact_check' },
  defect_review: { label: 'Дефект на проверке', tone: 'danger', icon: 'report' },
  on_route: { label: 'В рейсе', tone: 'info', icon: 'route' },
  returning: { label: 'Сдача машины', tone: 'info', icon: 'assignment_return' },
  submitted: { label: 'Ожидает приёмки', tone: 'warn', icon: 'pending' },
  rework: { label: 'На доработке', tone: 'warn', icon: 'undo' },
  accepted: { label: 'Принят', tone: 'ok', icon: 'verified' },
};

type Pair = readonly [string, string];

/** Обязательные ракурсы осмотра: ключ → подпись. */
export const PHOTO_SIDES: readonly Pair[] = [
  ['front', 'Спереди'],
  ['back', 'Сзади'],
  ['left', 'Слева'],
  ['right', 'Справа'],
  ['odo', 'Одометр'],
];

export const DEP_CHECKS: readonly Pair[] = [
  ['body', 'Кузов и стёкла осмотрены'],
  ['tires', 'Шины и световые приборы исправны'],
  ['docs', 'Документы и комплект на месте'],
];

export const RET_CHECKS: readonly Pair[] = [
  ['cargo', 'Груз выгружен полностью'],
  ['personal', 'Личные вещи забраны'],
  ['keys', 'Ключи и документы на месте'],
];

export const DEFECT_ZONES: readonly string[] = [
  'Кузов',
  'Стёкла',
  'Шины и колёса',
  'Световые приборы',
  'Салон',
  'Грузовой отсек',
  'Тормоза и ходовая',
];

export const FUEL: readonly Pair[] = [
  ['q', '¼'],
  ['h', '½'],
  ['tq', '¾'],
  ['f', 'Полный'],
];

export const EXPENSE_CAT: Readonly<Record<'fuel' | 'wash', { label: string; icon: string }>> = {
  fuel: { label: 'Топливо', icon: 'local_gas_station' },
  wash: { label: 'Мойка', icon: 'local_car_wash' },
};
