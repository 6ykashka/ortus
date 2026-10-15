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

  it('бандл 0.3.0-stage1: 143 операции, из них 62 этапа 1 (теги ядра и Auth)', () => {
    expect(contract.version).toBe('0.3.0-stage1');
    expect(contract.operations).toHaveLength(143);
    const stage1 = contract.operations.filter((o) => o.stage1);
    expect(stage1).toHaveLength(62);
    expect(new Set(stage1.map((o) => o.tag))).toEqual(new Set(STAGE1_TAGS));
  });

  it('реестр ошибок — 52 кода со статусом и заголовком', () => {
    expect(Object.keys(contract.errors)).toHaveLength(52);
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

  it('примеры всех 62 операций этапа 1 и карта seed-ids', () => {
    const stage1 = contract.operations.filter((o) => o.stage1).map((o) => o.id);
    expect(Object.keys(contract.examples).sort()).toEqual([...stage1].sort());
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
