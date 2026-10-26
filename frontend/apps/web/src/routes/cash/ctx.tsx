// W5.32 · Контекст страницы «Касса»: данные организации (кассы, журнал, смены, перемещения, предложения, заявки, статьи),
// имена сотрудников и подразделений, право участника на кассе, состояние диалога и единая обёртка команд
// (`call`: занято → команда → тост успеха или ошибка в баннере страницы; `submit` — то же внутри диалога).
import type { ApiClient, components } from '@ortus/api-client';
import type { PageKey } from '@ortus/domain/nav';
import { createContext, use } from 'react';

import type { Account, Operation, Shift } from './model.ts';

type S = components['schemas'];

/** Диалоги страницы (`modalVM` K:838–944), кроме подотчёта (W5.33). */
export type Modal =
  | { kind: 'op'; accountId: string | undefined; type?: 'in' | 'out' | 'refund' }
  | { kind: 'openShift'; accountId: string }
  | { kind: 'closeShift'; shiftId: string }
  | { kind: 'transfer'; fromId: string }
  | { kind: 'account' }
  | {
      kind: 'reason';
      act: 'reverse' | 'rejectTr' | 'rejectRq' | 'dismiss';
      id: string;
      sub: string;
      /** Подстановки заголовка и текста: `{id}`, `{sum}`, `{name}`. */
      vars: Record<string, string>;
    };

export interface CashCtx {
  tenantId: string;
  api: ApiClient;
  /** Участник организации (членство) — для правил «не автор». */
  meId: string;
  accounts: readonly Account[];
  accountOf: (id: string | null | undefined) => Account | undefined;
  ops: readonly Operation[];
  shifts: readonly Shift[];
  transfers: readonly S['CashTransfer'][];
  proposals: readonly S['CashProposal'][];
  requests: readonly S['CashApprovalRequest'][];
  categories: readonly S['CashCategory'][];
  members: readonly S['Member'][];
  memberName: (id: string | null | undefined) => string;
  units: readonly S['OrgUnit'][];
  unitTitle: (id: string | null) => string;
  busy: boolean;
  offline: boolean;
  /** Команда страницы: тост успеха; ошибка — баннер страницы. Возвращает `null` при ошибке. */
  call: <R>(
    sig: string,
    fn: (key: string) => Promise<R>,
    ok?: string | ((r: R) => string),
  ) => Promise<R | null>;
  /** Команда диалога: ошибка возвращается текстом, диалог остаётся. */
  submit: <R>(
    sig: string,
    fn: (key: string) => Promise<R>,
    ok: string | ((r: R) => string),
  ) => Promise<{ ok: true; data: R } | { ok: false; error: string }>;
  openModal: (m: Modal) => void;
  closeModal: () => void;
  go: (page: PageKey) => void;
  /** Перейти на вкладку страницы (после команды). */
  show: (nav: { tab?: Tab; shift?: string; account?: string }) => void;
  now: Date;
}

export type Tab = 'desk' | 'inbox' | 'shifts' | 'adv' | 'settings';

export const CashContext = createContext<CashCtx | null>(null);

export function useCash(): CashCtx {
  const v = use(CashContext);
  if (!v) throw new Error('useCash: вне страницы «Касса»');
  return v;
}

/** Право участника на кассе (PD-53: из `account.my.rights`). */
export const can = (a: Account | undefined, key: string): boolean => !!a?.my.rights.includes(key);
