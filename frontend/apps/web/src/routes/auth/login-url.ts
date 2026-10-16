// W1.22 · Адрес входа BFF (контракт startLogin, api/openapi/paths/auth.yaml): путь возврата — относительный путь
// приложения по шаблону `returnTo` (один «/», без хоста, «\», пробелов и управляющих символов, ≤ 512); иначе — корень.
// BFF проверяет его ещё раз перед редиректом. Вход оператора — путь `/platform…` (realm операторов, Q-W1.03-1).

export const START_LOGIN_PATH = '/api/v1/auth/login';
const MAX_RETURN_TO = 512;
// eslint-disable-next-line no-control-regex -- шаблон контракта запрещает управляющие символы
const RETURN_TO = /^\/(?:[^/\\\s\x00-\x1f\x7f][^\\\s\x00-\x1f\x7f]*)?$/;

/** Путь возврата после входа: допустимый относительный путь приложения или `/`. */
export function safeNext(next: string | null | undefined): string {
  if (!next || next.length > MAX_RETURN_TO || !RETURN_TO.test(next)) return '/';
  return next;
}

/** Адрес навигации на startLogin BFF (302 к провайдеру OIDC). */
export const startLoginUrl = (next: string): string =>
  `${START_LOGIN_PATH}?returnTo=${encodeURIComponent(safeNext(next))}`;

/** Путь контура оператора: `/platform` и вложенные. */
export const isOperatorPath = (path: string): boolean =>
  path === '/platform' || path.startsWith('/platform/') || path.startsWith('/platform?');
