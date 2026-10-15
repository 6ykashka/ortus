// Сессия BFF в режиме mock (W0.13): как `session` и `session/dev` cmd/api W0.09 — непрозрачный id в cookie
// `ortus_sid`, CSRF double-submit в `ortus_csrf`, персонажи e2e-kit → аккаунты сида (`acc-N`, `op-N`).
import type { AccountRow, OperatorRow, ScenarioState, SessionRow } from './state.ts';
import { addMs, HOUR } from './time.ts';

export const SESSION_COOKIE = 'ortus_sid';
export const CSRF_COOKIE = 'ortus_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';

/** Срок сессии: 8 часов (пример getCsrfToken/ok: expiresAt = вход + 8 ч). */
export const SESSION_TTL_MS = 8 * HOUR;

/** Персонажи e2e-kit (`PERSONAS`) → subject dev-идентичности сида, как `session/dev` W0.09. */
export const PERSONAS: Readonly<Record<string, string>> = {
  operator: 'op-1',
  owner: 'acc-1',
  manager: 'acc-2',
  driver: 'acc-3',
  therapist: 'acc-4',
  foreman: 'acc-5',
  'owner@t-lotos': 'acc-11',
  'therapist@t-lotos': 'acc-4',
};

/** Организация, которую персонаж выбирает при входе (`<персонаж>@<организация>`). */
export function personaTenant(persona: string): string | undefined {
  return PERSONAS[persona] ? /@(t-[a-z0-9-]+)$/.exec(persona)?.[1] : undefined;
}

const USER_SUBJECT = /^[a-z0-9][a-z0-9@._-]{0,63}$/;
const OPERATOR_SUBJECT = /^op-[0-9]{1,4}$/;

export type Actor =
  | { kind: 'user'; id: string; displayName: string; account: AccountRow }
  | { kind: 'operator'; id: string; displayName: string; operator: OperatorRow };

/** Аккаунт персонажа или subject сида; неизвестный, заблокированный, отключённый — undefined. */
export function lookupActor(s: ScenarioState, persona: string): Actor | undefined {
  const subject = PERSONAS[persona] ?? persona;
  if (OPERATOR_SUBJECT.test(subject)) {
    const op = s.operators.find((o) => o.proto === subject && o.status === 'active');
    return op
      ? { kind: 'operator', id: op.accountId, displayName: op.displayName, operator: op }
      : undefined;
  }
  if (!USER_SUBJECT.test(subject)) return undefined;
  const acc = s.accounts.find((a) => a.proto === subject);
  if (!acc || acc.status === 'locked') return undefined;
  return { kind: 'user', id: acc.id, displayName: acc.displayName, account: acc };
}

/** Владелец сессии по id аккаунта (оператор — по accounts.id оператора). */
export function actorById(s: ScenarioState, accountId: string): Actor | undefined {
  const acc = s.accounts.find((a) => a.id === accountId);
  if (acc) {
    return acc.status === 'locked'
      ? undefined
      : { kind: 'user', id: acc.id, displayName: acc.displayName, account: acc };
  }
  const op = s.operators.find((o) => o.accountId === accountId && o.status === 'active');
  return op
    ? { kind: 'operator', id: op.accountId, displayName: op.displayName, operator: op }
    : undefined;
}

/** Случайный токен base64url (32 байта), как `session.token` W0.09. */
export function randomToken(): string {
  const b = new Uint8Array(32);
  crypto.getRandomValues(b);
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function issueSession(s: ScenarioState, accountId: string): SessionRow {
  const row: SessionRow = {
    id: randomToken(),
    accountId,
    csrf: randomToken(),
    issuedAt: s.clock,
    expiresAt: addMs(s.clock, SESSION_TTL_MS),
  };
  s.sessions[row.id] = row;
  return row;
}

/** Живая сессия по cookie (истёкшая удаляется). */
export function liveSession(s: ScenarioState, id: string | undefined): SessionRow | undefined {
  const row = id ? s.sessions[id] : undefined;
  if (!row) return undefined;
  if (s.clock >= row.expiresAt) {
    Reflect.deleteProperty(s.sessions, row.id);
    return undefined;
  }
  return row;
}

/** Cookie ответа. */
export interface SetCookie {
  name: string;
  value: string;
  httpOnly: boolean;
  /** Секунды; 0 — удалить. */
  maxAge: number;
}

export const sessionCookies = (row: SessionRow | null): SetCookie[] => {
  const maxAge = row ? Math.round(SESSION_TTL_MS / 1000) : 0;
  return [
    { name: SESSION_COOKIE, value: row?.id ?? '', httpOnly: true, maxAge },
    { name: CSRF_COOKIE, value: row?.csrf ?? '', httpOnly: false, maxAge },
  ];
};

export const serializeCookie = (c: SetCookie): string =>
  `${c.name}=${c.value}; Path=/; Max-Age=${c.maxAge}${c.httpOnly ? '; HttpOnly' : ''}; SameSite=Lax`;

/** Cookie запроса из заголовка Cookie. */
export function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    if (k) out[k] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return out;
}
