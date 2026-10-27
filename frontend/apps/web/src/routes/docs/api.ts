// W7.25 · Запросы страницы «Документы» (контракт 0.12.0-stage7, тег Docs; backend — W7.23a/b, пока MSW): список с
// отборами и счётчиками (listDocuments), папки и шаблоны, карточка с ETag, сессия движка, версии, обсуждение, журнал,
// доступ и внешние ссылки, задания, сотрудники для «Упомянуть» и «Поделиться». Команды: Idempotency-Key на тело,
// If-Match по свежему ETag (updateDocument, setDocShares) — чужая правка мимо экрана даёт 412 без отправки команды.
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../app/api.tsx';
import { stripFileMetadata } from '../core/files/upload/metadata.ts';
import { type PutObject, putObject } from '../core/files/upload/upload.tsx';

type S = components['schemas'];

export const docsKey = (tenantId: string) => ['tenant', tenantId, 'docs'] as const;

const LIMIT = 200;
const PAGES = 20;

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

/** Ключи идемпотентности (соглашение W2.23): то же тело — тот же ключ до определённого ответа, другое — новый. */
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

const stale = (): ProblemError =>
  new ProblemError(412, {
    type: 'about:blank',
    title: 'Precondition Failed',
    status: 412,
    code: 'revision_mismatch',
    requestId: '',
  });

// ───────────────────────────── чтение ─────────────────────────────

export interface DocList {
  items: S['DocSummary'][];
  counts: S['DocumentList']['counts'];
}

export interface ListQuery {
  q: string;
  filter: 'all' | 'mine' | 'shared' | 'route' | 'archive';
  folderId: string;
}

export function useDocList(tenantId: string, q: ListQuery) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'list', q.q, q.filter, q.folderId],
    retry: false,
    queryFn: async (): Promise<DocList> => {
      const items: S['DocSummary'][] = [];
      let counts: DocList['counts'] = { all: 0, mine: 0, shared: 0, route: 0 };
      let cursor: string | undefined;
      for (let i = 0; i < PAGES; i++) {
        const p = await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/docs', {
            params: {
              path: { tenantId },
              query: {
                limit: LIMIT,
                filter: q.filter,
                ...(q.q ? { q: q.q } : {}),
                ...(q.folderId ? { folderId: q.folderId } : {}),
                ...(cursor ? { cursor } : {}),
              },
            },
          }),
        );
        items.push(...p.items);
        if (i === 0) counts = p.counts;
        if (!p.nextCursor) break;
        cursor = p.nextCursor;
      }
      return { items, counts };
    },
  });
}

export function useFolders(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'folders'],
    retry: false,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/doc-folders', {
            params: { path: { tenantId } },
          }),
        )
      ).items,
  });
}

export function useTemplates(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'templates'],
    enabled,
    retry: false,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/doc-templates', {
            params: { path: { tenantId } },
          }),
        )
      ).items,
  });
}

export interface DocWithTag {
  doc: S['Document'];
  etag: string;
}

export function useDocument(tenantId: string, id: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'doc', id],
    retry: false,
    queryFn: async (): Promise<DocWithTag> => {
      const r = await api.GET('/api/v1/tenants/{tenantId}/docs/{documentId}', {
        params: { path: { tenantId, documentId: id } },
      });
      const doc = await unwrap(r);
      return { doc, etag: r.response.headers.get('ETag') ?? '' };
    },
  });
}

export function useSession(tenantId: string, id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'session', id],
    enabled,
    retry: false,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/docs/{documentId}/open', {
          params: { path: { tenantId, documentId: id }, query: { mode: 'view' } },
        }),
      ),
  });
}

export function useVersions(tenantId: string, id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'doc', id, 'versions'],
    enabled,
    retry: false,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/docs/{documentId}/versions', {
            params: { path: { tenantId, documentId: id } },
          }),
        )
      ).items,
  });
}

export function useComments(tenantId: string, id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'doc', id, 'comments'],
    enabled,
    retry: false,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/docs/{documentId}/comments', {
            params: { path: { tenantId, documentId: id } },
          }),
        )
      ).items,
  });
}

/** Журнал документа — последние 10 записей; скрыт у ознакомляемого (одна версия): сервер отвечает 403. */
export function useActivity(tenantId: string, id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'doc', id, 'activity'],
    enabled,
    retry: false,
    queryFn: async () => {
      try {
        return (
          await unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/docs/{documentId}/activity', {
              params: { path: { tenantId, documentId: id }, query: { limit: 10 } },
            }),
          )
        ).items;
      } catch (e) {
        if (e instanceof ProblemError && (e.status === 403 || e.status === 404)) return [];
        throw e;
      }
    },
  });
}

export interface Shares {
  shares: S['DocShares'];
  etag: string;
}

export function useShares(tenantId: string, id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'doc', id, 'shares'],
    enabled,
    retry: false,
    queryFn: async (): Promise<Shares> => {
      const r = await api.GET('/api/v1/tenants/{tenantId}/docs/{documentId}/shares', {
        params: { path: { tenantId, documentId: id } },
      });
      return { shares: await unwrap(r), etag: r.response.headers.get('ETag') ?? '' };
    },
  });
}

export function useLinks(tenantId: string, id: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'doc', id, 'links'],
    enabled,
    retry: false,
    queryFn: async () => {
      try {
        return (
          await unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/docs/{documentId}/links', {
              params: { path: { tenantId, documentId: id } },
            }),
          )
        ).items;
      } catch (e) {
        if (e instanceof ProblemError && e.status === 403) return [];
        throw e;
      }
    },
  });
}

async function every<T>(
  page: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor?: string | null }>,
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

/** Сотрудники (получатели доступа и упоминаний); без права — пусто. */
export function useMembers(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'members'],
    enabled,
    retry: false,
    queryFn: async (): Promise<S['Member'][]> => {
      try {
        return await every(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/members', {
              params: {
                path: { tenantId },
                query: { limit: LIMIT, ...(cursor ? { cursor } : {}) },
              },
            }),
          ),
        );
      } catch (e) {
        if (e instanceof ProblemError && (e.status === 403 || e.status === 404)) return [];
        throw e;
      }
    },
  });
}

export function useRoles(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'roles'],
    enabled,
    retry: false,
    queryFn: async (): Promise<S['Role'][]> => {
      try {
        return await every(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/roles', {
              params: {
                path: { tenantId },
                query: { limit: LIMIT, ...(cursor ? { cursor } : {}) },
              },
            }),
          ),
        );
      } catch (e) {
        if (e instanceof ProblemError && (e.status === 403 || e.status === 404)) return [];
        throw e;
      }
    },
  });
}

export function useGroups(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'groups'],
    enabled,
    retry: false,
    queryFn: async (): Promise<S['Group'][]> => {
      try {
        return await every(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/groups', {
              params: {
                path: { tenantId },
                query: { limit: LIMIT, ...(cursor ? { cursor } : {}) },
              },
            }),
          ),
        );
      } catch (e) {
        if (e instanceof ProblemError && (e.status === 403 || e.status === 404)) return [];
        throw e;
      }
    },
  });
}

export interface LinkOption {
  id: string;
  label: string;
  ref: S['ObjectRef'];
}

/** Записи для полей шаблона: объекты ремонта и рейсы (Q-W7.25-4: без права — пусто, шаблон не выбирается). */
export function useLinkOptions(tenantId: string, kind: 'object' | 'trip' | null) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'link-options', kind ?? ''],
    enabled: kind !== null,
    retry: false,
    queryFn: async (): Promise<LinkOption[]> => {
      try {
        if (kind === 'object') {
          const r = await unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/repairs/projects', {
              params: { path: { tenantId } },
            }),
          );
          return r.items.map((x) => {
            const p =
              'project' in x
                ? (x.project as S['RepairProject'])
                : (x as unknown as S['RepairProject']);
            return {
              id: p.id,
              label: [p.name, p.address].filter(Boolean).join(' · '),
              ref: { moduleKey: 'repairs', entityType: 'project', entityId: p.id },
            };
          });
        }
        const r = await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/fleet/trips', {
            params: { path: { tenantId } },
          }),
        );
        return r.items.map((t) => ({
          id: t.id,
          label: `Рейс от ${t.startedAt.slice(8, 10)}.${t.startedAt.slice(5, 7)}`,
          ref: { moduleKey: 'fleet', entityType: 'trip', entityId: t.id },
        }));
      } catch (e) {
        if (e instanceof ProblemError && (e.status === 403 || e.status === 404)) return [];
        throw e;
      }
    },
  });
}

export function useJob(tenantId: string, id: string | null, running: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...docsKey(tenantId), 'job', id ?? ''],
    enabled: id !== null,
    retry: false,
    refetchInterval: running ? 450 : false,
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/doc-jobs/{jobId}', {
          params: { path: { tenantId, jobId: id ?? '' } },
        }),
      ),
  });
}

// ───────────────────────────── команды ─────────────────────────────

/** Свежий документ и его ETag; чужая правка мимо экрана — 412 без отправки команды. */
async function freshDoc(
  api: ApiClient,
  tenantId: string,
  seen: { id: string; revision: number },
): Promise<string> {
  const cur = await api.GET('/api/v1/tenants/{tenantId}/docs/{documentId}', {
    params: { path: { tenantId, documentId: seen.id } },
  });
  const fresh = await unwrap(cur);
  if (fresh.revision !== seen.revision) throw stale();
  const etag = cur.response.headers.get('ETag');
  if (!etag) throw new ProblemError(428);
  return etag;
}

export const commands = {
  createDoc: async (api: ApiClient, tenantId: string, body: S['DocCreate'], key: string) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/docs', {
        params: { path: { tenantId }, header: { 'Idempotency-Key': key } },
        body,
      }),
    ),

  renameDoc: async (
    api: ApiClient,
    tenantId: string,
    seen: { id: string; revision: number },
    body: S['DocPatch'],
    key: string,
  ) => {
    const etag = await freshDoc(api, tenantId, seen);
    return unwrap(
      await api.PATCH('/api/v1/tenants/{tenantId}/docs/{documentId}', {
        params: {
          path: { tenantId, documentId: seen.id },
          header: { 'Idempotency-Key': key, 'If-Match': etag },
        },
        body,
      }),
    );
  },

  moveDoc: async (api: ApiClient, tenantId: string, id: string, body: S['DocMove'], key: string) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/move', {
        params: { path: { tenantId, documentId: id }, header: { 'Idempotency-Key': key } },
        body,
      }),
    ),

  archive: async (api: ApiClient, tenantId: string, id: string) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/archive', {
        params: { path: { tenantId, documentId: id }, header: idem() },
      }),
    ),

  unarchive: async (api: ApiClient, tenantId: string, id: string) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/restore', {
        params: { path: { tenantId, documentId: id }, header: idem() },
      }),
    ),

  saveVersion: async (api: ApiClient, tenantId: string, id: string, name: string | undefined) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/versions', {
        params: { path: { tenantId, documentId: id }, header: idem() },
        body: name ? { name } : {},
      }),
    ),

  nameVersion: async (
    api: ApiClient,
    tenantId: string,
    id: string,
    version: number,
    name: string,
  ) =>
    unwrap(
      await api.PUT('/api/v1/tenants/{tenantId}/docs/{documentId}/versions/{version}/name', {
        params: { path: { tenantId, documentId: id, version }, header: idem() },
        body: { name },
      }),
    ),

  restoreVersion: async (api: ApiClient, tenantId: string, id: string, version: number) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/versions/{version}/restore', {
        params: { path: { tenantId, documentId: id, version }, header: idem() },
      }),
    ),

  comment: async (api: ApiClient, tenantId: string, id: string, body: S['DocCommentCreate']) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/comments', {
        params: { path: { tenantId, documentId: id }, header: idem() },
        body,
      }),
    ),

  reply: async (
    api: ApiClient,
    tenantId: string,
    id: string,
    commentId: string,
    body: S['DocReplyCreate'],
  ) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/comments/{commentId}/replies', {
        params: { path: { tenantId, documentId: id, commentId }, header: idem() },
        body,
      }),
    ),

  resolve: async (api: ApiClient, tenantId: string, id: string, commentId: string) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/comments/{commentId}/resolve', {
        params: { path: { tenantId, documentId: id, commentId }, header: idem() },
      }),
    ),

  skipGrant: async (api: ApiClient, tenantId: string, id: string, commentId: string) =>
    unwrap(
      await api.POST(
        '/api/v1/tenants/{tenantId}/docs/{documentId}/comments/{commentId}/skip-grant',
        {
          params: { path: { tenantId, documentId: id, commentId }, header: idem() },
        },
      ),
    ),

  grant: async (api: ApiClient, tenantId: string, id: string, body: S['DocGrantCreate']) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/grants', {
        params: { path: { tenantId, documentId: id }, header: idem() },
        body,
      }),
    ),

  setShares: async (
    api: ApiClient,
    tenantId: string,
    id: string,
    etag: string,
    body: S['DocSharesSet'],
    key: string,
  ) =>
    unwrap(
      await api.PUT('/api/v1/tenants/{tenantId}/docs/{documentId}/shares', {
        params: {
          path: { tenantId, documentId: id },
          header: { 'Idempotency-Key': key, 'If-Match': etag },
        },
        body,
      }),
    ),

  createLink: async (
    api: ApiClient,
    tenantId: string,
    id: string,
    body: S['DocExternalLinkCreate'],
  ) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/links', {
        params: { path: { tenantId, documentId: id }, header: idem() },
        body,
      }),
    ),

  revokeLink: async (api: ApiClient, tenantId: string, id: string, linkId: string) =>
    unwrap(
      await api.DELETE('/api/v1/tenants/{tenantId}/docs/{documentId}/links/{linkId}', {
        params: { path: { tenantId, documentId: id, linkId }, header: idem() },
      }),
    ),

  syncDataset: async (api: ApiClient, tenantId: string, id: string) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/dataset-sync', {
        params: { path: { tenantId, documentId: id }, header: idem() },
        body: {},
      }),
    ),

  createJob: async (api: ApiClient, tenantId: string, body: S['DocJobCreate'], key: string) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/doc-jobs', {
        params: { path: { tenantId }, header: { 'Idempotency-Key': key } },
        body,
      }),
    ),

  retryJob: async (api: ApiClient, tenantId: string, jobId: string, body: S['DocJobRetry']) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/doc-jobs/{jobId}/retry', {
        params: { path: { tenantId, jobId }, header: idem() },
        body,
      }),
    ),

  reviewWord: async (
    api: ApiClient,
    tenantId: string,
    id: string,
    wordId: string,
    body: S['DocOcrWordReview'],
  ) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/docs/{documentId}/ocr/words/{wordId}', {
        params: { path: { tenantId, documentId: id, wordId }, header: idem() },
        body,
      }),
    ),

  createFolder: async (api: ApiClient, tenantId: string, body: S['DocFolderCreate'], key: string) =>
    unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/doc-folders', {
        params: { path: { tenantId }, header: { 'Idempotency-Key': key } },
        body,
      }),
    ),
};

// ───────────────────────────── загрузка файла ─────────────────────────────

async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Файл документа: initiateUpload (`purpose: document`, владелец — папка) → PUT по билету → completeUpload; id файла. */
export async function uploadDocFile(
  api: ApiClient,
  tenantId: string,
  folderId: string,
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
        purpose: 'document',
        owner: { moduleKey: 'docs', entityType: 'folder', entityId: folderId },
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
