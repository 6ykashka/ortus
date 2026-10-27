// W6.20 · Кандидаты в прорабы: профиль «прораб» или роль с правом отмечать работы без финансов и ведения объектов.
import type { components } from '@ortus/api-client';
import { describe, expect, it } from 'vitest';

import { foremanCandidates } from './api.ts';

type S = components['schemas'];

const member = (id: string, over: Partial<S['Member']> = {}): S['Member'] => ({
  id,
  displayName: id,
  status: 'active',
  orgUnitIds: [],
  revision: 1,
  workProfiles: [],
  ...over,
});
const role = (id: string, permissions: string[]): S['Role'] => ({
  id,
  name: id,
  description: '',
  builtIn: false,
  permissions,
  revision: 1,
});
const assign = (principalId: string, roleId: string, state: S['Assignment']['state'] = 'active') =>
  ({
    id: `${principalId}-${roleId}`,
    principalType: 'member',
    principalId,
    roleId,
    scope: { kind: 'tenant', resourceIds: [], includeDescendants: false },
    state,
  }) satisfies S['Assignment'];

describe('foremanCandidates', () => {
  const roles = [
    role('foreman', ['repairs.work_logs.submit', 'repairs.projects.read']),
    role('owner', ['repairs.work_logs.submit', 'repairs.finance.read', 'repairs.projects.manage']),
  ];
  const members = [
    member('a'),
    member('b'),
    member('c', { workProfiles: ['foreman'] }),
    member('d'),
  ];

  it('роль «Прораб» и профиль «прораб»; роль владельца и офиса — нет', () => {
    const out = foremanCandidates(members, roles, [assign('a', 'foreman'), assign('b', 'owner')]);
    expect(out.map((m) => m.id)).toEqual(['a', 'c']);
  });
  it('истёкшее назначение, группа и неактивный участник не считаются', () => {
    const out = foremanCandidates(
      [...members, member('e', { status: 'suspended', workProfiles: ['foreman'] })],
      roles,
      [assign('a', 'foreman', 'expired'), { ...assign('d', 'foreman'), principalType: 'group' }],
    );
    expect(out.map((m) => m.id)).toEqual(['c']);
  });
  it('без ролей и назначений (нет права читать) — только профиль', () => {
    expect(foremanCandidates(members).map((m) => m.id)).toEqual(['c']);
  });
});
