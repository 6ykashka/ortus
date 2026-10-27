// W6.23 · Запросы и команды страницы «График» (контракт 0.12.0-stage6, тег Repairs): getSchedule с ETag (ревизия
// графика), previewScheduleChange, applyScheduleChange и setScheduleStageExecutor (If-Match ревизии, на которую
// смотрит пользователь: устаревшая — 412, страница перечитывает), createScheduleFromEstimate, createScheduleBaseline.
// Объект (getRepairProject) — для крошки и имени заказчика, участники (listMembers) — исполнители этапа.
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { type QueryClient, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../../app/api.tsx';

type S = components['schemas'];

export const repairKey = (tenantId: string, projectId: string) =>
  ['tenant', tenantId, 'repairs', 'project', projectId] as const;
export const scheduleKey = (tenantId: string, projectId: string) =>
  [...repairKey(tenantId, projectId), 'schedule'] as const;

/** График и ETag, с которым он прочитан (If-Match следующей команды). */
export interface ScheduleData {
  schedule: S['Schedule'];
  etag: string | null;
}

const path = (tenantId: string, projectId: string) => ({ tenantId, projectId });

export function useSchedule(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: scheduleKey(tenantId, projectId),
    retry: false,
    queryFn: async (): Promise<ScheduleData> => {
      const r = await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/schedule', {
        params: { path: path(tenantId, projectId) },
      });
      const schedule = await unwrap(r);
      return { schedule, etag: r.response.headers.get('ETag') };
    },
  });
}

export function useProject(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairKey(tenantId, projectId), 'card'],
    retry: false,
    queryFn: async (): Promise<S['RepairProject']> =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}', {
          params: { path: path(tenantId, projectId) },
        }),
      ),
  });
}

/** Участники для выбора исполнителя; без права или при сбое — пусто (выбор из текущего исполнителя). */
export function useAssignees(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'members', 'schedule-executors'],
    enabled,
    retry: false,
    queryFn: async (): Promise<S['Member'][]> => {
      try {
        const out: S['Member'][] = [];
        let cursor: string | undefined;
        for (let i = 0; i < 20; i++) {
          const p = await unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/members', {
              params: { path: { tenantId }, query: { limit: 200, ...(cursor ? { cursor } : {}) } },
            }),
          );
          out.push(...p.items);
          if (!p.nextCursor) break;
          cursor = p.nextCursor;
        }
        return out.filter((m) => m.status === 'active');
      } catch {
        return [];
      }
    },
  });
}

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });
/** Команды с If-Match: без ETag уходит пустой — сервер ответит 428/412, страница перечитает график. */
const guarded = (etag: string | null) => ({ ...idem(), 'If-Match': etag ?? '' });

/** Предпросмотр переноса: последствия на сервере без записи. */
export async function previewChange(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  changes: S['ScheduleStageChange'][],
): Promise<S['SchedulePreview']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/schedule/preview', {
      params: { path: path(tenantId, projectId), header: idem() },
      body: { changes },
    }),
  );
}

/** Сохранить перенос с причиной; ответ — новый график и его ETag. */
export async function applyChange(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  data: ScheduleData,
  body: S['ScheduleChangeApply'],
): Promise<ScheduleData> {
  const r = await api.POST(
    '/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/schedule/changes',
    {
      params: { path: path(tenantId, projectId), header: guarded(data.etag) },
      body,
    },
  );
  const schedule = await unwrap(r);
  return { schedule, etag: r.response.headers.get('ETag') };
}

/** Исполнитель этапа без причины (Q-W4.00-repair-20). Возвращает перечитывание графика: ответ — только этап. */
export async function setExecutor(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  data: ScheduleData,
  stageId: string,
  body: S['StageExecutorSet'],
): Promise<S['ScheduleStage']> {
  return unwrap(
    await api.PATCH(
      '/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/schedule/stages/{stageId}',
      {
        params: { path: { ...path(tenantId, projectId), stageId }, header: guarded(data.etag) },
        body,
      },
    ),
  );
}

/** Версия сметы для графика: последняя согласованная; без права на сметы или без согласованной — первая. */
async function estimateVersion(
  api: ApiClient,
  tenantId: string,
  projectId: string,
): Promise<number> {
  try {
    const list = await unwrap(
      await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/estimates', {
        params: { path: path(tenantId, projectId) },
      }),
    );
    const approved = list.items.filter((e) => e.state === 'approved').map((e) => e.version);
    return approved.length ? Math.max(...approved) : 1;
  } catch {
    return 1;
  }
}

export async function buildFromEstimate(
  api: ApiClient,
  tenantId: string,
  projectId: string,
): Promise<ScheduleData> {
  const version = await estimateVersion(api, tenantId, projectId);
  const r = await api.POST(
    '/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/schedule/from-estimate',
    {
      params: { path: path(tenantId, projectId), header: idem() },
      body: { estimateVersion: version },
    },
  );
  const schedule = await unwrap(r);
  return { schedule, etag: r.response.headers.get('ETag') };
}

export async function fixBaseline(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  data: ScheduleData,
  agreementNo: number,
): Promise<ScheduleData> {
  const r = await api.POST(
    '/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/schedule/baselines',
    {
      params: { path: path(tenantId, projectId), header: guarded(data.etag) },
      body: { agreementNo },
    },
  );
  const schedule = await unwrap(r);
  return { schedule, etag: r.response.headers.get('ETag') };
}

/** Перечитать график и карточку объекта (после чужого изменения или 412). */
export const refreshSchedule = (qc: QueryClient, tenantId: string, projectId: string) =>
  qc.invalidateQueries({ queryKey: repairKey(tenantId, projectId) });

export const isStale = (e: unknown): boolean => e instanceof ProblemError && e.status === 412;
