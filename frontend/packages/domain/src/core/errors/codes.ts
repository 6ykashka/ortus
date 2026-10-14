// Коды ошибок. Прототип: 18 кодов `ApiError` mock-адаптера (набор 14.10 = 03.10, B §1 п. 8).
// Канон: реестр `docs/12-errors-and-events.md` v0.2 (вместе с кодами чатов docs/25)
// и коды 17/D-34 (`seats_exhausted`, `request_pending`, `tier_below_usage`, `not_implemented`).
// После W0.07 источник канона — `api/errors.yaml`; интегратор добавляет тест сверки.

export const PROTOTYPE_CODES = [
  'not_found',
  'offline',
  'subscription_restricted',
  'module_off',
  'module_readonly',
  'no_permission',
  'no_scope',
  'driver_block',
  'validation',
  'conflict',
  'incompatible',
  'transition',
  'role_conflict',
  'last_owner',
  'forbidden',
  'seats_exhausted',
  'quota_exceeded',
  'upload_failed',
] as const;
export type PrototypeCode = (typeof PROTOTYPE_CODES)[number];

/** Коды, которые есть только у http-адаптера: UI показывает текст ответа (`run()` эталона). */
export type HttpOnlyCode = 'session_expired' | 'not_implemented' | 'unavailable';

/** Код, который видит UI в `ApiError.code`. */
export type ErrorCode = PrototypeCode | HttpOnlyCode;

/** Канонический код API → HTTP-статус. */
export const CANON_CODES = {
  malformed_request: 400,
  unknown_field: 400,
  session_expired: 401,
  feature_requires_plan: 402,
  forbidden_action: 403,
  module_not_installed: 403,
  module_read_only: 403,
  tenant_read_only: 403,
  tenant_suspended: 403,
  function_blocked: 403,
  csrf_failed: 403,
  origin_not_allowed: 403,
  not_found: 404,
  reservation_overlap: 409,
  resources_unavailable: 409,
  reservation_expired: 409,
  vehicle_incompatible: 409,
  inspection_incomplete: 409,
  blocking_defect_open: 409,
  photo_not_ready: 409,
  invalid_transition: 409,
  separation_of_duties_conflict: 409,
  delegation_exceeds_grant: 409,
  last_owner_required: 409,
  quota_exceeded: 409,
  downgrade_below_usage: 409,
  idempotency_key_reused: 409,
  idempotency_in_progress: 409,
  estimate_version_locked: 409,
  estimate_draft_exists: 409,
  change_order_closed: 409,
  agreement_pending: 409,
  public_token_expired: 410,
  nonce_used: 410,
  revision_mismatch: 412,
  payload_too_large: 413,
  validation_failed: 422,
  odometer_decrease: 422,
  amount_invalid: 422,
  revision_required: 428,
  rate_limited: 429,
  dependency_unavailable: 503,
  chat_quota_full: 409,
  chat_file_too_large: 413,
  chat_content_forbidden: 403,
  chat_edit_window_closed: 409,
  chat_member_out_of_scope: 422,
  chat_on_hold: 409,
  seats_exhausted: 409,
  request_pending: 409,
  tier_below_usage: 422,
  not_implemented: 501,
} as const satisfies Record<string, number>;
export type CanonCode = keyof typeof CANON_CODES;

/** Клиентские состояния без HTTP-ответа (12 «Реестр кодов», 09 §5.3). */
export const CLIENT_CODES = ['offline', 'timeout', 'upload_failed'] as const;
export type ClientCode = (typeof CLIENT_CODES)[number];
