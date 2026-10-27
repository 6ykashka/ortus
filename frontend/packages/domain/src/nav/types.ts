// W1.20 · Навигация оболочки: типы манифестов модулей, контекста и результата.
// Источник поведения — docs/plan/analysis/01-shell.md §9 (navForBase 14.10, D-23) и §12 (gateVM).
// Данные — GET /me/context (TenantContext: доступность модулей и возможности), а не персонаж эталона.

/** Ключ страницы (`pg.*` эталона, ADR-0001). `planned` не реализуется (PD-24). */
export type PageKey =
  | 'home'
  | 'modules'
  | 'users'
  | 'structure'
  | 'billing'
  | 'branding'
  | 'storage'
  | 'fleet'
  | 'pool'
  | 'review'
  | 'defects'
  | 'earnings'
  | 'expenseCategories'
  | 'today'
  | 'cars'
  | 'repair'
  | 'repairSupply'
  | 'repairCatalog'
  | 'spa'
  | 'cashSelf'
  | 'chat'
  | 'tasks'
  | 'leads'
  | 'service'
  | 'forms'
  | 'calendar'
  | 'knowledge'
  | 'docs'
  | 'data'
  | 'files'
  | 'cash'
  | 'inventory'
  | 'inventoryMovements'
  | 'tenants'
  | 'usage'
  | 'requests'
  | 'accounts'
  | 'plans';

/** Контур маршрута: организация `/t/:tenantId/…` или оператор `/platform/…`. */
export type Area = 'tenant' | 'platform';

/**
 * Рабочее место: от него зависят группы меню и состав «Общих модулей» (эталон рисует меню по персонажу,
 * реализация выводит рабочее место из возможностей `/me/context`).
 */
export type Audience = 'operator' | 'owner' | 'office' | 'driver' | 'practitioner' | 'foreman';

/** Группа меню (порядок групп — `GROUP_ORDER`). Подпись — `shell.nav.groups.<key>` словаря. */
export type GroupKey =
  | 'overview'
  | 'company'
  | 'logistics'
  | 'repair'
  | 'industries'
  | 'work'
  | 'core'
  | 'readonly'
  | 'platform';

/**
 * Подпись — ключ словаря `@ortus/texts` `shell.nav`: `items.<k>`, `groups.<k>` или `bottom.<k>`.
 * Домен строк не хранит: подпись выбирает оболочка.
 */
export type LabelKey = `items.${string}` | `groups.${string}` | `bottom.${string}`;

/** Вид модуля: подключаемый отраслевой (D-23), ядро, системный (обзор, компания) или контур оператора. */
export type ModuleKind = 'industry' | 'core' | 'system' | 'platform';

/** Ветка AccessGate эталона: A — страницы `PAGE_MOD`, B — логистика и рабочие места, owner — «Компания». */
export type GateBranch = 'A' | 'B' | 'owner' | 'none';

export interface NavPlacement {
  group: GroupKey;
  label: LabelKey;
  /**
   * Пункт профиля рабочего места (меню эталона по персонажу, :2996–3002): виден по рабочему месту без
   * проверки права, пока модуль организации не «не подключён», — как пункты модулей этапа 7 (R-2);
   * страница открыта (заглушка до этапа модуля), права на данные проверяет страница и сервер.
   */
  profile?: true;
}

export interface PageManifest {
  key: PageKey;
  /** Сегмент маршрута (kebab-case ключа, ADR-0001). */
  segment: string;
  /** Иконка Material Symbols пункта меню. */
  icon: string;
  /** Права «любое из» (canAny, Q-W0.11-1): пункт и страница. Пусто — права не проверяются. */
  view: readonly string[];
  gate: GateBranch;
  /** Заголовок отказа ветки B: `review` — «Нет права на приёмку смен», иначе «Нет роли с доступом…». */
  denyTitle?: 'review';
  /** Пункт меню по рабочему месту; нет записи — страница вне меню этого рабочего места. */
  nav?: Partial<Record<Audience, NavPlacement>>;
  /**
   * Подпись страницы вне меню (W1.24, Q-W1.24-17: «Хранилище»): имя раздела в гейте и заголовок заглушки.
   * У страницы меню подпись берётся из размещения `nav`.
   */
  label?: LabelKey;
}

export interface NavManifest {
  /** Имя файла манифеста `modules/<id>.ts`. */
  id: string;
  kind: ModuleKind;
  /** Ключ модуля в `ModuleAvailability.moduleKey`; `null` — системные страницы, всегда доступны. */
  moduleKey: string | null;
  /** Ключ модуля домена (`ALL_MODULES`): имя в заголовке гейта и баннере «Модуль «…» отключён.». */
  domainModule?: string;
  /**
   * `catalog` — доступность из `/me/context`; `future` — модуль будущего этапа без доступности в каталоге
   * этапа 1 (чаты, обращения, документы): пункт по рабочему месту, страница — заглушка до своего этапа.
   */
  availability: 'catalog' | 'future';
  /** Этап плана v2, в котором появляется страница модуля. */
  stage: number;
  area: Area;
  /** Пункт D-23 в группе «Отключены · только чтение» для модуля, отключённого с историей. */
  readonlyItem?: { page: PageKey; label: LabelKey; icon: string };
  pages: readonly PageManifest[];
}

/** Доступность модуля для участника (`ModuleAvailability` контракта). */
export interface ModuleAvailabilityLike {
  moduleKey: string;
  state: string;
  accessMode: string;
  reason: string;
}

export interface ScopedCapabilityLike {
  permission: string;
  scope: { kind: string; resourceIds: readonly string[]; includeDescendants: boolean };
}

/**
 * Состояние организации для баннеров оболочки (`TenantContext.tenantState`, контракт 0.4.0-stage1): статус
 * PLAT-02 и признак записи в хранилище — каждому участнику, без billing.read.
 */
export interface TenantStateLike {
  status: string;
  storageWriteStatus: string;
}

/** Участок `TenantContext`, который читает навигация. */
export interface NavTenantLike {
  modules: readonly ModuleAvailabilityLike[];
  capabilities: readonly ScopedCapabilityLike[];
  /** Нет у стенда до W1.08: тогда только чтение выводится из причин модулей `plan_expired`. */
  tenantState?: TenantStateLike | undefined;
}

/** Состояние модуля для меню и гейта (D-23): включён, отключён с историей, не подключён. */
export type ModuleState = 'on' | 'ro' | 'off';

export interface NavContext {
  audience: Audience;
  area: Area;
  /** Доступность по `moduleKey`; пустая карта — `/me/context` её не прислал (стенд до W1.08). */
  modules: ReadonlyMap<string, ModuleAvailabilityLike>;
  capabilities: readonly ScopedCapabilityLike[];
  /**
   * Организация только для чтения (эталон :3088 restricted/suspended; PD-35): `tenantState.status` ∈ grace,
   * read_only, suspended; без `tenantState` — причины модулей `plan_expired`.
   */
  tenantReadOnly: boolean;
  /**
   * Место организации заполнено (`tenantState.storageWriteStatus = blocked`, эталон :3096); `null` — признака
   * нет (контур оператора или стенд без `tenantState`).
   */
  storageBlocked: boolean | null;
}

export interface NavItem {
  key: PageKey;
  segment: string;
  label: LabelKey;
  icon: string;
  badge?: number;
}

export interface NavGroup {
  key: GroupKey;
  title: LabelKey;
  items: NavItem[];
}

/** Бейджи пунктов меню (источники — модули своих этапов). */
export type NavBadges = Partial<Record<PageKey, number>>;

export type DenyReason = 'module_off' | 'module_readonly' | 'no_permission' | 'no_scope';

/** Чип отказа: «Модуль не подключён», «Модуль отключён», «Нет права». */
export type DenyChip = 'moduleOff' | 'moduleDisabled' | 'noPermission';

/** Заголовок отказа (`gate.a.*` / `gate.b.*` словаря). */
export type DenyTitle = 'moduleOff' | 'noPermission' | 'noRole' | 'noReview';

export type PageAccess =
  | { kind: 'allow'; readOnly: boolean }
  | {
      kind: 'deny';
      reason: DenyReason;
      branch: 'A' | 'B';
      chip: DenyChip;
      title: DenyTitle;
      /** Ключ модуля домена (имя в заголовке) или `null` — тогда имя = подпись пункта меню. */
      domainModule: string | null;
      /** Подпись страницы: имя раздела «Компании» в заголовке «Нет доступа к разделу «…»». */
      label: LabelKey | null;
      /** Владелец: текст «Подключите модуль…» и кнопка «Открыть «Модули и место»». */
      owner: boolean;
    }
  | { kind: 'not_found' };
