// W4.13 · Запросы старой доски «Заявки» (контракт 0.9.0-stage4, тег Tasks; W4.03, backend — W4.11): воронки —
// проекты `flow: leads` из listTaskProjects (403 прорабу — пустой список, Q-W4.03-8), этапы — getTaskWorkflow
// (`fixed`), заявки — listTasks (`projectId`, «Мои задачи» — `assignee=me`), карточка — getTask (ETag) и
// listTaskHistory, команды — transitionTask, updateTaskChecklistItem (If-Match — ETag карточки), commentTask, createTask.
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { all, tasksKey } from '../tasks/settings/api.ts';

type S = components['schemas'];

export const leadsKey = (tenantId: string) => [...tasksKey(tenantId), 'leads'] as const;

/** Проекты организации; нет права на список (403) — пусто, как «Проектов, доступных вам, пока нет». */
export function useProjects(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...leadsKey(tenantId), 'projects'],
    queryFn: async (): Promise<S['Project'][]> => {
      try {
        return await all(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/projects', {
              params: { path: { tenantId }, query: { limit: 200, ...(cursor ? { cursor } : {}) } },
            }),
          ),
        );
      } catch (e) {
        if (e instanceof ProblemError && e.code === 'forbidden_action') return [];
        throw e;
      }
    },
  });
}

export function useStages(tenantId: string, projectId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...leadsKey(tenantId), 'stages', projectId],
    enabled: !!projectId,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/projects/{projectId}/workflow', {
          params: { path: { tenantId, projectId: projectId ?? '' } },
        }),
      ),
  });
}

export function useLeads(tenantId: string, projectId: string | undefined, mine: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...leadsKey(tenantId), 'tasks', projectId, mine],
    enabled: !!projectId,
    queryFn: () =>
      all(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/tasks', {
            params: {
              path: { tenantId },
              query: {
                projectId: projectId ?? '',
                limit: 200,
                ...(mine ? { assignee: 'me' as const } : {}),
                ...(cursor ? { cursor } : {}),
              },
            },
          }),
        ),
      ),
  });
}

/** Исполнители формы «Задача»: участники воронки (без водителей — как эталон, :4469). */
export function useAssignees(tenantId: string, projectId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...leadsKey(tenantId), 'members', projectId],
    enabled: !!projectId,
    retry: false,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/projects/{projectId}/members', {
            params: { path: { tenantId, projectId: projectId ?? '' } },
          }),
        )
      ).items,
  });
}

export function useLead(tenantId: string, taskId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...leadsKey(tenantId), 'task', taskId],
    enabled: !!taskId,
    queryFn: async () => {
      const r = await api.GET('/api/v1/tenants/{tenantId}/tasks/{taskId}', {
        params: { path: { tenantId, taskId: taskId ?? '' } },
      });
      const data = await unwrap(r);
      return { data, etag: r.response.headers.get('ETag') ?? `"rev-${String(data.revision)}"` };
    },
  });
}

/** Новая заявка (форма «Задача»; customFields и relatedObjects форма не задаёт). */
export type LeadCreate = Omit<S['TaskCreate'], 'customFields' | 'relatedObjects'>;

/** Карточка заявки с ETag (If-Match команд). */
export interface LeadTask {
  data: { id: string; revision: number };
  etag: string;
}

export function useHistory(tenantId: string, taskId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...leadsKey(tenantId), 'history', taskId],
    enabled: !!taskId,
    queryFn: () =>
      all(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/tasks/{taskId}/history', {
            params: {
              path: { tenantId, taskId: taskId ?? '' },
              query: { limit: 200, ...(cursor ? { cursor } : {}) },
            },
          }),
        ),
      ),
  });
}

export async function moveLead(
  api: ApiClient,
  tenantId: string,
  task: LeadTask,
  transitionKey: string,
  key: string,
) {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/tasks/{taskId}/transitions', {
      params: {
        path: { tenantId, taskId: task.data.id },
        header: { 'Idempotency-Key': key, 'If-Match': task.etag },
      },
      body: { transitionKey },
    }),
  );
}

export async function checkItem(
  api: ApiClient,
  tenantId: string,
  task: LeadTask,
  itemId: string,
  done: boolean,
  key: string,
) {
  return unwrap(
    await api.PATCH('/api/v1/tenants/{tenantId}/tasks/{taskId}/checklist/{checklistItemId}', {
      params: {
        path: { tenantId, taskId: task.data.id, checklistItemId: itemId },
        header: { 'Idempotency-Key': key, 'If-Match': task.etag },
      },
      body: { done },
    }),
  );
}

export async function comment(
  api: ApiClient,
  tenantId: string,
  taskId: string,
  text: string,
  key: string,
): Promise<S['TaskHistoryEntry']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/tasks/{taskId}/comments', {
      params: { path: { tenantId, taskId }, header: { 'Idempotency-Key': key } },
      body: { text },
    }),
  );
}

export async function createLead(api: ApiClient, tenantId: string, body: LeadCreate, key: string) {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/tasks', {
      params: { path: { tenantId }, header: { 'Idempotency-Key': key } },
      body,
    }),
  );
}

/** Срок из поля даты «ГГГГ-ММ-ДД» — конец этого дня по Москве (полночь следующего), как сид (Р-17). */
export function dueAtOf(date: string): string | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return undefined;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + 1, -3);
  return new Date(ms).toISOString().replace('.000Z', 'Z');
}
