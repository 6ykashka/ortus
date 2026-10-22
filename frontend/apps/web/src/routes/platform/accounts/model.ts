// W4.61 · Модель «Пользователей платформы» оператора (accountsVM «Ортус CRM.dc.html» :3619–3679, platformOrgVM
// :3807–3851; design-2026-10-19) по каталогу аккаунтов и операторам W4.07: организации слева, фильтры со
// счётчиками, строки аккаунтов и popover участий, карточка аккаунта, шапка организации, диалоги блокировки и сброса
// второго фактора, системная организация «Ортус · Платформа» с операторами.
import type { components } from '@ortus/api-client';
import { initials } from '@ortus/domain';
import { errors, format } from '@ortus/texts';

import type { ConfirmSpec } from '../kit/confirm.tsx';
import { type Chip, markLetter, mskStamp, plural, tenantChip } from '../kit/format.ts';
import { KIT_TEXT } from '../kit/texts.ts';
import type { Pill } from '../kit/ui.tsx';
import { ACCOUNTS_TEXT as T } from './texts.ts';

type S = components['schemas'];
type User = S['PlatformUser'];
type Membership = S['PlatformUserMembership'];
type Operator = S['PlatformOperator'];
export type Filter = 'all' | 'multi_tenant' | 'no_mfa' | 'locked' | 'never_signed_in';

export interface RealmTenant {
  id: string;
  name: string;
  sub: string;
  letter: string;
  tileBg: string;
  n: string;
}

export interface AccountRowView {
  id: string;
  name: string;
  email: string;
  initials: string;
  chip: Chip;
  orgCount: string;
  inOrgChip: Chip | undefined;
  mfa: { on: boolean; icon: string; label: string };
  last: string;
}

export interface PopItem {
  tenantId: string;
  org: string;
  state: string;
  owner: boolean;
  current: boolean;
  chip: Chip;
}

export interface CardView {
  name: string;
  email: string;
  initials: string;
  chip: Chip;
  lockReason: string | undefined;
  last: string;
  mfa: string;
  memberships: { tenantId: string; org: string; owner: boolean; chip: Chip }[];
  multi: string | undefined;
  canLock: boolean;
  canUnlock: boolean;
  canResetMfa: boolean;
}

export interface OperatorRow {
  id: string;
  name: string;
  email: string;
  initials: string;
  me: boolean;
  role: Operator['role'];
  chip: Chip;
  mfa: string;
  mfaOn: boolean;
  line: string;
  note: string | undefined;
  disabled: boolean;
  roleDisabled: boolean;
  roleHint: string | undefined;
  canDisable: boolean;
  canEnable: boolean;
  canRevoke: boolean;
}

export interface PlatformView {
  count: string;
  ownersWarn: boolean;
  iAmOwner: boolean;
  roles: {
    id: Operator['role'];
    icon: string;
    name: string;
    text: string;
    n: string;
  }[];
  rows: OperatorRow[];
}

/** Акцент знака по умолчанию (оформление не задано — цвет Ортус). */
const DEFAULT_ACCENT = '#1F6B52';

/** Организации клиентов слева (accountsVM :3634): знак, «{статус} · мест u/l», участники. */
export function realmTenants(list: readonly S['Tenant'][]): RealmTenant[] {
  return list.map((t) => {
    const seats = t.seats;
    const seatsText = !seats
      ? KIT_TEXT.dash
      : seats.limit === null
        ? String(seats.used)
        : format(T.realm.seatsOf, { used: seats.used, limit: seats.limit });
    return {
      id: t.id,
      name: t.name,
      sub: format(T.realm.tenantSub, { status: tenantChip(t.status).label, seats: seatsText }),
      letter: markLetter(t.name, t.brand?.shortName),
      tileBg: t.brand?.accentUsed ?? DEFAULT_ACCENT,
      n: String(t.memberCount ?? 0),
    };
  });
}

const FILTERS: readonly [Filter, keyof S['PlatformUserCounts']][] = [
  ['all', 'all'],
  ['multi_tenant', 'multiTenant'],
  ['no_mfa', 'noMfa'],
  ['locked', 'locked'],
  ['never_signed_in', 'neverSignedIn'],
];

/** Фильтры «Все · N», «В нескольких организациях · N»… (accountsVM :3633). */
export const filterPills = (c: S['PlatformUserCounts']): Pill<Filter>[] =>
  FILTERS.map(([key, field]) => ({ key, label: format(T.filters[key], { n: c[field] }) }));

/** «Аккаунтов на платформе: N» / «Участников в организации: N» [« · показано M»] (accountsVM :3642). */
export function totalText(all: boolean, total: number, shown: number): string {
  const base = format(all ? T.totalAll : T.totalOrg, { n: total });
  return shown === total ? base : base + format(T.shown, { m: shown });
}

const ACCOUNT_CHIPS: Readonly<Record<User['status'], Chip>> = {
  active: { label: T.account.active, tone: 'ok', icon: 'check_circle' },
  invited: { label: T.account.invited, tone: 'neutral', icon: 'schedule' },
  suspended: { label: T.account.suspended, tone: 'danger', icon: 'lock' },
};

const MEMBER_CHIPS: Readonly<Record<Membership['status'], Chip>> = {
  active: { label: T.membership.active, tone: 'ok', icon: 'check' },
  invited: { label: T.membership.invited, tone: 'warn', icon: 'schedule' },
  suspended: { label: T.membership.suspended, tone: 'neutral', icon: 'pause' },
  ended: { label: T.membership.ended, tone: 'neutral', icon: 'logout' },
};

const live = (u: User): Membership[] => (u.memberships ?? []).filter((m) => m.status !== 'ended');

/** Чип участия в выбранной организации; владелец — «… · владелец» (accountsVM :3648). */
function inOrgChip(card: User, org: string): Chip {
  const m = (card.memberships ?? []).find((x) => x.tenantId === org);
  if (!m) return { label: KIT_TEXT.dash, tone: 'neutral', icon: 'remove' };
  const c = MEMBER_CHIPS[m.status];
  return m.owner ? { label: c.label + T.membership.owner, tone: c.tone, icon: 'shield_person' } : c;
}

/** Строка аккаунта (accountsVM :3643–3659); `card` — участия (getPlatformUser) для чипа в организации. */
export function accountRow(u: User, card: User | undefined, org: string | null): AccountRowView {
  const n = u.tenantCount;
  const [one, few, many] = T.orgWords;
  return {
    id: u.id,
    name: u.displayName,
    email: u.email,
    initials: initials(u.displayName),
    chip: ACCOUNT_CHIPS[u.status],
    orgCount: format(T.orgCount, { n, word: plural(n, one, few, many) }),
    inOrgChip: org && card ? inOrgChip(card, org) : undefined,
    mfa: u.mfaEnabled
      ? { on: true, icon: 'verified_user', label: T.mfaOn }
      : { on: false, icon: 'gpp_maybe', label: T.mfaOff },
    last: u.lastSeenAt ? format(T.lastSeen, { at: mskStamp(u.lastSeenAt) }) : T.neverSeen,
  };
}

/** Popover «Организации аккаунта» (accountsVM :3652–3655): все участия, и завершённые. */
export function popover(card: User, org: string | null): { title: string; items: PopItem[] } {
  return {
    title: format(T.pop.title, { n: live(card).length }),
    items: (card.memberships ?? []).map((m) => {
      const current = m.tenantId === org;
      return {
        tenantId: m.tenantId,
        org: m.tenantName,
        state: tenantChip(m.tenantStatus).label + (current ? T.pop.current : ''),
        owner: m.owner,
        current,
        chip: MEMBER_CHIPS[m.status],
      };
    }),
  };
}

/** «Карточка аккаунта» (accountsVM :3660–3677). */
export function accountCard(u: User): CardView {
  const n = live(u).length;
  const locked = u.status === 'suspended';
  return {
    name: u.displayName,
    email: u.email,
    initials: initials(u.displayName),
    chip: ACCOUNT_CHIPS[u.status],
    lockReason:
      locked && u.lockReason ? format(T.card.lockReason, { reason: u.lockReason }) : undefined,
    last: u.lastSeenAt ? mskStamp(u.lastSeenAt) : T.card.lastNever,
    mfa: u.mfaEnabled ? T.card.mfaOn : T.card.mfaOff,
    memberships: (u.memberships ?? []).map((m) => ({
      tenantId: m.tenantId,
      org: m.tenantName,
      owner: m.owner,
      chip: MEMBER_CHIPS[m.status],
    })),
    multi: n > 1 ? format(T.card.multi, { n }) : undefined,
    canLock: !locked,
    canUnlock: locked,
    canResetMfa: Boolean(u.mfaEnabled),
  };
}

/** Шапка выбранной организации: владелец, тариф, места (accountsVM :3640–3641). */
export function orgHead(
  t: S['Tenant'],
  usage: { ownerName?: string; tierName?: string },
): { name: string; chip: Chip; line: string } {
  const seats = t.seats;
  const seatsText = !seats
    ? KIT_TEXT.dash
    : seats.limit === null
      ? format(T.orgSeatsUnlimited, { used: seats.used })
      : format(T.orgSeatsOf, { used: seats.used, limit: seats.limit });
  return {
    name: t.name,
    chip: tenantChip(t.status),
    line: format(T.orgHead, {
      owner: usage.ownerName ?? KIT_TEXT.dash,
      tier: usage.tierName ? format(T.orgTier, { tier: usage.tierName }) : KIT_TEXT.dash,
      seats: seatsText,
    }),
  };
}

/** «Заблокировать вход …?» (accountsVM :3669–3673). */
export function lockSpec(u: User, reason: string): ConfirmSpec {
  const D = T.lockDialog;
  const n = u.tenantCount;
  return {
    title: format(D.title, { email: u.email }),
    text: format(D.text, { reason: reason.trim() }),
    items: [
      {
        icon: 'lock',
        tone: 'danger',
        text: D.noEntry + (n > 1 ? format(D.noEntryMany, { n }) : ''),
      },
      { icon: 'group', tone: 'neutral', text: D.keep },
      { icon: 'policy', tone: 'info', text: D.why },
    ],
    confirmLabel: D.confirm,
    tone: 'danger',
  };
}

/** «Разблокировать вход …?» (accountsVM :3675). */
export const unlockSpec = (email: string): ConfirmSpec => ({
  title: format(T.unlockDialog.title, { email }),
  text: '',
  items: [{ icon: 'lock_open', tone: 'ok', text: T.unlockDialog.back }],
  confirmLabel: T.unlockDialog.confirm,
  tone: 'info',
});

/** «Сбросить второй фактор?» (accountsVM :3676). */
export const mfaSpec = (email: string): ConfirmSpec => ({
  title: T.mfaDialog.title,
  text: email,
  items: [
    { icon: 'key', tone: 'warn', text: T.mfaDialog.again },
    { icon: 'history', tone: 'neutral', text: T.mfaDialog.journal },
  ],
  confirmLabel: T.mfaDialog.confirm,
  tone: 'info',
});

const ROLE_ICONS: readonly [Operator['role'], string][] = [
  ['owner', 'shield_person'],
  ['admin', 'admin_panel_settings'],
  ['billing', 'receipt_long'],
  ['support', 'support_agent'],
];

const OPERATOR_CHIPS: Readonly<Record<Operator['status'], Chip>> = {
  active: { label: T.platform.status.active, tone: 'ok', icon: 'check_circle' },
  invited: { label: T.platform.status.invited, tone: 'warn', icon: 'schedule' },
  disabled: { label: T.platform.status.disabled, tone: 'neutral', icon: 'block' },
};

const ddmm = (iso: string): string => mskStamp(iso).slice(0, 5);

/** Системная организация «Ортус · Платформа» (platformOrgVM :3807–3851). */
export function platformView(ops: readonly Operator[], activeOwners: number): PlatformView {
  const P = T.platform;
  const me = ops.find((o) => o.me);
  const iAmOwner = me?.role === 'owner' && me.status === 'active';
  const working = ops.filter((o) => o.status !== 'disabled');
  return {
    count: format(P.count, { n: working.length, owners: activeOwners }),
    ownersWarn: activeOwners < 2,
    iAmOwner,
    roles: ROLE_ICONS.map(([id, icon]) => ({
      id,
      icon,
      name: P.roles[id].name,
      text: P.roles[id].text,
      n: String(working.filter((o) => o.role === id).length),
    })),
    rows: ops.map((o) => {
      const disabled = o.status === 'disabled';
      const lastOwner = o.role === 'owner' && o.status === 'active' && activeOwners <= 1;
      const kind = o.mfa ? (P.mfaKinds[o.mfa] ?? o.mfa) : undefined;
      return {
        id: o.id,
        name: o.displayName,
        email: o.email,
        initials: initials(o.displayName),
        me: o.me,
        role: o.role,
        chip: OPERATOR_CHIPS[o.status],
        mfa: kind ? format(P.mfa, { kind }) : P.noMfa,
        mfaOn: Boolean(kind),
        line: format(P.last, {
          email: o.email,
          seen: o.lastSeenAt ? format(P.seen, { at: mskStamp(o.lastSeenAt) }) : P.neverSeen,
        }),
        note: disabled
          ? (o.disabledReason ??
            (o.disabledAt ? format(P.disabledAt, { at: ddmm(o.disabledAt) }) : undefined))
          : undefined,
        disabled,
        roleDisabled: o.me || !iAmOwner || disabled,
        roleHint: o.me ? P.meHint : lastOwner ? P.lastOwnerHint : undefined,
        canDisable: !o.me && iAmOwner && o.status === 'active',
        canEnable: iAmOwner && disabled,
        canRevoke: iAmOwner && o.status === 'invited',
      };
    }),
  };
}

/** «Назначить владельцем платформы?» (platformOrgVM :3834). */
export const ownerSpec = (o: Operator): ConfirmSpec => ({
  title: T.ownerDialog.title,
  text: format(T.ownerDialog.text, { name: o.displayName, email: o.email }),
  items: [
    { icon: 'shield_person', tone: 'warn', text: T.ownerDialog.full },
    { icon: 'history', tone: 'neutral', text: T.ownerDialog.journal },
  ],
  confirmLabel: T.ownerDialog.confirm,
  tone: 'info',
});

/** «Отключить оператора?» (platformOrgVM :3838–3842). */
export const disableSpec = (o: Operator): ConfirmSpec => ({
  title: T.disableDialog.title,
  text: format(T.disableDialog.text, { name: o.displayName, email: o.email }),
  items: [
    { icon: 'logout', tone: 'warn', text: T.disableDialog.sessions },
    { icon: 'key_off', tone: 'neutral', text: T.disableDialog.grants },
    { icon: 'history', tone: 'neutral', text: T.disableDialog.journal },
  ],
  confirmLabel: T.disableDialog.confirm,
  tone: 'danger',
});

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Проверка формы приглашения до отправки — как эталон (api.js :384): имя и почта обязательны. */
export function inviteError(f: { name: string; email: string }): string | undefined {
  return !f.name.trim() || !EMAIL.test(f.email.trim().toLowerCase())
    ? errors.mock.platform.operatorNameEmail
    : undefined;
}
