// W4.12 · Запросы «Задач и проектов» (контракт W4.03, тег Tasks; MSW `adapter/src/msw/tasks/`, backend — W4.11):
// проекты (listTaskProjects, getTaskProject, createTaskProject, initTaskProjectWorkflow), процесс (getTaskWorkflow —
// колонки доски), участники (listTaskProjectMembers — исполнители), задачи (listTasks с фильтрами, getTask с ETag) и
// команды карточки (If-Match — ETag последнего ответа по задаче, Idempotency-Key на каждую команду).
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';

type S = components['schemas'];

export const tasksKey = (tenantId: string) => ['tenant', tenantId, 'tasks'] as const;

/** Предел страницы контракта (`Limit`). */
const LIMIT = 200;
/** Страниц на один список. */
const PAGES = 20;

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

/** Все страницы списка по курсору. */
async function all<T>(
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

const code = (e: unknown): string | undefined => (e instanceof ProblemError ? e.code : undefined);

/**
 * Проекты участника (listTaskProjects). Прорабу (задачи только в области «своё») сервер отвечает 403 — экран
 * показывает пустой список «Проектов, доступных вам, пока нет» (Q-W4.03-8).
 */
export function useProjects(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...tasksKey(tenantId), 'projects'],
    queryFn: async (): Promise<S['Project'][]> => {
      try {
        return await all(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/projects', {
              params: {
                path: { tenantId },
                query: { limit: LIMIT, ...(cursor ? { cursor } : {}) },
              },
            }),
          ),
        );
      } catch (e) {
        if (code(e) === 'forbidden_action') return [];
        throw e;
      }
    },
  });
}

/**
 * Шапка проекта (getTaskProject) с ETag: 404 — проекта нет или нет доступа (TP-03). Ключ и вид данных
 * (`{ data, etag }`) — общие с вкладками W4.13 (`settings/api.ts` projectKey): правка доступа в «Участниках»
 * обновляет шапку.
 */
export function useProject(tenantId: string, projectId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...tasksKey(tenantId), 'project', projectId ?? ''],
    enabled: !!projectId,
    retry: false,
    queryFn: async (): Promise<{ data: S['Project']; etag: string }> => {
      const r = await api.GET('/api/v1/tenants/{tenantId}/projects/{projectId}', {
        params: { path: { tenantId, projectId: projectId ?? '' } },
      });
      const data = await unwrap(r);
      return { data, etag: r.response.headers.get('ETag') ?? `"rev-${data.revision}"` };
    },
  });
}

/** Опубликованная версия процесса — колонки доски (getTaskWorkflow); проекта без процесса нет — null. */
export function useWorkflow(tenantId: string, projectId: string | undefined, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...tasksKey(tenantId), 'workflow', projectId],
    enabled: enabled && !!projectId,
    queryFn: async (): Promise<S['TaskWorkflow'] | null> => {
      try {
        return unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/projects/{projectId}/workflow', {
            params: { path: { tenantId, projectId: projectId ?? '' } },
          }),
        );
      } catch (e) {
        if (code(e) === 'not_found') return null;
        throw e;
      }
    },
  });
}

/** Участники проекта — исполнители (видят проект, активные). */
export function useMembers(tenantId: string, projectId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...tasksKey(tenantId), 'members', projectId],
    enabled: !!projectId,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/projects/{projectId}/members', {
          params: { path: { tenantId, projectId: projectId ?? '' } },
        }),
      ),
  });
}

export type BoardFilter = 'all' | 'mine' | 'approval';

export interface TaskQuery {
  projectId?: string;
  filter?: BoardFilter;
  parentTaskId?: string;
}

/** Параметры listTasks фильтра доски (`assignee=me`, `awaitingMyApproval`). */
function queryOf(q: TaskQuery) {
  return {
    ...(q.projectId ? { projectId: q.projectId } : {}),
    ...(q.parentTaskId ? { parentTaskId: q.parentTaskId } : {}),
    ...(q.filter === 'mine' ? { assignee: 'me' as const } : {}),
    ...(q.filter === 'approval' ? { awaitingMyApproval: true } : {}),
  };
}

/** Задачи (listTasks): доска проекта с фильтром, подзадачи, все видимые (кандидаты «Входит в»). */
export function useTasks(tenantId: string, q: TaskQuery, enabled = true) {
  const api = useApi();
  return useQuery<S['Task'][]>({
    queryKey: [
      ...tasksKey(tenantId),
      'list',
      q.projectId ?? '',
      q.filter ?? 'all',
      q.parentTaskId ?? '',
    ],
    enabled,
    queryFn: async () =>
      (await all(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/tasks', {
            params: {
              path: { tenantId },
              query: { limit: LIMIT, ...queryOf(q), ...(cursor ? { cursor } : {}) },
            },
          }),
        ),
      )) as unknown as S['Task'][],
  });
}

/** Задача и её ETag (If-Match команд). */
export interface TaskWithTag {
  task: S['Task'];
  etag: string;
}

/** Ответ клиента — схема Task контракта (openapi-fetch иначе выводит FieldEntry со своим вариантом null). */
const asTask = (x: unknown): S['Task'] => x as S['Task'];

const tagOf = (r: { response: Response }, t: S['Task']): string =>
  r.response.headers.get('ETag') ?? `"rev-${t.revision}"`;

/** Задача по id с ETag ответа. */
export async function fetchTask(
  api: ApiClient,
  tenantId: string,
  taskId: string,
): Promise<TaskWithTag> {
  const r = await api.GET('/api/v1/tenants/{tenantId}/tasks/{taskId}', {
    params: { path: { tenantId, taskId } },
  });
  const task = asTask(await unwrap(r));
  return { task, etag: tagOf(r, task) };
}

/** Карточка задачи (getTask): 404 — задачи нет или нет доступа (Q-W4.10-3). */
export function useTask(tenantId: string, taskId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...tasksKey(tenantId), 'task', taskId],
    enabled: !!taskId,
    retry: false,
    queryFn: () => fetchTask(api, tenantId, taskId ?? ''),
  });
}

/** История задачи (listTaskHistory), новые сверху; карточка показывает 12 последних. */
export function useHistory(tenantId: string, taskId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...tasksKey(tenantId), 'history', taskId],
    enabled: !!taskId,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/tasks/{taskId}/history', {
            params: { path: { tenantId, taskId: taskId ?? '' }, query: { limit: 12 } },
          }),
        )
      ).items,
  });
}

// ── Команды ──

export async function createProject(
  api: ApiClient,
  tenantId: string,
  body: S['ProjectCreate'],
): Promise<S['Project']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/projects', {
      params: { path: { tenantId }, header: idem() },
      body,
    }),
  );
}

export async function initWorkflow(
  api: ApiClient,
  tenantId: string,
  projectId: string,
): Promise<S['TaskWorkflow']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/projects/{projectId}/workflow/init', {
      params: { path: { tenantId, projectId }, header: idem() },
    }),
  );
}

export async function createTask(
  api: ApiClient,
  tenantId: string,
  body: S['TaskCreate'],
): Promise<TaskWithTag> {
  const r = await api.POST('/api/v1/tenants/{tenantId}/tasks', {
    params: { path: { tenantId }, header: idem() },
    body: body as never,
  });
  const task = asTask(await unwrap(r));
  return { task, etag: tagOf(r, task) };
}

/** Команда над задачей с If-Match: ответ — задача и её новый ETag. */
type TaskCommand = (
  path: { tenantId: string; taskId: string },
  header: { 'Idempotency-Key': string; 'If-Match': string },
) => Promise<{ data?: unknown; error?: unknown; response: Response }>;

async function command(tenantId: string, t: TaskWithTag, fn: TaskCommand): Promise<TaskWithTag> {
  const r = await fn({ tenantId, taskId: t.task.id }, { ...idem(), 'If-Match': t.etag });
  const task = asTask(await unwrap(r));
  return { task, etag: tagOf(r, task) };
}

export const updateTask = (
  api: ApiClient,
  tenantId: string,
  t: TaskWithTag,
  body: S['TaskPatch'],
) =>
  command(tenantId, t, (path, header) =>
    api.PATCH('/api/v1/tenants/{tenantId}/tasks/{taskId}', {
      params: { path, header },
      body: body as never,
    }),
  );

export const transitionTask = (
  api: ApiClient,
  tenantId: string,
  t: TaskWithTag,
  body: S['TaskTransition'],
) =>
  command(tenantId, t, (path, header) =>
    api.POST('/api/v1/tenants/{tenantId}/tasks/{taskId}/transitions', {
      params: { path, header },
      body,
    }),
  );

export const rejectApproval = (
  api: ApiClient,
  tenantId: string,
  t: TaskWithTag,
  transitionKey: string,
  comment: string,
) =>
  command(tenantId, t, (path, header) =>
    api.POST('/api/v1/tenants/{tenantId}/tasks/{taskId}/approvals/{transitionKey}/reject', {
      params: { path: { ...path, transitionKey }, header },
      body: { comment },
    }),
  );

export const setChecklistItem = (
  api: ApiClient,
  tenantId: string,
  t: TaskWithTag,
  checklistItemId: string,
  done: boolean,
) =>
  command(tenantId, t, (path, header) =>
    api.PATCH('/api/v1/tenants/{tenantId}/tasks/{taskId}/checklist/{checklistItemId}', {
      params: { path: { ...path, checklistItemId }, header },
      body: { done },
    }),
  );

export const setParent = (
  api: ApiClient,
  tenantId: string,
  t: TaskWithTag,
  parentTaskId: string | null,
) =>
  command(tenantId, t, (path, header) =>
    api.PUT('/api/v1/tenants/{tenantId}/tasks/{taskId}/parent', {
      params: { path, header },
      body: { parentTaskId },
    }),
  );

export const attachFiles = (api: ApiClient, tenantId: string, t: TaskWithTag, fileIds: string[]) =>
  command(tenantId, t, (path, header) =>
    api.POST('/api/v1/tenants/{tenantId}/tasks/{taskId}/files', {
      params: { path, header },
      body: { fileIds },
    }),
  );

export const removeFile = (api: ApiClient, tenantId: string, t: TaskWithTag, fileId: string) =>
  command(tenantId, t, (path, header) =>
    api.DELETE('/api/v1/tenants/{tenantId}/tasks/{taskId}/files/{fileId}', {
      params: { path: { ...path, fileId }, header },
    }),
  );

export async function commentTask(
  api: ApiClient,
  tenantId: string,
  taskId: string,
  text: string,
): Promise<S['TaskHistoryEntry']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/tasks/{taskId}/comments', {
      params: { path: { tenantId, taskId }, header: idem() },
      body: { text },
    }),
  );
}
