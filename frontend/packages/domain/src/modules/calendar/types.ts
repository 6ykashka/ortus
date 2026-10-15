// Типы календаря ресурсов (extra-data.js 14.10:4–23). Время брони — часы от полуночи (9.25 = 09:15).

export type ResourceKind = 'vehicle' | 'staff' | 'room' | 'equipment';

export interface Resource {
  id: string;
  kind: ResourceKind;
  name: string;
  /** Подразделение или раздел (`'spa'`), к которому привязан ресурс. */
  unit: string;
  /** Связанная сущность модуля (машина `v1`). */
  ref?: string;
}

export interface BookingSource {
  kind: 'trip' | 'vehicle' | 'appointment';
  id: string;
}

export interface Booking {
  id: string;
  title: string;
  source: BookingSource | null;
  /** Все ресурсы брони заняты одновременно. */
  res: string[];
  start: number;
  end: number;
  /** Подготовка до начала, ч. */
  prep?: number;
  /** Уборка после конца, ч. */
  clean?: number;
}

export interface Conflict {
  res: string;
  resName: string;
  title: string;
}

export interface CalendarSlice {
  resources: Resource[];
  bookings: Booking[];
}

export interface CalendarSlices {
  calendar?: CalendarSlice;
}

declare module '../../core/types/entities-core.ts' {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface ModuleSlices extends CalendarSlices {}
}
