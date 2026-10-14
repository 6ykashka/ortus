// Соответствие прототипных и канонических кодов (09 §5.3, B §6.1 «§6 Коды»).
// Канон → прототип однозначен при известной операции `op`; прототип → канон — основной код
// и полный список вариантов.
import type { CanonCode, ClientCode, ErrorCode, PrototypeCode } from './codes.ts';

export interface ErrorMapCtx {
  /** Имя метода адаптера (`reserve`, `createProject`, `kbPublish`, …). */
  op?: string;
}

/** Методы, у которых нарушение перехода процесса — `transition`, а не `conflict`. */
const TRANSITION_OPS = new Set(['moveTask', 'runTransition', 'rejectApproval', 'svcTransition']);

/** Команды проектов задач и `saveRole`: права в них дают `forbidden`, как в модулях. */
const FORBIDDEN_STYLE_OPS = new Set([
  'createProject',
  'updateProject',
  'setProjectRole',
  'initProjectWorkflow',
  'saveWorkflowDraft',
  'publishWorkflow',
  'createProjectTask',
  'runTransition',
  'rejectApproval',
  'saveAutomation',
  'toggleAutomation',
  'deleteAutomation',
  'setTaskField',
  'setTaskParent',
  'addTaskFiles',
  'removeTaskFile',
  'saveRole',
]);

const MODULE_PREFIX = /^(svc|kb|doc|chat|cash)[A-Z]/;

/** Методы модулей 14.10 и проектов задач проверяют права сами и бросают `forbidden`/`not_found`. */
export const isModuleStyleOp = (op?: string): boolean =>
  !!op && (MODULE_PREFIX.test(op) || FORBIDDEN_STYLE_OPS.has(op));

const CANON_TO_PROTO: Readonly<Record<CanonCode | ClientCode, ErrorCode>> = {
  malformed_request: 'validation',
  unknown_field: 'validation',
  session_expired: 'session_expired',
  feature_requires_plan: 'subscription_restricted',
  forbidden_action: 'no_permission',
  module_not_installed: 'module_off',
  module_read_only: 'module_readonly',
  tenant_read_only: 'subscription_restricted',
  tenant_suspended: 'subscription_restricted',
  function_blocked: 'driver_block',
  csrf_failed: 'session_expired',
  origin_not_allowed: 'session_expired',
  not_found: 'not_found',
  reservation_overlap: 'conflict',
  resources_unavailable: 'conflict',
  reservation_expired: 'conflict',
  vehicle_incompatible: 'incompatible',
  inspection_incomplete: 'validation',
  blocking_defect_open: 'conflict',
  photo_not_ready: 'validation',
  invalid_transition: 'conflict',
  separation_of_duties_conflict: 'role_conflict',
  delegation_exceeds_grant: 'role_conflict',
  last_owner_required: 'last_owner',
  quota_exceeded: 'quota_exceeded',
  downgrade_below_usage: 'validation',
  idempotency_key_reused: 'conflict',
  idempotency_in_progress: 'conflict',
  estimate_version_locked: 'conflict',
  estimate_draft_exists: 'conflict',
  change_order_closed: 'conflict',
  agreement_pending: 'conflict',
  public_token_expired: 'not_found',
  nonce_used: 'not_found',
  revision_mismatch: 'conflict',
  payload_too_large: 'validation',
  validation_failed: 'validation',
  odometer_decrease: 'validation',
  amount_invalid: 'validation',
  revision_required: 'validation',
  rate_limited: 'unavailable',
  dependency_unavailable: 'unavailable',
  chat_quota_full: 'conflict',
  chat_file_too_large: 'validation',
  chat_content_forbidden: 'forbidden',
  chat_edit_window_closed: 'conflict',
  chat_member_out_of_scope: 'validation',
  chat_on_hold: 'conflict',
  seats_exhausted: 'seats_exhausted',
  request_pending: 'conflict',
  tier_below_usage: 'validation',
  not_implemented: 'not_implemented',
  offline: 'offline',
  timeout: 'offline',
  upload_failed: 'upload_failed',
};

export function toPrototypeCode(canon: CanonCode | ClientCode, ctx: ErrorMapCtx = {}): ErrorCode {
  if (canon === 'forbidden_action' && isModuleStyleOp(ctx.op)) return 'forbidden';
  if (canon === 'invalid_transition' && ctx.op && TRANSITION_OPS.has(ctx.op)) return 'transition';
  return CANON_TO_PROTO[canon];
}

const PROTO_TO_CANON: Readonly<Record<PrototypeCode, CanonCode | ClientCode>> = {
  not_found: 'not_found',
  offline: 'offline',
  subscription_restricted: 'tenant_read_only',
  module_off: 'module_not_installed',
  module_readonly: 'module_read_only',
  no_permission: 'forbidden_action',
  no_scope: 'not_found',
  driver_block: 'function_blocked',
  validation: 'validation_failed',
  conflict: 'invalid_transition',
  incompatible: 'vehicle_incompatible',
  transition: 'invalid_transition',
  role_conflict: 'separation_of_duties_conflict',
  last_owner: 'last_owner_required',
  forbidden: 'forbidden_action',
  seats_exhausted: 'seats_exhausted',
  quota_exceeded: 'quota_exceeded',
  upload_failed: 'upload_failed',
};

/** Уточнение `conflict` по операции (09 §5.3). */
const CONFLICT_BY_OP: Readonly<Record<string, CanonCode>> = {
  reserve: 'reservation_overlap',
  assignVehicle: 'reservation_overlap',
  moveBooking: 'resources_unavailable',
  saveKbPage: 'revision_mismatch',
  requestSeats: 'request_pending',
};

export function toCanonCode(proto: PrototypeCode, ctx: ErrorMapCtx = {}): CanonCode | ClientCode {
  if (proto === 'conflict' && ctx.op) return CONFLICT_BY_OP[ctx.op] ?? PROTO_TO_CANON.conflict;
  return PROTO_TO_CANON[proto];
}

/** Все канонические коды, которые в прототипе выглядят как `proto`. */
export function toCanonCodes(proto: PrototypeCode): (CanonCode | ClientCode)[] {
  const out = new Set<CanonCode | ClientCode>([PROTO_TO_CANON[proto]]);
  for (const [canon, p] of Object.entries(CANON_TO_PROTO) as [
    CanonCode | ClientCode,
    ErrorCode,
  ][]) {
    if (p === proto) out.add(canon);
  }
  return [...out];
}
