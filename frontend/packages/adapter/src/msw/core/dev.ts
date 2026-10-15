// Dev-маршрут сценариев режима mock (W0.13, вне контракта): тело, сводка, завершение проверки файлов.
import { PRESETS } from './presets.ts';
import type { ScenarioState } from './state.ts';

/** Тело `POST /api/v1/dev/scenario` (вне контракта, только mock). */
export interface DevScenario {
  reset?: boolean;
  preset?: string;
  scenario?: string | null;
  once?: boolean;
  now?: string;
  scanFiles?: boolean;
}

/** Ответ dev-маршрута: часы, сценарий, пресеты, токены приглашений (страницы входа по приглашению). */
export function devSummary(s: ScenarioState) {
  return {
    clock: s.clock,
    scenario: s.scenario?.spec ?? null,
    presets: [...PRESETS],
    invitations: Object.values(s.orgs).flatMap((org) =>
      org.invitations.map((i) => ({
        tenantId: org.tenantId,
        email: i.email,
        status: i.status,
        token: i.token,
      })),
    ),
  };
}

/** Проверка файлов завершена: файлы на карантине становятся готовыми (антивирус режима mock). */
export function scanFiles(s: ScenarioState): void {
  for (const org of Object.values(s.orgs)) {
    for (const f of org.files) if (f.status === 'quarantined') f.status = 'ready';
  }
}
