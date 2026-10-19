// W2.50 · Команды импорта машин (контракт 0.6.1-stage2, тег Fleet): предпросмотр createVehicleImport (Idempotency-Key —
// тот же файл и фирма — тот же ключ, повтор после «нет связи» не создаёт второй импорт) и применение
// commitVehicleImport (If-Match — ETag предпросмотра, без него 428; устаревший — 412).
import { type ApiClient, type components, ProblemError, unwrap } from '@ortus/api-client';

type S = components['schemas'];

export interface Preview {
  imp: S['VehicleImport'];
  etag: string;
}

export async function createImport(
  api: ApiClient,
  tenantId: string,
  body: S['VehicleImportCreate'],
  key: string,
): Promise<Preview> {
  const r = await api.POST('/api/v1/tenants/{tenantId}/fleet/vehicle-imports', {
    params: { path: { tenantId }, header: { 'Idempotency-Key': key } },
    body,
  });
  const imp = await unwrap(r);
  return { imp, etag: r.response.headers.get('ETag') ?? '' };
}

export async function commitImport(
  api: ApiClient,
  tenantId: string,
  p: Preview,
  skipInvalidRows: boolean,
): Promise<S['VehicleImport']> {
  if (!p.etag) throw new ProblemError(428);
  return unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/fleet/vehicle-imports/{importId}/commit', {
      params: {
        path: { tenantId, importId: p.imp.id },
        header: { 'Idempotency-Key': crypto.randomUUID(), 'If-Match': p.etag },
      },
      body: { skipInvalidRows },
    }),
  );
}

/** Текст выбранного файла (File.text; FileReader — для окружений без Blob.text). */
export function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error('FileReader'));
    r.readAsText(file, 'utf-8');
  });
}
