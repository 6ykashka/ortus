// W1.54 · Ключ идемпотентности команд «Структуры» (Q-W1.54-9): одно и то же тело в открытом диалоге — тот же
// Idempotency-Key (повтор после «нет связи» не создаёт второй узел), другое тело — новый ключ. Перечитывание после
// команды: дерево, область шапки, подразделения «Пользователей и ролей», /me/context — без предпросмотра и ролей.
import { QueryClient } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';

import { ME_CONTEXT_KEY } from '../../../shell/me.ts';
import { afterChange, afterStale, idemKeys, treeKey } from './api.ts';

describe('idemKeys', () => {
  it('то же тело — тот же ключ, другое — новый; ключи разных диалогов не совпадают', () => {
    const keys = idemKeys();
    const a = keys({ name: 'Казань', kind: 'region', parentId: null });
    expect(keys({ name: 'Казань', kind: 'region', parentId: null })).toBe(a);
    const b = keys({ name: 'Казань ', kind: 'region', parentId: null });
    expect(b).not.toBe(a);
    expect(keys({ name: 'Казань', kind: 'region', parentId: null })).toBe(a);
    expect(idemKeys()({ name: 'Казань', kind: 'region', parentId: null })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('перечитывание после команды', () => {
  const T = 't-1';
  const KEYS = {
    tree: treeKey(T),
    scope: ['tenant', T, 'org-units'],
    access: ['tenant', T, 'access', 'units'],
    me: ME_CONTEXT_KEY,
    preview: ['tenant', T, 'org-units', 'preview', 'u-1', 'p-1'],
    roles: ['tenant', T, 'org-units', 'role-names'],
  } as const;

  const seeded = (): QueryClient => {
    const qc = new QueryClient();
    for (const k of Object.values(KEYS)) qc.setQueryData(k, 1);
    return qc;
  };
  const invalidated = (qc: QueryClient): string[] =>
    Object.entries(KEYS)
      .filter(([, k]) => qc.getQueryState(k)?.isInvalidated)
      .map(([name]) => name);

  // Возврат 1 доделки №2 (minor): префикс `['tenant', id, 'org-units']` держит и предпросмотр, и названия ролей —
  // открытый диалог переноса слал лишние GET …/move-preview и GET /roles.
  it('перенос: дерево, область шапки, «Пользователи и роли», /me/context; предпросмотр и роли — нет', async () => {
    const qc = seeded();
    await afterChange(qc, T, true);
    expect(invalidated(qc)).toEqual(['tree', 'scope', 'access', 'me']);
  });

  it('создание и переименование: без /me/context', async () => {
    const qc = seeded();
    await afterChange(qc, T);
    expect(invalidated(qc)).toEqual(['tree', 'scope', 'access']);
  });

  it('отказ 409/412/404 (данные устарели): ещё и предпросмотр открытого диалога, роли — нет', async () => {
    const qc = seeded();
    await afterStale(qc, T);
    expect(invalidated(qc)).toEqual(['tree', 'scope', 'access', 'preview']);
  });
});
