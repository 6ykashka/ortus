// W6.24 · Реестр вкладок объекта «Ремонт и стройка» с деньгами: контракт для оболочки карточки W6.20. Оболочка
// выбирает вкладку по `key` (эталон: docs, finance, pay, subs, client), рисует её `component` с
// `{ tenantId, projectId }` и показывает вкладки с `needsFinance` только при `repairs.finance.read`
// (Q-W4.00-repair-24). Вкладки сами рисуют раздел с h2 и сами проверяют права на действия.
import { type ComponentType, lazy } from 'react';

import type { TabProps } from './shared.tsx';
import { TAB_NAMES } from './texts.ts';

export type MoneyTabKey = keyof typeof TAB_NAMES;

export interface MoneyTab {
  key: MoneyTabKey;
  label: string;
  /** Ключ экрана в `api/openapi/screens.yaml`. */
  screen: string;
  /** Нужно право `repairs.finance.read`: без него вкладки в оболочке нет. */
  needsFinance: boolean;
  component: ComponentType<TabProps>;
}

export const MONEY_TABS: readonly MoneyTab[] = [
  {
    key: 'docs',
    label: TAB_NAMES.docs,
    screen: 'repair-docs',
    needsFinance: false,
    component: lazy(() => import('./DocsTab.tsx')),
  },
  {
    key: 'finance',
    label: TAB_NAMES.finance,
    screen: 'repair-finance',
    needsFinance: true,
    component: lazy(() => import('./FinanceTab.tsx')),
  },
  {
    key: 'pay',
    label: TAB_NAMES.pay,
    screen: 'repair-pay',
    needsFinance: true,
    component: lazy(() => import('./PayTab.tsx')),
  },
  {
    key: 'subs',
    label: TAB_NAMES.subs,
    screen: 'repair-subs',
    needsFinance: true,
    component: lazy(() => import('./SubsTab.tsx')),
  },
  {
    key: 'client',
    label: TAB_NAMES.client,
    screen: 'repair-client',
    needsFinance: true,
    component: lazy(() => import('./ClientTab.tsx')),
  },
];

export const isMoneyTab = (v: unknown): v is MoneyTabKey =>
  typeof v === 'string' && MONEY_TABS.some((t) => t.key === v);
