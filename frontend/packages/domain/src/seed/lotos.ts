// SPA «Лотос» (t-lotos): вторая организация со своей «БД», общая только платформа
// (`seedLotos(platform)` эталона 14.10). Персонал берётся из каталога аккаунтов платформы,
// поэтому платформа должна быть уже добрана `fillAccounts`.
import { lotosPeople } from '../modules/people/seed.ts';
import type { Platform } from '../modules/platform/types.ts';
import type { BaseDb } from './types.ts';

export function createLotos(platform: Platform): BaseDb {
  return {
    tenantId: 't-lotos',
    seq: 500,
    platform,
    ...lotosPeople(platform),
    modules: { logistics: { enabled: false }, spa: { enabled: true }, repair: { enabled: false } },
    events: [],
  };
}
