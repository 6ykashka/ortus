// W5.32 · Запросы и команды страницы «Касса» (тег Cash, контракт 0.12.0-stage5): кассы, журнал, смены, перемещения,
// предложения, заявки, статьи; команды — проведение, сторно, связь с источником, предложения, смены, перемещения,
// заявки, мастер «Новая касса». Команды с `If-Match` берут ревизию из последнего списка (`"rev-N"`), `Idempotency-Key` —
// один на попытку и тот же при повторе, пока команда не прошла (`useIdemKey`). После команды перечитывается весь
// префикс `['tenant', id, 'cash']`.
import { type ApiClient, type components, unwrap } from '@ortus/api-client';
import { type QueryClient, useQuery } from '@tanstack/react-query';
import { useRef } from 'react';

import { useApi } from '../../app/api.tsx';

type S = components['schemas'];

export const cashKey = (tenantId: string) => ['tenant', tenantId, 'cash'] as const;

const PAGE = 200;
const MAX_PAGES = 50;

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

const pq = (cursor: string | undefined) => ({ limit: PAGE, ...(cursor ? { cursor } : {}) });

export function useAccounts(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...cashKey(tenantId), 'accounts'],
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/cash/accounts', {
            params: { path: { tenantId }, query: pq(cursor) },
          }),
        ),
      ),
  });
}

export function useOperations(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...cashKey(tenantId), 'operations'],
    enabled,
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/cash/operations', {
            params: { path: { tenantId }, query: pq(cursor) },
          }),
        ),
      ),
  });
}

export function useShifts(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...cashKey(tenantId), 'shifts'],
    enabled,
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/cash/shifts', {
            params: { path: { tenantId }, query: pq(cursor) },
          }),
        ),
      ),
  });
}

export function useTransfers(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...cashKey(tenantId), 'transfers'],
    enabled,
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/cash/transfers', {
            params: { path: { tenantId }, query: pq(cursor) },
          }),
        ),
      ),
  });
}

export function useProposals(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...cashKey(tenantId), 'proposals'],
    enabled,
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/cash/proposals', {
            params: { path: { tenantId }, query: { ...pq(cursor), status: 'open' } },
          }),
        ),
      ),
  });
}

export function useRequests(tenantId: string, enabled = true) {
  const api = useApi();
  return useQuery({
    queryKey: [...cashKey(tenantId), 'requests'],
    enabled,
    queryFn: () =>
      allPages(async (cursor) =>
        unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/cash/approval-requests', {
            params: { path: { tenantId }, query: { ...pq(cursor), status: 'pending' } },
          }),
        ),
      ),
  });
}

export function useCategories(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: [...cashKey(tenantId), 'categories'],
    staleTime: 5 * 60_000,
    queryFn: async () =>
      (
        await unwrap(
          await api.GET('/api/v1/tenants/{tenantId}/cash/categories', {
            params: { path: { tenantId } },
          }),
        )
      ).items,
  });
}

/** Имена сотрудников по id; без `members.read` или при сбое — пустая карта (подпись «сотрудник»). */
export function useMemberNames(tenantId: string, enabled: boolean) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'members', 'names'],
    enabled,
    queryFn: async () => {
      try {
        const list = await allPages(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/members', {
              params: { path: { tenantId }, query: pq(cursor) },
            }),
          ),
        );
        return list;
      } catch {
        return [] as S['Member'][];
      }
    },
  });
}

/** Роли организации для «Касса в ролях»; без права чтения ролей — пусто. */
export function useRoles(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: ['tenant', tenantId, 'roles', 'cash'],
    queryFn: async () => {
      try {
        return await allPages(async (cursor) =>
          unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/roles', {
              params: { path: { tenantId }, query: pq(cursor) },
            }),
          ),
        );
      } catch {
        return [] as S['Role'][];
      }
    },
  });
}
/** Одна и та же `Idempotency-Key` на попытку: после успеха — `settle()`, следующая команда получит новую. */
export function useIdemKey(): { key: () => string; settle: () => void } {
  const ref = useRef<string | null>(null);
  return {
    key: () => (ref.current ??= crypto.randomUUID()),
    settle: () => {
      ref.current = null;
    },
  };
}

export const etag = (revision: number): string => `"rev-${String(revision)}"`;

/** После команды перечитывается вся касса организации (остатки, журнал, смены, входящие). */
export function afterChange(qc: QueryClient, tenantId: string): Promise<void> {
  return qc.invalidateQueries({ queryKey: cashKey(tenantId) });
}

type H = (key: string) => { 'Idempotency-Key': string };
const idem: H = (key) => ({ 'Idempotency-Key': key });

export type PostResult =
  | { kind: 'posted'; operation: S['CashOperation'] }
  | { kind: 'request'; request: S['CashApprovalRequest'] };

/** «Новая операция»: 201 — операция, 202 — заявка сверх лимита роли (Q-W4.00-cash-2). */
export async function postOperation(
  api: ApiClient,
  tenantId: string,
  body: S['CashOperationCreate'],
  key: string,
): Promise<PostResult> {
  const r = await api.POST('/api/v1/tenants/{tenantId}/cash/operations', {
    params: { path: { tenantId }, header: idem(key) },
    body,
  });
  const data = await unwrap(r);
  return r.response.status === 202
    ? { kind: 'request', request: data as S['CashApprovalRequest'] }
    : { kind: 'posted', operation: data as S['CashOperation'] };
}

export async function reverseOperation(
  api: ApiClient,
  tenantId: string,
  operationId: string,
  reason: string,
  key: string,
) {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/cash/operations/{operationId}/reverse', {
      params: { path: { tenantId, operationId }, header: idem(key) },
      body: { reason },
    }),
  );
}

export async function linkSource(
  api: ApiClient,
  tenantId: string,
  operationId: string,
  source: S['CashSourceRef'],
  key: string,
) {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/cash/operations/{operationId}/source-link', {
      params: { path: { tenantId, operationId }, header: idem(key) },
      body: { source },
    }),
  );
}

/** «Похоже на дубль» (±10 минут, та же касса или её терминал, сумма, способ и тип). */
export function useDuplicates(
  tenantId: string,
  q: { accountId: string; amountMinor: number; method: S['CashOperation']['method']; type: string },
  enabled: boolean,
) {
  const api = useApi();
  return useQuery({
    queryKey: [...cashKey(tenantId), 'duplicates', q],
    enabled,
    retry: false,
    queryFn: async () => {
      try {
        return (
          await unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/cash/duplicates', {
              params: {
                path: { tenantId },
                query: {
                  accountId: q.accountId,
                  amountMinor: q.amountMinor,
                  method: q.method,
                  type: q.type as 'in',
                },
              },
            }),
          )
        ).items;
      } catch {
        return [] as S['CashOperation'][];
      }
    },
  });
}

export async function postProposal(
  api: ApiClient,
  tenantId: string,
  proposalKey: string,
  body: S['CashProposalPost'],
  key: string,
): Promise<PostResult | { kind: 'proposal'; result: S['CashProposalPostResult'] }> {
  const r = await api.POST('/api/v1/tenants/{tenantId}/cash/proposals/{proposalKey}/post', {
    params: { path: { tenantId, proposalKey }, header: idem(key) },
    body,
  });
  const data = await unwrap(r);
  return r.response.status === 202
    ? { kind: 'request', request: data as S['CashApprovalRequest'] }
    : { kind: 'proposal', result: data as S['CashProposalPostResult'] };
}

export async function dismissProposal(
  api: ApiClient,
  tenantId: string,
  proposalKey: string,
  reason: string,
  key: string,
) {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/cash/proposals/{proposalKey}/dismiss', {
      params: { path: { tenantId, proposalKey }, header: idem(key) },
      body: { reason },
    }),
  );
}

export async function openShift(
  api: ApiClient,
  tenantId: string,
  accountId: string,
  body: S['CashShiftOpen'],
  key: string,
) {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/cash/accounts/{accountId}/shifts', {
      params: { path: { tenantId, accountId }, header: idem(key) },
      body,
    }),
  );
}

export async function closeShift(
  api: ApiClient,
  tenantId: string,
  shift: S['CashShift'],
  body: S['CashShiftClose'],
  key: string,
) {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/cash/shifts/{shiftId}/close', {
      params: {
        path: { tenantId, shiftId: shift.id },
        header: { ...idem(key), 'If-Match': etag(shift.revision) },
      },
      body,
    }),
  );
}

export async function reviewShift(
  api: ApiClient,
  tenantId: string,
  shift: S['CashShift'],
  body: S['CashShiftReview'],
  key: string,
) {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/cash/shifts/{shiftId}/review', {
      params: {
        path: { tenantId, shiftId: shift.id },
        header: { ...idem(key), 'If-Match': etag(shift.revision) },
      },
      body,
    }),
  );
}

export async function createTransfer(
  api: ApiClient,
  tenantId: string,
  body: S['CashTransferCreate'],
  key: string,
) {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/cash/transfers', {
      params: { path: { tenantId }, header: idem(key) },
      body,
    }),
  );
}

export async function decideTransfer(
  api: ApiClient,
  tenantId: string,
  transfer: S['CashTransfer'],
  body: S['CashTransferDecision'],
  key: string,
) {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/cash/transfers/{transferId}/decision', {
      params: {
        path: { tenantId, transferId: transfer.id },
        header: { ...idem(key), 'If-Match': etag(transfer.revision) },
      },
      body,
    }),
  );
}

export async function decideRequest(
  api: ApiClient,
  tenantId: string,
  request: S['CashApprovalRequest'],
  body: S['CashApprovalDecision'],
  key: string,
) {
  return unwrap(
    await api.POST(
      '/api/v1/tenants/{tenantId}/cash/approval-requests/{approvalRequestId}/decision',
      {
        params: {
          path: { tenantId, approvalRequestId: request.id },
          header: { ...idem(key), 'If-Match': etag(request.revision) },
        },
        body,
      },
    ),
  );
}

export async function createAccount(
  api: ApiClient,
  tenantId: string,
  body: S['CashAccountCreate'],
  key: string,
) {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/cash/accounts', {
      params: { path: { tenantId }, header: idem(key) },
      body,
    }),
  );
}

/** «Кто получит доступ»: чтение по черновику кассы (терминал считается по кассе точки — Q-W5.32-1). */
export function useAccessPreview(
  tenantId: string,
  q: { kind: S['CashAccount']['kind']; orgUnitId: string | null; holderMemberId: string | null },
  enabled: boolean,
) {
  const api = useApi();
  return useQuery({
    queryKey: [...cashKey(tenantId), 'access-preview', q],
    enabled,
    retry: false,
    queryFn: async () => {
      try {
        return (
          await unwrap(
            await api.GET('/api/v1/tenants/{tenantId}/cash/accounts/access-preview', {
              params: {
                path: { tenantId },
                query: {
                  kind: q.kind === 'acquiring' ? 'cash_drawer' : q.kind,
                  ...(q.orgUnitId ? { orgUnitId: q.orgUnitId } : {}),
                  ...(q.holderMemberId ? { holderMemberId: q.holderMemberId } : {}),
                },
              },
            }),
          )
        ).items;
      } catch {
        return [] as S['CashAccessPerson'][];
      }
    },
  });
}
