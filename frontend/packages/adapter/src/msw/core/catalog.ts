// Каталог прав для сервера (W0.13): канонические ключи `api/permissions.yaml`, модуль ключа, права владельца
// по подключённым модулям и перевод ключей прототипа (`prototype_renames`). Правила проекции — те же, что
// у генератора примеров W0.07 (`tools/gen/examples-seed.mjs`: MODULE_OF_KEY, ownerKeys, moduleAvailability).
import { contract } from '../contract/index.ts';
import type { ActionInfo } from '../contract/index.ts';

export const ACTIONS: ReadonlyMap<string, ActionInfo> = new Map(
  contract.permissions.actions.map((a) => [a.key, a]),
);

/** Модули ядра: подключены всегда (CORE прототипа 14.10). */
export const CORE_MODULES = [
  'tasks',
  'forms',
  'calendar',
  'knowledge',
  'files',
  'data',
  'inventory',
  'cash',
] as const;

/** Подключаемые модули контракта и их модуль в каталоге прав. */
export const INSTALLABLE = { fleet: 'logistics', spa: 'spa', repairs: 'repairs' } as const;
export type InstallableKey = keyof typeof INSTALLABLE;
export const INSTALLABLE_KEYS = Object.keys(INSTALLABLE) as InstallableKey[];

/** Модуль домена W0.12 (`db.modules`) → ключ модуля контракта. */
export const DOMAIN_TO_MODULE: Readonly<Record<string, InstallableKey>> = {
  logistics: 'fleet',
  spa: 'spa',
  repair: 'repairs',
};

/** Подпись модуля из каталога прав для текстов («Логистика», «Салон и SPA»). */
export const moduleLabel = (key: InstallableKey): string =>
  contract.permissions.modules[INSTALLABLE[key]]?.label ?? key;

/** Модуль доступности (`ModuleAvailability.moduleKey`) ключа права. */
export function moduleOfKey(key: string): string {
  const prefix = key.split('.')[0] ?? '';
  const sys: Record<string, string> = {
    members: 'members',
    roles: 'members',
    org_units: 'members',
    modules: 'modules',
    billing: 'modules',
  };
  return sys[prefix] ?? prefix;
}

/** Все действия подключённых модулей (владелец; без `platform.*` и `chat.*`). */
export function ownerKeys(installed: readonly string[]): string[] {
  const mods = new Set(['members', 'modules', ...installed]);
  return [...ACTIONS.keys()].filter(
    (k) => !k.startsWith('platform.') && !k.startsWith('chat.') && mods.has(moduleOfKey(k)),
  );
}

/** Ключи прототипа → канонические (каталог или `prototype_renames`); неизвестные отбрасываются. */
export function canonicalKeys(protoKeys: readonly string[]): string[] {
  const out: string[] = [];
  for (const k of protoKeys) {
    const mapped = ACTIONS.has(k) ? [k] : (contract.permissions.renames[k] ?? []);
    for (const x of mapped) if (ACTIONS.has(x) && !out.includes(x)) out.push(x);
  }
  return out;
}

/** Ключ права относится к начислениям (SoD «Водитель» ↔ начисления). */
export const isEarningsKey = (key: string): boolean => key.startsWith('fleet.earnings.');

/** Модуль контракта, которому принадлежит тег операции (проверка подключения модуля). */
export const TAG_MODULE: Readonly<Record<string, InstallableKey>> = {
  Fleet: 'fleet',
  Earnings: 'fleet',
  Spa: 'spa',
  Repairs: 'repairs',
};
