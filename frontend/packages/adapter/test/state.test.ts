// Состояние сценарного сервера (W0.13, бриф §7 п. 2): проекция сида домена W0.12 (`createSeed`) в форму
// контракта с UUID v5 PD-30; атрибуты, которых нет в домене, — из примеров контракта (PD-43).
import { seedUuid } from '@ortus/domain/seed';
import { describe, expect, it } from 'vitest';

import { example } from '../src/msw/contract/index.ts';
import { memberDto } from '../src/msw/core/dto.ts';
import { createScenarioState, orgOf, seatsUsed, SEED_NOW } from '../src/msw/core/state.ts';

const P = (id: string) => seedUuid('platform', id);
const A = (id: string) => seedUuid('t-alta', id);

/** Членства Go-сида W0.06 (`backend/cmd/seed/platform.go`): организации с БД на стенде. */
const GO_MEMBERSHIPS: [string, string, string, boolean][] = [
  ['t-alta', 'acc-1', 'active', true],
  ['t-alta', 'acc-2', 'active', false],
  ['t-alta', 'acc-3', 'active', false],
  ['t-alta', 'acc-4', 'active', false],
  ['t-lotos', 'acc-4', 'active', false],
  ['t-alta', 'acc-5', 'active', false],
  ['t-alta', 'acc-6', 'invited', false],
  ['t-alta', 'acc-7', 'suspended', false],
  ['t-alta', 'acc-8', 'active', false],
  ['t-alta', 'acc-9', 'active', false],
  ['t-alta', 'acc-10', 'invited', false],
  ['t-lotos', 'acc-11', 'active', true],
];

describe('проекция сида W0.12', () => {
  const s = createScenarioState();
  const alta = orgOf(s, P('t-alta'));
  const lotos = orgOf(s, P('t-lotos'));

  it('4 организации платформы, данные — у «Альты» и «Лотоса»', () => {
    expect(s.tenants.map((t) => [t.name, t.status])).toEqual([
      ['Альта Групп', 'trial'],
      ['SPA «Лотос»', 'active'],
      ['Ремстрой Плюс', 'read_only'],
      ['Карго Сити', 'suspended'],
    ]);
    expect(s.tenants.map((t) => t.id)).toEqual(
      ['t-alta', 't-lotos', 't-remstroy', 't-cargo'].map(P),
    );
    expect(Object.keys(s.orgs).sort()).toEqual([P('t-alta'), P('t-lotos')].sort());
    expect(s.clock).toBe(SEED_NOW);
  });

  it('12 членств Go-сида с теми же UUID «membership:<организация>:<аккаунт>» и владельцами', () => {
    for (const [t, acc, status, owner] of GO_MEMBERSHIPS) {
      const m = s.memberships.find((x) => x.id === P(`membership:${t}:${acc}`));
      expect(m, `${t}:${acc}`).toMatchObject({ tenantId: P(t), accountId: P(acc), status, owner });
    }
  });

  it('участники: «Альта» 10, «Лотос» 23; занято мест 9 и 23', () => {
    expect(alta.members).toHaveLength(10);
    expect(lotos.members).toHaveLength(23);
    expect(seatsUsed(alta)).toBe(9);
    expect(seatsUsed(lotos)).toBe(23);
    const gromov = alta.members.find((m) => m.id === A('m-gromov'));
    expect(gromov).toMatchObject({ status: 'suspended', workProfiles: ['driver'] });
  });

  it('участник «Альты» совпадает с примером getMember/ok (Марина Котова)', () => {
    const kotova = alta.members.find((m) => m.id === A('m-kotova'));
    expect(kotova && memberDto(kotova)).toEqual(example('getMember', 'ok'));
  });

  it('назначения группы «Водители Север» восстановлены из via: ap2 и a2 — на группу', () => {
    expect(alta.assignments.map((a) => a.proto)).toEqual([
      'a1',
      'ap1',
      'ap2',
      'ap3',
      'a2',
      'a3',
      'a4',
    ]);
    const viaGroup = alta.assignments.filter((a) => a.principalType === 'group');
    expect(viaGroup.map((a) => [a.proto, a.principalId])).toEqual([
      ['ap2', A('g-drv')],
      ['a2', A('g-drv')],
    ]);
  });

  it('модули «Альты»: fleet не подключён, spa подключён, repairs не подключён', () => {
    expect(alta.modules.fleet?.state).toBe('uninstalled');
    expect(alta.modules.spa?.state).toBe('active');
    expect(alta.modules.repairs?.state).toBe('uninstalled');
  });

  it('права ролей — канон каталога (примеры listRoles), у «Владельца» — признак all', () => {
    const page = example('listRoles', 'ok') as { items: { id: string; permissions: string[] }[] };
    const manager = page.items.find((r) => r.id === A('r-manager'));
    expect(alta.roles.find((r) => r.id === A('r-manager'))?.permissions).toEqual(
      manager?.permissions,
    );
    expect(alta.roles.find((r) => r.id === A('r-owner'))?.all).toBe(true);
    expect(alta.roles.find((r) => r.id === A('r-driver'))?.workFunction).toBe('driver');
    const admin = lotos.roles.find((r) => r.proto === 'r-admin');
    expect(admin?.permissions).toContain('spa.appointments.read');
    expect(admin?.permissions.every((k) => /^[a-z_]+(\.[a-z_]+)+$/.test(k))).toBe(true);
  });

  it('подписка и место «Альты» — как примеры getTenantSubscription/ok и getStorageUsage/ok', () => {
    const t = s.tenants.find((x) => x.proto === 't-alta');
    expect(t?.subscription).toEqual(example('getTenantSubscription', 'ok'));
    const usage = example('getStorageUsage', 'ok') as {
      committedBytes: number;
      quotaBytes: number;
    };
    expect(t?.storage.committedBytes).toBe(usage.committedBytes);
  });

  it('приглашения сида: Олеся Петрова и Сергей Ильин, срок — неделя от «сейчас» сида', () => {
    const inv = alta.invitations.map((i) => [i.email, i.status, i.expiresAt]);
    expect(inv).toEqual([
      ['o.petrova@alta.example', 'pending', '2026-10-08T07:30:00Z'],
      ['s.ilyin@alta.example', 'pending', '2026-10-08T07:30:00Z'],
    ]);
    expect(alta.invitations.every((i) => i.token.length >= 32)).toBe(true);
  });

  it('входящие владельца «Альты» — из примера listMyNotifications/ok', () => {
    const page = example('listMyNotifications', 'ok') as { items: { id: string }[] };
    const mine = alta.notifications.filter((n) => n.accountId === P('acc-1'));
    expect(mine.map((n) => n.id)).toEqual(page.items.map((x) => x.id));
  });

  it('состояние сериализуемо в JSON и каждый вызов даёт новые объекты', () => {
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    const other = createScenarioState();
    orgOf(other, P('t-alta')).members.pop();
    expect(alta.members).toHaveLength(10);
  });
});
