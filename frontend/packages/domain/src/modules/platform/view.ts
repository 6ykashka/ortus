// Проекция control DB (api.js 14.10:186–192). Оператор платформы (участника нет) видит всё;
// участник организации — только свою организацию и свои заявки на тариф, без общего каталога
// аккаунтов, операторов и журнала. Возвращается копия: вызывающий может её менять.
import type { Platform, TenantPlatformView } from './types.ts';

export function platformView(platform: Platform, tenantId: string, actor: null): Platform;
export function platformView(
  platform: Platform,
  tenantId: string,
  actor: string,
): TenantPlatformView;
export function platformView(
  platform: Platform,
  tenantId: string,
  actor: string | null,
): Platform | TenantPlatformView {
  if (actor === null) return structuredClone(platform);
  return structuredClone({
    tenants: platform.tenants.filter((t) => t.id === tenantId),
    priceBook: platform.priceBook,
    requests: platform.requests.filter((r) => r.tenantId === tenantId),
  });
}
