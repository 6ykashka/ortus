// «Альта Групп» (t-alta): база организации из `baseSeed()` эталона 14.10 — оргструктура, люди,
// модули, события. Срезы модулей пилота добавляет `compose.ts` (install), будущих этапов — их хуки.
import { altaPeople } from '../modules/people/seed.ts';
import type { Platform } from '../modules/platform/types.ts';
import type { BaseDb } from './types.ts';

export function createAlta(platform: Platform): BaseDb {
  return {
    tenantId: 't-alta',
    seq: 100,
    platform,
    ...altaPeople(),
    modules: { logistics: { enabled: false }, spa: { enabled: true }, repair: { enabled: false } },
    events: [],
  };
}
