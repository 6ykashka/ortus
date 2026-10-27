// W5.33 · Запросы и команды «Моего подотчёта» (контракт 0.12.0-stage5, тег Cash). Ключи — под префиксом
// `['tenant', id, 'cash']`: после любой команды перечитывается всё, что видит держатель подотчёта. Изменяющие
// команды — с Idempotency-Key. Держатель без права `cash.advance.self` получает 403 на списке касс — страница
// показывает «Кассы недоступны».
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { SEED_EXPENSE_CATEGORIES } from './categories.ts';
import type { Account, Category, Operation, Receipt, Transfer } from './model.ts';

type S = components['schemas'];

export const cashKey = (tenantId: string) => ['tenant', tenantId, 'cash'] as const;
export const selfKey = (tenantId: string) => [...cashKey(tenantId), 'self'] as const;

const PAGE = 100;
const MAX_PAGES = 20;

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

const pageQuery = (cursor: string | undefined) => ({ limit: PAGE, ...(cursor ? { cursor } : {}) });

export interface SelfData {
  accounts: Account[];
  ops: Operation[];
  transfers: Transfer[];
  receipts: Receipt[];
  categories: Category[];
}

/** Нет права на кассы: список касс ответил 403 — «Кассы недоступны». */
export const isForbidden = (e: unknown): boolean => e instanceof ProblemError && e.status === 403;

async function load(api: ApiClient, tenantId: string): Promise<SelfData> {
  const path = { tenantId };
  const accounts = await allPages(async (cursor) =>
    unwrap(
      await api.GET('/api/v1/tenants/{tenantId}/cash/accounts', {
        params: { path, query: { kind: 'advance', ...pageQuery(cursor) } },
      }),
    ),
  );
  const mine = accounts.filter((a) => a.my.isHolder === true);
  if (!mine.length) return { accounts, ops: [], transfers: [], receipts: [], categories: [] };
  const [ops, transfers, receipts, categories] = await Promise.all([
    allPages(async (cursor) =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/cash/operations', {
          params: { path, query: pageQuery(cursor) },
        }),
      ),
    ),
    // listCashTransfers требует `cash.read`: держателю с одним `cash.advance.self` — 403 (Q-W5.33-8), список пуст.
    allPages(async (cursor) =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/cash/transfers', {
          params: { path, query: pageQuery(cursor) },
        }),
      ),
    ).catch((e: unknown) => (isForbidden(e) ? [] : Promise.reject(e as Error))),
    allPages(async (cursor) =>
      unwrap(
        await api.GET('/api/v1/tenants/{tenantId}/cash/receipts', {
          params: { path, query: pageQuery(cursor) },
        }),
      ),
    ),
    // listCashCategories тоже требует `cash.read` (Q-W5.33-9): без него — сидовый справочник статей.
    api
      .GET('/api/v1/tenants/{tenantId}/cash/categories', { params: { path } })
      .then(async (r) => (await unwrap(r)).items)
      .catch((e: unknown) =>
        isForbidden(e) ? [...SEED_EXPENSE_CATEGORIES] : Promise.reject(e as Error),
      ),
  ]);
  return { accounts, ops, transfers, receipts, categories };
}

/** Счета «подотчёт», журнал, перемещения, чеки и статьи держателя подотчёта. */
export function useSelfData(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: selfKey(tenantId),
    queryFn: () => load(api, tenantId),
    retry: false,
  });
}

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export interface ReceiptInput {
  accountId: string;
  amountMinor: number;
  categoryId: string;
  fileId: string;
  /** «К чему относится» (в контракте у чека нет свободной связи — уходит в `note`, Q-W5.33-6). */
  note: string;
  qr: string | null;
  redoOfReceiptId: string | null;
}

export async function submitReceipt(api: ApiClient, tenantId: string, i: ReceiptInput) {
  const body: S['AdvanceReceiptCreate'] = {
    amount: { amountMinor: i.amountMinor, currency: 'RUB' },
    categoryId: i.categoryId,
    fileId: i.fileId,
    ...(i.note ? { note: i.note } : {}),
    ...(i.qr ? { qr: i.qr } : {}),
    ...(i.redoOfReceiptId ? { redoOfReceiptId: i.redoOfReceiptId } : {}),
  };
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/cash/accounts/{accountId}/receipts', {
      params: { path: { tenantId, accountId: i.accountId }, header: idem() },
      body,
    }),
  );
}

export async function returnAdvance(
  api: ApiClient,
  tenantId: string,
  accountId: string,
  amountMinor: number,
) {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/cash/accounts/{accountId}/advance-returns', {
      params: { path: { tenantId, accountId }, header: idem() },
      body: { amount: { amountMinor, currency: 'RUB' } },
    }),
  );
}

/** «Получил(а)»: приём входящего перемещения в пути (If-Match свежего перемещения). */
export async function acceptTransfer(api: ApiClient, tenantId: string, t: Transfer) {
  const path = { tenantId, transferId: t.id };
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/cash/transfers/{transferId}/decision', {
      params: { path, header: { ...idem(), 'If-Match': `"rev-${String(t.revision)}"` } },
      body: { decision: 'accept' },
    }),
  );
}
