// W1.24 · Модель «Модули и место» (omVM :3100–3137, toggleModule :2644–2683, applyQuota :2684–2709):
// карточка статуса по TenantState, карточки отраслевых модулей по listModuleCatalog, плитки базовых модулей,
// число сотрудников с правами модуля, секции диалогов подключения, отключения и лимита.
import type { components } from '@ortus/api-client';
import { CORE, INDUSTRY, type IndustryKey, num } from '@ortus/domain';
import { TRIP_STATE } from '@ortus/domain/modules';
import { company, shell } from '@ortus/texts';
import type { Consequence, IconName, Tone } from '@ortus/ui';

import { gbNum, mskDate, usedBytes } from './storage.ts';
import { MOD_TEXT, t } from './texts.ts';

type S = components['schemas'];

/** Ключи подключаемых модулей контракта (`ModuleManifest.moduleKey`). */
export type ApiModuleKey = 'fleet' | 'spa' | 'repairs';

/** Подключаемый модуль контракта ↔ отраслевой модуль домена (models.js INDUSTRY), порядок эталона. */
export const INDUSTRY_KEYS: readonly (readonly [ApiModuleKey, IndustryKey])[] = [
  ['fleet', 'logistics'],
  ['spa', 'spa'],
  ['repairs', 'repair'],
];

export interface Chip {
  label: string;
  tone: Tone;
  icon: IconName;
}

export interface StatusCard {
  chip: Chip;
  title: string;
  text: string;
  restricted: boolean;
}

export interface IndustryCard {
  key: ApiModuleKey;
  name: string;
  icon: IconName;
  desc: string;
  deps: string[];
  chip: Chip;
  roleNote: string;
  /** Подключён (`active`): «Отключить»; иначе «Подключить». */
  on: boolean;
  /** «Подключить» недоступна: организация ограничена или идёт команда (:3117). */
  locked: boolean;
  /** «Назначить роли» (Q-W1.24-4). */
  showNext: boolean;
}

export interface CoreTile {
  key: string;
  name: string;
  icon: IconName;
  usedBy: string;
}

export interface DialogModel {
  title: string;
  text: string;
  icon: IconName;
  /** Тон круга и кнопки (ch('', tone) :3972; подтверждение красное только у danger :3975). */
  tone: Tone;
  consequences: Consequence[];
  ack?: string;
  confirmLabel: string;
}

const T = company.modules;
const D = company.dialogs;
const DAY_MS = 86_400_000;
const MSK_MS = 3 * 3_600_000;

const RESTRICTED: ReadonlySet<S['TenantState']['status']> = new Set([
  'grace',
  'read_only',
  'suspended',
]);

/** Организация ограничена (PD-35: grace и read_only — restricted эталона, suspended): новые операции закрыты. */
export const isRestricted = (state: S['TenantState'] | undefined): boolean =>
  state !== undefined && RESTRICTED.has(state.status);

const mskDay = (ms: number): number => Math.floor((ms + MSK_MS) / DAY_MS);

/** Карточка статуса (:3102–3107): `trialEndsAt` — полночь МСК после последнего дня пробного периода. */
export function statusCard(state: S['TenantState'] | undefined, now: Date): StatusCard | null {
  if (!state) return null;
  if (isRestricted(state)) {
    return {
      chip: { label: T.trial.chipRestricted, tone: 'warn', icon: 'lock_clock' },
      title: T.trial.restrictedTitle,
      text: T.trial.restrictedText,
      restricted: true,
    };
  }
  if (state.status === 'trial') {
    const last = state.trialEndsAt ? Date.parse(state.trialEndsAt) - 1 : now.getTime();
    const days = Math.max(0, mskDay(last) - mskDay(now.getTime()));
    return {
      chip: { label: T.trial.chipTrial, tone: 'info', icon: 'hourglass_top' },
      title: t(T.trial.title, { days, date: mskDate(last) }),
      text: T.trial.text,
      restricted: false,
    };
  }
  return {
    chip: { label: T.trial.chipActive, tone: 'ok', icon: 'check_circle' },
    title: T.trial.activeTitle,
    text: T.trial.activeText,
    restricted: false,
  };
}

/** Префикс ключей прав подключаемого модуля в каталоге (`api/permissions.yaml`). */
const PREFIX: Readonly<Record<ApiModuleKey, string>> = {
  fleet: 'fleet.',
  spa: 'spa.',
  repairs: 'repairs.',
};

/**
 * Сотрудники с правами модуля (holders :3109): назначения не встроенных ролей с правом модуля, участник —
 * прямо или через группу. Истёкшие назначения не считаются; «спящие» (модуль не подключён) — считаются:
 * эталон говорит о них «Они заработают после подключения». Заблокированные участники (`suspended`) не считаются:
 * эталон разворачивает назначение группы только на действующих (Громов в «Водители Север», mock-data.js :167, :185).
 */
export function moduleHolders(
  roles: readonly S['Role'][],
  assignments: readonly S['Assignment'][],
  groups: readonly S['Group'][],
  members: readonly S['Member'][] = [],
): Record<ApiModuleKey, number> {
  const suspended = new Set(members.filter((m) => m.status === 'suspended').map((m) => m.id));
  const out: Record<ApiModuleKey, number> = { fleet: 0, spa: 0, repairs: 0 };
  for (const [key] of INDUSTRY_KEYS) {
    const prefix = PREFIX[key];
    const withModule = new Set(
      roles
        .filter((r) => !r.builtIn && r.permissions.some((p) => p.startsWith(prefix)))
        .map((r) => r.id),
    );
    const holders = new Set<string>();
    for (const a of assignments) {
      if (a.state === 'expired' || !withModule.has(a.roleId)) continue;
      const ids =
        a.principalType === 'member'
          ? [a.principalId]
          : (groups.find((g) => g.id === a.principalId)?.memberIds ?? []);
      for (const m of ids) holders.add(m);
    }
    out[key] = [...holders].filter((m) => !suspended.has(m)).length;
  }
  return out;
}

const CHIP_ON: Chip = { label: T.industry.chipOn, tone: 'ok', icon: 'check_circle' };
const CHIP_RO: Chip = { label: T.industry.chipReadonly, tone: 'neutral', icon: 'history' };
const CHIP_OFF: Chip = {
  label: T.industry.chipOff,
  tone: 'neutral',
  icon: 'radio_button_unchecked',
};

/** Состояние модуля → чип (Q-W1.24-5). */
function chipOf(state: S['ModuleManifest']['state']): Chip {
  if (state === 'active') return CHIP_ON;
  if (state === 'read_only' || state === 'draining') return CHIP_RO;
  return CHIP_OFF;
}

const stateOf = (
  catalog: readonly S['ModuleManifest'][],
  key: string,
): S['ModuleManifest']['state'] => catalog.find((m) => m.moduleKey === key)?.state ?? 'uninstalled';

const coreName = (k: string): string => (CORE as Record<string, { name: string }>)[k]?.name ?? k;

export function industryCards(
  catalog: readonly S['ModuleManifest'][],
  holders: Readonly<Record<ApiModuleKey, number>>,
  o: { restricted: boolean; busy: boolean },
): IndustryCard[] {
  return INDUSTRY_KEYS.map(([key, domainKey]) => {
    const def = INDUSTRY[domainKey];
    const state = stateOf(catalog, key);
    const on = state === 'active';
    const n = holders[key];
    return {
      key,
      name: def.name,
      icon: def.icon,
      desc: def.desc,
      deps: def.deps.map(coreName),
      chip: chipOf(state),
      roleNote: t(on ? T.industry.roleNoteOn : T.industry.roleNoteOff, { n }),
      on,
      locked: o.restricted || o.busy,
      showNext: on && key === 'fleet',
    };
  });
}

export function coreTiles(catalog: readonly S['ModuleManifest'][]): CoreTile[] {
  const enabled = INDUSTRY_KEYS.filter(([key]) => stateOf(catalog, key) === 'active');
  return Object.entries(CORE).map(([key, c]) => {
    const users = enabled
      .filter(([, d]) => INDUSTRY[d].deps.includes(key))
      .map(([, d]) => INDUSTRY[d].name);
    return {
      key,
      name: c.name,
      icon: c.icon,
      usedBy: users.length ? t(T.core.usedBy, { modules: users.join(', ') }) : T.core.kernel,
    };
  });
}

const domainOf = (key: ApiModuleKey): IndustryKey =>
  INDUSTRY_KEYS.find(([k]) => k === key)?.[1] ?? 'logistics';

export function connectDialog(key: ApiModuleKey, tenant: string): DialogModel {
  const def = INDUSTRY[domainOf(key)];
  return {
    title: t(D.connect.title, { name: def.name }),
    text: t(D.connect.text, { tenant }),
    icon: def.icon,
    tone: 'ok',
    consequences: [
      {
        title: D.connect.appears,
        items: def.adds.map((text) => ({ icon: 'add_circle', tone: 'ok', text })),
      },
      {
        title: D.connect.deps,
        items: def.deps.map((k) => ({
          icon: 'check_circle',
          tone: 'ok',
          text: t(D.connect.depOn, { name: coreName(k) }),
        })),
      },
      {
        title: D.connect.important,
        items: [
          {
            icon: 'badge',
            tone: 'info',
            text: t(D.connect.roleTemplates, { roles: def.templates.join(', ') }),
          },
          { icon: 'hourglass_top', tone: 'neutral', text: D.connect.trialNote },
        ],
      },
    ],
    confirmLabel: T.industry.connect,
  };
}

/** Метка состояния объекта модуля: рейсы — TRIP_STATE домена; без метки — `null` (код API не показываем). */
function stateLabel(item: S['ModuleDeactivationItem']): string | null {
  if (item.object.moduleKey !== 'fleet') return null;
  return (TRIP_STATE as Record<string, { label: string } | undefined>)[item.state]?.label ?? null;
}

/** Строка «Затронет сейчас» (Q-W1.24-6). */
function affectItem(item: S['ModuleDeactivationItem']): Consequence['items'][number] {
  if (item.kind === 'form_intake') {
    return {
      icon: 'dynamic_form',
      tone: 'neutral',
      text: t(MOD_TEXT.affects.form, { title: item.title }),
    };
  }
  if (item.kind === 'automation') {
    return {
      icon: 'bolt',
      tone: 'neutral',
      text: t(MOD_TEXT.affects.automation, { title: item.title }),
    };
  }
  // «{title} · {state} · {who}» (Q-W1.24-6): части без значения пропускаются.
  const state = stateLabel(item);
  const who = item.assigneeName;
  let text = item.title;
  if (state && who) text = t(MOD_TEXT.affects.processWho, { title: item.title, state, who });
  else if (state) text = t(MOD_TEXT.affects.process, { title: item.title, state });
  else if (who) text = t(MOD_TEXT.affects.process, { title: item.title, state: who });
  return { icon: 'route', tone: 'warn', text };
}

export function disconnectDialog(
  key: ApiModuleKey,
  preview: S['ModuleDeactivationPreview'],
): DialogModel {
  const domainKey = domainOf(key);
  const affects = preview.activeItems.map(affectItem);
  if (preview.hiddenCount > 0) {
    affects.push({
      icon: 'more_horiz',
      tone: 'neutral',
      text: t(MOD_TEXT.hiddenItems, { n: preview.hiddenCount }),
    });
  }
  if (!affects.length) affects.push({ icon: 'check', tone: 'ok', text: D.disconnect.noProcesses });
  const closed =
    (D.disconnect.closed as Record<string, string>)[domainKey] ?? D.disconnect.closed.other;
  return {
    title: t(D.disconnect.title, { name: INDUSTRY[domainKey].name }),
    text: D.disconnect.text,
    icon: 'extension_off',
    tone: 'danger',
    consequences: [
      { title: D.disconnect.affects, items: affects },
      {
        title: shell.modal.whatHappens,
        items: [
          { icon: 'block', tone: 'danger', text: closed },
          ...(domainKey === 'logistics'
            ? [{ icon: 'task_alt', tone: 'ok' as const, text: D.disconnect.shiftsFinish }]
            : []),
          { icon: 'history', tone: 'neutral', text: D.disconnect.kept },
          { icon: 'menu_open', tone: 'neutral', text: D.disconnect.menu },
        ],
      },
    ],
    ack: D.disconnect.ack,
    confirmLabel: D.disconnect.confirm,
  };
}

export function quotaDialog(usage: S['StorageUsage'], gb: number): DialogModel {
  const used = gbNum(usedBytes(usage));
  if (gb >= used) {
    return {
      title: t(D.quota.title, { gb }),
      text: t(D.quota.text, { used: num(used) }),
      icon: 'storage',
      tone: 'ok',
      consequences: [],
      confirmLabel: D.quota.confirm,
    };
  }
  const lack = num(Math.round((used - gb) * 10) / 10);
  return {
    title: D.quotaBelow.title,
    text: t(D.quotaBelow.text, { used: num(used), gb, lack }),
    icon: 'storage',
    tone: 'danger',
    consequences: [
      {
        title: shell.modal.whatHappens,
        items: [
          { icon: 'block', tone: 'danger', text: D.quotaBelow.blocked },
          { icon: 'inventory_2', tone: 'ok', text: D.quotaBelow.filesKept },
          { icon: 'task_alt', tone: 'ok', text: D.quotaBelow.reserve },
        ],
      },
      {
        title: D.quotaBelow.todo,
        items: [
          { icon: 'folder_open', tone: 'info', text: t(D.quotaBelow.free, { lack }) },
          { icon: 'tune', tone: 'info', text: D.quotaBelow.minLimit },
        ],
      },
    ],
    ack: D.quotaBelow.ack,
    confirmLabel: D.quotaBelow.confirm,
  };
}
