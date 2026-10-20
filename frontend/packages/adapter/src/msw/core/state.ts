// Состояние сценарного сервера (W0.13): control DB (аккаунты, операторы, организации, членства, сессии)
// и данные организаций с БД (оргструктура, люди, роли, назначения, модули, приглашения, входящие, импорт,
// загрузки). Поля строк — поля контракта OpenAPI 0.3.0-stage1 плюс служебные (`proto` — id прототипа).
// Состояние — обычный JSON: его можно сохранить в sessionStorage, передать снимком в `reset`.
import type { components } from '@ortus/api-client';

import { createScenarioStateFromSeed } from './project.ts';

type S = components['schemas'];

/** «Сейчас» сида: 01.10.2026 10:30 МСК (PD-30, время примеров W0.07). */
export const SEED_NOW = '2026-10-01T07:30:00Z';

export type TenantStatus = S['Tenant']['status'];
export type MembershipStatus = 'active' | 'invited' | 'suspended' | 'ended';
export type ModuleState = S['ModuleManifest']['state'];

export interface AccountRow {
  id: string;
  proto: string;
  displayName: string;
  email: string;
  /** pending — приглашён и ни разу не входил (входить может, как в Go-сиде); locked — вход закрыт. */
  status: 'active' | 'pending' | 'locked';
  lastLoginAt?: string;
  /** Последняя выбранная организация (`selectTenant`, MeContext.lastTenantId). */
  lastTenantId?: string;
}

export interface OperatorRow {
  /** platform_operators.id (`op-N`). */
  id: string;
  /** accounts.id оператора (`account:op-N`, как в Go-сиде): его видит /me/context. */
  accountId: string;
  proto: string;
  displayName: string;
  email: string;
  role: string;
  status: 'active' | 'invited' | 'disabled';
}

export interface StorageRow {
  committedBytes: number;
  reservedBytes: number;
  buckets: { attachments: number; database: number; versions: number; trash: number };
  measuredAt: string;
  pendingQuotaBytes?: number;
  pendingEffectiveAt?: string;
}

export interface StorageChangeRow {
  id: string;
  state: S['StorageChange']['state'];
  requestedQuotaBytes: number;
  quoteId: string;
  quoteExpiresAt: string;
  recurringCharge: S['Money'];
  effectiveAt?: string;
}

export interface TenantRow {
  id: string;
  proto: string;
  name: string;
  status: TenantStatus;
  createdAt: string;
  revision: number;
  subscription: S['Subscription'];
  storage: StorageRow;
  storageChanges: StorageChangeRow[];
}

export interface MembershipRow {
  id: string;
  tenantId: string;
  accountId: string;
  status: MembershipStatus;
  /** OwnerBinding (AUTH-08). */
  owner: boolean;
  ownerSince?: string;
  /** Карточка участника в БД организации. */
  memberId?: string;
}

export interface UnitRow {
  id: string;
  proto: string;
  parentId: string | null;
  name: string;
  kind: S['OrgUnit']['kind'];
  status: S['OrgUnit']['status'];
  revision: number;
}

export interface MemberRow {
  id: string;
  proto: string;
  userId?: string;
  displayName: string;
  email?: string;
  status: S['Member']['status'];
  orgUnitIds: string[];
  lastSeenAt?: string;
  revision: number;
  workProfiles: S['Member']['workProfiles'];
  phone?: string;
}

export interface GroupRow {
  id: string;
  proto: string;
  name: string;
  description: string;
  homeUnitId: string | null;
  memberIds: string[];
  revision: number;
  createdAt: string;
}

export interface RoleRow {
  id: string;
  proto: string;
  name: string;
  description: string;
  builtIn: boolean;
  /** Канонические ключи; у роли `all` вычисляются по подключённым модулям. */
  permissions: string[];
  revision: number;
  /** Все действия подключённых модулей (системная роль «Владелец бизнеса»). */
  all?: boolean;
  /** Функция роли: «Водитель» несовместим с начислениями (SoD). */
  workFunction?: 'driver';
}

export interface AssignmentRow {
  id: string;
  proto: string;
  principalType: 'member' | 'group';
  principalId: string;
  roleId: string;
  scope: S['Scope'];
  validFrom?: string;
  validUntil?: string;
  state: S['Assignment']['state'];
}

export interface ModuleRow {
  state: ModuleState;
  revision: number;
  settings?: S['ModuleSettings'];
  settingsRevision: number;
}

export interface InvitationRow {
  id: string;
  memberId: string;
  email: string;
  status: S['Invitation']['status'];
  expiresAt: string;
  createdAt: string;
  token: string;
}

export interface NotificationRow {
  accountId: string;
  id: string;
  kind: string;
  severity: S['Notification']['severity'];
  title: string;
  body?: string;
  object?: S['ObjectRef'];
  link?: string;
  createdAt: string;
  readAt: string | null;
}

export interface ImportRow {
  id: string;
  state: S['PeopleImport']['state'];
  fileName: string;
  defaultOrgUnitId: string;
  totals: S['PeopleImportTotals'];
  rows: S['PeopleImportRow'][];
  createdAt: string;
  expiresAt: string;
  committedAt?: string;
  revision: number;
}

export interface FileRow {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  status: S['File']['status'];
  createdAt: string;
}

export interface UploadRow {
  uploadId: string;
  fileId: string;
  state: S['UploadSession']['state'];
  purpose: S['UploadSession']['purpose'];
  owner: S['ObjectRef'];
  sizeBytes: number;
  reservedBytes: number;
  ticketExpiresAt: string;
  sessionExpiresAt: string;
  /** Состояние файла на момент последнего перехода сессии. */
  fileStatus: S['UploadSession']['fileStatus'];
  createdAt: string;
  requiredSha256: string;
  contentType: string;
  /** Момент completeUpload — серверное время приёма файла (W2.52, InspectionPhoto.serverCapturedAt). */
  completedAt?: string;
  /** Участник, начавший загрузку (W4.03: вложение задачи прикрепляет только он); у загрузок сида — нет. */
  initiatedBy?: string;
}

/** Данные организации (tenant DB): есть только у организаций с БД на стенде (как в Go-сиде W0.06). */
export interface Org {
  tenantId: string;
  proto: string;
  units: UnitRow[];
  members: MemberRow[];
  groups: GroupRow[];
  roles: RoleRow[];
  assignments: AssignmentRow[];
  /** Подключаемые модули (`fleet`, `spa`, `repairs`) и настройки модулей ядра (`forms`, `tasks`). */
  modules: Record<string, ModuleRow>;
  invitations: InvitationRow[];
  notifications: NotificationRow[];
  imports: ImportRow[];
  files: FileRow[];
  uploads: UploadRow[];
  /** Версия политики доступа: растёт при изменении ролей, назначений, групп и модулей. */
  policyVersion: number;
}

export interface SessionRow {
  id: string;
  accountId: string;
  csrf: string;
  issuedAt: string;
  expiresAt: string;
}

export interface LoginRow {
  state: string;
  returnTo: string;
  createdAt: string;
}

export interface IdempotencyRow {
  fingerprint: string;
  status: number;
  body: unknown;
  headers: Record<string, string>;
}

export interface ScenarioState {
  v: 1;
  /** «Сейчас» сервера: время сида; двигают тесты и `POST /api/v1/dev/scenario {now}`. */
  clock: string;
  /** Счётчик новых идентификаторов. */
  seq: number;
  accounts: AccountRow[];
  operators: OperatorRow[];
  tenants: TenantRow[];
  memberships: MembershipRow[];
  orgs: Record<string, Org>;
  sessions: Record<string, SessionRow>;
  logins: Record<string, LoginRow>;
  idempotency: Record<string, IdempotencyRow>;
  /** Постоянный X-Test-Scenario (e2e без заголовков); `once` — снимается после первого срабатывания. */
  scenario: { spec: string; once: boolean } | null;
}

/** Свежее состояние: проекция сида домена W0.12; каждый вызов — новые объекты. */
export function createScenarioState(): ScenarioState {
  return createScenarioStateFromSeed();
}

/** Данные организации или ошибка разработки (вызывать после проверки членства). */
export function orgOf(s: ScenarioState, tenantId: string): Org {
  const org = s.orgs[tenantId];
  if (!org) throw new Error(`у организации ${tenantId} нет данных`);
  return org;
}

/**
 * Занятые места: активные и приглашённые участники с аккаунтом (people/seats.ts W0.12). Карточка без аккаунта
 * (createMember, 0.4.0-stage1, W1.00) места не занимает — «Рабочего без входа можно вести карточкой бесплатно».
 */
export const seatsUsed = (org: Org): number =>
  org.members.filter(
    (m) => (m.status === 'active' || m.status === 'invited') && m.userId !== undefined,
  ).length;
