// W1.54 · Запросы и команды «Структуры» (контракт 0.4.0-stage1, тег Access): дерево listOrgUnits (все страницы
// курсора), подписи ролей listRoles (для строк влияния), предпросмотр previewOrgUnitMove, createOrgUnit с
// Idempotency-Key, updateOrgUnit с If-Match свежего getOrgUnit. После команды перечитываются область шапки
// (`['tenant', id, 'org-units']`), подразделения «Пользователей и ролей» (`['tenant', id, 'access']`) и — после
// переноса — /me/context (области назначений).
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { type QueryClient, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { ME_CONTEXT_KEY } from '../../../shell/me.ts';

type S = components['schemas'];

/** Префикс подразделений организации: им пользуются область шапки (scope.ts) и эта страница. */
const orgUnitsKey = (tenantId: string) => ['tenant', tenantId, 'org-units'] as const;
export const treeKey = (tenantId: string) => [...orgUnitsKey(tenantId), 'tree'] as const;
const previewKey = (tenantId: string, unitId: string, parentId: string) =>
  [...orgUnitsKey(tenantId), 'preview', unitId, parentId] as const;
const rolesKey = (tenantId: string) => [...orgUnitsKey(tenantId), 'role-names'] as const;

const PAGE = 200;
const MAX_PAGES = 50;

async function allPages<T>(
  load: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const p = await load(cursor);
    out.push(...p.items);
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return out;
}

const query = (cursor: string | undefined) => ({ limit: PAGE, ...(cursor ? { cursor } : {}) });

/** Подразделения организации, видимые по org_units.read. */
export function useUnits(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: treeKey(tenantId),
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/org-units', {
            params: { path: { tenantId }, query: query(cursor) },
          }),
        ),
      ),
  });
}

/** Названия ролей по id (строки «{имя} · {роль}» предпросмотра); без права или при сбое — пустая карта. */
export function useRoleNames(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: rolesKey(tenantId),
    enabled,
    queryFn: async () => {
      try {
        const roles = await allPages(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/roles', {
              params: { path: { tenantId }, query: query(cursor) },
            }),
          ),
        );
        return new Map(roles.map((r) => [r.id, r.name]));
      } catch {
        return new Map<string, string>();
      }
    },
  });
}

/** Влияние переноса `unitId` под `parentId` на доступ (без записи); пустой `parentId` — запроса нет. */
export function usePreview(tenantId: string, unitId: string, parentId: string) {
  const api = useApi();
  return useQuery({
    queryKey: previewKey(tenantId, unitId, parentId),
    enabled: parentId !== '',
    staleTime: 0,
    gcTime: 0,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/org-units/{orgUnitId}/move-preview', {
          params: { path: { tenantId, orgUnitId: unitId }, query: { parentId } },
        }),
      ),
  });
}

/**
 * Ключи идемпотентности открытого диалога (Q-W1.54-9): то же тело команды — тот же `Idempotency-Key` (повтор
 * после «нет связи» сервер узнаёт и не выполняет дважды), другое тело — новый ключ.
 */
export function idemKeys(): (body: unknown) => string {
  const keys = new Map<string, string>();
  return (body) => {
    const fp = JSON.stringify(body);
    let key = keys.get(fp);
    if (!key) {
      key = crypto.randomUUID();
      keys.set(fp, key);
    }
    return key;
  };
}

export async function createUnit(
  api: ApiClient,
  tenantId: string,
  body: S['OrgUnitCreate'],
  key: string,
): Promise<S['OrgUnit']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/org-units', {
      params: { path: { tenantId }, header: { 'Idempotency-Key': key } },
      body,
    }),
  );
}

/** Правка узла: ETag свежего getOrgUnit → PATCH с If-Match (без версии команда не отправляется — 428). */
export async function updateUnit(
  api: ApiClient,
  tenantId: string,
  orgUnitId: string,
  body: S['OrgUnitPatch'],
  key: string,
): Promise<S['OrgUnit']> {
  const path = { tenantId, orgUnitId };
  const cur = await api.GET('/api/v1/tenants/{tenantId}/org-units/{orgUnitId}', {
    params: { path },
  });
  await unwrap(cur);
  const etag = cur.response.headers.get('ETag');
  if (!etag) throw new ProblemError(428);
  return unwrap(
    await api.PATCH('/api/v1/tenants/{tenantId}/org-units/{orgUnitId}', {
      params: { path, header: { 'Idempotency-Key': key, 'If-Match': etag } },
      body,
    }),
  );
}

/**
 * После команды: дерево, область шапки (ключ — сам префикс, точно), подразделения «Пользователей и ролей», после
 * переноса — /me/context. Предпросмотр и названия ролей под тем же префиксом не трогаются: открытый диалог
 * переноса не шлёт лишние GET …/move-preview и GET /roles (возврат 1 доделки №2).
 */
export async function afterChange(qc: QueryClient, tenantId: string, moved = false): Promise<void> {
  await Promise.all([
    qc.invalidateQueries({ queryKey: treeKey(tenantId) }),
    qc.invalidateQueries({ queryKey: orgUnitsKey(tenantId), exact: true }),
    qc.invalidateQueries({ queryKey: ['tenant', tenantId, 'access'] }),
    moved ? qc.invalidateQueries({ queryKey: ME_CONTEXT_KEY }) : null,
  ]);
}

/** После 409/412/404 (данные на экране устарели): то же и предпросмотр открытого диалога переноса. */
export async function afterStale(qc: QueryClient, tenantId: string): Promise<void> {
  await Promise.all([
    afterChange(qc, tenantId),
    qc.invalidateQueries({ queryKey: [...orgUnitsKey(tenantId), 'preview'] }),
  ]);
}
