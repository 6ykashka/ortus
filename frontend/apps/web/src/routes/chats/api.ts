// W7.13 · Запросы и команды страницы «Чаты» (контракт 0.12.0-stage7, тег Chats; backend — W7.11, пока MSW W7.00).
// Чтение: список, чат, сообщения, состав, источники, хранение, журнал, политики. Команды идут с `Idempotency-Key`
// (один ключ на одно намерение пользователя), правка чата и состава — с `If-Match` по свежему ETag.
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../app/api.tsx';
import { stripFileMetadata } from '../core/files/upload/metadata.ts';
import { type PutObject, putObject } from '../core/files/upload/upload.tsx';
import type { Folder } from './model.ts';

type S = components['schemas'];

export const chatKey = (tenantId: string) => ['tenant', tenantId, 'chat'] as const;
const LIMIT = 200;
const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

/** Запрет по праву или отсутствие данных — не ошибка страницы. */
async function orNull<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ProblemError && (e.status === 403 || e.status === 404)) return null;
    throw e;
  }
}

export function useChats(tenantId: string, folder: Folder, q: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...chatKey(tenantId), 'list', folder, q],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/chats', {
          params: {
            path: { tenantId },
            query: { limit: LIMIT, ...(folder !== 'all' ? { folder } : {}), ...(q ? { q } : {}) },
          },
        }),
      ),
  });
}

export function useChat(tenantId: string, chatId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: [...chatKey(tenantId), 'one', chatId],
    enabled: chatId !== null,
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/chats/{chatId}', {
          params: { path: { tenantId, chatId: chatId ?? '' } },
        }),
      ),
  });
}

export function useMessages(tenantId: string, chatId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: [...chatKey(tenantId), 'messages', chatId],
    enabled: chatId !== null,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/chats/{chatId}/messages', {
          params: { path: { tenantId, chatId: chatId ?? '' }, query: { limit: LIMIT } },
        }),
      ),
  });
}

export function useMembers(tenantId: string, chatId: string | null, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...chatKey(tenantId), 'members', chatId],
    enabled: enabled && chatId !== null,
    retry: false,
    queryFn: () =>
      orNull(async () =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/chats/{chatId}/members', {
            params: { path: { tenantId, chatId: chatId ?? '' } },
          }),
        ),
      ),
  });
}

export function useSources(tenantId: string, chatId: string | null, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...chatKey(tenantId), 'sources', chatId],
    enabled: enabled && chatId !== null,
    retry: false,
    queryFn: async () => {
      const r = await api.GET('/api/v1/tenants/{tenantId}/chats/{chatId}/sources', {
        params: { path: { tenantId, chatId: chatId ?? '' } },
      });
      const body = await orNull(async () => unwrap(r));
      return body ? { ...body, etag: r.response.headers.get('ETag') } : null;
    },
  });
}

export function useStorage(tenantId: string, chatId: string | null, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...chatKey(tenantId), 'storage', chatId],
    enabled: enabled && chatId !== null,
    retry: false,
    queryFn: () =>
      orNull(async () =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/chats/{chatId}/storage', {
            params: { path: { tenantId, chatId: chatId ?? '' } },
          }),
        ),
      ),
  });
}

export function useJournal(tenantId: string, chatId: string | null, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...chatKey(tenantId), 'journal', chatId],
    enabled: enabled && chatId !== null,
    retry: false,
    queryFn: () =>
      orNull(async () =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/chats/{chatId}/journal', {
            params: { path: { tenantId, chatId: chatId ?? '' }, query: { limit: 6 } },
          }),
        ),
      ),
  });
}

export function useVersions(tenantId: string, chatId: string, messageId: string | null) {
  const api = useApi();
  return useQuery({
    queryKey: [...chatKey(tenantId), 'versions', chatId, messageId],
    enabled: messageId !== null,
    retry: false,
    queryFn: () =>
      orNull(async () =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}/versions', {
            params: { path: { tenantId, chatId, messageId: messageId ?? '' } },
          }),
        ),
      ),
  });
}

export function useReceipts(
  tenantId: string,
  chatId: string,
  messageId: string | null,
  on: boolean,
) {
  const api = useApi();
  return useQuery({
    queryKey: [...chatKey(tenantId), 'receipts', chatId, messageId],
    enabled: on && messageId !== null,
    retry: false,
    queryFn: () =>
      orNull(async () =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}/receipts', {
            params: { path: { tenantId, chatId, messageId: messageId ?? '' } },
          }),
        ),
      ),
  });
}

export function usePolicies(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...chatKey(tenantId), 'policies'],
    enabled,
    retry: false,
    queryFn: () =>
      orNull(async () =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/chat-policies', {
            params: { path: { tenantId } },
          }),
        ),
      ),
  });
}

/** Справочники для названий и выбора источников: подразделения, сотрудники, группы, роли (нет права — пусто). */
/** Какие справочники читать: каждый запрос привязан к праву (org_units.read, members.read, roles.read) - без права не уходит. */
export interface DirectoryAccess {
  units: boolean;
  members: boolean;
  roles: boolean;
}

export function useDirectory(tenantId: string, access: DirectoryAccess) {
  const api = useApi();
  const gate = <T>(on: boolean, fn: () => Promise<T>): Promise<T | null> =>
    on ? orNull(fn) : Promise.resolve(null);
  return useQuery({
    queryKey: ['tenant', tenantId, 'chat-directory', access.units, access.members, access.roles],
    enabled: access.units || access.members || access.roles,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const [units, members, groups, roles] = await Promise.all([
        gate(access.units, async () =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/org-units', {
              params: { path: { tenantId }, query: { limit: LIMIT } },
            }),
          ),
        ),
        gate(access.members, async () =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/members', {
              params: { path: { tenantId }, query: { limit: LIMIT } },
            }),
          ),
        ),
        gate(access.members, async () =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/groups', {
              params: { path: { tenantId }, query: { limit: LIMIT } },
            }),
          ),
        ),
        gate(access.roles, async () =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/roles', {
              params: { path: { tenantId }, query: { limit: LIMIT } },
            }),
          ),
        ),
      ]);
      return {
        units: units?.items ?? [],
        members: members?.items ?? [],
        groups: groups?.items ?? [],
        roles: roles?.items ?? [],
      };
    },
  });
}

/** Документы для карточки в сообщении; нет модуля или права — пусто. */
export function useDocuments(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'chat-docs'],
    enabled,
    retry: false,
    queryFn: async () =>
      (
        await orNull(async () =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/docs', {
              params: { path: { tenantId }, query: { limit: 6 } },
            }),
          ),
        )
      )?.items ?? [],
  });
}

// ──────────────────────────────── команды ────────────────────────────────

type Ctx = { api: ApiClient; tenantId: string; chatId: string };
const at = (c: Ctx) => ({ tenantId: c.tenantId, chatId: c.chatId });

export const postMessage = async (c: Ctx, body: S['ChatMessageCreate'], key: string) =>
  unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/chats/{chatId}/messages', {
      params: { path: at(c), header: { 'Idempotency-Key': key } },
      body,
    }),
  );

export const editMessage = async (c: Ctx, messageId: string, text: string) =>
  unwrap(
    await c.api.PATCH('/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}', {
      params: { path: { ...at(c), messageId }, header: idem() },
      body: { text },
    }),
  );

export const deleteMessage = async (c: Ctx, messageId: string, reason: string | null) =>
  unwrap(
    await c.api.DELETE('/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}', {
      params: {
        path: { ...at(c), messageId },
        query: { for: 'all', ...(reason ? { reason } : {}) },
        header: idem(),
      },
    }),
  );

export const markRead = async (c: Ctx, uptoSeq: number) =>
  unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/chats/{chatId}/read', {
      params: { path: at(c), header: idem() },
      body: { uptoSeq },
    }),
  );

export const ackMessage = async (c: Ctx, messageId: string) =>
  unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}/ack', {
      params: { path: { ...at(c), messageId }, header: idem() },
    }),
  );

export const revealPdn = async (c: Ctx, messageId: string) =>
  unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}/pdn-reveal', {
      params: { path: { ...at(c), messageId }, header: idem() },
    }),
  );

export const votePoll = async (c: Ctx, pollId: string, optionIds: string[]) =>
  unwrap(
    await c.api.PUT('/api/v1/tenants/{tenantId}/chats/{chatId}/polls/{pollId}/vote', {
      params: { path: { ...at(c), pollId }, header: idem() },
      body: { optionIds },
    }),
  );

export const closePoll = async (c: Ctx, pollId: string) =>
  unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/chats/{chatId}/polls/{pollId}/close', {
      params: { path: { ...at(c), pollId }, header: idem() },
    }),
  );

export const pin = async (c: Ctx, messageId: string | null) =>
  messageId
    ? unwrap(
        await c.api.PUT('/api/v1/tenants/{tenantId}/chats/{chatId}/pin', {
          params: { path: at(c), header: idem() },
          body: { messageId },
        }),
      )
    : unwrap(
        await c.api.DELETE('/api/v1/tenants/{tenantId}/chats/{chatId}/pin', {
          params: { path: at(c), header: idem() },
        }),
      );

export const openOnce = async (c: Ctx, attachmentId: string) =>
  unwrap(
    await c.api.POST(
      '/api/v1/tenants/{tenantId}/chats/{chatId}/attachments/{attachmentId}/view-once',
      { params: { path: { ...at(c), attachmentId }, header: idem() } },
    ),
  );

export const saveToRecord = async (c: Ctx, messageId: string) =>
  unwrap(
    await c.api.POST(
      '/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}/save-to-record',
      {
        params: { path: { ...at(c), messageId }, header: idem() },
        body: {},
      },
    ),
  );

export const createTask = async (c: Ctx, messageId: string, title: string) =>
  unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/chats/{chatId}/messages/{messageId}/task', {
      params: { path: { ...at(c), messageId }, header: idem() },
      body: { title },
    }),
  );

export const createChat = async (
  api: ApiClient,
  tenantId: string,
  body: S['ChatCreate'],
  key: string,
) =>
  unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/chats', {
      params: { path: { tenantId }, header: { 'Idempotency-Key': key } },
      body,
    }),
  );

export const createDirect = async (api: ApiClient, tenantId: string, memberId: string) =>
  unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/chats/direct', {
      params: { path: { tenantId }, header: idem() },
      body: { memberId },
    }),
  );

export async function replaceSources(
  c: Ctx,
  body: S['ChatSourcesReplace'],
  etag: string | null,
): Promise<S['ChatSourcesResult']> {
  const cur = await c.api.GET('/api/v1/tenants/{tenantId}/chats/{chatId}/sources', {
    params: { path: at(c) },
  });
  await unwrap(cur);
  const tag = etag ?? cur.response.headers.get('ETag');
  if (!tag) throw new ProblemError(428);
  return unwrap(
    await c.api.PUT('/api/v1/tenants/{tenantId}/chats/{chatId}/sources', {
      params: { path: at(c), header: { ...idem(), 'If-Match': tag } },
      body,
    }),
  );
}

export async function patchChat(c: Ctx, body: S['ChatPatch']): Promise<S['Chat']> {
  const cur = await c.api.GET('/api/v1/tenants/{tenantId}/chats/{chatId}', {
    params: { path: at(c) },
  });
  await unwrap(cur);
  const tag = cur.response.headers.get('ETag');
  if (!tag) throw new ProblemError(428);
  return unwrap(
    await c.api.PATCH('/api/v1/tenants/{tenantId}/chats/{chatId}', {
      params: { path: at(c), header: { ...idem(), 'If-Match': tag } },
      body,
    }),
  );
}

export const cleanup = async (c: Ctx, body: S['ChatCleanupCreate']) =>
  unwrap(
    await c.api.POST('/api/v1/tenants/{tenantId}/chats/{chatId}/cleanups', {
      params: { path: at(c), header: idem() },
      body,
    }),
  );

export async function updatePolicy(
  api: ApiClient,
  tenantId: string,
  row: S['ChatKindPolicy'],
  patch: S['ChatPolicyPatch'],
  dryRun: boolean,
): Promise<S['ChatPolicyUpdateResult']> {
  return unwrap(
    await api.PUT('/api/v1/tenants/{tenantId}/chat-policies/{kind}', {
      params: {
        path: { tenantId, kind: row.kind },
        header: { ...idem(), 'If-Match': `"${row.revision}"` },
      },
      body: { patch, dryRun },
    }),
  );
}

/** SHA-256 содержимого в hex (UploadCreate.sha256). */
async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Вложение чата: `purpose: chat_attachment`, владелец — чат; возвращает id файла для `fileIds`. */
export async function uploadAttachment(
  api: ApiClient,
  tenantId: string,
  chatId: string,
  file: File,
  put: PutObject = putObject,
): Promise<string> {
  const body = await stripFileMetadata(file);
  const sum = await sha256(body);
  const ticket = await unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/files/uploads', {
      params: { path: { tenantId }, header: idem() },
      body: {
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: body.size,
        sha256: sum,
        purpose: 'chat_attachment',
        owner: { moduleKey: 'chat', entityType: 'chat', entityId: chatId },
      },
    }),
  );
  try {
    await put(ticket.uploadUrl, body, ticket.requiredContentType);
    await unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/files/uploads/{uploadId}/complete', {
        params: { path: { tenantId, uploadId: ticket.uploadId }, header: idem() },
        body: { sha256: sum },
      }),
    );
  } catch (e) {
    await api
      .DELETE('/api/v1/tenants/{tenantId}/files/uploads/{uploadId}', {
        params: { path: { tenantId, uploadId: ticket.uploadId }, header: idem() },
      })
      .catch(() => undefined);
    throw e;
  }
  return ticket.fileId;
}
