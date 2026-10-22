// W4.61 · Модель «Пользователей платформы» (accountsVM :3619–3679, platformOrgVM :3807–3851) на данных
// сценарного сервера сида W4.07: организации слева, фильтры, строки и popover, карточка аккаунта, шапка
// организации, диалоги блокировки, операторы платформы.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import {
  accountCard,
  accountRow,
  disableSpec,
  filterPills,
  inviteError,
  lockSpec,
  mfaSpec,
  orgHead,
  ownerSpec,
  platformView,
  popover,
  realmTenants,
  totalText,
  unlockSpec,
} from './model.ts';

type S = components['schemas'];

const ALTA = 'f04f636e-b66d-509e-ae10-9c27a18e3baa';
const LOTOS = 'e4f2195f-f5a3-5f61-98be-f6ed76ea565a';
const REM = '3f3853d6-1917-5dfd-8abb-d53f181d6df0';

const anna: S['PlatformUser'] = {
  id: '25362ee9-7aad-5fee-8536-d70a214a1618',
  displayName: 'Анна Морозова',
  email: 'a.morozova@alta.example',
  status: 'active',
  tenantCount: 2,
  mfaEnabled: false,
  lastSeenAt: '2026-09-30T16:05:00Z',
  memberships: [
    {
      tenantId: ALTA,
      tenantName: 'Альта Групп',
      tenantStatus: 'trial',
      status: 'active',
      owner: false,
    },
    {
      tenantId: LOTOS,
      tenantName: 'SPA «Лотос»',
      tenantStatus: 'active',
      status: 'active',
      owner: false,
    },
  ],
};

const shishkin: S['PlatformUser'] = {
  id: 'x',
  displayName: 'Денис Шишкин',
  email: 'd.shishkin@cargo.example',
  status: 'suspended',
  tenantCount: 1,
  mfaEnabled: true,
  lastSeenAt: '2026-09-18T20:51:00Z',
  lockedAt: '2026-09-18T21:10:00Z',
  lockReason: 'Подозрительные входы из разных стран, 18.09',
  memberships: [
    {
      tenantId: 'cargo',
      tenantName: 'Карго Сити',
      tenantStatus: 'suspended',
      status: 'active',
      owner: true,
    },
  ],
};

const tenant = (p: Partial<S['Tenant']>): S['Tenant'] => ({
  id: ALTA,
  name: 'Альта Групп',
  status: 'trial',
  ownerUserIds: [],
  createdAt: '2026-09-30T15:12:00Z',
  revision: 1,
  seats: { limit: 10, used: 9, active: 7, invited: 2, available: 1 },
  memberCount: 10,
  tierCode: 'start',
  brand: { accentUsed: '#1F6B52' },
  ...p,
});

describe('организации слева и фильтры (accountsVM :3633–3639)', () => {
  it('организации клиентов: знак, статус и места, участники', () => {
    expect(
      realmTenants([
        tenant({}),
        tenant({
          id: LOTOS,
          name: 'SPA «Лотос»',
          status: 'active',
          seats: { limit: 25, used: 23, active: 23, invited: 0, available: 2 },
          memberCount: 23,
          brand: { shortName: 'Лотос', accentUsed: '#7A3E79' },
        }),
        tenant({
          id: REM,
          name: 'Ремстрой Плюс',
          status: 'read_only',
          seats: { limit: null, used: 120, active: 120, invited: 0, available: null },
        }),
      ]),
    ).toEqual([
      {
        id: ALTA,
        name: 'Альта Групп',
        sub: 'Пробный период · мест 9/10',
        letter: 'А',
        tileBg: '#1F6B52',
        n: '10',
      },
      {
        id: LOTOS,
        name: 'SPA «Лотос»',
        sub: 'Действует · мест 23/25',
        letter: 'Л',
        tileBg: '#7A3E79',
        n: '23',
      },
      {
        id: REM,
        name: 'Ремстрой Плюс',
        sub: 'Ограничен · мест 120',
        letter: 'Р',
        tileBg: '#1F6B52',
        n: '10',
      },
    ]);
  });

  it('фильтры со счётчиками и итог «показано»', () => {
    expect(
      filterPills({ all: 58, multiTenant: 2, noMfa: 36, locked: 1, neverSignedIn: 2 }),
    ).toEqual([
      { key: 'all', label: 'Все · 58' },
      { key: 'multi_tenant', label: 'В нескольких организациях · 2' },
      { key: 'no_mfa', label: 'Без второго фактора · 36' },
      { key: 'locked', label: 'Заблокированы · 1' },
      { key: 'never_signed_in', label: 'Не входили · 2' },
    ]);
    expect(totalText(true, 58, 58)).toBe('Аккаунтов на платформе: 58');
    expect(totalText(true, 58, 1)).toBe('Аккаунтов на платформе: 58 · показано 1');
    expect(totalText(false, 5, 5)).toBe('Участников в организации: 5');
  });
});

describe('строки и popover (accountsVM :3643–3659)', () => {
  it('строка «Все аккаунты»: инициалы, статус, организации, второй фактор, вход', () => {
    expect(accountRow(anna, anna, null)).toEqual({
      id: anna.id,
      name: 'Анна Морозова',
      email: 'a.morozova@alta.example',
      initials: 'АМ',
      chip: { label: 'Активен', tone: 'ok', icon: 'check_circle' },
      orgCount: '2 организации',
      inOrgChip: undefined,
      mfa: { on: false, icon: 'gpp_maybe', label: 'без 2FA' },
      last: 'вход 30.09 19:05',
    });
    const r = accountRow({ ...shishkin, lastSeenAt: undefined as never }, undefined, null);
    expect(r.chip).toEqual({ label: 'Вход заблокирован', tone: 'danger', icon: 'lock' });
    expect(r.mfa).toEqual({ on: true, icon: 'verified_user', label: '2FA' });
    expect(r.orgCount).toBe('1 организация');
  });

  it('в организации: чип участия, владелец — «участник · владелец», нет участия — «—»', () => {
    expect(accountRow(shishkin, shishkin, 'cargo').inOrgChip).toEqual({
      label: 'участник · владелец',
      tone: 'ok',
      icon: 'shield_person',
    });
    const invited: S['PlatformUser'] = {
      ...anna,
      memberships: [
        { ...(anna.memberships?.[0] as S['PlatformUserMembership']), status: 'invited' },
      ],
    };
    expect(accountRow(invited, invited, ALTA).inOrgChip).toEqual({
      label: 'приглашён',
      tone: 'warn',
      icon: 'schedule',
    });
    expect(accountRow(anna, anna, REM).inOrgChip).toEqual({
      label: '—',
      tone: 'neutral',
      icon: 'remove',
    });
    expect(accountRow(anna, undefined, ALTA).inOrgChip).toBeUndefined();
  });

  it('popover: действующие участия, текущая организация, владелец', () => {
    const ended: S['PlatformUser'] = {
      ...anna,
      memberships: [
        ...(anna.memberships ?? []),
        {
          tenantId: REM,
          tenantName: 'Ремстрой Плюс',
          tenantStatus: 'read_only',
          status: 'ended',
          owner: true,
        },
      ],
    };
    expect(popover(ended, LOTOS)).toEqual({
      title: 'Организации аккаунта · 2 действующ.',
      items: [
        {
          tenantId: ALTA,
          org: 'Альта Групп',
          state: 'Пробный период',
          owner: false,
          current: false,
          chip: { label: 'участник', tone: 'ok', icon: 'check' },
        },
        {
          tenantId: LOTOS,
          org: 'SPA «Лотос»',
          state: 'Действует · открыта сейчас',
          owner: false,
          current: true,
          chip: { label: 'участник', tone: 'ok', icon: 'check' },
        },
        {
          tenantId: REM,
          org: 'Ремстрой Плюс',
          state: 'Ограничен',
          owner: true,
          current: false,
          chip: { label: 'участие завершено', tone: 'neutral', icon: 'logout' },
        },
      ],
    });
  });
});

describe('карточка аккаунта (accountsVM :3660–3677)', () => {
  it('Анна Морозова: вход, второй фактор, участия и текст о двух организациях', () => {
    expect(accountCard(anna)).toEqual({
      name: 'Анна Морозова',
      email: 'a.morozova@alta.example',
      initials: 'АМ',
      chip: { label: 'Активен', tone: 'ok', icon: 'check_circle' },
      lockReason: undefined,
      last: '30.09 19:05',
      mfa: 'Не настроен',
      memberships: [
        {
          tenantId: ALTA,
          org: 'Альта Групп',
          owner: false,
          chip: { label: 'участник', tone: 'ok', icon: 'check' },
        },
        {
          tenantId: LOTOS,
          org: 'SPA «Лотос»',
          owner: false,
          chip: { label: 'участник', tone: 'ok', icon: 'check' },
        },
      ],
      multi:
        'Один аккаунт в 2 организациях: данные организаций не пересекаются, у каждой свои роли и места.',
      canLock: true,
      canUnlock: false,
      canResetMfa: false,
    });
  });

  it('заблокированный: причина, разблокировка, сброс второго фактора', () => {
    const c = accountCard(shishkin);
    expect(c.lockReason).toBe('Причина блокировки: Подозрительные входы из разных стран, 18.09');
    expect([c.canLock, c.canUnlock, c.canResetMfa, c.mfa, c.multi]).toEqual([
      false,
      true,
      true,
      'Включён',
      undefined,
    ]);
    expect(accountCard({ ...anna, lastSeenAt: undefined as never }).last).toBe('ещё не входил');
  });
});

describe('шапка организации (accountsVM :3640–3641)', () => {
  it('владелец, тариф и места; без лимита — «N, без ограничения»', () => {
    expect(orgHead(tenant({}), { ownerName: 'Дарья Зимина', tierName: 'Старт' })).toEqual({
      name: 'Альта Групп',
      chip: { label: 'Пробный период', tone: 'info', icon: 'hourglass_top' },
      line: 'Владелец: Дарья Зимина · тариф «Старт» · мест 9 из 10',
    });
    expect(
      orgHead(
        tenant({ seats: { limit: null, used: 12, active: 12, invited: 0, available: null } }),
        {},
      ).line,
    ).toBe('Владелец: — · тариф — · мест 12, без ограничения');
  });
});

describe('диалоги аккаунта (accountsVM :3669–3676)', () => {
  it('блокировка, разблокировка, сброс второго фактора', () => {
    expect(lockSpec(anna, ' Подозрительные входы ')).toEqual({
      title: 'Заблокировать вход a.morozova@alta.example?',
      text: 'Причина: Подозрительные входы',
      items: [
        {
          icon: 'lock',
          tone: 'danger',
          text: 'Аккаунт не сможет войти ни в одну организацию (их 2)',
        },
        {
          icon: 'group',
          tone: 'neutral',
          text: 'Участие, роли и места в организациях не меняются: ими управляют владельцы',
        },
        {
          icon: 'policy',
          tone: 'info',
          text: 'Используется для защиты аккаунта, а не для неоплаты',
        },
      ],
      confirmLabel: 'Заблокировать',
      tone: 'danger',
    });
    expect(lockSpec(shishkin, 'abcde').items[0]?.text).toBe(
      'Аккаунт не сможет войти ни в одну организацию',
    );
    expect(unlockSpec('d.shishkin@cargo.example')).toEqual({
      title: 'Разблокировать вход d.shishkin@cargo.example?',
      text: '',
      items: [
        { icon: 'lock_open', tone: 'ok', text: 'Аккаунт снова сможет входить в свои организации' },
      ],
      confirmLabel: 'Разблокировать',
      tone: 'info',
    });
    expect(mfaSpec('d.zimina@alta.example')).toEqual({
      title: 'Сбросить второй фактор?',
      text: 'd.zimina@alta.example',
      items: [
        {
          icon: 'key',
          tone: 'warn',
          text: 'При следующем входе человек настроит второй фактор заново',
        },
        { icon: 'history', tone: 'neutral', text: 'Действие записывается в журнал' },
      ],
      confirmLabel: 'Сбросить',
      tone: 'info',
    });
  });
});

const op = (p: Partial<S['PlatformOperator']>): S['PlatformOperator'] => ({
  id: 'op',
  accountId: 'acc',
  displayName: 'Михаил Сорокин',
  email: 'm.sorokin@ortus.example',
  role: 'owner',
  status: 'active',
  me: false,
  revision: 1,
  mfa: 'totp',
  lastSeenAt: '2026-10-01T15:22:00Z',
  ...p,
});

describe('«Ортус · Платформа» (platformOrgVM :3807–3851)', () => {
  const ops = [
    op({
      id: '1',
      displayName: 'Евгения Лаптева',
      email: 'e.lapteva@ortus.example',
      me: true,
      mfa: 'webauthn',
      lastSeenAt: '2026-10-02T06:05:00Z',
    }),
    op({ id: '2' }),
    op({ id: '3', displayName: 'Алёна Гусева', role: 'billing' }),
    op({
      id: '5',
      displayName: 'Дина Валиева',
      role: 'support',
      status: 'invited',
      mfa: undefined as never,
      lastSeenAt: undefined as never,
    }),
    op({
      id: '6',
      displayName: 'Станислав Рябов',
      role: 'admin',
      status: 'disabled',
      disabledAt: '2026-08-14T21:00:00Z',
      disabledReason: 'Отключён 15.08: перевод в другой отдел',
    }),
  ];

  it('счётчик, роли, строки операторов и доступность действий владельцу', () => {
    const v = platformView(ops, 2);
    expect(v.count).toBe('Операторов: 4 · активных владельцев: 2');
    expect(v.ownersWarn).toBe(false);
    expect(v.iAmOwner).toBe(true);
    expect(v.roles.map((r) => [r.name, r.n])).toEqual([
      ['Владелец платформы', '2'],
      ['Администратор', '0'],
      ['Биллинг', '1'],
      ['Поддержка', '1'],
    ]);
    const [me, sorokin, , dina, st] = v.rows;
    expect(me).toMatchObject({
      initials: 'ЕЛ',
      me: true,
      mfa: '2FA: аппаратный ключ',
      mfaOn: true,
      line: 'e.lapteva@ortus.example · вход 02.10 09:05',
      roleDisabled: true,
      roleHint: 'Свою роль менять нельзя',
      canDisable: false,
    });
    expect(sorokin).toMatchObject({ canDisable: true, roleDisabled: false, roleHint: undefined });
    expect(dina).toMatchObject({
      chip: { label: 'Приглашён', tone: 'warn', icon: 'schedule' },
      mfa: '2FA не настроен',
      mfaOn: false,
      line: 'm.sorokin@ortus.example · ещё не входил',
      canRevoke: true,
      canDisable: false,
    });
    expect(st).toMatchObject({
      chip: { label: 'Отключён', tone: 'neutral', icon: 'block' },
      note: 'Отключён 15.08: перевод в другой отдел',
      disabled: true,
      canEnable: true,
      roleDisabled: true,
    });
  });

  it('один активный владелец: предупреждение и подсказка «Единственный активный владелец»', () => {
    const v = platformView(
      ops.map((o) => (o.id === '2' ? { ...o, status: 'disabled' as const } : o)),
      1,
    );
    expect(v.ownersWarn).toBe(true);
    expect(v.rows[0]?.roleHint).toBe('Свою роль менять нельзя');
    const solo = platformView([op({ id: '9' }), op({ id: '1', me: true, role: 'admin' })], 1);
    expect(solo.rows[0]?.roleHint).toBe('Единственный активный владелец');
    expect(solo.iAmOwner).toBe(false);
    expect(solo.rows[0]).toMatchObject({ roleDisabled: true, canDisable: false });
  });

  it('отключённый без причины — «Отключён ДД.ММ»', () => {
    const v = platformView([op({ status: 'disabled', disabledAt: '2026-10-01T07:40:00Z' })], 0);
    expect(v.rows[0]?.note).toBe('Отключён 01.10');
  });

  it('диалоги владельца и отключения', () => {
    expect(ownerSpec(op({}))).toEqual({
      title: 'Назначить владельцем платформы?',
      text: 'Михаил Сорокин · m.sorokin@ortus.example',
      items: [
        {
          icon: 'shield_person',
          tone: 'warn',
          text: 'Получит полный доступ, включая управление операторами и тарифной сеткой',
        },
        { icon: 'history', tone: 'neutral', text: 'Изменение попадёт в журнал платформы' },
      ],
      confirmLabel: 'Назначить',
      tone: 'info',
    });
    expect(disableSpec(op({}))).toMatchObject({
      title: 'Отключить оператора?',
      text: 'Михаил Сорокин · m.sorokin@ortus.example',
      confirmLabel: 'Отключить',
      tone: 'danger',
    });
    expect(disableSpec(op({})).items.map((i) => i.icon)).toEqual(['logout', 'key_off', 'history']);
  });

  it('приглашение: имя и почта обязательны (api.js :384)', () => {
    expect(inviteError({ name: '', email: 'p@ortus.example' })).toBe('Укажите имя и рабочую почту');
    expect(inviteError({ name: 'Пётр', email: 'не почта' })).toBe('Укажите имя и рабочую почту');
    expect(inviteError({ name: 'Пётр', email: 'p.novy@ortus.example' })).toBeUndefined();
  });
});
