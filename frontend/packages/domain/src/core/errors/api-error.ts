// `ApiError` эталона (`api.js:12–14`): код, текст для пользователя и дополнительные поля
// (`vehicleId`, `slots`, …). `db` — проекция после неудачной команды (`cmd` эталона).
import type { ErrorCode } from './codes.ts';

export interface ApiErrorExtra {
  db?: unknown;
  status?: number;
  requestId?: string;
  violations?: readonly { field: string; code: string; message: string }[];
  vehicleId?: string;
  slots?: readonly number[];
  [key: string]: unknown;
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  db?: unknown;
  status?: number;
  requestId?: string;
  violations?: ApiErrorExtra['violations'];
  vehicleId?: string;
  slots?: readonly number[];

  constructor(code: ErrorCode, message: string, extra: ApiErrorExtra = {}) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    Object.assign(this, extra);
  }
}

/**
 * Политика 404 модулей (B §1 п. 8): объект, который участник не видит, — `not_found`
 * (одинаково для чужих и несуществующих id); видимый объект без нужного права — `forbidden`.
 */
export function denyAccess(
  visible: boolean,
  forbiddenText: string,
  notFoundText = 'Не найдено',
): ApiError {
  return visible
    ? new ApiError('forbidden', forbiddenText)
    : new ApiError('not_found', notFoundText);
}
