// W4.32 · Запросы и команды «Базы знаний» (контракт 0.9.0-stage4, тег Knowledge; W4.04, backend — W4.31):
// пространства и шаблоны, дерево, поиск, узел (ETag — If-Match публикации) и версия, архив, доступ узла (ETag —
// If-Match сохранения) с кандидатами и `dryRun`, перенос с `dryRun`, карта и объяснение, участники, правила и журнал.
// Команды — с Idempotency-Key (повтор после «нет связи» — тот же ключ, соглашение W2.23).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { keepPreviousData, useQueries, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';

type S = components['schemas'];

export const kbKey = (tenantId: string) => ['tenant', tenantId, 'knowledge'] as const;

const P = '/api/v1/tenants/{tenantId}/knowledge' as const;

/** Предел страницы контракта (`Limit`) и число страниц списка пространств. */
const LIMIT = 200;
const PAGES = 20;

/** Пространства участника (все страницы по курсору). */
export function useSpaces(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'spaces'],
    queryFn: async () => {
      const out: S['KnowledgeSpace'][] = [];
      let cursor: string | undefined;
      for (let i = 0; i < PAGES; i++) {
        const p = await unwrap(
          await api.GET(`${P}/spaces`, {
            params: { path: { tenantId }, query: { limit: LIMIT, ...(cursor ? { cursor } : {}) } },
          }),
        );
        out.push(...p.items);
        if (!p.nextCursor) break;
        cursor = p.nextCursor;
      }
      return out;
    },
  });
}

/** Поиск по доступным страницам (от двух символов, до 12 результатов); `spaceId` — внутри пространства. */
export function useSearch(tenantId: string, q: string, spaceId?: string) {
  const api = useApi();
  const term = q.trim();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'search', spaceId ?? '', term.toLowerCase()],
    enabled: term.length >= 2,
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET(`${P}/search`, {
            params: { path: { tenantId }, query: { q: term, ...(spaceId ? { spaceId } : {}) } },
          }),
        )
      ).items,
  });
}

export function useTree(tenantId: string, spaceId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'tree', spaceId],
    enabled: !!spaceId,
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.GET(`${P}/spaces/{spaceId}/tree`, {
          params: { path: { tenantId, spaceId: spaceId ?? '' } },
        }),
      ),
  });
}

export interface NodeRead {
  node: S['KnowledgeNode'];
  /** ETag узла — If-Match публикации (версия, которую видел участник). */
  etag: string | null;
}

const nodeQuery = (api: ApiClient, tenantId: string, nodeId: string) => ({
  queryKey: [...kbKey(tenantId), 'node', nodeId],
  retry: false,
  queryFn: async (): Promise<NodeRead> => {
    const r = await api.GET(`${P}/nodes/{nodeId}`, { params: { path: { tenantId, nodeId } } });
    const node = await unwrap(r);
    return { node, etag: r.response.headers.get('ETag') };
  },
});

export function useNode(tenantId: string, nodeId: string | undefined) {
  const api = useApi();
  return useQuery({ ...nodeQuery(api, tenantId, nodeId ?? ''), enabled: !!nodeId });
}

/** Узлы подстраниц — выдержка текста карточек «Подстраницы». */
export function useNodes(tenantId: string, ids: readonly string[]) {
  const api = useApi();
  return useQueries({ queries: ids.map((id) => nodeQuery(api, tenantId, id)) });
}

export function useVersion(tenantId: string, nodeId: string, version: number | null) {
  const api = useApi();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'version', nodeId, version],
    enabled: version !== null,
    queryFn: async () =>
      unwrap(
        await api.GET(`${P}/nodes/{nodeId}/versions/{version}`, {
          params: { path: { tenantId, nodeId, version: version ?? 0 } },
        }),
      ),
  });
}

export function useArchive(tenantId: string, spaceId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'archive', spaceId],
    enabled,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET(`${P}/spaces/{spaceId}/archive`, {
            params: { path: { tenantId, spaceId } },
          }),
        )
      ).items,
  });
}

export function useMembers(tenantId: string, spaceId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'members', spaceId],
    queryFn: async () =>
      unwrap(
        await api.GET(`${P}/spaces/{spaceId}/members`, {
          params: { path: { tenantId, spaceId } },
        }),
      ),
  });
}

export function useAccessMap(tenantId: string, spaceId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'map', spaceId],
    enabled,
    queryFn: async () =>
      unwrap(
        await api.GET(`${P}/spaces/{spaceId}/access-map`, {
          params: { path: { tenantId, spaceId } },
        }),
      ),
  });
}

export function useExplain(
  tenantId: string,
  nodeId: string | undefined,
  memberId: string | undefined,
) {
  const api = useApi();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'explain', nodeId, memberId],
    enabled: !!nodeId && !!memberId,
    placeholderData: keepPreviousData,
    queryFn: async () =>
      unwrap(
        await api.GET(`${P}/nodes/{nodeId}/explain`, {
          params: { path: { tenantId, nodeId: nodeId ?? '' }, query: { memberId: memberId ?? '' } },
        }),
      ),
  });
}

export function useRules(tenantId: string, spaceId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'rules', spaceId],
    queryFn: async () =>
      (
        await unwrap(
          await api.GET(`${P}/spaces/{spaceId}/rules`, { params: { path: { tenantId, spaceId } } }),
        )
      ).items,
  });
}

export function useRuns(tenantId: string, spaceId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'runs', spaceId],
    queryFn: async () =>
      (
        await unwrap(
          await api.GET(`${P}/spaces/{spaceId}/runs`, { params: { path: { tenantId, spaceId } } }),
        )
      ).items,
  });
}

export function useTemplates(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'templates'],
    enabled,
    staleTime: Infinity,
    queryFn: async () =>
      (await unwrap(await api.GET(`${P}/space-templates`, { params: { path: { tenantId } } })))
        .items,
  });
}

export interface AccessRead {
  access: S['KnowledgeNodeAccess'];
  /** ETag доступа узла — If-Match сохранения и проверки влияния. */
  etag: string | null;
}

export function useNodeAccess(tenantId: string, nodeId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'access', nodeId],
    queryFn: async (): Promise<AccessRead> => {
      const r = await api.GET(`${P}/nodes/{nodeId}/access`, {
        params: { path: { tenantId, nodeId } },
      });
      return { access: await unwrap(r), etag: r.response.headers.get('ETag') };
    },
  });
}

export function useCandidates(tenantId: string, nodeId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'candidates', nodeId],
    enabled,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET(`${P}/nodes/{nodeId}/access/candidates`, {
            params: { path: { tenantId, nodeId } },
          }),
        )
      ).items,
  });
}

/** Ключ идемпотентности без ответа команды (проверка влияния не меняет данных — новый ключ на запрос). */
const freshKey = (): string => crypto.randomUUID();

/** «Что изменится»: `setKnowledgeNodeAccess` с `dryRun` по черновику режима и списка. */
export function useAccessImpact(
  tenantId: string,
  nodeId: string,
  etag: string | null,
  change: S['KnowledgeAccessChange'] | null,
) {
  const api = useApi();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'access-impact', nodeId, etag, change],
    enabled: !!change && !!etag,
    placeholderData: keepPreviousData,
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.PUT(`${P}/nodes/{nodeId}/access`, {
          params: {
            path: { tenantId, nodeId },
            header: { 'Idempotency-Key': freshKey(), 'If-Match': etag ?? '' },
          },
          body: { ...(change as S['KnowledgeAccessChange']), dryRun: true },
        }),
      ),
  });
}

/** Влияние переноса: `moveKnowledgeNode` с `dryRun`. */
export function useMoveImpact(
  tenantId: string,
  nodeId: string,
  parentId: string | null | undefined,
) {
  const api = useApi();
  return useQuery({
    queryKey: [...kbKey(tenantId), 'move-impact', nodeId, parentId],
    enabled: parentId !== undefined,
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.POST(`${P}/nodes/{nodeId}/move`, {
          params: { path: { tenantId, nodeId }, header: { 'Idempotency-Key': freshKey() } },
          body: { parentId: parentId ?? null, dryRun: true },
        }),
      ),
  });
}

// ---------------------------------------------------------------------------------------------
// Команды: (api, tenantId, …, key) → ответ сервера.

type Key = string;
const hdr = (key: Key) => ({ 'Idempotency-Key': key });

export const commands = {
  createSpace: async (
    api: ApiClient,
    tenantId: string,
    body: S['KnowledgeSpaceCreate'],
    key: Key,
  ) =>
    unwrap(
      await api.POST(`${P}/spaces`, { params: { path: { tenantId }, header: hdr(key) }, body }),
    ),
  createNode: async (
    api: ApiClient,
    tenantId: string,
    spaceId: string,
    body: S['KnowledgeNodeCreate'],
    key: Key,
  ) =>
    unwrap(
      await api.POST(`${P}/spaces/{spaceId}/nodes`, {
        params: { path: { tenantId, spaceId }, header: hdr(key) },
        body,
      }),
    ),
  publish: async (
    api: ApiClient,
    tenantId: string,
    nodeId: string,
    etag: string,
    body: S['KnowledgePublish'],
    key: Key,
  ) =>
    unwrap(
      await api.POST(`${P}/nodes/{nodeId}/versions`, {
        params: { path: { tenantId, nodeId }, header: { ...hdr(key), 'If-Match': etag } },
        body,
      }),
    ),
  setStatus: async (
    api: ApiClient,
    tenantId: string,
    nodeId: string,
    status: S['KnowledgeNodeStatusChange']['status'],
    key: Key,
  ) =>
    unwrap(
      await api.POST(`${P}/nodes/{nodeId}/status`, {
        params: { path: { tenantId, nodeId }, header: hdr(key) },
        body: { status },
      }),
    ),
  move: async (
    api: ApiClient,
    tenantId: string,
    nodeId: string,
    parentId: string | null,
    key: Key,
  ) =>
    unwrap(
      await api.POST(`${P}/nodes/{nodeId}/move`, {
        params: { path: { tenantId, nodeId }, header: hdr(key) },
        body: { parentId },
      }),
    ),
  archive: async (api: ApiClient, tenantId: string, nodeId: string, key: Key) =>
    unwrap(
      await api.POST(`${P}/nodes/{nodeId}/archive`, {
        params: { path: { tenantId, nodeId }, header: hdr(key) },
      }),
    ),
  restore: async (api: ApiClient, tenantId: string, nodeId: string, key: Key) =>
    unwrap(
      await api.POST(`${P}/nodes/{nodeId}/restore`, {
        params: { path: { tenantId, nodeId }, header: hdr(key) },
      }),
    ),
  ack: async (api: ApiClient, tenantId: string, nodeId: string, version: number, key: Key) =>
    unwrap(
      await api.POST(`${P}/nodes/{nodeId}/ack`, {
        params: { path: { tenantId, nodeId }, header: hdr(key) },
        body: { version },
      }),
    ),
  requestEdit: async (api: ApiClient, tenantId: string, nodeId: string, key: Key) =>
    unwrap(
      await api.POST(`${P}/nodes/{nodeId}/requests`, {
        params: { path: { tenantId, nodeId }, header: hdr(key) },
        body: { can: 'edit' },
      }),
    ),
  setAccess: async (
    api: ApiClient,
    tenantId: string,
    nodeId: string,
    etag: string,
    body: S['KnowledgeAccessChange'],
    key: Key,
  ) =>
    unwrap(
      await api.PUT(`${P}/nodes/{nodeId}/access`, {
        params: { path: { tenantId, nodeId }, header: { ...hdr(key), 'If-Match': etag } },
        body,
      }),
    ),
  decide: async (
    api: ApiClient,
    tenantId: string,
    requestId: string,
    decision: 'approve' | 'deny',
    key: Key,
  ) =>
    unwrap(
      await api.POST(`${P}/requests/{requestId}/decision`, {
        params: { path: { tenantId, requestId }, header: hdr(key) },
        body: { decision },
      }),
    ),
  setMember: async (
    api: ApiClient,
    tenantId: string,
    spaceId: string,
    memberId: string,
    role: S['KnowledgeSpaceMemberChange']['role'],
    key: Key,
  ) =>
    unwrap(
      await api.PUT(`${P}/spaces/{spaceId}/members/{memberId}`, {
        params: { path: { tenantId, spaceId, memberId }, header: hdr(key) },
        body: { role },
      }),
    ),
  setRule: async (api: ApiClient, tenantId: string, ruleId: string, enabled: boolean, key: Key) =>
    unwrap(
      await api.PATCH(`${P}/rules/{ruleId}`, {
        params: { path: { tenantId, ruleId }, header: hdr(key) },
        body: { enabled },
      }),
    ),
  reviewCheck: async (api: ApiClient, tenantId: string, spaceId: string, key: Key) =>
    unwrap(
      await api.POST(`${P}/spaces/{spaceId}/review-check`, {
        params: { path: { tenantId, spaceId }, header: hdr(key) },
      }),
    ),
  runSection: async (
    api: ApiClient,
    tenantId: string,
    spaceId: string,
    projectId: string,
    key: Key,
  ) =>
    unwrap(
      await api.POST(`${P}/spaces/{spaceId}/sections`, {
        params: { path: { tenantId, spaceId }, header: hdr(key) },
        body: { projectId },
      }),
    ),
};

/**
 * Ключи идемпотентности команд (соглашение W2.23, Q-W2.22-9): та же команда с тем же телом — тот же
 * `Idempotency-Key` до определённого ответа сервера (повтор после «нет связи» сервер узнаёт), другое тело — новый.
 */
export function idemKeys(): { key: (fp: unknown) => string; settle: (fp: unknown) => void } {
  const keys = new Map<string, string>();
  const id = (fp: unknown) => JSON.stringify(fp ?? null);
  return {
    key: (fp) => {
      let k = keys.get(id(fp));
      if (!k) {
        k = crypto.randomUUID();
        keys.set(id(fp), k);
      }
      return k;
    },
    settle: (fp) => void keys.delete(id(fp)),
  };
}
