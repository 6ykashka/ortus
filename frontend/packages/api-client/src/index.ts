// @ortus/api-client (W0.09): типизированный клиент контракта. Схема `generated/schema.ts` генерирует `make gen`
// (openapi-typescript из api/dist/ortus.bundle.yaml), клиент — openapi-fetch. Сессия BFF живёт в HttpOnly
// cookie, поэтому запросы идут с `credentials: 'include'`; изменяющие запросы несут X-CSRF-Token из
// cookie ortus_csrf (double-submit).
import createClient, { type Client, type Middleware } from 'openapi-fetch';

import type { components, paths } from './generated/schema.ts';

export type { components, paths };
export type MeContext = components['schemas']['MeContext'];
export type TenantContext = components['schemas']['TenantContext'];
export type Problem = components['schemas']['Problem'];
export type ApiClient = Client<paths>;

export const CSRF_COOKIE = 'ortus_csrf';
export const CSRF_HEADER = 'X-CSRF-Token';
export const DEV_LOGIN_PATH = '/api/v1/dev/login';
export const DEV_LOGOUT_PATH = '/api/v1/dev/logout';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);

/** Ошибка API: тело application/problem+json контракта (если пришло) и HTTP-статус. */
export class ProblemError extends Error {
  readonly status: number;
  readonly code: string;
  readonly problem: Problem | undefined;

  constructor(status: number, problem?: Problem) {
    super(problem ? `${problem.code}: ${problem.title}` : `HTTP ${status}`);
    this.name = 'ProblemError';
    this.status = status;
    this.code = problem?.code ?? '';
    this.problem = problem;
  }
}

function isProblem(v: unknown): v is Problem {
  return typeof v === 'object' && v !== null && typeof (v as Problem).code === 'string';
}

/** Значение cookie `name` из строки `document.cookie`. */
export function readCookie(cookie: string, name: string): string | undefined {
  for (const part of cookie.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

/** CSRF-токен браузера: cookie ortus_csrf (вне браузера — нет). */
export function browserCsrfToken(): string | undefined {
  return typeof document === 'undefined' ? undefined : readCookie(document.cookie, CSRF_COOKIE);
}

export interface ApiClientOptions {
  /** Origin API; по умолчанию — тот же origin (прокси Vite `/api`). */
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Источник CSRF-токена; по умолчанию — cookie ortus_csrf. */
  csrfToken?: () => string | undefined;
}

export function createApiClient(o: ApiClientOptions = {}): ApiClient {
  const client = createClient<paths>({
    baseUrl: o.baseUrl ?? '',
    credentials: 'include',
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
  const token = o.csrfToken ?? browserCsrfToken;
  const csrf: Middleware = {
    onRequest({ request }) {
      if (SAFE.has(request.method)) return undefined;
      const t = token();
      if (t) request.headers.set(CSRF_HEADER, t);
      return request;
    },
  };
  client.use(csrf);
  return client;
}

/** Данные успешного ответа openapi-fetch или ProblemError. */
export async function unwrap<T>(r: { data?: T; error?: unknown; response: Response }): Promise<T> {
  if (r.response.ok && r.data !== undefined) return r.data;
  throw new ProblemError(r.response.status, isProblem(r.error) ? r.error : undefined);
}

async function problemOf(res: Response): Promise<ProblemError> {
  const body: unknown = await res.json().catch(() => undefined);
  return new ProblemError(res.status, isProblem(body) ? body : undefined);
}

export interface DevLoginResult {
  userId: string;
  csrfToken: string;
}

/**
 * Dev-вход BFF (только local и e2e, вне контракта; OIDC — W1.03): персонаж e2e (`owner`, `manager`, …)
 * или subject сида (`acc-7`). Cookie сессии ставит ответ.
 */
export async function devLogin(persona: string, o: ApiClientOptions = {}): Promise<DevLoginResult> {
  const res = await (o.fetch ?? fetch)(`${o.baseUrl ?? ''}${DEV_LOGIN_PATH}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ persona }),
  });
  if (!res.ok) throw await problemOf(res);
  return (await res.json()) as DevLoginResult;
}

/** Выход dev-провайдера: сессия удаляется на сервере, cookie сбрасываются. */
export async function devLogout(o: {
  baseUrl?: string;
  fetch?: typeof fetch;
  csrfToken: string;
}): Promise<void> {
  const res = await (o.fetch ?? fetch)(`${o.baseUrl ?? ''}${DEV_LOGOUT_PATH}`, {
    method: 'POST',
    credentials: 'include',
    headers: { [CSRF_HEADER]: o.csrfToken },
  });
  if (!res.ok) throw await problemOf(res);
}
