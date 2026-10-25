// Сценарии и пресеты (W0.13, бриф §7 п. 4; PD-31): заголовок `X-Test-Scenario: [<operationId>=]<сценарий>[, …]`
// — код Problem (только если операция объявляет его статус), `empty`, `offline`, `loading`, `delay=<мс>`;
// постоянный сценарий и пресеты — `POST /api/v1/dev/scenario` (вне контракта, только mock).
import { seedUuid } from '@ortus/domain/seed';
import { beforeEach, describe, expect, it } from 'vitest';

import { example } from '../src/msw/contract/index.ts';
import { parseScenario } from '../src/msw/core/scenario.ts';
import { orgOf, seatsUsed } from '../src/msw/core/state.ts';
import { createScenarioServer, type ScenarioServer } from '../src/msw/server.ts';
import { Client, REQUEST_ID } from './conformance/client.ts';

const ALTA = seedUuid('platform', 't-alta');
const MEMBERS = `/api/v1/tenants/${ALTA}/members`;

let server: ScenarioServer;
let api: Client;

beforeEach(() => {
  server = createScenarioServer({
    operations: {
      listMembers: () => ({ body: { items: [{ id: 'x' }], nextCursor: 'next' } }),
      listMyNotifications: () => ({
        body: { items: [{ id: 'n' }], nextCursor: null, unreadCount: 1 },
      }),
      getMyNotificationSummary: () => ({ body: { totalUnread: 0, tenants: [] } }),
      createOrgUnit: () => ({ status: 201, body: { id: 'u' } }),
    },
  });
  api = new Client({ base: 'http://ortus.test', fetch: (r) => server.handle(r) });
});

describe('разбор X-Test-Scenario', () => {
  it('код, пусто, офлайн, загрузка, задержка — для всех операций или одной', () => {
    expect(parseScenario('forbidden_action')).toEqual([
      { directive: { kind: 'code', code: 'forbidden_action' } },
    ]);
    expect(parseScenario('listMembers=empty, getMyContext=offline')).toEqual([
      { op: 'listMembers', directive: { kind: 'empty' } },
      { op: 'getMyContext', directive: { kind: 'offline' } },
    ]);
    expect(parseScenario('delay=300; listMembers=delay=50, loading')).toEqual([
      { directive: { kind: 'delay', ms: 300 } },
      { op: 'listMembers', directive: { kind: 'delay', ms: 50 } },
      { directive: { kind: 'loading' } },
    ]);
  });

  it('неизвестный сценарий и неизвестная операция игнорируются', () => {
    expect(parseScenario('nonsense, noSuchOp=empty, delay=-5')).toEqual([]);
  });
});

describe('сценарии на запросах', () => {
  it('код ошибки отвечает примером операции с requestId запроса — раньше шлюза', async () => {
    const r = await api.anon().get(MEMBERS, { scenario: 'forbidden_action' });
    expect(r.status).toBe(403);
    expect(r.body).toEqual({
      ...(example('listMembers', 'forbidden_action') as object),
      requestId: REQUEST_ID,
    });
  });

  it('код вне объявленных статусов операции игнорируется', async () => {
    const s = await api.as('owner');
    const r = await s.get('/api/v1/me/notifications/summary', { scenario: 'forbidden_action' });
    expect(r.status).toBe(200);
  });

  it('код без примера — Problem по реестру', async () => {
    const s = await api.as('owner');
    const r = await s.get(MEMBERS, { scenario: 'listMembers=rate_limited' });
    expect(r.status).toBe(429);
    expect(r.body).toMatchObject({ code: 'rate_limited', retryable: true });
  });

  it('empty: список пуст, а у операции с примером empty — тело примера', async () => {
    const s = await api.as('owner');
    const members = await s.get(MEMBERS, { scenario: 'listMembers=empty' });
    expect(members.body).toEqual({ items: [], nextCursor: null });
    const inbox = await s.get(`/api/v1/me/notifications?tenantId=${ALTA}`, { scenario: 'empty' });
    expect(inbox.body).toEqual(example('listMyNotifications', 'empty'));
    const created = await s.post(
      `/api/v1/tenants/${ALTA}/org-units`,
      { parentId: null, name: 'Тест', kind: 'region' },
      { scenario: 'empty' },
    );
    expect(created.status).toBe(201);
  });

  it('сценарий только для своей операции', async () => {
    const s = await api.as('owner');
    const r = await s.get('/api/v1/me/notifications/summary', { scenario: 'listMembers=offline' });
    expect(r.status).toBe(200);
  });

  it('offline — сетевой сбой, delay — задержка, loading — ответа нет', async () => {
    const s = await api.as('owner');
    expect((await s.get(MEMBERS, { scenario: 'offline' })).status).toBe(0);
    const t0 = Date.now();
    expect((await s.get(MEMBERS, { scenario: 'delay=60' })).status).toBe(200);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
    const pending = s.get(MEMBERS, { scenario: 'loading' });
    const winner = await Promise.race([
      pending.then(() => 'answered'),
      new Promise((r) => setTimeout(() => r('pending'), 80)),
    ]);
    expect(winner).toBe('pending');
  });
});

describe('постоянный сценарий и dev-маршрут', () => {
  it('setScenario once — срабатывает один раз', async () => {
    const s = await api.as('owner');
    server.setScenario('listMembers=forbidden_action', true);
    expect((await s.get(MEMBERS)).status).toBe(403);
    expect((await s.get(MEMBERS)).status).toBe(200);
  });

  it('POST /api/v1/dev/scenario: сценарий, часы, сброс; заголовок сильнее постоянного', async () => {
    const s = await api.as('owner');
    const set = await s.post('/api/v1/dev/scenario', { scenario: 'listMembers=empty' });
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ scenario: 'listMembers=empty' });
    expect((await s.get(MEMBERS)).body).toEqual({ items: [], nextCursor: null });
    expect((await s.get(MEMBERS, { scenario: 'delay=1' })).body).toMatchObject({
      nextCursor: 'next',
    });
    await s.post('/api/v1/dev/scenario', { now: '2026-10-02T07:30:00Z', scenario: null });
    expect(server.state().clock).toBe('2026-10-02T07:30:00Z');
    orgOf(server.state(), ALTA).members.pop();
    const reset = await s.post('/api/v1/dev/scenario', { reset: true });
    expect(reset.body).toMatchObject({ clock: '2026-10-01T07:30:00Z', scenario: null });
    expect(orgOf(server.state(), ALTA).members).toHaveLength(10);
    expect((await s.get(MEMBERS)).status).toBe(200);
  });

  it('GET /api/v1/dev/scenario: токены приглашений сида для страниц входа по приглашению', async () => {
    const r = await api.anon().get('/api/v1/dev/scenario');
    const body = r.body as { presets: string[]; invitations: { email: string; token: string }[] };
    expect(body.presets).toEqual([
      'logistics-ready',
      'seats-full',
      'trial-ended',
      'storage-full',
      'repairs-ready',
    ]);
    expect(body.invitations.map((i) => i.email)).toEqual([
      'o.petrova@alta.example',
      's.ilyin@alta.example',
    ]);
  });

  it('неизвестный пресет — 422', async () => {
    const r = await api.anon().post('/api/v1/dev/scenario', { preset: 'moon' });
    expect(r.status).toBe(422);
  });
});

describe('пресеты', () => {
  it('logistics-ready: «Логистика» подключена, Котова — менеджер логистики в «Север Логистик»', () => {
    server.applyPreset('logistics-ready');
    const org = orgOf(server.state(), ALTA);
    expect(org.modules.fleet?.state).toBe('active');
    expect(org.modules.fleet?.settings).toMatchObject({ moduleKey: 'fleet' });
    const kotova = seedUuid('t-alta', 'm-kotova');
    expect(
      org.assignments.some(
        (a) => a.principalId === kotova && a.roleId === seedUuid('t-alta', 'r-manager'),
      ),
    ).toBe(true);
  });

  it('seats-full: занято 10 из 10 — приглашён Иван Тестов', () => {
    server.applyPreset('seats-full');
    const org = orgOf(server.state(), ALTA);
    expect(seatsUsed(org)).toBe(10);
    expect(org.members.at(-1)).toMatchObject({ email: 'i.testov@alta.example', status: 'invited' });
  });

  it('trial-ended: «Альта» только для чтения — изменения 403 tenant_read_only', async () => {
    server.applyPreset('trial-ended');
    const t = server.state().tenants.find((x) => x.id === ALTA);
    expect(t?.status).toBe('read_only');
    expect(t?.subscription.status).toBe('read_only');
    const s = await api.as('owner');
    expect((await s.get(MEMBERS)).status).toBe(200);
    const w = await s.post(`/api/v1/tenants/${ALTA}/org-units`, {
      parentId: null,
      name: 'Тест',
      kind: 'region',
    });
    expect((w.body as { code: string }).code).toBe('tenant_read_only');
  });

  it('storage-full: место «Альты» заполнено', () => {
    server.applyPreset('storage-full');
    const t = server.state().tenants.find((x) => x.id === ALTA);
    const quota = t?.subscription.entitlements.find((e) => e.key === 'storage_quota_bytes')?.value;
    expect(t?.storage.committedBytes).toBe(quota);
  });

  it('пресет через dev-маршрут', async () => {
    await api.anon().post('/api/v1/dev/scenario', { preset: 'seats-full' });
    expect(seatsUsed(orgOf(server.state(), ALTA))).toBe(10);
  });
});
