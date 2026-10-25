// W4.70 · Загрузка файла ответа (вопрос «Файл или фото»): сотрудник — сессия core.files (`initiateUpload`, purpose
// `form_attachment`, владелец `forms/form/{id}` → PUT по билету → `completeUpload`; ответ принимает файл и до конца
// проверки, backend W4.21 filesOf); гость — `initiatePublicUpload` → PUT → `completePublicUpload` по нонсу, к ответу —
// только после проверки (`getPublicUploadStatus` до `ready`, как требует сервер). Геоданные фото вырезаются (W2.44).
import { type ApiClient, type components, unwrap } from '@ortus/api-client';

import { stripFileMetadata } from '../../files/upload/metadata.ts';
import { type PutObject, putObject } from '../../files/upload/upload.tsx';

type S = components['schemas'];

/** Файл передан: id файла и состояние проверки после завершения загрузки. */
export interface Uploaded {
  fileId: string;
  status: S['File']['status'];
}

/** Загрузка одного файла вопроса `fieldKey`. */
export type Uploader = (file: File, fieldKey: string) => Promise<Uploaded>;

/** Состояние проверки файла гостя (опрос до `ready` или `rejected`). */
export type StatusOf = (fileId: string) => Promise<S['File']['status']>;

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

/** SHA-256 содержимого в hex (UploadCreate.sha256, PublicUploadCreate.sha256). */
async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const typeOf = (file: File): string => file.type || 'application/octet-stream';

/** Сотрудник: файл формы `formId` организации `tenantId`. */
export function memberUploader(
  api: ApiClient,
  tenantId: string,
  formId: string,
  put: PutObject = putObject,
): Uploader {
  return async (file) => {
    const body = await stripFileMetadata(file);
    const sum = await sha256(body);
    const ticket = await unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/files/uploads', {
        params: { path: { tenantId }, header: idem() },
        body: {
          fileName: file.name,
          contentType: typeOf(file),
          sizeBytes: body.size,
          sha256: sum,
          purpose: 'form_attachment',
          owner: { moduleKey: 'forms', entityType: 'form', entityId: formId },
        },
      }),
    );
    try {
      await put(ticket.uploadUrl, body, ticket.requiredContentType);
      const f = await unwrap(
        await api.POST('/api/v1/tenants/{tenantId}/files/uploads/{uploadId}/complete', {
          params: { path: { tenantId, uploadId: ticket.uploadId }, header: idem() },
          body: { sha256: sum },
        }),
      );
      return { fileId: ticket.fileId, status: f.status };
    } catch (e) {
      // Сессия не должна держать резерв места (W1.24): отменяем, ошибку отдаём полю.
      await api
        .DELETE('/api/v1/tenants/{tenantId}/files/uploads/{uploadId}', {
          params: { path: { tenantId, uploadId: ticket.uploadId }, header: idem() },
        })
        .catch(() => undefined);
      throw e;
    }
  };
}

/** Гость: файл по публичной ссылке `token`, нонсу и версии формы. */
export function guestUploader(
  api: ApiClient,
  link: { token: string; versionId: string; nonce: string },
  put: PutObject = putObject,
): { upload: Uploader; status: StatusOf } {
  const path = { publicToken: link.token };
  const uploads = new Map<string, string>();
  return {
    upload: async (file, fieldKey) => {
      const body = await stripFileMetadata(file);
      const sum = await sha256(body);
      const ticket = await unwrap(
        await api.POST('/api/v1/public/forms/{publicToken}/uploads', {
          params: { path, header: idem() },
          body: {
            versionId: link.versionId,
            submissionNonce: link.nonce,
            fieldKey,
            fileName: file.name,
            contentType: typeOf(file),
            sizeBytes: body.size,
            sha256: sum,
          },
        }),
      );
      await put(ticket.uploadUrl, body, ticket.requiredContentType);
      const f = await unwrap(
        await api.POST('/api/v1/public/forms/{publicToken}/uploads/{uploadId}/complete', {
          params: { path: { ...path, uploadId: ticket.uploadId }, header: idem() },
          body: { submissionNonce: link.nonce, sha256: sum },
        }),
      );
      uploads.set(ticket.fileId, ticket.uploadId);
      return { fileId: ticket.fileId, status: f.status };
    },
    status: async (fileId) => {
      const uploadId = uploads.get(fileId) ?? '';
      const f = await unwrap(
        await api.POST('/api/v1/public/forms/{publicToken}/uploads/{uploadId}/status', {
          params: { path: { ...path, uploadId } },
          body: { submissionNonce: link.nonce },
        }),
      );
      return f.status;
    },
  };
}
