// W1.20 · Подписи меню из словаря: домен навигации отдаёт ключи `items.*`, `groups.*`, `bottom.*`
// (`@ortus/texts` `shell.nav`), имена модулей — `ALL_MODULES` домена (gateVM :3060, :3070).
import { ALL_MODULES } from '@ortus/domain';
import type { LabelKey } from '@ortus/domain/nav';
import { shell } from '@ortus/texts';

const NS = {
  items: shell.nav.items,
  groups: shell.nav.groups,
  bottom: shell.nav.bottom,
} as const satisfies Record<string, Record<string, string>>;

export function navLabel(key: LabelKey): string {
  const [ns, name = ''] = key.split('.') as [keyof typeof NS, string];
  const text = (NS[ns] as Record<string, string> | undefined)?.[name];
  if (!text) throw new Error(`nav: нет подписи ${key} в @ortus/texts shell.nav`);
  return text;
}

/** Имя модуля домена: «Логистика», «Ремонт и стройка», «Формы»… */
export function moduleName(key: string): string {
  return (ALL_MODULES as Record<string, { name: string } | undefined>)[key]?.name ?? key;
}
