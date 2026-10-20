// Контракт для сценарного сервера (W0.13, бриф §7 п. 1): `contract.gen.json` — выжимка бандла
// 0.3.0-stage1, реестра ошибок, каталога прав и примеров. Браузер не читает YAML: сервер берёт всё отсюда.
import { describe, expect, it } from 'vitest';

import { buildContract, renderContract, STAGE1_TAGS } from '../scripts/contract.mjs';
import { contract, findOperation, operation } from '../src/msw/contract/index.ts';
import { readFileSync } from 'node:fs';

const GEN = new URL('../src/msw/contract/contract.gen.json', import.meta.url);

describe('contract.gen.json', () => {
  it('свежий относительно api/: бандл, errors.yaml, permissions.yaml, примеры, seed-ids.yaml', async () => {
    const fresh = await renderContract(buildContract());
    expect(readFileSync(GEN, 'utf8')).toBe(fresh);
  });

  it('бандл этапа 1: не меньше 143 операций, из них не меньше 62 этапа 1 (теги ядра и Auth)', () => {
    // Контракт аддитивный (W1.00): счётчики — нижние границы 0.3.0-stage1, а не точные числа.
    // W2.00: следующие этапы поднимают суффикс версии (0.5.0-stage2).
    expect(contract.version).toMatch(/^\d+\.\d+\.\d+-stage[1-9]\d*$/);
    expect(contract.operations.length).toBeGreaterThanOrEqual(143);
    const stage1 = contract.operations.filter((o) => o.stage1);
    expect(stage1.length).toBeGreaterThanOrEqual(62);
    expect(new Set(stage1.map((o) => o.tag))).toEqual(new Set(STAGE1_TAGS));
  });

  it('W4.02: объекты «Почему доступно» — x-explain-objects операции explainAccess (модуль, тип → вид области)', () => {
    expect(operation('explainAccess').explainObjects).toEqual([
      { objectModule: 'tasks', objectType: 'project', scopeKind: 'project' },
      { objectModule: 'knowledge', objectType: 'space', scopeKind: 'space' },
      { objectModule: 'knowledge', objectType: 'node', scopeKind: 'page' },
      { objectModule: 'inventory', objectType: 'warehouse', scopeKind: 'warehouse' },
      { objectModule: 'fleet', objectType: 'resource_pool', scopeKind: 'resource' },
      { objectModule: 'logistics', objectType: 'resource_pool', scopeKind: 'resource' },
    ]);
    expect(operation('listMembers').explainObjects).toBeUndefined();
  });

  it('W4.02: причины кода (Problem.reason) — из реестра api/errors.yaml', () => {
    expect(contract.errors.invalid_transition?.reasons).toEqual([
      'not_in_status',
      'checklist_open',
      'children_open',
      'author_forbidden',
      'already_voted',
      'doc_route',
      'form_version_changed',
    ]);
    expect(contract.errors.forbidden_action).not.toHaveProperty('reasons');
  });

  it('реестр ошибок — 53 кода со статусом и заголовком (52 W0.07 и offer_closed W2.71)', () => {
    expect(Object.keys(contract.errors)).toHaveLength(53);
    expect(contract.errors.forbidden_action).toEqual({
      status: 403,
      title: 'Нет действия ни в одной роли',
      retryable: false,
    });
    expect(contract.errors.dependency_unavailable?.retryable).toBe(true);
  });

  it('операция несёт шлюзовые признаки: права, область, публичность, изменение, If-Match, ключ идемпотентности', () => {
    expect(operation('getMyContext')).toMatchObject({
      method: 'GET',
      path: '/api/v1/me/context',
      tag: 'Context',
      permissions: [],
      scope: 'identity',
      public: false,
      mutating: false,
      success: 200,
    });
    expect(operation('updateRole')).toMatchObject({
      method: 'PATCH',
      permissions: ['roles.manage'],
      mutating: true,
      ifMatch: true,
      idempotent: true,
    });
    expect(operation('startLogin')).toMatchObject({ public: true, success: 302 });
    expect(operation('deleteRole').successBody).toBe(false);
    expect(operation('commitPeopleImport').fieldPermissions).toEqual({
      sendInvitations: 'members.invite',
    });
    expect(operation('listVehicles').stage1).toBe(false);
  });

  it('примеры всех операций этапа 1, примеры этапов 2 (W2.00) и 4 (W4.06) и карта seed-ids', () => {
    const stage1 = contract.operations.filter((o) => o.stage1).map((o) => o.id);
    const stage2 = contract.operations.filter((o) => o.stage2).map((o) => o.id);
    // W4.07: операции нового тега этапа 4 Branding тоже несут примеры.
    const stage4 = contract.operations.filter((o) => o.stage4).map((o) => o.id);
    const keys = Object.keys(contract.examples);
    expect(stage1.filter((id) => !keys.includes(id))).toEqual([]);
    expect(
      keys.filter((id) => !stage1.includes(id) && !stage2.includes(id) && !stage4.includes(id)),
    ).toEqual([]);
    expect(keys).toContain('listCalendarBookings');
    expect(keys).toContain('getTripPlan');
    expect(Object.keys(contract.examples.getMyContext ?? {})).toContain('owner');
    expect(contract.seedIds.platform?.['t-alta']).toBe('f04f636e-b66d-509e-ae10-9c27a18e3baa');
  });

  it('каталог прав: действия в порядке permissions.yaml, шаблоны ролей, prototype_renames', () => {
    const keys = contract.permissions.actions.map((a) => a.key);
    expect(keys[0]).toBe('members.read');
    expect(keys).toContain('fleet.earnings.read');
    expect(new Set(keys).size).toBe(keys.length);
    expect(contract.permissions.actions.find((a) => a.key === 'billing.manage')).toMatchObject({
      module: 'core.modules',
      level: 'settings',
      ownerOnly: true,
    });
    expect(contract.permissions.roleTemplates.driver?.workFunction).toBe('driver');
    expect(contract.permissions.renames['calendar.read']).toEqual(['calendar.bookings.read']);
    expect(contract.permissions.modules.logistics?.label).toBeTruthy();
  });
});

describe('поиск операции по методу и пути (как шлюз cmd/api)', () => {
  it('статический сегмент сильнее параметра, параметры раскодируются', () => {
    const m = findOperation('GET', '/api/v1/tenants/abc/files/uploads/u%201');
    expect(m?.op.id).toBe('getUploadSession');
    expect(m?.params).toEqual({ tenantId: 'abc', uploadId: 'u 1' });
    expect(findOperation('GET', '/api/v1/tenants/abc/files/f1')?.op.id).toBe('getFile');
  });

  it('другой метод, лишний слеш и %2F не совпадают', () => {
    expect(findOperation('DELETE', '/api/v1/me/context')).toBeUndefined();
    expect(findOperation('GET', '/api/v1/me/context/')).toBeUndefined();
    expect(findOperation('GET', '/api/v1/tenants/x%2Fy/members')?.params.tenantId).toBe('x/y');
    expect(findOperation('GET', '/api/v1/me%2Fcontext')).toBeUndefined();
  });
});
