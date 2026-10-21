// W4.12 · Вложение задачи (d21 «Создание задачи и вложения», Q-W4.02-10, W4.03): загрузка сессией core.files —
// initiateUpload (`purpose: task_attachment`, владелец `tasks/task/{id}`) → PUT по билету → completeUpload (сверка
// SHA-256); затем attachTaskFiles. Проверка файла может ещё идти — карточка показывает файл сразу (Q-W4.03-4). Фото
// уходит без геоданных (W2.44), как у «Загрузки файла» W1.24.
import { type ApiClient, unwrap } from '@ortus/api-client';

import { stripFileMetadata } from '../files/upload/metadata.ts';
import { type PutObject, putObject } from '../files/upload/upload.tsx';

const idem = () => ({ 'Idempotency-Key': crypto.randomUUID() });

/** SHA-256 содержимого в hex (UploadCreate.sha256). */
async function sha256(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Загружает файл как вложение задачи `taskId`; возвращает id файла для attachTaskFiles. */
export async function uploadAttachment(
  api: ApiClient,
  tenantId: string,
  taskId: string,
  file: File,
  put: PutObject = putObject,
): Promise<string> {
  const body = await stripFileMetadata(file);
  const sum = await sha256(body);
  const ticket = await unwrap(
    await api.POST('/api/v1/tenants/{tenantId}/files/uploads', {
      params: { path: { tenantId }, header: idem() },
      body: {
        fileName: file.name,
        contentType: file.type || 'application/octet-stream',
        sizeBytes: body.size,
        sha256: sum,
        purpose: 'task_attachment',
        owner: { moduleKey: 'tasks', entityType: 'task', entityId: taskId },
      },
    }),
  );
  try {
    await put(ticket.uploadUrl, body, ticket.requiredContentType);
    await unwrap(
      await api.POST('/api/v1/tenants/{tenantId}/files/uploads/{uploadId}/complete', {
        params: { path: { tenantId, uploadId: ticket.uploadId }, header: idem() },
        body: { sha256: sum },
      }),
    );
  } catch (e) {
    // Сессия не должна висеть с резервом места (W1.24): отменяем её, ошибку отдаём вызывающему.
    await api
      .DELETE('/api/v1/tenants/{tenantId}/files/uploads/{uploadId}', {
        params: { path: { tenantId, uploadId: ticket.uploadId }, header: idem() },
      })
      .catch(() => undefined);
    throw e;
  }
  return ticket.fileId;
}
