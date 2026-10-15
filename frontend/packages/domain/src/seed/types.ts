// Типы сида этапа 0. База организации — срез ядра (`CoreDb`) с общим объектом платформы;
// после установки модулей пилота (`compose.ts`) у неё есть срезы логистики, календаря и файлов.
import type { CoreDb, DomainEvent, Group, TenantDb } from '../core/types/index.ts';
import type { CalendarSlice } from '../modules/calendar/types.ts';
import type { StorageSlice } from '../modules/files/types.ts';
import type { Earning, Pool, Trip, Vehicle } from '../modules/logistics/types.ts';
import type { Platform } from '../modules/platform/types.ts';

export type OrgId = 't-alta' | 't-lotos';

/** База организации до установки модулей. */
export type BaseDb = CoreDb & {
  platform: Platform;
  groups: Group[];
  events: DomainEvent[];
};

/** Организация после установки модулей пилота. */
export type PilotDb = TenantDb &
  BaseDb & {
    vehicles: Vehicle[];
    trips: Trip[];
    pool: Pool;
    earnings: Earning[];
    calendar: CalendarSlice;
    storage: StorageSlice;
  };

export interface SeedOptions {
  /**
   * Повторять утечки данных «Альты» в «Лотос», как `seedLotos` эталона (Q-31, PD-27).
   * `true` — режим `mock` и паритет с эталоном; `false` — стенд и снимок для Go-сида.
   */
  prototypeLeaks?: boolean;
}

export interface SeedState {
  /** Control DB — один объект на все организации (api.js:44–45). */
  platform: Platform;
  dbs: Record<OrgId, PilotDb>;
}
