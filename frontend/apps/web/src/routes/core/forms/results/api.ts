// W4.23 · Запросы и команды вкладок формы (контракт 0.11.0-stage4, тег Forms — W4.05, backend W4.21): форма с ETag
// (If-Match `updateForm`), черновик, версии, правила (If-Match — ревизия правила), ответы, сводка, CSV; для
// действий — пространства, дерево и узлы «Базы знаний» (W4.04), проекты и участники «Задач» (W4.03), сотрудники
// (`listMembers`). Команды — с Idempotency-Key (повтор после «нет связи» — тот же ключ, соглашение W2.23).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { useQueries, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../../app/api.tsx';
import type { DraftRead, FormRead } from '../api.ts';

type S = components['schemas'];

/** Префикс ключей запросов «Форм» организации (общий с W4.22: правка формы в любой вкладке обновляет все). */
export const formsKey = (tenantId: string) => ['tenant', tenantId, 'forms'] as const;

const P = '/api/v1/tenants/{tenantId}/forms/{formId}' as const;
const LIMIT = 200;
const PAGES = 20;

/** ETag ревизии (контракт: строгий `"rev-N"`). */
export const etagOf = (revision: number): string => `"rev-${revision}"`;

export type { FormRead };

/**
 * Форма с ETag — If-Match `updateForm`. Ключ, запрос, вид данных и `retry: false` — как у `useForm` редактора W4.22
 * (`../api.ts`): кто бы ни прочитал форму, в кэше одно и то же. Вкладки и «Поделиться» монтируются внутри редактора,
 * который форму уже прочитал, поэтому при монтировании её не перечитывают (`refetchOnMount: false`): отказ такого
 * перечитывания (нет связи, 429) пометил бы запрос ошибкой, и оболочка W4.22 заменила бы редактор карточкой ошибки.
 */
export function useForm(tenantId: string, formId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...formsKey(tenantId), 'form', formId],
    retry: false,
    refetchOnMount: false,
    queryFn: async (): Promise<FormRead> => {
      const r = await api.GET(P, { params: { path: { tenantId, formId } } });
      return { form: await unwrap(r), etag: r.response.headers.get('ETag') };
    },
  });
}

/** If-Match `updateForm`: ETag ответа, без него — по ревизии формы. */
export const ifMatchOf = (read: FormRead): string => read.etag ?? etagOf(read.form.revision);

/**
 * Черновик с ETag. Ключ, запрос, вид данных (`{draft, etag}`) и параметры — как у `useDraft` редактора W4.22
 * (`../api.ts`): общая инвалидация «Форм» после команды вкладки перечитывает черновик функцией любого из наблюдателей,
 * и в кэше должно лежать одно и то же. Редактор черновик уже прочитал — при монтировании вкладки не перечитывать.
 */
export function useDraft(tenantId: string, formId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...formsKey(tenantId), 'draft', formId],
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<DraftRead> => {
      const r = await api.GET(`${P}/draft`, { params: { path: { tenantId, formId } } });
      return { draft: await unwrap(r), etag: r.response.headers.get('ETag') };
    },
  });
}

async function pages<T>(
  load: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < PAGES; i++) {
    const p = await load(cursor);
    out.push(...p.items);
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return out;
}

/** Версии формы, новая первой. */
export function useVersions(tenantId: string, formId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...formsKey(tenantId), 'versions', formId],
    queryFn: async () =>
      pages(async (cursor) =>
        unwrap(
          await api.GET(`${P}/versions`, {
            params: {
              path: { tenantId, formId },
              query: { limit: LIMIT, ...(cursor ? { cursor } : {}) },
            },
          }),
        ),
      ),
  });
}

export function useRules(tenantId: string, formId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...formsKey(tenantId), 'rules', formId],
    queryFn: async () =>
      (await unwrap(await api.GET(`${P}/rules`, { params: { path: { tenantId, formId } } }))).items,
  });
}

/** Ответы, видимые участнику (новые первыми). */
export function useResponses(tenantId: string, formId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...formsKey(tenantId), 'responses', formId],
    enabled,
    // Схема ответа openapi-fetch даёт NullValue без value — приводится к FormResponse контракта.
    queryFn: async (): Promise<S['FormResponse'][]> =>
      pages(async (cursor) =>
        unwrap(
          await api.GET(`${P}/responses`, {
            params: {
              path: { tenantId, formId },
              query: { limit: LIMIT, ...(cursor ? { cursor } : {}) },
            },
          }),
        ),
      ) as unknown as Promise<S['FormResponse'][]>,
  });
}

export function useSummary(tenantId: string, formId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...formsKey(tenantId), 'summary', formId],
    enabled,
    retry: false,
    queryFn: async () =>
      unwrap(await api.GET(`${P}/summary`, { params: { path: { tenantId, formId } } })),
  });
}

// --- справочники для действий и настроек ---

/**
 * Подразделения «Области формы» и меты шапки — ключ и запрос оболочки (`useOrgUnits`, shell/scope.ts), но без
 * перечитывания при каждом монтировании вкладки и шапки (оболочка уже прочитала их при входе).
 */
export function useUnitsQuery(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'org-units'],
    enabled: !!tenantId,
    staleTime: 60_000,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/org-units', {
            params: { path: { tenantId }, query: { limit: 200 } },
          }),
        )
      ).items,
  });
}

/** Сотрудники организации (`listMembers`) — «Кому» уведомления и подписи исполнителей. */
export function useMembers(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'forms-members'],
    enabled,
    staleTime: 60_000,
    queryFn: async () =>
      pages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/members', {
            params: { path: { tenantId }, query: { limit: LIMIT, ...(cursor ? { cursor } : {}) } },
          }),
        ),
      ),
  });
}

/** Проекты задач, доступные участнику (действие «задача»). */
export function useProjects(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'tasks', 'projects'],
    enabled,
    queryFn: async (): Promise<S['Project'][]> =>
      pages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/projects', {
            params: { path: { tenantId }, query: { limit: LIMIT, ...(cursor ? { cursor } : {}) } },
          }),
        ),
      ),
  });
}

/** Участники проекта — исполнители задачи действия. */
export function useProjectMembers(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'tasks', 'members', projectId],
    enabled: !!projectId,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/projects/{projectId}/members', {
          params: { path: { tenantId, projectId } },
        }),
      ),
  });
}

/**
 * Участники проектов задач правил — подписи исполнителей карточек (тот же ключ, что у `useProjectMembers`). Нет
 * доступа к проекту — без повторов: имя неизвестно, карточка пишет «сотрудник вне вашей области».
 */
export function useProjectsMembers(tenantId: string, projectIds: readonly string[]) {
  const api = useApi();
  return useQueries({
    queries: [...new Set(projectIds)].map((projectId) => ({
      queryKey: ['tenant', tenantId, 'tasks', 'members', projectId],
      retry: false,
      queryFn: async () =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/projects/{projectId}/members', {
            params: { path: { tenantId, projectId } },
          }),
        ),
    })),
  });
}

/** Пространства «Базы знаний» участника. */
export function useKbSpaces(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'knowledge', 'spaces'],
    enabled,
    queryFn: async () =>
      pages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/knowledge/spaces', {
            params: { path: { tenantId }, query: { limit: LIMIT, ...(cursor ? { cursor } : {}) } },
          }),
        ),
      ),
  });
}

/** Деревья пространств — страницы «{раздел} · {страница}» выбора «Страница Базы знаний». */
export function useKbTrees(tenantId: string, spaceIds: readonly string[]) {
  const api = useApi();
  return useQueries({
    queries: spaceIds.map((spaceId) => ({
      queryKey: ['tenant', tenantId, 'knowledge', 'tree', spaceId],
      queryFn: async () =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/knowledge/spaces/{spaceId}/tree', {
            params: { path: { tenantId, spaceId } },
          }),
        ),
    })),
  });
}

/** Узел «Базы знаний» — таблицы страницы («Таблица на странице»). */
export function useKbNode(tenantId: string, nodeId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'knowledge', 'node', nodeId],
    enabled: !!nodeId,
    retry: false,
    queryFn: async () => {
      const r = await api.GET('/api/v1/tenants/{tenantId}/knowledge/nodes/{nodeId}', {
        params: { path: { tenantId, nodeId } },
      });
      return { node: await unwrap(r), etag: r.response.headers.get('ETag') };
    },
  });
}

// ---------------------------------------------------------------------------------------------
// Команды: (api, tenantId, formId, …, key) → ответ сервера.

type Key = string;
const hdr = (key: Key) => ({ 'Idempotency-Key': key });

export const commands = {
  updateForm: async (
    api: ApiClient,
    tenantId: string,
    formId: string,
    etag: string,
    body: S['FormPatch'],
    key: Key,
  ) =>
    unwrap(
      await api.PATCH(P, {
        params: { path: { tenantId, formId }, header: { ...hdr(key), 'If-Match': etag } },
        body,
      }),
    ),
  createRule: async (
    api: ApiClient,
    tenantId: string,
    formId: string,
    body: S['FormRuleCreate'],
    key: Key,
  ) =>
    unwrap(
      await api.POST(`${P}/rules`, {
        params: { path: { tenantId, formId }, header: hdr(key) },
        body,
      }),
    ),
  updateRule: async (
    api: ApiClient,
    tenantId: string,
    formId: string,
    rule: S['FormRule'],
    body: S['FormRulePatch'],
    key: Key,
  ) =>
    unwrap(
      await api.PATCH(`${P}/rules/{ruleId}`, {
        params: {
          path: { tenantId, formId, ruleId: rule.id },
          header: { ...hdr(key), 'If-Match': etagOf(rule.revision) },
        },
        body,
      }),
    ),
  deleteRule: async (
    api: ApiClient,
    tenantId: string,
    formId: string,
    rule: S['FormRule'],
    key: Key,
  ) => {
    const r = await api.DELETE(`${P}/rules/{ruleId}`, {
      params: {
        path: { tenantId, formId, ruleId: rule.id },
        header: { ...hdr(key), 'If-Match': etagOf(rule.revision) },
      },
    });
    // 204 без тела: unwrap ждёт данные — успех подставляется null, ошибка — Problem тела.
    await unwrap({ data: r.response.ok ? null : undefined, error: r.error, response: r.response });
  },
  backfill: async (api: ApiClient, tenantId: string, formId: string, ruleId: string, key: Key) =>
    unwrap(
      await api.POST(`${P}/rules/{ruleId}/backfill`, {
        params: { path: { tenantId, formId, ruleId }, header: hdr(key) },
      }),
    ),
  retry: async (
    api: ApiClient,
    tenantId: string,
    formId: string,
    responseId: string,
    ruleId: string,
    key: Key,
  ) =>
    unwrap(
      await api.POST(`${P}/responses/{responseId}/actions/{ruleId}/retry`, {
        params: { path: { tenantId, formId, responseId, ruleId }, header: hdr(key) },
      }),
    ),
  review: async (
    api: ApiClient,
    tenantId: string,
    formId: string,
    r: S['FormResponse'],
    reviewStatus: 'accepted' | 'rejected',
    key: Key,
  ) =>
    unwrap(
      await api.PATCH(`${P}/responses/{responseId}`, {
        params: {
          path: { tenantId, formId, responseId: r.id },
          header: { ...hdr(key), 'If-Match': etagOf(r.revision) },
        },
        body: { reviewStatus },
      }),
    ),
  exportCsv: async (api: ApiClient, tenantId: string, formId: string) =>
    unwrap(await api.GET(`${P}/export`, { params: { path: { tenantId, formId } } })),
  createKbNode: async (
    api: ApiClient,
    tenantId: string,
    spaceId: string,
    title: string,
    key: Key,
  ) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/knowledge/spaces/{spaceId}/nodes', {
        params: { path: { tenantId, spaceId }, header: hdr(key) },
        body: { parentId: null, kind: 'page', title },
      }),
    ),
  createKbTable: async (
    api: ApiClient,
    tenantId: string,
    nodeId: string,
    body: S['KnowledgeTableCreate'],
    key: Key,
  ) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/knowledge/nodes/{nodeId}/tables', {
        params: { path: { tenantId, nodeId }, header: hdr(key) },
        body,
      }),
    ),
  /**
   * Доступ узла (setKnowledgeNodeAccess): If-Match — ревизия доступа из getKnowledgeNodeAccess (ETag). Нужен
   * «Только владелец» новой страницы: KnowledgeNodeCreate доступа не принимает (Q-W4.23-7).
   */
  setKbAccess: async (
    api: ApiClient,
    tenantId: string,
    nodeId: string,
    body: S['KnowledgeAccessChange'],
    key: Key,
  ) => {
    const path = { tenantId, nodeId };
    const cur = await api.GET('/api/v1/tenants/{tenantId}/knowledge/nodes/{nodeId}/access', {
      params: { path },
    });
    const acc = await unwrap(cur);
    const etag = cur.response.headers.get('ETag') ?? etagOf(acc.revision);
    return unwrap(
      await api.PUT('/api/v1/tenants/{tenantId}/knowledge/nodes/{nodeId}/access', {
        params: { path, header: { ...hdr(key), 'If-Match': etag } },
        body,
      }),
    );
  },
  kbNode: async (api: ApiClient, tenantId: string, nodeId: string) =>
    unwrap(
      await api.GET('/api/v1/tenants/{tenantId}/knowledge/nodes/{nodeId}', {
        params: { path: { tenantId, nodeId } },
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
