// Люди: статусы участника, занятые места, владельцы (models.js 14.10:145–149; api.js:55–57).
import { describe, expect, it } from 'vitest';
import type { CoreDb, Member } from '../../core/types/index.ts';
import { MEMBER_STATE } from './dictionaries.ts';
import { owners, seatsUsed } from './seats.ts';

const m = (id: string, status: Member['status']): Member => ({ id, name: id, status });

const db = (): CoreDb => ({
  tenantId: 't-x',
  seq: 1,
  units: [],
  modules: {},
  members: [
    m('m-owner', 'active'),
    m('m-a', 'active'),
    m('m-inv', 'invited'),
    m('m-blk', 'blocked'),
    m('m-co', 'active'),
  ],
  roles: [
    {
      id: 'r-owner',
      name: 'Владелец бизнеса',
      kind: 'system',
      all: true,
      actions: {},
      finance: { read: true, manage: true },
    },
    {
      id: 'r-x',
      name: 'X',
      kind: 'custom',
      actions: { tasks: ['view'] },
      finance: { read: false, manage: false },
    },
  ],
  assignments: [
    { id: 'a1', member: 'm-owner', role: 'r-owner', scope: { type: 'tenant' } },
    { id: 'a2', member: 'm-a', role: 'r-x', scope: { type: 'tenant' } },
    { id: 'a3', member: 'm-co', role: 'r-owner', scope: { type: 'tenant' } },
    { id: 'a4', member: 'm-ghost', role: 'r-nope', scope: { type: 'tenant' } },
  ],
});

describe('MEMBER_STATE', () => {
  it('три статуса участника', () => {
    expect(MEMBER_STATE).toEqual({
      active: { label: 'Активен', tone: 'ok', icon: 'check_circle' },
      invited: { label: 'Приглашён', tone: 'warn', icon: 'schedule' },
      blocked: { label: 'Заблокирован', tone: 'danger', icon: 'block' },
    });
  });
});

describe('seatsUsed: места занимают активные и приглашённые', () => {
  it('заблокированный место не занимает', () => {
    expect(seatsUsed(db())).toBe(4);
    expect(seatsUsed({ ...db(), members: [] })).toBe(0);
  });
});

describe('owners: участники с системной ролью владельца', () => {
  it('в порядке списка участников; назначение на несуществующую роль не считается', () => {
    expect(owners(db())).toEqual(['m-owner', 'm-co']);
  });
});
