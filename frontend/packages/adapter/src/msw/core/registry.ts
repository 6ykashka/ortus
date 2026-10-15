// Контракт хендлера операции (W0.13): шлюз собирает контекст, хендлер возвращает тело или бросает
// ProblemError. Модули адаптера (`src/msw/<модуль>/`) экспортируют реестр `operationId → хендлер` (P3).
import type { OperationInfo } from '../contract/index.ts';
import type { TenantAccess } from './access.ts';
import type { ProblemExtra } from './problem.ts';
import type { Actor, SetCookie } from './session.ts';
import type { ScenarioState, SessionRow } from './state.ts';

export interface HandlerContext {
  s: ScenarioState;
  op: OperationInfo;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Тело запроса, проверенное по схеме контракта. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- форма задана схемой контракта
  body: any;
  headers: Headers;
  url: URL;
  requestId: string;
  now(): string;
  /** Субъект сессии (у публичных операций — если сессия есть). */
  actor: Actor | undefined;
  session: SessionRow | undefined;
  /** Организация запроса (операции `/tenants/{tenantId}/…`). */
  tenant: TenantAccess | undefined;
  /** Субъект-пользователь или 401. */
  user(): Extract<Actor, { kind: 'user' }>;
  /** Организация запроса (ошибка разработки, если операция не организационная). */
  org(): TenantAccess;
  /** Проверка If-Match: текущая ревизия ресурса ≠ присланной → 412 revision_mismatch. */
  revision(current: number): void;
  /** Новый UUID v5 (`ortus:<область>:new:<счётчик>`), детерминированный для одинаковой истории запросов. */
  newId(scope?: string): string;
  fail(code: string, detail?: string, extra?: ProblemExtra): never;
  setCookies(cookies: SetCookie[]): void;
}

export interface HandlerResult {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  /** Ревизия для ETag (по умолчанию — `body.revision`). */
  etag?: number;
}

export type OperationHandler = (ctx: HandlerContext) => HandlerResult | Promise<HandlerResult>;

export interface OperationSpec {
  run: OperationHandler;
  /** Тексты нарушений по полю тела (`validation_failed` схемы) — как в примерах. */
  messages?: Readonly<Record<string, string>>;
  /** До проверки тела по схеме (`ctx.body` — разобранный, но не проверенный JSON): например, 413. */
  before?: (ctx: HandlerContext) => void;
}

export type Registry = Record<string, OperationHandler | OperationSpec>;

export const specOf = (h: OperationHandler | OperationSpec): OperationSpec =>
  typeof h === 'function' ? { run: h } : h;
