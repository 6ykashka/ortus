// Шлюз сценарного сервера (W0.13, бриф §7 п. 3): тот же порядок, что у cmd/api W0.09 — сессия (401) →
// Origin и CSRF изменяющих (403) → оператор платформы (404) | членство и состояние организации (404/403) →
// подключение модуля → x-permissions (403) → тело → Idempotency-Key → If-Match (428/412) → хендлер.
// Хендлеры здесь — заглушки: проверяется только шлюз.
import { seedUuid } from '@ortus/domain/seed';
import { beforeEach, describe, expect, it } from 'vitest';

import { createScenarioServer, type ScenarioServer } from '../src/msw/server.ts';
import { Client, REQUEST_ID } from './conformance/client.ts';

const P = (id: string) => seedUuid('platform', id);
const ALTA = P('t-alta');
const LOTOS = P('t-lotos');
const T = (tenant: string) => `/api/v1/tenants/${tenant}`;

let server: ScenarioServer;
let api: Client;

beforeEach(() => {
  server = createScenarioServer({
    operations: {
      getMyContext: () => ({ body: { stub: true } }),
      listMembers: () => ({ body: { items: [], nextCursor: null } }),
      selectTenant: () => ({ body: {} }),
      listPlatformTenants: () => ({ body: { items: [], nextCursor: null } }),
      createOrgUnit: (ctx) => ({ status: 201, body: { echo: ctx.body, seq: ++ctx.s.seq } }),
      updateRole: (ctx) => {
        ctx.revision(3);
        return { body: { ok: true } };
      },
    },
  });
  api = new Client({ base: 'http://ortus.test', fetch: (r) => server.handle(r) });
});

describe('сессия', () => {
  it('без сессии — 401 session_expired, текст примера, заголовки ответа', async () => {
    const r = await api.anon().get('/api/v1/me/context');
    expect(r.status).toBe(401);
    expect(r.body).toEqual({
      type: 'https://docs.ortus.example/errors/session_expired',
      title: 'Нет или истекла сессия',
      status: 401,
      code: 'session_expired',
      detail: 'Сессия истекла. Войдите снова.',
      requestId: REQUEST_ID,
    });
    expect(r.headers.get('Content-Type')).toBe('application/problem+json');
    expect(r.headers.get('Cache-Control')).toBe('private, no-store');
    expect(r.headers.get('X-Request-Id')).toBe(REQUEST_ID);
  });

  it('недопустимый X-Request-Id заменяется новым', async () => {
    const r = await api.anon().get('/api/v1/me/context', { headers: { 'X-Request-Id': 'a b' } });
    expect(r.headers.get('X-Request-Id')).toBe(REQUEST_ID);
    const raw = await server.handle(
      new Request('http://ortus.test/api/v1/me/context', { headers: { 'X-Request-Id': 'a b' } }),
    );
    expect(raw.headers.get('X-Request-Id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('dev-вход персонажа: userId аккаунта сида, cookie ortus_sid (HttpOnly) и ortus_csrf', async () => {
    const s = api.anon();
    const r = await s.post('/api/v1/dev/login', { persona: 'owner' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ userId: P('acc-1'), csrfToken: s.csrf });
    const raw = r.headers.getSetCookie();
    expect(raw.find((c) => c.startsWith('ortus_sid='))).toMatch(/HttpOnly/);
    expect(raw.find((c) => c.startsWith('ortus_csrf='))).not.toMatch(/HttpOnly/);
    expect((await s.get('/api/v1/me/context')).status).toBe(200);
  });

  it('оператор входит аккаунтом account:op-1; неизвестный и заблокированный — один отказ 401', async () => {
    const op = api.anon();
    expect((await op.post('/api/v1/dev/login', { persona: 'operator' })).body).toMatchObject({
      userId: P('account:op-1'),
    });
    for (const persona of ['nobody', 'acc-13', 'op-6']) {
      const r = await api.anon().post('/api/v1/dev/login', { persona });
      expect(r.status, persona).toBe(401);
      expect((r.body as { code: string }).code).toBe('session_expired');
    }
  });

  it('выход dev-провайдера требует CSRF и гасит сессию', async () => {
    const s = await api.as('owner');
    expect((await s.post('/api/v1/dev/logout', undefined, { csrf: false })).status).toBe(403);
    expect((await s.post('/api/v1/dev/logout')).status).toBe(204);
    expect((await s.get('/api/v1/me/context')).status).toBe(401);
  });

  it('Bearer вместе с cookie — 400 malformed_request, Bearer без cookie — 401', async () => {
    const s = await api.as('owner');
    const both = await s.get('/api/v1/me/context', { headers: { Authorization: 'Bearer x' } });
    expect(both.status).toBe(400);
    const bearer = await api.anon().get('/api/v1/me/context', {
      headers: { Authorization: 'Bearer x' },
    });
    expect(bearer.status).toBe(401);
  });
});

describe('CSRF и Origin изменяющих запросов', () => {
  it('без X-CSRF-Token — 403 csrf_failed, чужой Origin — 403 origin_not_allowed', async () => {
    const s = await api.as('owner');
    const body = { tenantId: ALTA };
    const noCsrf = await s.put('/api/v1/me/selected-tenant', body, { csrf: false });
    expect(noCsrf.status).toBe(403);
    expect((noCsrf.body as { code: string }).code).toBe('csrf_failed');
    const foreign = await s.put('/api/v1/me/selected-tenant', body, {
      origin: 'http://evil.test',
    });
    expect((foreign.body as { code: string }).code).toBe('origin_not_allowed');
    expect((await s.put('/api/v1/me/selected-tenant', body, { origin: false })).status).toBe(200);
  });
});

describe('платформа и организация', () => {
  it('не оператору /platform/* — 404, оператору — хендлер', async () => {
    const owner = await api.as('owner');
    expect((await owner.get('/api/v1/platform/tenants')).status).toBe(404);
    const op = await api.as('operator');
    expect((await op.get('/api/v1/platform/tenants')).status).toBe(200);
  });

  it('чужая организация, не UUID, организация без БД — один 404', async () => {
    const owner = await api.as('owner');
    for (const t of [LOTOS, 'not-a-uuid', P('t-remstroy')]) {
      const r = await owner.get(`${T(t)}/members`);
      expect(r.status, t).toBe(404);
      expect((r.body as { code: string }).code).toBe('not_found');
    }
    const foreman = await api.as('foreman');
    expect((await foreman.get(`${T(P('t-remstroy'))}/members`)).status).toBe(404);
  });

  it('нет права — 403 forbidden_action с текстом примера listMembers', async () => {
    const manager = await api.as('manager');
    const r = await manager.get(`${T(ALTA)}/members`);
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({
      code: 'forbidden_action',
      detail: 'Ни одна роль не разрешает просматривать участников.',
    });
    const owner = await api.as('owner');
    expect((await owner.get(`${T(ALTA)}/members`)).status).toBe(200);
  });

  it('приостановленное членство — 404, приостановленная организация — 403 tenant_suspended', async () => {
    const gromov = await api.as('acc-7');
    expect((await gromov.get(`${T(ALTA)}/members`)).status).toBe(404);
    const owner = await api.as('owner');
    const alta = server.state().tenants.find((t) => t.id === ALTA);
    if (alta) alta.status = 'suspended';
    const r = await owner.get(`${T(ALTA)}/members`);
    expect((r.body as { code: string }).code).toBe('tenant_suspended');
  });

  it('только чтение: чтение проходит, изменение — 403 tenant_read_only', async () => {
    const owner = await api.as('owner');
    const alta = server.state().tenants.find((t) => t.id === ALTA);
    if (alta) alta.status = 'read_only';
    expect((await owner.get(`${T(ALTA)}/members`)).status).toBe(200);
    const w = await owner.post(`${T(ALTA)}/org-units`, {
      parentId: null,
      name: 'Новая',
      kind: 'region',
    });
    expect((w.body as { code: string }).code).toBe('tenant_read_only');
  });

  it('модуль не подключён — 403 module_not_installed, подключён — 501 до W2.00', async () => {
    const owner = await api.as('owner');
    const r = await owner.get(`${T(ALTA)}/fleet/vehicles`);
    expect(r.status).toBe(403);
    expect((r.body as { code: string }).code).toBe('module_not_installed');
    server.applyPreset('logistics-ready');
    const ready = await owner.get(`${T(ALTA)}/fleet/vehicles`);
    expect(ready.status).toBe(501);
    expect((ready.body as { code: string }).code).toBe('not_implemented');
  });

  it('операция без хендлера — 501 not_implemented после шлюза', async () => {
    const owner = await api.as('owner');
    expect((await owner.get(`${T(ALTA)}/tasks`)).status).toBe(501);
    expect((await api.anon().get(`${T(ALTA)}/tasks`)).status).toBe(401);
  });

  it('неизвестный путь и чужой метод под /api/v1/ — 404', async () => {
    const owner = await api.as('owner');
    expect((await owner.get('/api/v1/nowhere')).status).toBe(404);
    expect((await owner.delete('/api/v1/me/context')).status).toBe(404);
    expect((await owner.get('/api/v1/me%2Fcontext')).status).toBe(404);
  });
});

describe('тело, Idempotency-Key, If-Match', () => {
  const unit = { parentId: null, name: 'Запад', kind: 'region' };

  it('неразбираемый JSON — 400 malformed_request, лишнее поле — 400 unknown_field', async () => {
    const owner = await api.as('owner');
    const bad = await owner.post(`${T(ALTA)}/org-units`, '{', {});
    expect((bad.body as { code: string }).code).toBe('malformed_request');
    const extra = await owner.post(`${T(ALTA)}/org-units`, { ...unit, color: 'red' });
    expect((extra.body as { code: string }).code).toBe('unknown_field');
  });

  it('нарушение схемы — 422 validation_failed с violations', async () => {
    const owner = await api.as('owner');
    const r = await owner.post(`${T(ALTA)}/org-units`, { parentId: null, kind: 'planet' });
    expect(r.status).toBe(422);
    expect((r.body as { violations: { field: string; code: string }[] }).violations).toEqual([
      expect.objectContaining({ field: 'name', code: 'required' }),
      expect.objectContaining({ field: 'kind', code: 'enum' }),
    ]);
  });

  it('без ключа — 400; повтор с тем же ключом и телом — тот же ответ и Idempotency-Replayed', async () => {
    const owner = await api.as('owner');
    const none = await owner.post(`${T(ALTA)}/org-units`, unit, { idempotencyKey: false });
    expect((none.body as { code: string }).code).toBe('malformed_request');
    const key = 'retry-key-0000000001';
    const first = await owner.post(`${T(ALTA)}/org-units`, unit, { idempotencyKey: key });
    const again = await owner.post(`${T(ALTA)}/org-units`, unit, { idempotencyKey: key });
    expect(first.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(again.headers.get('Idempotency-Replayed')).toBe('true');
    expect(first.headers.get('Idempotency-Replayed')).toBeNull();
    const other = await owner.post(
      `${T(ALTA)}/org-units`,
      { ...unit, name: 'Восток' },
      { idempotencyKey: key },
    );
    expect(other.status).toBe(409);
    expect((other.body as { code: string }).code).toBe('idempotency_key_reused');
  });

  it('If-Match: нет — 428 revision_required, устарел — 412 revision_mismatch, верный — хендлер', async () => {
    const owner = await api.as('owner');
    const role = `${T(ALTA)}/roles/${seedUuid('t-alta', 'r-driver')}`;
    const missing = await owner.patch(role, { name: 'X' });
    expect((missing.body as { code: string }).code).toBe('revision_required');
    const stale = await owner.patch(role, { name: 'X' }, { ifMatch: 2 });
    expect(stale.status).toBe(412);
    expect((stale.body as { code: string }).code).toBe('revision_mismatch');
    expect((await owner.patch(role, { name: 'X' }, { ifMatch: 3 })).status).toBe(200);
  });
});
