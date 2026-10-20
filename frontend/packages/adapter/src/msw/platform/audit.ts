// Журнал действий платформы (platform_audit) в состоянии сервера (`platformAudit`, JSON — переживает перезагрузку
// вкладки, как остальное состояние). Журнал на старте — строки эталона (пример listPlatformAuditEvents/ok, PD-43).
// Вынесен из platform/operator.ts (W1.00) и platform/pricing.ts (W4.07) в возврате 1 W4.07: строки пишут и команды
// владельца (заявка на тариф и её отмена, billing/plans.ts), а billing/plans.ts читают core/dto.ts и operator.ts —
// отдельный модуль без зависимостей от хендлеров не даёт циклов импорта.
import type { components } from '@ortus/api-client';

import { example } from '../contract/index.ts';
import type { HandlerContext } from '../core/registry.ts';
import type { ScenarioState } from '../core/state.ts';

type S = components['schemas'];
type AuditEvent = S['PlatformAuditEvent'];

type WithAudit = ScenarioState & { platformAudit?: AuditEvent[] };

/** Журнал платформы в состоянии сервера; на старте — строки примера (эталон 14.10). */
export function auditOf(s: ScenarioState): AuditEvent[] {
  const x = s as WithAudit;
  x.platformAudit ??= structuredClone(
    (example('listPlatformAuditEvents', 'ok') as { items?: AuditEvent[] } | undefined)?.items ?? [],
  );
  return x.platformAudit;
}

/**
 * Строка журнала платформы от субъекта запроса: оператор (по умолчанию) или владелец организации
 * (PlatformAuditActor.kind owner — заявка на тариф и её отмена). Без субъекта — системная строка.
 */
export function audit(
  ctx: HandlerContext,
  action: string,
  target: S['PlatformAuditTarget'],
  details: Record<string, string> = {},
  reason?: string,
  kind: 'operator' | 'owner' = 'operator',
): void {
  const rows = auditOf(ctx.s);
  const next = rows.reduce((n, r) => Math.max(n, Number(r.id)), 0) + 1;
  const a = ctx.actor;
  rows.push({
    id: String(next),
    at: ctx.now(),
    action,
    actor: a ? { kind, accountId: a.id, displayName: a.displayName } : { kind: 'system' },
    target,
    ...(reason ? { reason } : {}),
    result: 'ok',
    details,
  });
}
