// W7.33 · Сеть портала клиента: операции тега PublicService (без сессии), ключи идемпотентности, загрузка вложений
// клиента по личной ссылке (FILE-02: файл на проверке, сотрудник видит его после проверки).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';

import { stripFileMetadata } from '../core/files/upload/metadata.ts';
import { type PutObject, putObject } from '../core/files/upload/upload.tsx';

type S = components['schemas'];

export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_FILES = 5;

/** Ключ идемпотентности на одну задуманную команду: повтор того же тела — тот же ключ. */
export function idemKeys(): { key: (body: unknown) => string; settle: (body: unknown) => void } {
  const keys = new Map<string, string>();
  const fp = (body: unknown) => JSON.stringify(body ?? null);
  return {
    key: (body) => {
      let k = keys.get(fp(body));
      if (!k) {
        k = crypto.randomUUID();
        keys.set(fp(body), k);
      }
      return k;
    },
    settle: (body) => void keys.delete(fp(body)),
  };
}

export const getPage = async (api: ApiClient, slug: string): Promise<S['PublicServicePage']> =>
  unwrap(await api.GET('/api/v1/public/service/{slug}', { params: { path: { slug } } }));

export const getRequest = async (
  api: ApiClient,
  token: string,
): Promise<S['PublicServiceRequest']> =>
  unwrap(await api.GET('/api/v1/public/service/requests/{token}', { params: { path: { token } } }));

export const submitRequest = async (
  api: ApiClient,
  slug: string,
  body: S['PublicServiceSubmit'],
  key: string,
): Promise<S['PublicServiceReceipt']> =>
  unwrap(
    await api.POST('/api/v1/public/service/{slug}/requests', {
      params: { path: { slug }, header: { 'Idempotency-Key': key } },
      body,
    }),
  );

export const postMessage = async (
  api: ApiClient,
  token: string,
  body: S['PublicServiceMessageCreate'],
  key: string,
): Promise<S['PublicServiceMessage']> =>
  unwrap(
    await api.POST('/api/v1/public/service/requests/{token}/messages', {
      params: { path: { token }, header: { 'Idempotency-Key': key } },
      body,
    }),
  );

export const rateResolution = async (
  api: ApiClient,
  token: string,
  score: number,
): Promise<S['PublicServiceRequest']> =>
  unwrap(
    await api.POST('/api/v1/public/service/requests/{token}/csat', {
      params: { path: { token }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      body: { score },
    }),
  );

export const reopenRequest = async (
  api: ApiClient,
  token: string,
  text: string,
  key: string,
): Promise<S['PublicServiceRequest']> =>
  unwrap(
    await api.POST('/api/v1/public/service/requests/{token}/reopen', {
      params: { path: { token }, header: { 'Idempotency-Key': key } },
      body: text ? { text } : {},
    }),
  );

export const optOut = async (api: ApiClient, token: string): Promise<boolean> =>
  (
    await unwrap(
      await api.POST('/api/v1/public/service/requests/{token}/opt-out', {
        params: { path: { token }, header: { 'Idempotency-Key': crypto.randomUUID() } },
      }),
    )
  ).optedOut;

/** SHA-256 содержимого в hex (PublicServiceUploadCreate.sha256). */
async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Attached {
  fileId: string;
  name: string;
}

/** Ошибка вложения с готовым текстом для клиента. */
export class AttachError extends Error {}

/** Вложение клиента: билет → PUT → завершение; геоданные фото вырезаются (W2.44). */
export async function attach(
  api: ApiClient,
  token: string,
  file: File,
  put: PutObject = putObject,
): Promise<Attached> {
  const body = await stripFileMetadata(file);
  if (body.size > MAX_FILE_BYTES) throw new AttachError('size');
  const sum = await sha256(body);
  const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });
  const ticket = await unwrap(
    await api.POST('/api/v1/public/service/requests/{token}/uploads', {
      params: { path: { token }, header: idem() },
      body: {
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: body.size,
        sha256: sum,
      },
    }),
  );
  await put(ticket.uploadUrl, body, ticket.requiredContentType);
  await unwrap(
    await api.POST('/api/v1/public/service/requests/{token}/uploads/{uploadId}/complete', {
      params: { path: { token, uploadId: ticket.uploadId }, header: idem() },
      body: { sha256: sum },
    }),
  );
  return { fileId: ticket.fileId, name: file.name };
}
