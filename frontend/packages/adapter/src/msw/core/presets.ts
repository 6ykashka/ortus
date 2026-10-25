// Пресеты состояния сценарного сервера (W0.13): готовые положения сида «Альты» для e2e и страниц этапа 1.
//   logistics-ready — «Логистика» подключена, Марина Котова — «Менеджер логистики» в «Север Логистик»;
//   seats-full      — занято 10 из 10: приглашён Иван Тестов (пример inviteMember/ok);
//   trial-ended     — пробный период закончился: организация и подписка только для чтения;
//   storage-full    — место организации заполнено (quota_exceeded при загрузке);
//   repairs-ready   — «Ремонт и стройка» подключён, сегодня 20.10.2026 (W6.00, Q-W4.00-repair-15).
import type { components } from '@ortus/api-client';
import { seedUuid } from '@ortus/domain/seed';

import { quotaBytes, seatsLimit } from './dto.ts';
import { inviteMember } from './people.ts';
import { orgOf, type ScenarioState, seatsUsed, type TenantRow } from './state.ts';
import { HOUR, iso } from './time.ts';

export const PRESETS = [
  'logistics-ready',
  'seats-full',
  'trial-ended',
  'storage-full',
  'repairs-ready',
] as const;
export type PresetName = (typeof PRESETS)[number];

export const isPreset = (x: unknown): x is PresetName =>
  typeof x === 'string' && (PRESETS as readonly string[]).includes(x);

const ALTA = seedUuid('platform', 't-alta');
const A = (id: string) => seedUuid('t-alta', id);

/** Настройки модуля «Логистика» по умолчанию: ракурсы осмотра домена W0.12 (PHOTO_SIDES). */
export const FLEET_SETTINGS: components['schemas']['LogisticsSettings'] = {
  moduleKey: 'fleet',
  reservationTtlMinutes: 30,
  requirePhotoRoles: ['front', 'rear', 'left', 'right', 'odometer'],
  managerApprovalForRelease: false,
  maxOfflineDraftHours: 24,
};

const alta = (s: ScenarioState): TenantRow => {
  const t = s.tenants.find((x) => x.id === ALTA);
  if (!t) throw new Error('в состоянии нет «Альты»');
  return t;
};

function logisticsReady(s: ScenarioState): void {
  const org = orgOf(s, ALTA);
  const fleet = org.modules.fleet;
  if (fleet && fleet.state !== 'active') {
    fleet.state = 'active';
    fleet.revision++;
    fleet.settings ??= structuredClone(FLEET_SETTINGS);
  }
  const kotova = A('m-kotova');
  if (!org.assignments.some((a) => a.principalId === kotova && a.roleId === A('r-manager'))) {
    org.assignments.push({
      id: seedUuid('t-alta:preset', 'a-kotova-manager'),
      proto: 'a-kotova-manager',
      principalType: 'member',
      principalId: kotova,
      roleId: A('r-manager'),
      scope: { kind: 'org_unit', resourceIds: [A('f-msk-sever')], includeDescendants: true },
      validFrom: s.clock,
      state: 'active',
    });
  }
  org.policyVersion++;
}

function seatsFull(s: ScenarioState): void {
  const t = alta(s);
  const org = orgOf(s, ALTA);
  const extra = [
    ['i.testov@alta.example', 'Иван Тестов'],
    ['p.sergeev@alta.example', 'Павел Сергеев'],
  ];
  for (let i = 0; seatsUsed(org) < seatsLimit(t); i++) {
    const [email, name] = extra[i] ?? [`staff${i}@alta.example`, `Сотрудник ${i}`];
    inviteMember(s, t, org, { email: email ?? '', displayName: name ?? '' });
  }
}

/** Начало текущих московских суток (момент окончания пробного периода). */
const mskDayStart = (at: string): string => {
  const msk = Date.parse(at) + 3 * HOUR;
  return iso(new Date(msk - (msk % (24 * HOUR)) - 3 * HOUR));
};

function trialEnded(s: ScenarioState): void {
  const t = alta(s);
  t.status = 'read_only';
  t.revision++;
  t.subscription.status = 'read_only';
  t.subscription.trialEndsAt = mskDayStart(s.clock);
  t.subscription.revision++;
  orgOf(s, ALTA).policyVersion++;
}

function storageFull(s: ScenarioState): void {
  const t = alta(s);
  const delta = quotaBytes(t) - t.storage.committedBytes;
  t.storage.committedBytes += delta;
  t.storage.buckets.attachments += delta;
  t.storage.measuredAt = s.clock;
}

/** «Ремонт и стройка» подключён; часы сервера — 20.10.2026 10:30 МСК: сценарий ремонта и график идут от этой даты. */
function repairsReady(s: ScenarioState): void {
  const org = orgOf(s, ALTA);
  const repairs = org.modules.repairs;
  if (repairs && repairs.state !== 'active') {
    repairs.state = 'active';
    repairs.revision++;
  }
  s.clock = '2026-10-20T07:30:00Z';
  org.policyVersion++;
}

export function applyPreset(s: ScenarioState, name: PresetName): void {
  const run: Record<PresetName, (s: ScenarioState) => void> = {
    'logistics-ready': logisticsReady,
    'seats-full': seatsFull,
    'trial-ended': trialEnded,
    'storage-full': storageFull,
    'repairs-ready': repairsReady,
  };
  run[name](s);
}
