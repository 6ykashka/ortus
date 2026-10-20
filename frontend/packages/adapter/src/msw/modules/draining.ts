// W2.62 (AC-12, S1-18, Q-W2.32-5): отключение модуля при начатых процессах — как modulesreg backend. Процессы
// «Логистики» — рейсы (activity.go FleetTrips): начатые (в пути, возврат, сдан, доработка) можно завершить и принять
// после отключения и держат модуль в draining; назначенные не начатые закрываются отключением. Когда начатых не
// осталось, draining сам переходит в конечное состояние (service.go settle — при каждом чтении установок). У прочих
// модулей поставщика процессов нет: их draining кончается сразу.
import type { components } from '@ortus/api-client';

import type { ModuleRow, ModuleState, Org } from '../core/state.ts';
import { fleetOf, type TripRow } from '../fleet/state.ts';

type S = components['schemas'];

/** Состояния начатого рейса (tripsStarted backend). */
const STARTED: ReadonlySet<string> = new Set(['on_route', 'returning', 'submitted', 'rework']);
/** Состояния назначенного не начатого рейса (tripsNotStarted backend). */
const NOT_STARTED: ReadonlySet<string> = new Set(['assigned', 'inspection', 'defect_review']);
/** Строк «Затронет сейчас» в ответе; остальные — hiddenCount. */
const PREVIEW_LIMIT = 50;

type WithFleet = Org & { fleet?: unknown };

/** Рейсы организации, если логистика уже в состоянии (без посева: у сида рейсы только запланированы). */
const tripsOf = (org: Org): TripRow[] => ((org as WithFleet).fleet ? fleetOf(org).trips : []);

/** У модуля `key` есть начатые процессы (Activity.Started). */
export function hasStarted(org: Org, key: string): boolean {
  return key === 'fleet' && tripsOf(org).some((t) => STARTED.has(t.state));
}

/** Процессы модуля сейчас (Activity.Items): начатые первыми, затем по началу (без начала — в конце) и номеру. */
export function activeItems(
  org: Org,
  key: string,
): { items: S['ModuleDeactivationItem'][]; hiddenCount: number } {
  if (key !== 'fleet') return { items: [], hiddenCount: 0 };
  const all = tripsOf(org)
    .filter((t) => STARTED.has(t.state) || NOT_STARTED.has(t.state))
    .sort(
      (a, b) =>
        Number(!STARTED.has(a.state)) - Number(!STARTED.has(b.state)) ||
        (a.startedAt ?? '￿').localeCompare(b.startedAt ?? '￿') ||
        a.number.localeCompare(b.number),
    );
  const items = all.slice(0, PREVIEW_LIMIT).map((t): S['ModuleDeactivationItem'] => {
    const name = org.members.find((m) => m.id === t.driverMemberId)?.displayName;
    return {
      kind: 'active_process',
      object: { moduleKey: 'fleet', entityType: 'trip', entityId: t.id },
      title: `Рейс ${t.number}`,
      state: t.state,
      ...(name ? { assigneeName: name } : {}),
      effect: STARTED.has(t.state) ? 'finish_allowed' : 'closed',
    };
  });
  return { items, hiddenCount: Math.max(all.length - items.length, 0) };
}

/**
 * Состояние после «Отключить» (target backend): при начатых процессах — draining с конечным `final`, иначе — сразу
 * `final`. Включение снимает draining.
 */
export function disableTo(org: Org, key: string, row: ModuleRow, final: ModuleState): ModuleState {
  if ((row.state === 'active' || row.state === 'draining') && hasStarted(org, key)) {
    row.drainTo = final;
    return 'draining';
  }
  delete row.drainTo;
  return final;
}

/** Досчёт: draining без начатых процессов — конечное состояние (Service.settle; действует сервис). */
export function settleDraining(org: Org): void {
  for (const [key, row] of Object.entries(org.modules)) {
    if (row.state !== 'draining' || hasStarted(org, key)) continue;
    row.state = row.drainTo ?? 'read_only';
    delete row.drainTo;
    row.revision++;
    org.policyVersion++;
  }
}
