// W4.62 · Запросы и команды «Оформления» (контракт 0.8.0-stage4, тег Branding): действующая версия с ETag
// (getTenantBranding), новая версия с If-Match (updateTenantBranding), загрузка логотипа и знака
// (uploadBrandingAsset, base64 в JSON). После сохранения /me/context перечитывается — тема оболочки всех
// участников приходит в TenantContext.branding.
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';
import { type QueryClient, useQuery } from '@tanstack/react-query';

import { useApi } from '../../../app/api.tsx';
import { ME_CONTEXT_KEY } from '../../../shell/me.ts';

type S = components['schemas'];

export interface Saved {
  branding: S['Branding'];
  etag: string;
}

export const brandingKey = (tenantId: string) => ['tenant', tenantId, 'branding'] as const;

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

export function useBranding(tenantId: string) {
  const api = useApi();
  return useQuery({
    queryKey: brandingKey(tenantId),
    queryFn: async (): Promise<Saved> => {
      const r = await api.GET('/api/v1/tenants/{tenantId}/branding', {
        params: { path: { tenantId } },
      });
      const branding = await unwrap(r);
      return { branding, etag: r.response.headers.get('ETag') ?? '' };
    },
  });
}

/** Новая версия: If-Match по ETag прочитанной версии (без версии сервер ответит 428 — не отправляем). */
export async function saveBranding(
  api: ApiClient,
  tenantId: string,
  etag: string,
  body: S['BrandingUpdate'],
): Promise<Saved> {
  if (!etag) throw new ProblemError(428);
  const r = await api.PUT('/api/v1/tenants/{tenantId}/branding', {
    params: { path: { tenantId }, header: { ...idem(), 'If-Match': etag } },
    body,
  });
  const branding = await unwrap(r);
  return { branding, etag: r.response.headers.get('ETag') ?? '' };
}

/** Байты файла в base64 (≤ 1 МиБ, проверено до вызова). */
async function base64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export async function uploadAsset(
  api: ApiClient,
  tenantId: string,
  kind: 'logo' | 'mark',
  file: File,
): Promise<S['BrandingAsset']> {
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/branding/assets', {
      params: { path: { tenantId }, header: idem() },
      body: {
        kind,
        fileName: file.name.slice(0, 200) || kind,
        contentType: file.type as S['BrandingAssetUpload']['contentType'],
        contentBase64: await base64(file),
      },
    }),
  );
}

/** После сохранения: действующая версия в кэше страницы и /me/context (тема оболочки). */
export async function afterSave(qc: QueryClient, tenantId: string, saved: Saved): Promise<void> {
  qc.setQueryData(brandingKey(tenantId), saved);
  await qc.invalidateQueries({ queryKey: ME_CONTEXT_KEY });
}

/** Текст нарушения 422 (первое) — его показывает сама страница. */
export function violationText(e: unknown): string | null {
  if (!(e instanceof ProblemError)) return null;
  const v = (e.problem as { violations?: { message?: string }[] } | undefined)?.violations;
  return v?.[0]?.message ?? null;
}
