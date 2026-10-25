// W1.23 · Данные «Пользователей и ролей» (TanStack Query над openapi-fetch, контракт 0.4.0-stage1): списки
// тега Access целиком (курсор, limit 200), подписка (места), владельцы. Ключи — под префиксом
// `['tenant', id, 'access']`: команда перечитывает только изменённые списки (`useRefresh` с частями), «Повторить» —
// весь префикс. Команды — `idem()` с Idempotency-Key;
// правка с ревизией берёт ETag свежим GET (форма ETag у MSW `"rev-N"`, у Go-модуля доступа `"N"`).
import { ProblemError, unwrap } from '@ortus/api-client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';

import { useApi } from '../../../app/api.tsx';
import { ME_CONTEXT_KEY } from '../../../shell/me.ts';

export const accessKey = (tenantId: string) => ['tenant', tenantId, 'access'] as const;

interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Все страницы списка (курсор контракта; лимит страницы 200 — максимум контракта). */
export async function fetchAll<T>(
  get: (query: { limit: number; cursor?: string }) => Promise<Page<T>>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 50; i++) {
    const page = await get(cursor ? { limit: 200, cursor } : { limit: 200 });
    out.push(...page.items);
    if (!page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return out;
}

/** Списки страницы: люди, роли, назначения, группы, подразделения, владельцы, подписка. */
export function useAccessData(tenantId: string) {
  const api = useApi();
  const key = accessKey(tenantId);
  const path = { tenantId };
  const members = useQuery({
    queryKey: [...key, 'members'],
    queryFn: () =>
      fetchAll(async (query) =>
        unwrap(await api.GET('/api/v1/tenants/{tenantId}/members', { params: { path, query } })),
      ),
  });
  const roles = useQuery({
    queryKey: [...key, 'roles'],
    queryFn: () =>
      fetchAll(async (query) =>
        unwrap(await api.GET('/api/v1/tenants/{tenantId}/roles', { params: { path, query } })),
      ),
  });
  const assignments = useQuery({
    queryKey: [...key, 'assignments'],
    queryFn: () =>
      fetchAll(async (query) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/assignments', { params: { path, query } }),
        ),
      ),
  });
  const groups = useQuery({
    queryKey: [...key, 'groups'],
    queryFn: () =>
      fetchAll(async (query) =>
        unwrap(await api.GET('/api/v1/tenants/{tenantId}/groups', { params: { path, query } })),
      ),
  });
  const units = useQuery({
    queryKey: [...key, 'units'],
    queryFn: () =>
      fetchAll(async (query) =>
        unwrap(await api.GET('/api/v1/tenants/{tenantId}/org-units', { params: { path, query } })),
      ),
  });
  // Имена проектов для области «проект» назначений (W4.85): не основной запрос страницы — нет права на проекты
  // задач (403) или сбой дают подпись «Проект» без имени, а не ошибку страницы.
  const projects = useQuery({
    queryKey: [...key, 'projects'],
    queryFn: async () => {
      try {
        return await fetchAll(async (query) =>
          unwrap(await api.GET('/api/v1/tenants/{tenantId}/projects', { params: { path, query } })),
        );
      } catch (e) {
        if (isForbidden(e)) return [];
        throw e;
      }
    },
    retry: false,
  });
  const owners = useQuery({
    queryKey: [...key, 'owners'],
    queryFn: async () =>
      unwrap(await api.GET('/api/v1/tenants/{tenantId}/owners', { params: { path } })),
  });
  // Места — право seats подписки (billing.read у владельца); без права лимит не показывается.
  const subscription = useQuery({
    queryKey: [...key, 'subscription'],
    queryFn: async () =>
      unwrap(await api.GET('/api/v1/tenants/{tenantId}/subscription', { params: { path } })),
  });
  return { members, roles, assignments, groups, units, projects, owners, subscription };
}

export type AccessData = ReturnType<typeof useAccessData>;

/**
 * Отказ по праву (403 `forbidden_action`): у участника нет права на этот список во всей нужной области —
 * раздел недоступен, это не сбой загрузки (бриф §1: участник с `members.read` без `roles.read` на организацию).
 */
export const isForbidden = (e: unknown): boolean =>
  e instanceof ProblemError && e.status === 403 && e.code === 'forbidden_action';

/** Запрос завершился отказом по праву. */
export const noRight = (q: { isError: boolean; error: unknown }): boolean =>
  q.isError && isForbidden(q.error);

/** Ответ без тела (204): успех или ProblemError (unwrap ждёт тело и на 204 падает). */
export async function ensureOk(r: { error?: unknown; response: Response }): Promise<void> {
  if (r.response.ok) return;
  await unwrap({ ...r, data: undefined });
}

/** Заголовок Idempotency-Key команды (контракт W0.08). */
export const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

/**
 * Что перечитать после команды: списки страницы, ответы explainAccess «Проверки доступа» (`explain`; неактивные
 * запросы только помечаются устаревшими) и /me/context (`me`: роли, назначения и группы меняют права, в том числе
 * свои).
 */
export type RefreshPart = keyof AccessData | 'explain' | 'me';

export type Refresh = (parts?: readonly RefreshPart[]) => Promise<void>;

/**
 * Перечитать данные страницы: без `parts` — всё (кнопка «Повторить»), с `parts` — только то, что команда могла
 * изменить (возврат 16.10 №2: «Сохранить роль» не перечитывает людей, группы, подразделения и подписку).
 */
export function useRefresh(tenantId: string): Refresh {
  const qc = useQueryClient();
  return useCallback(
    async (parts) => {
      if (!parts) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: accessKey(tenantId) }),
          qc.invalidateQueries({ queryKey: ME_CONTEXT_KEY }),
        ]);
        return;
      }
      await Promise.all(
        parts.map((p) =>
          qc.invalidateQueries({
            queryKey: p === 'me' ? ME_CONTEXT_KEY : [...accessKey(tenantId), p],
          }),
        ),
      );
    },
    [qc, tenantId],
  );
}

/** Ревизия объекта изменилась после загрузки страницы — тот же отказ, что у сервера (412). */
export const staleRevision = (): ProblemError =>
  new ProblemError(412, {
    type: 'about:blank',
    title: 'Revision mismatch',
    status: 412,
    code: 'revision_mismatch',
    requestId: '',
  });

/**
 * ETag ревизии, которую видел пользователь (свежий GET): если на сервере ревизия уже другая — отказ
 * `revision_mismatch` без записи (правка поверх чужой не делается).
 */
export async function etagOf(
  r: { data?: { revision: number }; error?: unknown; response: Response },
  seen: number,
): Promise<string> {
  const body = await unwrap(r);
  const tag = r.response.headers.get('ETag');
  if (body.revision !== seen || !tag) throw staleRevision();
  return tag;
}
