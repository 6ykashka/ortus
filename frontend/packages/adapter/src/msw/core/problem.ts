// Ошибки сценарного сервера (W0.13): application/problem+json по реестру `api/errors.yaml`, как пакет
// `problem` cmd/api W0.09. Текст `detail` по умолчанию — из примера операции `<operationId>/<код>.json`
// (PD-43: хендлеры строятся из примеров); `retryable` — по реестру, как в примерах W0.07.
import type { components } from '@ortus/api-client';

import { contract, example } from '../contract/index.ts';

type S = components['schemas'];
export type Violation = S['ProblemViolation'];

export const TYPE_BASE = 'https://docs.ortus.example/errors/';
export const PROBLEM_JSON = 'application/problem+json';

export interface ProblemExtra {
  violations?: Violation[];
}

/** Ошибка с каноническим Problem.code; бросается хендлерами и шлюзом. */
export class ProblemError extends Error {
  constructor(
    readonly code: string,
    readonly detail?: string,
    readonly extra: ProblemExtra = {},
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = 'ProblemError';
  }
}

/** Бросает ProblemError (удобно в выражениях). */
export function fail(code: string, detail?: string, extra?: ProblemExtra): never {
  throw new ProblemError(code, detail, extra);
}

export const statusOf = (code: string): number => contract.errors[code]?.status ?? 503;

/** Тело Problem. Неизвестный код → dependency_unavailable «Внутренняя ошибка» (как cmd/api). */
export function problemBody(
  err: ProblemError,
  requestId: string,
  operationId?: string,
): S['Problem'] {
  const known = contract.errors[err.code];
  const code = known ? err.code : 'dependency_unavailable';
  const entry = contract.errors[code] ?? { status: 503, title: '', retryable: true };
  const ex = operationId
    ? (example(operationId, code) as { detail?: string } | undefined)
    : undefined;
  const detail = known ? (err.detail ?? ex?.detail) : 'Внутренняя ошибка';
  const body: S['Problem'] = {
    type: TYPE_BASE + code,
    title: entry.title,
    status: entry.status,
    code: code as S['ProblemCode'],
    requestId,
  };
  if (detail) body.detail = detail;
  if (known && err.extra.violations?.length) body.violations = err.extra.violations;
  if (entry.retryable) body.retryable = true;
  return {
    type: body.type,
    title: body.title,
    status: body.status,
    code: body.code,
    ...(body.detail ? { detail: body.detail } : {}),
    requestId,
    ...(body.violations ? { violations: body.violations } : {}),
    ...(body.retryable ? { retryable: true } : {}),
  };
}
