// W1.20 · Адреса страниц оболочки (ADR-0001): типизированные цели навигации TanStack Router.
import { type Area, type PageKey, segmentOf } from '@ortus/domain/nav';

export type ShellTarget =
  | { to: '/t/$tenantId/$page'; params: { tenantId: string; page: string } }
  | { to: '/platform/$page'; params: { page: string } };

export function pageTarget(area: Area, tenantId: string | null, page: PageKey): ShellTarget {
  const segment = segmentOf(page) ?? page;
  return area === 'platform'
    ? { to: '/platform/$page', params: { page: segment } }
    : { to: '/t/$tenantId/$page', params: { tenantId: tenantId ?? '', page: segment } };
}
