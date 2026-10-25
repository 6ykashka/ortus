// Правила кассы в командах `assign` и `saveRole` (api.js 14.10/19.10:416, 439). Сами команды
// назначений и ролей живут в модуле «Пользователи и роли»; он вызывает эти функции (строка
// в integratorNotes отчёта W5.30). Ключи прав роли `cash.balance.read` и `cash.advance.self` строит
// `rolePermKeys` ядра.
import { ApiError } from '../../core/errors/index.ts';
import type { Role, Scope } from '../../core/types/index.ts';

/** `assign`: область «Касса» подходит только ролям с модулем «Касса» (владелец — любой). */
export function assertCashScope(role: Role, scope: Scope | undefined): void {
  if (scope?.type === 'account' && !(role.actions.cash ?? []).length && !role.all) {
    throw new ApiError('validation', 'Область «Касса» подходит только ролям с модулем «Касса»');
  }
}

/**
 * `saveRole`: роль с функцией «Водитель» и модулем «Касса» автоматически получает
 * `cash.self = true` — в кассе только свой подотчёт. Вход не мутируется.
 */
export function driverCashSelf(role: Role): Role {
  if (role.professional === 'driver' && (role.actions.cash ?? []).length) {
    return { ...role, cash: { ...(role.cash ?? {}), self: true } };
  }
  return role;
}
