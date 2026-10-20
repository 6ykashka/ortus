// W1.23 · Каталог редактора ролей (S1-12, AUTH-03): действия `api/permissions.yaml` (уровень `level`,
// `sensitivity`, `owner_only`) по модулям эталона в порядке models.js ALL_MODULES (roleEditorVM :3176–3192).
// Уровень редактора («Просматривать»…«Настраивать», models.js VERBS) включает все обычные и `sensitive` ключи
// уровня; `restricted` ключи логистики — блок «Финансовые разрешения» (:367–372); `owner_only` и `restricted`
// модулей будущих этапов (ремонт — 6, чаты — 7) не выдаются. Ключи роли вне редактора (`members.*`, `roles.*`…)
// сохраняются как есть. Дрейф с контрактом ловит catalog.test.ts.
import type { components } from '@ortus/api-client';
import { CORE, INDUSTRY, VERBS } from '@ortus/domain';
import { company } from '@ortus/texts';
import type { RoleCatalog, RoleDraft } from '@ortus/ui';

type S = components['schemas'];
type Sensitivity = 'normal' | 'sensitive' | 'restricted';

export interface Permission {
  key: string;
  /** Модуль каталога (`core.tasks`, `logistics`…). */
  module: string;
  level: string;
  sensitivity: Sensitivity;
  ownerOnly: boolean;
}

type Row = readonly [string, string, string, Sensitivity, boolean?];

// prettier-ignore
const ROWS: readonly Row[] = [
  ['members.read', 'core.members', 'view', 'normal'],
  ['members.invite', 'core.members', 'create', 'sensitive'],
  ['members.manage', 'core.members', 'edit', 'sensitive'],
  ['roles.read', 'core.members', 'view', 'normal'],
  ['roles.manage', 'core.members', 'settings', 'sensitive'],
  ['roles.assign', 'core.members', 'settings', 'sensitive'],
  ['org_units.read', 'core.members', 'view', 'normal'],
  ['org_units.manage', 'core.members', 'settings', 'sensitive'],
  ['modules.read', 'core.modules', 'view', 'normal'],
  ['modules.manage', 'core.modules', 'settings', 'normal', true],
  ['modules.settings.read', 'core.modules', 'view', 'normal'],
  ['modules.settings.manage', 'core.modules', 'settings', 'sensitive'],
  ['billing.read', 'core.modules', 'view', 'sensitive'],
  ['billing.manage', 'core.modules', 'settings', 'normal', true],
  // W4.07 (0.7.0-stage4): оформление организации — только владелец (owner_only).
  ['branding.manage', 'core.modules', 'settings', 'normal', true],
  ['files.read', 'core.files', 'view', 'normal'],
  ['files.upload', 'core.files', 'create', 'normal'],
  ['data.catalog.read', 'core.data', 'view', 'normal'],
  ['data.query', 'core.data', 'view', 'normal'],
  ['data.export', 'core.data', 'export', 'sensitive'],
  ['tasks.projects.read', 'core.tasks', 'view', 'normal'],
  ['tasks.projects.manage', 'core.tasks', 'settings', 'normal'],
  ['tasks.read', 'core.tasks', 'view', 'normal'],
  ['tasks.create', 'core.tasks', 'create', 'normal'],
  ['tasks.update', 'core.tasks', 'edit', 'normal'],
  ['tasks.transition', 'core.tasks', 'edit', 'normal'],
  ['tasks.approve', 'core.tasks', 'review', 'normal'],
  ['tasks.members.manage', 'core.tasks', 'settings', 'sensitive'],
  ['tasks.workflow.manage', 'core.tasks', 'settings', 'normal'],
  ['tasks.automation.manage', 'core.tasks', 'settings', 'sensitive'],
  ['forms.read', 'core.forms', 'view', 'normal'],
  ['forms.create', 'core.forms', 'create', 'normal'],
  ['forms.manage', 'core.forms', 'edit', 'normal'],
  ['forms.publish', 'core.forms', 'settings', 'normal'],
  ['forms.publish_public', 'core.forms', 'settings', 'sensitive'],
  ['forms.responses.read', 'core.forms', 'view', 'normal'],
  ['forms.responses.review', 'core.forms', 'review', 'normal'],
  ['forms.responses.assign', 'core.forms', 'edit', 'normal'],
  ['calendar.availability.read', 'core.calendar', 'view', 'normal'],
  ['calendar.bookings.read', 'core.calendar', 'view', 'normal'],
  ['calendar.bookings.create', 'core.calendar', 'create', 'normal'],
  ['calendar.bookings.manage', 'core.calendar', 'edit', 'normal'],
  ['knowledge.read', 'core.knowledge', 'view', 'normal'],
  ['knowledge.create', 'core.knowledge', 'create', 'normal'],
  ['knowledge.update', 'core.knowledge', 'edit', 'normal'],
  ['knowledge.publish', 'core.knowledge', 'settings', 'normal'],
  ['chat.read', 'core.chat', 'view', 'normal'],
  ['chat.write', 'core.chat', 'create', 'normal'],
  ['chat.direct', 'core.chat', 'create', 'normal'],
  ['chat.files.send', 'core.chat', 'create', 'normal'],
  ['chat.polls.create', 'core.chat', 'create', 'normal'],
  ['chat.create', 'core.chat', 'edit', 'normal'],
  ['chat.announce', 'core.chat', 'review', 'normal'],
  ['chat.moderate', 'core.chat', 'review', 'normal'],
  ['chat.members.manage', 'core.chat', 'settings', 'sensitive'],
  ['chat.settings.manage', 'core.chat', 'settings', 'normal'],
  ['chat.receipts.read', 'core.chat', 'view', 'normal'],
  ['chat.ephemeral.send', 'core.chat', 'create', 'sensitive'],
  ['chat.pdn.read', 'core.chat', 'view', 'restricted'],
  ['chat.export', 'core.chat', 'export', 'sensitive'],
  ['chat.external', 'core.chat', 'settings', 'sensitive'],
  ['chat.retention.manage', 'core.chat', 'settings', 'sensitive'],
  ['chat.hold.manage', 'core.chat', 'settings', 'normal', true],
  ['chat.audit.read', 'core.chat', 'view', 'restricted'],
  ['chat.policy.manage', 'core.chat', 'settings', 'normal', true],
  ['fleet.vehicles.read', 'logistics', 'view', 'normal'],
  ['fleet.vehicles.manage', 'logistics', 'settings', 'normal'],
  ['fleet.reservations.read', 'logistics', 'view', 'normal'],
  ['fleet.reservations.create', 'logistics', 'create', 'normal'],
  ['fleet.reservations.manage', 'logistics', 'edit', 'normal'],
  ['fleet.reservations.choose', 'logistics', 'create', 'normal'], // W2.71 (0.6.3-stage2, S2-20)
  ['fleet.inspections.read', 'logistics', 'view', 'normal'],
  ['fleet.inspections.submit', 'logistics', 'create', 'normal'],
  ['fleet.inspections.review', 'logistics', 'review', 'normal'],
  ['fleet.trips.read', 'logistics', 'view', 'normal'],
  ['fleet.trips.start', 'logistics', 'create', 'normal'],
  ['fleet.trips.return', 'logistics', 'create', 'normal'],
  ['fleet.trips.review', 'logistics', 'review', 'normal'],
  ['fleet.routes.read', 'logistics', 'view', 'normal'],
  ['fleet.routes.manage', 'logistics', 'edit', 'normal'],
  ['fleet.expenses.read', 'logistics', 'view', 'normal'],
  ['fleet.expenses.create', 'logistics', 'create', 'normal'],
  ['fleet.expenses.review', 'logistics', 'review', 'normal'],
  ['fleet.driver_transfers.read', 'logistics', 'view', 'normal'],
  ['fleet.driver_transfers.request', 'logistics', 'edit', 'normal'],
  ['fleet.driver_transfers.approve', 'logistics', 'review', 'sensitive'],
  ['fleet.earnings.read', 'logistics', 'view', 'restricted'],
  ['fleet.earnings.manage', 'logistics', 'edit', 'restricted'],
  ['repairs.projects.read', 'repairs', 'view', 'normal'],
  ['repairs.projects.manage', 'repairs', 'settings', 'normal'],
  ['repairs.work_logs.read', 'repairs', 'view', 'normal'],
  ['repairs.work_logs.submit', 'repairs', 'create', 'normal'],
  ['repairs.work_logs.review', 'repairs', 'review', 'normal'],
  ['repairs.finance.read', 'repairs', 'view', 'restricted'],
  ['repairs.schedule.read', 'repairs', 'view', 'normal'],
  ['repairs.schedule.shift', 'repairs', 'edit', 'normal'],
  ['repairs.schedule.baseline', 'repairs', 'settings', 'normal'],
  ['repairs.estimates.edit', 'repairs', 'edit', 'restricted'],
  ['repairs.catalog.manage', 'repairs', 'settings', 'normal'],
  ['repairs.changes.submit', 'repairs', 'create', 'normal'],
  ['repairs.supply.request', 'repairs', 'create', 'normal'],
  ['repairs.supply.manage', 'repairs', 'edit', 'normal'],
  ['inventory.items.read', 'inventory', 'view', 'normal'],
  ['inventory.items.manage', 'inventory', 'settings', 'normal'],
  ['inventory.movements.read', 'inventory', 'view', 'normal'],
  ['inventory.movements.post', 'inventory', 'create', 'normal'],
  ['inventory.consume', 'inventory', 'create', 'normal'],
  ['spa.services.read', 'spa', 'view', 'normal'],
  ['spa.services.manage', 'spa', 'settings', 'normal'],
  ['spa.appointments.read', 'spa', 'view', 'normal'],
  ['spa.appointments.create', 'spa', 'create', 'normal'],
  ['spa.appointments.perform', 'spa', 'edit', 'normal'],
  ['spa.appointments.complete', 'spa', 'review', 'normal'],
  ['cash.read', 'cash', 'view', 'sensitive'],
  ['cash.post', 'cash', 'create', 'sensitive'],
  ['cash.manage', 'cash', 'settings', 'sensitive'],
];

/** Действия каталога прав организации (без `platform.*`) в порядке `api/permissions.yaml`. */
export const PERMISSIONS: readonly Permission[] = ROWS.map(
  ([key, module, level, sensitivity, owner]) => ({
    key,
    module,
    level,
    sensitivity,
    ownerOnly: owner === true,
  }),
);

/** Подписи шаблонов ролей каталога (`roleTemplates`, вид «Шаблон» в списке ролей). */
// prettier-ignore
export const TEMPLATE_LABELS: readonly string[] = [
  'Владелец бизнеса', 'Менеджер логистики', 'Водитель', 'Прораб', 'Сметчик', 'Менеджер заявок', 'Замерщик',
  'Снабженец', 'Кладовщик', 'Руководитель проекта', 'Согласующий', 'Исполнитель', 'Наблюдатель проекта',
  'Наблюдатель', 'Владелец чата', 'Модератор чата', 'Участник чата', 'Читатель чата', 'Чаты · создаёт группы',
];

interface EditorModule {
  /** Ключ модуля эталона (models.js ALL_MODULES). */
  key: string;
  /** Модуль каталога прав. */
  catalog: string;
  /** Подключаемый модуль контракта (ModuleAvailability.moduleKey). */
  installable?: 'fleet' | 'spa' | 'repairs';
  name: string;
  icon: string;
}

const mod = (
  key: string,
  catalog: string,
  def: { name: string; icon: string },
  installable?: EditorModule['installable'],
): EditorModule => ({
  key,
  catalog,
  name: def.name,
  icon: def.icon,
  ...(installable ? { installable } : {}),
});

// Порядок ALL_MODULES эталона 14.10: «Документы» и «Обращения» — модули этапов 7 и 4, в каталоге этапа 1 их нет.
const EDITOR_MODULES: readonly EditorModule[] = [
  mod('logistics', 'logistics', INDUSTRY.logistics, 'fleet'),
  mod('spa', 'spa', INDUSTRY.spa, 'spa'),
  mod('repair', 'repairs', INDUSTRY.repair, 'repairs'),
  mod('calendar', 'core.calendar', CORE.calendar),
  mod('tasks', 'core.tasks', CORE.tasks),
  mod('knowledge', 'core.knowledge', CORE.knowledge),
  mod('forms', 'core.forms', CORE.forms),
  mod('data', 'core.data', CORE.data),
  mod('files', 'core.files', CORE.files),
  mod('inventory', 'inventory', CORE.inventory),
  mod('cash', 'cash', CORE.cash),
  mod('chat', 'core.chat', CORE.chat),
];

/** Финансовые разрешения логистики (:3195): подписи эталона вместо подписей каталога. */
const FINANCE: Readonly<Record<string, string>> = {
  'fleet.earnings.read': company.users.editor.earningsRead,
  'fleet.earnings.manage': company.users.editor.earningsManage,
};

/**
 * Каталог `RoleEditor` для организации: `installed(moduleKey)` — подключён ли подключаемый модуль
 * (выключенный отраслевой модуль: «Модуль не подключён организацией — включение недоступно»).
 */
export function roleCatalog(installed: (moduleKey: string) => boolean): RoleCatalog {
  return {
    modules: EDITOR_MODULES.map((m) => {
      const actions = PERMISSIONS.filter((p) => p.module === m.catalog && !p.ownerOnly);
      const verbs = VERBS.flatMap(([level, label]) => {
        const perms = actions
          .filter((p) => p.level === level && p.sensitivity !== 'restricted')
          .map((p) => p.key);
        return perms.length ? [{ key: level, label, perms }] : [];
      });
      const finance = actions.flatMap((p) => {
        const label = FINANCE[p.key];
        if (p.sensitivity !== 'restricted' || !label) return [];
        return [{ key: p.key.replace(/^fleet\./, ''), label, perms: [p.key], restricted: true }];
      });
      return {
        key: m.key,
        name: m.name,
        icon: m.icon,
        on: m.installable ? installed(m.installable) : true,
        verbs: [...verbs, ...finance],
      };
    }),
  };
}

/** Права роли → черновик редактора: уровни, выданные целиком (`actions`), и частично (`partial`). */
export function toDraft(r: S['Role'], catalog: RoleCatalog): RoleDraft {
  const has = new Set(r.permissions);
  const actions: Record<string, string[]> = {};
  const partial: Record<string, string[]> = {};
  for (const m of catalog.modules) {
    const full: string[] = [];
    const some: string[] = [];
    for (const v of m.verbs) {
      const n = v.perms.filter((k) => has.has(k)).length;
      if (n === v.perms.length) full.push(v.key);
      else if (n > 0) some.push(v.key);
    }
    if (full.length) actions[m.key] = full;
    if (some.length) partial[m.key] = some;
  }
  return { id: r.id, name: r.name, system: r.builtIn, actions, partial };
}

/**
 * Изменение черновика → новые права роли (по уровням, прочие ключи роли не трогаются): уровень, ставший целым,
 * добавляет все свои ключи; уровень, который был выдан (целиком или частично) и больше не выдан никак, снимает
 * все свои ключи; частичный уровень, оставшийся частичным, не меняется. Переименование прав не меняет.
 */
export function toPermissions(
  base: readonly string[],
  prev: RoleDraft,
  next: RoleDraft,
  catalog: RoleCatalog,
): string[] {
  const out = new Set(base);
  const levels = (d: RoleDraft, key: string) =>
    new Set([...(d.actions[key] ?? []), ...(d.partial?.[key] ?? [])]);
  for (const m of catalog.modules) {
    const was = levels(prev, m.key);
    const wasFull = new Set(prev.actions[m.key] ?? []);
    const nowFull = new Set(next.actions[m.key] ?? []);
    const now = levels(next, m.key);
    for (const v of m.verbs) {
      if (nowFull.has(v.key) && !wasFull.has(v.key)) for (const k of v.perms) out.add(k);
      else if (was.has(v.key) && !now.has(v.key)) for (const k of v.perms) out.delete(k);
    }
  }
  return [...out];
}

/**
 * Ключи «Итоговых прав роли» в порядке rolePermKeys эталона (models.js): модули редактора, уровни модуля, затем
 * финансовые (`restricted`) ключи; ключи роли вне редактора (`members.*`, `roles.*`…) — в конце, в порядке роли.
 */
export function summaryKeys(permissions: readonly string[], catalog: RoleCatalog): string[] {
  const has = new Set(permissions);
  const out: string[] = [];
  const take = (k: string) => {
    if (has.has(k) && !out.includes(k)) out.push(k);
  };
  for (const m of catalog.modules)
    for (const v of m.verbs) if (!v.restricted) v.perms.forEach(take);
  for (const m of catalog.modules) for (const v of m.verbs) if (v.restricted) v.perms.forEach(take);
  permissions.forEach(take);
  return out;
}

const INDUSTRY_PREFIX: Readonly<Record<string, string>> = {
  fleet: 'fleet.',
  spa: 'spa.',
  repairs: 'repairs.',
};

/** Подключаемые модули, ключи которых есть в роли (факт «Отраслевые модули: …» диалога назначения, :3984). */
export const industryOf = (permissions: readonly string[]): string[] =>
  Object.entries(INDUSTRY_PREFIX)
    .filter(([, prefix]) => permissions.some((k) => k.startsWith(prefix)))
    .map(([key]) => key);
