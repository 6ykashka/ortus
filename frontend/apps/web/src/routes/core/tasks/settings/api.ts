// W4.13 · Запросы вкладок проекта (контракт 0.9.0-stage4, тег Tasks; W4.03, backend — W4.11): проект и его ETag
// (getTaskProject, updateTaskProject), участники (listTaskProjectMembers, setTaskProjectMemberRole,
// removeTaskProjectMember, checkTaskProjectAccess), сотрудники организации (listMembers — у кого members.read),
// процесс (getTaskWorkflow, saveTaskWorkflowDraft, discardTaskWorkflowDraft, publishTaskWorkflow), автоматизация
// (listTaskAutomations, createTaskAutomation, updateTaskAutomation, deleteTaskAutomation, listTaskAutomationRuns).
// If-Match — ETag последнего ответа сервера дословно (MSW — "rev-N"); у правила, у которого GET нет, — `"rev-<revision>"`
// строки списка (как категории расходов, Q-W2.41-1). Idempotency-Key — один на тело команды до ответа сервера.
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { type QueryClient, type QueryKey, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../../app/api.tsx';
import { tasksKey } from '../api.ts';
import type { TaskAction } from './model.ts';

type S = components['schemas'];

// Префикс ключей модуля — у хоста W4.12 (`../api.ts`): его список, шапка, процесс и задачи доски лежат под ним.
export { tasksKey };
/** Проект с ETag — ключ общий с шапкой хоста W4.12 (`../api.ts` useProject). */
export const projectKey = (tenantId: string, projectId: string) =>
  [...tasksKey(tenantId), 'project', projectId] as const;

const sameKey = (a: QueryKey, b: QueryKey): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * После команды вкладки — данные хоста W4.12 (список проектов, шапка, процесс и задачи доски смонтированы всё время,
 * у каждого свой ключ под tasksKey) и вкладок. Сначала проект: нет доступа (404/403 — «Закрытый» у владельца без
 * роли, Q-W4.10-4/6) — запросы этого проекта (ключ с его id) не перечитываются, хост уводит в список, а список
 * перечитывается. `keep` — ключи, которые команда уже положила в кэш своим ответом.
 */
export async function refreshAfter(
  qc: QueryClient,
  tenantId: string,
  projectId: string,
  keep: readonly QueryKey[] = [],
): Promise<void> {
  const pk = projectKey(tenantId, projectId);
  await qc.invalidateQueries({ queryKey: pk, exact: true });
  const lost = qc.getQueryState(pk)?.status === 'error';
  await qc.invalidateQueries({
    queryKey: tasksKey(tenantId),
    predicate: (q) =>
      !sameKey(q.queryKey, pk) &&
      !keep.some((k) => sameKey(q.queryKey, k)) &&
      !(lost && q.queryKey.includes(projectId)),
  });
}

const LIMIT = 200;
const PAGES = 20;

/** Все страницы списка по курсору. */
export async function all<T>(
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

/** Ответ с ETag: If-Match следующей команды берётся из него дословно. */
export interface Tagged<T> {
  data: T;
  etag: string;
}

const tagOf = (r: { response: Response }, revision: number | undefined): string =>
  r.response.headers.get('ETag') ?? `"rev-${String(revision ?? 0)}"`;

async function tagged<T extends { revision?: number }>(
  r: Promise<{ data?: T; error?: unknown; response: Response }>,
): Promise<Tagged<T>> {
  const res = await r;
  const data = await unwrap(res as never);
  return { data: data as T, etag: tagOf(res, (data as T).revision) };
}

/** Ключи идемпотентности (соглашение W2.23): то же тело — тот же ключ до определённого ответа сервера. */
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

const path = (tenantId: string, projectId: string) => ({ tenantId, projectId });

/** Ответ без тела (204): ошибка — ProblemError, как у unwrap. */
export async function ensureOk(r: { error?: unknown; response: Response }): Promise<void> {
  if (r.response.ok) return;
  await unwrap({ ...r, data: undefined });
}

// ── Чтение ──

export function useProject(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: projectKey(tenantId, projectId),
    queryFn: () =>
      tagged(
        api.GET('/api/v1/tenants/{tenantId}/projects/{projectId}', {
          params: { path: path(tenantId, projectId) },
        }),
      ),
  });
}

export function useMembers(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...projectKey(tenantId, projectId), 'members'],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/projects/{projectId}/members', {
          params: { path: path(tenantId, projectId) },
        }),
      ),
  });
}

/** Сотрудники организации (кандидаты «Сотрудник»): только у кого members.read; иначе null. */
export function usePeople(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...tasksKey(tenantId), 'people'],
    enabled,
    retry: false,
    queryFn: () =>
      all(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/members', {
            params: { path: { tenantId }, query: { limit: LIMIT, ...(cursor ? { cursor } : {}) } },
          }),
        ),
      ),
  });
}

export function useAccessCheck(
  tenantId: string,
  projectId: string,
  memberId: string | undefined,
  action: TaskAction,
  enabled: boolean,
) {
  const api = useApi();
  return useQuery({
    queryKey: [...projectKey(tenantId, projectId), 'check', memberId, action],
    enabled: enabled && !!memberId,
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/projects/{projectId}/members/{memberId}/access', {
          params: {
            path: { ...path(tenantId, projectId), memberId: memberId ?? '' },
            query: { action },
          },
        }),
      ),
  });
}

export const workflowKey = (tenantId: string, projectId: string) =>
  [...projectKey(tenantId, projectId), 'workflow'] as const;

export function useWorkflow(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: workflowKey(tenantId, projectId),
    queryFn: () =>
      tagged(
        api.GET('/api/v1/tenants/{tenantId}/projects/{projectId}/workflow', {
          params: { path: path(tenantId, projectId) },
        }),
      ),
  });
}

export const automationsKey = (tenantId: string, projectId: string) =>
  [...projectKey(tenantId, projectId), 'automations'] as const;

export function useAutomations(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: automationsKey(tenantId, projectId),
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/projects/{projectId}/automations', {
            params: { path: path(tenantId, projectId) },
          }),
        )
      ).items,
  });
}

export function useRuns(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...projectKey(tenantId, projectId), 'runs'],
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/projects/{projectId}/automation-runs', {
            params: { path: path(tenantId, projectId) },
          }),
        )
      ).items,
  });
}

// ── Команды ──

export function setAccess(
  api: ApiClient,
  tenantId: string,
  project: Tagged<S['Project']>,
  access: S['TaskProjectAccessLevel'],
  key: string,
): Promise<Tagged<S['Project']>> {
  return tagged(
    api.PATCH('/api/v1/tenants/{tenantId}/projects/{projectId}', {
      params: {
        path: path(tenantId, project.data.id),
        header: { 'Idempotency-Key': key, 'If-Match': project.etag },
      },
      body: { access },
    }),
  );
}

export async function setRole(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  memberId: string,
  roleId: string,
  key: string,
): Promise<S['TaskProjectMember']> {
  return unwrap(
    await api.PUT('/api/v1/tenants/{tenantId}/projects/{projectId}/members/{memberId}', {
      params: {
        path: { ...path(tenantId, projectId), memberId },
        header: { 'Idempotency-Key': key },
      },
      body: { roleId },
    }),
  );
}

export async function removeMember(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  memberId: string,
  key: string,
): Promise<void> {
  await ensureOk(
    await api.DELETE('/api/v1/tenants/{tenantId}/projects/{projectId}/members/{memberId}', {
      params: {
        path: { ...path(tenantId, projectId), memberId },
        header: { 'Idempotency-Key': key },
      },
    }),
  );
}

export function saveDraft(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  etag: string,
  draft: S['TaskWorkflowDraftInput'],
  key: string,
): Promise<Tagged<S['TaskWorkflow']>> {
  return tagged(
    api.PUT('/api/v1/tenants/{tenantId}/projects/{projectId}/workflow/draft', {
      params: {
        path: path(tenantId, projectId),
        header: { 'Idempotency-Key': key, 'If-Match': etag },
      },
      body: draft,
    }),
  );
}

export function discardDraft(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  etag: string,
  key: string,
): Promise<Tagged<S['TaskWorkflow']>> {
  return tagged(
    api.DELETE('/api/v1/tenants/{tenantId}/projects/{projectId}/workflow/draft', {
      params: {
        path: path(tenantId, projectId),
        header: { 'Idempotency-Key': key, 'If-Match': etag },
      },
    }),
  );
}

export function publishDraft(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  etag: string,
  key: string,
): Promise<Tagged<S['TaskWorkflow']>> {
  return tagged(
    api.POST('/api/v1/tenants/{tenantId}/projects/{projectId}/workflow/draft/publish', {
      params: {
        path: path(tenantId, projectId),
        header: { 'Idempotency-Key': key, 'If-Match': etag },
      },
    }),
  );
}

export async function createRule(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  body: S['TaskAutomationCreate'],
  key: string,
): Promise<S['TaskAutomation']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/projects/{projectId}/automations', {
      params: { path: path(tenantId, projectId), header: { 'Idempotency-Key': key } },
      body,
    }),
  );
}

/** If-Match правила: GET правила в контракте нет — ревизия строки списка (`"rev-<revision>"`). */
export const ruleTag = (r: S['TaskAutomation']): string => `"rev-${String(r.revision)}"`;

export async function updateRule(
  api: ApiClient,
  tenantId: string,
  rule: S['TaskAutomation'],
  patch: S['TaskAutomationPatch'],
  key: string,
): Promise<S['TaskAutomation']> {
  return unwrap(
    await api.PATCH('/api/v1/tenants/{tenantId}/projects/{projectId}/automations/{automationId}', {
      params: {
        path: { ...path(tenantId, rule.projectId), automationId: rule.id },
        header: { 'Idempotency-Key': key, 'If-Match': ruleTag(rule) },
      },
      body: patch,
    }),
  );
}

export async function deleteRule(
  api: ApiClient,
  tenantId: string,
  rule: S['TaskAutomation'],
  key: string,
): Promise<void> {
  await ensureOk(
    await api.DELETE('/api/v1/tenants/{tenantId}/projects/{projectId}/automations/{automationId}', {
      params: {
        path: { ...path(tenantId, rule.projectId), automationId: rule.id },
        header: { 'Idempotency-Key': key, 'If-Match': ruleTag(rule) },
      },
    }),
  );
}
