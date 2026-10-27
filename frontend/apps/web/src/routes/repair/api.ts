// W6.20 · Запросы и команды страницы «Объекты» (контракт 0.12.0-stage6, тег Repairs): список объектов, обзор 1a с
// объёмами, отметки и допработы объекта, остатки на объекте (материалы отметки), кандидаты в прорабы; команды —
// назначение прораба, отметка прораба, приёмка, допработа и фото (`repair_evidence`). Ключи — под
// `['tenant', id, 'repair']`: любая команда перечитывает всё сразу (список, обзор и ленты живут на одних данных).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { type QueryClient, useQuery } from '@tanstack/react-query';

import { useApi } from '../../app/api.tsx';
import { stripFileMetadata } from '../core/files/upload/metadata.ts';
import { type PutObject, putObject } from '../core/files/upload/upload.tsx';

type S = components['schemas'];

const PAGE = 200;
const MAX_PAGES = 20;

export const repairKey = (tenantId: string) => ['tenant', tenantId, 'repair'] as const;

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

async function allPages<T>(
  load: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor: string | null }>,
): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const p = await load(cursor);
    out.push(...p.items);
    if (!p.nextCursor) break;
    cursor = p.nextCursor;
  }
  return out;
}

const pageQuery = (cursor: string | undefined) => ({
  limit: PAGE,
  ...(cursor ? { cursor } : {}),
});

/** Объекты, видимые участнику (прораб — только свои; сводка и «Требует решения» уже в строке). */
export function useProjects(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairKey(tenantId), 'projects'],
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/projects', {
            params: { path: { tenantId }, query: pageQuery(cursor) },
          }),
        ),
      ),
  });
}

/** Обзор 1a: шапка объекта, решения, объёмы, фото, люди, деньги (с правом), лента. */
export function useOverview(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairKey(tenantId), 'overview', projectId],
    queryFn: async () =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/overview', {
          params: { path: { tenantId, projectId } },
        }),
      ),
  });
}

/** Отметки объекта: номер, объёмы, бригада, фото, статус. */
export function useWorkLogs(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairKey(tenantId), 'logs', projectId],
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/work-logs', {
            params: { path: { tenantId }, query: { ...pageQuery(cursor), projectId } },
          }),
        ),
      ),
  });
}

export function useChangeOrders(tenantId: string, projectId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairKey(tenantId), 'changes', projectId],
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/change-orders', {
            params: { path: { tenantId, projectId } },
          }),
        )
      ).items,
  });
}

/**
 * Остатки на объекте — материалы формы отметки. Чтение требует `repairs.supply.manage`: без права (или при сбое)
 * список пуст и форма даёт только «Без материалов» (Q-W6.20-3).
 */
export function useProjectStock(tenantId: string, projectId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: [...repairKey(tenantId), 'stock', projectId],
    enabled,
    queryFn: async (): Promise<S['ProjectStockItem'][]> => {
      try {
        const r = await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/repairs/project-stock', {
            params: { path: { tenantId } },
          }),
        );
        return r.items.filter((s) => s.projectId === projectId);
      } catch {
        return [];
      }
    },
  });
}

/** Участники: имена прорабов списка и кандидаты в прорабы; без `members.read` или при сбое — пусто. */
export function useMembers(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'members', 'repair'],
    enabled,
    queryFn: async (): Promise<S['Member'][]> => {
      try {
        return await allPages(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/members', {
              params: { path: { tenantId }, query: pageQuery(cursor) },
            }),
          ),
        );
      } catch {
        return [];
      }
    },
  });
}

const SUBMIT = 'repairs.work_logs.submit';

/**
 * Кандидаты в прорабы: активные участники с рабочим профилем «прораб» или с ролью, в которой есть право отмечать
 * работы (как эталон: роль с действием `repair.create`). Роли и назначения читаются с правами владельца; без них
 * (403) остаются только участники с профилем. Группы не раскрываются (Q-W6.20-4).
 */
export function useForemanCandidates(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'repair-foremen'],
    enabled,
    queryFn: async (): Promise<S['Member'][]> => {
      const soft = async <T>(load: () => Promise<T[]>): Promise<T[]> => {
        try {
          return await load();
        } catch {
          return [];
        }
      };
      const [members, roles, assignments] = await Promise.all([
        soft(() =>
          allPages(async (cursor) =>
            unwrap(
              await api.GET('/api/v1/tenants/{tenantId}/members', {
                params: { path: { tenantId }, query: pageQuery(cursor) },
              }),
            ),
          ),
        ),
        soft(() =>
          allPages(async (cursor) =>
            unwrap(
              await api.GET('/api/v1/tenants/{tenantId}/roles', {
                params: { path: { tenantId }, query: pageQuery(cursor) },
              }),
            ),
          ),
        ),
        soft(() =>
          allPages(async (cursor) =>
            unwrap(
              await api.GET('/api/v1/tenants/{tenantId}/assignments', {
                params: { path: { tenantId }, query: pageQuery(cursor) },
              }),
            ),
          ),
        ),
      ]);
      return foremanCandidates(members, roles, assignments);
    },
  });
}

/** Чистый отбор кандидатов (проверяется отдельно от запросов). */
export function foremanCandidates(
  members: readonly S['Member'][],
  roles: readonly S['Role'][] = [],
  assignments: readonly S['Assignment'][] = [],
): S['Member'][] {
  // Роль офиса и владельца (всё сразу) прорабской не считается: у неё есть финансы или ведение объектов.
  const foremanRole = (r: S['Role']): boolean =>
    r.permissions.includes(SUBMIT) &&
    !r.permissions.includes('repairs.finance.read') &&
    !r.permissions.includes('repairs.projects.manage');
  const roleIds = new Set(roles.filter(foremanRole).map((r) => r.id));
  const holders = new Set(
    assignments
      .filter((a) => a.principalType === 'member' && a.state === 'active' && roleIds.has(a.roleId))
      .map((a) => a.principalId),
  );
  return members.filter(
    (m) => m.status === 'active' && (m.workProfiles.includes('foreman') || holders.has(m.id)),
  );
}
export const afterRepairChange = (qc: QueryClient, tenantId: string): Promise<void> =>
  qc.invalidateQueries({ queryKey: repairKey(tenantId) });

// ── команды ───────────────────────────────────────────────────────────────────────────────────

export async function assignForeman(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  foremanMemberId: string,
): Promise<S['RepairProject']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/foreman', {
      params: { path: { tenantId, projectId }, header: idem() },
      body: { foremanMemberId },
    }),
  );
}

/** Приёмка объёма; If-Match — ревизия отметки из списка (`"rev-N"`). */
export async function acceptWorkLog(
  api: ApiClient,
  tenantId: string,
  log: Pick<S['WorkLog'], 'id' | 'revision'>,
): Promise<S['WorkLog']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/work-logs/{workLogId}/accept', {
      params: {
        path: { tenantId, workLogId: log.id },
        header: { ...idem(), 'If-Match': `"rev-${String(log.revision)}"` },
      },
    }),
  );
}

export async function submitWorkLog(
  api: ApiClient,
  tenantId: string,
  body: S['WorkLogCreate'],
): Promise<S['WorkLog']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/work-logs', {
      params: { path: { tenantId }, header: idem() },
      body,
    }),
  );
}

export async function proposeChange(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  body: S['ChangeOrderCreate'],
): Promise<S['ChangeOrder']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/repairs/projects/{projectId}/change-orders', {
      params: { path: { tenantId, projectId }, header: idem() },
      body,
    }),
  );
}

async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Фото отметки или допработы: сессия core.files (`repair_evidence`, владелец `repairs/project`); id файла. */
export async function uploadEvidence(
  api: ApiClient,
  tenantId: string,
  projectId: string,
  file: File,
  put: PutObject = putObject,
): Promise<string> {
  const body = await stripFileMetadata(file);
  const sum = await sha256(body);
  const ticket = await unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/files/uploads', {
      params: { path: { tenantId }, header: idem() },
      body: {
        fileName: file.name || 'photo.jpg',
        contentType: file.type || 'application/octet-stream',
        sizeBytes: body.size,
        sha256: sum,
        purpose: 'repair_evidence',
        owner: { moduleKey: 'repairs', entityType: 'project', entityId: projectId },
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
    // Сессия не должна висеть с резервом места (W1.24): отменяем её, ошибку отдаём вызывающему.
    await api
      .DELETE('/api/v1/tenants/{tenantId}/files/uploads/{uploadId}', {
        params: { path: { tenantId, uploadId: ticket.uploadId }, header: idem() },
      })
      .catch(() => undefined);
    throw e;
  }
  return ticket.fileId;
}
