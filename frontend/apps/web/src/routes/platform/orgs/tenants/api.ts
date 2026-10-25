// W1.25 · Запросы и команды «Организаций» оператора (тег Platform, контракт 0.4.0-stage1): список организаций,
// организация и подписка с ETag (If-Match команд берётся из ответа сервера дословно: MSW — "rev-N", backend —
// "N" у организации и "rev-N" у подписки, Q-W1.48-6), журнал платформы, три команды с причиной.
import { type components, ProblemError, unwrap } from '@ortus/api-client';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef } from 'react';

import { useApi } from '../../../../app/api.tsx';

type S = components['schemas'];

export const PLATFORM_KEY = ['platform'] as const;
const TENANTS_KEY = [...PLATFORM_KEY, 'tenants'] as const;
const AUDIT_KEY = [...PLATFORM_KEY, 'audit'] as const;
const USAGE_KEY = [...PLATFORM_KEY, 'orgs', 'usage'] as const;
const REQUESTS_KEY = [...PLATFORM_KEY, 'orgs', 'pending-requests'] as const;
const tenantKey = (id: string) => [...PLATFORM_KEY, 'tenant', id] as const;
const subscriptionKey = (id: string) => [...PLATFORM_KEY, 'subscription', id] as const;

/** Строк «Журнала действий» на карточке — как эталон (opVM :3566, первые 6). */
export const AUDIT_ROWS = 6;
/** Организаций на странице: предел контракта `limit` (пагинации в эталоне нет). */
const TENANTS_LIMIT = 200;

/** Ресурс и его ETag из ответа (заголовок `ETag`). */
export interface Tagged<T> {
  data: T;
  etag: string;
}

const tagged = async <T>(r: {
  data?: T;
  error?: unknown;
  response: Response;
}): Promise<Tagged<T>> => ({
  data: await unwrap(r),
  etag: r.response.headers.get('ETag') ?? '',
});

export function useTenants() {
  const api = useApi();
  return useQuery({
    queryKey: TENANTS_KEY,
    queryFn: async (): Promise<S['Tenant'][]> =>
      (
        await unwrap(
          await api.GET('/api/v1/platform/tenants', {
            params: { query: { limit: TENANTS_LIMIT } },
          }),
        )
      ).items,
  });
}

/** Организация с ETag — для команд suspend/resume (If-Match организации). */
export function useTenant(id: string | undefined) {
  const api = useApi();
  return useQuery({
    queryKey: tenantKey(id ?? ''),
    enabled: id !== undefined,
    queryFn: async () =>
      tagged(
        await api.GET('/api/v1/platform/tenants/{tenantId}', {
          params: { path: { tenantId: id ?? '' } },
        }),
      ),
  });
}

/** Подписка организации: данные с ETag, загрузка, ошибка и повтор (состояния карточки). */
export interface SubscriptionState {
  data: Tagged<S['Subscription']> | undefined;
  pending: boolean;
  /** Ошибка последней загрузки (`null`, если её нет). */
  error: Error | null;
  refetch: () => void;
}

/**
 * Подписки организаций списка (тариф, лимиты, пробный период) с ETag — If-Match продления. Запрос на
 * организацию: массового чтения подписок в контракте 0.4.0-stage1 нет (Q-W1.25-16).
 */
export function useSubscriptions(ids: readonly string[]): ReadonlyMap<string, SubscriptionState> {
  const api = useApi();
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: subscriptionKey(id),
      queryFn: async () =>
        tagged(
          await api.GET('/api/v1/platform/tenants/{tenantId}/subscription', {
            params: { path: { tenantId: id } },
          }),
        ),
    })),
    combine: (results) =>
      new Map(
        results.map((r, i): [string, SubscriptionState] => [
          ids[i] ?? '',
          {
            data: r.data,
            pending: r.isPending,
            error: r.isError ? r.error : null,
            refetch: () => void r.refetch(),
          },
        ]),
      ),
  });
}

/**
 * W4.84: «Использование» (getPlatformUsage) — владелец, модули, занятое место и участники всех организаций одним
 * запросом (только метаданные control DB); строка по id организации.
 */
export function useUsage() {
  const api = useApi();
  return useQuery({
    queryKey: USAGE_KEY,
    queryFn: async (): Promise<ReadonlyMap<string, S['PlatformUsageTenant']>> => {
      const u = await unwrap(await api.GET('/api/v1/platform/usage'));
      return new Map(u.tenants.map((t) => [t.tenantId, t]));
    },
  });
}

/**
 * W4.84: заявки на тариф на рассмотрении (плашка карточки): одна на организацию, один запрос на страницу.
 * Роль без `platform.billing.read` (поддержка) получает 403 — плашки нет (Q-W4.84-4).
 */
export function usePendingRequests() {
  const api = useApi();
  return useQuery({
    queryKey: REQUESTS_KEY,
    queryFn: async (): Promise<ReadonlyMap<string, S['SubscriptionChangeRequest']>> => {
      const page = await unwrap(
        await api.GET('/api/v1/platform/subscription-requests', {
          params: { query: { status: 'pending', limit: TENANTS_LIMIT } },
        }),
      );
      return new Map(page.items.map((r) => [r.tenantId, r]));
    },
  });
}

/** «Журнал действий»: общий журнал платформы, новые сверху (как эталон — без фильтра организации). */
export function useAudit() {
  const api = useApi();
  return useQuery({
    queryKey: AUDIT_KEY,
    queryFn: async (): Promise<S['PlatformAuditEvent'][]> =>
      (
        await unwrap(
          await api.GET('/api/v1/platform/audit-events', {
            params: { query: { limit: AUDIT_ROWS } },
          }),
        )
      ).items,
  });
}

/** Команды карточки; `quota` — «Квота места» (updatePlatformSubscription, W4.84). */
export type CommandKind = 'extend' | 'suspend' | 'resume' | 'quota';

/** Тело «Квоты места» по причине (model.quotaUpdate): строится один раз на попытку. */
export type QuotaBody = S['PlatformSubscriptionUpdate'];

export interface CommandInput {
  kind: CommandKind;
  tenantId: string;
  reason: string;
  /** ETag организации (suspend, resume) или подписки (extend, quota). */
  etag: string;
  /** Ключ идемпотентности попытки (useCommandSender). */
  idempotencyKey: string;
  /** Тело updatePlatformSubscription (только `quota`). */
  quota?: QuotaBody;
}

/** Дней продления пробного периода — как эталон («на 14 дней», TrialExtension.days). */
export const EXTEND_DAYS = 14;

/** Команды оператора: заголовки Idempotency-Key и If-Match, тело с причиной; после ответа — перечитать всё. */
export function usePlatformCommand(): (c: CommandInput) => Promise<void> {
  const api = useApi();
  const qc = useQueryClient();
  return useCallback(
    async ({
      kind,
      tenantId,
      reason,
      etag,
      idempotencyKey,
      quota,
    }: CommandInput): Promise<void> => {
      const header = { 'Idempotency-Key': idempotencyKey, 'If-Match': etag };
      const path = { tenantId };
      const body = { reason: reason.trim() };
      try {
        if (kind === 'quota') {
          if (!quota) throw new Error('quota: нет тела updatePlatformSubscription');
          await unwrap(
            await api.PUT('/api/v1/platform/tenants/{tenantId}/subscription', {
              params: { header, path },
              body: quota,
            }),
          );
        } else if (kind === 'extend') {
          await unwrap(
            await api.POST('/api/v1/platform/tenants/{tenantId}/trial-extensions', {
              params: { header, path },
              body: { ...body, days: EXTEND_DAYS },
            }),
          );
        } else if (kind === 'suspend') {
          await unwrap(
            await api.POST('/api/v1/platform/tenants/{tenantId}/suspend', {
              params: { header, path },
              body,
            }),
          );
        } else {
          await unwrap(
            await api.POST('/api/v1/platform/tenants/{tenantId}/resume', {
              params: { header, path },
              body,
            }),
          );
        }
      } catch (e) {
        // 409 и 412: показанное состояние устарело — перечитать организацию, подписку и журнал и только потом
        // отдать ошибку: пока перечитывание идёт, диалог занят, и повтор не уйдёт со старым If-Match. Сбой
        // перечитывания не прячет ошибку команды (invalidateQueries не бросает).
        if (e instanceof ProblemError && STALE.has(e.status)) {
          await qc.invalidateQueries({ queryKey: PLATFORM_KEY });
        }
        throw e;
      }
      await qc.invalidateQueries({ queryKey: PLATFORM_KEY });
    },
    [api, qc],
  );
}

const STALE: ReadonlySet<number> = new Set([409, 412]);

/** Попытка команды: ключ идемпотентности, If-Match, причина и тело квоты, с которыми она ушла на сервер. */
interface Attempt {
  key: string;
  etag: string;
  reason: string;
  quota?: QuotaBody;
}

/**
 * Отправка команды из одного диалога. Пока исход попытки неизвестен (нет связи, тайм-аут, 5xx), повтор с той
 * же причиной повторяет запрос дословно — тот же Idempotency-Key и If-Match: если первый запрос дошёл, сервер
 * вернёт сохранённый ответ, а не применит команду дважды. Отказ сервера (4xx: 409, 412, 422, 403) — команда
 * не выполнена: следующая попытка — новый ключ и текущий ETag (`etag` — свежий из перечитанных данных: после
 * 409/412 ошибка приходит только после перечитывания, usePlatformCommand).
 * Изменённая причина — другая команда и новый ключ (повтор старого ключа с другим телом сервер отвергнет).
 */
export function useCommandSender(
  kind: CommandKind,
  tenantId: string,
  /** «Квота места»: тело по причине (на попытку — дословно то же, повтор не меняет запрос). */
  quotaFor?: (reason: string) => QuotaBody,
): (reason: string, etag: string) => Promise<void> {
  const command = usePlatformCommand();
  const attempt = useRef<Attempt | null>(null);
  return useCallback(
    async (reason: string, etag: string): Promise<void> => {
      const text = reason.trim();
      const prev = attempt.current;
      let a: Attempt;
      if (prev && prev.reason === text) a = prev;
      else {
        a = { key: crypto.randomUUID(), etag, reason: text };
        if (quotaFor) a.quota = quotaFor(text);
      }
      attempt.current = a;
      try {
        const input: CommandInput = {
          kind,
          tenantId,
          reason: a.reason,
          etag: a.etag,
          idempotencyKey: a.key,
        };
        if (a.quota) input.quota = a.quota;
        await command(input);
        attempt.current = null;
      } catch (e) {
        if (e instanceof ProblemError && e.status >= 400 && e.status < 500) attempt.current = null;
        throw e;
      }
    },
    [command, kind, tenantId, quotaFor],
  );
}
