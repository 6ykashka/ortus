// W1.23 · Модель экрана «Пользователи и роли» над DTO контракта 0.4.0-stage1 (чистые функции, без React):
// подписи областей (models.js scopeLabel :258–275, unitLabel), назначения участника (usersVM :3146–3155, grants),
// места (api.js :56–58; Q-W1.00-10 — карточка без аккаунта места не занимает), строка «Люди» (:3162), статус
// участника (models.js MEMBER_STATE :145–149), вид роли и «{n} разрешений · назначена: {k}» (:3157–3160).
import type { components } from '@ortus/api-client';
import { INDUSTRY } from '@ortus/domain';
import { company, format } from '@ortus/texts';

import { TEMPLATE_LABELS } from './catalog.ts';
import { PEOPLE_TEXT } from './texts.ts';

type S = components['schemas'];
export type Member = S['Member'];
export type Role = S['Role'];
export type Assignment = S['Assignment'];
export type OrgUnit = S['OrgUnit'];
export type Group = S['Group'];
export type Scope = S['Scope'];

export interface Units {
  /** Регионы верхнего уровня в порядке API. */
  regions: OrgUnit[];
  byId: ReadonlyMap<string, OrgUnit>;
  /** Фирмы региона в порядке API (models.js firmsOf). */
  firmsOf: (regionId: string) => OrgUnit[];
  /**
   * Фирма по умолчанию диалогов и «Проверки доступа» (Q-23, PD-27): домашняя фирма вошедшего (`Member.orgUnitIds`),
   * иначе первая фирма первого региона в порядке API. У «Альты» это «Север Логистик» и в mock, и на стенде — Go
   * отдаёт подразделения не в порядке прототипа.
   */
  firstFirm: () => OrgUnit | undefined;
}

export function unitsOf(units: readonly OrgUnit[], home: readonly string[] = []): Units {
  const live = units.filter((u) => u.status === 'active');
  const byId = new Map(live.map((u) => [u.id, u]));
  const regions = live.filter((u) => u.kind === 'region');
  const firmsOf = (regionId: string) =>
    live.filter((u) => u.kind !== 'region' && u.parentId === regionId);
  const homeFirm = home.map((id) => byId.get(id)).find((u) => u && u.kind !== 'region');
  return {
    regions,
    byId,
    firmsOf,
    firstFirm: () =>
      homeFirm ?? regions.flatMap((r) => firmsOf(r.id))[0] ?? live.find((u) => u.kind !== 'region'),
  };
}

/** «{Регион} / {Фирма}» или имя региона (models.js unitLabel). */
export function unitLabel(u: OrgUnit, units: Units): string {
  if (u.kind === 'region') return u.name;
  const parent = u.parentId ? units.byId.get(u.parentId) : undefined;
  return parent ? `${parent.name} / ${u.name}` : u.name;
}

/** Подпись области назначения (models.js scopeLabel); проекта в этапе 1 нет — «Проект» (Q-W0.12-5). */
export function scopeLabel(scope: Scope, units: Units): string {
  switch (scope.kind) {
    case 'tenant':
      return company.dialogs.assign.types.tenant;
    case 'self':
      return PEOPLE_TEXT.scope.self;
    case 'project':
    case 'resource_pool':
      return PEOPLE_TEXT.scope.project;
    case 'org_unit': {
      const u = units.byId.get(scope.resourceIds[0] ?? '');
      if (!u) return PEOPLE_TEXT.scope.none;
      return u.kind === 'region' ? `${PEOPLE_TEXT.scope.region} ${u.name}` : unitLabel(u, units);
    }
    default:
      // Виды этапов 4–7 (space, page, …) и незнакомые — «Особая область» (ADR-0014 п. 7).
      return PEOPLE_TEXT.scope.special;
  }
}

export type AreaType = 'tenant' | 'region' | 'firm';

/** Область назначения из выбора диалога «Назначить роль» (:2730): подразделение — с поддеревом. */
export function scopeOf(type: AreaType, region: string, firm: string): Scope {
  if (type === 'tenant') return { kind: 'tenant', resourceIds: [], includeDescendants: true };
  return {
    kind: 'org_unit',
    resourceIds: [type === 'region' ? region : firm],
    includeDescendants: true,
  };
}

const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** «Действует до» `YYYY-MM-DD` (включительно) → `validUntil`: конец этого дня по Москве (полуинтервал). */
export function untilInstant(date: string): string {
  const [y = 0, m = 1, d = 1] = date.split('-').map(Number);
  const end = Date.UTC(y, m - 1, d) + DAY_MS - MSK_OFFSET_MS;
  return new Date(end).toISOString().replace('.000Z', 'Z');
}

/** `validUntil` → последний день действия «ДД.ММ.ГГГГ» по Москве. */
export function untilDate(instant: string): string {
  const last = new Date(Date.parse(instant) - 1 + MSK_OFFSET_MS);
  const dd = String(last.getUTCDate()).padStart(2, '0');
  const mm = String(last.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${last.getUTCFullYear()}`;
}

export interface Grant {
  assignment: Assignment;
  role: Role | undefined;
  /** Группа, через которую участник получил назначение. */
  group: Group | undefined;
}

/** Назначения участника: прямые и через группы, без истёкших (grants :3151). */
export function grantsOf(
  memberId: string,
  assignments: readonly Assignment[],
  groups: readonly Group[],
  roles: readonly Role[],
): Grant[] {
  const roleById = new Map(roles.map((r) => [r.id, r]));
  const mine = new Map(groups.filter((g) => g.memberIds.includes(memberId)).map((g) => [g.id, g]));
  return assignments.flatMap((a) => {
    if (a.state === 'expired') return [];
    const group = a.principalType === 'group' ? mine.get(a.principalId) : undefined;
    const direct = a.principalType === 'member' && a.principalId === memberId;
    return direct || group ? [{ assignment: a, role: roleById.get(a.roleId), group }] : [];
  });
}

export interface GrantLine {
  role: string;
  /** Область и срок: «Москва / Север Логистик · до 31.10.2026». */
  scope: string;
  via?: string;
}

export function grantLine(g: Grant, units: Units): GrantLine {
  const until = g.assignment.validUntil;
  const scope =
    scopeLabel(g.assignment.scope, units) +
    (until ? ` · ${format(PEOPLE_TEXT.until, { date: untilDate(until) })}` : '');
  // Роли назначения нет в listRoles (403 у участника с правами в своей области) — состояние «нет права».
  const line: GrantLine = { role: g.role?.name ?? PEOPLE_TEXT.roleHidden, scope };
  if (g.group) line.via = format(PEOPLE_TEXT.via, { group: g.group.name });
  return line;
}

/**
 * «{n} участника: имена» (usersVM :3156): n — по составу группы; участники вне области вошедшего (listMembers
 * отдаёт свою область) названы числом, а не пропущены (возврат 16.10 №3, no-reference).
 */
export function groupMembersLine(
  memberIds: readonly string[],
  names: ReadonlyMap<string, string>,
): string {
  const shown = memberIds.flatMap((id) => names.get(id) ?? []);
  const hidden = memberIds.length - shown.length;
  const parts =
    hidden === 0
      ? shown
      : shown.length === 0
        ? [PEOPLE_TEXT.groupAllHidden]
        : [...shown, format(PEOPLE_TEXT.groupHidden, { k: hidden })];
  return format(company.users.groupMembers, { n: memberIds.length, names: parts.join(', ') });
}

/** Участники без действующих назначений («без роли: k», :3145). */
export function noRoleCount(
  members: readonly Member[],
  assignments: readonly Assignment[],
  groups: readonly Group[],
): number {
  return members.filter((m) => grantsOf(m.id, assignments, groups, []).length === 0).length;
}

export interface Seats {
  used: number;
  /**
   * null — тариф без ограничения (нет права `seats`); undefined — неизвестно: подписка не загружена (загрузка,
   * сбой, нет права на подписку) — это не «без ограничения».
   */
  limit: number | null | undefined;
}

/** Последнее значение права подписки (ручные права идут после тарифных). */
const entitlement = (sub: S['Subscription'], key: string): number | undefined =>
  sub.entitlements.filter((e) => e.key === key).at(-1)?.value;

/** Места: активные с аккаунтом и приглашённые; лимит — право `seats` подписки. */
export function seatsOf(members: readonly Member[], sub: S['Subscription'] | undefined): Seats {
  const used = members.filter(
    (m) => m.status === 'invited' || (m.status === 'active' && m.userId !== undefined),
  ).length;
  return { used, limit: sub ? (entitlement(sub, 'seats') ?? null) : undefined };
}

/** «{N} участников[ · без роли: k][ · мест занято u из l]» (usersVM :3162, слово не склоняется). */
export const peopleNote = (n: number, noRole: number, seats: Seats): string =>
  format(company.users.peopleNote, {
    n,
    noRole,
    used: seats.used,
    limit: seats.limit ?? 0,
  });

export interface Chip {
  label: string;
  tone: 'ok' | 'warn' | 'danger';
  icon: string;
}

/** Статус участника (MEMBER_STATE): `suspended` контракта — «Заблокирован» эталона. */
export function memberChip(status: Member['status']): Chip {
  switch (status) {
    case 'active':
      return { label: PEOPLE_TEXT.status.active, tone: 'ok', icon: 'check_circle' };
    case 'invited':
      return { label: PEOPLE_TEXT.status.invited, tone: 'warn', icon: 'schedule' };
    case 'suspended':
      return { label: PEOPLE_TEXT.status.suspended, tone: 'danger', icon: 'block' };
  }
}

/** «{имя} · {почта}» — должности в контракте нет (эталон для участника без должности, :3993). */
export const memberSubtitle = (m: Member): string =>
  m.email ? `${m.displayName} · ${m.email}` : m.displayName;

/** Действующая функция «Водитель» (Member.workProfiles). */
export const isDriver = (m: Member): boolean => m.workProfiles.includes('driver');

export type RoleKind = 'system' | 'template' | 'custom';

const TEMPLATES = new Set([
  ...TEMPLATE_LABELS,
  ...Object.values(INDUSTRY).flatMap((d) => d.templates),
]);

/** Вид роли: в контракте его нет — по встроенности и имени шаблона каталога или эталона. */
export function roleKind(r: Role): RoleKind {
  if (r.builtIn) return 'system';
  return TEMPLATES.has(r.name) ? 'template' : 'custom';
}

/** Роль функции «Водитель» — шаблон `driver` каталога (`workFunction: driver`). */
export const isDriverRole = (r: Role): boolean => !r.builtIn && r.name === PEOPLE_TEXT.driverRole;

/** «Все права · назначена: k» / «{n} разрешений · назначена: k» (:3160). */
export function roleMeta(r: Role, assignments: readonly Assignment[]): string {
  const assigned = assignments.filter((a) => a.roleId === r.id && a.state !== 'expired').length;
  return format(company.users.roleMeta, {
    all: r.builtIn ? 'true' : 'false',
    perms: r.permissions.length,
    assigned,
  });
}
