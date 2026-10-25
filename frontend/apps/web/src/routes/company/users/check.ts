// W1.23 · «Проверка доступа» на explainAccess (S1-14, AUTH-04): действия эталона (ACTIONS :2339) → ключи
// каталога, решение сервера (`decisiveCheck`, `denyCode`, трассы назначений) → причина эталона (models.js REASON),
// основание «роль · область · через группу» (accessVM :3226–3232), рабочее место (:3234–3238).
import type { components } from '@ortus/api-client';
import { INDUSTRY, REASON } from '@ortus/domain';
import { company, format, shell } from '@ortus/texts';

import { scopeLabel, type Units, unitLabel } from './model.ts';
import { PEOPLE_TEXT } from './texts.ts';

type S = components['schemas'];

export interface CheckAction {
  value: string;
  label: string;
  permission: string;
  /** Подключаемый модуль действия: «Модуль: {name}» отказа module_off. */
  moduleKey: 'fleet' | 'spa' | 'repairs';
}

const A = company.users.check.actions;

export const CHECK_ACTIONS: readonly CheckAction[] = [
  {
    value: 'fleet.view',
    label: A.fleetView,
    permission: 'fleet.vehicles.read',
    moduleKey: 'fleet',
  },
  {
    value: 'fleet.reserve',
    label: A.fleetReserve,
    permission: 'fleet.reservations.create',
    moduleKey: 'fleet',
  },
  {
    value: 'fleet.review',
    label: A.fleetReview,
    permission: 'fleet.trips.review',
    moduleKey: 'fleet',
  },
  {
    value: 'fleet.earnings',
    label: A.fleetEarnings,
    permission: 'fleet.earnings.read',
    moduleKey: 'fleet',
  },
  { value: 'spa.view', label: A.spaView, permission: 'spa.appointments.read', moduleKey: 'spa' },
  {
    value: 'repair.create',
    label: A.repairCreate,
    permission: 'repairs.work_logs.submit',
    moduleKey: 'repairs',
  },
];

/** Объект проверки (OBJECTS эталона :2344): машина или рейс логистики; подразделение — у самого объекта. */
export interface CheckObject {
  value: string;
  label: string;
  /** Подразделение объекта: с ним уходит explainAccess (гранты ядра выдаются на подразделение). */
  orgUnitId: string;
}

/**
 * Объекты «Проверки доступа» (Q-W1.23-8): «{машина} · {регион / фирма}» и «Рейс {номер} · {регион / фирма}».
 * Подразделение вне области вошедшего — подпись без него. Нет машин и рейсов (нет права на логистику или модуль не
 * подключён) — пусто: вкладка предлагает фирмы организации.
 */
export function checkObjects(
  vehicles: readonly S['Vehicle'][],
  trips: readonly S['TripPlan'][],
  units: Units,
): CheckObject[] {
  const place = (orgUnitId: string): string => {
    const u = units.byId.get(orgUnitId);
    return u ? ' · ' + unitLabel(u, units) : '';
  };
  return [
    ...vehicles.map((v) => ({
      value: 'vehicle:' + v.id,
      label: v.displayName + place(v.orgUnitId),
      orgUnitId: v.orgUnitId,
    })),
    ...trips.map((t) => ({
      value: 'trip:' + t.id,
      label: format(PEOPLE_TEXT.checkTrip, { number: t.number }) + place(t.orgUnitId),
      orgUnitId: t.orgUnitId,
    })),
  ];
}

export type Reason = keyof typeof REASON;

/** Причина отказа эталона по решению сервера; `null` — разрешено. */
export function reasonOf(x: S['AccessExplanation']): Reason | null {
  if (x.allowed) return null;
  switch (x.decisiveCheck) {
    case 'module-installation':
      return x.denyCode === 'module_read_only' ? 'module_readonly' : 'module_off';
    case 'separation-of-duties':
      return 'driver_block';
    case 'resource-scope':
    case 'relationship':
      return 'no_scope';
    default:
      return x.grants.some((g) => g.mismatch === 'out_of_scope' || g.mismatch === 'other_object')
        ? 'no_scope'
        : 'no_permission';
  }
}

export type Tone = 'ok' | 'warn' | 'neutral' | 'danger';

export interface CheckResult {
  tone: Tone;
  chip: string;
  icon: string;
  title: string;
  text: string;
}

export interface ResultContext {
  memberName: string;
  action: CheckAction;
  /** Подпись выбранного объекта (подразделения) для «Объект: …». */
  objectLabel?: string;
  units: Units;
  /** Имена групп по id (основание «через группу»). */
  groups: ReadonlyMap<string, string>;
}

const MODULE_NAME: Readonly<Record<CheckAction['moduleKey'], string>> = {
  fleet: INDUSTRY.logistics.name,
  spa: INDUSTRY.spa.name,
  repairs: INDUSTRY.repair.name,
};

const C = company.users.check;

/** Карточка результата «Проверки доступа» (:409–417). */
export function resultOf(x: S['AccessExplanation'], ctx: ResultContext): CheckResult {
  const action = ctx.action.label.toLowerCase();
  const reason = reasonOf(x);
  if (!reason) {
    const g = x.grants.find((t) => t.matches);
    const group = g?.groupId ? ctx.groups.get(g.groupId) : undefined;
    const text = g
      ? format(C.basis, {
          kind: 'role',
          role: g.roleName,
          scope: scopeLabel(g.scope, ctx.units),
          via: group ? format(PEOPLE_TEXT.viaGroup, { group }) : 'none',
        })
      : format(C.basis, { kind: 'finance' });
    return {
      tone: 'ok',
      chip: C.allowed,
      icon: 'check_circle',
      title: format(C.can, { name: ctx.memberName, action }),
      text,
    };
  }
  const R = REASON[reason];
  const extra =
    reason === 'no_scope' && ctx.objectLabel
      ? ' ' + format(C.object, { object: ctx.objectLabel })
      : reason === 'module_off'
        ? ' ' + format(C.module, { module: MODULE_NAME[ctx.action.moduleKey] })
        : '';
  return {
    tone: R.tone as Tone,
    chip: R.label,
    icon: R.icon,
    title: format(C.cannot, { name: ctx.memberName, action }),
    text: R.text + extra,
  };
}

export interface Workplace {
  fleet: boolean;
  spa: boolean;
  repairs: boolean;
  review: boolean;
  earnings: boolean;
}

/** «Рабочее место сотрудника · вычислено»: модули с просмотром, «Приёмка смен», «Начисления» (:3234–3238). */
export function workplaceOf(w: Workplace): { icon: string; label: string }[] {
  const out: { icon: string; label: string }[] = [];
  if (w.fleet) out.push({ icon: INDUSTRY.logistics.icon, label: INDUSTRY.logistics.name });
  if (w.spa) out.push({ icon: INDUSTRY.spa.icon, label: INDUSTRY.spa.name });
  if (w.repairs) out.push({ icon: INDUSTRY.repair.icon, label: INDUSTRY.repair.name });
  if (w.review) out.push({ icon: 'fact_check', label: shell.nav.items.review });
  if (w.earnings) out.push({ icon: 'lock_open', label: C.earnings });
  return out;
}

/** Ключи «рабочего места»: просмотр трёх отраслевых модулей, приёмка смен, начисления. */
export const WORKPLACE_PERMISSIONS = {
  fleet: 'fleet.vehicles.read',
  spa: 'spa.appointments.read',
  repairs: 'repairs.projects.read',
  review: 'fleet.trips.review',
  earnings: 'fleet.earnings.read',
} as const satisfies Record<keyof Workplace, string>;
