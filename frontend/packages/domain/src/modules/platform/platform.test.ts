// Платформа: справочник статусов организации, оформление по умолчанию, проекция control DB
// (models.js 14.10:151–156; mock-data.js:10; api.js:186–192).
import { describe, expect, it } from 'vitest';
import { BRAND_DEFAULT, TENANT_STATE } from './dictionaries.ts';
import type { Platform, Tenant } from './types.ts';
import { platformView } from './view.ts';

const tenant = (id: string, status: Tenant['status']): Tenant => ({
  id,
  name: id,
  owner: '',
  status,
  trialEnds: null,
  trialDaysLeft: null,
  quotaGb: 10,
  usedGb: 1,
  members: 1,
  modules: [],
  plan: { tier: 'start', term: 1, paidUntil: null, version: 1 },
  seatsLimit: 10,
  seatsUsed: 1,
});

const platform = (): Platform => ({
  tenants: [tenant('t-alta', 'trial'), tenant('t-lotos', 'active')],
  priceBook: { current: 1, versions: [] },
  requests: [
    {
      id: 'SR-12',
      tenantId: 't-lotos',
      from: 'team',
      to: 'biz',
      term: 12,
      used: 23,
      by: '',
      at: '',
      status: 'pending',
      comment: '',
    },
  ],
  accounts: [
    {
      id: 'acc-1',
      name: '',
      email: '',
      status: 'active',
      mfa: true,
      lastLogin: null,
      memberships: [],
    },
  ],
  operators: [],
  audit: [{ at: '', text: '', by: '' }],
});

describe('справочники платформы', () => {
  it('TENANT_STATE — четыре статуса организации', () => {
    expect(Object.keys(TENANT_STATE)).toEqual(['trial', 'active', 'restricted', 'suspended']);
    expect(TENANT_STATE.restricted).toEqual({
      label: 'Ограничен',
      tone: 'warn',
      icon: 'lock_clock',
    });
    expect(TENANT_STATE.suspended.label).toBe('Приостановлен');
  });

  it('BRAND_DEFAULT — оформление по умолчанию', () => {
    expect(BRAND_DEFAULT).toEqual({
      short: '',
      accent: '#1F6B52',
      logo: null,
      mark: null,
      terms: {},
      items: {},
      order: [],
      poweredBy: true,
      version: 1,
      updatedAt: null,
      updatedBy: null,
    });
  });
});

describe('platformView: что видит участник и оператор', () => {
  it('оператор (actor = null) получает control DB целиком, копией', () => {
    const p = platform();
    const v = platformView(p, 't-alta', null);
    expect(v).toEqual(p);
    expect(v).not.toBe(p);
    expect(v.tenants[0]).not.toBe(p.tenants[0]);
  });

  it('участник видит только свою организацию и свои заявки, без аккаунтов, операторов, журнала', () => {
    const p = platform();
    const v = platformView(p, 't-lotos', 'm-owner');
    expect(v.tenants.map((t) => t.id)).toEqual(['t-lotos']);
    expect(v.requests.map((r) => r.id)).toEqual(['SR-12']);
    expect(Object.keys(v).sort()).toEqual(['priceBook', 'requests', 'tenants']);
    expect(platformView(p, 't-alta', 'm-owner').requests).toEqual([]);
    expect(p.accounts).toHaveLength(1);
  });
});
