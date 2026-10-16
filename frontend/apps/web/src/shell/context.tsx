// W1.20 · Контекст оболочки для страниц (контракт C-3 брифа): кто вошёл, организация, рабочее место, страница,
// режим «только чтение» (модуль отключён с историей или организация в режиме чтения), выбранная область
// владельца и проверка права «любое из» в любой области (Q-W0.11-1).
import type { MeContext, TenantContext } from '@ortus/api-client';
import { type Audience, canAny, type NavContext, type PageKey } from '@ortus/domain/nav';
import { createContext, use } from 'react';

export interface ShellValue {
  me: MeContext;
  /** Организация маршрута `/t/:tenantId`; у оператора — `null`. */
  tenant: TenantContext | null;
  tenantId: string | null;
  page: PageKey | null;
  audience: Audience;
  nav: NavContext;
  readOnly: boolean;
  /** Область владельца: `all` или id подразделения (читают «Главная» и рабочее место логиста). */
  scope: string;
  setScope: (scope: string) => void;
  /** Перейти на страницу своего контура. */
  go: (page: PageKey) => void;
}

export const ShellContext = createContext<ShellValue | null>(null);

export function useShell(): ShellValue {
  const v = use(ShellContext);
  if (!v) throw new Error('useShell: страница вне оболочки');
  return v;
}

/** Право «любое из» в любой области (меню и гейты; команды проверяет сервер по объекту). */
export function useCan(): (...permissions: string[]) => boolean {
  const { nav } = useShell();
  return (...permissions) => canAny(nav, permissions);
}
