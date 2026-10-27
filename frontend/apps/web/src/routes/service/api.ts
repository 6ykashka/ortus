// W7.32 · Запросы и команды страницы «Обращения» (тег Service, контракт 0.12.0-stage7): направления, очередь и счётчики,
// карточка, низкие оценки, шаблоны; команды — звонок, ответ и заметка, компенсация, переходы, исполнитель и приоритет,
// перенос, показ телефона, вывод сотруднику, задача, решение по оценке. Команды с `If-Match` берут ревизию карточки
// (`"rev-N"`); `Idempotency-Key` — один на попытку, пока команда не прошла. После команды перечитывается префикс
// `['tenant', id, 'service']`.
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { keepPreviousData, type QueryClient, useQuery } from '@tanstack/react-query';

import { useApi } from '../../app/api.tsx';
import { etag, type QueueKey } from './model.ts';

type S = components['schemas'];

export const serviceKey = (tenantId: string) => ['tenant', tenantId, 'service'] as const;

const PAGE = 200;

export function useDirections(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...serviceKey(tenantId), 'directions'],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/service/directions', {
          params: { path: { tenantId } },
        }),
      ),
  });
}

export interface QueueQuery {
  directionId: string | undefined;
  queue: QueueKey;
  kind: string;
  channel: string;
  q: string;
}

/** Очередь выбранного направления (или всех видимых): строки по самому раннему сроку и счётчики навигации. */
export function useRequests(tenantId: string, query: QueueQuery, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...serviceKey(tenantId), 'requests', query],
    enabled,
    placeholderData: keepPreviousData,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/service/requests', {
          params: {
            path: { tenantId },
            query: {
              limit: PAGE,
              queue: query.queue,
              ...(query.directionId ? { directionId: query.directionId } : {}),
              ...(query.kind ? { kind: query.kind as 'complaint' } : {}),
              ...(query.channel ? { channel: query.channel as 'sms' } : {}),
              ...(query.q.trim() ? { q: query.q.trim() } : {}),
            },
          },
        }),
      ),
  });
}

/** Открытые обращения всех направлений — числа у направлений в навигации. */
export function useOpenByDirection(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...serviceKey(tenantId), 'open-by-direction'],
    enabled,
    queryFn: async () => {
      const r = await unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/service/requests', {
          params: { path: { tenantId }, query: { limit: PAGE, queue: 'open' } },
        }),
      );
      const by: Record<string, number> = {};
      for (const x of r.items) by[x.directionId] = (by[x.directionId] ?? 0) + 1;
      return by;
    },
  });
}

export function useRatings(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...serviceKey(tenantId), 'ratings'],
    enabled,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/service/ratings', {
            params: { path: { tenantId }, query: { limit: PAGE, status: 'open' } },
          }),
        )
      ).items,
  });
}

export function useRequest(tenantId: string, requestId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: [...serviceKey(tenantId), 'request', requestId],
    enabled: requestId !== null,
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/service/requests/{requestId}', {
          params: { path: { tenantId, requestId: requestId ?? '' } },
        }),
      ),
  });
}

export function useTemplates(tenantId: string, directionId: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: [...serviceKey(tenantId), 'templates', directionId],
    enabled: !!directionId,
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/service/directions/{directionId}/templates', {
            params: { path: { tenantId, directionId: directionId ?? '' } },
          }),
        )
      ).items,
  });
}

/** После команды перечитывается всё «Обращения» организации (очередь, счётчики, карточка). */
export function afterChange(qc: QueryClient, tenantId: string): Promise<void> {
  return qc.invalidateQueries({ queryKey: serviceKey(tenantId) });
}

const idem = (key: string) => ({ 'Idempotency-Key': key });
const cond = (key: string, revision: number) => ({ ...idem(key), 'If-Match': etag(revision) });

export interface Commands {
  createRequest(body: S['ServiceRequestCreate'], key: string): Promise<S['ServiceRequest']>;
  postMessage(
    requestId: string,
    body: S['ServiceMessageCreate'],
    key: string,
  ): Promise<S['ServiceMessage']>;
  setCompensation(
    requestId: string,
    revision: number,
    body: S['ServiceCompensationSet'],
    key: string,
  ): Promise<S['ServiceRequest']>;
  transition(
    requestId: string,
    revision: number,
    body: S['ServiceTransition'],
    key: string,
  ): Promise<S['ServiceRequest']>;
  patch(
    requestId: string,
    revision: number,
    body: S['ServiceRequestPatch'],
    key: string,
  ): Promise<S['ServiceRequest']>;
  move(
    requestId: string,
    revision: number,
    directionId: string,
    key: string,
  ): Promise<S['ServiceRequest']>;
  revealPhone(requestId: string, key: string): Promise<S['ServicePhoneReveal']>;
  shareConclusion(
    requestId: string,
    revision: number,
    text: string,
    key: string,
  ): Promise<S['ServiceRequest']>;
  createTask(requestId: string, title: string, key: string): Promise<S['ServiceTaskRef']>;
  decideRating(
    ratingId: string,
    action: 'seen' | 'complaint',
    key: string,
  ): Promise<S['ServiceRatingDecisionResult']>;
  /** Свежая ревизия карточки перед командой с `If-Match` после изменения. */
  revisionOf(requestId: string): Promise<number>;
}

export function commands(api: ApiClient, tenantId: string): Commands {
  const p = (requestId: string) => ({ tenantId, requestId });
  return {
    async createRequest(body, key) {
      return unwrap(
        await api.POST('/api/v1/tenants/{tenantId}/service/requests', {
          params: { path: { tenantId }, header: idem(key) },
          body,
        }),
      );
    },
    async postMessage(requestId, body, key) {
      return unwrap(
        await api.POST('/api/v1/tenants/{tenantId}/service/requests/{requestId}/messages', {
          params: { path: p(requestId), header: idem(key) },
          body,
        }),
      );
    },
    async setCompensation(requestId, revision, body, key) {
      return unwrap(
        await api.POST('/api/v1/tenants/{tenantId}/service/requests/{requestId}/compensation', {
          params: { path: p(requestId), header: cond(key, revision) },
          body,
        }),
      );
    },
    async transition(requestId, revision, body, key) {
      return unwrap(
        await api.POST('/api/v1/tenants/{tenantId}/service/requests/{requestId}/transitions', {
          params: { path: p(requestId), header: cond(key, revision) },
          body,
        }),
      );
    },
    async patch(requestId, revision, body, key) {
      return unwrap(
        await api.PATCH('/api/v1/tenants/{tenantId}/service/requests/{requestId}', {
          params: { path: p(requestId), header: cond(key, revision) },
          body,
        }),
      );
    },
    async move(requestId, revision, directionId, key) {
      return unwrap(
        await api.POST('/api/v1/tenants/{tenantId}/service/requests/{requestId}/move', {
          params: { path: p(requestId), header: cond(key, revision) },
          body: { directionId },
        }),
      );
    },
    async revealPhone(requestId, key) {
      return unwrap(
        await api.POST(
          '/api/v1/tenants/{tenantId}/service/requests/{requestId}/client-phone/reveal',
          { params: { path: p(requestId), header: idem(key) } },
        ),
      );
    },
    async shareConclusion(requestId, revision, text, key) {
      return unwrap(
        await api.POST('/api/v1/tenants/{tenantId}/service/requests/{requestId}/conclusion', {
          params: { path: p(requestId), header: cond(key, revision) },
          body: { text },
        }),
      );
    },
    async createTask(requestId, title, key) {
      return unwrap(
        await api.POST('/api/v1/tenants/{tenantId}/service/requests/{requestId}/tasks', {
          params: { path: p(requestId), header: idem(key) },
          body: { title },
        }),
      );
    },
    async decideRating(ratingId, action, key) {
      return unwrap(
        await api.POST('/api/v1/tenants/{tenantId}/service/ratings/{ratingId}/decision', {
          params: { path: { tenantId, ratingId }, header: idem(key) },
          body: { action },
        }),
      );
    },
    async revisionOf(requestId) {
      const r = await unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/service/requests/{requestId}', {
          params: { path: p(requestId) },
        }),
      );
      return r.revision;
    },
  };
}
