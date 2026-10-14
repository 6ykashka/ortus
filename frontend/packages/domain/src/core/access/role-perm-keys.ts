// Ключи прав роли по каталогу модулей (models.js 14.10 `:308–320`).
import { ALL_MODULES } from '../dictionaries.ts';
import type { ModuleKey, Role, Verb } from '../types/index.ts';

export function rolePermKeys(role: Role): string[] {
  if (role.all) return ['*'];
  const out: string[] = [];
  for (const [mod, verbs] of Object.entries(role.actions) as [ModuleKey, readonly Verb[]][]) {
    const perms = ALL_MODULES[mod]?.perms;
    if (!perms) continue;
    for (const v of verbs) out.push(...(perms[v] ?? []));
  }
  if (role.finance.read) out.push('fleet.earnings.read');
  if (role.finance.manage) out.push('fleet.earnings.manage');
  const cash = (role.actions.cash ?? []).length > 0;
  if (cash && role.cash?.balance) out.push('cash.balance.read');
  if (cash && role.cash?.self) out.push('cash.advance.self');
  return out;
}
