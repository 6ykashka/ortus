// AppShell — только тип: реализация в apps/web/src/shell (W1.20).
import type { ReactNode } from 'react';
import type { NavProps, ScopeSelectProps } from './core';

/**
 * Оболочка: sidebar ≥ 1080, rail 640–1079, нижняя навигация < 640; тёмная шапка оператора.
 * Отраслевая группа меню — только у подключённого модуля; отключённый с историей — пункт в последней
 * группе «Отключены · только чтение»; не подключавшийся — отсутствует (D-23).
 * Skip-link «К содержимому», landmarks.
 */
export interface AppShellProps {
  tenant: { name: string; shortName?: string; logoUrl?: string; markUrl?: string };
  scope?: ScopeSelectProps;
  nav: NavProps['groups'];
  notifications?: {
    count: number;
    items: { id: string; title: string; meta?: string }[];
    onReadAll: () => void;
  };
  profile: { name: string; initials: string; role: string; tenantLabel?: string };
  chrome?: 'light' | 'dark';
  banners?: ReactNode;
  children: ReactNode;
}
