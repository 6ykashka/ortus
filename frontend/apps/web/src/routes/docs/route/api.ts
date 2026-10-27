// W7.26 · Запросы блока «Маршрут документа» (контракт 0.12.0-stage7, тег Docs; backend — W7.24, пока MSW): документ
// (`getDocument`: статус, версия, `my.wait`, связи, папка), маршрут (`getDocRoute`; 404 — маршрута нет), шаблоны
// маршрутов папок, сотрудники, роли и группы для выбора участников. Команды: запуск (с `dryRun`), решение, запрос и
// подтверждение подписи, ознакомление, досрочное завершение ознакомления, «Отправить снова», отмена. Все POST несут
// Idempotency-Key на тело. Ключи запросов лежат под `['tenant', id, 'docs']` — тот же корень, что у страницы «Документы»
// (W7.25): её `refresh` перечитывает и этот блок.
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';

type S = components['schemas'];

export const docsKey = (tenantId: string) => ['tenant', tenantId, 'docs'] as const;

const LIMIT = 200;
const PAGES = 20;

async function every<T>(
  page: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < PAGES; i++) {
    const p = await page(cursor);
    out.push(...p.items);
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return out;
}

/** 403 и 404 — раздела данных нет у роли: не ошибка блока, а пустой список. */
async function orEmpty<T>(fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ProblemError && (e.status === 403 || e.status === 404)) return [];
    throw e;
  }
}

// ───────────────────────────── чтение ─────────────────────────────

/** Документ для блока маршрута (ключ отдельный от карточки W7.25: другая форма данных). */
export function useRouteDoc(tenantId: string, id: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'route-doc', id],
    retry: false,
    queryFn: async (): Promise<S['Document']> =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/docs/{documentId}', {
          params: { path: { tenantId, documentId: id } },
        }),
      ),
  });
}

/** Маршрут документа; `null` — у документа его нет (404 по контракту). */
export function useRoute(tenantId: string, id: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'route', id],
    retry: false,
    queryFn: async (): Promise<S['DocRoute'] | null> => {
      try {
        return await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/docs/{documentId}/route', {
            params: { path: { tenantId, documentId: id } },
          }),
        );
      } catch (e) {
        if (e instanceof ProblemError && e.status === 404) return null;
        throw e;
      }
    },
  });
}

export function useRouteTemplates(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'route-templates'],
    enabled,
    retry: false,
    queryFn: async (): Promise<S['DocRouteTemplate'][]> =>
      orEmpty(
        async () =>
          (
            await unwrap(
              await api.GET('/api/v1/tenants/{tenantId}/doc-route-templates', {
                params: { path: { tenantId } },
              }),
            )
          ).items,
      ),
  });
}

export function useMembers(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'route-members'],
    enabled,
    retry: false,
    queryFn: (): Promise<S['Member'][]> =>
      orEmpty(() =>
        every(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/members', {
              params: {
                path: { tenantId },
                query: { limit: LIMIT, ...(cursor ? { cursor } : {}) },
              },
            }),
          ),
        ),
      ),
  });
}

export function useRoles(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'route-roles'],
    enabled,
    retry: false,
    queryFn: (): Promise<S['Role'][]> =>
      orEmpty(() =>
        every(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/roles', {
              params: {
                path: { tenantId },
                query: { limit: LIMIT, ...(cursor ? { cursor } : {}) },
              },
            }),
          ),
        ),
      ),
  });
}

export function useGroups(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'route-groups'],
    enabled,
    retry: false,
    queryFn: (): Promise<S['Group'][]> =>
      orEmpty(() =>
        every(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/groups', {
              params: {
                path: { tenantId },
                query: { limit: LIMIT, ...(cursor ? { cursor } : {}) },
              },
            }),
          ),
        ),
      ),
  });
}

/** Справочники формы «На согласование»: готовы (или отказали) — кнопка доступна, диалог открывается сразу, без скелетона. */
export function useSendLookups(tenantId: string, enabled: boolean): { ready: boolean } {
  const templates = useRouteTemplates(tenantId, enabled);
  const members = useMembers(tenantId, enabled);
  const roles = useRoles(tenantId, enabled);
  const groups = useGroups(tenantId, enabled);
  const settled = (q: { isPending: boolean; fetchStatus: string }): boolean =>
    !q.isPending || q.fetchStatus === 'idle';
  return { ready: !enabled || [templates, members, roles, groups].every(settled) };
}

// ───────────────────────────── команды ─────────────────────────────

/**
 * Ключи идемпотентности (соглашение W2.23): то же тело — тот же `Idempotency-Key` до определённого ответа сервера,
 * другое тело — новый.
 */
export function idemKeys(): { key: (body: unknown) => string; settle: (body: unknown) => void } {
  const keys = new Map<string, string>();
  const fp = (body: unknown) => JSON.stringify(body ?? null);
  return {
    key: (body) => {
      let k = keys.get(fp(body));
      if (!k) {
        k = crypto.randomUUID();
        keys.set(fp(body), k);
      }
      return k;
    },
    settle: (body) => void keys.delete(fp(body)),
  };
}

interface Cmd {
  api: ApiClient;
  tenantId: string;
  docId: string;
  key: string;
}

const path = (c: Cmd) => ({ tenantId: c.tenantId, documentId: c.docId });
const header = (c: Cmd) => ({ 'Idempotency-Key': c.key });

export async function startRoute(
  c: Cmd,
  body: S['DocRouteStart'],
): Promise<S['DocRouteStartResult']> {
  return unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/route', {
      params: { path: path(c), header: header(c) },
      body,
    }),
  );
}

export async function decideRoute(c: Cmd, body: S['DocRouteDecide']): Promise<S['DocRoute']> {
  return unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/route/decisions', {
      params: { path: path(c), header: header(c) },
      body,
    }),
  );
}

export async function requestSignCode(
  c: Cmd,
  body: S['DocSignCodeRequest'],
): Promise<S['DocSignChallenge']> {
  return unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/route/sign/code', {
      params: { path: path(c), header: header(c) },
      body,
    }),
  );
}

export async function confirmSign(c: Cmd, body: S['DocSignConfirm']): Promise<S['DocSignResult']> {
  return unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/route/sign', {
      params: { path: path(c), header: header(c) },
      body,
    }),
  );
}

export async function ackDocument(c: Cmd, body: S['DocAck']): Promise<S['DocAckResult']> {
  return unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/ack', {
      params: { path: path(c), header: header(c) },
      body,
    }),
  );
}

export async function closeAck(c: Cmd): Promise<S['DocRoute']> {
  return unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/route/ack/close', {
      params: { path: path(c), header: header(c) },
    }),
  );
}

export async function resumeRoute(c: Cmd): Promise<S['DocRoute']> {
  return unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/route/resume', {
      params: { path: path(c), header: header(c) },
    }),
  );
}

export async function cancelRoute(c: Cmd): Promise<S['DocRoute']> {
  return unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/route/cancel', {
      params: { path: path(c), header: header(c) },
    }),
  );
}
